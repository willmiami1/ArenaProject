import type {
  ArenaData,
  ArenaEvent,
  Spectator,
  SpectatorPrediction,
  Team,
} from "./types";

export type SpectatorChoice = SpectatorPrediction["choice"];

export interface SpectatorLeaderboardRow {
  spectatorId: string;
  name: string;
  round: number;
  picks: number;
  correct: number;
}

export function predictionIsOpen(team: Team, now = new Date()) {
  return (
    team.status === "ready" &&
    !team.rolled &&
    (!team.predictionClosesAt ||
      Date.parse(team.predictionClosesAt) > now.getTime())
  );
}

export function predictionRunsForEvent(event: ArenaEvent, teams: Team[]) {
  const eligible = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        !team.scratched &&
        !team.rolled &&
        team.status === "ready",
    )
    .sort(
      (left, right) =>
        left.round - right.round ||
        left.drawPosition - right.drawPosition,
    );
  const activeRound = Number(event.activeRound || 0);
  return activeRound > 0
    ? eligible.filter((team) => team.round === activeRound)
    : eligible;
}

export function activePredictionRun(event: ArenaEvent, teams: Team[]) {
  if (!event.activeRunId) return undefined;
  const eligible = predictionRunsForEvent(event, teams);
  return eligible.find((team) => team.id === event.activeRunId);
}

export function predictionOutcome(team: Team): SpectatorChoice | null {
  if (team.rawTime !== null) return "cowboys";
  if (team.status === "no-time" || team.status === "complete") return "steer";
  return null;
}

export function spectatorLeaderboard(
  data: Pick<ArenaData, "spectators" | "spectatorPredictions" | "teams">,
  eventId: string,
  round: number,
): SpectatorLeaderboardRow[] {
  const spectators = new Map(
    data.spectators.map((spectator) => [spectator.id, spectator]),
  );
  const teams = new Map(data.teams.map((team) => [team.id, team]));
  const rows = new Map<string, SpectatorLeaderboardRow>();
  data.spectatorPredictions
    .filter(
      (prediction) =>
        prediction.eventId === eventId && prediction.round === round,
    )
    .forEach((prediction) => {
      const spectator = spectators.get(prediction.spectatorId);
      const team = teams.get(prediction.teamId);
      if (!spectator || !team) return;
      const current = rows.get(spectator.id) ?? {
        spectatorId: spectator.id,
        name: spectator.name,
        round,
        picks: 0,
        correct: 0,
      };
      current.picks += 1;
      if (predictionOutcome(team) === prediction.choice) current.correct += 1;
      rows.set(spectator.id, current);
    });
  return [...rows.values()].sort(
    (left, right) =>
      right.correct - left.correct ||
      right.picks - left.picks ||
      left.name.localeCompare(right.name),
  );
}

export function clearSpectatorScoreboard(
  data: Pick<ArenaData, "spectatorPredictions">,
  eventId: string,
) {
  const spectatorPredictions = data.spectatorPredictions.filter(
    (prediction) => prediction.eventId !== eventId,
  );
  return {
    spectatorPredictions,
    cleared: data.spectatorPredictions.length - spectatorPredictions.length,
  };
}

export function createSpectatorPrediction(
  data: ArenaData,
  request: {
    name: string;
    eventId: string;
    teamId: string;
    choice: SpectatorChoice;
  },
  now = new Date(),
) {
  const name = request.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Enter your full name.");
  }
  if (request.choice !== "steer" && request.choice !== "cowboys") {
    throw new Error("Choose Steer or Cowboys.");
  }
  const event = data.events.find((item) => item.id === request.eventId);
  const team = data.teams.find(
    (item) => item.id === request.teamId && item.eventId === request.eventId,
  );
  if (!event || event.status !== "Live" || !team || team.scratched) {
    throw new Error("That live run is not available.");
  }
  if (!predictionIsOpen(team, now)) {
    throw new Error("Predictions are closed for this run.");
  }
  if (activePredictionRun(event, data.teams)?.id !== team.id) {
    throw new Error("That run is not active at the Run Desk.");
  }
  let spectator = data.spectators.find(
    (item) => item.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (!spectator) {
    spectator = {
      id: `spectator-${now.getTime()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30)}`,
      name,
      createdAt: now.toISOString(),
    };
  }
  const existing = data.spectatorPredictions.find(
    (prediction) =>
      prediction.spectatorId === spectator!.id &&
      prediction.teamId === team.id,
  );
  const prediction: SpectatorPrediction = existing ?? {
    id: `prediction-${spectator.id}-${team.id}`,
    spectatorId: spectator.id,
    eventId: event.id,
    teamId: team.id,
    round: team.round,
    choice: request.choice,
    submittedAt: now.toISOString(),
  };
  return {
    spectator,
    prediction,
    spectators: data.spectators.some((item) => item.id === spectator.id)
      ? data.spectators
      : [...data.spectators, spectator],
    spectatorPredictions: existing
      ? data.spectatorPredictions
      : [...data.spectatorPredictions, prediction],
    existing: Boolean(existing),
  };
}
