import type {
  ArenaEvent,
  Contestant,
  EventRegistration,
} from "./types";

export type RegistrationDeskEntryMode = "draws" | "picked-teams";
export type RegistrationDeskPaymentMethod = "cash" | "card" | "tab";

export interface RegistrationDeskTeamRow {
  rowId: string;
  headerId: string;
  headerHorseName: string;
  heelerId: string;
  heelerHorseName: string;
}

export interface RegistrationDeskDrawRequest {
  entryType: "draws";
  submissionId: string;
  eventId: string;
  contestantId: string;
  horseName?: string;
  role: "Header" | "Heeler";
  entries: number;
  payerContestantId: string;
  paymentMethod: RegistrationDeskPaymentMethod;
  paymentConfirmed: boolean;
}

export interface RegistrationDeskPickedTeamsRequest {
  entryType: "picked-teams";
  submissionId: string;
  eventId: string;
  teams: Array<{
    rowId: string;
    headerId: string;
    headerHorseName?: string;
    heelerId: string;
    heelerHorseName?: string;
  }>;
  payerContestantId: string;
  paymentMethod: RegistrationDeskPaymentMethod;
  paymentConfirmed: boolean;
}

export type RegistrationDeskSignupRequest =
  | RegistrationDeskDrawRequest
  | RegistrationDeskPickedTeamsRequest;

export interface RegistrationDeskSignupResponse {
  submissionId: string;
  competitionId: string;
  entryType: RegistrationDeskEntryMode;
  payerContestantId: string;
  recordIds: { registrations: string[]; teams: string[] };
  existing: boolean;
  summary: string;
  data: unknown;
}

export interface RegistrationDeskResetState {
  entryMode: RegistrationDeskEntryMode | "";
  teamRows: RegistrationDeskTeamRow[];
  payerContestantId: string;
  paymentMethod: "";
  review: false;
  submissionId: string;
}

const modeMatrix: Record<string, RegistrationDeskEntryMode[]> = {
  "draw-pot": ["draws"],
  "round-robin": ["draws"],
  "pick-only": ["picked-teams"],
  "pick-and-draw": ["draws", "picked-teams"],
  slide: ["draws", "picked-teams"],
};

const validRowId = /^[A-Za-z0-9_-]{1,64}$/;

export function supportedRegistrationDeskModes(
  event:
    | Pick<ArenaEvent, "competitionType" | "supportedEntryTypes">
    | undefined,
): RegistrationDeskEntryMode[] {
  if (!event) return [];
  const projected = event.supportedEntryTypes?.filter(
    (mode): mode is RegistrationDeskEntryMode =>
      mode === "draws" || mode === "picked-teams",
  );
  return projected?.length
    ? [...new Set(projected)]
    : [...(modeMatrix[event.competitionType] ?? [])];
}

export function defaultRegistrationDeskMode(
  event:
    | Pick<ArenaEvent, "competitionType" | "supportedEntryTypes">
    | undefined,
  current: RegistrationDeskEntryMode | "" = "",
) {
  const supported = supportedRegistrationDeskModes(event);
  return supported.includes(current as RegistrationDeskEntryMode)
    ? current
    : supported[0] ?? "";
}

