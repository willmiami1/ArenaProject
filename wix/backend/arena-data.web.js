import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";
import { getSecret } from "wix-secrets-backend";
import { createHash, randomBytes } from "crypto";
import { currentMember } from "wix-members-backend";

const COLLECTIONS = {
  meets: "ArenaMeets",
  events: "ArenaCompetitions",
  contestants: "ArenaContestants",
  teams: "ArenaTeams",
  registrations: "ArenaRegistrations",
  spectators: "ArenaSpectators",
  spectatorPredictions: "ArenaSpectatorPredictions",
};
const SETTINGS_COLLECTION = "ArenaSettings";
const CREDENTIALS_COLLECTION = "ArenaContestantCredentials";
const SETTINGS_ID = "arena-command-settings";
const STAFF_REVISION_ID = "arena-command-staff-revision";
const ONLINE_REVISION_ID = "arena-command-online-revision";
const OPTIONS = { suppressAuth: true };
const PIN_PEPPER_SECRET = "ArenaContestantPinPepper";
const ADMIN_ROLE_SECRET = "ArenaAdminRoleId";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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
      getSecret(ADMIN_ROLE_SECRET),
    ]);
    if (
      typeof configuredRoleId === "string" &&
      configuredRoleId.trim() &&
      roles.some((role) => role._id === configuredRoleId.trim())
    ) {
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

export const getAdminAccess = webMethod(
  Permissions.Anyone,
  resolveAdminAccess,
);

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

async function readWorkspace() {
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
    readAll(COLLECTIONS.spectators),
    readAll(COLLECTIONS.spectatorPredictions),
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
  team.status === "complete" && team.rawTime !== null
    ? "cowboys"
    : team.status === "no-time"
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
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const competitions = workspace.events.map((event) => ({
      id: event.id,
      parentEventId: event.parentEventId,
      name: event.name,
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
      registrationOpen: event.registrationOpen === true,
      drawLocked: event.drawLocked === true,
      resultsPublished: event.resultsPublished === true,
      entriesAllowed: event.entriesAllowed,
      allowRepeatPartners: event.allowRepeatPartners === true,
      handicapTotal: event.handicapTotal,
      maxContestantHandicap: Number(event.maxContestantHandicap ?? 99),
      timeLimit: event.timeLimit,
      rounds: event.rounds,
      shortGoTeams: event.shortGoTeams,
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
      results: publishedResults(event, workspace.teams, workspace.contestants),
      predictionRuns: workspace.teams
        .filter(
          (team) =>
            team.eventId === event.id &&
            !team.scratched &&
            team.status === "ready" &&
            Boolean(team.predictionClosesAt),
        )
        .sort(
          (left, right) =>
            Number(left.round) - Number(right.round) ||
            Number(left.drawPosition) - Number(right.drawPosition),
        )
        .map((team) => {
          const names = new Map(
            workspace.contestants.map((contestant) => [
              contestant.id,
              contestant.name,
            ]),
          );
          return {
            id: team.id,
            round: Number(team.round || 1),
            drawPosition: Number(team.drawPosition),
            headerName: names.get(team.headerId) || "Unknown",
            heelerName: names.get(team.heelerId) || "Unknown",
            steerNumber: team.steerNumber || "",
            closesAt: team.predictionClosesAt,
            open: Date.parse(team.predictionClosesAt) > Date.now(),
          };
        }),
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
    const order = { live: 0, future: 1, past: 2 };
    const meets = workspace.meets
      .map((meet) => {
        const children = competitions.filter(
          (competition) => competition.parentEventId === meet.id,
        );
        const live = children.some((competition) => competition.status === "Live");
        const allComplete =
          children.length > 0 &&
          children.every((competition) => competition.status === "Complete");
        const group = live
          ? "live"
          : !allComplete && meet.date >= todayKey
            ? "future"
            : "past";
        return {
          id: meet.id,
          name: meet.name,
          date: meet.date,
          startTime: meet.startTime,
          location: meet.location,
          producer: meet.producer || "",
          group,
          competitions: children,
        };
      })
      .sort((left, right) => {
        if (left.group !== right.group) return order[left.group] - order[right.group];
        const result = `${left.date}T${left.startTime}`.localeCompare(
          `${right.date}T${right.startTime}`,
        );
        return left.group === "past" ? -result : result;
      });
    return { generatedAt: new Date().toISOString(), meets };
}

const mergeOnline = (incoming, latest) => {
  const ids = new Set(incoming.map((record) => record.id));
  return [
    ...incoming,
    ...latest.filter((record) => record.source === "online" && !ids.has(record.id)),
  ];
};

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

export const loadArenaData = webMethod(Permissions.SiteMember, async () => {
  await requireArenaAdmin();
  const settings = await wixData
    .get(SETTINGS_COLLECTION, SETTINGS_ID, OPTIONS)
    .catch(() => null);
  if (!settings) return null;

  return readWorkspace();
});

export const saveArenaData = webMethod(Permissions.SiteMember, async (data) => {
  await requireArenaAdmin();
  const latest = await readWorkspace();
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
    [...latest.teams, ...latest.registrations].some(
      (record) =>
        record.source === "online" &&
        Date.parse(record.submittedAt || "") > loadedAt,
    );
  const next = {
    ...data,
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
  ]);
  return readWorkspace();
});

export const loadPublicArenaData = webMethod(Permissions.Anyone, async () =>
  publicProjection(await readWorkspace()),
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

export const createContestantAccount = webMethod(
  Permissions.Anyone,
  async (request) => {
    if (!validAppId(request.competitionId)) {
      throw new Error("Competition is unavailable.");
    }
    const name = String(request.name || "").trim().replace(/\s+/g, " ");
    const email = normalizeEmail(request.email);
    const phone = String(request.phone || "").replace(/\D/g, "");
    const hometown = String(request.hometown || "").trim().replace(/\s+/g, " ");
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
    const workspace = await readWorkspace();
    const event = workspace.events.find(
      (item) => item.id === request.competitionId,
    );
    if (
      !event ||
      event.status !== "Upcoming" ||
      !event.registrationOpen ||
      event.drawLocked
    ) {
      throw new Error("This competition is not accepting new accounts.");
    }
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
    const contestantId = `contestant-${createHash("sha256")
      .update(`contestant-phone:${phone}`)
      .digest("hex")
      .slice(0, 24)}`;
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
    };
    const credentialId = createHash("sha256")
      .update(`contestant-credential:${email}`)
      .digest("hex")
      .slice(0, 32);
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
          lockedUntil: null,
          updatedAt: new Date(),
        },
        OPTIONS,
      );
    } catch {
      throw new Error("A contestant account already uses that email.");
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
    await wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: ONLINE_REVISION_ID,
        value: workspace.onlineRevision + 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
    const updatedWorkspace = {
      ...workspace,
      contestants: [...workspace.contestants, contestant],
    };
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
          ? availablePartners(updatedWorkspace, event, contestant)
          : [],
    };
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

async function verifyContestantCredentials(email, pin) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !validPin(pin)) {
    throw new Error("Enter your email and four-digit PIN.");
  }
  const result = await wixData
    .query(CREDENTIALS_COLLECTION)
    .eq("emailNormalized", normalizedEmail)
    .limit(1)
    .find(OPTIONS);
  const credential = result.items[0];
  const pepper = await getSecret(PIN_PEPPER_SECRET);
  if (!credential) {
    pinHash(pin, "missing-contestant-account", pepper);
    throw new Error("Email or PIN is incorrect, or login is temporarily unavailable.");
  }
  const lockExpiresAt = credential.lockedUntil
    ? new Date(credential.lockedUntil).getTime()
    : 0;
  if (
    lockExpiresAt > Date.now() ||
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
  async ({ competitionId, email, pin }) => {
    if (!validAppId(competitionId)) throw new Error("Competition is unavailable.");
    const contestantId = await verifyContestantCredentials(email, pin);
    const workspace = await readWorkspace();
    const event = workspace.events.find((item) => item.id === competitionId);
    const contestant = workspace.contestants.find((item) => item.id === contestantId);
    if (!event || !contestant) throw new Error("Competition or contestant is unavailable.");
    if (!event.registrationOpen || event.status === "Complete" || event.drawLocked) {
      throw new Error("Online registration is closed for this competition.");
    }
    const privateContestant = ({
      id,
      name,
      role,
      headerHandicap,
      heelerHandicap,
    }) => ({ id, name, role, headerHandicap, heelerHandicap });
    return {
      contestant: privateContestant(contestant),
      partners:
        event.competitionType === "pick-only" ||
        event.competitionType === "pick-and-draw"
          ? availablePartners(workspace, event, contestant)
          : [],
    };
  },
);

async function insertArenaRecord(collectionId, record) {
  const existing = await wixData
    .query(collectionId)
    .eq("appId", record.id)
    .limit(1)
    .find(OPTIONS);
  if (existing.items.length) return false;
  await wixData.insert(
    collectionId,
    { appId: record.id, payload: JSON.stringify(record) },
    OPTIONS,
  );
  return true;
}

async function insertUniqueArenaRecord(collectionId, record) {
  const storageId = createHash("sha256")
    .update(`${collectionId}:${record.id}`)
    .digest("hex")
    .slice(0, 32);
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

export const submitOnlineSignup = webMethod(
  Permissions.Anyone,
  async (request) => {
    if (
      !validAppId(request.competitionId || request.eventId) ||
      !validAppId(request.contestantId) ||
      !validAppId(request.submissionId)
    ) {
      throw new Error("Invalid signup request.");
    }
    const eventId = request.competitionId || request.eventId;
    const authenticatedId = await verifyContestantCredentials(
      request.email,
      request.pin,
    );
    if (authenticatedId !== request.contestantId) {
      throw new Error("Contestant account does not match this entry.");
    }
    const workspace = await readWorkspace();
    const event = workspace.events.find((item) => item.id === eventId);
    const contestant = workspace.contestants.find(
      (item) => item.id === authenticatedId,
    );
    if (!event || !contestant) throw new Error("Competition or contestant not found.");
    if (!event.registrationOpen) throw new Error("Registration is closed.");
    if (event.status === "Complete") throw new Error("This competition is complete.");
    if (event.drawLocked) throw new Error("The draw is locked.");

    const priorTeams = workspace.teams.filter(
      (team) => team.submissionId === request.submissionId,
    );
    const priorRegistrations = workspace.registrations.filter(
      (registration) => registration.submissionId === request.submissionId,
    );
    const repeated = priorTeams.length > 0 || priorRegistrations.length > 0;

    const submittedAt = new Date().toISOString();
    const metadata = {
      paid: false,
      source: "online",
      submissionId: request.submissionId,
      submittedAt,
    };
    const registrations = [];
    const teams = [];
    if (
      event.competitionType === "draw-pot" ||
      event.competitionType === "round-robin"
    ) {
      const entries = Number(request.entries);
      if (
        !["Header", "Heeler"].includes(request.role) ||
        !contestantCanRole(contestant, request.role) ||
        !Number.isInteger(entries) ||
        entries < 1 ||
        entries > Number(event.entriesAllowed || 1)
      ) {
        throw new Error("Choose a valid role and entry count.");
      }
      if (!contestantWithinHandicap(event, contestant, request.role)) {
        throw new Error("Contestant handicap exceeds the competition limit.");
      }
      const entered = workspace.registrations
        .filter(
          (registration) =>
            registration.eventId === event.id &&
            registration.contestantId === contestant.id &&
            registration.submissionId !== request.submissionId &&
            registration.status !== "scratched",
        )
        .reduce((sum, registration) => sum + Number(registration.entries || 0), 0);
      if (entered + entries > event.entriesAllowed) {
        throw new Error("Entry limit exceeded.");
      }
      registrations.push({
        id: `online-registration-${request.submissionId}`,
        eventId: event.id,
        contestantId: contestant.id,
        role: request.role,
        entries,
        checkedIn: false,
        status: "entered",
        notes: "",
        ...metadata,
      });
    } else {
      if (!["Header", "Heeler"].includes(request.role)) {
        throw new Error("Choose your team position.");
      }
      const partner = workspace.contestants.find(
        (item) => item.id === request.partnerId,
      );
      if (!partner || partner.id === contestant.id) {
        throw new Error("Choose an eligible partner.");
      }
      const header = request.role === "Header" ? contestant : partner;
      const heeler = request.role === "Heeler" ? contestant : partner;
      if (
        !contestantCanRole(header, "Header") ||
        !contestantCanRole(heeler, "Heeler") ||
        !contestantWithinHandicap(event, header, "Header") ||
        !contestantWithinHandicap(event, heeler, "Heeler")
      ) {
        throw new Error("A contestant handicap exceeds the competition limit.");
      }
      if (handicapTotal(header, heeler) > event.handicapTotal) {
        throw new Error("Team handicap exceeds the competition limit.");
      }
      const activeTeams = workspace.teams.filter(
        (team) =>
          team.eventId === event.id &&
          team.round === 1 &&
          !team.generated &&
          !team.scratched &&
          team.submissionId !== request.submissionId,
      );
      if (
        !event.allowRepeatPartners &&
        activeTeams.some(
          (team) => team.headerId === header.id && team.heelerId === heeler.id,
        )
      ) {
        throw new Error("That partnership is already entered.");
      }
      const entryCount = (contestantId) =>
        activeTeams.filter(
          (team) =>
            team.headerId === contestantId || team.heelerId === contestantId,
        ).length;
      if (
        entryCount(header.id) >= event.entriesAllowed ||
        entryCount(heeler.id) >= event.entriesAllowed
      ) {
        throw new Error("Entry limit exceeded.");
      }
      const teamId = `online-team-${request.submissionId}`;
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
      if (event.competitionType === "pick-and-draw") {
        const roles =
          event.pickDrawRole === "both"
            ? ["Header", "Heeler"]
            : [event.pickDrawRole === "header" ? "Header" : "Heeler"];
        roles.forEach((role, index) => {
          registrations.push({
            id: `online-registration-${request.submissionId}-${index + 1}`,
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
      }
    }

    await Promise.all([
      ...teams.map((team) => insertArenaRecord(COLLECTIONS.teams, team)),
      ...registrations.map((registration) =>
        insertArenaRecord(COLLECTIONS.registrations, registration),
      ),
    ]);
    await wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: ONLINE_REVISION_ID,
        value: workspace.onlineRevision + 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
    return {
      submissionId: request.submissionId,
      competitionId: event.id,
      summary: repeated
        ? `Your entry in ${event.name} is already confirmed and pending payment.`
        : `Entry confirmed for ${event.name}. Payment is due with arena staff.`,
      existing: repeated,
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
    const phone = String(request.phone || "").replace(/\D/g, "");
    if (name.length < 2 || name.length > 80) {
      throw new Error("Enter your full name.");
    }
    if (phone.length < 10 || phone.length > 15) {
      throw new Error("Enter a valid phone number.");
    }
    const workspace = await readWorkspace();
    const event = workspace.events.find((item) => item.id === request.eventId);
    const team = workspace.teams.find(
      (item) => item.id === request.teamId && item.eventId === request.eventId,
    );
    if (!event || event.status !== "Live" || !team || team.scratched) {
      throw new Error("That live run is not available.");
    }
    if (
      team.status !== "ready" ||
      !team.predictionClosesAt ||
      Date.parse(team.predictionClosesAt) <= Date.now()
    ) {
      throw new Error("Predictions are closed for this run.");
    }
    const spectatorId = `spectator-${createHash("sha256")
      .update(phone)
      .digest("hex")
      .slice(0, 24)}`;
    const spectator = workspace.spectators.find(
      (item) => item.id === spectatorId,
    );
    if (
      spectator &&
      spectator.name.trim().toLowerCase() !== name.toLowerCase()
    ) {
      throw new Error("That phone number is registered to a different name.");
    }
    let nextSpectator = spectator || {
      id: spectatorId,
      name,
      phone,
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
          const latestSpectators = await readCollection(COLLECTIONS.spectators);
          const persistedSpectator = latestSpectators.find(
            (item) => item.id === spectatorId,
          );
          if (
            !persistedSpectator ||
            persistedSpectator.name.trim().toLowerCase() !== name.toLowerCase()
          ) {
            throw new Error("That phone number is registered to a different name.");
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
