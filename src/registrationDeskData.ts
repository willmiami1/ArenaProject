import { seedData } from "./data";
import { createOnlineSignup, type SignupRequest } from "./onlineSignup";
import { onlineRegistrationIsOpen } from "./registrationWindow";
import type {
  ArenaData,
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

export interface RegistrationDeskData {
  events: RegistrationDeskEvent[];
  contestants: Contestant[];
  teams: Team[];
  registrations: EventRegistration[];
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
  | "allowRepeatPartners"
  | "handicapTotal"
  | "maxContestantHandicap"
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
}

const registrationWorkspaceKey = "arena-command-data-v1";

export function registrationDeskProjection(
  data: ArenaData,
  now = new Date(),
): RegistrationDeskData {
  const events = data.events.filter(
    (event) =>
      event.status === "Live" && onlineRegistrationIsOpen(event, now),
  );
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
        allowRepeatPartners,
        handicapTotal,
        maxContestantHandicap,
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
  if (name.length < 2 || name.length > 100) {
    throw new Error("Enter the contestant's full name.");
  }
  if (!validEmail(email)) throw new Error("Enter a valid email address.");
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
  request: SignupRequest,
  now = new Date(),
) {
  const result = createOnlineSignup(data, request, now);
  if (result.existing) {
    return { result, data };
  }
  const teams = result.teams.map((team) => ({
    ...team,
    source: "staff" as const,
  }));
  const registrations = result.registrations.map((registration) => ({
    ...registration,
    source: "staff" as const,
  }));
  return {
    result: { ...result, teams, registrations },
    data: {
      ...data,
      teams: [...data.teams, ...teams],
      registrations: [...data.registrations, ...registrations],
    },
  };
}
