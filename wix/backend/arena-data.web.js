import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";
import { collections } from "wix-data.v2";
import { getSecret } from "wix-secrets-backend";
import { createHash, randomBytes } from "crypto";
import { currentMember } from "wix-members-backend";
import { elevate } from "wix-auth";
import {
  assertSpectatorPredictionRunIsActive,
  publicPredictionRunProjection,
  publicRegisteredRiders,
  publicRoundRobinRoleCapacities,
} from "./public-prediction-projection";
import {
  PublicSignupError,
  failedCredentialMetadata,
  successfulCredentialMetadata,
} from "./public-signup-contract";
import {
  createPublicSignupPayment as createPublicSignupPaymentIntent,
  getPublicSignupPaymentStatus as readPublicSignupPaymentStatus,
  loadPublicSignupOptions,
} from "./public-signup-payments";
import {
  prepareRegistrationDeskSignup,
  registrationDeskSignupIsRetry,
  supportedRegistrationDeskEntryTypes,
} from "./registration-desk-signup-contract";

const COLLECTIONS = {
  meets: "ArenaMeets",
  events: "ArenaCompetitions",
  contestants: "ArenaContestants",
  teams: "ArenaTeams",
  registrations: "ArenaRegistrations",
  spectators: "ArenaSpectators",
  spectatorPredictions: "ArenaSpectatorPredictions",
};
const COLLECTION_DISPLAY_NAMES = {
  meets: "Arena Meets",
  events: "Arena Competitions",
  contestants: "Arena Contestants",
  teams: "Arena Teams",
  registrations: "Arena Registrations",
  spectators: "Arena Spectators",
  spectatorPredictions: "Arena Spectator Predictions",
};
const PAYLOAD_FIELDS = [
  { key: "appId", displayName: "App ID", type: "TEXT" },
  { key: "payload", displayName: "Payload", type: "TEXT" },
];
const SETTINGS_COLLECTION = "ArenaSettings";
const CREDENTIALS_COLLECTION = "ArenaContestantCredentials";
const CREDENTIAL_LOCKS_COLLECTION = "ArenaContestantCredentialLocks";
const SETTINGS_ID = "arena-command-settings";
const STAFF_REVISION_ID = "arena-command-staff-revision";
const ONLINE_REVISION_ID = "arena-command-online-revision";
const PUBLIC_SCHEDULE_ID = "arena-command-public-schedule";
const OPTIONS = { suppressAuth: true };
const PIN_PEPPER_SECRET = "ArenaContestantPinPepper";
const ADMIN_ROLE_SECRET = "ArenaAdminRoleId";
const REGISTRATION_ROLE_SECRET = "ArenaRegistrationRoleId";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ONLINE_REGISTRATION_LEAD_MS = 60 * 60 * 1000;
const ACCOUNT_RECONCILIATION_ATTEMPTS = 6;
const REVISION_WRITE_ATTEMPTS = 3;

const registrationClosesAt = (event) =>
  new Date(`${event.date}T${event.startTime}:00`).getTime() -
  ONLINE_REGISTRATION_LEAD_MS;

const publicRegistrationClosesAt = (event) => {
  const timestamp = registrationClosesAt(event);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
};

const onlineRegistrationIsOpen = (event, now = Date.now()) =>
  event.registrationOpen === true &&
  event.status !== "Complete" &&
  event.drawLocked !== true &&
  now < registrationClosesAt(event);

const assertOnlineRegistrationOpen = (event, now = Date.now()) => {
  if (!event.registrationOpen) throw new Error("Registration is closed.");
  if (event.status === "Complete") throw new Error("This competition is complete.");
  if (event.drawLocked) throw new Error("The draw is locked.");
  if (now >= registrationClosesAt(event)) {
    throw new Error("Online registration closes one hour before the competition starts.");
  }
};
const registrationDeskIsVisible = (event) => event.status === "Live";

const assertRegistrationDeskOpen = (event) => {
  if (event.status !== "Live") {
    throw new Error("Registration Desk entries are limited to live competitions.");
  }
  if (!event.registrationOpen) throw new Error("Registration is closed.");
  if (event.drawLocked) throw new Error("The draw is locked.");
};

async function resolveAdminAccess() {
  let member;
  try {
    member = await currentMember.getMember();
  } catch {
    return {
      state: "login-required",
      message: "Sign in with a Wix account assigned the Arena Admin role.",
    };
  }
  if (!member) {
    return {
      state: "login-required",
      message: "Sign in with a Wix account assigned the Arena Admin role.",
    };
  }
  try {
    const [roles, configuredRoleId] = await Promise.all([
      currentMember.getRoles(),
      getSecret(ADMIN_ROLE_SECRET).catch(() => ""),
    ]);
    const configuredId =
      typeof configuredRoleId === "string" ? configuredRoleId.trim() : "";
    const hasAdminRole = roles.some(
      (role) =>
        (configuredId && role._id === configuredId) ||
        role.key === "ADMIN" ||
        role.roleKey === "ADMIN" ||
        role.title === "Owner" ||
        role.title === "Arena Admin" ||
        role.title === "Admin",
    );
    if (hasAdminRole) {
      return {
        state: "authorized",
        message: "Administrator access verified.",
      };
    }
    return {
      state: "denied",
      message:
        "Your Wix account is signed in but does not have the required Arena Admin role.",
    };
  } catch {
    return {
      state: "denied",
      message:
        "Administrator access is not configured or could not be verified.",
    };
  }
}

async function requireArenaAdmin() {
  const access = await resolveAdminAccess();
  if (access.state !== "authorized") {
    throw new Error("Arena Command requires the Wix Arena Admin role.");
  }
}

async function resolveRegistrationDeskAccess() {
  let member;
  try {
    member = await currentMember.getMember();
  } catch {
    return {
      state: "login-required",
      message: "Sign in with a Wix Registration Desk account.",
    };
  }
  if (!member) {
    return {
      state: "login-required",
      message: "Sign in with a Wix Registration Desk account.",
    };
  }
  try {
    const [roles, registrationRoleId, adminRoleId] = await Promise.all([
      currentMember.getRoles(),
      getSecret(REGISTRATION_ROLE_SECRET).catch(() => ""),
      getSecret(ADMIN_ROLE_SECRET).catch(() => ""),
    ]);
    const allowedRoleIds = [registrationRoleId, adminRoleId]
      .filter((roleId) => typeof roleId === "string" && roleId.trim())
      .map((roleId) => roleId.trim());
    const authorized = roles.some(
      (role) =>
        allowedRoleIds.includes(role._id) ||
        role.key === "ADMIN" ||
        role.roleKey === "ADMIN" ||
        role.title === "Owner" ||
        role.title === "Arena Admin" ||
        role.title === "Admin",
    );
    if (authorized) {
      return {
        state: "authorized",
        message: "Registration Desk access verified.",
      };
    }
    return {
      state: "denied",
      message: "Your Wix account does not have the Registration Desk role.",
    };
  } catch {
    return {
      state: "denied",
      message:
        "Registration Desk access is not configured or could not be verified.",
    };
  }
}

async function requireRegistrationDesk() {
  const access = await resolveRegistrationDeskAccess();
  if (access.state !== "authorized") {
    throw new Error("This action requires the Wix Registration Desk role.");
  }
}

export const getAdminAccess = webMethod(
  Permissions.Anyone,
  resolveAdminAccess,
);

export const getRegistrationDeskAccess = webMethod(
  Permissions.Anyone,
  resolveRegistrationDeskAccess,
);

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeUppercaseText = (value) =>
  String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
const normalizeContestantCasing = (contestant) => ({
  ...contestant,
  name: normalizeUppercaseText(contestant.name),
  hometown: normalizeUppercaseText(contestant.hometown),
  email: normalizeEmail(contestant.email),
  horses: Array.isArray(contestant.horses)
    ? contestant.horses.map(normalizeUppercaseText)
    : contestant.horses,
});
const mergeContestantPhoto = (incoming, previous) => {
  const { clearPhoto, ...contestant } = incoming;
  const incomingPhoto =
    typeof contestant.photo === "string" && contestant.photo.trim()
      ? contestant.photo
      : "";
  return {
    ...contestant,
    photo: clearPhoto === true ? "" : incomingPhoto || previous?.photo || "",
  };
};
const validPin = (value) => /^\d{4}$/.test(String(value || ""));
const pinHash = (pin, salt, pepper) =>
  createHash("sha256").update(`${pepper}:${salt}:${pin}`).digest("hex");
