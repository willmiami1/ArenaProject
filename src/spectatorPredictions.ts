import type {
  ArenaData,
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

const normalizedPhone = (phone: string) => phone.replace(/\D/g, "");

export function predictionIsOpen(team: Team, now = new Date()) {
  return (
    team.status === "ready" &&
    Boolean(team.predictionClosesAt) &&
    Date.parse(team.predictionClosesAt!) > now.getTime()
  );
}

export function predictionOutcome(team: Team): SpectatorChoice | null {
  if (team.rawTime !== null) return "cowboys";
  if (team.status === "no-time") return "steer";
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

export function createSpectatorPrediction(
  data: ArenaData,
  request: {
    name: string;
    phone: string;
    eventId: string;
    teamId: string;
    choice: SpectatorChoice;
  },
  now = new Date(),
) {
  const name = request.name.trim().replace(/\s+/g, " ");
  const phone = normalizedPhone(request.phone);
  if (name.length < 2 || name.length > 80) {
    throw new Error("Enter your full name.");
  }
  if (phone.length < 10 || phone.length > 15) {
    throw new Error("Enter a valid phone number.");
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
  let spectator = data.spectators.find(
    (item) => normalizedPhone(item.phone) === phone,
  );
  if (spectator && spectator.name.toLowerCase() !== name.toLowerCase()) {
    throw new Error("That phone number is registered to a different name.");
  }
  if (!spectator) {
    spectator = {
      id: `spectator-${now.getTime()}-${phone.slice(-4)}`,
      name,
      phone,
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
