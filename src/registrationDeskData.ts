import { seedData } from "./data";
import { registrationDeskIsVisible } from "./registrationWindow";
import { normalizeHorseNames } from "./contestantHorses";
import {
  supportedRegistrationDeskModes,
  type RegistrationDeskSignupRequest,
} from "./registrationDeskSignup";
import type {
  ArenaData,
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

export interface RegistrationDeskWaiverDocument {
  title: string;
  version: string;
  text: string;
  available: boolean;
}

export interface RegistrationDeskWaiverSignature {
  id: string;
  eventId: string;
  contestantId: string;
  contestantName: string;
  signerName: string;
  signedAt: string;
  waiverVersion: string;
}

export interface RegistrationDeskWaiverStatus {
  contestantId: string;
  signedAt: string;
  eventId: string;
}

export interface RegistrationDeskWaiverStatusSnapshot {
  waiverVersion: string;
  statuses: RegistrationDeskWaiverStatus[];
}

export interface RegistrationDeskWaiverRequest {
  eventId: string;
  contestantId: string;
  signerName: string;
  signatureDataUrl: string;
  accepted: true;
}

export interface RegistrationDeskData {
  events: RegistrationDeskEvent[];
  contestants: Contestant[];
  teams: Team[];
  registrations: EventRegistration[];
  waiverDocument: RegistrationDeskWaiverDocument;
  waiverStatus: RegistrationDeskWaiverStatusSnapshot;
  waiverSignatures: RegistrationDeskWaiverSignature[];
}

export interface RegistrationDeskWaiverResponse {
  signature: RegistrationDeskWaiverSignature;
  data: RegistrationDeskData;
}

export type RegistrationDeskEvent = Pick<
  ArenaEvent,
  | "id"
  | "parentEventId"
  | "name"
  | "date"
  | "startTime"
  | "location"
  | "status"
  | "entryFee"
  | "competitionType"
  | "pickDrawRole"
  | "registrationOpen"
  | "drawLocked"
  | "entriesAllowed"
  | "maxHeaders"
  | "maxHeelers"
  | "minDrawsAllowed"
  | "allowRepeatPartners"
  | "handicapTotal"
  | "maxContestantHandicap"
  | "supportedEntryTypes"
>;

export interface RegistrationDeskContestantInput {
  id?: string;
  name: string;
  role: Contestant["role"];
  headerHandicap: number;
  heelerHandicap: number;
  phone: string;
  email: string;
  hometown: string;
  horses?: string[];
}

const registrationWorkspaceKey = "arena-command-data-v1";
const validRegistrationDeskId = /^[A-Za-z0-9_-]{1,100}$/;

export const unavailableRegistrationDeskWaiverDocument:
  RegistrationDeskWaiverDocument = {
    title: "",
    version: "",
    text: "",
    available: false,
  };

export const registrationDeskWaiverDocumentFixture:
  RegistrationDeskWaiverDocument = {
    title: "ACTIVITY WAIVER AGREEMENT",
    version: "2026-08-12-v1",
    text: `In consideration of being allowed to participate in team roping or any horse back riding at Destiny Ranch Arena located at Destiny Ranch LLC. 2549 E C 476 Bushnell FL 33513 also known as Destiny Ranch Events.
 I, for myself hereby acknowledge the risks of injury or damage (to property, personal injury and/or death) involved in participating in the above mentioned activity. I understand that there is a risk in riding live animals and acknowledge that my participation in this activity is purely voluntary. I assume full responsibility for myself, for any bodily injury, accident, illness, paralysis, death, loss of personal property and expenses thereof as a result of any accident which may occur while I participate in this activity at Destiny Ranch Arena.. I further agree to abide by all safety instructions, and to wear any safety equipment provided on the horseback ride while participating in the activity. I, for myself and hereby release, acquit and forgive Destiny Ranch LLC, family, heirs, employees, visitors and volunteers for any and all liability of any nature for any and all injury or damage (including property damage, personal injury, illness, paralysis, and/or death) as the result of my participation in the horseback activities. I, for myself also hereby expressly waive any claim, lawsuit, complaint, charge, or cause of action against Destiny Ranch LLC, family, heirs, employees, visitors, and volunteers and for any and all injury or damage including property damage, personal injury, illness, paralysis, and/or death, This waiver is made voluntarily. I have read this Release and Waiver Agreement and understand that by signing this document, I am waiving valuable legal rights including any and all rights that I may have against the Releases named above.`,
    available: true,
  };

type RegistrationDeskDataInput = Omit<
  RegistrationDeskData,
  "waiverDocument" | "waiverStatus" | "waiverSignatures"
> &
  Partial<
    Pick<
      RegistrationDeskData,
      "waiverDocument" | "waiverStatus" | "waiverSignatures"
    >
  >;

export function normalizeRegistrationDeskData(
  data: RegistrationDeskDataInput,
): RegistrationDeskData {
  const sourceDocument = data.waiverDocument;
  const title =
    typeof sourceDocument?.title === "string" ? sourceDocument.title.trim() : "";
  const version =
    typeof sourceDocument?.version === "string"
      ? sourceDocument.version.trim()
      : "";
  const text =
    typeof sourceDocument?.text === "string" ? sourceDocument.text.trim() : "";
  const waiverDocument = {
    title,
    version,
    text,
    available:
      sourceDocument?.available === true &&
      Boolean(title && version && text),
  };
  const waiverSignatures = Array.isArray(data.waiverSignatures)
    ? data.waiverSignatures.filter(
        (signature): signature is RegistrationDeskWaiverSignature =>
          Boolean(
            signature &&
              typeof signature.id === "string" &&
              typeof signature.eventId === "string" &&
              typeof signature.contestantId === "string" &&
              typeof signature.contestantName === "string" &&
              typeof signature.signerName === "string" &&
              typeof signature.signedAt === "string" &&
              typeof signature.waiverVersion === "string",
          ),
      )
    : [];
  const waiverStatus = {
    waiverVersion:
      typeof data.waiverStatus?.waiverVersion === "string"
        ? data.waiverStatus.waiverVersion.trim()
        : "",
    statuses: Array.isArray(data.waiverStatus?.statuses)
      ? data.waiverStatus.statuses.flatMap((status) => {
          if (
            !status ||
            typeof status.contestantId !== "string" ||
            typeof status.eventId !== "string" ||
            typeof status.signedAt !== "string" ||
            !validRegistrationDeskId.test(status.contestantId) ||
            !validRegistrationDeskId.test(status.eventId) ||
            !Number.isFinite(Date.parse(status.signedAt)) ||
            new Date(status.signedAt).toISOString() !== status.signedAt
          ) {
            return [];
          }
          return [
            {
              contestantId: status.contestantId,
              eventId: status.eventId,
              signedAt: status.signedAt,
            },
          ];
        })
      : [],
  };
  return {
    ...data,
    waiverDocument,
    waiverStatus,
    waiverSignatures,
  };
}

function sha256(value: string) {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const bytes = Array.from(new TextEncoder().encode(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);
  }

  const words = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const cursor = offset + index * 4;
      words[index] =
        (bytes[cursor] << 24) |
        (bytes[cursor + 1] << 16) |
        (bytes[cursor + 2] << 8) |
        bytes[cursor + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 =
        ((left >>> 7) | (left << 25)) ^
        ((left >>> 18) | (left << 14)) ^
        (left >>> 3);
      const sigma1 =
        ((right >>> 17) | (right << 15)) ^
        ((right >>> 19) | (right << 13)) ^
        (right >>> 10);
      words[index] =
        (words[index - 16] + sigma0 + words[index - 7] + sigma1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 =
        ((e >>> 6) | (e << 26)) ^
        ((e >>> 11) | (e << 21)) ^
        ((e >>> 25) | (e << 7));
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + constants[index] + words[index]) | 0;
      const sum0 =
        ((a >>> 2) | (a << 30)) ^
        ((a >>> 13) | (a << 19)) ^
        ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

const compareRegistrationDeskRowIds = (
  left: { rowId: string },
  right: { rowId: string },
) => (left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0);

export function registrationDeskProjection(
  data: ArenaData,
  now = new Date(),
): RegistrationDeskData {
  const events = data.events.filter(registrationDeskIsVisible);
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
        maxHeaders,
        maxHeelers,
        minDrawsAllowed,
        allowRepeatPartners,
        handicapTotal,
        maxContestantHandicap,
        supportedEntryTypes,
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
        maxHeaders,
        maxHeelers,
        minDrawsAllowed,
        allowRepeatPartners,
        handicapTotal,
        maxContestantHandicap,
        supportedEntryTypes:
          supportedEntryTypes?.length
            ? supportedEntryTypes
            : supportedRegistrationDeskModes({ competitionType }),
      }),
    ),
    contestants: data.contestants,
    teams: data.teams
      .filter((team) => eventIds.has(team.eventId) && team.round === 1)
      .map((team) => ({
        ...team,
        rawTime: null,
        penalties: 0,
        notes: "",
        points: 0,
        predictionClosesAt: undefined,
      })),
    registrations: data.registrations
      .filter((registration) => eventIds.has(registration.eventId))
      .map((registration) => ({ ...registration, notes: "" })),
    waiverDocument: registrationDeskWaiverDocumentFixture,
    waiverStatus: {
      waiverVersion: registrationDeskWaiverDocumentFixture.version,
      statuses: [],
    },
    waiverSignatures: [],
  };
}