const constantTimeEqual = (left, right) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

const publicSignupEnvelope = async (operation, callback) => {
  try {
    return { ok: true, data: await callback() };
  } catch (error) {
    if (error instanceof PublicSignupError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    console.error("Unexpected public signup failure.", {
      operation,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      error: {
        code: "TEMPORARILY_UNAVAILABLE",
        message:
          "Public registration is temporarily unavailable. Try again, or contact the arena if the problem continues.",
      },
    };
  }
};

const arenaRecordStorageId = (collectionId, recordId) =>
  createHash("sha256")
    .update(`${collectionId}:${recordId}`)
    .digest("hex")
    .slice(0, 32);

async function readOptionalItem(collectionId, itemId) {
  try {
    return await wixData.get(collectionId, itemId, OPTIONS);
  } catch (error) {
    if (error?.code === "WDE0025" || error?.code === "WDE0026") return null;
    throw error;
  }
}

const publicContestantAccountResult = (workspace, event, contestant) => {
  const contestants = workspace.contestants.some(
    (item) => item.id === contestant.id,
  )
    ? workspace.contestants
    : [...workspace.contestants, contestant];
  return {
    contestant: {
      id: contestant.id,
      name: contestant.name,
      role: contestant.role,
      headerHandicap: contestant.headerHandicap,
      heelerHandicap: contestant.heelerHandicap,
    },
    partners:
      event.competitionType === "pick-only" ||
      event.competitionType === "pick-and-draw"
        ? availablePartners({ ...workspace, contestants }, event, contestant)
        : [],
  };
};

async function findMatchingContestantAccount({
  credentialId,
  contestantId,
  email,
  phone,
  pin,
}) {
  const profileId = arenaRecordStorageId(
    COLLECTIONS.contestants,
    contestantId,
  );
  let credential = await readOptionalItem(
    CREDENTIALS_COLLECTION,
    credentialId,
  );
  if (!credential) {
    const credentials = await wixData
      .query(CREDENTIALS_COLLECTION)
      .eq("emailNormalized", email)
      .limit(1)
      .find(OPTIONS);
    credential = credentials.items[0];
  }
  if (!credential) return null;
  if (
    credential.contestantId !== contestantId ||
    credential.emailNormalized !== email
  ) {
    return null;
  }
  const authenticatedId = await verifyContestantCredentials(email, pin);
  if (authenticatedId !== contestantId) return null;

  for (
    let attempt = 1;
    attempt <= ACCOUNT_RECONCILIATION_ATTEMPTS;
    attempt += 1
  ) {
    let profile = await readOptionalItem(COLLECTIONS.contestants, profileId);
    if (!profile) {
      const profiles = await wixData
        .query(COLLECTIONS.contestants)
        .eq("appId", contestantId)
        .limit(1)
        .find(OPTIONS);
      profile = profiles.items[0];
    }
    if (profile) {
      if (profile.appId !== contestantId) return null;
      try {
        const contestant =
          typeof profile.payload === "string"
            ? JSON.parse(profile.payload)
            : profile.payload;
        if (
          contestant?.id !== contestantId ||
          normalizeEmail(contestant.email) !== email ||
          String(contestant.phone || "").replace(/\D/g, "") !== phone
        ) {
          return null;
        }
        return contestant;
      } catch {
        return null;
      }
    }
    if (attempt < ACCOUNT_RECONCILIATION_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 50));
    }
  }
  return null;
}

async function bumpRevision(revisionId, context) {
  let lastError;
  for (let attempt = 1; attempt <= REVISION_WRITE_ATTEMPTS; attempt += 1) {
    try {
      const current = await readOptionalItem(SETTINGS_COLLECTION, revisionId);
      await wixData.save(
        SETTINGS_COLLECTION,
        {
          ...(current || {}),
          _id: revisionId,
          value: Number(current?.value || 0) + 1,
          updatedAt: new Date(),
        },
        OPTIONS,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt < REVISION_WRITE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 50));
      }
    }
  }
  console.error("Arena revision update failed after a durable write.", {
    ...context,
    revisionId,
    attempts: REVISION_WRITE_ATTEMPTS,
    code: lastError?.code || "",
    message:
      lastError instanceof Error ? lastError.message : String(lastError),
  });
}

async function readAll(collectionId) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const items = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.map((item) => JSON.parse(item.payload));
}

async function readOptionalAll(collectionId) {
  try {
    return await readAll(collectionId);
  } catch (error) {
    if (error?.code === "WDE0025" || error?.code === "WDE0026") return [];
    throw error;
  }
}

