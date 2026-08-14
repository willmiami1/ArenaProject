const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const DEFAULT_RESOURCE_LOCK_OPTIONS = Object.freeze({
  leaseMs: 15000,
  renewIntervalMs: 4000,
  waitTimeoutMs: 20000,
  retryDelayMs: 500,
  maxRetryDelayMs: 3000,
  retryJitterRatio: 0.2,
  claimSettleMs: 50,
  ownershipCheckIntervalMs: 1000,
});

export const competitionLockResources = (resources) =>
  resources.map((resource) => `competition:${resource}`);

const expiresAtTime = (lock) => {
  const value =
    lock?.expiresAt instanceof Date
      ? lock.expiresAt.getTime()
      : Number(lock?.expiresAt);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const uniqueSortedResources = (resources) =>
  [...new Set(resources.map((resource) => String(resource)))].sort();

const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);

export class ResourceLockTimeoutError extends Error {
  constructor({ context, waitedMs, holderLeaseRemainingMs }) {
    super(
      `Timed out waiting for an arena resource lock ` +
        `(resource=${context.type}, lock=${context.lockId}, ` +
        `waitedMs=${waitedMs}, holderLeaseRemainingMs=${holderLeaseRemainingMs}).`,
    );
    this.name = "ResourceLockTimeoutError";
    this.code = "RESOURCE_LOCK_TIMEOUT";
    this.resourceType = context.type;
    this.lockId = context.lockId;
    this.waitedMs = waitedMs;
    this.holderLeaseRemainingMs = holderLeaseRemainingMs;
  }
}

export class ResourceLockOwnershipError extends Error {
  constructor(context, reason = "ownership changed") {
    super(
      `Arena resource lock ownership was lost ` +
        `(resource=${context.type}, lock=${context.lockId}, reason=${reason}).`,
    );
    this.name = "ResourceLockOwnershipError";
    this.code = "RESOURCE_LOCK_OWNERSHIP_LOST";
    this.resourceType = context.type;
    this.lockId = context.lockId;
  }
}

export class ResourceLockOrderError extends Error {
  constructor(context) {
    super(
      `Arena resource locks must be acquired in deterministic order ` +
        `(resource=${context.type}, lock=${context.lockId}).`,
    );
    this.name = "ResourceLockOrderError";
    this.code = "RESOURCE_LOCK_ORDER_VIOLATION";
    this.resourceType = context.type;
    this.lockId = context.lockId;
  }
}

