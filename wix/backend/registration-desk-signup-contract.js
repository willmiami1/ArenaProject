import { createHash } from "crypto";

const ENTRY_TYPES_BY_COMPETITION = Object.freeze({
  "draw-pot": Object.freeze(["draws"]),
  "round-robin": Object.freeze(["draws"]),
  "pick-only": Object.freeze(["picked-teams"]),
  "pick-and-draw": Object.freeze(["draws", "picked-teams"]),
  slide: Object.freeze(["draws", "picked-teams"]),
});

const VALID_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const VALID_ROW_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const PAYMENT_METHODS = new Set(["cash", "card", "tab"]);
const MAX_PICKED_TEAM_ROWS = 100;

const fail = (message) => {
  throw new Error(message);
};

const validId = (value) =>
  typeof value === "string" && VALID_ID.test(value);

const isCurrentStaffSubmission = (record, submissionId) =>
  record.source === "staff" && record.submissionId === submissionId;

const recordIdHash = (...parts) =>
  createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);

const compareRowIds = (left, right) =>
  left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;

const normalizedHorse = (contestant, value, label) => {
  const requested = String(value || "").trim().replace(/\s+/g, " ");
  if (!requested) return "";
  const horse = (contestant?.horses || []).find(
    (item) =>
      String(item).trim().replace(/\s+/g, " ").toLowerCase() ===
      requested.toLowerCase(),
  );
  if (!horse) {
    fail(`Choose a ${label}horse saved on this contestant profile.`);
  }
  return String(horse);
};

const contestantCanRole = (contestant, role) =>
  contestant?.role === "Both" || contestant?.role === role;

const contestantWithinHandicap = (event, contestant, role) =>
  Number(
    role === "Header"
      ? contestant?.headerHandicap || 0
      : contestant?.heelerHandicap || 0,
  ) <= Number(event.maxContestantHandicap ?? 99);

const teamHandicap = (header, heeler) =>
  Number(header?.headerHandicap || 0) +
  Number(heeler?.heelerHandicap || 0);

const entryLimit = (event) => Number(event.entriesAllowed || 1);

const activeStandaloneEntryTotal = (
  workspace,
  eventId,
  contestantId,
  submissionId,
) =>
  (workspace.registrations || [])
    .filter(
      (registration) =>
        registration.eventId === eventId &&
        registration.contestantId === contestantId &&
        !registration.sourceTeamId &&
        !isCurrentStaffSubmission(registration, submissionId) &&
        registration.status !== "scratched",
    )
    .reduce(
      (total, registration) => {
        const entries = Number(registration.entries);
        return total + (Number.isFinite(entries) && entries > 0 ? entries : 0);
      },
      0,
    );

const activePickedTeams = (workspace, eventId, submissionId) =>
  (workspace.teams || []).filter(
    (team) =>
      team.eventId === eventId &&
      Number(team.round) === 1 &&
      !team.generated &&
      !team.scratched &&
      !isCurrentStaffSubmission(team, submissionId),
  );

const teamCountByRider = (teams) => {
  const counts = new Map();
  teams.forEach((team) => {
    new Set([team.headerId, team.heelerId]).forEach((contestantId) => {
      if (!contestantId) return;
      counts.set(contestantId, (counts.get(contestantId) || 0) + 1);
    });
  });
  return counts;
};

const assertPayment = (request) => {
  if (!PAYMENT_METHODS.has(request.paymentMethod)) {
    fail("Choose paid in cash, paid with credit card, or open a tab.");
  }
  if (
    request.paymentMethod !== "tab" &&
    request.paymentConfirmed !== true
  ) {
    fail("Cashier must confirm the payment before sending entries.");
  }
};

const assertRoundRobinCapacity = (
  workspace,
  event,
  role,
  entries,
  submissionId,
  contestantId,
  reservedRoleEntries,
) => {
  if (event.competitionType !== "round-robin") return;
  const limit = Number(role === "Header" ? event.maxHeaders : event.maxHeelers);
  if (!Number.isInteger(limit) || limit <= 0) return;
  const occupied = (workspace.registrations || [])
    .filter(
      (registration) =>
        registration.eventId === event.id &&
        registration.role === role &&
        registration.status === "entered" &&
        !(
          isCurrentStaffSubmission(registration, submissionId) &&
          registration.contestantId === contestantId
        ) &&
        Number.isInteger(Number(registration.entries)) &&
        Number(registration.entries) > 0,
    )
    .reduce(
      (total, registration) => total + Number(registration.entries),
      0,
    );
  if (occupied + Number(reservedRoleEntries || 0) + entries > limit) {
    fail(`${role} registration is full.`);
  }
};