async function readPublicScheduleEvents() {
  let result = await wixData
    .query(COLLECTIONS.events)
    .limit(1000)
    .find(OPTIONS);
  const items = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.flatMap((item) => {
    try {
      const event =
        typeof item.payload === "string"
          ? JSON.parse(item.payload)
          : item.payload;
      return event && typeof event === "object" ? [event] : [];
    } catch (error) {
      console.error("Skipping an invalid public schedule record.", {
        recordId: item._id,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  });
}

async function replaceAll(collectionId, records) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const ids = result.items.map((item) => item._id);
  while (result.hasNext()) {
    result = await result.next();
    ids.push(...result.items.map((item) => item._id));
  }
  if (ids.length) await wixData.bulkRemove(collectionId, ids, OPTIONS);
  if (records.length) {
    await wixData.bulkInsert(
      collectionId,
      records.map((record) => ({
        appId: record.id,
        payload: JSON.stringify(record),
      })),
      OPTIONS,
    );
  }
}

async function readWorkspace({ includeSpectators = true } = {}) {
  const [settings, staffRevision, onlineRevision] = await Promise.all([
    wixData.get(SETTINGS_COLLECTION, SETTINGS_ID, OPTIONS).catch(() => null),
    wixData
      .get(SETTINGS_COLLECTION, STAFF_REVISION_ID, OPTIONS)
      .catch(() => null),
    wixData
      .get(SETTINGS_COLLECTION, ONLINE_REVISION_ID, OPTIONS)
      .catch(() => null),
  ]);
  const [meets, events, contestants, teams, registrations, spectators, spectatorPredictions] = await Promise.all([
    readAll(COLLECTIONS.meets),
    readAll(COLLECTIONS.events),
    readAll(COLLECTIONS.contestants),
    readAll(COLLECTIONS.teams),
    readAll(COLLECTIONS.registrations),
    includeSpectators
      ? readOptionalAll(COLLECTIONS.spectators)
      : Promise.resolve([]),
    includeSpectators
      ? readOptionalAll(COLLECTIONS.spectatorPredictions)
      : Promise.resolve([]),
  ]);
  return {
    participantDatabaseVersion: settings?.participantDatabaseVersion || 1,
    revision:
      Number(staffRevision?.value || settings?.revision || 0) +
      Number(onlineRevision?.value || 0),
    staffRevision: Number(staffRevision?.value || settings?.revision || 0),
    onlineRevision: Number(onlineRevision?.value || 0),
    loadedAt: new Date().toISOString(),
    meets,
    events,
    contestants,
    teams,
    registrations,
    spectators,
    spectatorPredictions,
    activeEventId: settings?.activeEventId || "",
  };
}

const teamEntryKey = (team) =>
  `${team.headerId}|${team.heelerId}|${team.headerEntryNumber || 1}|${team.heelerEntryNumber || 1}`;

function publishedResults(event, teams, contestants) {
    if (event.resultsPublished !== true) return [];
    const grouped = new Map();
    teams
      .filter((team) => team.eventId === event.id && !team.scratched)
      .forEach((team) => {
        const key = teamEntryKey(team);
        grouped.set(key, [...(grouped.get(key) || []), team]);
      });
    const names = new Map(contestants.map((contestant) => [contestant.id, contestant.name]));
    return [...grouped.values()]
      .map((runs) => {
        const completed = runs.filter(
          (run) => run.status === "complete" && run.rawTime !== null,
        );
        const total = completed.reduce(
          (sum, run) => sum + Number(run.rawTime || 0) + Number(run.penalties || 0),
          0,
        );
        const qualified =
          completed.length > 0 && !runs.some((run) => run.status === "no-time");
        return {
          headerName: names.get(runs[0].headerId) || "Unknown contestant",
          heelerName: names.get(runs[0].heelerId) || "Unknown contestant",
          rounds: completed.length,
          officialTotal: qualified ? Math.round(total * 100) / 100 : null,
          status: qualified ? "qualified" : "no-time",
          qualified,
          total,
        };
      })
      .sort((left, right) => {
        if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
        if (left.rounds !== right.rounds) return right.rounds - left.rounds;
        return left.total - right.total;
      })
      .map(({ qualified, total, ...result }, index) => ({
        place: index + 1,
        ...result,
      }));
}

const predictionOutcome = (team) =>
  team.rawTime !== null
    ? "cowboys"
    : team.status === "no-time" || team.status === "complete"
      ? "steer"
      : null;

function spectatorLeaderboard(workspace, eventId, round) {
  const spectators = new Map(
    workspace.spectators.map((spectator) => [spectator.id, spectator]),
  );
  const teams = new Map(workspace.teams.map((team) => [team.id, team]));
  const rows = new Map();
  workspace.spectatorPredictions
    .filter(
      (prediction) =>
        prediction.eventId === eventId && Number(prediction.round) === round,
    )
    .forEach((prediction) => {
      const spectator = spectators.get(prediction.spectatorId);
      const team = teams.get(prediction.teamId);
      if (!spectator || !team) return;
      const current = rows.get(spectator.id) || {
        spectatorId: spectator.id,
        name: spectator.name,
        round,
        picks: 0,
        correct: 0,
      };
      current.picks += 1;
      if (predictionOutcome(team) === prediction.choice) current.correct += 1;
      rows.set(spectator.id, current);
    });
  return [...rows.values()].sort(
    (left, right) =>
      right.correct - left.correct ||
      right.picks - left.picks ||
      left.name.localeCompare(right.name),
  );
}

function publicProjection(workspace) {
    const contestantsById = new Map(
      workspace.contestants.map((contestant) => [contestant.id, contestant]),
    );
    const competitions = workspace.events.map((event) => ({
      id: event.id,
      parentEventId: event.parentEventId,
      name: event.name,
      description: String(event.description || "").slice(0, 2000),
      date: event.date,
      startTime: event.startTime,
      location: event.location,
      status: event.status,
      entryFee: event.entryFee,
      competitionType: event.competitionType,
      competitionLabel: {
        "draw-pot": "Draw Pot",
        "pick-only": "Pick Only",
        "pick-and-draw": "Pick and Draw",
        "round-robin": "Round Robin",
      }[event.competitionType] || "Competition",
      pickDrawRole: event.pickDrawRole,
      registrationOpen: onlineRegistrationIsOpen(event),
      registrationClosesAt: publicRegistrationClosesAt(event),
      drawLocked: event.drawLocked === true,
      resultsPublished: event.resultsPublished === true,
      entriesAllowed: event.entriesAllowed,
      allowRepeatPartners: event.allowRepeatPartners === true,
      handicapTotal: event.handicapTotal,
      maxContestantHandicap: Number(event.maxContestantHandicap ?? 99),
      timeLimit: event.timeLimit,
      rounds: event.rounds,
      shortGoTeams: event.shortGoTeams,
      ...publicPredictionRunProjection(
        event,
        workspace.teams,
        contestantsById,
      ),
      entryCount:
        workspace.teams.filter(
          (team) =>
            team.eventId === event.id &&
            team.round === 1 &&
            !team.generated &&
            !team.scratched,
        ).length +
        workspace.registrations
          .filter(
            (registration) =>
              registration.eventId === event.id &&
              registration.status !== "scratched",
          )
          .reduce((sum, registration) => sum + Number(registration.entries || 0), 0),
      registeredRiders: publicRegisteredRiders(
        event.id,
        workspace.registrations,
        workspace.teams,
        contestantsById,
      ),
      ...(() => {
        const roleCapacities = publicRoundRobinRoleCapacities(
          event,
          workspace.registrations,
        );
        return roleCapacities.length ? { roleCapacities } : {};
      })(),
      results: publishedResults(event, workspace.teams, workspace.contestants),
      spectatorLeaderboards: Array.from(
        { length: Math.max(Number(event.rounds || 1), 1) },
        (_, index) =>
          spectatorLeaderboard(workspace, event.id, index + 1).map(
            ({ name, round, picks, correct }) => ({
              name,
              round,
              picks,
              correct,
            }),
          ),
      ).flat(),
    }));
    const meets = workspace.meets
      .map((meet) => {
        const children = competitions.filter(
          (competition) => competition.parentEventId === meet.id,
        );
        return {
          id: meet.id,
          name: meet.name,
          date: meet.date,
          startTime: meet.startTime,
          location: meet.location,
          producer: meet.producer || "",
          competitions: children,
        };
      })
      .sort((left, right) => {
        return `${left.date}T${left.startTime}`.localeCompare(
          `${right.date}T${right.startTime}`,
        );
      });
    return { generatedAt: new Date().toISOString(), competitions, meets };
}

const mergeOnline = (incoming, latest) => {
  const ids = new Set(incoming.map((record) => record.id));
  return [
    ...incoming,
    ...latest.filter((record) => record.source === "online" && !ids.has(record.id)),
  ];
};

async function savePublicScheduleSnapshot(workspaceOrEvents) {
  const events = Array.isArray(workspaceOrEvents)
    ? workspaceOrEvents
    : workspaceOrEvents?.events;
  if (!Array.isArray(events) || events.length > 1000) {
    throw new Error("The public schedule payload is invalid.");
  }
  const snapshot = Array.isArray(workspaceOrEvents)
    ? events
    : publicProjection({
        ...workspaceOrEvents,
        spectators: [],
        spectatorPredictions: [],
      });
  await wixData.save(
    SETTINGS_COLLECTION,
    {
      _id: PUBLIC_SCHEDULE_ID,
      payload: JSON.stringify(snapshot),
      updatedAt: new Date(),
    },
    OPTIONS,
  );
}

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
        await wixData
          .query(collectionId)
          .limit(1)
          .find({ ...OPTIONS, consistentRead: true });
      } catch {
        throw createError;
      }
    }
  }
}

async function ensureSettingsCollection() {
  await ensureCollection(SETTINGS_COLLECTION, "Arena Settings", [
    { key: "payload", displayName: "Payload", type: "TEXT" },
    { key: "value", displayName: "Value", type: "NUMBER" },
    { key: "activeEventId", displayName: "Active Event ID", type: "TEXT" },
    {
      key: "participantDatabaseVersion",
      displayName: "Participant Database Version",
      type: "NUMBER",
    },
    { key: "updatedAt", displayName: "Updated At", type: "DATETIME" },
  ]);
}

async function ensureWorkspaceCollections() {
  await ensureSettingsCollection();
  for (const [key, collectionId] of Object.entries(COLLECTIONS)) {
    await ensureCollection(
      collectionId,
      COLLECTION_DISPLAY_NAMES[key],
      PAYLOAD_FIELDS,
    );
  }
}

async function ensureRiderAccountCollections() {
  await ensureSettingsCollection();
  await ensureCollection(
    COLLECTIONS.contestants,
    "Arena Contestants",
    PAYLOAD_FIELDS,
  );
  await ensureCollection(
    CREDENTIALS_COLLECTION,
    "Arena Contestant Credentials",
    [
      { key: "contestantId", displayName: "Contestant ID", type: "TEXT" },
      { key: "emailNormalized", displayName: "Normalized Email", type: "TEXT" },
      { key: "pinSalt", displayName: "PIN Salt", type: "TEXT" },
      { key: "pinHash", displayName: "PIN Hash", type: "TEXT" },
      { key: "failedAttempts", displayName: "Failed Attempts", type: "NUMBER" },
      { key: "lockedUntil", displayName: "Locked Until", type: "DATETIME" },
      { key: "updatedAt", displayName: "Updated At", type: "DATETIME" },
    ],
  );
  await ensureCredentialLockCollection();
}

async function ensureCredentialLockCollection() {
  await ensureCollection(
    CREDENTIAL_LOCKS_COLLECTION,
    "Arena Contestant Credential Locks",
    [
      { key: "emailNormalized", displayName: "Normalized Email", type: "TEXT" },
      { key: "expiresAt", displayName: "Expires At", type: "DATETIME" },
    ],
  );
}

async function syncRecords(collectionId, records, removableAppIds) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const currentItems = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    currentItems.push(...result.items);
  }
  const currentByAppId = new Map(
    currentItems.map((item) => [item.appId, item]),
  );
  const incomingIds = new Set(records.map((record) => record.id));
  const removeIds = currentItems
    .filter(
      (item) =>
        removableAppIds.has(item.appId) && !incomingIds.has(item.appId),
    )
    .map((item) => item._id);
  if (removeIds.length) {
    await wixData.bulkRemove(collectionId, removeIds, OPTIONS);
  }
  if (records.length) {
    await wixData.bulkSave(
      collectionId,
      records.map((record) => ({
        ...(currentByAppId.get(record.id) || {}),
        appId: record.id,
        payload: JSON.stringify(record),
      })),
      OPTIONS,
    );
  }
}

