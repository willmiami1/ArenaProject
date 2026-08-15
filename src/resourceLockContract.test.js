import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RESOURCE_LOCK_OPTIONS,
  ResourceLockOwnershipError,
  competitionLockResources,
  createResourceLockManager,
} from "../wix/backend/resource-lock-contract.js";

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

class MemoryLockStore {
  constructor() {
    this.items = new Map();
    this.requests = { get: 0, insert: 0, remove: 0, update: 0 };
    this.beforeRemove = null;
  }

  copy(lock) {
    return lock ? { ...lock } : null;
  }

  async insert(lock) {
    this.requests.insert += 1;
    if (this.items.has(lock.id)) throw new Error("Lock already exists.");
    this.items.set(lock.id, this.copy(lock));
    return this.copy(lock);
  }

  async get(id) {
    this.requests.get += 1;
    return this.copy(this.items.get(id));
  }

  async update(lock) {
    this.requests.update += 1;
    const current = this.items.get(lock.id);
    if (
      !current ||
      current.ownerToken !== lock.ownerToken ||
      current.expiresAt <= lock.mustBeValidAt
    ) {
      throw new Error("Lock update condition failed.");
    }
    const renewed = { ...lock };
    delete renewed.mustBeValidAt;
    this.items.set(lock.id, this.copy(renewed));
    return this.copy(renewed);
  }

  async remove(lock) {
    this.requests.remove += 1;
    if (this.beforeRemove) await this.beforeRemove(lock.id);
    const current = this.items.get(lock.id);
    if (
      !current ||
      current.ownerToken !== lock.ownerToken ||
      current.expiresAt > lock.expiresAt
    ) {
      throw new Error("Lock removal condition failed.");
    }
    this.items.delete(lock.id);
    return this.copy(current);
  }
}

let ownerSequence = 0;

const lockManager = (store, options = {}) =>
  createResourceLockManager({
    store,
    idForResource: (resource) => `lock:${resource}`,
    createOwnerToken: () => `owner-${(ownerSequence += 1)}`,
    describeResource: (resource, id) => ({
      type: resource.split(":")[0],
      lockId: id,
    }),
    options: {
      leaseMs: 80,
      renewIntervalMs: 20,
      waitTimeoutMs: 240,
      retryDelayMs: 3,
      maxRetryDelayMs: 12,
      retryJitterRatio: 0,
      claimSettleMs: 1,
      ownershipCheckIntervalMs: 0,
      ...options,
    },
  });