const assertPickDrawRole = (event, role) => {
  if (event.competitionType !== "pick-and-draw") return;
  const configuredRole = String(event.pickDrawRole || "both").toLowerCase();
  const allowed =
    configuredRole === "both" ||
    (configuredRole === "header" && role === "Header") ||
    (configuredRole === "heeler" && role === "Heeler");
  if (!allowed) {
    fail("Choose a draw position supported by this competition.");
  }
};

const recordMetadata = (canonicalRequest) => ({
  entryType: canonicalRequest.entryType,
  payerContestantId: canonicalRequest.payerContestantId,
  paid: canonicalRequest.paymentMethod !== "tab",
  paymentMethod: canonicalRequest.paymentMethod,
  paymentReference: canonicalRequest.submissionId,
  source: "staff",
  submissionId: canonicalRequest.submissionId,
});

const prepareDraw = (
  workspace,
  event,
  request,
  reservedRoleEntries,
) => {
  if (!validId(request.contestantId)) {
    fail("Choose a valid contestant.");
  }
  const contestant = (workspace.contestants || []).find(
    ({ id }) => id === request.contestantId,
  );
  if (!contestant) fail("Contestant not found.");
  if (request.payerContestantId !== contestant.id) {
    fail("The entered contestant must be the payer.");
  }
  if (
    !["Header", "Heeler"].includes(request.role) ||
    !contestantCanRole(contestant, request.role)
  ) {
    fail("Choose an eligible contestant position.");
  }
  assertPickDrawRole(event, request.role);
  if (!contestantWithinHandicap(event, contestant, request.role)) {
    fail("Contestant handicap exceeds the competition limit.");
  }

  const entries = Number(request.entries);
  const minimumEntries = Math.max(1, Number(event.minDrawsAllowed ?? 0));
  if (
    !Number.isInteger(entries) ||
    entries < minimumEntries ||
    entries > entryLimit(event)
  ) {
    fail(
      `This competition requires between ${minimumEntries} and ${entryLimit(event)} entries.`,
    );
  }

  const existingPickedTeamCount =
    teamCountByRider(
      activePickedTeams(workspace, event.id, request.submissionId),
    ).get(contestant.id) || 0;
  if (
    activeStandaloneEntryTotal(
      workspace,
      event.id,
      contestant.id,
      request.submissionId,
    ) +
      existingPickedTeamCount +
      entries >
    entryLimit(event)
  ) {
    fail("Entry limit exceeded.");
  }
  assertRoundRobinCapacity(
    workspace,
    event,
    request.role,
    entries,
    request.submissionId,
    contestant.id,
    reservedRoleEntries,
  );

  const canonicalRequest = {
    entryType: "draws",
    eventId: event.id,
    submissionId: request.submissionId,
    contestantId: contestant.id,
    horseName: normalizedHorse(contestant, request.horseName, ""),
    role: request.role,
    entries,
    payerContestantId: contestant.id,
    paymentMethod: request.paymentMethod,
    paymentConfirmed: request.paymentConfirmed === true,
  };
  const registration = {
    id: registrationDeskDrawRecordId(request.submissionId),
    eventId: event.id,
    contestantId: contestant.id,
    horseName: canonicalRequest.horseName,
    role: canonicalRequest.role,
    entries,
    checkedIn: false,
    status: "entered",
    notes: "",
    ...recordMetadata(canonicalRequest),
  };
  return { canonicalRequest, registrations: [registration], teams: [] };
};

