import wixData from "wix-data";
import { collections } from "wix-data.v2";
import { elevate } from "wix-auth";
import wixPayBackend from "wix-pay-backend";
import { contacts, triggeredEmails } from "wix-crm-backend";
import { secrets } from "wix-secrets-backend.v2";
import { createHash, randomBytes } from "crypto";
import {
  PUBLIC_SIGNUP_ENTRY_RESERVATION_MINUTES,
  PUBLIC_SIGNUP_CARD_METHOD,
  PUBLIC_SIGNUP_CASH_METHOD,
  PUBLIC_SIGNUP_PRICE_USD,
  PUBLIC_SIGNUP_SESSION_MINUTES,
  PublicSignupError,
  assertCashSubmissionHasNoActiveCardPayment,
  assertPublicSignupIntentPaymentMethod,
  assertPublicSignupSessionActive,
  assertPublicSignupTokenFormat,
  assertRoundRobinRoleCapacity,
  assertWorkspaceSupportsActivePublicSignupReservations,
  buildPublicSignupRecords,
  buildPublicSignupOptions,
  normalizePublicSignupSelections,
  publicSignupCashConfirmation,
  publicSignupFingerprintPayload,
  publicSignupIntentPaymentMethod,
  publicSignupPaymentCreatedIntentIsStale,
  roundRobinReservationEntries,
  roundRobinReservationOccupiesRole,
  storedPublicSignupSelectionsForRetry,
} from "./public-signup-contract";
import {
  buildOwnerPaymentNotification,
  deliverOwnerPaymentNotification,
} from "./public-signup-owner-notification";
import {
  competitionLockResources,
  createResourceLockManager,
} from "./resource-lock-contract";

const OPTIONS = { suppressAuth: true, consistentRead: true };
const LOCK_OPTIONS = { ...OPTIONS, suppressHooks: true };
const COLLECTIONS = {
  events: "ArenaCompetitions",
  contestants: "ArenaContestants",
  teams: "ArenaTeams",
  registrations: "ArenaRegistrations",
};
const SETTINGS_COLLECTION = "ArenaSettings";
const ONLINE_REVISION_ID = "arena-command-online-revision";
const SIGNUP_SESSIONS_COLLECTION = "ArenaPublicSignupSessions";
const PAYMENT_INTENTS_COLLECTION = "ArenaPublicSignupPaymentIntents";
const ENTRY_RESERVATIONS_COLLECTION = "ArenaPublicSignupEntryReservations";
const PAYMENT_LOCKS_COLLECTION = "ArenaPublicSignupPaymentLocks";
const OWNER_NOTIFICATIONS_COLLECTION = "ArenaOwnerPaymentNotifications";
const OWNER_EMAIL = "willmiami1@gmail.com";
const OWNER_TRIGGERED_EMAIL_SECRET = "ArenaOwnerPaymentTriggeredEmailId";
export const WORKSPACE_MUTATION_LOCK_RESOURCE = "arena-workspace-mutation";
const VALID_APP_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const SECURITY_WRITE_ATTEMPTS = 3;
const PENDING_RESERVATION_MINUTES = 24 * 60;
const ACTIVE_PAYMENT_STATUSES = new Set([
  "payment-created",
  "pending",
  "settling",
]);
const getSecretValue = elevate(secrets.getSecretValue);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const storageId = (namespace, value) =>
  hash(`${namespace}:${value}`).slice(0, 32);

const publicError = (code, message) => new PublicSignupError(code, message);

const LOCK_RECORD_PREFIX = "arena-resource-lock-v2:";
const LOCK_HEARTBEAT_PREFIX = "arena-resource-lock-heartbeat-v1:";
const LOCK_RECLAIM_PREFIX = "arena-resource-lock-reclaim-v1:";
const LOCK_RECLAIM_GUARD_MS = 10000;
const LOCK_RECLAIM_SETTLE_MS = 100;

const encodeLockOwner = (resource, ownerToken) =>
  `${LOCK_RECORD_PREFIX}${JSON.stringify([resource, ownerToken])}`;

