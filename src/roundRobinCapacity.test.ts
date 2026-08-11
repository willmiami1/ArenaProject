import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  assertRoundRobinRoleCapacity,
  roundRobinRoleCapacity,
} from "./roundRobinCapacity";
import type { ArenaEvent, EventRegistration } from "./types";

const event: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "round-robin",
  parentEventId: "meet",
  name: "Round Robin",
  date: "2026-08-21",
  startTime: "19:00",
  location: "Arena",
  status: "Upcoming",
  entryFee: 200,
  competitionType: "round-robin",
  maxHeaders: 3,
  maxHeelers: 2,
};

const registration = (
  id: string,
  role: "Header" | "Heeler",
  entries: number,
  status: EventRegistration["status"] = "entered",
): EventRegistration => ({
  id,
  eventId: event.id,
  contestantId: id,
  role,
  entries,
  checkedIn: false,
  status,
  notes: "",
});

describe("Round Robin role capacity", () => {
  it("counts accepted entry slots independently by role", () => {
    const registrations = [
      registration("header-1", "Header", 2),
      registration("header-waitlist", "Header", 5, "waitlist"),
      registration("heeler-1", "Heeler", 1),
      registration("heeler-scratched", "Heeler", 4, "scratched"),
    ];

    expect(roundRobinRoleCapacity(event, registrations, "Header")).toMatchObject({
      registered: 2,
      maximum: 3,
      remaining: 1,
      full: false,
    });
    expect(roundRobinRoleCapacity(event, registrations, "Heeler")).toMatchObject({
      registered: 1,
      maximum: 2,
      remaining: 1,
      full: false,
    });
  });

  it("rejects a request that exceeds the remaining role capacity", () => {
    expect(() =>
      assertRoundRobinRoleCapacity(
        event,
        [registration("header-1", "Header", 2)],
        "Header",
        2,
      ),
    ).toThrow("Header registration is full");
  });

  it("keeps legacy events without configured maxima unlimited", () => {
    const legacyEvent = { ...event, maxHeaders: undefined, maxHeelers: undefined };
    expect(
      roundRobinRoleCapacity(
        legacyEvent,
        [registration("header-1", "Header", 100)],
        "Header",
      ),
    ).toMatchObject({ maximum: null, remaining: null, full: false });
  });
});