const preparePickedTeams = (workspace, event, request) => {
  if (
    !Array.isArray(request.teams) ||
    request.teams.length < 1 ||
    request.teams.length > MAX_PICKED_TEAM_ROWS
  ) {
    fail(`Choose between 1 and ${MAX_PICKED_TEAM_ROWS} picked teams.`);
  }

  const contestantsById = new Map(
    (workspace.contestants || []).map((contestant) => [
      contestant.id,
      contestant,
    ]),
  );
  const activeTeams = activePickedTeams(
    workspace,
    event.id,
    request.submissionId,
  );
  const persistedPairs = new Set(
    activeTeams.map((team) => `${team.headerId}\u0000${team.heelerId}`),
  );
  const rowIds = new Set();
  const batchPairs = new Set();
  const riders = new Set();

  const rows = request.teams.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail("Each picked-team row must specify a Header and Heeler.");
    }
    if (typeof row.rowId !== "string" || !VALID_ROW_ID.test(row.rowId)) {
      fail("Each picked-team row needs a valid row ID up to 64 characters.");
    }
    if (rowIds.has(row.rowId)) {
      fail("Each picked-team row ID must be unique.");
    }
    rowIds.add(row.rowId);
    if (!validId(row.headerId) || !validId(row.heelerId)) {
      fail("Choose a valid Header and Heeler.");
    }
    if (row.headerId === row.heelerId) {
      fail("A rider cannot be both Header and Heeler on the same team.");
    }

    const header = contestantsById.get(row.headerId);
    const heeler = contestantsById.get(row.heelerId);
    if (!header || !heeler) {
      fail("Header or Heeler contestant not found.");
    }
    if (
      !contestantCanRole(header, "Header") ||
      !contestantCanRole(heeler, "Heeler") ||
      !contestantWithinHandicap(event, header, "Header") ||
      !contestantWithinHandicap(event, heeler, "Heeler")
    ) {
      fail("A contestant is not eligible for that team position.");
    }
    if (teamHandicap(header, heeler) > Number(event.handicapTotal)) {
      fail("Team handicap exceeds the competition limit.");
    }

    const pair = `${header.id}\u0000${heeler.id}`;
    if (
      !event.allowRepeatPartners &&
      (persistedPairs.has(pair) || batchPairs.has(pair))
    ) {
      fail("That partnership is already entered.");
    }
    batchPairs.add(pair);
    riders.add(header.id);
    riders.add(heeler.id);

    return {
      rowId: row.rowId,
      headerId: header.id,
      headerHorseName: normalizedHorse(
        header,
        row.headerHorseName,
        "Header ",
      ),
      heelerId: heeler.id,
      heelerHorseName: normalizedHorse(
        heeler,
        row.heelerHorseName,
        "Heeler ",
      ),
    };
  });

  if (
    !validId(request.payerContestantId) ||
    !riders.has(request.payerContestantId)
  ) {
    fail("Choose one of the riders in this batch as the payer.");
  }

  const existingTeamCounts = teamCountByRider(activeTeams);
  const batchTeamCounts = teamCountByRider(rows);
  riders.forEach((contestantId) => {
    if (
      activeStandaloneEntryTotal(
        workspace,
        event.id,
        contestantId,
        request.submissionId,
      ) +
        (existingTeamCounts.get(contestantId) || 0) +
        (batchTeamCounts.get(contestantId) || 0) >
      entryLimit(event)
    ) {
      const contestant = contestantsById.get(contestantId);
      fail(`Entry limit exceeded for ${contestant?.name || "a rider"}.`);
    }
  });

  const canonicalRequest = {
    entryType: "picked-teams",
    eventId: event.id,
    submissionId: request.submissionId,
    teams: [...rows].sort(compareRowIds),
    payerContestantId: request.payerContestantId,
    paymentMethod: request.paymentMethod,
    paymentConfirmed: request.paymentConfirmed === true,
  };
  const metadata = recordMetadata(canonicalRequest);
  const teams = canonicalRequest.teams.map((row) => ({
    id: registrationDeskPickedTeamRecordId(request.submissionId, row.rowId),
    eventId: event.id,
    rowId: row.rowId,
    headerId: row.headerId,
    headerHorseName: row.headerHorseName,
    heelerId: row.heelerId,
    heelerHorseName: row.heelerHorseName,
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
  }));
  return { canonicalRequest, registrations: [], teams };
};

export function supportedRegistrationDeskEntryTypes(event) {
  const projected = event?.supportedEntryTypes?.filter((entryType) =>
    ["draws", "picked-teams"].includes(entryType),
  );
  return projected?.length
    ? [...new Set(projected)]
    : [...(ENTRY_TYPES_BY_COMPETITION[event?.competitionType] || [])];
}

export const registrationDeskDrawRecordId = (submissionId) =>
  `desk-registration-${recordIdHash("draws", submissionId)}`;

