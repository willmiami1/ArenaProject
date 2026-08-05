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
const REGISTRATION_ROLE_SECRET = "ArenaRegistrationRoleId";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const ONLINE_REGISTRATION_LEAD_MS = 60 * 60 * 1000;

const registrationClosesAt = (event) =>
  new Date(`${event.date}T${event.startTime}:00`).getTime() -
  ONLINE_REGISTRATION_LEAD_MS;

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
const registrationDeskIsOpen = (event) =>
  event.status === "Live" &&
  event.registrationOpen === true &&
  event.drawLocked !== true;

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
    if (roles.some((role) => allowedRoleIds.includes(role._id))) {
      return {
        state: "authorized",
        message: "Registration Desk access verified.",
      };
    }
    return {
      state: "denied",
      message:
        "Your Wix account does not have the Registration Desk role.",
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
    const publicProfilePhoto = (photo) => {
      if (
        typeof photo !== "string" ||
        photo.length > 3000000 ||
        !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(photo)
      ) {
        return undefined;
      }
      return photo;
    };
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
      registrationClosesAt: new Date(registrationClosesAt(event)).toISOString(),
      drawLocked: event.drawLocked === true,
      resultsPublished: event.resultsPublished === true,
      entriesAllowed: event.entriesAllowed,
      minDrawsAllowed: Number(event.minDrawsAllowed ?? 0),
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
            team.status === "ready",
        )
        .sort(
          (left, right) =>
            Number(left.round) - Number(right.round) ||
            Number(left.drawPosition) - Number(right.drawPosition),
        )
        .map((team) => {
          const header = contestantsById.get(team.headerId);
          const heeler = contestantsById.get(team.heelerId);
          return {
            id: team.id,
            round: Number(team.round || 1),
            drawPosition: Number(team.drawPosition),
            headerName: header?.name || "Unknown",
            heelerName: heeler?.name || "Unknown",
            headerPhoto: publicProfilePhoto(header?.photo),
            heelerPhoto: publicProfilePhoto(heeler?.photo),
            steerNumber: team.steerNumber || "",
            closesAt: team.predictionClosesAt,
            open:
              !team.predictionClosesAt ||
              Date.parse(team.predictionClosesAt) > Date.now(),
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

function registrationDeskProjection(workspace) {
  const events = workspace.events.filter(registrationDeskIsOpen);
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
      }),
    ),
    contestants: workspace.contestants,
    teams: workspace.teams
      .filter((team) => eventIds.has(team.eventId) && Number(team.round) === 1)
      .map((team) => ({
        id: team.id,
        eventId: team.eventId,
        headerId: team.headerId,
        heelerId: team.heelerId,
        drawPosition: Number(team.drawPosition || 0),
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
    const name = String(input.name || "").trim().replace(/\s+/g, " ");
    const email = normalizeEmail(input.email);
    const phone = String(input.phone || "").trim();
    const id = input.id || `desk-contestant-${Date.now()}-${randomBytes(4).toString("hex")}`;
    const headerHandicap = Number(input.headerHandicap);
    const heelerHandicap = Number(input.heelerHandicap);
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
    const previous = workspace.contestants.find((contestant) => contestant.id === id);
    const contestant = {
      id,
      name,
      role: input.role,
      headerHandicap,
      heelerHandicap,
      photo: previous?.photo || "",
      phone,
      email,
      hometown: String(input.hometown || "").trim(),
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
    await wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: STAFF_REVISION_ID,
        value: workspace.staffRevision + 1,
        updatedAt: new Date(),
      },
      OPTIONS,
    );
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
    await wixData.save(
      CREDENTIALS_COLLECTION,
      {
        ...(existingCredential.items[0] || {}),
        contestantId,
        emailNormalized: email,
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
    if (!event || event.status !== "Upcoming") {
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
      if (
        event.competitionType === "pick-and-draw" &&
        !workspace.registrations.some(
          (registration) =>
            registration.eventId === event.id &&
            registration.contestantId === partner.id &&
            !registration.sourceTeamId &&
            registration.status === "entered" &&
            Number(registration.entries) > 0,
        )
      ) {
        return false;
      }
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
    assertOnlineRegistrationOpen(event);
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

async function insertUniqueArenaRecord(collectionId, record) {
  const existing = await wixData
    .query(collectionId)
    .eq("appId", record.id)
    .limit(1)
    .find(OPTIONS);
  if (existing.items.length) return false;
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

async function createSignupRecords(request, authenticatedId, source) {
    if (
      !validAppId(request.competitionId || request.eventId) ||
      !validAppId(request.contestantId) ||
      !validAppId(request.submissionId)
    ) {
      throw new Error("Invalid signup request.");
    }
    const eventId = request.competitionId || request.eventId;
    if (authenticatedId !== request.contestantId) {
      throw new Error("Contestant account does not match this entry.");
    }
    const workspace = await readWorkspace();
    const event = workspace.events.find((item) => item.id === eventId);
    const contestant = workspace.contestants.find(
      (item) => item.id === authenticatedId,
    );
    if (!event || !contestant) throw new Error("Competition or contestant not found.");
    if (source === "staff") {
      assertRegistrationDeskOpen(event);
    } else {
      assertOnlineRegistrationOpen(event);
    }
    const normalizedPartnerIds =
      event.competitionType === "pick-and-draw" &&
      Array.isArray(request.partnerIds)
        ? [...new Set(request.partnerIds)].sort()
        : request.partnerId
          ? [request.partnerId]
          : [];
    const submissionFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          source,
          eventId,
          contestantId: authenticatedId,
          role: request.role || "",
          drawRole: request.drawRole || "",
          entries:
            request.entries === undefined ? null : Number(request.entries),
          partnerIds: normalizedPartnerIds,
          paymentMethod: source === "staff" ? request.paymentMethod || "" : "",
        }),
      )
      .digest("hex");

    const priorTeams = workspace.teams.filter(
      (team) =>
        team.submissionId === request.submissionId && team.source === source,
    );
    const priorRegistrations = workspace.registrations.filter(
      (registration) =>
        registration.submissionId === request.submissionId &&
        registration.source === source,
    );
    const repeated = priorTeams.length > 0 || priorRegistrations.length > 0;
    if (repeated) {
      const priorRecords = [...priorTeams, ...priorRegistrations];
      const belongsToRequest =
        priorRecords.every(
          (record) => record.eventId === event.id,
        ) &&
        (priorTeams.some(
          (team) =>
            team.headerId === authenticatedId || team.heelerId === authenticatedId,
        ) ||
          priorRegistrations.some(
            (registration) => registration.contestantId === authenticatedId,
          ));
      if (!belongsToRequest) {
        throw new Error("That submission ID is already in use.");
      }
      if (priorRecords.some((record) => !record.submissionFingerprint)) {
        return {
          submissionId: request.submissionId,
          competitionId: event.id,
          summary: `Your entry in ${event.name} is already confirmed and pending payment.`,
          existing: true,
        };
      }
      if (
        priorRecords.some(
          (record) => record.submissionFingerprint !== submissionFingerprint,
        )
      ) {
        throw new Error("That submission ID is already in use.");
      }
    }

    const submittedAt = new Date().toISOString();
    const metadata = {
      paid: source === "staff" && request.paymentMethod !== "tab",
      ...(source === "staff"
        ? {
            paymentMethod: request.paymentMethod,
            paymentReference: request.submissionId,
          }
        : {}),
      source,
      submissionId: request.submissionId,
      submissionFingerprint,
      submittedAt,
    };
    const idPrefix = source === "online" ? "online" : "desk";
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
      const standaloneEntries = workspace.registrations
        .filter(
          (registration) =>
            registration.eventId === event.id &&
            registration.contestantId === contestant.id &&
            !registration.sourceTeamId &&
            registration.submissionId !== request.submissionId &&
            registration.status !== "scratched",
        )
        .reduce((sum, registration) => sum + Number(registration.entries || 0), 0);
      if (standaloneEntries + entries > event.entriesAllowed) {
        throw new Error("Entry limit exceeded.");
      }
      registrations.push({
        id: `${idPrefix}-registration-${request.submissionId}`,
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
      const requestedPartnerIds = normalizedPartnerIds;
      if (requestedPartnerIds.some((partnerId) => !validAppId(partnerId))) {
        throw new Error("Choose an eligible partner.");
      }
      if (event.competitionType === "pick-and-draw") {
        const entries = Number(request.entries ?? 0);
        const minimumDraws = Math.max(
          1,
          Number(event.minDrawsAllowed ?? 0),
        );
        const drawRole = request.drawRole || request.role;
        const allowedRoles =
          event.pickDrawRole === "both"
            ? ["Header", "Heeler"]
            : [event.pickDrawRole === "header" ? "Header" : "Heeler"];
        if (
          !Number.isInteger(entries) ||
          entries < minimumDraws ||
          entries > Number(event.entriesAllowed || 1) ||
          (entries > 0 &&
            (!allowedRoles.includes(drawRole) ||
              !contestantCanRole(contestant, drawRole) ||
              !contestantWithinHandicap(event, contestant, drawRole)))
        ) {
          throw new Error(
            `This competition requires at least ${minimumDraws} draw entr${minimumDraws === 1 ? "y" : "ies"}.`,
          );
        }
        const standaloneEntries = workspace.registrations
          .filter(
            (registration) =>
              registration.eventId === event.id &&
              registration.contestantId === contestant.id &&
              !registration.sourceTeamId &&
              registration.submissionId !== request.submissionId &&
              registration.status !== "scratched",
          )
          .reduce(
            (sum, registration) => sum + Number(registration.entries || 0),
            0,
          );
        const existingPickedTeams = workspace.teams.filter(
          (team) =>
            team.eventId === event.id &&
            Number(team.round) === 1 &&
            !team.scratched &&
            !team.generated &&
            team.submissionId !== request.submissionId &&
            (team.headerId === contestant.id ||
              team.heelerId === contestant.id),
        ).length;
        if (
          standaloneEntries +
            existingPickedTeams +
            entries +
            requestedPartnerIds.length >
          event.entriesAllowed
        ) {
          throw new Error("Draw entry limit exceeded.");
        }
        if (entries > 0) {
          registrations.push({
            id: `${idPrefix}-registration-${request.submissionId}-draw`,
            eventId: event.id,
            contestantId: contestant.id,
            role: drawRole,
            entries,
            checkedIn: false,
            status: "entered",
            notes: "",
            ...metadata,
          });
        }
      }
      if (!requestedPartnerIds.length) {
        if (event.competitionType !== "pick-and-draw") {
          throw new Error("Choose an eligible partner.");
        }
      } else {
        if (!["Header", "Heeler"].includes(request.role)) {
          throw new Error("Choose your team position.");
        }
        const activeTeams = workspace.teams.filter(
          (team) =>
            team.eventId === event.id &&
            team.round === 1 &&
            !team.generated &&
            !team.scratched &&
            team.submissionId !== request.submissionId,
        );
        const entryCount = (contestantId) =>
          activeTeams.filter(
            (team) =>
              team.headerId === contestantId ||
              team.heelerId === contestantId,
          ).length;
        if (
          entryCount(contestant.id) + requestedPartnerIds.length >
          event.entriesAllowed
        ) {
          throw new Error("Entry limit exceeded.");
        }
        requestedPartnerIds.forEach((partnerId, partnerIndex) => {
          const partner = workspace.contestants.find(
            (item) => item.id === partnerId,
          );
          if (!partner || partner.id === contestant.id) {
            throw new Error("Choose an eligible partner.");
          }
          const hasDrawRegistration = (contestantId) =>
            [...workspace.registrations, ...registrations].some(
              (registration) =>
                registration.eventId === event.id &&
                registration.contestantId === contestantId &&
                !registration.sourceTeamId &&
                registration.status === "entered" &&
                Number(registration.entries) > 0,
            );
          if (
            event.competitionType === "pick-and-draw" &&
            (!hasDrawRegistration(contestant.id) ||
              !hasDrawRegistration(partner.id))
          ) {
            throw new Error(
              "Every rider on a picked team must already be entered in the draw.",
            );
          }
          const header = request.role === "Header" ? contestant : partner;
          const heeler = request.role === "Heeler" ? contestant : partner;
          if (
            !contestantCanRole(header, "Header") ||
            !contestantCanRole(heeler, "Heeler") ||
            !contestantWithinHandicap(event, header, "Header") ||
            !contestantWithinHandicap(event, heeler, "Heeler")
          ) {
            throw new Error(
              "A contestant handicap exceeds the competition limit.",
            );
          }
          if (handicapTotal(header, heeler) > event.handicapTotal) {
            throw new Error("Team handicap exceeds the competition limit.");
          }
          if (
            !event.allowRepeatPartners &&
            activeTeams.some(
              (team) =>
                team.headerId === header.id && team.heelerId === heeler.id,
            )
          ) {
            throw new Error("That partnership is already entered.");
          }
          const partnerStandaloneEntries = workspace.registrations
            .filter(
              (registration) =>
                registration.eventId === event.id &&
                registration.contestantId === partner.id &&
                !registration.sourceTeamId &&
                registration.submissionId !== request.submissionId &&
                registration.status !== "scratched",
            )
            .reduce(
              (sum, registration) =>
                sum + Number(registration.entries || 0),
              0,
            );
          if (
            partnerStandaloneEntries + entryCount(partner.id) + 1 >
            event.entriesAllowed
          ) {
            throw new Error(`Entry limit exceeded for ${partner.name}.`);
          }
          const legacySinglePick =
            requestedPartnerIds.length === 1 &&
            !Array.isArray(request.partnerIds);
          const teamId = legacySinglePick
            ? `${idPrefix}-team-${request.submissionId}`
            : `${idPrefix}-team-${request.submissionId}-pick-${partnerIndex + 1}`;
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
        });
      }
    }

    if (source === "staff") {
      if (!["cash", "card", "tab"].includes(request.paymentMethod)) {
        throw new Error("Choose paid in cash, paid with credit card, or open a tab.");
      }
      if (
        request.paymentMethod !== "tab" &&
        request.paymentConfirmed !== true
      ) {
        throw new Error("Cashier must confirm the payment before sending entries.");
      }
    }

    await Promise.all([
      ...teams.map((team) => insertUniqueArenaRecord(COLLECTIONS.teams, team)),
      ...registrations.map((registration) =>
        insertUniqueArenaRecord(COLLECTIONS.registrations, registration),
      ),
    ]);
    await wixData.save(
      SETTINGS_COLLECTION,
      {
        _id: source === "online" ? ONLINE_REVISION_ID : STAFF_REVISION_ID,
        value:
          source === "online"
            ? workspace.onlineRevision + 1
            : workspace.staffRevision + 1,
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
}

export const submitOnlineSignup = webMethod(
  Permissions.Anyone,
  async (request) => {
    const authenticatedId = await verifyContestantCredentials(
      request.email,
      request.pin,
    );
    return createSignupRecords(request, authenticatedId, "online");
  },
);

export const submitRegistrationDeskSignup = webMethod(
  Permissions.SiteMember,
  async (request) => {
    await requireRegistrationDesk();
    const result = await createSignupRecords(
      request,
      request.contestantId,
      "staff",
    );
    return {
      ...result,
      summary: result.existing
        ? "That entry is already saved."
        : request.paymentMethod === "tab"
          ? "Contestant tab opened. Entries were sent to the draw area."
          : "Payment recorded. Contestant entries were sent to the draw area.",
      data: registrationDeskProjection(await readWorkspace()),
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
    if (!event || event.status !== "Live" || !team || team.scratched) {
      throw new Error("That live run is not available.");
    }
    if (
      team.status !== "ready" ||
      (team.predictionClosesAt &&
        Date.parse(team.predictionClosesAt) <= Date.now())
    ) {
      throw new Error("Predictions are closed for this run.");
    }
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
          const latestSpectators = await readCollection(COLLECTIONS.spectators);
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
