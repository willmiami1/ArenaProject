import type { ArenaEvent } from "./types";

export const ONLINE_REGISTRATION_LEAD_MS = 60 * 60 * 1000;
const REGISTRATION_DESK_EVENT_STATUSES = new Set(["Live", "Upcoming"]);

export const REGISTRATION_DESK_EVENT_STATUS_ERROR =
  "Registration Desk entries are limited to live or upcoming competitions.";

export function competitionStartTime(
  event: Pick<ArenaEvent, "date" | "startTime">,
) {
  return new Date(`${event.date}T${event.startTime}:00`);
}

export function onlineRegistrationClosesAt(
  event: Pick<ArenaEvent, "date" | "startTime">,
) {
  return new Date(competitionStartTime(event).getTime() - ONLINE_REGISTRATION_LEAD_MS);
}

export function onlineRegistrationIsOpen(
  event: Pick<
    ArenaEvent,
    "date" | "startTime" | "registrationOpen" | "drawLocked" | "status"
  >,
  now = new Date(),
) {
  return (
    event.registrationOpen &&
    event.status !== "Complete" &&
    !event.drawLocked &&
    now.getTime() < onlineRegistrationClosesAt(event).getTime()
  );
}

export function assertOnlineRegistrationOpen(
  event: Pick<
    ArenaEvent,
    "date" | "startTime" | "registrationOpen" | "drawLocked" | "status"
  >,
  now = new Date(),
) {
  if (!event.registrationOpen) throw new Error("Registration is closed.");
  if (event.status === "Complete") throw new Error("This competition is complete.");
  if (event.drawLocked) throw new Error("The draw is locked.");
  if (now.getTime() >= onlineRegistrationClosesAt(event).getTime()) {
    throw new Error("Online registration closes one hour before the competition starts.");
  }
}

export function registrationDeskIsVisible(
  event: Pick<ArenaEvent, "status">,
) {
  return REGISTRATION_DESK_EVENT_STATUSES.has(event.status);
}

export function assertRegistrationDeskOpen(
  event: Pick<ArenaEvent, "registrationOpen" | "drawLocked" | "status">,
) {
  if (!registrationDeskIsVisible(event)) {
    throw new Error(REGISTRATION_DESK_EVENT_STATUS_ERROR);
  }
  if (!event.registrationOpen) throw new Error("Registration is closed.");
  if (event.drawLocked) throw new Error("The draw is locked.");
}