async function removeOrphanedContestantCredentials(contestants) {
  const contestantIds = new Set(contestants.map((contestant) => contestant.id));
  let result = await wixData
    .query(CREDENTIALS_COLLECTION)
    .limit(1000)
    .find(OPTIONS);
  const removeIds = [];
  while (true) {
    removeIds.push(
      ...result.items
        .filter((item) => !contestantIds.has(item.contestantId))
        .map((item) => item._id),
    );
    if (!result.hasNext()) break;
    result = await result.next();
  }
  for (let index = 0; index < removeIds.length; index += 1000) {
    await wixData.bulkRemove(
      CREDENTIALS_COLLECTION,
      removeIds.slice(index, index + 1000),
      OPTIONS,
    );
  }
}

export const loadArenaData = webMethod(Permissions.SiteMember, async () => {
  await requireArenaAdmin();
  await ensureWorkspaceCollections();
  await ensureRiderAccountCollections();
  try {
    const workspace = await readWorkspace();
    await removeOrphanedContestantCredentials(workspace.contestants);
    return workspace;
  } catch (error) {
    if (
      error?.code === "WDE0025" ||
      error?.code === "WDE0026" ||
      error?.code === "WD_SCHEMA_DOES_NOT_EXIST"
    ) {
      return null;
    }
    throw error;
  }
});

export const saveArenaData = webMethod(Permissions.SiteMember, async (data) => {
  await requireArenaAdmin();
  await ensureWorkspaceCollections();
  await ensureRiderAccountCollections();
  let latest;
  try {
    latest = await readWorkspace();
  } catch (error) {
    if (
      error?.code !== "WDE0025" &&
      error?.code !== "WDE0026" &&
      error?.code !== "WD_SCHEMA_DOES_NOT_EXIST"
    ) {
      throw error;
    }
    await ensureSettingsCollection();
    await savePublicScheduleSnapshot(data);
    return {
      ...data,
      revision: Number(data.revision || 0) + 1,
      staffRevision: Number(data.staffRevision || data.revision || 0) + 1,
      onlineRevision: Number(data.onlineRevision || 0),
      loadedAt: new Date().toISOString(),
    };
  }
  const submittedStaffRevision = Number(
    data.staffRevision ?? data.revision ?? 0,
  );
  if (submittedStaffRevision !== latest.staffRevision) {
    throw new Error(
      "Arena data changed in another staff session. Reload before saving again.",
    );
  }
  const loadedAt = Date.parse(data.loadedAt || "");
  const onlineChanged =
    Number(data.onlineRevision || 0) !== latest.onlineRevision ||
    [...latest.contestants, ...latest.teams, ...latest.registrations].some(
      (record) =>
        record.source === "online" &&
        Date.parse(record.submittedAt || "") > loadedAt,
    );
  const latestContestantsById = new Map(
    latest.contestants.map((contestant) => [contestant.id, contestant]),
  );
  const next = {
    ...data,
    contestants: (
      onlineChanged
        ? mergeOnline(data.contestants || [], latest.contestants)
        : data.contestants || []
    ).map((contestant) =>
      normalizeContestantCasing(
        mergeContestantPhoto(
          contestant,
          latestContestantsById.get(contestant.id),
        ),
      ),
    ),
    teams: onlineChanged
      ? mergeOnline(data.teams || [], latest.teams)
      : data.teams || [],
    registrations: onlineChanged
      ? mergeOnline(data.registrations || [], latest.registrations)
      : data.registrations || [],
    spectators: latest.spectators,
    spectatorPredictions: latest.spectatorPredictions,
  };
  const removableIds = (records) =>
    new Set(
      records
        .filter(
          (record) =>
            record.source !== "online" ||
            Date.parse(record.submittedAt || "") <= loadedAt,
        )
        .map((record) => record.id),
    );
  await Promise.all([
    syncRecords(
      COLLECTIONS.meets,
      next.meets || [],
      removableIds(latest.meets),
    ),
    syncRecords(
      COLLECTIONS.events,
      next.events || [],
      removableIds(latest.events),
    ),
    syncRecords(
      COLLECTIONS.contestants,
      next.contestants || [],
      removableIds(latest.contestants),
    ),
    syncRecords(COLLECTIONS.teams, next.teams, removableIds(latest.teams)),
    syncRecords(
      COLLECTIONS.registrations,
      next.registrations,
      removableIds(latest.registrations),
    ),
    syncRecords(
      COLLECTIONS.spectators,
      next.spectators,
      removableIds(latest.spectators),
    ),
    syncRecords(
      COLLECTIONS.spectatorPredictions,
      next.spectatorPredictions,
      removableIds(latest.spectatorPredictions),
    ),
  ]);
  await removeOrphanedContestantCredentials(next.contestants || []);
  await Promise.all([
    wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: SETTINGS_ID,
        activeEventId: data.activeEventId || "",
        participantDatabaseVersion: data.participantDatabaseVersion || 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    ),
    wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: STAFF_REVISION_ID,
        value: latest.staffRevision + 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    ),
    savePublicScheduleSnapshot(next),
  ]);
  return readWorkspace();
});

function registrationDeskProjection(workspace) {
  const events = workspace.events.filter(registrationDeskIsVisible);
  const eventIds = new Set(events.map((event) => event.id));
  return {
    events: events.map(
      ({
        id,
        parentEventId,
        name,
        date,
        startTime,
        location,
        status,
        entryFee,
        competitionType,
        pickDrawRole,
        registrationOpen,
        drawLocked,
        entriesAllowed,
        minDrawsAllowed,
        allowRepeatPartners,
        handicapTotal,
        maxContestantHandicap,
        maxHeaders,
        maxHeelers,
      }) => ({
        id,
        parentEventId,
        name,
        date,
        startTime,
        location,
        status,
        entryFee,
        competitionType,
        pickDrawRole,
        registrationOpen,
        drawLocked,
        entriesAllowed,
        minDrawsAllowed: Number(minDrawsAllowed ?? 0),
        allowRepeatPartners,
        handicapTotal,
        maxContestantHandicap,
        maxHeaders,
        maxHeelers,
        supportedEntryTypes: supportedRegistrationDeskEntryTypes({
          competitionType,
        }),
      }),
    ),
    contestants: workspace.contestants,
    teams: workspace.teams
      .filter((team) => eventIds.has(team.eventId) && Number(team.round) === 1)
      .map((team) => ({
        id: team.id,
        eventId: team.eventId,
        rowId: team.rowId,
        entryType: team.entryType,
        headerId: team.headerId,
        heelerId: team.heelerId,
        headerHorseName: team.headerHorseName || "",
        heelerHorseName: team.heelerHorseName || "",
        drawPosition: Number(team.drawPosition || 0),
        originalTeamNumber: Number(
          team.originalTeamNumber || team.drawPosition || 0,
        ),
        status: team.status,
        rawTime: null,
        penalties: 0,
        notes: "",
        round: 1,
        checkedIn: false,
        scratched: team.scratched === true,
        generated: team.generated === true,
        points: 0,
        paid: team.paid === true,
        paymentMethod: team.paymentMethod,
        payerContestantId: team.payerContestantId,
        source: team.source,
        submissionId: team.submissionId,
        submittedAt: team.submittedAt,
      })),
    registrations: workspace.registrations
      .filter((registration) => eventIds.has(registration.eventId))
      .map((registration) => ({ ...registration, notes: "" })),
  };
}

export const loadRegistrationDeskData = webMethod(
  Permissions.SiteMember,
  async () => {
    await requireRegistrationDesk();
    return registrationDeskProjection(await readWorkspace());
  },
);