describe("quota-safe renewable Wix resource locks", () => {
  it("rejects the original 60-second lease and five-second wait mismatch", () => {
    expect(() =>
      createResourceLockManager({
        store: new MemoryLockStore(),
        idForResource: String,
        createOwnerToken: () => "owner",
        options: {
          leaseMs: 60_000,
          renewIntervalMs: 20_000,
          waitTimeoutMs: 5_000,
        },
      }),
    ).toThrow(/waitTimeoutMs must exceed leaseMs/);
    expect(DEFAULT_RESOURCE_LOCK_OPTIONS.waitTimeoutMs).toBeGreaterThan(
      DEFAULT_RESOURCE_LOCK_OPTIONS.leaseMs,
    );
  });

  it("acquires and releases an uncontended lock", async () => {
    const store = new MemoryLockStore();
    const manager = lockManager(store);

    await expect(
      manager.run(["competition:event-1"], async () => "saved"),
    ).resolves.toBe("saved");
    expect(store.items.size).toBe(0);
  });

  it("waits for an active owner and then acquires", async () => {
    const store = new MemoryLockStore();
    const manager = lockManager(store);
    const entered = deferred();
    const release = deferred();
    const order = [];

    const first = manager.run(["competition:event-1"], async () => {
      order.push("first");
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const second = manager.run(["competition:event-1"], async () => {
      order.push("second");
    });

    await delay(15);
    expect(order).toEqual(["first"]);
    release.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "second"]);
  });

  it("keeps contention within the Wix Data request budget", async () => {
    const store = new MemoryLockStore();
    let clock = 0;
    const sleeps = [];
    store.items.set("lock:competition:workspace", {
      id: "lock:competition:workspace",
      resource: "competition:workspace",
      ownerToken: "active-owner",
      expiresAt: 100_000,
    });
    const manager = createResourceLockManager({
      store,
      idForResource: (resource) => `lock:${resource}`,
      createOwnerToken: () => "waiting-owner",
      now: () => clock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
      },
      random: () => 1,
      options: {
        ...DEFAULT_RESOURCE_LOCK_OPTIONS,
        claimSettleMs: 0,
      },
    });

    await expect(
      manager.run(["competition:workspace"], async () => undefined),
    ).rejects.toMatchObject({ code: "RESOURCE_LOCK_TIMEOUT" });
    expect(store.requests.insert).toBe(1);
    expect(sleeps.slice(0, 4)).toEqual([600, 1200, 2400, 3000]);
    expect(store.requests.insert + store.requests.get).toBeLessThanOrEqual(12);
  });

  it("renews long callbacks so consecutive saves never overlap", async () => {
    const store = new MemoryLockStore();
    const manager = lockManager(store, {
      leaseMs: 40,
      renewIntervalMs: 10,
      waitTimeoutMs: 220,
      retryDelayMs: 2,
    });
    let active = 0;
    let maximumActive = 0;
    const save = (milliseconds) =>
      manager.run(["competition:arena-workspace-mutation"], async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await delay(milliseconds);
        active -= 1;
      });

    const first = save(90);
    await delay(4);
    const second = save(5);
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
    expect(store.requests.update).toBeGreaterThan(0);
  });

  it("prevents an expired cleanup from deleting a successor", async () => {
    const store = new MemoryLockStore();
    const lockId = "lock:competition:event-1";
    const successor = {
      id: lockId,
      resource: "competition:event-1",
      ownerToken: "successor",
      expiresAt: Date.now() + 1000,
    };
    store.items.set(lockId, {
      id: lockId,
      resource: "competition:event-1",
      ownerToken: "expired-owner",
      expiresAt: Date.now() - 1,
    });
    store.beforeRemove = async () => {
      store.beforeRemove = null;
      store.items.set(lockId, { ...successor });
    };

    await expect(
      lockManager(store, {
        leaseMs: 30,
        renewIntervalMs: 8,
        waitTimeoutMs: 80,
      }).run(["competition:event-1"], async () => undefined),
    ).rejects.toMatchObject({ code: "RESOURCE_LOCK_TIMEOUT" });
    expect(store.items.get(lockId)).toEqual(successor);
  });

  it("stops mutation when ownership is lost", async () => {
    const store = new MemoryLockStore();
    const manager = lockManager(store);
    let mutated = false;

    await expect(
      manager.run(["competition:event-1"], async (scope) => {
        store.items.set("lock:competition:event-1", {
          id: "lock:competition:event-1",
          resource: "competition:event-1",
          ownerToken: "successor",
          expiresAt: Date.now() + 1000,
        });
        await scope.assertOwned();
        mutated = true;
      }),
    ).rejects.toBeInstanceOf(ResourceLockOwnershipError);
    expect(mutated).toBe(false);
  });

  it("serializes Workspace and signup on one mutation barrier", async () => {
    const store = new MemoryLockStore();
    const manager = lockManager(store);
    const resource = competitionLockResources([
      "arena-workspace-mutation",
    ])[0];
    const entered = deferred();
    const release = deferred();
    const order = [];

    const workspaceSave = manager.run([resource], async () => {
      order.push("workspace");
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const signup = manager.run([resource], async () => {
      order.push("signup");
    });

    await delay(15);
    expect(order).toEqual(["workspace"]);
    release.resolve();
    await Promise.all([workspaceSave, signup]);
    expect(order).toEqual(["workspace", "signup"]);
  });

  it("wires every mirrored mutation flow to the shared barrier", () => {
    const payments = readFileSync(
      new URL("../wix/backend/public-signup-payments.js", import.meta.url),
      "utf8",
    );
    const backend = readFileSync(
      new URL("../wix/backend/arena-data.web.js", import.meta.url),
      "utf8",
    );

    expect(backend).toMatch(
      /withFullWorkspaceLocks = \(callback\) =>\s*withWorkspaceLocks\(\[WORKSPACE_MUTATION_LOCK_RESOURCE\], callback\)/,
    );
    expect(backend).toContain(
      "await assertWorkspacePreservesPublicSignupReservations(next)",
    );
    expect(backend).toContain("lockScope.assertOwned");
    expect(backend).not.toContain("slotDuration = 10 * 60 * 1000");
    expect(payments).toMatch(
      /withPublicSignupMutationLock = \(callback\) =>\s*withWorkspaceLocks\(\[WORKSPACE_MUTATION_LOCK_RESOURCE\], callback\)/,
    );
    expect(payments).toContain("mutationLockScope.assertOwned");
    expect(payments).toContain("paymentLockScope.assertOwned");
    expect(payments).toMatch(
      /\.filter\(\)\s*\.eq\("paymentId", lock\.storedOwnerValue \|\| paymentId\)\s*\.gt\("expiresAt", new Date\(lock\.mustBeValidAt\)\)/,
    );
    expect(payments).toMatch(
      /\.filter\(\)\s*\.eq\("paymentId", paymentId\)\s*\.le\("expiresAt", new Date\(lock\.expiresAt\)\)/,
    );
    expect(payments).toMatch(/await lockApi\.update\([\s\S]*?condition,/);
    expect(payments).toMatch(/await lockApi\.remove\([\s\S]*?condition,/);
    expect(payments).not.toContain("attempt <= 20");
    expect(payments).not.toContain("await wait(250)");
  });

  it("keeps login loadable without the optional conditional lock SDK", () => {
    const payments = readFileSync(
      new URL("../wix/backend/public-signup-payments.js", import.meta.url),
      "utf8",
    );
    const backend = readFileSync(
      new URL("../wix/backend/arena-data.web.js", import.meta.url),
      "utf8",
    );
    const lockAdapter = readFileSync(
      new URL("../wix/backend/conditional-lock-data.js", import.meta.url),
      "utf8",
    );

    expect(backend).toMatch(/export const getAdminAccess = webMethod\(/);
    expect(backend).toMatch(/export const authenticateContestant = webMethod\(/);
    expect(payments).not.toMatch(/^import .*["']@wix\/data["'];?$/m);
    expect(payments).toMatch(
      /conditionalLockApiPromise = import\("\.\/conditional-lock-data\.js"\)/,
    );
    expect(payments).not.toMatch(
      /import\("\.\/conditional-lock-data"\)/,
    );
    expect(lockAdapter).toMatch(
      /^import \{ items \} from "@wix\/data";$/m,
    );
  });

  it("fails protected mutations closed when the lock adapter is unavailable", () => {
    const payments = readFileSync(
      new URL("../wix/backend/public-signup-payments.js", import.meta.url),
      "utf8",
    );
    const resourceLockBoundary = payments.slice(
      payments.indexOf("const withResourceLocks ="),
      payments.indexOf(
        "export async function withPublicSignupCompetitionLocks",
      ),
    );

    expect(resourceLockBoundary).toMatch(
      /await loadConditionalLockApi\(\);\s+return resourceLockManager\.run/,
    );
    expect(payments).toContain(
      'code: "RESOURCE_LOCK_ADAPTER_UNAVAILABLE"',
    );
    expect(payments).toContain('dependency: "@wix/data"');
  });
});
