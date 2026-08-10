import type { RegistrationDeskData } from "./registrationDeskData";

export interface RegistrationDeskRosterEntry {
  key: string;
  eventId: string;
  recordType: "registration" | "team";
  recordId: string;
  contestantId: string;
  name: string;
  role: "Header" | "Heeler";
  handicap: number;
  entries?: number;
  horseName?: string;
  paid?: boolean;
  paymentMethod?: "cash" | "card" | "tab";
  partnerName?: string;
  generated: boolean;
}

export function registrationDeskEventRoster(
  data: RegistrationDeskData | null,
  eventId: string,
): RegistrationDeskRosterEntry[] {
  if (!data || !eventId) return [];
  const contestants = new Map(
    data.contestants.map((contestant) => [contestant.id, contestant]),
  );

  const registrations = data.registrations.flatMap((registration) => {
    if (
      registration.eventId !== eventId ||
      registration.status === "scratched"
    ) {
      return [];
    }
    const contestant = contestants.get(registration.contestantId);
    if (!contestant) return [];
    return [{
      key: `registration:${registration.id}:${registration.role}`,
      eventId,
      recordType: "registration" as const,
      recordId: registration.id,
      contestantId: contestant.id,
      name: contestant.name,
      role: registration.role,
      handicap:
        registration.role === "Header"
          ? contestant.headerHandicap
          : contestant.heelerHandicap,
      entries: registration.entries,
      horseName: registration.horseName,
      paid: registration.paid,
      paymentMethod: registration.paymentMethod,
      generated: false,
    }];
  });

  const teams = data.teams.flatMap((team) => {
    if (team.eventId !== eventId || team.scratched) return [];
    const header = contestants.get(team.headerId);
    const heeler = contestants.get(team.heelerId);
    const entries: RegistrationDeskRosterEntry[] = [];
    if (header) {
      entries.push({
        key: `team:${team.id}:Header`,
        eventId,
        recordType: "team" as const,
        recordId: team.id,
        contestantId: header.id,
        name: header.name,
        role: "Header" as const,
        handicap: header.headerHandicap,
        horseName: team.headerHorseName,
        paid: team.paid,
        paymentMethod: team.paymentMethod,
        partnerName: heeler?.name,
        generated: team.generated,
      });
    }
    if (heeler) {
      entries.push({
        key: `team:${team.id}:Heeler`,
        eventId,
        recordType: "team" as const,
        recordId: team.id,
        contestantId: heeler.id,
        name: heeler.name,
        role: "Heeler" as const,
        handicap: heeler.heelerHandicap,
        horseName: team.heelerHorseName,
        paid: team.paid,
        paymentMethod: team.paymentMethod,
        partnerName: header?.name,
        generated: team.generated,
      });
    }
    return entries;
  });

  return [...registrations, ...teams].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.recordType.localeCompare(right.recordType) ||
      left.recordId.localeCompare(right.recordId),
  );
}
