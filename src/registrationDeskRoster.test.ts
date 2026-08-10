import { describe, expect, it } from "vitest";
import type { RegistrationDeskData } from "./registrationDeskData";
import { registrationDeskEventRoster } from "./registrationDeskRoster";
import type { Contestant, EventRegistration, Team } from "./types";

const contestant = (id: string, name: string): Contestant => ({
  id,
  name,
  role: "Both",
  headerHandicap: 4,
  heelerHandicap: 3,
  photo: "",
  phone: "private",
  email: "private@example.com",
  hometown: "Arena",
});

const registration = (
  id: string,
  contestantId: string,
  status: EventRegistration["status"] = "entered",
): EventRegistration => ({
  id,
  eventId: "live-event",
  contestantId,
  role: "Header",
  entries: 1,
  checkedIn: false,
  status,
  notes: "",
});

const team = (
  id: string,
  headerId: string,
  heelerId: string,
  scratched = false,
): Team => ({
  id,
  eventId: "live-event",
  headerId,
  heelerId,
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: false,
  scratched,
  generated: false,
  points: 0,
});

const data = (
  contestants: Contestant[],
  registrations: EventRegistration[],
  teams: Team[],
): RegistrationDeskData => ({
  events: [],
  contestants,
  registrations,
  teams,
});

describe("Registration Desk competition roster", () => {
  it("combines registrations and teams without duplicating contestants", () => {
    const roster = registrationDeskEventRoster(
      data(
        [contestant("rider-a", "Zed Rider"), contestant("rider-b", "Amy Rider")],
        [registration("entry-a", "rider-a")],
        [team("team-a", "rider-a", "rider-b")],
      ),
      "live-event",
    );

    expect(roster).toEqual([
      expect.objectContaining({
        id: "rider-b",
        name: "Amy Rider",
        roles: ["Heeler"],
      }),
      expect.objectContaining({
        id: "rider-a",
        name: "Zed Rider",
        roles: ["Header"],
      }),
    ]);
    expect(roster[0]).not.toHaveProperty("phone");
    expect(roster[0]).not.toHaveProperty("email");
  });

  it("excludes scratched registrations and teams", () => {
    const roster = registrationDeskEventRoster(
      data(
        [contestant("registered", "Registered"), contestant("scratched", "Scratched")],
        [
          registration("active", "registered"),
          registration("scratched-entry", "scratched", "scratched"),
        ],
        [team("scratched-team", "scratched", "registered", true)],
      ),
      "live-event",
    );

    expect(roster.map((entry) => entry.id)).toEqual(["registered"]);
  });

  it("includes active waitlisted signups and ignores other events", () => {
    const waitlist = registration("waitlist", "waiting", "waitlist");
    const otherEvent = {
      ...registration("other", "other"),
      eventId: "other-event",
    };
    const roster = registrationDeskEventRoster(
      data(
        [contestant("waiting", "Waiting"), contestant("other", "Other")],
        [waitlist, otherEvent],
        [],
      ),
      "live-event",
    );

    expect(roster.map((entry) => entry.id)).toEqual(["waiting"]);
  });

  it("returns an empty roster without data or a selected event", () => {
    expect(registrationDeskEventRoster(null, "live-event")).toEqual([]);
    expect(registrationDeskEventRoster(data([], [], []), "")).toEqual([]);
  });
});
