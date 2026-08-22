import type { ArenaEvent, Team } from "./types";

export function resolveLedRunDeskState(
  event: ArenaEvent,
  teams: Team[],
  requestedRound?: number,
  requestedTeamId?: string,
) {
  const readyTeams = teams.filter(
    (team) =>
      team.eventId === event.id &&
      !team.scratched &&
      team.status === "ready",
  );
  const persistedTeam = readyTeams.find(
    (team) => team.id === event.activeRunId,
  );
  const requestedTeam = readyTeams.find(
    (team) => team.id === requestedTeamId,
  );
  const persistedRound = Number(event.activeRound);
  const highestReadyRound = readyTeams.reduce(
    (highest, team) => Math.max(highest, team.round),
    0,
  );
  const preferredRound =
    (persistedRound > 0 ? persistedRound : undefined) ??
    persistedTeam?.round ??
    requestedTeam?.round ??
    requestedRound ??
    (highestReadyRound > 0 ? highestReadyRound : undefined) ??
    event.rounds;
  const round = Math.min(
    Math.max(preferredRound, 1),
    Math.max(event.rounds, 1),
  );
  const roundTeams = readyTeams
    .filter((team) => team.round === round)
    .sort((left, right) => left.drawPosition - right.drawPosition);
  const activeTeam =
    roundTeams.find((team) => team.id === event.activeRunId) ??
    roundTeams.find((team) => team.id === requestedTeamId) ??
    roundTeams.find((team) => !team.rolled) ??
    roundTeams[0];

  return { round, activeTeamId: activeTeam?.id };
}

export function ledQualifiedRunsThroughRound(
  eventId: string,
  teams: Team[],
  round: number,
) {
  // Latest completed run per team entry. A later no-time drops the team into
  // the fewer-rounds-caught group (still ranked by their completed total)
  // instead of removing them from the classification.
  const latestCompletedRuns = new Map<string, Team>();
  teams
    .filter(
      (team) =>
        team.eventId === eventId &&
        team.round <= round &&
        !team.scratched &&
        team.status === "complete" &&
        team.rawTime !== null,
    )
    .forEach((team) => {
      const key = [
        team.headerId,
        team.heelerId,
        team.headerEntryNumber ?? 1,
        team.heelerEntryNumber ?? 1,
      ].join("|");
      const current = latestCompletedRuns.get(key);
      if (!current || team.round > current.round) {
        latestCompletedRuns.set(key, team);
      }
    });

  return [...latestCompletedRuns.values()];
}

export function sortLedStandings(
  teams: Team[],
  qualifiedTotal: (team: Team) => number,
  completedRounds: (team: Team) => number,
) {
  // Classification: most rounds caught first, then fastest total inside each
  // group (3/3 fastest→slowest, then 2/3 fastest→slowest, then 1/3, ...).
  return [...teams].sort(
    (left, right) =>
      completedRounds(right) - completedRounds(left) ||
      qualifiedTotal(left) - qualifiedTotal(right) ||
      left.drawPosition - right.drawPosition,
  );
}

export function ledShowsFinalResults(
  event: ArenaEvent,
  teams: Team[],
  round: number,
) {
  const finalRoundTeams = teams.filter(
    (team) =>
      team.eventId === event.id &&
      team.round === round &&
      !team.scratched,
  );
  return (
    round === Math.max(event.rounds, 1) &&
    finalRoundTeams.length > 0 &&
    finalRoundTeams.every((team) => team.status !== "ready")
  );
}
