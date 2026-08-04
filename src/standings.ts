import type { ArenaEvent, Contestant, Team } from "./types";

export interface AggregateStanding {
  key: string;
  headerId: string;
  heelerId: string;
  rounds: number;
  total: number;
  average: number;
  qualified: boolean;
  status: "qualified" | "no-time";
  rank: number;
}

export const teamEntryKey = (team: Team) =>
  `${team.headerId}|${team.heelerId}|${team.headerEntryNumber ?? 1}|${team.heelerEntryNumber ?? 1}`;

export function aggregateStandings(
  event: ArenaEvent,
  allTeams: Team[],
): AggregateStanding[] {
  const grouped = new Map<string, Team[]>();
  allTeams
    .filter((team) => team.eventId === event.id && !team.scratched)
    .forEach((team) => {
      const key = teamEntryKey(team);
      grouped.set(key, [...(grouped.get(key) ?? []), team]);
    });

  return [...grouped.entries()]
    .map(([key, teams]) => {
      const completed = teams.filter(
        (team) => team.status === "complete" && team.rawTime !== null,
      );
      const total = completed.reduce(
        (sum, team) => sum + (team.rawTime ?? 0) + team.penalties,
        0,
      );
      const qualified =
        completed.length > 0 && !teams.some((team) => team.status === "no-time");
      return {
        key,
        headerId: teams[0].headerId,
        heelerId: teams[0].heelerId,
        rounds: completed.length,
        total,
        average: completed.length ? total / completed.length : 0,
        qualified,
        status: qualified ? ("qualified" as const) : ("no-time" as const),
        rank: 0,
      };
    })
    .sort((left, right) => {
      if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
      if (left.rounds !== right.rounds) return right.rounds - left.rounds;
      return left.total - right.total;
    })
    .map((standing, index) => ({ ...standing, rank: index + 1 }));
}

export function publicStandingRows(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
) {
  if (!event.resultsPublished) return [];
  const names = new Map(contestants.map((contestant) => [contestant.id, contestant.name]));
  return aggregateStandings(event, teams).map((standing) => ({
    place: standing.rank,
    headerName: names.get(standing.headerId) ?? "Unknown contestant",
    heelerName: names.get(standing.heelerId) ?? "Unknown contestant",
    rounds: standing.rounds,
    officialTotal: standing.qualified
      ? Math.round(standing.total * 100) / 100
      : null,
    status: standing.status,
  }));
}
