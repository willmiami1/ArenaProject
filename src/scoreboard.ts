import { noTimeLabel, officialRunTime, runPenaltyLabel } from "./competition";
import {
  ledQualifiedRunsThroughRound,
  ledShowsFinalResults,
  sortLedStandings,
} from "./ledDisplay";
import type { ArenaEvent, Contestant, Team } from "./types";

// Rider-facing scoreboard: the team roping now, the next teams in the order,
// and the same classification the Run Desk shows under the time entry.
// Mirrors publicScoreboardProjection in the Wix backend (arena-data.web.js).

export interface PublicScoreboardTeam {
  id: string;
  teamNumber: number;
  drawPosition: number;
  round: number;
  headerName: string;
  heelerName: string;
}

export interface PublicScoreboardRow {
  place: number;
  headerName: string;
  heelerName: string;
  teamNumber: number;
  drawPosition: number;
  rounds: number;
  total: number;
  advances: boolean;
  /** Penalty calls on the latest run, e.g. "Barrier · One leg". */
  calls: string;
}

/** A recorded run in the active stage, including misses. */
export interface PublicScoreboardRun {
  teamNumber: number;
  drawPosition: number;
  round: number;
  headerName: string;
  heelerName: string;
  /** Official time for a qualified run; null on a no-time. */
  time: number | null;
  /** "Header miss" / "Heeler miss" / "No time" on a miss; "" on a qualified run. */
  result: string;
  calls: string;
}

export interface PublicScoreboard {
  round: number;
  roundCount: number;
  rotation?: number;
  current: PublicScoreboardTeam | null;
  upNext: PublicScoreboardTeam[];
  standings: PublicScoreboardRow[];
  /** Every recorded run in the active stage, most recent draw first. */
  runs: PublicScoreboardRun[];
  roundComplete: boolean;
  finalResults: boolean;
}

const UP_NEXT_COUNT = 2;

const sameEntry = (left: Team, right: Team) =>
  left.headerId === right.headerId &&
  left.heelerId === right.heelerId &&
  (left.headerEntryNumber ?? 1) === (right.headerEntryNumber ?? 1) &&
  (left.heelerEntryNumber ?? 1) === (right.heelerEntryNumber ?? 1);

export function publicScoreboardProjection(
  event: ArenaEvent,
  allTeams: Team[],
  contestants: Contestant[],
): PublicScoreboard | undefined {
  if (event.drawApproved !== true) return undefined;
  const teams = allTeams
    .filter((team) => team.eventId === event.id && !team.scratched)
    .sort((a, b) => a.drawPosition - b.drawPosition);
  if (!teams.length) return undefined;
  const roundCount = Math.max(Number(event.rounds) || 1, 1);
  const readyTeams = teams.filter((team) => team.status === "ready");
  const persistedRound = Number(event.activeRound);
  const highestReadyRound = readyTeams.reduce(
    (highest, team) => Math.max(highest, team.round),
    0,
  );
  const highestRopedRound = teams.reduce(
    (highest, team) =>
      team.status !== "ready" ? Math.max(highest, team.round) : highest,
    0,
  );
  const round = Math.min(
    Math.max(
      persistedRound > 0
        ? persistedRound
        : highestReadyRound > 0
          ? highestReadyRound
          : highestRopedRound,
      1,
    ),
    roundCount,
  );
  const names = new Map(
    contestants.map((contestant) => [contestant.id, contestant.name]),
  );
  const name = (id: string) => names.get(id) ?? "Unknown";
  const teamSummary = (team: Team): PublicScoreboardTeam => ({
    id: team.id,
    teamNumber: team.originalTeamNumber ?? team.drawPosition,
    drawPosition: team.drawPosition,
    round: team.round,
    headerName: name(team.headerId),
    heelerName: name(team.heelerId),
  });

  // Run order for the active stage (round + rotation when rotations are used).
  const roundReady = readyTeams.filter((team) => team.round === round);
  const persistedActive = roundReady.find((team) => team.id === event.activeRunId);
  const rotation =
    persistedActive?.rotation ??
    (Number(event.activeRotation) > 0 ? Number(event.activeRotation) : undefined) ??
    roundReady.find((team) => !team.rolled)?.rotation ??
    roundReady[0]?.rotation;
  const stageReady = roundReady.filter(
    (team) => rotation === undefined || team.rotation === rotation,
  );
  const current =
    persistedActive ??
    stageReady.find((team) => !team.rolled) ??
    stageReady[0] ??
    null;
  const queue = stageReady.filter((team) => team.id !== current?.id);
  const upNext = [
    ...queue.filter((team) => !team.rolled),
    ...queue.filter((team) => team.rolled),
  ].slice(0, UP_NEXT_COUNT);

  const completedRuns = (team: Team) =>
    teams.filter(
      (run) =>
        sameEntry(run, team) &&
        run.round <= round &&
        run.status === "complete" &&
        run.rawTime !== null,
    );
  const total = (team: Team) =>
    completedRuns(team).reduce(
      (sum, run) => sum + (officialRunTime(event, run, contestants) ?? 0),
      0,
    );
  const standings = sortLedStandings(
    ledQualifiedRunsThroughRound(event.id, teams, round),
    total,
    (team) => completedRuns(team).length,
  ).map(
    (team, index): PublicScoreboardRow => ({
      place: index + 1,
      headerName: name(team.headerId),
      heelerName: name(team.heelerId),
      teamNumber: team.originalTeamNumber ?? team.drawPosition,
      drawPosition: team.drawPosition,
      rounds: completedRuns(team).length,
      total: Math.round(total(team) * 100) / 100,
      advances: team.round === round && round < roundCount,
      calls: runPenaltyLabel(team),
    }),
  );
  const runs: PublicScoreboardRun[] = teams
    .filter(
      (team) =>
        team.round === round &&
        (rotation === undefined || team.rotation === rotation) &&
        (team.status === "complete" || team.status === "no-time"),
    )
    .sort((a, b) => b.drawPosition - a.drawPosition)
    .map((team) => ({
      teamNumber: team.originalTeamNumber ?? team.drawPosition,
      drawPosition: team.drawPosition,
      round: team.round,
      headerName: name(team.headerId),
      heelerName: name(team.heelerId),
      time:
        team.status === "complete"
          ? Math.round((officialRunTime(event, team, contestants) ?? 0) * 100) / 100
          : null,
      result: team.status === "no-time" ? noTimeLabel(team) : "",
      calls: runPenaltyLabel(team),
    }));

  return {
    round,
    roundCount,
    ...(rotation !== undefined ? { rotation } : {}),
    current: current ? teamSummary(current) : null,
    upNext: upNext.map(teamSummary),
    standings,
    runs,
    roundComplete: roundReady.length === 0,
    finalResults: ledShowsFinalResults(event, teams, round),
  };
}
