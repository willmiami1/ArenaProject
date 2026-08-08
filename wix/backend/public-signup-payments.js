import wixData from "wix-data";
import { collections } from "wix-data.v2";
import { elevate } from "wix-auth";
import wixPayBackend from "wix-pay-backend";
import { createHash, randomBytes } from "crypto";
import {
  PUBLIC_SIGNUP_ENTRY_RESERVATION_MINUTES,
  PUBLIC_SIGNUP_PRICE_USD,
  PUBLIC_SIGNUP_SESSION_MINUTES,
  PublicSignupError,
  buildPublicSignupOptions,
  normalizePublicSignupSelections,
  publicSignupFingerprintPayload,
  publicSignupPaymentCreatedIntentIsStale,
  storedPublicSignupSelectionsForRetry,
} from "./public-signup-contract";

const OPTIONS = { suppressAuth: true, consistentRead: true };
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
const VALID_APP_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const SECURITY_WRITE_ATTEMPTS = 3;
const PENDING_RESERVATION_MINUTES = 24 * 60;
const ACTIVE_PAYMENT_STATUSES = new Set([
  "payment-created",
  "pending",
  "settling",
]);

const hash = (value) => createHash("sha256").update(value).digest("hex");
const storageId = (namespace, value) =>
  hash(`${namespace}:${value}`).slice(0, 32);

const publicError = (code, message) => new PublicSignupError(code, message);

async function ensureCollection(collectionId, displayName, fields) {
  try {
    await wixData.query(collectionId).limit(1).find(OPTIONS);
  } catch (error) {
    if (
      error?.code !== "WDE0025" &&
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
    } catch (createError) {
      try {
        await wixData.query(collectionId).limit(1).find(OPTIONS);
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

async function updateWithRetry(collectionId, item, context) {
  let lastError;
  for (let attempt = 1; attempt <= SECURITY_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await wixData.update(collectionId, item, OPTIONS);
    } catch (error) {
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

async function acquireResourceLock(resource) {
  const id = storageId("public-signup-resource-lock", resource);
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await wixData.insert(
        PAYMENT_LOCKS_COLLECTION,
        {
          _id: id,
          paymentId: resource,
          expiresAt: new Date(Date.now() + 60 * 1000),
        },
        OPTIONS,
      );
      return id;
    } catch (error) {
      const existing = await wixData
        .get(PAYMENT_LOCKS_COLLECTION, id, OPTIONS)
        .catch(() => null);
      if (existing && new Date(existing.expiresAt).getTime() <= Date.now()) {
        await wixData
          .remove(PAYMENT_LOCKS_COLLECTION, id, OPTIONS)
          .catch(() => undefined);
      } else if (!existing) {
        throw error;
      }
      await wait(250);
    }
  }
  throw new Error("Timed out waiting for a public signup resource lock.");
}

async function withResourceLocks(resources, callback) {
  const acquiredIds = [];
  try {
    for (const resource of [...new Set(resources)].sort()) {
      acquiredIds.push(await acquireResourceLock(resource));
    }
    return await callback();
  } finally {
    for (const id of acquiredIds.reverse()) {
      await wixData
        .remove(PAYMENT_LOCKS_COLLECTION, id, OPTIONS)
        .catch(() => undefined);
    }
  }
}

async function getSignupSession(signupToken) {
  if (!/^[a-f0-9]{64}$/.test(String(signupToken || ""))) {
    throw publicError("SESSION_EXPIRED", "Sign in again to continue registration.");
  }
  await ensurePublicSignupCollections();
  const session = await wixData
    .get(
      SIGNUP_SESSIONS_COLLECTION,
      storageId("public-signup-session", signupToken),
      OPTIONS,
    )
    .catch(() => null);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw publicError("SESSION_EXPIRED", "Sign in again to continue registration.");
  }
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

async function reserveEntries(intent, workspace, contestant, selections) {
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
      const existingResult = await wixData
        .query(ENTRY_RESERVATIONS_COLLECTION)
        .eq("competitionId", competitionId)
        .limit(1000)
        .find(OPTIONS);
      const expiredIds = existingResult.items
        .filter(
          (reservation) =>
            new Date(reservation.expiresAt).getTime() <= Date.now(),
        )
        .map(({ _id }) => _id);
      if (expiredIds.length) {
        await wixData.bulkRemove(
          ENTRY_RESERVATIONS_COLLECTION,
          expiredIds,
          OPTIONS,
        );
      }
      const activeReservations = existingResult.items.filter(
        (reservation) => !expiredIds.includes(reservation._id),
      );
      if (
        activeReservations.some((reservation) =>
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
              team.round === 1 &&
              !team.generated &&
              !team.scratched &&
              (team.headerId === participantId ||
                team.heelerId === participantId),
          ).length;
          const reservedTeamCount = activeReservations.filter((reservation) =>
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
        await wixData.insert(
          ENTRY_RESERVATIONS_COLLECTION,
          reservation,
          OPTIONS,
        );
        acquiredIds.push(id);
      } catch (error) {
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
      await wixData
        .bulkRemove(ENTRY_RESERVATIONS_COLLECTION, acquiredIds, OPTIONS)
        .catch(() => undefined);
    }
    throw error;
  }
}

async function releaseEntryReservations(intent) {
  const result = await wixData
    .query(ENTRY_RESERVATIONS_COLLECTION)
    .eq("intentId", intent._id)
    .limit(1000)
    .find(OPTIONS);
  if (result.items.length) {
    await wixData.bulkRemove(
      ENTRY_RESERVATIONS_COLLECTION,
      result.items.map(({ _id }) => _id),
      OPTIONS,
    );
  }
}

async function renewEntryReservations(intent, minutes) {
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
    );
  }
}

async function expireStalePaymentCreatedIntentLocked(intent, now = Date.now()) {
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
  await releaseEntryReservations(intent);
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
  );
}

async function expireStalePaymentCreatedIntent(intent, now = Date.now()) {
  if (intent.status !== "payment-created") return intent;
  return withResourceLocks([`payment:${intent.paymentId}`], async () => {
    const latest = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, intent._id, OPTIONS)
      .catch(() => null);
    if (!latest || latest.status !== "payment-created") {
      return latest || intent;
    }
    return expireStalePaymentCreatedIntentLocked(latest, now);
  });
}

