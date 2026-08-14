const REGISTRATION_DESK_EVENT_STATUSES = new Set(["Live", "Upcoming"]);

export const REGISTRATION_DESK_EVENT_STATUS_ERROR =
  "Registration Desk entries are limited to live or upcoming competitions.";

export const registrationDeskIsVisible = (event) =>
  REGISTRATION_DESK_EVENT_STATUSES.has(event?.status);

export const registrationDeskEventScope = (events) => {
  const visibleEvents = (Array.isArray(events) ? events : []).filter(
    registrationDeskIsVisible,
  );
  return {
    events: visibleEvents,
    eventIds: new Set(visibleEvents.map((event) => event.id)),
  };
};

export const registrationDeskRosterScope = (workspace) => {
  const { events, eventIds } = registrationDeskEventScope(workspace?.events);
  return {
    events,
    teams: (Array.isArray(workspace?.teams) ? workspace.teams : []).filter(
      (team) => eventIds.has(team.eventId) && Number(team.round) === 1,
    ),
    registrations: (
      Array.isArray(workspace?.registrations) ? workspace.registrations : []
    ).filter((registration) => eventIds.has(registration.eventId)),
  };
};

export function assertRegistrationDeskEventAvailable(event) {
  if (!registrationDeskIsVisible(event)) {
    throw new Error(REGISTRATION_DESK_EVENT_STATUS_ERROR);
  }
}

export function assertRegistrationDeskOpen(event) {
  assertRegistrationDeskEventAvailable(event);
  if (!event.registrationOpen) throw new Error("Registration is closed.");
  if (event.drawLocked) throw new Error("The draw is locked.");
}
