import type { ArenaEvent, Team } from "./types";

export function normalizedRunDeskRound(
  value: number | undefined,
  roundCount: number,
) {
  const round = Number(value);
  return Math.min(
    Number.isInteger(round) && round > 0 ? round : 1,
    Math.max(roundCount, 1),
  );
}

export function runDeskSelectionToPersist(
  event: Pick<ArenaEvent, "activeRunId" | "activeRound">,
  roundTeams: Team[],
  round: number,
) {
  const storedTeam = roundTeams.find((team) => team.id === event.activeRunId);
  const nextTeam =
    storedTeam ??
    roundTeams.find((team) => team.status === "ready" && !team.rolled) ??
    roundTeams.find((team) => team.status === "ready");
  const activeRunId = nextTeam?.id;
  if (
    event.activeRunId === activeRunId &&
    event.activeRound === round
  ) {
    return null;
  }
  return { activeRunId, activeRound: round };
}