const publicIntent = (intent) => ({
  submissionId: intent.submissionId,
  paymentId: intent.paymentId || "",
  status: intent.status,
  amount: Number(intent.amount),
  currency: intent.currency,
  competitionIds: JSON.parse(intent.competitionIds),
  message:
    intent.status === "successful"
      ? "Payment confirmed and registrations created."
      : intent.status === "fulfillment-failed"
        ? "Payment was received, but registration needs arena assistance. Contact the arena with this submission ID."
        : ["failed", "cancelled", "expired"].includes(intent.status)
          ? "Payment was not completed. Start a new checkout to try again."
          : "Payment is awaiting authoritative confirmation.",
});

export async function createPublicSignupPayment(request) {
  if (!VALID_APP_ID.test(String(request?.submissionId || ""))) {
    throw publicError("INVALID_SUBMISSION", "Start a new registration checkout.");
  }
  const session = await getSignupSession(request.signupToken);
  const id = intentId(session.contestantId, request.submissionId);
  const storedIntent = await wixData
    .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
    .catch(() => null);
  if (storedIntent) {
    const existing = await expireStalePaymentCreatedIntent(storedIntent);
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
    status: "creating",
    amount,
    currency: "USD",
    competitionIds: JSON.stringify(competitionIds),
    selections: JSON.stringify(selections),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  try {
    await wixData.insert(PAYMENT_INTENTS_COLLECTION, reserved, OPTIONS);
  } catch (error) {
    const concurrent = await wixData
      .get(PAYMENT_INTENTS_COLLECTION, id, OPTIONS)
      .catch(() => null);
    if (concurrent?.fingerprint === fingerprint) return publicIntent(concurrent);
    throw error;
  }

  try {
    await withResourceLocks(
      selections.map(
        ({ competitionId }) => `competition:${competitionId}`,
      ),
      async () => {
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
        );
      },
    );
  } catch (error) {
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
    await releaseEntryReservations(reserved).catch(() => undefined);
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
    await updateWithRetry(PAYMENT_INTENTS_COLLECTION, ready, "store-payment-id");
  } catch (error) {
    await releaseEntryReservations(reserved).catch(() => undefined);
    await wixData
      .remove(PAYMENT_INTENTS_COLLECTION, reserved._id, OPTIONS)
      .catch(() => undefined);
    throw error;
  }
  return publicIntent(ready);
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

const recordId = (kind, intent, competitionId, suffix = "") =>
  `${kind}-${hash(
    `${intent.fingerprint}:${competitionId}:${suffix}`,
  ).slice(0, 32)}`;

function buildPaidRecords(workspace, contestant, intent, selections) {
  const submittedAt = new Date().toISOString();
  const metadata = {
    paid: true,
    paymentMethod: "wix-payments",
    paymentReference: intent.paymentId,
    paymentAmount: PUBLIC_SIGNUP_PRICE_USD,
    paymentCurrency: "USD",
    source: "online",
    submissionId: intent.submissionId,
    submissionFingerprint: intent.fingerprint,
    submittedAt,
  };
  const teams = [];
  const registrations = [];
  selections.forEach((selection) => {
    const event = workspace.events.find(
      (item) => item.id === selection.competitionId,
    );
    if (event.competitionType !== "pick-and-draw") {
      registrations.push({
        id: recordId("online-registration", intent, event.id),
        eventId: event.id,
        contestantId: contestant.id,
        role: selection.role,
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
      return;
    }

    const partner = workspace.contestants.find(
      (item) => item.id === selection.partnerId,
    );
    const header = selection.role === "Header" ? contestant : partner;
    const heeler = selection.role === "Heeler" ? contestant : partner;
    const teamId = recordId("online-team", intent, event.id);
    teams.push({
      id: teamId,
      eventId: event.id,
      headerId: header.id,
      heelerId: heeler.id,
      drawPosition: 0,
      status: "ready",
      rawTime: null,
      penalties: 0,
      notes: "",
      round: 1,
      checkedIn: false,
      scratched: false,
      generated: false,
      points: 0,
      ...metadata,
    });
    const roles =
      event.pickDrawRole === "both"
        ? ["Header", "Heeler"]
        : [event.pickDrawRole === "header" ? "Header" : "Heeler"];
    roles.forEach((role, index) => {
      registrations.push({
        id: recordId("online-registration", intent, event.id, `${role}-${index}`),
        eventId: event.id,
        contestantId: role === "Header" ? header.id : heeler.id,
        sourceTeamId: teamId,
        role,
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
    });
  });
  return { teams, registrations };
}

async function insertUniqueArenaRecord(collectionId, record) {
  const id = storageId(collectionId, record.id);
  try {
    await wixData.insert(
      collectionId,
      { _id: id, appId: record.id, payload: JSON.stringify(record) },
      OPTIONS,
    );
  } catch (error) {
    const existing = await wixData.get(collectionId, id, OPTIONS).catch(() => null);
    if (
      existing?.appId === record.id &&
      JSON.parse(existing.payload).submissionFingerprint ===
        record.submissionFingerprint
    ) {
      return;
    }
    throw error;
  }
}

async function finalizeSuccessfulPayment(intent, transactionId) {
  if (intent.status === "successful") return;
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
  const records = buildPaidRecords(workspace, contestant, intent, selections);
  for (const team of records.teams) {
    await insertUniqueArenaRecord(COLLECTIONS.teams, team);
  }
  for (const registration of records.registrations) {
    await insertUniqueArenaRecord(COLLECTIONS.registrations, registration);
  }
  const revision = await wixData
    .get(SETTINGS_COLLECTION, ONLINE_REVISION_ID, OPTIONS)
    .catch(() => null);
  await wixData.save(
    SETTINGS_COLLECTION,
    {
      _id: ONLINE_REVISION_ID,
      value: Number(revision?.value || 0) + 1,
      updatedAt: new Date(),
    },
    OPTIONS,
  );
  await updateWithRetry(
    PAYMENT_INTENTS_COLLECTION,
    {
      ...intent,
      transactionId,
      status: "successful",
      finalizedAt: new Date(),
      updatedAt: new Date(),
    },
    "finalize-successful-payment",
  );
  await releaseEntryReservations(intent).catch((error) => {
    console.error("Successful signup reservation cleanup failed.", {
      submissionId: intent.submissionId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
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

async function processPublicSignupPaymentUpdateLocked(event) {
  const paymentId = String(event?.payment?.id || "");
  if (!paymentId) return;
  await ensurePublicSignupCollections();
  const storedIntent = await findPaymentIntent(paymentId);
  if (!storedIntent) return;
  const intent = await expireStalePaymentCreatedIntentLocked(storedIntent);
  if (intent.status === "successful") {
    await releaseEntryReservations(intent).catch(() => undefined);
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
    await updateWithRetry(
      PAYMENT_INTENTS_COLLECTION,
      { ...intent, status: "fulfillment-failed", updatedAt: new Date() },
      "payment-amount-mismatch",
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
      await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...intent,
          transactionId: String(event.transactionId || ""),
          status: "fulfillment-failed",
          updatedAt: new Date(),
        },
        "expired-payment-completed",
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
    );
    if (status === "failed" || status === "cancelled") {
      await releaseEntryReservations(intent);
    } else if (status === "pending") {
      await renewEntryReservations(intent, PENDING_RESERVATION_MINUTES);
    }
    return;
  }

  try {
    await withResourceLocks(
      JSON.parse(intent.competitionIds).map(
        (competitionId) => `competition:${competitionId}`,
      ),
      () =>
        finalizeSuccessfulPayment(
          intent,
          String(event.transactionId || ""),
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
      await updateWithRetry(
        PAYMENT_INTENTS_COLLECTION,
        {
          ...(latestIntent || intent),
          status: "fulfillment-failed",
          updatedAt: new Date(),
        },
        "payment-fulfillment-failed",
      );
    }
  }
}

export async function processPublicSignupPaymentUpdate(event) {
  const paymentId = String(event?.payment?.id || "");
  if (!paymentId) return;
  await ensurePublicSignupCollections();
  await withResourceLocks([`payment:${paymentId}`], () =>
    processPublicSignupPaymentUpdateLocked(event),
  );
}