function decodeLockRecord(item) {
  if (!item) return null;
  const storedOwnerValue = String(item.paymentId || "");
  let resource = storedOwnerValue;
  let ownerToken = "";
  if (resource.startsWith(LOCK_RECORD_PREFIX)) {
    try {
      const decoded = JSON.parse(resource.slice(LOCK_RECORD_PREFIX.length));
      if (
        Array.isArray(decoded) &&
        typeof decoded[0] === "string" &&
        typeof decoded[1] === "string"
      ) {
        [resource, ownerToken] = decoded;
      }
    } catch (error) {
      console.error("Arena resource lock metadata could not be decoded.", {
        lockId: String(item._id || "").slice(0, 12),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    id: item._id,
    resource,
    ownerToken,
    expiresAt: new Date(item.expiresAt).getTime(),
    storedOwnerValue,
  };
}

function decodeLockHeartbeat(item) {
  if (!item) return null;
  const storedValue = String(item.paymentId || "");
  if (!storedValue.startsWith(LOCK_HEARTBEAT_PREFIX)) return null;
  try {
    const decoded = JSON.parse(
      storedValue.slice(LOCK_HEARTBEAT_PREFIX.length),
    );
    if (
      Array.isArray(decoded) &&
      typeof decoded[0] === "string" &&
      typeof decoded[1] === "string" &&
      typeof decoded[2] === "string"
    ) {
      return {
        id: item._id,
        lockId: decoded[0],
        resource: decoded[1],
        ownerToken: decoded[2],
        expiresAt: new Date(item.expiresAt).getTime(),
      };
    }
  } catch (error) {
    console.error("Arena resource lock heartbeat could not be decoded.", {
      lockId: String(item._id || "").slice(0, 12),
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

function decodeReclaimClaim(item) {
  if (!item) return null;
  const storedValue = String(item.paymentId || "");
  if (!storedValue.startsWith(LOCK_RECLAIM_PREFIX)) return null;
  const fields = storedValue.slice(LOCK_RECLAIM_PREFIX.length).split(":");
  if (
    fields.length !== 5 ||
    fields.some((field) => !field) ||
    !Number.isFinite(Number(fields[2])) ||
    !Number.isFinite(Number(fields[3]))
  ) {
    return null;
  }
  return {
    id: item._id,
    lockId: fields[0],
    expectedOwnerToken: fields[1],
    expectedExpiresAt: Number(fields[2]),
    bucket: Number(fields[3]),
    claimantToken: fields[4],
    expiresAt: new Date(item.expiresAt).getTime(),
    createdAt: new Date(item._createdDate || 0).getTime(),
  };
}

const lockStoreConditionFailure = (operation) => {
  const error = new Error(`Arena resource lock ${operation} ownership changed.`);
  error.code = "RESOURCE_LOCK_STORE_CONDITION_FAILED";
  return error;
};

const lockReclaimBusy = () => {
  const error = new Error("Arena resource lock reclaim is already in progress.");
  error.code = "RESOURCE_LOCK_RECLAIM_BUSY";
  return error;
};

const storedLockItem = (lock) => ({
  _id: lock.id,
  paymentId:
    lock.storedOwnerValue ||
    encodeLockOwner(lock.resource, lock.ownerToken),
  expiresAt: new Date(lock.expiresAt),
});

const lockHeartbeatId = (lock) =>
  storageId(
    "public-signup-resource-lock-heartbeat",
    `${lock.id}:${lock.ownerToken}`,
  );

const storedLockHeartbeat = (lock) => ({
  _id: lockHeartbeatId(lock),
  paymentId: `${LOCK_HEARTBEAT_PREFIX}${JSON.stringify([
    lock.id,
    lock.resource,
    lock.ownerToken,
  ])}`,
  expiresAt: new Date(lock.expiresAt),
});

async function readStoredItem(id) {
  try {
    return await wixData.get(PAYMENT_LOCKS_COLLECTION, id, LOCK_OPTIONS);
  } catch (error) {
    if (error?.code === "WDE0073") return null;
    throw error;
  }
}

const reclaimClaimPrefix = (lockId) =>
  `${LOCK_RECLAIM_PREFIX}${lockId}:`;

async function readActiveReclaimClaims(lockId) {
  const result = await wixData
    .query(PAYMENT_LOCKS_COLLECTION)
    .startsWith("paymentId", reclaimClaimPrefix(lockId))
    .gt("expiresAt", new Date())
    .limit(100)
    .find(OPTIONS);
  return result.items
    .map(decodeReclaimClaim)
    .filter(
      (claim) =>
        claim?.lockId === lockId &&
        Number.isFinite(claim.expiresAt) &&
        claim.expiresAt > Date.now(),
    )
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id),
    );
}

async function readStoredLockRecord(id, includeReclaimClaims) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const lock = decodeLockRecord(await readStoredItem(id));
    if (!lock?.ownerToken) return lock;
    const heartbeat = decodeLockHeartbeat(
      await readStoredItem(lockHeartbeatId(lock)),
    );
    const confirmed = decodeLockRecord(await readStoredItem(id));
    if (!sameStoredLockOwner(confirmed, lock)) continue;
    const reclaimClaims = includeReclaimClaims
      ? await readActiveReclaimClaims(lock.id)
      : [];
    const finalSentinel = decodeLockRecord(await readStoredItem(id));
    if (!sameStoredLockOwner(finalSentinel, lock)) continue;
    if (
      heartbeat?.lockId === lock.id &&
      heartbeat.resource === lock.resource &&
      heartbeat.ownerToken === lock.ownerToken &&
      Number.isFinite(heartbeat.expiresAt)
    ) {
      lock.expiresAt = Math.max(lock.expiresAt, heartbeat.expiresAt);
    }
    if (reclaimClaims.length > 0) lock.reclaiming = true;
    return lock;
  }
  const unstable = decodeLockRecord(await readStoredItem(id));
  return unstable ? { ...unstable, reclaiming: true } : null;
}

const readStoredLock = (id) => readStoredLockRecord(id, true);

const sameStoredLockOwner = (current, expected) =>
  Boolean(current) &&
  current.ownerToken === expected.ownerToken &&
  current.resource === expected.resource &&
  current.storedOwnerValue ===
    (expected.storedOwnerValue ||
      encodeLockOwner(expected.resource, expected.ownerToken));

const sameLockHeartbeatOwner = (heartbeat, lock) =>
  Boolean(heartbeat) &&
  heartbeat.lockId === lock.id &&
  heartbeat.resource === lock.resource &&
  heartbeat.ownerToken === lock.ownerToken;

async function writeLockHeartbeat(lock) {
  const heartbeatItem = storedLockHeartbeat(lock);
  const existing = await readStoredItem(heartbeatItem._id);
  if (existing) {
    if (!sameLockHeartbeatOwner(decodeLockHeartbeat(existing), lock)) {
      throw lockStoreConditionFailure("renewal");
    }
    await wixData.update(
      PAYMENT_LOCKS_COLLECTION,
      heartbeatItem,
      LOCK_OPTIONS,
    );
    return;
  }
  try {
    await wixData.insert(
      PAYMENT_LOCKS_COLLECTION,
      heartbeatItem,
      LOCK_OPTIONS,
    );
  } catch (error) {
    const raced = decodeLockHeartbeat(
      await readStoredItem(heartbeatItem._id),
    );
    if (!sameLockHeartbeatOwner(raced, lock)) throw error;
    await wixData.update(
      PAYMENT_LOCKS_COLLECTION,
      heartbeatItem,
      LOCK_OPTIONS,
    );
  }
}

async function removeLockHeartbeat(lock) {
  const heartbeatId = lockHeartbeatId(lock);
  const heartbeat = decodeLockHeartbeat(await readStoredItem(heartbeatId));
  if (!sameLockHeartbeatOwner(heartbeat, lock)) return;
  try {
    await wixData.remove(
      PAYMENT_LOCKS_COLLECTION,
      heartbeatId,
      LOCK_OPTIONS,
    );
  } catch (error) {
    if (await readStoredItem(heartbeatId)) throw error;
  }
}

async function removeOrphanedLockHeartbeat(lock) {
  const sentinel = decodeLockRecord(await readStoredItem(lock.id));
  if (sameStoredLockOwner(sentinel, lock)) return;
  await removeLockHeartbeat(lock);
}

const storedReclaimClaim = (lock, claimantToken, claimedAt) => {
  const bucket = Math.floor(claimedAt / LOCK_RECLAIM_GUARD_MS);
  return {
    _id: storageId(
      "public-signup-resource-lock-reclaim",
      `${lock.id}:${lock.ownerToken}:${lock.expiresAt}:${bucket}`,
    ),
    paymentId: `${reclaimClaimPrefix(lock.id)}${lock.ownerToken}:${lock.expiresAt}:${bucket}:${claimantToken}`,
    expiresAt: new Date(claimedAt + LOCK_RECLAIM_GUARD_MS),
  };
};

async function acquireReclaimClaim(lock) {
  const claimantToken = randomBytes(16).toString("hex");
  const candidate = storedReclaimClaim(lock, claimantToken, Date.now());
  try {
    await wixData.insert(
      PAYMENT_LOCKS_COLLECTION,
      candidate,
      LOCK_OPTIONS,
    );
  } catch (error) {
    if (!(await readStoredItem(candidate._id))) throw error;
  }
  await wait(LOCK_RECLAIM_SETTLE_MS);
  const winner = (await readActiveReclaimClaims(lock.id))[0];
  if (
    winner?.id !== candidate._id ||
    winner.claimantToken !== claimantToken
  ) {
    const ownClaim = decodeReclaimClaim(
      await readStoredItem(candidate._id),
    );
    if (ownClaim?.claimantToken === claimantToken) {
      await removeReclaimClaim(ownClaim);
    }
    return null;
  }
  return winner;
}

async function assertReclaimClaimOwned(claim) {
  const winner = (await readActiveReclaimClaims(claim.lockId))[0];
  if (
    winner?.id !== claim.id ||
    winner.claimantToken !== claim.claimantToken
  ) {
    throw lockReclaimBusy();
  }
}

async function restoreReclaimClaim(item) {
  try {
    await wixData.insert(
      PAYMENT_LOCKS_COLLECTION,
      {
        _id: item._id,
        paymentId: item.paymentId,
        expiresAt: item.expiresAt,
      },
      LOCK_OPTIONS,
    );
  } catch (error) {
    if (await readStoredItem(item._id)) return;
    throw error;
  }
}

async function removeReclaimClaim(claim) {
  const existing = await readStoredItem(claim.id);
  const decoded = decodeReclaimClaim(existing);
  if (decoded?.claimantToken !== claim.claimantToken) return;
  const removed = await wixData.remove(
    PAYMENT_LOCKS_COLLECTION,
    claim.id,
    LOCK_OPTIONS,
  );
  if (decodeReclaimClaim(removed)?.claimantToken !== claim.claimantToken) {
    await restoreReclaimClaim(removed);
    throw lockReclaimBusy();
  }
}

async function installSentinelWhileClaimed(target, claim) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    await assertReclaimClaimOwned(claim);
    const existing = decodeLockRecord(await readStoredItem(target.id));
    if (sameStoredLockOwner(existing, target)) return existing;
    if (existing) {
      const removed = decodeLockRecord(
        await wixData.remove(
          PAYMENT_LOCKS_COLLECTION,
          target.id,
          LOCK_OPTIONS,
        ),
      );
      if (removed) await removeLockHeartbeat(removed);
    }
    await assertReclaimClaimOwned(claim);
    try {
      return decodeLockRecord(
        await wixData.insert(
          PAYMENT_LOCKS_COLLECTION,
          storedLockItem(target),
          LOCK_OPTIONS,
        ),
      );
    } catch (error) {
      if (!(await readStoredItem(target.id))) throw error;
    }
  }
  throw lockReclaimBusy();
}

async function restoreRacedLock(removed) {
  try {
    await wixData.insert(
      PAYMENT_LOCKS_COLLECTION,
      storedLockItem(removed),
      LOCK_OPTIONS,
    );
  } catch (error) {
    if (await readStoredLock(removed.id)) return;
    throw error;
  }
}

async function removeExpiredLockWithClaim(lock, current) {
  const claim = await acquireReclaimClaim(lock);
  if (!claim) throw lockReclaimBusy();
  try {
    const guardedCurrent = await readStoredLockRecord(lock.id, false);
    if (
      !sameStoredLockOwner(guardedCurrent, lock) ||
      guardedCurrent.expiresAt > lock.expiresAt
    ) {
      throw lockStoreConditionFailure("removal");
    }
    await assertReclaimClaimOwned(claim);
    const removed = decodeLockRecord(
      await wixData.remove(PAYMENT_LOCKS_COLLECTION, lock.id, LOCK_OPTIONS),
    );
    if (!sameStoredLockOwner(removed, lock)) {
      if (removed) await installSentinelWhileClaimed(removed, claim);
      throw lockStoreConditionFailure("removal");
    }
    const heartbeatAfterRemoval = decodeLockHeartbeat(
      await readStoredItem(lockHeartbeatId(lock)),
    );
    if (
      sameLockHeartbeatOwner(heartbeatAfterRemoval, lock) &&
      heartbeatAfterRemoval.expiresAt > current.expiresAt
    ) {
      await installSentinelWhileClaimed(removed, claim);
      throw lockStoreConditionFailure("removal");
    }
    await removeLockHeartbeat(lock);
    return { ...removed, expiresAt: guardedCurrent.expiresAt };
  } finally {
    await removeReclaimClaim(claim);
  }
}

// Built-in wix-data avoids a site-package dependency. Deterministic inserts
// claim atomically. Owner-specific heartbeats isolate renewals, while short-lived
// reclaim claims block callback entry during remove/restore arbitration.
const resourceLockStore = {
  async insert(lock) {
    return decodeLockRecord(
      await wixData.insert(
        PAYMENT_LOCKS_COLLECTION,
        storedLockItem(lock),
        LOCK_OPTIONS,
      ),
    );
  },
  get: readStoredLock,
  async update(lock) {
    const current = await readStoredLock(lock.id);
    if (
      current?.reclaiming ||
      !sameStoredLockOwner(current, lock) ||
      current.expiresAt <= lock.mustBeValidAt
    ) {
      throw lockStoreConditionFailure("renewal");
    }
    await writeLockHeartbeat(lock);
    const renewed = await readStoredLock(lock.id);
    if (
      !sameStoredLockOwner(renewed, lock) ||
      renewed.expiresAt < lock.expiresAt
    ) {
      await removeOrphanedLockHeartbeat(lock);
      throw lockStoreConditionFailure("renewal");
    }
    return renewed;
  },
  async remove(lock) {
    const current = await readStoredLock(lock.id);
    if (current?.reclaiming) throw lockReclaimBusy();
    if (
      !sameStoredLockOwner(current, lock) ||
      current.expiresAt > lock.expiresAt
    ) {
      throw lockStoreConditionFailure("removal");
    }
    if (current.expiresAt <= Date.now()) {
      return removeExpiredLockWithClaim(lock, current);
    }
    const removed = decodeLockRecord(
      await wixData.remove(PAYMENT_LOCKS_COLLECTION, lock.id, LOCK_OPTIONS),
    );
    if (
      !sameStoredLockOwner(removed, lock) ||
      removed.expiresAt > lock.expiresAt
    ) {
      if (removed) await restoreRacedLock(removed);
      throw lockStoreConditionFailure("removal");
    }
    await removeLockHeartbeat(lock);
    return { ...removed, expiresAt: current.expiresAt };
  },
};

function safeLockResourceContext(resource, id) {
  let type = "resource";
  if (resource === "competition:arena-workspace-mutation") {
    type = "workspace";
  } else if (resource.startsWith("competition:revision-")) {
    type = "revision";
  } else if (resource.startsWith("competition:contestant-email-")) {
    type = "contestant-email";
  } else if (
    resource.startsWith("competition:contestant-") ||
    resource.startsWith("contestant:")
  ) {
    type = "contestant";
  } else if (resource.startsWith("competition:")) {
    type = "competition";
  } else if (resource.startsWith("payment:")) {
    type = "payment";
  }
  return { type, lockId: String(id).slice(0, 12) };
}

const resourceLockManager = createResourceLockManager({
  store: resourceLockStore,
  idForResource: (resource) =>
    storageId("public-signup-resource-lock", resource),
  createOwnerToken: () => randomBytes(16).toString("hex"),
  describeResource: safeLockResourceContext,
  onDiagnostic: ({ event, resource, message }) => {
    console.error("Arena resource lock diagnostic.", {
      event,
      resourceType: resource?.type || "",
      lockId: resource?.lockId || "",
      message: message || "",
    });
  },
});

const _verifiedCollections = new Set();

async function ensureCollection(collectionId, displayName, fields) {
  if (_verifiedCollections.has(collectionId)) return;
  try {
    await wixData.query(collectionId).limit(1).find(OPTIONS);
    _verifiedCollections.add(collectionId);
  } catch (error) {
    if (
      error?.code !== "WDE0025" &&
      error?.code !== "WDE0026" &&
      error?.code !== "WD_SCHEMA_DOES_NOT_EXIST"
    ) {
      throw error;
    }
    const createCollection = elevate(collections.createDataCollection);
    try {
      await createCollection({
        _id: collectionId,
        displayName,
        permissions: {
          read: "ADMIN",
          insert: "ADMIN",
          update: "ADMIN",
          remove: "ADMIN",
        },
        fields,
      });
      _verifiedCollections.add(collectionId);
    } catch (createError) {
      try {
        await wixData.query(collectionId).limit(1).find(OPTIONS);
        _verifiedCollections.add(collectionId);
      } catch {
        throw createError;
      }
    }
  }
}

async function ensurePublicSignupCollections() {
  await Promise.all([
    ensureCollection(
      SIGNUP_SESSIONS_COLLECTION,
      "Arena Public Signup Sessions",
      [
        { key: "contestantId", displayName: "Contestant ID", type: "TEXT" },
        { key: "expiresAt", displayName: "Expires At", type: "DATETIME" },
        { key: "createdAt", displayName: "Created At", type: "DATETIME" },
      ],
    ),
    ensureCollection(
      PAYMENT_INTENTS_COLLECTION,
      "Arena Public Signup Payment Intents",
      [
        { key: "contestantId", displayName: "Contestant ID", type: "TEXT" },
        { key: "submissionId", displayName: "Submission ID", type: "TEXT" },
        { key: "fingerprint", displayName: "Fingerprint", type: "TEXT" },
        { key: "paymentId", displayName: "Wix Payment ID", type: "TEXT" },
        { key: "transactionId", displayName: "Transaction ID", type: "TEXT" },
        { key: "status", displayName: "Status", type: "TEXT" },
        { key: "paymentMethod", displayName: "Payment Method", type: "TEXT" },
        { key: "amount", displayName: "Amount", type: "NUMBER" },
        { key: "currency", displayName: "Currency", type: "TEXT" },
        {
          key: "competitionIds",
          displayName: "Competition IDs",
          type: "TEXT",
        },
        { key: "selections", displayName: "Selections", type: "TEXT" },
        { key: "createdAt", displayName: "Created At", type: "DATETIME" },
        { key: "updatedAt", displayName: "Updated At", type: "DATETIME" },
        { key: "finalizedAt", displayName: "Finalized At", type: "DATETIME" },
      ],
    ),
    ensureCollection(
      ENTRY_RESERVATIONS_COLLECTION,
      "Arena Public Signup Entry Reservations",
      [
        { key: "intentId", displayName: "Intent ID", type: "TEXT" },
        { key: "contestantId", displayName: "Contestant ID", type: "TEXT" },
        { key: "competitionId", displayName: "Competition ID", type: "TEXT" },
        { key: "participantIds", displayName: "Participant IDs", type: "TEXT" },
        { key: "partnershipKey", displayName: "Partnership Key", type: "TEXT" },
        { key: "expiresAt", displayName: "Expires At", type: "DATETIME" },
        { key: "createdAt", displayName: "Created At", type: "DATETIME" },
      ],
    ),
    ensureCollection(
      PAYMENT_LOCKS_COLLECTION,
      "Arena Public Signup Payment Locks",
      [
        { key: "paymentId", displayName: "Payment ID", type: "TEXT" },
        { key: "expiresAt", displayName: "Expires At", type: "DATETIME" },
      ],
    ),
    ensureCollection(
      OWNER_NOTIFICATIONS_COLLECTION,
      "Arena Owner Payment Notifications",
      [
        { key: "intentId", displayName: "Payment Intent ID", type: "TEXT" },
        { key: "paymentId", displayName: "Wix Payment ID", type: "TEXT" },
        { key: "submissionId", displayName: "Submission ID", type: "TEXT" },
        { key: "status", displayName: "Notification Status", type: "TEXT" },
        { key: "attempts", displayName: "Delivery Attempts", type: "NUMBER" },
        { key: "error", displayName: "Last Error", type: "TEXT" },
        { key: "lastAttemptAt", displayName: "Last Attempt At", type: "DATETIME" },
        { key: "notifiedAt", displayName: "Notified At", type: "DATETIME" },
        { key: "createdAt", displayName: "Created At", type: "DATETIME" },
        { key: "updatedAt", displayName: "Updated At", type: "DATETIME" },
      ],
    ),
  ]);
}

async function readAll(collectionId) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const items = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.map((item) =>
    typeof item.payload === "string" ? JSON.parse(item.payload) : item.payload,
  );
}