export function loadLocalRegistrationWorkspace() {
  const saved = window.localStorage.getItem(registrationWorkspaceKey);
  if (!saved) return seedData;
  try {
    return JSON.parse(saved) as ArenaData;
  } catch {
    return seedData;
  }
}

export function saveLocalRegistrationWorkspace(data: ArenaData) {
  window.localStorage.setItem(registrationWorkspaceKey, JSON.stringify(data));
}

function validEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function upsertRegistrationDeskContestant(
  data: ArenaData,
  input: RegistrationDeskContestantInput,
): { data: ArenaData; contestant: Contestant } {
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const horses = normalizeHorseNames(input.horses);
  if (name.length < 2 || name.length > 100) {
    throw new Error("Enter the contestant's full name.");
  }
  if (!validEmail(email)) throw new Error("Enter a valid email address.");
  if (horses.length > 20 || horses.some((horse) => horse.length > 100)) {
    throw new Error("Enter no more than 20 horse names of 100 characters each.");
  }
  if (
    !Number.isFinite(input.headerHandicap) ||
    !Number.isFinite(input.heelerHandicap) ||
    input.headerHandicap < 0 ||
    input.heelerHandicap < 0 ||
    input.headerHandicap > 20 ||
    input.heelerHandicap > 20
  ) {
    throw new Error("Handicaps must be between 0 and 20.");
  }
  const duplicateEmail = email && data.contestants.some(
    (contestant) =>
      contestant.id !== input.id &&
      contestant.email?.trim().toLowerCase() === email,
  );
  if (duplicateEmail) {
    throw new Error("Another contestant already uses that email.");
  }
  const previous = data.contestants.find((item) => item.id === input.id);
  const contestant: Contestant = {
    ...previous,
    id:
      input.id ??
      `desk-contestant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    role: input.role,
    headerHandicap: Number(input.headerHandicap),
    heelerHandicap: Number(input.heelerHandicap),
    photo: previous?.photo ?? "",
    phone,
    email,
    hometown: input.hometown.trim(),
    horses,
  };
  const exists = data.contestants.some((item) => item.id === contestant.id);
  return {
    contestant,
    data: {
      ...data,
      contestants: exists
        ? data.contestants.map((item) =>
            item.id === contestant.id ? contestant : item,
          )
        : [...data.contestants, contestant],
    },
  };
}

export function submitLocalRegistrationDeskSignup(
  data: ArenaData,
  request: RegistrationDeskSignupRequest,
  now = new Date(),
) {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    !validRegistrationDeskId.test(request.eventId) ||
    !validRegistrationDeskId.test(request.submissionId)
  ) {
    fail("Choose a valid competition and submission ID.");
  }
  const event = data.events.find(({ id }) => id === request.eventId);
  if (!event) throw new Error("Competition not found.");
  if (event.status !== "Live") {
    fail("Registration Desk entries are limited to live competitions.");
  }
  if (!event.registrationOpen) fail("Registration is closed.");
  if (event.drawLocked) fail("The draw is locked.");
  if (
    [...data.registrations, ...data.teams].some(
      (record) =>
        record.submissionId === request.submissionId &&
        record.source !== "staff",
    )
  ) {
    fail("That submission ID is already in use.");
  }
  const supported = supportedRegistrationDeskModes(event);
  if (!supported.length) {
    fail("This competition format is not supported by Registration Desk.");
  }
  if (!supported.includes(request.entryType)) {
    fail("That entry type is not supported for this competition.");
  }
  if (!["cash", "card", "tab"].includes(request.paymentMethod)) {
    fail("Choose paid in cash, paid with credit card, or open a tab.");
  }
  if (request.paymentMethod !== "tab" && request.paymentConfirmed !== true) {
    fail("Cashier must confirm the payment before sending entries.");
  }

  const normalizedHorse = (
    contestant: Contestant,
    requested: string | undefined,
    label = "",
  ) => {
    const value = String(requested || "").trim().replace(/\s+/g, " ");
    if (!value) return "";
    const horse = (contestant.horses || []).find(
      (item) =>
        item.trim().replace(/\s+/g, " ").toLowerCase() === value.toLowerCase(),
    );
    if (!horse) fail(`Choose a ${label}horse saved on this contestant profile.`);
    return horse;
  };
  const contestantCanRole = (
    contestant: Contestant,
    role: "Header" | "Heeler",
  ) => contestant.role === "Both" || contestant.role === role;
  const withinHandicap = (
    contestant: Contestant,
    role: "Header" | "Heeler",
  ) =>
    Number(
      role === "Header"
        ? contestant.headerHandicap
        : contestant.heelerHandicap,
    ) <= Number(event.maxContestantHandicap ?? 99);
  const isCurrentSubmission = (record: Team | EventRegistration) =>
    record.source === "staff" && record.submissionId === request.submissionId;
  const activeRegistrations = data.registrations.filter(
    (registration) =>
      registration.eventId === event.id &&
      !registration.sourceTeamId &&
      !isCurrentSubmission(registration) &&
      registration.status !== "scratched",
  );
  const activeTeams = data.teams.filter(
    (team) =>
      team.eventId === event.id &&
      Number(team.round) === 1 &&
      !team.generated &&
      !team.scratched &&
      !isCurrentSubmission(team),
  );
  const standaloneEntries = (contestantId: string) =>
    activeRegistrations
      .filter((registration) => registration.contestantId === contestantId)
      .reduce((total, registration) => {
        const entries = Number(registration.entries);
        return total + (Number.isFinite(entries) && entries > 0 ? entries : 0);
      }, 0);
  const pickedTeamCount = (contestantId: string) =>
    activeTeams.filter(
      (team) =>
        team.headerId === contestantId || team.heelerId === contestantId,
    ).length;
  const entryLimit = Number(event.entriesAllowed || 1);
  const paid = request.paymentMethod !== "tab";
  const metadata = {
    entryType: request.entryType,
    payerContestantId: request.payerContestantId,
    paid,
    paymentMethod: request.paymentMethod,
    paymentReference: request.submissionId,
    source: "staff" as const,
    submissionId: request.submissionId,
  };
  let canonical: RegistrationDeskSignupRequest;
  let registrations: EventRegistration[] = [];
  let teams: Team[] = [];

  if (request.entryType === "draws") {
    const contestant = data.contestants.find(
      ({ id }) => id === request.contestantId,
    );
    if (!contestant) throw new Error("Contestant not found.");
    if (request.payerContestantId !== contestant.id) {
      fail("The entered contestant must be the payer.");
    }
    if (
      !["Header", "Heeler"].includes(request.role) ||
      !contestantCanRole(contestant, request.role)
    ) {
      fail("Choose an eligible contestant position.");
    }
    const configuredRole = String(event.pickDrawRole || "both").toLowerCase();
    if (
      event.competitionType === "pick-and-draw" &&
      configuredRole !== "both" &&
      configuredRole !== request.role.toLowerCase()
    ) {
      fail("Choose a draw position supported by this competition.");
    }
    if (!withinHandicap(contestant, request.role)) {
      fail("Contestant handicap exceeds the competition limit.");
    }
    const entries = Number(request.entries);
    const minimum = Math.max(1, Number(event.minDrawsAllowed ?? 0));
    if (
      !Number.isInteger(entries) ||
      entries < minimum ||
      entries > entryLimit
    ) {
      fail(`This competition requires between ${minimum} and ${entryLimit} entries.`);
    }
    if (
      standaloneEntries(contestant.id) +
        pickedTeamCount(contestant.id) +
        entries >
      entryLimit
    ) {
      fail("Entry limit exceeded.");
    }
    if (event.competitionType === "round-robin") {
      const roleLimit = Number(
        request.role === "Header" ? event.maxHeaders : event.maxHeelers,
      );
      const occupied = data.registrations
        .filter(
          (registration) =>
            registration.eventId === event.id &&
            registration.role === request.role &&
            registration.status === "entered" &&
            !(
              isCurrentSubmission(registration) &&
              registration.contestantId === contestant.id
            ),
        )
        .reduce((total, registration) => total + Number(registration.entries || 0), 0);
      if (
        Number.isInteger(roleLimit) &&
        roleLimit > 0 &&
        occupied + entries > roleLimit
      ) {
        fail(`${request.role} registration is full.`);
      }
    }
    const horseName = normalizedHorse(contestant, request.horseName);
    canonical = {
      entryType: "draws",
      eventId: event.id,
      submissionId: request.submissionId,
      contestantId: contestant.id,
      horseName,
      role: request.role,
      entries,
      payerContestantId: contestant.id,
      paymentMethod: request.paymentMethod,
      paymentConfirmed: request.paymentConfirmed === true,
    };
  } else {
    if (
      !Array.isArray(request.teams) ||
      request.teams.length < 1 ||
      request.teams.length > 100
    ) {
      fail("Choose between 1 and 100 picked teams.");
    }
    const contestants = new Map(
      data.contestants.map((contestant) => [contestant.id, contestant]),
    );
    const persistedPairs = new Set(
      activeTeams.map((team) => `${team.headerId}\0${team.heelerId}`),
    );
    const rowIds = new Set<string>();
    const batchPairs = new Set<string>();
    const riders = new Set<string>();
    const batchCounts = new Map<string, number>();
    const rows = request.teams.map((row) => {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(row.rowId)) {
        fail("Each picked-team row needs a valid row ID up to 64 characters.");
      }
      if (rowIds.has(row.rowId)) fail("Each picked-team row ID must be unique.");
      rowIds.add(row.rowId);
      if (!row.headerId || !row.heelerId) {
        fail("Choose a valid Header and Heeler.");
      }
      if (row.headerId === row.heelerId) {
        fail("A rider cannot be both Header and Heeler on the same team.");
      }
      const header = contestants.get(row.headerId);
      const heeler = contestants.get(row.heelerId);
      if (!header || !heeler) {
        throw new Error("Header or Heeler contestant not found.");
      }
      if (
        !contestantCanRole(header, "Header") ||
        !contestantCanRole(heeler, "Heeler") ||
        !withinHandicap(header, "Header") ||
        !withinHandicap(heeler, "Heeler")
      ) {
        fail("A contestant is not eligible for that team position.");
      }
      if (
        Number(header.headerHandicap) + Number(heeler.heelerHandicap) >
        Number(event.handicapTotal)
      ) {
        fail("Team handicap exceeds the competition limit.");
      }
      const pair = `${header.id}\0${heeler.id}`;
      if (
        !event.allowRepeatPartners &&
        (persistedPairs.has(pair) || batchPairs.has(pair))
      ) {
        fail("That partnership is already entered.");
      }
      batchPairs.add(pair);
      for (const id of [header.id, heeler.id]) {
        riders.add(id);
        batchCounts.set(id, (batchCounts.get(id) || 0) + 1);
      }
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
    if (!riders.has(request.payerContestantId)) {
      fail("Choose one of the riders in this batch as the payer.");
    }
    for (const contestantId of riders) {
      if (
        standaloneEntries(contestantId) +
          pickedTeamCount(contestantId) +
          (batchCounts.get(contestantId) || 0) >
        entryLimit
      ) {
        fail(`Entry limit exceeded for ${contestants.get(contestantId)?.name || "a rider"}.`);
      }
    }
    canonical = {
      entryType: "picked-teams",
      eventId: event.id,
      submissionId: request.submissionId,
      teams: [...rows].sort(compareRegistrationDeskRowIds),
      payerContestantId: request.payerContestantId,
      paymentMethod: request.paymentMethod,
      paymentConfirmed: request.paymentConfirmed === true,
    };
  }

  const fingerprintPayload = {
    source: "staff",
    ...canonical,
    ...(canonical.entryType === "picked-teams"
      ? {
          teams: [...canonical.teams].sort((left, right) =>
            compareRegistrationDeskRowIds(left, right),
          ),
        }
      : {}),
  };
  const fingerprintText = JSON.stringify(fingerprintPayload);
  const submissionFingerprint = sha256(fingerprintText);
  const idHash = (value: string) => sha256(value).slice(0, 32);
  const recordIds =
    canonical.entryType === "draws"
      ? {
          registrations: [
            `desk-registration-${idHash(JSON.stringify(["draws", request.submissionId]))}`,
          ],
          teams: [] as string[],
        }
      : {
          registrations: [] as string[],
          teams: canonical.teams.map(
            (row) =>
              `desk-team-${idHash(
                JSON.stringify(["picked-teams", request.submissionId, row.rowId]),
              )}`,
          ),
        };
  const priorRegistrations = data.registrations.filter(
    (record) => isCurrentSubmission(record),
  );
  const priorTeams = data.teams.filter((record) => isCurrentSubmission(record));
  if (priorRegistrations.length || priorTeams.length) {
    const expected = new Set([
      ...recordIds.registrations,
      ...recordIds.teams,
    ]);
    const prior = [...priorRegistrations, ...priorTeams];
    if (
      prior.some(
        (record) =>
          record.eventId !== event.id ||
          record.submissionFingerprint !== submissionFingerprint ||
          !expected.has(record.id),
      )
    ) {
      fail("That submission ID is already in use.");
    }
    return {
      result: {
        submissionId: request.submissionId,
        competitionId: event.id,
        entryType: canonical.entryType,
        payerContestantId: canonical.payerContestantId,
        recordIds,
        existing: true,
        summary: "That entry is already saved.",
        registrations: priorRegistrations,
        teams: priorTeams,
        data: registrationDeskProjection(data),
      },
      data,
    };
  }
  const submittedAt = now.toISOString();
  if (canonical.entryType === "draws") {
    registrations = [{
      id: recordIds.registrations[0],
      eventId: event.id,
      contestantId: canonical.contestantId,
      horseName: canonical.horseName,
      role: canonical.role,
      entries: canonical.entries,
      checkedIn: false,
      status: "entered",
      notes: "",
      ...metadata,
      submissionFingerprint,
      submittedAt,
    }];
  } else {
    teams = canonical.teams.map((row, index) => ({
      id: recordIds.teams[index],
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
      submissionFingerprint,
      submittedAt,
    }));
  }
  const nextData = {
    ...data,
    teams: [...data.teams, ...teams],
    registrations: [...data.registrations, ...registrations],
  };
  const summary =
    request.paymentMethod === "tab"
      ? "Contestant tab opened. Entries were sent to the draw area."
      : "Payment recorded. Contestant entries were sent to the draw area.";
  return {
    result: {
      submissionId: request.submissionId,
      competitionId: event.id,
      entryType: canonical.entryType,
      payerContestantId: canonical.payerContestantId,
      recordIds,
      existing: false,
      summary,
      registrations,
      teams,
      data: registrationDeskProjection(nextData),
    },
    data: nextData,
  };
}