export const registrationDeskPickedTeamRecordId = (submissionId, rowId) =>
  `desk-team-${recordIdHash("picked-teams", submissionId, rowId)}`;

export function registrationDeskSignupFingerprintPayload(canonicalRequest) {
  const common = {
    source: "staff",
    entryType: canonicalRequest.entryType,
    eventId: canonicalRequest.eventId,
    submissionId: canonicalRequest.submissionId,
  };
  if (canonicalRequest.entryType === "draws") {
    return {
      ...common,
      contestantId: canonicalRequest.contestantId,
      horseName: canonicalRequest.horseName,
      role: canonicalRequest.role,
      entries: canonicalRequest.entries,
      payerContestantId: canonicalRequest.payerContestantId,
      paymentMethod: canonicalRequest.paymentMethod,
      paymentConfirmed: canonicalRequest.paymentConfirmed,
    };
  }
  return {
    ...common,
    teams: [...canonicalRequest.teams]
      .sort(compareRowIds)
      .map(
        ({
          rowId,
          headerId,
          headerHorseName,
          heelerId,
          heelerHorseName,
        }) => ({
          rowId,
          headerId,
          headerHorseName,
          heelerId,
          heelerHorseName,
        }),
      ),
    payerContestantId: canonicalRequest.payerContestantId,
    paymentMethod: canonicalRequest.paymentMethod,
    paymentConfirmed: canonicalRequest.paymentConfirmed,
  };
}

export function prepareRegistrationDeskSignup(
  workspace,
  request,
  { reservedRoleEntries = 0 } = {},
) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    fail("Invalid signup request.");
  }
  if (!validId(request.eventId) || !validId(request.submissionId)) {
    fail("Choose a valid competition and submission ID.");
  }
  const event = (workspace.events || []).find(
    ({ id }) => id === request.eventId,
  );
  if (!event) fail("Competition not found.");
  const foreignSubmissionRecord = [
    ...(workspace.registrations || []),
    ...(workspace.teams || []),
  ].some(
    (record) =>
      record.submissionId === request.submissionId &&
      record.source !== "staff",
  );
  if (foreignSubmissionRecord) {
    fail("That submission ID is already in use.");
  }

  const supportedEntryTypes = supportedRegistrationDeskEntryTypes(event);
  if (!supportedEntryTypes.length) {
    fail("This competition format is not supported by Registration Desk.");
  }
  if (!["draws", "picked-teams"].includes(request.entryType)) {
    fail("Choose Draws or Picked Teams.");
  }
  if (!supportedEntryTypes.includes(request.entryType)) {
    fail("That entry type is not supported for this competition.");
  }
  assertPayment(request);

  const prepared =
    request.entryType === "draws"
      ? prepareDraw(workspace, event, request, reservedRoleEntries)
      : preparePickedTeams(workspace, event, request);
  return {
    event,
    ...prepared,
    fingerprintPayload: registrationDeskSignupFingerprintPayload(
      prepared.canonicalRequest,
    ),
    recordIds: {
      registrations: prepared.registrations.map(({ id }) => id),
      teams: prepared.teams.map(({ id }) => id),
    },
  };
}

export function registrationDeskSignupIsRetry(
  workspace,
  prepared,
  submissionFingerprint,
) {
  const submissionId = prepared.canonicalRequest.submissionId;
  const priorRegistrations = (workspace.registrations || []).filter(
    (record) =>
      record.source === "staff" && record.submissionId === submissionId,
  );
  const priorTeams = (workspace.teams || []).filter(
    (record) =>
      record.source === "staff" && record.submissionId === submissionId,
  );
  if (!priorRegistrations.length && !priorTeams.length) return false;

  const expectedRegistrationIds = new Set(prepared.recordIds.registrations);
  const expectedTeamIds = new Set(prepared.recordIds.teams);
  const validPriorRecord = (record, expectedIds) =>
    record.eventId === prepared.event.id &&
    record.submissionFingerprint === submissionFingerprint &&
    expectedIds.has(record.id);
  if (
    priorRegistrations.some(
      (record) => !validPriorRecord(record, expectedRegistrationIds),
    ) ||
    priorTeams.some((record) => !validPriorRecord(record, expectedTeamIds))
  ) {
    fail("That submission ID is already in use.");
  }
  return true;
}
