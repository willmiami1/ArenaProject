// Quota-safe distributed resource lock primitives.
//
// The previous implementation looped up to 20 times at a fixed 250ms interval
// and, on every failed insert, issued an extra get plus a possible remove. Under
// repeated live Workspace saves that produced roughly 40 Wix Data requests in
// ~5 seconds per contended save, which tripped WDE0014 (requests-per-minute
// quota) and the "Timed out waiting for a public signup resource lock" error.
//
// These helpers are intentionally pure and dependency-injected so they can be
// unit tested without the Wix runtime. The only atomic primitive we rely on is
// an insert against a deterministic `_id` (unique-key compare-and-set). Every
// lock carries an owner token so a release only ever deletes the record it
// created and can never delete a successor's valid lock.

export const DEFAULT_LOCK_LEASE_MS = 30 * 1000;
export const DEFAULT_LOCK_MAX_ATTEMPTS = 5;
export const DEFAULT_LOCK_BASE_DELAY_MS = 120;
export const DEFAULT_LOCK_MAX_DELAY_MS = 750;

export class ResourceLockError extends Error {
  constructor(
    message,
    {
      code = "RESOURCE_LOCK_TIMEOUT",
      resource,
      attempts,
      reason,
    } = {},
  ) {
    super(message);
    this.name = "ResourceLockError";
    this.code = code;
    this.resource = resource;
    this.attempts = attempts;
    this.reason = reason;
  }
}

export function orderedLockResources(resources) {
  return [...new Set(resources)].sort();
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function lockIsExpired(record, now) {
  if (!record) return true;
  return toMillis(record.expiresAt) <= now;
}

// Exponential backoff capped at maxMs, with 50%-100% jitter to avoid lockstep
// retries from concurrent invocations hammering the quota in unison.
export function computeLockBackoffMs(
  attempt,
  {
    baseMs = DEFAULT_LOCK_BASE_DELAY_MS,
    maxMs = DEFAULT_LOCK_MAX_DELAY_MS,
    random,
  } = {},
) {
  const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  const roll = typeof random === "function" ? random() : Math.random();
  return Math.round(exponential * (0.5 + 0.5 * roll));
}

async function safeGet(client, id) {
  try {
    return await client.get(id);
  } catch {
    return null;
  }
}

// Reclaim an expired lock without ever deleting a successor. We re-read the
// record immediately before removing it and only remove when it is still the
// same expired holder we observed. Ownership is then re-established through the
// atomic insert on the next loop iteration, never through a blind overwrite.
async function reclaimExpiredLock(client, id, observed) {
  const current = await safeGet(client, id);
  if (!current) return;
  if (current.owner !== observed.owner) return;
  if (!lockIsExpired(current, client.now())) return;
  await Promise.resolve(client.remove(id)).catch(() => undefined);
}

export async function acquireResourceLock(client, resource, options = {}) {
  const leaseMs = options.leaseMs ?? DEFAULT_LOCK_LEASE_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_LOCK_MAX_ATTEMPTS;
  const baseMs = options.baseDelayMs ?? DEFAULT_LOCK_BASE_DELAY_MS;
  const maxMs = options.maxDelayMs ?? DEFAULT_LOCK_MAX_DELAY_MS;
  const id = client.recordId(resource);
  const owner = client.newOwner();
  let reason = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const expiresAt = new Date(client.now() + leaseMs);
    try {
      await client.insert({
        _id: id,
        resource,
        paymentId: resource,
        owner,
        expiresAt,
      });
      return { id, owner, resource, expiresAt: expiresAt.getTime() };
    } catch {
      const existing = await safeGet(client, id);
      if (!existing) {
        reason = "transient-insert-failure";
      } else if (lockIsExpired(existing, client.now())) {
        reason = "expired-holder";
        await reclaimExpiredLock(client, id, existing);
      } else {
        reason = "active-holder";
      }
    }

    if (typeof client.onContended === "function") {
      client.onContended({ resource, attempt, maxAttempts, reason });
    }

    if (attempt < maxAttempts) {
      await client.wait(
        computeLockBackoffMs(attempt, {
          baseMs,
          maxMs,
          random: client.random,
        }),
      );
    }
  }

  throw new ResourceLockError(
    `Timed out acquiring lock for resource "${resource}" after ${maxAttempts} attempts (${reason}).`,
    { resource, attempts: maxAttempts, reason },
  );
}

export async function releaseResourceLock(client, lock) {
  if (!lock || !lock.id) return;
  const current = await safeGet(client, lock.id);
  if (!current) return;
  if (current.owner !== lock.owner) return;
  await Promise.resolve(client.remove(lock.id)).catch(() => undefined);
}

export async function withResourceLocks(
  client,
  resources,
  callback,
  options = {},
) {
  const ordered = orderedLockResources(resources);
  const acquired = [];
  try {
    for (const resource of ordered) {
      acquired.push(await acquireResourceLock(client, resource, options));
    }
    return await callback();
  } finally {
    for (const lock of acquired.reverse()) {
      await releaseResourceLock(client, lock);
    }
  }
}