export function createResourceLockManager({
  store,
  idForResource,
  createOwnerToken,
  describeResource = (_resource, id) => ({
    type: "resource",
    lockId: String(id).slice(0, 12),
  }),
  now = () => Date.now(),
  sleep = wait,
  random = Math.random,
  schedule = (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel = (timer) => clearTimeout(timer),
  options = {},
  onDiagnostic = () => undefined,
}) {
  const settings = { ...DEFAULT_RESOURCE_LOCK_OPTIONS, ...options };

  if (settings.waitTimeoutMs <= settings.leaseMs) {
    throw new Error("Resource lock waitTimeoutMs must exceed leaseMs.");
  }
  if (
    settings.renewIntervalMs <= 0 ||
    settings.renewIntervalMs >= settings.leaseMs
  ) {
    throw new Error("Resource lock renewIntervalMs must be below leaseMs.");
  }
  if (
    settings.retryDelayMs <= 0 ||
    settings.maxRetryDelayMs < settings.retryDelayMs
  ) {
    throw new Error(
      "Resource lock maxRetryDelayMs must be at least retryDelayMs.",
    );
  }
  if (
    settings.retryJitterRatio < 0 ||
    settings.retryJitterRatio > 1
  ) {
    throw new Error("Resource lock retryJitterRatio must be between 0 and 1.");
  }
  if (
    settings.ownershipCheckIntervalMs < 0 ||
    settings.ownershipCheckIntervalMs >= settings.leaseMs
  ) {
    throw new Error(
      "Resource lock ownershipCheckIntervalMs must be below leaseMs.",
    );
  }

  const contextFor = (resource, id = idForResource(resource)) =>
    describeResource(resource, id);

  const emit = (event, details) => onDiagnostic({ event, ...details });
  const jitteredRetryDelay = (delayMs, maximumMs) =>
    Math.min(
      Math.max(
        1,
        Math.round(
          delayMs *
            (1 + (random() * 2 - 1) * settings.retryJitterRatio),
        ),
      ),
      maximumMs,
    );

  async function removeExpiredLock(expected) {
    try {
      await store.remove(expected);
    } catch (error) {
      const current = await store.get(expected.id);
      if (
        !current ||
        current.ownerToken !== expected.ownerToken ||
        expiresAtTime(current) > expiresAtTime(expected)
      ) {
        return;
      }
      throw error;
    }
  }

  async function acquireLock(scope, resource, startedAt) {
    const id = idForResource(resource);
    let lastHolder = null;
    let pollOnly = false;
    let retryDelayMs = settings.retryDelayMs;

    while (now() - startedAt < settings.waitTimeoutMs) {
      if (pollOnly) {
        const existing = await store.get(id);
        if (!existing) {
          pollOnly = false;
        } else if (existing.ownerToken === scope.ownerToken) {
          return existing;
        } else {
          lastHolder = existing;
          if (expiresAtTime(existing) <= now()) {
            await removeExpiredLock(existing);
            pollOnly = false;
          }
        }
      } else {
        const candidate = {
          id,
          resource,
          ownerToken: scope.ownerToken,
          expiresAt: now() + settings.leaseMs,
        };
        try {
          await store.insert(candidate);
          if (settings.claimSettleMs > 0) {
            await sleep(settings.claimSettleMs);
          }
          const confirmed = await store.get(id);
          if (confirmed?.ownerToken === scope.ownerToken) {
            return confirmed;
          }
          lastHolder = confirmed;
          pollOnly =
            Boolean(confirmed) && expiresAtTime(confirmed) > now();
          emit("claim-displaced-before-use", {
            resource: contextFor(resource, id),
          });
        } catch (insertError) {
          const existing = await store.get(id);
          if (!existing) throw insertError;
          if (existing.ownerToken === scope.ownerToken) return existing;
          lastHolder = existing;
          if (expiresAtTime(existing) <= now()) {
            await removeExpiredLock(existing);
          } else {
            pollOnly = true;
          }
        }
      }

      if (!pollOnly) continue;
      const remainingMs = settings.waitTimeoutMs - (now() - startedAt);
      if (remainingMs > 0) {
        await sleep(
          Math.min(
            jitteredRetryDelay(
              retryDelayMs,
              settings.maxRetryDelayMs,
            ),
            remainingMs,
          ),
        );
        retryDelayMs = Math.min(
          retryDelayMs * 2,
          settings.maxRetryDelayMs,
        );
      }
    }

    const waitedMs = now() - startedAt;
    const holderExpiresAt = expiresAtTime(lastHolder);
    throw new ResourceLockTimeoutError({
      context: contextFor(resource, id),
      waitedMs,
      holderLeaseRemainingMs: Number.isFinite(holderExpiresAt)
        ? Math.max(0, Math.ceil(holderExpiresAt - now()))
        : 0,
    });
  }

  async function assertLockOwned(scope, lock) {
    const current = await store.get(lock.id);
    if (current?.ownerToken !== scope.ownerToken) {
      throw new ResourceLockOwnershipError(
        contextFor(lock.resource, lock.id),
      );
    }
    if (expiresAtTime(current) <= now()) {
      throw new ResourceLockOwnershipError(
        contextFor(lock.resource, lock.id),
        "lease expired",
      );
    }
    scope.locks.set(lock.resource, current);
    scope.confirmedAt.set(lock.resource, now());
  }

  async function releaseLock(scope, lock) {
    try {
      await store.remove(lock);
    } catch (error) {
      const afterFailure = await store.get(lock.id);
      if (!afterFailure || afterFailure.ownerToken !== scope.ownerToken) {
        if (afterFailure) {
          emit("release-skipped-not-owner", {
            resource: contextFor(lock.resource, lock.id),
          });
        }
        return;
      }
      throw error;
    }
  }

  const queueScopeOperation = (scope, operation) => {
    const result = scope.operation.then(operation, operation);
    scope.operation = result.catch(() => undefined);
    return result;
  };

  async function renewScope(scope) {
    const locks = [...scope.locks.values()].sort((left, right) =>
      left.resource.localeCompare(right.resource),
    );
    for (const lock of locks) {
      const renewalStartedAt = now();
      let renewed;
      try {
        renewed = await store.update({
          ...lock,
          expiresAt: renewalStartedAt + settings.leaseMs,
          mustBeValidAt: renewalStartedAt,
        });
      } catch (error) {
        const current = await store.get(lock.id);
        if (
          current?.ownerToken !== scope.ownerToken ||
          expiresAtTime(current) <= now()
        ) {
          throw new ResourceLockOwnershipError(
            contextFor(lock.resource, lock.id),
            "lease could not be renewed",
          );
        }
        throw error;
      }
      if (renewed?.ownerToken !== scope.ownerToken) {
        throw new ResourceLockOwnershipError(
          contextFor(lock.resource, lock.id),
          "renewal was displaced",
        );
      }
      scope.locks.set(lock.resource, renewed);
      scope.confirmedAt.set(lock.resource, now());
    }
  }

  const scheduleRenewal = (scope, delay = settings.renewIntervalMs) => {
    if (scope.stopping || scope.timer || scope.locks.size === 0) return;
    scope.timer = schedule(() => {
      scope.timer = null;
      const renewal = queueScopeOperation(scope, () => renewScope(scope));
      scope.renewal = renewal.then(
        () => {
          scope.renewalFailed = false;
          scope.renewalRetryDelayMs = settings.retryDelayMs;
        },
        (error) => {
          scope.renewalFailed = true;
          if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") {
            scope.lostError = error;
          }
          emit("renewal-failed", {
            message: errorMessage(error),
          });
        },
      ).finally(() => {
        scope.renewal = null;
        let nextDelayMs = settings.renewIntervalMs;
        if (scope.renewalFailed) {
          nextDelayMs = jitteredRetryDelay(
            scope.renewalRetryDelayMs,
            Math.min(
              settings.maxRetryDelayMs,
              settings.renewIntervalMs,
            ),
          );
          scope.renewalRetryDelayMs = Math.min(
            scope.renewalRetryDelayMs * 2,
            settings.maxRetryDelayMs,
          );
        }
        scheduleRenewal(scope, nextDelayMs);
      });
    }, delay);
  };

  async function stopRenewal(scope) {
    scope.stopping = true;
    if (scope.timer) {
      cancel(scope.timer);
      scope.timer = null;
    }
    if (scope.renewal) await scope.renewal;
    await scope.operation;
  }

  async function assertScopeOwned(scope) {
    if (scope.lostError) throw scope.lostError;
    await queueScopeOperation(scope, async () => {
      for (const lock of scope.locks.values()) {
        const checkedAt = now();
        const lastConfirmedAt = scope.confirmedAt.get(lock.resource) || 0;
        if (
          settings.ownershipCheckIntervalMs === 0 ||
          checkedAt - lastConfirmedAt >= settings.ownershipCheckIntervalMs ||
          expiresAtTime(lock) <= checkedAt
        ) {
          await assertLockOwned(scope, lock);
        }
      }
    });
    if (scope.lostError) throw scope.lostError;
  }

  async function releaseLocks(scope, locks) {
    let firstError = null;
    for (const lock of [...locks].reverse()) {
      try {
        await queueScopeOperation(scope, () =>
          releaseLock(scope, scope.locks.get(lock.resource) || lock),
        );
      } catch (error) {
        firstError ||= error;
        emit("release-failed", {
          resource: contextFor(lock.resource, lock.id),
          message: errorMessage(error),
        });
      } finally {
        scope.locks.delete(lock.resource);
        scope.confirmedAt.delete(lock.resource);
      }
    }
    if (firstError) throw firstError;
  }

  async function runInScope(scope, resources, callback, root = false) {
    const requested = uniqueSortedResources(resources);
    const missing = requested.filter((resource) => !scope.locks.has(resource));
    const held = [...scope.locks.keys()].sort();
    const highestHeld = held[held.length - 1];
    if (highestHeld && missing.some((resource) => resource < highestHeld)) {
      const resource = missing.find((item) => item < highestHeld);
      throw new ResourceLockOrderError(contextFor(resource));
    }

    const acquiredHere = [];
    let result;
    let callbackError = null;
    let ownershipError = null;
    let cleanupError = null;
    const acquisitionStartedAt = now();

    try {
      for (const resource of missing) {
        const lock = await acquireLock(scope, resource, acquisitionStartedAt);
        scope.locks.set(resource, lock);
        scope.confirmedAt.set(resource, now());
        acquiredHere.push(lock);
        scheduleRenewal(scope);
      }
      await assertScopeOwned(scope);
      result = await callback(scope.api);
    } catch (error) {
      callbackError = error;
    }

    if (!callbackError) {
      try {
        await assertScopeOwned(scope);
      } catch (error) {
        ownershipError = error;
      }
    }
    if (root) await stopRenewal(scope);
    try {
      await releaseLocks(scope, acquiredHere);
    } catch (error) {
      cleanupError = error;
    }

    if (callbackError) {
      if (cleanupError) {
        emit("callback-and-cleanup-failed", {
          callbackMessage: errorMessage(callbackError),
          cleanupMessage: errorMessage(cleanupError),
        });
      }
      throw callbackError;
    }
    if (ownershipError) throw ownershipError;
    if (cleanupError) throw cleanupError;
    return result;
  }

  return {
    run(resources, callback) {
      const scope = {
        ownerToken: createOwnerToken(),
        locks: new Map(),
        confirmedAt: new Map(),
        operation: Promise.resolve(),
        renewal: null,
        renewalFailed: false,
        renewalRetryDelayMs: settings.retryDelayMs,
        lostError: null,
        timer: null,
        stopping: false,
        api: null,
      };
      scope.api = {
        run: (nestedResources, nestedCallback) =>
          runInScope(scope, nestedResources, nestedCallback),
        assertOwned: () => assertScopeOwned(scope),
      };
      return runInScope(scope, resources, callback, true);
    },
  };
}