export function createRegistrationDeskTeamRow(
  createId: () => string = () =>
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    `row_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
): RegistrationDeskTeamRow {
  const rowId = createId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  if (!validRowId.test(rowId)) {
    throw new Error("Could not create a valid team row ID.");
  }
  return {
    rowId,
    headerId: "",
    headerHorseName: "",
    heelerId: "",
    heelerHorseName: "",
  };
}

export function normalizeRegistrationDeskTeamRow(
  row: RegistrationDeskTeamRow,
): RegistrationDeskTeamRow {
  return {
    rowId: row.rowId.trim(),
    headerId: row.headerId.trim(),
    headerHorseName: row.headerHorseName.trim().replace(/\s+/g, " "),
    heelerId: row.heelerId.trim(),
    heelerHorseName: row.heelerHorseName.trim().replace(/\s+/g, " "),
  };
}

export function resetRegistrationDeskEntryState(
  event:
    | Pick<ArenaEvent, "competitionType" | "supportedEntryTypes">
    | undefined,
  createId?: () => string,
): RegistrationDeskResetState {
  return {
    entryMode: defaultRegistrationDeskMode(event),
    teamRows: [createRegistrationDeskTeamRow(createId)],
    payerContestantId: "",
    paymentMethod: "",
    review: false,
    submissionId: "",
  };
}

const canFillRole = (contestant: Contestant, role: "Header" | "Heeler") =>
  contestant.role === "Both" || contestant.role === role;

const withinRoleHandicap = (
  event: Pick<ArenaEvent, "maxContestantHandicap">,
  contestant: Contestant,
  role: "Header" | "Heeler",
) =>
  Number(
    role === "Header"
      ? contestant.headerHandicap
      : contestant.heelerHandicap,
  ) <= Number(event.maxContestantHandicap ?? 99);

export function registrationDeskRoleCandidates(
  contestants: Contestant[],
  event: Pick<
    ArenaEvent,
    "id" | "competitionType" | "maxContestantHandicap"
  >,
  registrations: EventRegistration[],
  role: "Header" | "Heeler",
) {
  return contestants.filter(
    (contestant) =>
      canFillRole(contestant, role) &&
      withinRoleHandicap(event, contestant, role),
  );
}

export function registrationDeskPayerCandidates(
  rows: RegistrationDeskTeamRow[],
  contestants: Contestant[],
) {
  const selectedIds = new Set(
    rows.flatMap(({ headerId, heelerId }) => [headerId, heelerId]).filter(Boolean),
  );
  return contestants.filter((contestant) => selectedIds.has(contestant.id));
}

export function validRegistrationDeskPayer(
  payerContestantId: string,
  rows: RegistrationDeskTeamRow[],
) {
  return rows.some(
    ({ headerId, heelerId }) =>
      headerId === payerContestantId || heelerId === payerContestantId,
  );
}

export function registrationDeskTotals(
  mode: RegistrationDeskEntryMode,
  entries: number,
  rows: RegistrationDeskTeamRow[],
  entryFee: number,
) {
  const runCount = mode === "draws" ? Number(entries) || 0 : rows.length;
  return { runCount, amount: runCount * Number(entryFee || 0) };
}

export function pickedTeamRowsError(
  rows: RegistrationDeskTeamRow[],
  payerContestantId = "",
) {
  if (rows.length < 1 || rows.length > 100) {
    return "Choose between 1 and 100 picked teams.";
  }
  const rowIds = new Set<string>();
  for (const row of rows.map(normalizeRegistrationDeskTeamRow)) {
    if (!validRowId.test(row.rowId)) {
      return "Each picked-team row needs a valid row ID up to 64 characters.";
    }
    if (rowIds.has(row.rowId)) {
      return "Each picked-team row ID must be unique.";
    }
    rowIds.add(row.rowId);
    if (!row.headerId || !row.heelerId) {
      return "Choose one Header and one Heeler for every team.";
    }
    if (row.headerId === row.heelerId) {
      return "A rider cannot be both Header and Heeler on the same team.";
    }
  }
  if (
    payerContestantId &&
    !validRegistrationDeskPayer(payerContestantId, rows)
  ) {
    return "Choose one of the riders in this batch as the payer.";
  }
  return "";
}

export function registrationDeskReviewComplete(
  mode: RegistrationDeskEntryMode,
  options: {
    contestantId?: string;
    role?: "Header" | "Heeler";
    entries?: number;
    minimumEntries?: number;
    maximumEntries?: number;
    rows?: RegistrationDeskTeamRow[];
    payerContestantId: string;
    paymentMethod: RegistrationDeskPaymentMethod | "";
  },
) {
  if (!options.paymentMethod || !options.payerContestantId) return false;
  if (mode === "draws") {
    return Boolean(
      options.contestantId &&
        options.payerContestantId === options.contestantId &&
        options.role &&
        Number.isInteger(options.entries) &&
        Number(options.entries) >= Number(options.minimumEntries ?? 1) &&
        Number(options.entries) <= Number(options.maximumEntries ?? Infinity),
    );
  }
  return !pickedTeamRowsError(
    options.rows ?? [],
    options.payerContestantId,
  );
}

export function buildRegistrationDeskDrawRequest(input: {
  submissionId: string;
  eventId: string;
  contestantId: string;
  horseName?: string;
  role: "Header" | "Heeler";
  entries: number;
  paymentMethod: RegistrationDeskPaymentMethod;
}): RegistrationDeskDrawRequest {
  return {
    entryType: "draws",
    submissionId: input.submissionId,
    eventId: input.eventId,
    contestantId: input.contestantId,
    ...(input.horseName?.trim()
      ? { horseName: input.horseName.trim().replace(/\s+/g, " ") }
      : {}),
    role: input.role,
    entries: input.entries,
    payerContestantId: input.contestantId,
    paymentMethod: input.paymentMethod,
    paymentConfirmed: input.paymentMethod !== "tab",
  };
}

export function buildRegistrationDeskPickedTeamsRequest(input: {
  submissionId: string;
  eventId: string;
  rows: RegistrationDeskTeamRow[];
  payerContestantId: string;
  paymentMethod: RegistrationDeskPaymentMethod;
}): RegistrationDeskPickedTeamsRequest {
  const error = pickedTeamRowsError(input.rows, input.payerContestantId);
  if (error) throw new Error(error);
  return {
    entryType: "picked-teams",
    submissionId: input.submissionId,
    eventId: input.eventId,
    teams: input.rows.map(normalizeRegistrationDeskTeamRow).map((row) => ({
      rowId: row.rowId,
      headerId: row.headerId,
      ...(row.headerHorseName
        ? { headerHorseName: row.headerHorseName }
        : {}),
      heelerId: row.heelerId,
      ...(row.heelerHorseName
        ? { heelerHorseName: row.heelerHorseName }
        : {}),
    })),
    payerContestantId: input.payerContestantId,
    paymentMethod: input.paymentMethod,
    paymentConfirmed: input.paymentMethod !== "tab",
  };
}
