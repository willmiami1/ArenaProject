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
import {
  onlineRegistrationClosesAt,
  onlineRegistrationIsOpen,
} from "./registrationWindow";

export type PublicRoute =
  | { kind: "home" }
  | { kind: "events" }
  | { kind: "event"; id: string }
  | { kind: "competition"; id: string }
  | { kind: "signup"; id: string }
  | { kind: "rider-account" }
  | { kind: "spectator"; id: string }
  | { kind: "contestant" }
  | { kind: "staff" }
  | { kind: "registration-desk" }
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
  description: string;
  date: string;
  startTime: string;
  location: string;
  status: EventStatus;
  entryFee: number;
  competitionType: CompetitionType;
  competitionLabel: string;
  pickDrawRole: PickDrawRole;
  registrationOpen: boolean;
  registrationClosesAt: string;
  drawLocked: boolean;
  resultsPublished: boolean;
  entriesAllowed: number;
  minDrawsAllowed: number;
  allowRepeatPartners: boolean;
  handicapTotal: number;
  slideNumber: number;
  maxContestantHandicap: number;
  timeLimit: number;
  rounds: number;
  shortGoTeams: number;
  incentivePayouts: boolean;
  incentiveHandicapTotal: number;
  incentiveTeams: number;
  incentiveAmountPerTeam: number;
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

export function aggregatePublicSpectatorLeaderboard(
  rows: PublicSpectatorLeaderboardRow[],
) {
  const totals = new Map<string, PublicSpectatorLeaderboardRow>();
  rows.forEach((row) => {
    const key = row.name.trim().toLowerCase();
    const current = totals.get(key) ?? {
      name: row.name,
      round: 0,
      picks: 0,
      correct: 0,
    };
    current.picks += row.picks;
    current.correct += row.correct;
    totals.set(key, current);
  });
  return [...totals.values()].sort(
    (left, right) =>
      right.correct - left.correct ||
      right.picks - left.picks ||
      left.name.localeCompare(right.name),
  );
}

export interface PublicPredictionRun {
  id: string;
  round: number;
  drawPosition: number;
  headerName: string;
  heelerName: string;
  headerPhoto?: string;
  heelerPhoto?: string;
  steerNumber: string;
  closesAt?: string;
  open: boolean;
}

function publicProfilePhoto(photo: string | undefined) {
  if (
    !photo ||
    photo.length > 3_000_000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i.test(photo)
  ) {
    return undefined;
  }
  return photo;
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
  competitions: PublicCompetition[];
  meets: PublicMeet[];
}

export function parsePublicRoute(search: string): PublicRoute {
  const params = new URLSearchParams(search);
  if (params.get("portal") === "contestant") return { kind: "contestant" };
  if (params.get("display") === "leaderboard") return { kind: "leaderboard" };
  if (params.get("app") === "command") return { kind: "staff" };
  if (params.get("app") === "registration") {
    return { kind: "registration-desk" };
  }
  const page = params.get("page") ?? "home";
  const id = params.get("id") ?? "";
  if (page === "events") return { kind: "events" };
  if (page === "event") return { kind: "event", id };
  if (page === "competition") return { kind: "competition", id };
  if (page === "signup") return { kind: "signup", id };
  if (page === "rider-account") return { kind: "rider-account" };
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
    const contestantsById = new Map(
      data.contestants.map((contestant) => [contestant.id, contestant]),
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
      description: event.description ?? "",
      date: event.date,
      startTime: event.startTime,
      location: event.location,
      status: event.status,
      entryFee: event.entryFee,
      competitionType: event.competitionType,
      competitionLabel: competitionName(event.competitionType),
      pickDrawRole: event.pickDrawRole,
      registrationOpen: onlineRegistrationIsOpen(event, today),
      registrationClosesAt: onlineRegistrationClosesAt(event).toISOString(),
      drawLocked: event.drawLocked,
      resultsPublished: event.resultsPublished,
      entriesAllowed: event.entriesAllowed,
      minDrawsAllowed: event.minDrawsAllowed ?? 0,
      allowRepeatPartners: event.allowRepeatPartners,
      handicapTotal: event.handicapTotal,
      slideNumber: event.slideNumber ?? 10,
      maxContestantHandicap: event.maxContestantHandicap ?? 10,
      timeLimit: event.timeLimit,
      rounds: event.rounds,
      shortGoTeams: event.shortGoTeams,
      incentivePayouts: event.incentivePayouts,
      incentiveHandicapTotal: event.incentiveHandicapTotal ?? 7,
      incentiveTeams: event.incentiveTeams ?? 1,
      incentiveAmountPerTeam: event.incentiveAmountPerTeam ?? 0,
      entryCount: fixedEntries + individualEntries,
      results: publicStandingRows(event, data.teams, data.contestants),
      predictionRuns: data.teams
        .filter(
          (team) =>
            team.eventId === event.id &&
            !team.scratched &&
            team.status === "ready",
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
          headerName: contestantsById.get(team.headerId)?.name ?? "Unknown",
          heelerName: contestantsById.get(team.heelerId)?.name ?? "Unknown",
          headerPhoto: publicProfilePhoto(contestantsById.get(team.headerId)?.photo),
          heelerPhoto: publicProfilePhoto(contestantsById.get(team.heelerId)?.photo),
          steerNumber: team.steerNumber ?? "",
          closesAt: team.predictionClosesAt,
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
    competitions,
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
