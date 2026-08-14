import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCK_MAX_ATTEMPTS,
  ResourceLockError,
  acquireResourceLock,
  computeLockBackoffMs,
  lockIsExpired,
  orderedLockResources,
  releaseResourceLock,
  withResourceLocks,
} from "../wix/backend/resource-lock-contract.js";

function createClient(overrides = {}) {
  const store = new Map();
  const ops = { insert: 0, get: 0, remove: 0, wait: 0 };
  const waits = [];
  let clock = overrides.startClock ?? 0;
  let ownerSequence = 0;

  return {
    store,
    ops,
    waits,
    dataOps: () => ops.insert + ops.get + ops.remove,
    seed: (id, record) => store.set(id, { _id: id, ...record }),
    insert: async (record) => {
      ops.insert += 1;
      if (store.has(record._id)) {
        throw new Error("Insert failed: item already exists.");
      }
      store.set(record._id, { ...record });
      return { ...record };
    },
    get: async (id) => {
      ops.get += 1;
      const record = store.get(id);
      return record ? { ...record } : null;
    },
    remove: async (id) => {
      ops.remove += 1;
      store.delete(id);
    },
    now: () => clock,
    wait: async (milliseconds) => {
      ops.wait += 1;
      waits.push(milliseconds);
      clock += milliseconds;
    },
    random: () => 0,
    newOwner: () => `owner-${++ownerSequence}`,
    recordId: (resource) => `lock:${resource}`,
    ...overrides,
  };
}

describe("quota-safe Wix resource lock mirror", () => {
  it("deduplicates and orders lock acquisition", () => {
    expect(orderedLockResources(["b", "a", "b", "c"])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("recognizes expiry and keeps jittered backoff bounded", () => {
    expect(lockIsExpired({ expiresAt: new Date(500) }, 1000)).toBe(true);
    expect(lockIsExpired({ expiresAt: new Date(2000) }, 1000)).toBe(false);
    expect(
      computeLockBackoffMs(1, {
        baseMs: 120,
        maxMs: 750,
        random: () => 0,
      }),
    ).toBe(60);
    expect(
      computeLockBackoffMs(10, {
        baseMs: 120,
        maxMs: 750,
        random: () => 1,
      }),
    ).toBe(750);
  });

  it("acquires an uncontended resource with one Wix Data write", async () => {
    const client = createClient();
    const lock = await acquireResourceLock(client, "competition:one");

    expect(lock.owner).toBeTruthy();
    expect(client.ops.insert).toBe(1);
    expect(client.ops.get).toBe(0);
    expect(client.ops.wait).toBe(0);
  });

  it("uses a small bounded request count instead of 250ms polling", async () => {
    const client = createClient();
    client.seed("lock:competition:one", {
      owner: "active-holder",
      expiresAt: new Date(10 * 60 * 1000),
    });

    await expect(
      acquireResourceLock(client, "competition:one"),
    ).rejects.toMatchObject({
      name: "ResourceLockError",
      attempts: DEFAULT_LOCK_MAX_ATTEMPTS,
      resource: "competition:one",
    });
    expect(client.dataOps()).toBeLessThanOrEqual(15);
    expect(client.ops.wait).toBe(DEFAULT_LOCK_MAX_ATTEMPTS - 1);
    expect(client.waits).not.toContain(250);
  });

  it("reclaims an expired holder and takes ownership", async () => {
    const client = createClient({ startClock: 1000 });
    client.seed("lock:resource", {
      owner: "stale-owner",
      expiresAt: new Date(500),
    });

    const lock = await acquireResourceLock(client, "resource");

    expect(lock.owner).not.toBe("stale-owner");
    expect(client.store.get("lock:resource").owner).toBe(lock.owner);
  });

  it("does not remove a successor observed during expired reclaim", async () => {
    let reads = 0;
    let removed = false;
    const client = createClient({
      startClock: 1000,
      insert: async () => {
        throw new Error("held");
      },
      get: async (id) => {
        reads += 1;
        return reads === 1
          ? {
              _id: id,
              owner: "stale-owner",
              expiresAt: new Date(500),
            }
          : {
              _id: id,
              owner: "successor",
              expiresAt: new Date(10 * 60 * 1000),
            };
      },
      remove: async () => {
        removed = true;
      },
    });

    await expect(
      acquireResourceLock(client, "resource", { maxAttempts: 2 }),
    ).rejects.toBeInstanceOf(ResourceLockError);
    expect(removed).toBe(false);
  });

  it("releases only the caller's current ownership", async () => {
    const client = createClient();
    const lock = await acquireResourceLock(client, "resource");
    client.store.set(lock.id, {
      _id: lock.id,
      owner: "successor",
      expiresAt: new Date(10 * 60 * 1000),
    });

    await releaseResourceLock(client, lock);

    expect(client.store.get(lock.id).owner).toBe("successor");
  });

  it("releases all locks when the protected callback fails", async () => {
    const client = createClient();

    await expect(
      withResourceLocks(client, ["b", "a"], async () => {
        expect(client.store.has("lock:a")).toBe(true);
        expect(client.store.has("lock:b")).toBe(true);
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    expect(client.store.size).toBe(0);
  });

  it("keeps the Wix backend integration aligned with the contract", () => {
    const backend = readFileSync(
      new URL("../wix/backend/public-signup-payments.js", import.meta.url),
      "utf8",
    );

    expect(backend).toContain(
      "withResourceLocks as withResourceLocksContract",
    );
    expect(backend).toContain('{ key: "owner", displayName: "Owner Token"');
    expect(backend).toContain("export async function withWorkspaceLocks");
    expect(backend).not.toContain("attempt <= 20");
    expect(backend).not.toContain("await wait(250)");
  });
});
