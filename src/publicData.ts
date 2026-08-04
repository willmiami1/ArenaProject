import { competitionName } from "./competition";
import { publicStandingRows } from "./standings";
import type {
  ArenaData,
  ArenaEvent,
  ArenaMeet,
  CompetitionType,
  EventStatus,
  PickDrawRole,
} from "./types";

export type PublicRoute =
  | { kind: "home" }
  | { kind: "events" }
  | { kind: "event"; id: string }
  | { kind: "competition"; id: string }
  | { kind: "signup"; id: string }
  | { kind: "contestant" }
  | { kind: "staff" }
  | { kind: "leaderboard" };

export interface PublicStandingRow {
  place: number;
  headerName: string;
  heelerName: string;
  rounds: number;
  officialTotal: number | null;
  status: "qualified" | "no-time";
}

export interface PublicCompetition {
  id: string;
  parentEventId: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  status: EventStatus;
  entryFee: number;
  competitionType: CompetitionType;
  competitionLabel: string;
  pickDrawRole: PickDrawRole;
  registrationOpen: boolean;
  drawLocked: boolean;
  resultsPublished: boolean;
  entriesAllowed: number;
  allowRepeatPartners: boolean;
  handicapTotal: number;
  timeLimit: number;
  rounds: number;
  shortGoTeams: number;
  entryCount: number;
  results: PublicStandingRow[];
}

export interface PublicMeet {
  id: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  producer: string;
  group: "live" | "future" | "past";
  competitions: PublicCompetition[];
}

export interface PublicArenaData {
  generatedAt: string;
  meets: PublicMeet[];
}

export function parsePublicRoute(search: string): PublicRoute {
  const params = new URLSearchParams(search);
  if (params.get("portal") === "contestant") return { kind: "contestant" };
  if (params.get("display") === "leaderboard") return { kind: "leaderboard" };
  if (params.get("app") === "command") return { kind: "staff" };
  const page = params.get("page") ?? "home";
  const id = params.get("id") ?? "";
  if (page === "events") return { kind: "events" };
  if (page === "event") return { kind: "event", id };
  if (page === "competition") return { kind: "competition", id };
  if (page === "signup") return { kind: "signup", id };
  return { kind: "home" };
}

const localDate = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

export function meetGroup(
  meet: Pick<ArenaMeet, "date">,
  competitions: Pick<ArenaEvent, "status">[],
  today = new Date(),
): PublicMeet["group"] {
  if (competitions.some((event) => event.status === "Live")) return "live";
  const allComplete =
    competitions.length > 0 &&
    competitions.every((event) => event.status === "Complete");
  if (!allComplete && meet.date >= localDate(today)) return "future";
  return "past";
}

export function sortPublicMeets(meets: PublicMeet[]) {
  const order = { live: 0, future: 1, past: 2 };
  return [...meets].sort((left, right) => {
    if (left.group !== right.group) return order[left.group] - order[right.group];
    const comparison = `${left.date}T${left.startTime}`.localeCompare(
      `${right.date}T${right.startTime}`,
    );
    return left.group === "past" ? -comparison : comparison;
  });
}

export function projectPublicArenaData(
  data: ArenaData,
  today = new Date(),
): PublicArenaData {
  const competitions = data.events.map((event): PublicCompetition => {
    const fixedEntries = data.teams.filter(
      (team) =>
        team.eventId === event.id &&
        team.round === 1 &&
        !team.generated &&
        !team.scratched,
    ).length;
    const individualEntries = data.registrations
      .filter(
        (registration) =>
          registration.eventId === event.id &&
          registration.status !== "scratched",
      )
      .reduce((sum, registration) => sum + registration.entries, 0);
    return {
      id: event.id,
      parentEventId: event.parentEventId,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      location: event.location,
      status: event.status,
      entryFee: event.entryFee,
      competitionType: event.competitionType,
      competitionLabel: competitionName(event.competitionType),
      pickDrawRole: event.pickDrawRole,
      registrationOpen: event.registrationOpen,
      drawLocked: event.drawLocked,
      resultsPublished: event.resultsPublished,
      entriesAllowed: event.entriesAllowed,
      allowRepeatPartners: event.allowRepeatPartners,
      handicapTotal: event.handicapTotal,
      timeLimit: event.timeLimit,
      rounds: event.rounds,
      shortGoTeams: event.shortGoTeams,
      entryCount: fixedEntries + individualEntries,
      results: publicStandingRows(event, data.teams, data.contestants),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    meets: sortPublicMeets(
      data.meets.map((meet) => {
        const children = competitions.filter(
          (event) => event.parentEventId === meet.id,
        );
        return {
          id: meet.id,
          name: meet.name,
          date: meet.date,
          startTime: meet.startTime,
          location: meet.location,
          producer: meet.producer ?? "",
          group: meetGroup(meet, children, today),
          competitions: children,
        };
      }),
    ),
  };
}
