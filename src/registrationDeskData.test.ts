import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  registrationDeskProjection,
  submitLocalRegistrationDeskSignup,
  upsertRegistrationDeskContestant,
} from "./registrationDeskData";
import type { ArenaData } from "./types";

const data: ArenaData = {
  participantDatabaseVersion: 2,
  meets: [],
  events: [
    {
      ...defaultCompetitionSettings,
      id: "open-event",
      parentEventId: "meet",
      name: "Open Roping",
      date: "2026-08-05",
      startTime: "18:00",
      location: "Arena",
      status: "Live",
      competitionType: "draw-pot",
      entryFee: 50,
    },
    {
      ...defaultCompetitionSettings,
      id: "upcoming-event",
      parentEventId: "meet",
      name: "Upcoming Roping",
      date: "2026-08-05",
      startTime: "20:00",
      location: "Arena",
      status: "Upcoming",
      registrationOpen: true,
      entryFee: 50,
    },
    {
      ...defaultCompetitionSettings,
      id: "closed-event",
      parentEventId: "meet",
      name: "Closed Roping",
      date: "2026-08-05",
      startTime: "18:00",
      location: "Arena",
      status: "Complete",
      entryFee: 50,
    },
  ],
  contestants: [
    {
      id: "rider",
      name: "Arena Rider",
      role: "Both",
      headerHandicap: 4,
      heelerHandicap: 4,
      photo: "",
      phone: "555-0100",
      email: "rider@example.com",
      hometown: "Bushnell",
    },
  ],
  teams: [
    {
      id: "team",
      eventId: "open-event",
      headerId: "rider",
      heelerId: "partner",
      drawPosition: 1,
      status: "complete",
      rawTime: 7,
      penalties: 5,
      notes: "private result note",
      round: 1,
      checkedIn: true,
      scratched: false,
      generated: false,
      points: 10,
      predictionClosesAt: "2026-08-05T17:00:00.000Z",
    },
  ],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: "open-event",
};

describe("registration desk boundary", () => {
  it("includes only live open competitions and strips run results", () => {
    const projected = registrationDeskProjection(
      data,
      new Date("2026-08-05T21:00:00"),
    );

    expect(projected.events.map((event) => event.id)).toEqual(["open-event"]);
    expect(projected.events[0]).not.toHaveProperty("drawHistory");
    expect(projected.events[0]).not.toHaveProperty("payoutPercentages");
    expect(projected.events[0]).not.toHaveProperty("producerFeePercent");
    expect(projected.teams[0]).toMatchObject({
      rawTime: null,
      penalties: 0,
      notes: "",
      points: 0,
      predictionClosesAt: undefined,
    });
  });

  it("adds a validated contestant without changing other workspace data", () => {
    const result = upsertRegistrationDeskContestant(data, {
      name: " New Rider ",
      role: "Header",
      headerHandicap: 5,
      heelerHandicap: 0,
      phone: "555-0200",
      email: "NEW@example.com",
      hometown: "Bushnell",
    });

    expect(result.contestant).toMatchObject({
      name: "New Rider",
      email: "new@example.com",
    });
    expect(result.data.events).toBe(data.events);
    expect(result.data.teams).toBe(data.teams);
    expect(result.data.contestants).toHaveLength(2);
  });

  it("rejects duplicate contestant login emails", () => {
    expect(() =>
      upsertRegistrationDeskContestant(data, {
        name: "Duplicate Rider",
        role: "Both",
        headerHandicap: 3,
        heelerHandicap: 3,
        phone: "",
        email: "RIDER@example.com",
        hometown: "",
      }),
    ).toThrow("already uses that email");
  });

  it("marks desk entries as staff-created and does not duplicate retries", () => {
    const request = {
      submissionId: "desk-retry",
      contestantId: "rider",
      eventId: "open-event",
      role: "Header" as const,
      entries: 1,
    };
    const first = submitLocalRegistrationDeskSignup(
      data,
      request,
      new Date("2026-08-05T21:00:00"),
    );
    const retry = submitLocalRegistrationDeskSignup(
      first.data,
      request,
      new Date("2026-08-05T21:01:00"),
    );

    expect(first.data.registrations).toHaveLength(1);
    expect(first.data.registrations[0].source).toBe("staff");
    expect(retry.result.existing).toBe(true);
    expect(retry.data.registrations).toHaveLength(1);
  });
});
