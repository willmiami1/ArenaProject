import { aggregateStandings } from "./standings";
import type {
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

export interface ContestantRopingHistory {
  event: ArenaEvent;
  registrations: EventRegistration[];
  teams: Team[];
  registered: boolean;
  participated: boolean;
  won: boolean;
  bestPlace: number | null;
}

export function contestantRopingHistory(
  contestantId: string,
  events: ArenaEvent[],
  teams: Team[],
  registrations: EventRegistration[],
  contestants: Contestant[],
): ContestantRopingHistory[] {
  return events
    .map((event) => {
      const eventRegistrations = registrations.filter(
        (registration) =>
          registration.eventId === event.id &&
          registration.contestantId === contestantId,
      );
      const eventTeams = teams.filter(
        (team) =>
          team.eventId === event.id &&
          (team.headerId === contestantId || team.heelerId === contestantId),
      );
      const standings = event.resultsPublished
        ? aggregateStandings(event, teams, contestants).filter(
            (standing) =>
              standing.qualified &&
              (standing.headerId === contestantId ||
                standing.heelerId === contestantId),
          )
        : [];
      const bestPlace = standings.length
        ? Math.min(...standings.map((standing) => standing.rank))
        : null;

      return {
        event,
        registrations: eventRegistrations,
        teams: eventTeams,
        registered: eventRegistrations.length > 0 || eventTeams.length > 0,
        participated: eventTeams.some(
          (team) =>
            team.status === "complete" ||
            team.status === "no-time" ||
            team.rawTime !== null,
        ),
        won: bestPlace === 1,
        bestPlace,
      };
    })
    .filter((history) => history.registered)
    .sort((left, right) =>
      `${right.event.date}T${right.event.startTime}`.localeCompare(
        `${left.event.date}T${left.event.startTime}`,
      ),
    );
}
