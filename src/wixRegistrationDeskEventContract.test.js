import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  REGISTRATION_DESK_EVENT_STATUS_ERROR,
  assertRegistrationDeskOpen,
  registrationDeskIsVisible,
  registrationDeskRosterScope,
} from "../wix/backend/registration-desk-event-contract.js";

describe("Wix Registration Desk event contract mirror", () => {
  it("includes live and upcoming roster data but excludes completed events", () => {
    const workspace = {
      events: [
        { id: "live", status: "Live" },
        { id: "upcoming", status: "Upcoming" },
        { id: "complete", status: "Complete" },
      ],
      teams: [
        { id: "live-team", eventId: "live", round: 1 },
        { id: "future-team", eventId: "upcoming", round: 1 },
        { id: "complete-team", eventId: "complete", round: 1 },
        { id: "later-round", eventId: "live", round: 2 },
      ],
      registrations: [
        { id: "live-entry", eventId: "live" },
        { id: "future-entry", eventId: "upcoming" },
        { id: "complete-entry", eventId: "complete" },
      ],
    };

    expect(registrationDeskRosterScope(workspace)).toEqual({
      events: workspace.events.slice(0, 2),
      teams: workspace.teams.slice(0, 2),
      registrations: workspace.registrations.slice(0, 2),
    });
  });

  it("allows open upcoming events and preserves closed, locked, and status guards", () => {
    const upcoming = {
      status: "Upcoming",
      registrationOpen: true,
      drawLocked: false,
    };
    expect(registrationDeskIsVisible(upcoming)).toBe(true);
    expect(() => assertRegistrationDeskOpen(upcoming)).not.toThrow();
    expect(() =>
      assertRegistrationDeskOpen({ ...upcoming, registrationOpen: false }),
    ).toThrow("Registration is closed.");
    expect(() =>
      assertRegistrationDeskOpen({ ...upcoming, drawLocked: true }),
    ).toThrow("The draw is locked.");
    expect(() =>
      assertRegistrationDeskOpen({ ...upcoming, status: "Complete" }),
    ).toThrow(REGISTRATION_DESK_EVENT_STATUS_ERROR);
  });

  it("wires the backend projection and guard to the shared contract", () => {
    const backend = readFileSync(
      new URL("../wix/backend/arena-data.web.js", import.meta.url),
      "utf8",
    );
    expect(backend).toContain('from "./registration-desk-event-contract"');
    expect(backend).toContain("registrationDeskRosterScope(workspace)");
    expect(backend).toContain("assertRegistrationDeskOpen(event)");
    expect(backend).not.toContain(
      'const registrationDeskIsVisible = (event) => event.status === "Live"',
    );
  });
});
