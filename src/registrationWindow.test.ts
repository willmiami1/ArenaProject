import { describe, expect, it } from "vitest";
import {
  REGISTRATION_DESK_EVENT_STATUS_ERROR,
  assertRegistrationDeskOpen,
  registrationDeskIsVisible,
} from "./registrationWindow";
import type { ArenaEvent } from "./types";

const event = (
  status: ArenaEvent["status"],
  overrides: Partial<ArenaEvent> = {},
) =>
  ({
    status,
    registrationOpen: true,
    drawLocked: false,
    ...overrides,
  }) as ArenaEvent;

describe("Registration Desk event availability", () => {
  it("shows exactly live and upcoming competitions", () => {
    expect(registrationDeskIsVisible(event("Live"))).toBe(true);
    expect(registrationDeskIsVisible(event("Upcoming"))).toBe(true);
    expect(registrationDeskIsVisible(event("Complete"))).toBe(false);
  });

  it("allows open, unlocked live and upcoming competitions", () => {
    expect(() => assertRegistrationDeskOpen(event("Live"))).not.toThrow();
    expect(() => assertRegistrationDeskOpen(event("Upcoming"))).not.toThrow();
  });

  it("still rejects unavailable, closed, and locked competitions", () => {
    expect(() => assertRegistrationDeskOpen(event("Complete"))).toThrow(
      REGISTRATION_DESK_EVENT_STATUS_ERROR,
    );
    expect(() =>
      assertRegistrationDeskOpen(event("Upcoming", { registrationOpen: false })),
    ).toThrow("Registration is closed.");
    expect(() =>
      assertRegistrationDeskOpen(event("Upcoming", { drawLocked: true })),
    ).toThrow("The draw is locked.");
  });
});
