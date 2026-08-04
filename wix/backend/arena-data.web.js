import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";
import { getSecret } from "wix-secrets-backend";
import { createHash, randomBytes } from "crypto";

const COLLECTIONS = {
  meets: "ArenaMeets",
  events: "ArenaCompetitions",
  contestants: "ArenaContestants",
  teams: "ArenaTeams",
  registrations: "ArenaRegistrations",
};
const SETTINGS_COLLECTION = "ArenaSettings";
const CREDENTIALS_COLLECTION = "ArenaContestantCredentials";
const SETTINGS_ID = "arena-command-settings";
const OPTIONS = { suppressAuth: true };
const PIN_PEPPER_SECRET = "ArenaContestantPinPepper";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
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

async function readAll(collectionId) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const items = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.map((item) => JSON.parse(item.payload));
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

export const loadArenaData = webMethod(Permissions.Admin, async () => {
  const settings = await wixData
    .get(SETTINGS_COLLECTION, SETTINGS_ID, OPTIONS)
    .catch(() => null);
  if (!settings) return null;

  const [meets, events, contestants, teams, registrations] = await Promise.all([
    readAll(COLLECTIONS.meets),
    readAll(COLLECTIONS.events),
    readAll(COLLECTIONS.contestants),
    readAll(COLLECTIONS.teams),
    readAll(COLLECTIONS.registrations),
  ]);
  return {
    participantDatabaseVersion: settings.participantDatabaseVersion || 1,
    meets,
    events,
    contestants,
    teams,
    registrations,
    activeEventId: settings.activeEventId || "",
  };
});

export const saveArenaData = webMethod(Permissions.Admin, async (data) => {
  await Promise.all([
    replaceAll(COLLECTIONS.meets, data.meets || []),
    replaceAll(COLLECTIONS.events, data.events || []),
    replaceAll(COLLECTIONS.contestants, data.contestants || []),
    replaceAll(COLLECTIONS.teams, data.teams || []),
    replaceAll(COLLECTIONS.registrations, data.registrations || []),
  ]);
  await wixData.save(
    SETTINGS_COLLECTION,
    {
      _id: SETTINGS_ID,
      activeEventId: data.activeEventId || "",
      participantDatabaseVersion: data.participantDatabaseVersion || 1,
      updatedAt: new Date(),
    },
    OPTIONS,
  );
  return { saved: true };
});

export const setContestantPin = webMethod(
  Permissions.Admin,
  async ({ contestantId, email, pin, contestant }) => {
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
    await wixData.save(
      COLLECTIONS.contestants,
      {
        ...(existingContestant.items[0] || {}),
        appId: contestantId,
        payload: JSON.stringify(contestant),
      },
      OPTIONS,
    );
    await wixData.save(
      CREDENTIALS_COLLECTION,
      {
        ...(existing.items[0] || {}),
        contestantId,
        emailNormalized: normalizedEmail,
        pinSalt: salt,
        pinHash: pinHash(pin, salt, pepper),
        failedAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
    return { configured: true };
  },
);

export const authenticateContestant = webMethod(
  Permissions.Anyone,
  async ({ email, pin }) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !validPin(pin)) {
      throw new Error("Enter your email and four-digit PIN.");
    }
    const credentialResult = await wixData
      .query(CREDENTIALS_COLLECTION)
      .eq("emailNormalized", normalizedEmail)
      .limit(1)
      .find(OPTIONS);
    const credential = credentialResult.items[0];
    const pepper = await getSecret(PIN_PEPPER_SECRET);
    if (!credential) {
      pinHash(pin, "missing-contestant-account", pepper);
      throw new Error("Email or PIN is incorrect, or login is temporarily unavailable.");
    }
    const lockExpiresAt = credential.lockedUntil
      ? new Date(credential.lockedUntil).getTime()
      : 0;
    if (lockExpiresAt > Date.now()) {
      throw new Error("Email or PIN is incorrect, or login is temporarily unavailable.");
    }
    if (
      typeof credential.pinSalt !== "string" ||
      typeof credential.pinHash !== "string"
    ) {
      throw new Error("Email or PIN is incorrect, or login is temporarily unavailable.");
    }
    const candidate = pinHash(pin, credential.pinSalt, pepper);
    if (!constantTimeEqual(candidate, credential.pinHash)) {
      const failedAttempts =
        (lockExpiresAt && lockExpiresAt <= Date.now()
          ? 0
          : credential.failedAttempts || 0) + 1;
      await wixData.update(
        CREDENTIALS_COLLECTION,
        {
          ...credential,
          failedAttempts,
          lockedUntil:
            failedAttempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
              : null,
        },
        OPTIONS,
      );
      throw new Error("Email or PIN is incorrect, or login is temporarily unavailable.");
    }
    await wixData.update(
      CREDENTIALS_COLLECTION,
      { ...credential, failedAttempts: 0, lockedUntil: null },
      OPTIONS,
    );

    const [meets, events, contestants, teams, registrations] = await Promise.all([
      readAll(COLLECTIONS.meets),
      readAll(COLLECTIONS.events),
      readAll(COLLECTIONS.contestants),
      readAll(COLLECTIONS.teams),
      readAll(COLLECTIONS.registrations),
    ]);
    const contestant = contestants.find(
      (item) => item.id === credential.contestantId,
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
