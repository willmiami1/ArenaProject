import type { ArenaEvent, Contestant, Team } from "./types";
import { officialRunTime } from "./competition";
import { ledQualifiedRunsThroughRound, sortLedStandings } from "./ledDisplay";

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
  contestants: Contestant[] = [],
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
        (sum, team) => sum + (officialRunTime(event, team, contestants) ?? 0),
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
  // Published results carry only the final classification: teams that roped
  // the last round, ranked like the LED scoreboard and run desk. Teams from
  // earlier rounds are not listed.
  const finalRound = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        !team.scratched &&
        team.status !== "ready",
    )
    .reduce((highest, team) => Math.max(highest, team.round), 1);
  const aggregates = new Map(
    aggregateStandings(event, teams, contestants).map((standing) => [
      standing.key,
      standing,
    ]),
  );
  const finalists = sortLedStandings(
    ledQualifiedRunsThroughRound(event.id, teams, finalRound).filter(
      (team) => team.round === finalRound,
    ),
    (team) => aggregates.get(teamEntryKey(team))?.total ?? 0,
  );
  return finalists.map((team, index) => {
    const aggregate = aggregates.get(teamEntryKey(team));
    return {
      place: index + 1,
      headerName: names.get(team.headerId) ?? "Unknown contestant",
      heelerName: names.get(team.heelerId) ?? "Unknown contestant",
      rounds: aggregate?.rounds ?? 0,
      officialTotal:
        aggregate?.qualified
          ? Math.round(aggregate.total * 100) / 100
          : null,
      status: aggregate?.status ?? ("no-time" as const),
    };
  });
}
