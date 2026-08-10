import { competitionName } from "./competition";
import { publicStandingRows } from "./standings";
import {
  activePredictionRun,
  predictionIsOpen,
  predictionRunsForEvent,
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
import { roundRobinRoleCapacity } from "./roundRobinCapacity";
import type { PublicRoleCapacity } from "./publicRoleCapacity";

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

export interface PublicRegisteredRider {
  id: string;
  name: string;
  photo?: string;
  horseNames: string[];
}

export const publicHorseNamesLabel = (horseNames: string[]) =>
  horseNames.length === 0
    ? ""
    : `${horseNames.length === 1 ? "Horse" : "Horses"}: ${horseNames.join(", ")}`;

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
  registeredRiders: {
    headers: PublicRegisteredRider[];
    heelers: PublicRegisteredRider[];
  };
  roleCapacities?: PublicRoleCapacity[];
  results: PublicStandingRow[];
  activePredictionRunId?: string;
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

function registeredRidersForEvent(
  eventId: string,
  data: ArenaData,
  contestantsById: Map<string, ArenaData["contestants"][number]>,
) {
  const headerEntries = new Map<string, Set<string>>();
  const heelerEntries = new Map<string, Set<string>>();
  const addEntry = (
    entries: Map<string, Set<string>>,
    contestantId: string,
    horseName?: string,
  ) => {
    const horses = entries.get(contestantId) ?? new Set<string>();
    const normalizedHorseName = horseName?.trim();
    if (normalizedHorseName) horses.add(normalizedHorseName);
    entries.set(contestantId, horses);
  };
  data.registrations
    .filter(
      (registration) =>
        registration.eventId === eventId &&
        registration.status !== "scratched",
    )
    .forEach((registration) => {
      addEntry(
        registration.role === "Header" ? headerEntries : heelerEntries,
        registration.contestantId,
        registration.horseName,
      );
    });
  data.teams
    .filter(
      (team) =>
        team.eventId === eventId &&
        team.round === 1 &&
        !team.generated &&
        !team.scratched,
    )
    .forEach((team) => {
      addEntry(headerEntries, team.headerId, team.headerHorseName);
      addEntry(heelerEntries, team.heelerId, team.heelerHorseName);
    });

  const projectRiders = (entries: Map<string, Set<string>>) =>
    [...entries]
      .map(([id, horseNames]) => {
        const contestant = contestantsById.get(id);
        return contestant
          ? {
        id: contestant.id,
        name: contestant.name,
        photo: publicProfilePhoto(contestant.photo),
              horseNames: [...horseNames].sort((left, right) =>
                left.localeCompare(right),
              ),
            }
          : undefined;
      })
      .filter((contestant) => contestant !== undefined)
      .sort((left, right) => left.name.localeCompare(right.name));

  return {
    headers: projectRiders(headerEntries),
    heelers: projectRiders(heelerEntries),
  };
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
  const contestantsById = new Map(
    data.contestants.map((contestant) => [contestant.id, contestant]),
  );
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
    const predictionTeams = predictionRunsForEvent(event, data.teams);
    const activeRun = activePredictionRun(event, data.teams);
    const roleCapacities = (["Header", "Heeler"] as const)
      .map((role) => roundRobinRoleCapacity(event, data.registrations, role))
      .filter(
        (capacity): capacity is typeof capacity & { maximum: number } =>
          capacity.maximum !== null,
      )
      .map(({ role, registered, maximum, full }) => ({
        role,
        registered,
        maximum,
        full,
      }));
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
      registeredRiders: registeredRidersForEvent(
        event.id,
        data,
        contestantsById,
      ),
      ...(roleCapacities.length ? { roleCapacities } : {}),
      results: publicStandingRows(event, data.teams, data.contestants),
      activePredictionRunId: activeRun?.id,
      predictionRuns: predictionTeams
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
