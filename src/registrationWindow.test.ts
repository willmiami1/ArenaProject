import { describe, expect, it } from "vitest";
import {
  assertRegistrationDeskOpen,
  registrationDeskIsVisible,
} from "./registrationWindow";
import type { ArenaEvent } from "./types";

const event = (
  status: ArenaEvent["status"],
  overrides: Partial<ArenaEvent> = {},
) => ({
  status,
  registrationOpen: true,
  drawLocked: false,
  ...overrides,
});

describe("Registration Desk event window", () => {
  it("includes open, unlocked Live and Upcoming events only", () => {
    expect(registrationDeskIsVisible(event("Live"))).toBe(true);
    expect(registrationDeskIsVisible(event("Upcoming"))).toBe(true);
    expect(registrationDeskIsVisible(event("Complete"))).toBe(false);
    expect(
      registrationDeskIsVisible(event("Upcoming", { registrationOpen: false })),
    ).toBe(false);
    expect(
      registrationDeskIsVisible(event("Upcoming", { drawLocked: true })),
    ).toBe(false);
    expect(
      registrationDeskIsVisible({
        status: "Upcoming",
        registrationOpen: true,
      } as Pick<
        ArenaEvent,
        "registrationOpen" | "drawLocked" | "status"
      >),
    ).toBe(false);
    expect(
      registrationDeskIsVisible({
        ...event("Upcoming"),
        status: "Unknown",
      } as unknown as Pick<
        ArenaEvent,
        "registrationOpen" | "drawLocked" | "status"
      >),
    ).toBe(false);
  });

  it("accepts Upcoming entries only while registration is open and unlocked", () => {
    expect(() => assertRegistrationDeskOpen(event("Upcoming"))).not.toThrow();
    expect(() =>
      assertRegistrationDeskOpen(
        event("Upcoming", { registrationOpen: false }),
      ),
    ).toThrow("Registration is closed.");
    expect(() =>
      assertRegistrationDeskOpen(event("Upcoming", { drawLocked: true })),
    ).toThrow("The draw is locked.");
    expect(() =>
      assertRegistrationDeskOpen({
        status: "Upcoming",
        registrationOpen: true,
      } as Pick<
        ArenaEvent,
        "registrationOpen" | "drawLocked" | "status"
      >),
    ).toThrow("The draw is locked.");
    expect(() => assertRegistrationDeskOpen(event("Complete"))).toThrow(
      "Live or Upcoming",
    );
  });
});
