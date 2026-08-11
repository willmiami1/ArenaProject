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
  role: EventRegistration["role"] = "Header",
  status: EventRegistration["status"] = "entered",
): EventRegistration => ({
  id,
  eventId: "live-event",
  contestantId,
  role,
  entries: 2,
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
  headerHorseName: "HEADER HORSE",
  heelerHorseName: "HEELER HORSE",
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
  payerContestantId: "heeler",
  paymentMethod: "tab",
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

describe("Registration Desk competition roster entries", () => {
  it("keeps each underlying registration and team role independently actionable", () => {
    const roster = registrationDeskEventRoster(
      data(
        [contestant("header", "Header"), contestant("heeler", "Heeler")],
        [
          registration("entry-one", "header"),
          registration("entry-two", "header"),
        ],
        [team("team-one", "header", "heeler")],
      ),
      "live-event",
    );

    expect(roster.map((entry) => entry.key)).toEqual([
      "registration:entry-one:Header",
      "registration:entry-two:Header",
      "team:team-one:Header",
      "team:team-one:Heeler",
    ]);
    expect(roster.find((entry) => entry.key === "team:team-one:Header")).toMatchObject({
      partnerName: "Heeler",
      horseName: "HEADER HORSE",
      payerName: "Heeler",
      paymentMethod: "tab",
    });
    expect(roster.find((entry) => entry.key === "team:team-one:Heeler")).toMatchObject({
      horseName: "HEELER HORSE",
      payerName: "Heeler",
    });
    expect(roster[0]).not.toHaveProperty("phone");
    expect(roster[0]).not.toHaveProperty("email");
  });

  it("classifies dual-role registrations into their exact event roles", () => {
    const roster = registrationDeskEventRoster(
      data(
        [contestant("dual", "Dual Rider")],
        [
          registration("header-entry", "dual", "Header"),
          registration("heeler-entry", "dual", "Heeler"),
        ],
        [],
      ),
      "live-event",
    );

    expect(roster.map(({ recordId, role }) => ({ recordId, role }))).toEqual([
      { recordId: "header-entry", role: "Header" },
      { recordId: "heeler-entry", role: "Heeler" },
    ]);
  });

  it("excludes scratched records and records from another event", () => {
    const otherEvent = {
      ...registration("other", "active"),
      eventId: "other-event",
    };
    const roster = registrationDeskEventRoster(
      data(
        [contestant("active", "Active"), contestant("scratched", "Scratched")],
        [
          registration("active", "active"),
          registration("scratched", "scratched", "Header", "scratched"),
          otherEvent,
        ],
        [team("scratched-team", "scratched", "active", true)],
      ),
      "live-event",
    );

    expect(roster.map((entry) => entry.recordId)).toEqual(["active"]);
  });

  it("returns an empty roster without data or a selected event", () => {
    expect(registrationDeskEventRoster(null, "live-event")).toEqual([]);
    expect(registrationDeskEventRoster(data([], [], []), "")).toEqual([]);
  });
});