export const saveRegistrationDeskContestant = webMethod(
  Permissions.SiteMember,
  async (input) => {
    await requireRegistrationDesk();
    const workspace = await readWorkspace();
    const name = normalizeUppercaseText(input.name);
    const email = normalizeEmail(input.email);
    const phone = String(input.phone || "").trim();
    const id =
      input.id ||
      `desk-contestant-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const headerHandicap = Number(input.headerHandicap);
    const heelerHandicap = Number(input.heelerHandicap);
    const horsesByName = new Map();
    (Array.isArray(input.horses) ? input.horses : []).forEach((value) => {
      if (typeof value !== "string") return;
      const horse = normalizeUppercaseText(value);
      const key = horse.toLowerCase();
      if (horse && !horsesByName.has(key)) horsesByName.set(key, horse);
    });
    const horses = [...horsesByName.values()];
    if (
      !validAppId(id) ||
      name.length < 2 ||
      name.length > 100 ||
      !["Header", "Heeler", "Both"].includes(input.role) ||
      !Number.isFinite(headerHandicap) ||
      !Number.isFinite(heelerHandicap) ||
      headerHandicap < 0 ||
      heelerHandicap < 0 ||
      headerHandicap > 20 ||
      heelerHandicap > 20 ||
      horses.length > 20 ||
      horses.some((horse) => horse.length > 100) ||
      (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      throw new Error("Enter valid contestant profile information.");
    }
    if (
      email &&
      workspace.contestants.some(
        (contestant) =>
          contestant.id !== id && normalizeEmail(contestant.email) === email,
      )
    ) {
      throw new Error("Another contestant already uses that email.");
    }
    const [contestantCredential, duplicateCredential] = await Promise.all([
      wixData
        .query(CREDENTIALS_COLLECTION)
        .eq("contestantId", id)
        .limit(1)
        .find(OPTIONS),
      email
        ? wixData
            .query(CREDENTIALS_COLLECTION)
            .eq("emailNormalized", email)
            .limit(1)
            .find(OPTIONS)
        : Promise.resolve({ items: [] }),
    ]);
    if (
      duplicateCredential.items.some(
        (credential) => credential.contestantId !== id,
      )
    ) {
      throw new Error("That email is already used by another contestant login.");
    }
    const existingCredential = contestantCredential.items[0];
    if (
      existingCredential &&
      normalizeEmail(existingCredential.emailNormalized) !== email
    ) {
      throw new Error(
        "Arena Admin must update the email and PIN for contestants with a login account.",
      );
    }
    const previous = workspace.contestants.find(
      (contestant) => contestant.id === id,
    );
    const contestant = {
      id,
      name,
      role: input.role,
      headerHandicap,
      heelerHandicap,
      photo: previous?.photo || "",
      phone,
      email,
      hometown: normalizeUppercaseText(input.hometown),
      horses,
      membershipNumber: previous?.membershipNumber || "",
      categoryNumber: previous?.categoryNumber || "",
    };
    const existing = await wixData
      .query(COLLECTIONS.contestants)
      .eq("appId", id)
      .limit(1)
      .find(OPTIONS);
    await wixData.save(
      COLLECTIONS.contestants,
      {
        ...(existing.items[0] || {}),
        appId: id,
        payload: JSON.stringify(contestant),
      },
      OPTIONS,
    );
    await bumpRevision(STAFF_REVISION_ID, {
      action: "saveRegistrationDeskContestant",
      contestantId: id,
    });
    return {
      contestant,
      data: registrationDeskProjection(await readWorkspace()),
    };
  },
);

export const setRegistrationDeskContestantPin = webMethod(
  Permissions.SiteMember,
  async ({ contestantId, pin }) => {
    await requireRegistrationDesk();
    if (!validAppId(contestantId) || !validPin(pin)) {
      throw new Error("Choose a contestant and enter a four-digit PIN.");
    }
    const workspace = await readWorkspace();
    const contestant = workspace.contestants.find(
      (item) => item.id === contestantId,
    );
    const email = normalizeEmail(contestant?.email);
    if (!contestant || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(
        "Add a valid email to the contestant profile before setting a PIN.",
      );
    }
    const [duplicateEmail, existingCredential] = await Promise.all([
      wixData
        .query(CREDENTIALS_COLLECTION)
        .eq("emailNormalized", email)
        .limit(1)
        .find(OPTIONS),
      wixData
        .query(CREDENTIALS_COLLECTION)
        .eq("contestantId", contestantId)
        .limit(1)
        .find(OPTIONS),
    ]);
    if (
      duplicateEmail.items.some(
        (credential) => credential.contestantId !== contestantId,
      )
    ) {
      throw new Error("That email is already used by another contestant login.");
    }
    const pepper = await getSecret(PIN_PEPPER_SECRET);
    const salt = randomBytes(16).toString("hex");
    const nextCredential = successfulCredentialMetadata({
      ...(existingCredential.items[0] || {}),
      contestantId,
      emailNormalized: email,
      pinSalt: salt,
      pinHash: pinHash(pin, salt, pepper),
    });
    await wixData.save(
      CREDENTIALS_COLLECTION,
      nextCredential,
      OPTIONS,
    );
    return { configured: true };
  },
);

export const loadPublicArenaData = webMethod(Permissions.Anyone, async () =>
  publicProjection(await readWorkspace({ includeSpectators: true })),
);

export const loadPublicSchedule = webMethod(Permissions.Anyone, async () => {
  let events;
  try {
    const snapshot = await wixData
      .get(SETTINGS_COLLECTION, PUBLIC_SCHEDULE_ID, OPTIONS)
      .catch(() => null);
    events = snapshot?.payload ? JSON.parse(snapshot.payload) : null;
    if (Array.isArray(events?.competitions)) {
      const hasRegisteredRiders = events.competitions.every(
        (competition) =>
          Array.isArray(competition.registeredRiders?.headers) &&
          Array.isArray(competition.registeredRiders?.heelers) &&
          [
            ...competition.registeredRiders.headers,
            ...competition.registeredRiders.heelers,
          ].every((rider) => Array.isArray(rider.horseNames)),
      );
      if (hasRegisteredRiders) return events;
      return publicProjection(await readWorkspace({ includeSpectators: true }));
    }
    if (!Array.isArray(events)) events = await readPublicScheduleEvents();
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      competitions: [],
      meets: [],
      scheduleError: [
        "ArenaCompetitions could not be read.",
        error?.code ? `Code: ${String(error.code)}.` : "",
        error instanceof Error ? error.message : String(error),
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  const scheduleNumber = (value, fallback = 0) => {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
  };
  const competitionLabel = {
    "draw-pot": "Draw Pot",
    "pick-only": "Pick Only",
    "pick-and-draw": "Pick and Draw",
    "round-robin": "Round Robin",
    slide: "Slide",
  };
  const competitions = events.map((event) => ({
    id: String(event.id || ""),
    parentEventId: String(event.parentEventId || ""),
    name: String(event.name || "Competition"),
    description: "",
    date: String(event.date || ""),
    startTime: String(event.startTime || ""),
    location: String(event.location || ""),
    status: String(event.status || "Upcoming"),
    entryFee: scheduleNumber(event.entryFee),
    competitionType: String(event.competitionType || "draw-pot"),
    competitionLabel:
      competitionLabel[event.competitionType] || "Competition",
    pickDrawRole: String(event.pickDrawRole || "both"),
    registrationOpen: false,
    registrationClosesAt: "",
    drawLocked: Boolean(event.drawLocked),
    resultsPublished: Boolean(event.resultsPublished),
    entriesAllowed: scheduleNumber(event.entriesAllowed),
    minDrawsAllowed: scheduleNumber(event.minDrawsAllowed),
    allowRepeatPartners: Boolean(event.allowRepeatPartners),
    handicapTotal: scheduleNumber(event.handicapTotal),
    slideNumber: scheduleNumber(event.slideNumber, 10),
    maxContestantHandicap: scheduleNumber(event.maxContestantHandicap, 10),
    timeLimit: scheduleNumber(event.timeLimit),
    rounds: scheduleNumber(event.rounds, 1),
    shortGoTeams: scheduleNumber(event.shortGoTeams),
    incentivePayouts: Boolean(event.incentivePayouts),
    incentiveHandicapTotal: scheduleNumber(event.incentiveHandicapTotal, 7),
    incentiveTeams: scheduleNumber(event.incentiveTeams, 1),
    incentiveAmountPerTeam: scheduleNumber(event.incentiveAmountPerTeam),
    entryCount: 0,
    registeredRiders: { headers: [], heelers: [] },
    results: [],
    predictionRuns: [],
    spectatorLeaderboards: [],
  }));
  return {
    generatedAt: new Date().toISOString(),
    competitions,
    meets: [],
  };
});

export const publishPublicSchedule = webMethod(
  Permissions.SiteMember,
  async (events) => {
    await requireArenaAdmin();
    await ensureSettingsCollection();
    await savePublicScheduleSnapshot(events);
    return { publishedAt: new Date().toISOString(), count: events.length };
  },
);

export const setContestantPin = webMethod(
  Permissions.SiteMember,
  async ({ contestantId, email, pin, contestant }) => {
    await requireArenaAdmin();
    const normalizedEmail = normalizeEmail(email);
    if (
      !contestantId ||
      !normalizedEmail ||
      !validPin(pin) ||
      !contestant ||
      contestant.id !== contestantId
    ) {
      throw new Error("Contestant email and a four-digit PIN are required.");
    }
    const duplicateEmail = await wixData
      .query(CREDENTIALS_COLLECTION)
      .eq("emailNormalized", normalizedEmail)
      .limit(1)
      .find(OPTIONS);
    if (
      duplicateEmail.items.length &&
      duplicateEmail.items[0].contestantId !== contestantId
    ) {
      throw new Error("That email is already used by another contestant login.");
    }
    const existing = await wixData
      .query(CREDENTIALS_COLLECTION)
      .eq("contestantId", contestantId)
      .limit(1)
      .find(OPTIONS);
    const pepper = await getSecret(PIN_PEPPER_SECRET);
    const salt = randomBytes(16).toString("hex");
    const existingContestant = await wixData
      .query(COLLECTIONS.contestants)
      .eq("appId", contestantId)
      .limit(1)
      .find(OPTIONS);
    const previousPayload = existingContestant.items[0]?.payload;
    const previousContestant =
      typeof previousPayload === "string"
        ? JSON.parse(previousPayload)
        : previousPayload || null;
    const normalizedContestant = normalizeContestantCasing(
      mergeContestantPhoto(
        { ...contestant, email: normalizedEmail },
        previousContestant,
      ),
    );
    await wixData.save(
      COLLECTIONS.contestants,
      {
        ...(existingContestant.items[0] || {}),
        appId: contestantId,
        payload: JSON.stringify(normalizedContestant),
      },
      OPTIONS,
    );
    const nextCredential = successfulCredentialMetadata({
      ...(existing.items[0] || {}),
      contestantId,
      emailNormalized: normalizedEmail,
      pinSalt: salt,
      pinHash: pinHash(pin, salt, pepper),
    });
    await wixData.save(CREDENTIALS_COLLECTION, nextCredential, OPTIONS);
    return { configured: true };
  },
);

export const createContestantAccount = webMethod(
  Permissions.Anyone,
  async (request) => {
    if (!validAppId(request.competitionId)) {
      throw new Error("Competition is unavailable.");
    }
    const name = String(request.name || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const email = normalizeEmail(request.email);
    const phone = String(request.phone || "").replace(/\D/g, "");
    const hometown = String(request.hometown || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const role = String(request.role || "");
    const headerHandicap = role === "Heeler" ? 0 : Number(request.headerHandicap);
    const heelerHandicap = role === "Header" ? 0 : Number(request.heelerHandicap);
    if (name.length < 2 || name.length > 100) {
      throw new Error("Enter your full name.");
    }
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254
    ) {
      throw new Error("Enter a valid email address.");
    }
    if (phone.length < 10 || phone.length > 15) {
      throw new Error("Enter a valid phone number.");
    }
    if (!["Header", "Heeler", "Both"].includes(role)) {
      throw new Error("Choose your roping position.");
    }
    if (
      !validPin(request.pin) ||
      !Number.isFinite(headerHandicap) ||
      !Number.isFinite(heelerHandicap) ||
      headerHandicap < 0 ||
      heelerHandicap < 0 ||
      headerHandicap > 20 ||
      heelerHandicap > 20
    ) {
      throw new Error("Enter valid handicaps and a four-digit PIN.");
    }
    const contestantId = `contestant-${createHash("sha256")
      .update(`contestant-phone:${phone}`)
      .digest("hex")
      .slice(0, 24)}`;
    const credentialId = createHash("sha256")
      .update(`contestant-credential:${email}`)
      .digest("hex")
      .slice(0, 32);
    const workspace = await readWorkspace();
    const event = workspace.events.find(
      (item) => item.id === request.competitionId,
    );
    if (!event) {
      throw new Error("This competition is not accepting new accounts.");
    }
    const matchingAccount = await findMatchingContestantAccount({
      credentialId,
      contestantId,
      email,
      phone,
      pin: request.pin,
    });
    if (matchingAccount) {
      return publicContestantAccountResult(workspace, event, matchingAccount);
    }
    if (event.status !== "Upcoming") {
      throw new Error("This competition is not accepting new accounts.");
    }
    assertOnlineRegistrationOpen(event);
    const duplicateEmail = await wixData
      .query(CREDENTIALS_COLLECTION)
      .eq("emailNormalized", email)
      .limit(1)
      .find(OPTIONS);
    if (duplicateEmail.items.length) {
      throw new Error("A contestant account already uses that email.");
    }
    if (
      workspace.contestants.some(
        (contestant) => normalizeEmail(contestant.email) === email,
      )
    ) {
      throw new Error("A contestant account already uses that email.");
    }
    if (
      workspace.contestants.some(
        (contestant) =>
          String(contestant.phone || "").replace(/\D/g, "") === phone,
      )
    ) {
      throw new Error("A contestant account already uses that phone number.");
    }
    const contestant = {
      id: contestantId,
      name,
      email,
      phone,
      hometown,
      role,
      headerHandicap,
      heelerHandicap,
      photo: "",
      source: "online",
      submittedAt: new Date().toISOString(),
    };
    const pepper = await getSecret(PIN_PEPPER_SECRET);
    const salt = randomBytes(16).toString("hex");
    try {
      await wixData.insert(
        CREDENTIALS_COLLECTION,
        {
          _id: credentialId,
          contestantId,
          emailNormalized: email,
          pinSalt: salt,
          pinHash: pinHash(request.pin, salt, pepper),
          failedAttempts: 0,
          updatedAt: new Date(),
        },
        OPTIONS,
      );
    } catch (error) {
      const retryAccount = await findMatchingContestantAccount({
        credentialId,
        contestantId,
        email,
        phone,
        pin: request.pin,
      });
      if (retryAccount) {
        return publicContestantAccountResult(workspace, event, retryAccount);
      }
      const conflictingCredential = await readOptionalItem(
        CREDENTIALS_COLLECTION,
        credentialId,
      );
      if (conflictingCredential) {
        throw new Error("A contestant account already uses that email.");
      }
      throw error;
    }
    try {
      const inserted = await insertUniqueArenaRecord(
        COLLECTIONS.contestants,
        contestant,
      );
      if (!inserted) {
        throw new Error("A contestant account already uses that phone number.");
      }
    } catch (error) {
      await wixData
        .remove(CREDENTIALS_COLLECTION, credentialId, OPTIONS)
        .catch(() => null);
      throw error;
    }
    await bumpRevision(ONLINE_REVISION_ID, {
      action: "createContestantAccount",
      contestantId,
      competitionId: request.competitionId,
    });
    return publicContestantAccountResult(workspace, event, contestant);
  },
);

export const createRiderAccount = webMethod(
  Permissions.Anyone,
  async (request) => {
    const name = String(request.name || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const email = normalizeEmail(request.email);
    const phone = String(request.phone || "").replace(/\D/g, "");
    const hometown = String(request.hometown || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const horseName = String(request.horseName || "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    const role = String(request.role || "");
    const headerHandicap = Number(request.headerHandicap);
    const heelerHandicap = Number(request.heelerHandicap);
    if (name.length < 2 || name.length > 100) throw new Error("Enter your full name.");
    if (horseName.length > 100) {
      throw new Error("Horse name must be 100 characters or fewer.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new Error("Enter a valid email address.");
    }
    if (phone.length < 10 || phone.length > 15) {
      throw new Error("Enter a valid phone number.");
    }
    if (!["Header", "Heeler", "Both"].includes(role)) {
      throw new Error("Choose your roping position.");
    }
    if (
      !validPin(request.pin) ||
      !Number.isFinite(headerHandicap) ||
      !Number.isFinite(heelerHandicap) ||
      headerHandicap < 0 ||
      heelerHandicap < 0 ||
      headerHandicap > 20 ||
      heelerHandicap > 20
    ) {
      throw new Error("Enter valid handicaps and a four-digit PIN.");
    }
    await ensureRiderAccountCollections();
    const contestantId = `contestant-${createHash("sha256")
      .update(`contestant-phone:${phone}`)
      .digest("hex")
      .slice(0, 24)}`;
    const [duplicateEmail, existingPhone] = await Promise.all([
      wixData
        .query(CREDENTIALS_COLLECTION)
        .eq("emailNormalized", email)
        .limit(1)
        .find(OPTIONS),
      wixData
        .query(COLLECTIONS.contestants)
        .eq("appId", contestantId)
        .limit(1)
        .find(OPTIONS),
    ]);
    if (duplicateEmail.items.length) {
      throw new Error("A rider account already uses that email.");
    }
    if (existingPhone.items.length) {
      throw new Error("A rider account already uses that phone number.");
    }
    const contestant = {
      id: contestantId,
      name,
      email,
      phone,
      hometown,
      role,
      headerHandicap,
      heelerHandicap,
      photo: "",
      horses: horseName ? [horseName] : [],
      source: "online",
      submittedAt: new Date().toISOString(),
    };
    const credentialId = createHash("sha256")
      .update(`contestant-credential:${email}`)
      .digest("hex")
      .slice(0, 32);
    const pepper = await getSecret(PIN_PEPPER_SECRET);
    const salt = randomBytes(16).toString("hex");
    const onlineRevision = await wixData
      .get(SETTINGS_COLLECTION, ONLINE_REVISION_ID, OPTIONS)
      .catch(() => null);
    await wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: ONLINE_REVISION_ID,
        value: Number(onlineRevision?.value || 0) + 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
    await wixData.insert(
      CREDENTIALS_COLLECTION,
      {
        _id: credentialId,
        contestantId,
        emailNormalized: email,
        pinSalt: salt,
        pinHash: pinHash(request.pin, salt, pepper),
        failedAttempts: 0,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
    try {
      await wixData.insert(
        COLLECTIONS.contestants,
        {
          appId: contestantId,
          payload: JSON.stringify(contestant),
        },
        OPTIONS,
      );
    } catch (error) {
      await wixData
        .remove(CREDENTIALS_COLLECTION, credentialId, OPTIONS)
        .catch(() => null);
      throw error;
    }
    return { contestantId, name };
  },
);

export const authenticateContestant = webMethod(
  Permissions.Anyone,
  async ({ email, pin }) => {
    const contestantId = await verifyContestantCredentials(email, pin);

    const [meets, events, contestants, teams, registrations] = await Promise.all([
      readAll(COLLECTIONS.meets),
      readAll(COLLECTIONS.events),
      readAll(COLLECTIONS.contestants),
      readAll(COLLECTIONS.teams),
      readAll(COLLECTIONS.registrations),
    ]);
    const contestant = contestants.find(
      (item) => item.id === contestantId,
    );
    if (!contestant) throw new Error("Contestant profile is unavailable.");
    const contestantTeams = teams.filter(
      (team) =>
        team.headerId === contestant.id || team.heelerId === contestant.id,
    );
    const contestantRegistrations = registrations.filter(
      (registration) => registration.contestantId === contestant.id,
    );
    const eventIds = new Set([
      ...contestantTeams.map((team) => team.eventId),
      ...contestantRegistrations.map((registration) => registration.eventId),
    ]);
    const portalEvents = events.filter((event) => eventIds.has(event.id));
    const meetIds = new Set(portalEvents.map((event) => event.parentEventId));
    const partnerIds = new Set(
      contestantTeams.flatMap((team) => [team.headerId, team.heelerId]),
    );
    return {
      contestant,
      contestants: contestants
        .filter((item) => partnerIds.has(item.id))
        .map((item) => ({ id: item.id, name: item.name })),
      meets: meets.filter((meet) => meetIds.has(meet.id)),
      events: portalEvents,
      registrations: contestantRegistrations,
      teams: contestantTeams,
    };
  },
);

async function persistCredentialSecurityMetadata(credential, context) {
  let lastError;
  for (let attempt = 1; attempt <= REVISION_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await wixData.update(
        CREDENTIALS_COLLECTION,
        credential,
        OPTIONS,
      );
      return true;
    } catch (error) {
      lastError = error;
      console.error("Contestant credential metadata update failed.", {
        context,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.error("Contestant credential metadata could not be persisted.", {
    context,
    message:
      lastError instanceof Error ? lastError.message : String(lastError),
  });
  return false;
}

async function withCredentialSecurityLock(normalizedEmail, callback) {
  await ensureCredentialLockCollection();
  const lockId = arenaRecordStorageId(
    CREDENTIAL_LOCKS_COLLECTION,
    normalizedEmail,
  );
  let acquired = false;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await wixData.insert(
        CREDENTIAL_LOCKS_COLLECTION,
        {
          _id: lockId,
          emailNormalized: normalizedEmail,
          expiresAt: new Date(Date.now() + 30 * 1000),
        },
        OPTIONS,
      );
      acquired = true;
      break;
    } catch (error) {
      const existing = await wixData
        .get(CREDENTIAL_LOCKS_COLLECTION, lockId, {
          ...OPTIONS,
          consistentRead: true,
        })
        .catch(() => null);
      if (existing && new Date(existing.expiresAt).getTime() <= Date.now()) {
        await wixData
          .remove(CREDENTIAL_LOCKS_COLLECTION, lockId, OPTIONS)
          .catch(() => undefined);
      } else if (!existing) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  if (!acquired) {
    throw new PublicSignupError(
      "AUTH_TEMPORARILY_UNAVAILABLE",
      "Login is temporarily unavailable. Try again in a few minutes.",
    );
  }
  try {
    return await callback();
  } finally {
    await wixData
      .remove(CREDENTIAL_LOCKS_COLLECTION, lockId, OPTIONS)
      .catch(() => undefined);
  }
}

async function verifyContestantCredentials(email, pin) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !validPin(pin)) {
    throw new PublicSignupError(
      "INVALID_CREDENTIALS",
      "Enter your email and four-digit PIN.",
    );
  }
  return withCredentialSecurityLock(normalizedEmail, () =>
    verifyContestantCredentialsUnlocked(normalizedEmail, pin),
  );
}

async function verifyContestantCredentialsUnlocked(normalizedEmail, pin) {
  const result = await wixData
    .query(CREDENTIALS_COLLECTION)
    .eq("emailNormalized", normalizedEmail)
    .limit(1)
    .find({ ...OPTIONS, consistentRead: true });
  const credential = result.items[0];
  const pepper = await getSecret(PIN_PEPPER_SECRET);
  if (!credential) {
    pinHash(pin, "missing-contestant-account", pepper);
    throw new PublicSignupError(
      "INVALID_CREDENTIALS",
      "Email or PIN is incorrect, or login is temporarily unavailable.",
    );
  }
  const lockExpiresAt = credential.lockedUntil
    ? new Date(credential.lockedUntil).getTime()
    : 0;
  if (
    lockExpiresAt > Date.now() ||
    typeof credential.pinSalt !== "string" ||
    typeof credential.pinHash !== "string"
  ) {
    throw new PublicSignupError(
      "INVALID_CREDENTIALS",
      "Email or PIN is incorrect, or login is temporarily unavailable.",
    );
  }
  const candidate = pinHash(pin, credential.pinSalt, pepper);
  if (!constantTimeEqual(candidate, credential.pinHash)) {
    const persisted = await persistCredentialSecurityMetadata(
      failedCredentialMetadata(
        credential,
        Date.now(),
        MAX_FAILED_ATTEMPTS,
        LOCK_MINUTES,
      ),
      "failed-pin-attempt",
    );
    if (!persisted) {
      throw new PublicSignupError(
        "AUTH_TEMPORARILY_UNAVAILABLE",
        "Login is temporarily unavailable. Try again in a few minutes.",
      );
    }
    throw new PublicSignupError(
      "INVALID_CREDENTIALS",
      "Email or PIN is incorrect, or login is temporarily unavailable.",
    );
  }
  if (credential.failedAttempts || credential.lockedUntil) {
    const persisted = await persistCredentialSecurityMetadata(
      successfulCredentialMetadata(credential),
      "successful-pin-reset",
    );
    if (!persisted) {
      throw new PublicSignupError(
        "AUTH_TEMPORARILY_UNAVAILABLE",
        "Login is temporarily unavailable. Try again in a few minutes.",
      );
    }
  }
  return credential.contestantId;
}

const validAppId = (value) => /^[a-zA-Z0-9_-]{1,100}$/.test(String(value || ""));
const contestantCanRole = (contestant, role) =>
  contestant.role === "Both" || contestant.role === role;
const handicapTotal = (header, heeler) =>
  Number(header?.headerHandicap || 0) + Number(heeler?.heelerHandicap || 0);
const contestantWithinHandicap = (event, contestant, role) =>
  Number(role === "Header" ? contestant?.headerHandicap || 0 : contestant?.heelerHandicap || 0) <=
  Number(event.maxContestantHandicap ?? 99);

function availablePartners(workspace, event, contestant) {
  return workspace.contestants
    .filter((partner) => {
      if (partner.id === contestant.id) return false;
      const canHeeler =
        contestantCanRole(contestant, "Header") &&
        contestantWithinHandicap(event, contestant, "Header") &&
        contestantCanRole(partner, "Heeler") &&
        contestantWithinHandicap(event, partner, "Heeler") &&
        handicapTotal(contestant, partner) <= event.handicapTotal;
      const canHeader =
        contestantCanRole(contestant, "Heeler") &&
        contestantWithinHandicap(event, contestant, "Heeler") &&
        contestantCanRole(partner, "Header") &&
        contestantWithinHandicap(event, partner, "Header") &&
        handicapTotal(partner, contestant) <= event.handicapTotal;
      return canHeader || canHeeler;
    })
    .map(({ id, name, role, headerHandicap, heelerHandicap }) => ({
      id,
      name,
      role,
      headerHandicap,
      heelerHandicap,
    }));
}

export const loadSignupOptions = webMethod(
  Permissions.Anyone,
  async ({ email, pin }) =>
    publicSignupEnvelope("loadSignupOptions", async () => {
      const contestantId = await verifyContestantCredentials(email, pin);
      return loadPublicSignupOptions(contestantId);
    }),
);

export const createPublicSignupPayment = webMethod(
  Permissions.Anyone,
  async (request) =>
    publicSignupEnvelope("createPublicSignupPayment", () =>
      createPublicSignupPaymentIntent(request),
    ),
);

export const getPublicSignupPaymentStatus = webMethod(
  Permissions.Anyone,
  async (request) =>
    publicSignupEnvelope("getPublicSignupPaymentStatus", () =>
      readPublicSignupPaymentStatus(request),
    ),
);

async function insertUniqueArenaRecord(collectionId, record) {
  const storageId = arenaRecordStorageId(collectionId, record.id);
  try {
    await wixData.insert(
      collectionId,
      { _id: storageId, appId: record.id, payload: JSON.stringify(record) },
      OPTIONS,
    );
    return true;
  } catch (error) {
    const existing = await wixData
      .get(collectionId, storageId, OPTIONS)
      .catch(() => null);
    if (existing?.appId === record.id) return false;
    throw error;
  }
}

async function createRegistrationDeskSignupRecords(request) {
  const eventId = request?.eventId;
  if (!validAppId(eventId)) {
    throw new Error("Invalid signup request.");
  }
  const workspace = await readWorkspace();
  const event = workspace.events.find((item) => item.id === eventId);
  if (!event) throw new Error("Competition not found.");
  assertRegistrationDeskOpen(event);
  const prepared = prepareRegistrationDeskSignup(workspace, request);
  const submissionFingerprint = createHash("sha256")
    .update(JSON.stringify(prepared.fingerprintPayload))
    .digest("hex");
  const repeated = registrationDeskSignupIsRetry(
    workspace,
    prepared,
    submissionFingerprint,
  );
  const metadata = {
    submissionFingerprint,
    submittedAt: new Date().toISOString(),
  };
  const registrations = prepared.registrations.map((registration) => ({
    ...registration,
    ...metadata,
  }));
  const teams = prepared.teams.map((team) => ({ ...team, ...metadata }));

  const insertResults = await Promise.allSettled([
    ...teams.map((team) => insertUniqueArenaRecord(COLLECTIONS.teams, team)),
    ...registrations.map((registration) =>
      insertUniqueArenaRecord(COLLECTIONS.registrations, registration),
    ),
  ]);
  const failedInsert = insertResults.find(
    (result) => result.status === "rejected",
  );
  if (failedInsert) throw failedInsert.reason;
  await bumpRevision(STAFF_REVISION_ID, {
    action: "submitRegistrationDeskSignup",
    entryType: prepared.canonicalRequest.entryType,
    payerContestantId: prepared.canonicalRequest.payerContestantId,
    competitionId: event.id,
    submissionId: request.submissionId,
  });
  const freshWorkspace = await readWorkspace();
  await savePublicScheduleSnapshot(freshWorkspace);
  return {
    submissionId: request.submissionId,
    competitionId: event.id,
    entryType: prepared.canonicalRequest.entryType,
    payerContestantId: prepared.canonicalRequest.payerContestantId,
    recordIds: prepared.recordIds,
    existing: repeated,
    data: registrationDeskProjection(freshWorkspace),
  };
}

export const submitOnlineSignup = webMethod(
  Permissions.Anyone,
  async () =>
    publicSignupEnvelope("submitOnlineSignup", () => {
      throw new PublicSignupError(
        "PAYMENT_REQUIRED",
        "Online entries now require Wix checkout. Reload registration and try again.",
      );
    }),
);

export const submitRegistrationDeskSignup = webMethod(
  Permissions.SiteMember,
  async (request) => {
    await requireRegistrationDesk();
    const result = await createRegistrationDeskSignupRecords(request);
    return {
      ...result,
      summary: result.existing
        ? "That entry is already saved."
        : request.paymentMethod === "tab"
          ? "Contestant tab opened. Entries were sent to the draw area."
          : "Payment recorded. Contestant entries were sent to the draw area.",
      data: result.data,
    };
  },
);

export const submitSpectatorPrediction = webMethod(
  Permissions.Anyone,
  async (request) => {
    if (
      !validAppId(request.eventId) ||
      !validAppId(request.teamId) ||
      !["steer", "cowboys"].includes(request.choice)
    ) {
      throw new Error("Invalid spectator prediction.");
    }
    const name = String(request.name || "").trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 80) {
      throw new Error("Enter your full name.");
    }
    const workspace = await readWorkspace();
    const event = workspace.events.find((item) => item.id === request.eventId);
    const team = workspace.teams.find(
      (item) => item.id === request.teamId && item.eventId === request.eventId,
    );
    assertSpectatorPredictionRunIsActive(event, team, workspace.teams);
    const normalizedName = name.toLowerCase();
    const existingSpectator = workspace.spectators.find(
      (item) => String(item.name || "").trim().toLowerCase() === normalizedName,
    );
    const spectatorId = existingSpectator?.id || `spectator-${createHash("sha256")
      .update(normalizedName)
      .digest("hex")
      .slice(0, 24)}`;
    const spectator = existingSpectator || workspace.spectators.find(
      (item) => item.id === spectatorId,
    );
    let nextSpectator = spectator || {
      id: spectatorId,
      name,
      createdAt: new Date().toISOString(),
    };
    const predictionId = `prediction-${spectatorId}-${team.id}`;
    const existing = workspace.spectatorPredictions.find(
      (prediction) => prediction.id === predictionId,
    );
    let predictionInserted = false;
    if (!existing) {
      if (!spectator) {
        const spectatorInserted = await insertUniqueArenaRecord(
          COLLECTIONS.spectators,
          nextSpectator,
        );
        if (!spectatorInserted) {
          const latestSpectators = await readAll(COLLECTIONS.spectators);
          const persistedSpectator = latestSpectators.find(
            (item) => item.id === spectatorId,
          );
          if (
            !persistedSpectator ||
            persistedSpectator.name.trim().toLowerCase() !== normalizedName
          ) {
            throw new Error("That spectator name could not be registered.");
          }
          nextSpectator = persistedSpectator;
        }
      }
      predictionInserted = await insertUniqueArenaRecord(
        COLLECTIONS.spectatorPredictions,
        {
          id: predictionId,
          spectatorId,
          eventId: event.id,
          teamId: team.id,
          round: Number(team.round || 1),
          choice: request.choice,
          submittedAt: new Date().toISOString(),
        },
      );
      if (predictionInserted) {
        await wixData.save(
          SETTINGS_COLLECTION,
          {
            _id: ONLINE_REVISION_ID,
            value: workspace.onlineRevision + 1,
            updatedAt: new Date(),
          },
          OPTIONS,
        );
      }
    }
    const latest = await readWorkspace();
    return {
      spectatorName: nextSpectator.name,
      existing: Boolean(existing) || !predictionInserted,
      publicData: publicProjection(latest),
    };
  },
);