async function readWorkspace() {
  const [events, contestants, teams, registrations] = await Promise.all([
    readAll(COLLECTIONS.events),
    readAll(COLLECTIONS.contestants),
    readAll(COLLECTIONS.teams),
    readAll(COLLECTIONS.registrations),
  ]);
  return { events, contestants, teams, registrations };
}

const noLockFence = async () => undefined;

async function updateWithRetry(
  collectionId,
  item,
  context,
  assertLockOwned = noLockFence,
) {
  let lastError;
  for (let attempt = 1; attempt <= SECURITY_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await assertLockOwned();
      return await wixData.update(collectionId, item, OPTIONS);
    } catch (error) {
      if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
      lastError = error;
      console.error("Public signup metadata update failed.", {
        context,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw lastError;
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const withResourceLocks = async (resources, callback) => {
  return resourceLockManager.run(resources, callback);
};

export async function withPublicSignupCompetitionLocks(
  competitionIds,
  callback,
) {
  await ensurePublicSignupCollections();
  return withResourceLocks(
    competitionLockResources(competitionIds),
    callback,
  );
}

async function ensureLockCollection() {
  await ensureCollection(
    PAYMENT_LOCKS_COLLECTION,
    "Arena Public Signup Payment Locks",
    [
      { key: "paymentId", displayName: "Payment ID", type: "TEXT" },
      { key: "expiresAt", displayName: "Expires At", type: "DATETIME" },
    ],
  );
}

export async function withWorkspaceLocks(resources, callback) {
  await ensureLockCollection();
  return withResourceLocks(competitionLockResources(resources), callback);
}

const withPublicSignupMutationLock = (callback) =>
  withWorkspaceLocks([WORKSPACE_MUTATION_LOCK_RESOURCE], callback);

async function getSignupSession(signupToken) {
  assertPublicSignupTokenFormat(signupToken);
  await ensurePublicSignupCollections();
  const session = await wixData
    .get(
      SIGNUP_SESSIONS_COLLECTION,
      storageId("public-signup-session", signupToken),
      OPTIONS,
    )
    .catch(() => null);
  assertPublicSignupSessionActive(session);
  return session;
}

export async function createPublicSignupSession(contestantId) {
  await ensurePublicSignupCollections();
  const signupToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + PUBLIC_SIGNUP_SESSION_MINUTES * 60 * 1000,
  );
  await wixData.insert(
    SIGNUP_SESSIONS_COLLECTION,
    {
      _id: storageId("public-signup-session", signupToken),
      contestantId,
      expiresAt,
      createdAt: new Date(),
    },
    OPTIONS,
  );
  return { signupToken, expiresAt: expiresAt.toISOString() };
}

export async function loadPublicSignupOptions(contestantId) {
  const workspace = await readWorkspace();
  const contestant = workspace.contestants.find(
    (item) => item.id === contestantId,
  );
  if (!contestant) {
    throw publicError(
      "CONTESTANT_UNAVAILABLE",
      "Your contestant profile is unavailable. Contact the arena for help.",
    );
  }
  const session = await createPublicSignupSession(contestantId);
  const options = buildPublicSignupOptions(
    workspace,
    contestant,
    session.signupToken,
    session.expiresAt,
  );
  const activeResult = await wixData
    .query(PAYMENT_INTENTS_COLLECTION)
    .eq("contestantId", contestantId)
    .limit(100)
    .find(OPTIONS);
  const reconciledIntents = await Promise.all(
    activeResult.items.map((intent) => expireStalePaymentCreatedIntent(intent)),
  );
  const activeIntent = reconciledIntents
    .filter((intent) => ACTIVE_PAYMENT_STATUSES.has(intent.status))
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    )[0];
  return {
    ...options,
    ...(activeIntent ? { activePayment: publicIntent(activeIntent) } : {}),
  };
}

const intentId = (contestantId, submissionId) =>
  storageId("public-signup-intent", `${contestantId}:${submissionId}`);

const entryReservationId = (intentIdValue, competitionId) =>
  storageId(
    "public-signup-entry-reservation",
    `${intentIdValue}:${competitionId}`,
  );

async function hydrateReservationRoles(activeReservations) {
  const legacyIntentIds = [
    ...new Set(
      activeReservations
        .filter(
          (reservation) =>
            !["Header", "Heeler"].includes(reservation.role),
        )
        .map((reservation) => reservation.intentId),
    ),
  ];
  const legacyIntents = await Promise.all(
    legacyIntentIds.map((id) =>
      wixData.get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS).catch(() => null),
    ),
  );
  const intentsById = new Map(
    legacyIntents.filter(Boolean).map((intent) => [intent._id, intent]),
  );
  return activeReservations.map((reservation) => {
    if (["Header", "Heeler"].includes(reservation.role)) return reservation;
    const intent = intentsById.get(reservation.intentId);
    let selections = [];
    if (intent) {
      try {
        const parsed = JSON.parse(intent.selections);
        if (Array.isArray(parsed)) selections = parsed;
      } catch (error) {
        console.error("Public signup reservation role could not be inferred.", {
          intentId: reservation.intentId,
          competitionId: reservation.competitionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const selection = selections.find(
      (item) => item.competitionId === reservation.competitionId,
    );
    return {
      ...reservation,
      role: selection?.role || "",
      entries: selection?.entries ?? reservation.entries ?? 1,
    };
  });
}

async function activeEntryReservations(
  competitionId,
  assertLockOwned = null,
) {
  let existingResult;
  try {
    existingResult = await wixData
      .query(ENTRY_RESERVATIONS_COLLECTION)
      .eq("competitionId", competitionId)
      .limit(1000)
      .find(OPTIONS);
  } catch (error) {
    if (
      error?.code === "WDE0025" ||
      error?.code === "WD_SCHEMA_DOES_NOT_EXIST"
    ) {
      return [];
    }
    throw error;
  }
  const expiredIds = existingResult.items
    .filter(
      (reservation) =>
        new Date(reservation.expiresAt).getTime() <= Date.now(),
    )
    .map(({ _id }) => _id);
  if (expiredIds.length && assertLockOwned) {
    await assertLockOwned();
    await wixData.bulkRemove(
      ENTRY_RESERVATIONS_COLLECTION,
      expiredIds,
      OPTIONS,
    );
  }
  const activeReservations = existingResult.items.filter(
    (reservation) => !expiredIds.includes(reservation._id),
  );
  return hydrateReservationRoles(activeReservations);
}

export async function assertWorkspacePreservesPublicSignupReservations(
  workspace,
  competitionIds = null,
) {
  let result;
  try {
    result = await wixData
      .query(ENTRY_RESERVATIONS_COLLECTION)
      .limit(1000)
      .find(OPTIONS);
  } catch (error) {
    if (
      error?.code === "WDE0025" ||
      error?.code === "WD_SCHEMA_DOES_NOT_EXIST"
    ) {
      return;
    }
    throw error;
  }
  const reservations = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    reservations.push(...result.items);
  }
  const competitionIdSet = competitionIds
    ? new Set(competitionIds.map((id) => String(id)))
    : null;
  const activeReservations = await hydrateReservationRoles(
    reservations.filter(
      (reservation) =>
        new Date(reservation.expiresAt).getTime() > Date.now() &&
        (!competitionIdSet ||
          competitionIdSet.has(String(reservation.competitionId))),
    ),
  );
  if (activeReservations.length === 0) return;
  const intentIds = [
    ...new Set(activeReservations.map((reservation) => reservation.intentId)),
  ];
  const intents = (
    await Promise.all(
      intentIds.map((id) =>
        wixData.get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS).catch(() => null),
      ),
    )
  ).filter(Boolean);
  assertWorkspaceSupportsActivePublicSignupReservations(
    workspace,
    activeReservations,
    intents,
  );
}

export async function countActivePublicSignupRoleReservations(
  competitionId,
  role,
  excludeIntentId = "",
) {
  const reservations = await activeEntryReservations(competitionId);
  return reservations
    .filter(
      (reservation) =>
        roundRobinReservationOccupiesRole(reservation, role) &&
        reservation.intentId !== excludeIntentId,
    )
    .reduce(
      (total, reservation) =>
        total + roundRobinReservationEntries(reservation),
      0,
    );
}

async function reserveEntries(
  intent,
  workspace,
  contestant,
  selections,
  assertLockOwned = noLockFence,
) {
  const acquiredIds = [];
  try {
    for (const selection of selections) {
      const { competitionId } = selection;
      const event = workspace.events.find((item) => item.id === competitionId);
      const partner =
        event.competitionType === "pick-and-draw"
          ? workspace.contestants.find(
              (item) => item.id === selection.partnerId,
            )
          : null;
      const header =
        selection.role === "Header" ? contestant : partner;
      const heeler =
        selection.role === "Heeler" ? contestant : partner;
      const participantIds = partner
        ? [contestant.id, partner.id].sort()
        : [contestant.id];
      const partnershipKey = partner ? `${header.id}:${heeler.id}` : "";
      const activeReservations = await activeEntryReservations(
        competitionId,
        assertLockOwned,
      );
      if (
        activeReservations.some(
          (reservation) =>
            reservation.intentId !== intent._id &&
            JSON.parse(reservation.participantIds).includes(contestant.id),
        )
      ) {
        throw publicError(
          "ALREADY_IN_CHECKOUT",
          `${event.name} is already reserved in another checkout.`,
        );
      }
      if (partner) {
        if (
          !event.allowRepeatPartners &&
          activeReservations.some(
            (reservation) =>
              reservation.intentId !== intent._id &&
              reservation.partnershipKey === partnershipKey,
          )
        ) {
          throw publicError(
            "DUPLICATE_PARTNERSHIP",
            `That partnership is already reserved in ${event.name}.`,
          );
        }
        for (const participantId of participantIds) {
          const activeTeamCount = workspace.teams.filter(
            (team) =>
              team.eventId === event.id &&
              team.submissionId !== intent.submissionId &&
              team.round === 1 &&
              !team.generated &&
              !team.scratched &&
              (team.headerId === participantId ||
                team.heelerId === participantId),
          ).length;
          const reservedTeamCount = activeReservations.filter(
            (reservation) =>
              reservation.intentId !== intent._id &&
              JSON.parse(reservation.participantIds).includes(participantId),
          ).length;
          if (
            activeTeamCount + reservedTeamCount >=
            Number(event.entriesAllowed || 1)
          ) {
            throw publicError(
              "ENTRY_LIMIT",
              `Entry limit exceeded for ${event.name}.`,
            );
          }
        }
      }
      assertRoundRobinRoleCapacity(
        event,
        workspace.registrations,
        selection.role,
        1 +
          activeReservations
            .filter(
              (reservation) =>
                roundRobinReservationOccupiesRole(
                  reservation,
                  selection.role,
                ) &&
                reservation.intentId !== intent._id,
            )
            .reduce(
              (total, reservation) =>
                total + roundRobinReservationEntries(reservation),
              0,
            ),
        intent.submissionId,
        contestant.id,
      );

      const id = entryReservationId(intent._id, competitionId);
      const reservation = {
        _id: id,
        intentId: intent._id,
        contestantId: intent.contestantId,
        competitionId,
        participantIds: JSON.stringify(participantIds),
        partnershipKey,
        expiresAt: new Date(
          Date.now() +
            PUBLIC_SIGNUP_ENTRY_RESERVATION_MINUTES * 60 * 1000,
        ),
        createdAt: new Date(),
      };
      try {
        await assertLockOwned();
        await wixData.insert(
          ENTRY_RESERVATIONS_COLLECTION,
          reservation,
          OPTIONS,
        );
        acquiredIds.push(id);
      } catch (error) {
        if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
        const existing = await wixData
          .get(ENTRY_RESERVATIONS_COLLECTION, id, OPTIONS)
          .catch(() => null);
        if (existing?.intentId === intent._id) continue;
        if (existing) {
          throw publicError(
            "ALREADY_IN_CHECKOUT",
            "A selected roping is already reserved in another checkout.",
          );
        }
        throw error;
      }
    }
  } catch (error) {
    if (acquiredIds.length) {
      await assertLockOwned();
      await wixData
        .bulkRemove(ENTRY_RESERVATIONS_COLLECTION, acquiredIds, OPTIONS)
        .catch(() => undefined);
    }
    throw error;
  }
}

async function releaseEntryReservations(
  intent,
  assertLockOwned = noLockFence,
) {
  const result = await wixData
    .query(ENTRY_RESERVATIONS_COLLECTION)
    .eq("intentId", intent._id)
    .limit(1000)
    .find(OPTIONS);
  if (result.items.length) {
    await assertLockOwned();
    await wixData.bulkRemove(
      ENTRY_RESERVATIONS_COLLECTION,
      result.items.map(({ _id }) => _id),
      OPTIONS,
    );
  }
}

async function renewEntryReservations(
  intent,
  minutes,
  assertLockOwned = noLockFence,
) {
  const result = await wixData
    .query(ENTRY_RESERVATIONS_COLLECTION)
    .eq("intentId", intent._id)
    .limit(1000)
    .find(OPTIONS);
  for (const reservation of result.items) {
    await updateWithRetry(
      ENTRY_RESERVATIONS_COLLECTION,
      {
        ...reservation,
        expiresAt: new Date(Date.now() + minutes * 60 * 1000),
      },
      "renew-entry-reservation",
      assertLockOwned,
    );
  }
}

async function expireStalePaymentCreatedIntentLocked(
  intent,
  now = Date.now(),
  assertLockOwned = noLockFence,
) {
  if (intent.status !== "payment-created") return intent;
  const reservationResult = await wixData
    .query(ENTRY_RESERVATIONS_COLLECTION)
    .eq("intentId", intent._id)
    .limit(1000)
    .find(OPTIONS);
  if (
    !publicSignupPaymentCreatedIntentIsStale(
      intent,
      reservationResult.items,
      now,
    )
  ) {
    return intent;
  }
  await releaseEntryReservations(intent, assertLockOwned);
  const expired = {
    ...intent,
    status: "expired",
    finalizedAt: new Date(now),
    updatedAt: new Date(now),
  };
  return updateWithRetry(
    PAYMENT_INTENTS_COLLECTION,
    expired,
    "expire-unstarted-payment",
    assertLockOwned,
  );
}

async function expireStalePaymentCreatedIntent(intent, now = Date.now()) {
  if (intent.status !== "payment-created") return intent;
  return withResourceLocks([`payment:${intent.paymentId}`], async (lockScope) => {
    const latest = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, intent._id, OPTIONS)
      .catch(() => null);
    if (!latest || latest.status !== "payment-created") {
      return latest || intent;
    }
    return withPublicSignupMutationLock(
      (mutationLockScope) =>
        expireStalePaymentCreatedIntentLocked(
          latest,
          now,
          mutationLockScope.assertOwned,
        ),
    );
  });
}

const publicIntent = (intent) => ({
  submissionId: intent.submissionId,
  paymentId: intent.paymentId || "",
  status: intent.status,
  paymentMethod: publicSignupIntentPaymentMethod(intent),
  amount: Number(intent.amount),
  currency: intent.currency,
  competitionIds: JSON.parse(intent.competitionIds),
  message:
    intent.status === "cash-due"
      ? `Registration submitted. Pay $${Number(intent.amount)} in cash at the event.`
      : intent.status === "successful"
      ? "Payment confirmed and registrations created."
      : intent.status === "fulfillment-failed"
        ? "Payment was received, but registration needs arena assistance. Contact the arena with this submission ID."
        : ["failed", "cancelled", "expired"].includes(intent.status)
          ? "Payment was not completed. Start a new checkout to try again."
          : "Payment is awaiting authoritative confirmation.",
});

async function createPublicSignupPaymentLocked(request, session, lockScope) {
  await lockScope.assertOwned();
  const id = intentId(session.contestantId, request.submissionId);
  const storedIntent = await wixData
    .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
    .catch(() => null);
  if (storedIntent) {
    const existing = await expireStalePaymentCreatedIntent(storedIntent);
    assertPublicSignupIntentPaymentMethod(existing, PUBLIC_SIGNUP_CARD_METHOD);
    const storedSelections = storedPublicSignupSelectionsForRetry(
      request.selections,
      JSON.parse(existing.selections),
    );
    const fingerprint = hash(
      publicSignupFingerprintPayload(
        session.contestantId,
        request.submissionId,
        storedSelections,
      ),
    );
    if (existing.fingerprint !== fingerprint) {
      throw publicError(
        "SUBMISSION_CONFLICT",
        "That submission ID is already bound to a different checkout.",
      );
    }
    return publicIntent(existing);
  }
  const workspace = await readWorkspace();
  const contestant = workspace.contestants.find(
    (item) => item.id === session.contestantId,
  );
  if (!contestant) {
    throw publicError(
      "CONTESTANT_UNAVAILABLE",
      "Your contestant profile is unavailable. Contact the arena for help.",
    );
  }
  const selections = normalizePublicSignupSelections(
    workspace,
    contestant,
    request.selections,
    request.submissionId,
  );
  const fingerprintPayload = publicSignupFingerprintPayload(
    contestant.id,
    request.submissionId,
    selections,
  );
  const fingerprint = hash(fingerprintPayload);
  const activeResult = await wixData
    .query(PAYMENT_INTENTS_COLLECTION)
    .eq("contestantId", contestant.id)
    .limit(100)
    .find(OPTIONS);
  const activeIntents = await Promise.all(
    activeResult.items.map((intent) => expireStalePaymentCreatedIntent(intent)),
  );
  const matchingActiveIntent = activeIntents.find(
    (intent) =>
      publicSignupIntentPaymentMethod(intent) === PUBLIC_SIGNUP_CARD_METHOD &&
      ACTIVE_PAYMENT_STATUSES.has(intent.status) &&
      JSON.stringify(JSON.parse(intent.selections)) ===
        JSON.stringify(selections),
  );
  if (matchingActiveIntent) return publicIntent(matchingActiveIntent);

  const competitionIds = selections.map(({ competitionId }) => competitionId);
  const amount = selections.length * PUBLIC_SIGNUP_PRICE_USD;
  const reserved = {
    _id: id,
    contestantId: contestant.id,
    submissionId: request.submissionId,
    fingerprint,
    paymentMethod: PUBLIC_SIGNUP_CARD_METHOD,
    status: "creating",
    amount,
    currency: "USD",
    competitionIds: JSON.stringify(competitionIds),
    selections: JSON.stringify(selections),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await lockScope.assertOwned();
    await wixData.insert(PAYMENT_INTENTS_COLLECTION, reserved, OPTIONS);
  } catch (error) {
    if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
    const concurrent = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
      .catch(() => null);
    if (concurrent) {
      assertPublicSignupIntentPaymentMethod(
        concurrent,
        PUBLIC_SIGNUP_CARD_METHOD,
      );
      if (concurrent.fingerprint === fingerprint) return publicIntent(concurrent);
    }
    throw error;
  }

  try {
    await withPublicSignupMutationLock(
      async (mutationLockScope) => {
        const latestWorkspace = await readWorkspace();
        const latestContestant = latestWorkspace.contestants.find(
          (item) => item.id === contestant.id,
        );
        const latestSelections = normalizePublicSignupSelections(
          latestWorkspace,
          latestContestant,
          selections,
          request.submissionId,
        );
        if (
          hash(
            publicSignupFingerprintPayload(
              contestant.id,
              request.submissionId,
              latestSelections,
            ),
          ) !== fingerprint
        ) {
          throw publicError(
            "SELECTION_CHANGED",
            "A selected roping changed. Reload registration and try again.",
          );
        }
        await reserveEntries(
          reserved,
          latestWorkspace,
          latestContestant,
          latestSelections,
          mutationLockScope.assertOwned,
        );
      },
    );
  } catch (error) {
    await lockScope.assertOwned();
    await wixData
      .remove(PAYMENT_INTENTS_COLLECTION, reserved._id, OPTIONS)
      .catch(() => undefined);
    throw error;
  }

  let payment;
  try {
    const userInfo = {
      ...(contestant.email ? { email: contestant.email } : {}),
      ...(contestant.phone ? { phone: contestant.phone } : {}),
    };
    await lockScope.assertOwned();
    payment = await wixPayBackend.createPayment({
      items: selections.map(({ competitionId }) => ({
        name:
          workspace.events.find((event) => event.id === competitionId)?.name ||
          "Arena roping entry",
        price: PUBLIC_SIGNUP_PRICE_USD,
        quantity: 1,
      })),
      amount,
      currency: "USD",
      ...(Object.keys(userInfo).length ? { userInfo } : {}),
    });
  } catch (error) {
    await withPublicSignupMutationLock(
      (mutationLockScope) =>
        releaseEntryReservations(
          reserved,
          mutationLockScope.assertOwned,
        ),
    );
    await lockScope.assertOwned();
    await wixData
      .remove(PAYMENT_INTENTS_COLLECTION, reserved._id, OPTIONS)
      .catch((removeError) => {
        console.error("Failed to release a public signup payment reservation.", {
          submissionId: reserved.submissionId,
          message:
            removeError instanceof Error
              ? removeError.message
              : String(removeError),
        });
      });
    throw error;
  }

  const ready = {
    ...reserved,
    paymentId: payment.id,
    status: "payment-created",
    updatedAt: new Date(),
  };
  try {
    await updateWithRetry(
      PAYMENT_INTENTS_COLLECTION,
      ready,
      "store-payment-id",
      lockScope.assertOwned,
    );
  } catch (error) {
    await withPublicSignupMutationLock(
      (mutationLockScope) =>
        releaseEntryReservations(
          reserved,
          mutationLockScope.assertOwned,
        ),
    );
    await lockScope.assertOwned();
    await wixData
      .remove(PAYMENT_INTENTS_COLLECTION, reserved._id, OPTIONS)
      .catch(() => undefined);
    throw error;
  }
  return publicIntent(ready);
}

export async function createPublicSignupPayment(request) {
  if (!VALID_APP_ID.test(String(request?.submissionId || ""))) {
    throw publicError("INVALID_SUBMISSION", "Start a new registration checkout.");
  }
  const session = await getSignupSession(request.signupToken);
  return withResourceLocks([`contestant:${session.contestantId}`], (lockScope) =>
    createPublicSignupPaymentLocked(request, session, lockScope),
  );
}

async function activeContestantIntents(contestantId) {
  const activeResult = await wixData
    .query(PAYMENT_INTENTS_COLLECTION)
    .eq("contestantId", contestantId)
    .limit(100)
    .find(OPTIONS);
  return Promise.all(
    activeResult.items.map((intent) => expireStalePaymentCreatedIntent(intent)),
  );
}

async function finalizeCashSubmission(intent) {
  return withPublicSignupMutationLock(
    async (lockScope) => {
      const latestIntent = await wixData
        .get(PAYMENT_INTENTS_COLLECTION, intent._id, OPTIONS)
        .catch(() => null);
      if (!latestIntent) {
        throw publicError(
          "SUBMISSION_UNAVAILABLE",
          "That cash registration is unavailable. Start a new registration.",
        );
      }
      assertPublicSignupIntentPaymentMethod(
        latestIntent,
        PUBLIC_SIGNUP_CASH_METHOD,
      );
      if (latestIntent.status === "cash-due") {
        return publicSignupCashConfirmation(latestIntent);
      }
      if (!["creating", "cash-finalizing"].includes(latestIntent.status)) {
        throw publicError(
          "SUBMISSION_CONFLICT",
          "That submission ID is already bound to a different checkout.",
        );
      }

      const workspace = await readWorkspace();
      const contestant = workspace.contestants.find(
        (item) => item.id === latestIntent.contestantId,
      );
      if (!contestant) {
        throw publicError(
          "CONTESTANT_UNAVAILABLE",
          "Your contestant profile is unavailable. Contact the arena for help.",
        );
      }
      const selections = normalizePublicSignupSelections(
        workspace,
        contestant,
        JSON.parse(latestIntent.selections),
        latestIntent.submissionId,
        Date.now(),
        latestIntent.status === "creating",
      );
      const fingerprint = hash(
        publicSignupFingerprintPayload(
          contestant.id,
          latestIntent.submissionId,
          selections,
          PUBLIC_SIGNUP_CASH_METHOD,
        ),
      );
      if (fingerprint !== latestIntent.fingerprint) {
        throw publicError(
          "SELECTION_CHANGED",
          "A selected roping changed. Reload registration and try again.",
        );
      }

      await reserveEntries(
        latestIntent,
        workspace,
        contestant,
        selections,
        lockScope.assertOwned,
      );
      await lockScope.assertOwned();
      const finalizingIntent =
        latestIntent.status === "cash-finalizing"
          ? latestIntent
          : await updateWithRetry(
              PAYMENT_INTENTS_COLLECTION,
              {
                ...latestIntent,
                status: "cash-finalizing",
                updatedAt: new Date(),
              },
              "start-cash-finalization",
              lockScope.assertOwned,
            );
      const records = buildPublicSignupRecords(
        workspace,
        contestant,
        finalizingIntent,
        selections,
        {
          paid: false,
          paymentMethod: PUBLIC_SIGNUP_CASH_METHOD,
          paymentReference: finalizingIntent.submissionId,
        },
      );
      let insertedRecord = false;
      for (const team of records.teams) {
        await lockScope.assertOwned();
        insertedRecord =
          (await insertUniqueArenaRecord(COLLECTIONS.teams, team)) ||
          insertedRecord;
      }
      for (const registration of records.registrations) {
        await lockScope.assertOwned();
        insertedRecord =
          (await insertUniqueArenaRecord(
            COLLECTIONS.registrations,
            registration,
          )) || insertedRecord;
      }
      if (insertedRecord) {
        await lockScope.assertOwned();
        await advanceOnlineRevision();
      }
      await lockScope.assertOwned();
      const completedIntent = await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...finalizingIntent,
          status: "cash-due",
          finalizedAt: new Date(),
          updatedAt: new Date(),
        },
        "finalize-cash-submission",
        lockScope.assertOwned,
      );
      await releaseEntryReservations(
        completedIntent,
        lockScope.assertOwned,
      ).catch((error) => {
        if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
        console.error("Cash signup reservation cleanup failed.", {
          submissionId: completedIntent.submissionId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return publicSignupCashConfirmation(completedIntent);
    },
  );
}

async function submitPublicSignupCashLocked(request, session, lockScope) {
  await lockScope.assertOwned();
  const id = intentId(session.contestantId, request.submissionId);
  const storedIntent = await wixData
    .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
    .catch(() => null);
  if (storedIntent) {
    assertPublicSignupIntentPaymentMethod(
      storedIntent,
      PUBLIC_SIGNUP_CASH_METHOD,
    );
    const storedSelections = storedPublicSignupSelectionsForRetry(
      request.selections,
      JSON.parse(storedIntent.selections),
    );
    const fingerprint = hash(
      publicSignupFingerprintPayload(
        session.contestantId,
        request.submissionId,
        storedSelections,
        PUBLIC_SIGNUP_CASH_METHOD,
      ),
    );
    if (storedIntent.fingerprint !== fingerprint) {
      throw publicError(
        "SUBMISSION_CONFLICT",
        "That submission ID is already bound to a different checkout.",
      );
    }
    if (storedIntent.status === "cash-due") {
      return publicSignupCashConfirmation(storedIntent);
    }
    const activeIntents = await activeContestantIntents(session.contestantId);
    assertCashSubmissionHasNoActiveCardPayment(
      activeIntents.filter(({ _id }) => _id !== storedIntent._id),
    );
    await lockScope.assertOwned();
    return finalizeCashSubmission(storedIntent);
  }

  const workspace = await readWorkspace();
  const contestant = workspace.contestants.find(
    (item) => item.id === session.contestantId,
  );
  if (!contestant) {
    throw publicError(
      "CONTESTANT_UNAVAILABLE",
      "Your contestant profile is unavailable. Contact the arena for help.",
    );
  }
  const selections = normalizePublicSignupSelections(
    workspace,
    contestant,
    request.selections,
    request.submissionId,
  );
  assertCashSubmissionHasNoActiveCardPayment(
    await activeContestantIntents(contestant.id),
  );
  const fingerprint = hash(
    publicSignupFingerprintPayload(
      contestant.id,
      request.submissionId,
      selections,
      PUBLIC_SIGNUP_CASH_METHOD,
    ),
  );
  const competitionIds = selections.map(({ competitionId }) => competitionId);
  let intent = {
    _id: id,
    contestantId: contestant.id,
    submissionId: request.submissionId,
    fingerprint,
    paymentMethod: PUBLIC_SIGNUP_CASH_METHOD,
    status: "creating",
    amount: selections.length * PUBLIC_SIGNUP_PRICE_USD,
    currency: "USD",
    competitionIds: JSON.stringify(competitionIds),
    selections: JSON.stringify(selections),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await lockScope.assertOwned();
    await wixData.insert(PAYMENT_INTENTS_COLLECTION, intent, OPTIONS);
  } catch (error) {
    if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
    const concurrent = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
      .catch(() => null);
    if (!concurrent) throw error;
    assertPublicSignupIntentPaymentMethod(
      concurrent,
      PUBLIC_SIGNUP_CASH_METHOD,
    );
    if (concurrent.fingerprint !== fingerprint) {
      throw publicError(
        "SUBMISSION_CONFLICT",
        "That submission ID is already bound to a different checkout.",
      );
    }
    intent = concurrent;
  }
  await lockScope.assertOwned();
  return finalizeCashSubmission(intent);
}

export async function submitPublicSignupCash(request) {
  if (!VALID_APP_ID.test(String(request?.submissionId || ""))) {
    throw publicError("INVALID_SUBMISSION", "Start a new registration checkout.");
  }
  const session = await getSignupSession(request.signupToken);
  return withResourceLocks([`contestant:${session.contestantId}`], (lockScope) =>
    submitPublicSignupCashLocked(request, session, lockScope),
  );
}

export async function getPublicSignupPaymentStatus(request) {
  if (!VALID_APP_ID.test(String(request?.submissionId || ""))) {
    throw publicError("INVALID_SUBMISSION", "Start a new registration checkout.");
  }

  const session = await getSignupSession(request.signupToken);
  const storedIntent = await wixData
    .get(
      PAYMENT_INTENTS_COLLECTION,
      intentId(session.contestantId, request.submissionId),
      OPTIONS,
    )
    .catch(() => null);
  if (!storedIntent) {
    throw publicError("PAYMENT_NOT_FOUND", "No payment exists for that checkout.");
  }
  const intent = await expireStalePaymentCreatedIntent(storedIntent);
  return publicIntent(intent);
}

async function insertUniqueArenaRecord(collectionId, record) {
  const id = storageId(collectionId, record.id);
  try {
    await wixData.insert(
      collectionId,
      { _id: id, appId: record.id, payload: JSON.stringify(record) },
      OPTIONS,
    );
    return true;
  } catch (error) {
    const existing = await wixData.get(collectionId, id, OPTIONS).catch(() => null);
    if (
      existing?.appId === record.id &&
      JSON.parse(existing.payload).submissionFingerprint ===
        record.submissionFingerprint
    ) {
      return false;
    }
    throw error;
  }
}

async function advanceOnlineRevision() {
  return withResourceLocks(
    competitionLockResources([`revision-${ONLINE_REVISION_ID}`]),
    async (lockScope) => {
      const revision = await wixData
        .get(SETTINGS_COLLECTION, ONLINE_REVISION_ID, OPTIONS)
        .catch(() => null);
      await lockScope.assertOwned();
      await wixData.save(
        SETTINGS_COLLECTION,
        {
          _id: ONLINE_REVISION_ID,
          value: Number(revision?.value || 0) + 1,
          updatedAt: new Date(),
        },
        OPTIONS,
      );
    },
  );
}

async function finalizeSuccessfulPayment(
  intent,
  transactionId,
  assertLockOwned = noLockFence,
) {
  if (intent.status === "successful") return intent;
  const workspace = await readWorkspace();
  const contestant = workspace.contestants.find(
    (item) => item.id === intent.contestantId,
  );
  if (!contestant) {
    throw publicError(
      "CONTESTANT_UNAVAILABLE",
      "Contestant profile is unavailable.",
    );
  }
  const storedSelections = JSON.parse(intent.selections);
  const selections = normalizePublicSignupSelections(
    workspace,
    contestant,
    storedSelections,
    intent.submissionId,
    Date.now(),
    false,
  );
  if (
    hash(
      publicSignupFingerprintPayload(
        contestant.id,
        intent.submissionId,
        selections,
      ),
    ) !== intent.fingerprint
  ) {
    throw publicError(
      "PAYMENT_MISMATCH",
      "Payment registration details no longer match.",
    );
  }
  const records = buildPublicSignupRecords(
    workspace,
    contestant,
    intent,
    selections,
    {
      paid: true,
      paymentMethod: PUBLIC_SIGNUP_CARD_METHOD,
      paymentReference: intent.paymentId,
    },
  );
  for (const team of records.teams) {
    await assertLockOwned();
    await insertUniqueArenaRecord(COLLECTIONS.teams, team);
  }
  for (const registration of records.registrations) {
    await assertLockOwned();
    await insertUniqueArenaRecord(COLLECTIONS.registrations, registration);
  }
  await assertLockOwned();
  await advanceOnlineRevision();
  await assertLockOwned();
  const successfulIntent = await updateWithRetry(
    PAYMENT_INTENTS_COLLECTION,
    {
      ...intent,
      transactionId,
      status: "successful",
      finalizedAt: new Date(),
      updatedAt: new Date(),
    },
    "finalize-successful-payment",
    assertLockOwned,
  );
  await releaseEntryReservations(intent, assertLockOwned).catch((error) => {
    if (error?.code === "RESOURCE_LOCK_OWNERSHIP_LOST") throw error;
    console.error("Successful signup reservation cleanup failed.", {
      submissionId: intent.submissionId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return successfulIntent;
}

async function findPaymentIntent(paymentId) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await wixData
      .query(PAYMENT_INTENTS_COLLECTION)
      .eq("paymentId", paymentId)
      .limit(1)
      .find(OPTIONS);
    if (result.items[0]) return result.items[0];
    if (attempt < 4) await wait(250 * attempt);
  }
  return null;
}

async function sendOwnerTriggeredEmail(notification) {
  const secret = await getSecretValue(OWNER_TRIGGERED_EMAIL_SECRET);
  const emailId = String(secret?.value || "").trim();
  if (!emailId) {
    throw new Error(
      `Wix secret ${OWNER_TRIGGERED_EMAIL_SECRET} is empty or unavailable.`,
    );
  }

  const result = await contacts
    .queryContacts()
    .eq("info.emails.email", OWNER_EMAIL)
    .limit(2)
    .find({ suppressAuth: true });
  if (result.items.length !== 1) {
    throw new Error(
      `Expected exactly one Wix contact for ${OWNER_EMAIL}; found ${result.items.length}.`,
    );
  }

  await triggeredEmails.emailContact(emailId, result.items[0]._id, {
    variables: notification,
  });
}

async function notifyOwnerForSuccessfulPayment(
  intent,
  assertLockOwned = noLockFence,
) {
  const workspace = await readWorkspace();
  const contestant = workspace.contestants.find(
    (item) => item.id === intent.contestantId,
  );
  if (!contestant) {
    throw new Error("Paid contestant is unavailable for owner notification.");
  }

  const id = storageId(OWNER_NOTIFICATIONS_COLLECTION, intent._id);
  const existingResult = await wixData
    .query(OWNER_NOTIFICATIONS_COLLECTION)
    .eq("_id", id)
    .limit(1)
    .find(OPTIONS);
  const existing = existingResult.items[0] || null;
  const now = new Date();
  const record = existing || {
    _id: id,
    intentId: intent._id,
    paymentId: intent.paymentId,
    submissionId: intent.submissionId,
    status: "pending",
    attempts: 0,
    error: "",
    createdAt: now,
    updatedAt: now,
  };
  const notification = buildOwnerPaymentNotification(
    workspace,
    contestant,
    intent,
  );

  return deliverOwnerPaymentNotification({
    record,
    notification,
    send: sendOwnerTriggeredEmail,
    persist: async (updatedRecord, context) => {
      await assertLockOwned();
      return wixData
        .save(OWNER_NOTIFICATIONS_COLLECTION, updatedRecord, OPTIONS)
        .catch((error) => {
          console.error("Owner payment notification state write failed.", {
            paymentId: intent.paymentId,
            submissionId: intent.submissionId,
            context,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        });
    },
  });
}

async function notifyOwnerAfterSuccessfulPayment(
  intent,
  assertLockOwned = noLockFence,
) {
  return notifyOwnerForSuccessfulPayment(intent, assertLockOwned).catch((error) => {
    console.error("Paid public signup owner notification failed.", {
      paymentId: intent.paymentId,
      submissionId: intent.submissionId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  });
}

async function processPublicSignupPaymentUpdateLocked(event, paymentLockScope) {
  const paymentId = String(event?.payment?.id || "");
  if (!paymentId) return;
  await ensurePublicSignupCollections();
  const storedIntent = await findPaymentIntent(paymentId);
  if (!storedIntent) return;
  const intent = await withPublicSignupMutationLock(
    (mutationLockScope) =>
      expireStalePaymentCreatedIntentLocked(
        storedIntent,
        Date.now(),
        mutationLockScope.assertOwned,
      ),
  );
  if (intent.status === "successful") {
    await withPublicSignupMutationLock(
      (mutationLockScope) =>
        releaseEntryReservations(
          intent,
          mutationLockScope.assertOwned,
        ),
    );
    await notifyOwnerAfterSuccessfulPayment(
      intent,
      paymentLockScope.assertOwned,
    );
    return;
  }

  if (
    Number(event.payment.amount) !== Number(intent.amount) ||
    event.payment.currency !== intent.currency
  ) {
    console.error("Public signup payment amount mismatch.", {
      paymentId,
      submissionId: intent.submissionId,
    });
    await paymentLockScope.assertOwned();
    await updateWithRetry(
      PAYMENT_INTENTS_COLLECTION,
      { ...intent, status: "fulfillment-failed", updatedAt: new Date() },
      "payment-amount-mismatch",
      paymentLockScope.assertOwned,
    );
    return;
  }

  const status = String(event.status || "").toLowerCase();
  if (intent.status === "expired") {
    if (status === "successful") {
      console.error("Expired public signup payment completed late.", {
        paymentId,
        submissionId: intent.submissionId,
      });
      await paymentLockScope.assertOwned();
      await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...intent,
          transactionId: String(event.transactionId || ""),
          status: "fulfillment-failed",
          updatedAt: new Date(),
        },
        "expired-payment-completed",
        paymentLockScope.assertOwned,
      );
    }
    return;
  }
  if (status !== "successful") {
    if (
      intent.status === "fulfillment-failed" ||
      intent.status === "failed" ||
      intent.status === "cancelled"
    ) {
      return;
    }
    await withPublicSignupMutationLock(async (mutationLockScope) => {
      await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...intent,
          status: ["failed", "cancelled", "pending"].includes(status)
            ? status
            : "pending",
          updatedAt: new Date(),
        },
        "payment-status-update",
        mutationLockScope.assertOwned,
      );
      if (status === "failed" || status === "cancelled") {
        await releaseEntryReservations(
          intent,
          mutationLockScope.assertOwned,
        );
      } else if (status === "pending") {
        await renewEntryReservations(
          intent,
          PENDING_RESERVATION_MINUTES,
          mutationLockScope.assertOwned,
        );
      }
    });
    return;
  }

  let successfulIntent;
  try {
    successfulIntent = await withPublicSignupMutationLock(
      (mutationLockScope) =>
        finalizeSuccessfulPayment(
          intent,
          String(event.transactionId || ""),
          mutationLockScope.assertOwned,
        ),
    );
  } catch (error) {
    console.error("Paid public signup fulfillment failed.", {
      paymentId,
      submissionId: intent.submissionId,
      code: error?.code || "UNEXPECTED",
      message: error instanceof Error ? error.message : String(error),
    });
    const latestIntent = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, intent._id, OPTIONS)
      .catch(() => null);
    if (latestIntent?.status !== "successful") {
      await paymentLockScope.assertOwned();
      await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...(latestIntent || intent),
          status: "fulfillment-failed",
          updatedAt: new Date(),
        },
        "payment-fulfillment-failed",
        paymentLockScope.assertOwned,
      );
    }
    return;
  }

  await notifyOwnerAfterSuccessfulPayment(
    successfulIntent,
    paymentLockScope.assertOwned,
  );
}

export async function processPublicSignupPaymentUpdate(event) {
  const paymentId = String(event?.payment?.id || "");
  if (!paymentId) return;
  await ensurePublicSignupCollections();
  await withResourceLocks([`payment:${paymentId}`], (lockScope) =>
    processPublicSignupPaymentUpdateLocked(event, lockScope),
  );
}
