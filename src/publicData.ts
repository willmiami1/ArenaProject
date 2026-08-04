import { competitionName } from "./competition";
import { publicStandingRows } from "./standings";
import {
  predictionIsOpen,
  spectatorLeaderboard,
} from "./spectatorPredictions";
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
  | { kind: "spectator"; id: string }
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
  maxContestantHandicap: number;
  timeLimit: number;
  rounds: number;
  shortGoTeams: number;
  entryCount: number;
  results: PublicStandingRow[];
  predictionRuns: PublicPredictionRun[];
  spectatorLeaderboards: PublicSpectatorLeaderboardRow[];
}

export interface PublicSpectatorLeaderboardRow {
  name: string;
  round: number;
  picks: number;
  correct: number;
}

export interface PublicPredictionRun {
  id: string;
  round: number;
  drawPosition: number;
  headerName: string;
  heelerName: string;
  steerNumber: string;
  closesAt: string;
  open: boolean;
}

export interface PublicMeet {
  id: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  producer: string;
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
  if (page === "spectator") return { kind: "spectator", id };
  return { kind: "home" };
}

export const competitionGroup = (
  status: EventStatus,
): "live" | "future" | "past" =>
  status === "Live" ? "live" : status === "Complete" ? "past" : "future";

export function sortPublicMeets(meets: PublicMeet[]) {
  return [...meets].sort((left, right) =>
    `${left.date}T${left.startTime}`.localeCompare(
      `${right.date}T${right.startTime}`,
    ),
  );
}

export function projectPublicArenaData(
  data: ArenaData,
  today = new Date(),
): PublicArenaData {
  const competitions = data.events.map((event): PublicCompetition => {
    const contestantNames = new Map(
      data.contestants.map((contestant) => [contestant.id, contestant.name]),
    );
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
      maxContestantHandicap: event.maxContestantHandicap ?? 99,
      timeLimit: event.timeLimit,
      rounds: event.rounds,
      shortGoTeams: event.shortGoTeams,
      entryCount: fixedEntries + individualEntries,
      results: publicStandingRows(event, data.teams, data.contestants),
      predictionRuns: data.teams
        .filter(
          (team) =>
            team.eventId === event.id &&
            !team.scratched &&
            team.status === "ready" &&
            Boolean(team.predictionClosesAt),
        )
        .sort(
          (left, right) =>
            left.round - right.round ||
            left.drawPosition - right.drawPosition,
        )
        .map((team) => ({
          id: team.id,
          round: team.round,
          drawPosition: team.drawPosition,
          headerName: contestantNames.get(team.headerId) ?? "Unknown",
          heelerName: contestantNames.get(team.heelerId) ?? "Unknown",
          steerNumber: team.steerNumber ?? "",
          closesAt: team.predictionClosesAt!,
          open: predictionIsOpen(team, today),
        })),
      spectatorLeaderboards: Array.from(
        { length: Math.max(event.rounds, 1) },
        (_, index) =>
          spectatorLeaderboard(data, event.id, index + 1).map(
            ({ name, round, picks, correct }) => ({
              name,
              round,
              picks,
              correct,
            }),
          ),
      ).flat(),
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
          competitions: children,
        };
      }),
    ),
  };
}
