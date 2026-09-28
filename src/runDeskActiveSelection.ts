import type { ArenaEvent, Team } from "./types";

/**
 * Messages the Wix active-run contract throws when the selection itself is
 * invalid. Any other failure is treated as transient and the operator's
 * choice is kept locally.
 */
const ACTIVE_RUN_RULE_ERRORS = [
  "Choose a valid live competition and run.",
  "Competition not found.",
  "Active runs can only be set for live competitions.",
  "Run not found.",
  "That run does not belong to this competition.",
  "Only ready, non-scratched, non-rolled runs can be active.",
  "That run does not have a valid round.",
  "Select a valid team for Roping Now.",
];

export function activeRunRejectedByRules(message: string) {
  return ACTIVE_RUN_RULE_ERRORS.some((rule) => message.includes(rule));
}

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
