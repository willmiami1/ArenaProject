import type { ArenaEvent, EventRegistration } from "./types";

export type RopingRole = "Header" | "Heeler";

export interface RoundRobinRoleCapacity {
  role: RopingRole;
  registered: number;
  maximum: number | null;
  remaining: number | null;
  full: boolean;
}

function configuredMaximum(value: number | undefined) {
  const maximum = Number(value);
  return Number.isInteger(maximum) && maximum > 0 ? maximum : null;
}

export function roundRobinRoleCapacity(
  event: Pick<ArenaEvent, "id" | "competitionType" | "maxHeaders" | "maxHeelers">,
  registrations: EventRegistration[],
  role: RopingRole,
): RoundRobinRoleCapacity {
  const maximum =
    event.competitionType === "round-robin"
      ? configuredMaximum(role === "Header" ? event.maxHeaders : event.maxHeelers)
      : null;
  const registered = registrations
    .filter(
      (registration) =>
        registration.eventId === event.id &&
        registration.role === role &&
        registration.status === "entered",
    )
    .reduce(
      (total, registration) =>
        total + (Number.isInteger(registration.entries) && registration.entries > 0
          ? registration.entries
          : 0),
      0,
    );
  const remaining = maximum === null ? null : Math.max(0, maximum - registered);
  return {
    role,
    registered,
    maximum,
    remaining,
    full: remaining === 0,
  };
}

export function assertRoundRobinRoleCapacity(
  event: Pick<ArenaEvent, "id" | "competitionType" | "maxHeaders" | "maxHeelers">,
  registrations: EventRegistration[],
  role: RopingRole,
  requestedEntries: number,
) {
  const capacity = roundRobinRoleCapacity(event, registrations, role);
  if (
    capacity.remaining !== null &&
    requestedEntries > capacity.remaining
  ) {
    throw new Error(`${role} registration is full.`);
  }
}
