import type { RegistrationDeskData } from "./registrationDeskData";

export interface RegistrationDeskRosterContestant {
  id: string;
  name: string;
  roles: Array<"Header" | "Heeler">;
  headerHandicap: number;
  heelerHandicap: number;
}

export function registrationDeskEventRoster(
  data: RegistrationDeskData | null,
  eventId: string,
): RegistrationDeskRosterContestant[] {
  if (!data || !eventId) return [];

  const rolesByContestant = new Map<
    string,
    Set<"Header" | "Heeler">
  >();
  const addRole = (contestantId: string, role: "Header" | "Heeler") => {
    const roles = rolesByContestant.get(contestantId) ?? new Set();
    roles.add(role);
    rolesByContestant.set(contestantId, roles);
  };

  data.registrations
    .filter(
      (registration) =>
        registration.eventId === eventId &&
        registration.status !== "scratched",
    )
    .forEach((registration) =>
      addRole(registration.contestantId, registration.role),
    );

  data.teams
    .filter((team) => team.eventId === eventId && !team.scratched)
    .forEach((team) => {
      addRole(team.headerId, "Header");
      addRole(team.heelerId, "Heeler");
    });

  return data.contestants
    .filter((contestant) => rolesByContestant.has(contestant.id))
    .map((contestant) => ({
      id: contestant.id,
      name: contestant.name,
      roles: Array.from(rolesByContestant.get(contestant.id) ?? []),
      headerHandicap: contestant.headerHandicap,
      heelerHandicap: contestant.heelerHandicap,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
