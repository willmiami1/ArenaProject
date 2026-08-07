import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings, entryClearedForDraw } from "./competition";
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
      id: "locked-live-event",
      parentEventId: "meet",
      name: "Locked Live Roping",
      date: "2026-08-05",
      startTime: "19:00",
      location: "Arena",
      status: "Live",
      registrationOpen: false,
      drawLocked: true,
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
  it("includes live competitions regardless of entry state and strips run results", () => {
    const projected = registrationDeskProjection(
      data,
      new Date("2026-08-05T21:00:00"),
    );

    expect(projected.events.map((event) => event.id)).toEqual([
      "open-event",
      "locked-live-event",
    ]);
    expect(projected.events[1]).toMatchObject({
      registrationOpen: false,
      drawLocked: true,
    });
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
      horses: ["  Lucky  Star ", "lucky star", "Blue"],
    });

    expect(result.contestant).toMatchObject({
      name: "New Rider",
      email: "new@example.com",
      horses: ["Lucky Star", "Blue"],
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
      paymentConfirmed: true,
      paymentMethod: "cash" as const,
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
    expect(first.data.registrations[0].paid).toBe(true);
    expect(retry.result.existing).toBe(true);
    expect(retry.data.registrations).toHaveLength(1);
  });

  it("records Pick and Draw entries before an optional picked team", () => {
    const pickAndDrawData: ArenaData = {
      ...data,
      events: [
        {
          ...data.events[0],
          id: "pick-draw-event",
          competitionType: "pick-and-draw",
          pickDrawRole: "header",
          entriesAllowed: 4,
          minDrawsAllowed: 2,
        },
      ],
      contestants: [
        ...data.contestants,
        {
          id: "heeler",
          name: "Picked Heeler",
          role: "Heeler",
          headerHandicap: 0,
          heelerHandicap: 4,
          photo: "",
          phone: "",
          email: "",
          hometown: "",
        },
        {
          id: "heeler-two",
          name: "Second Heeler",
          role: "Heeler",
          headerHandicap: 0,
          heelerHandicap: 3,
          photo: "",
          phone: "",
          email: "",
          hometown: "",
        },
      ],
      teams: [],
      registrations: [
        {
          id: "heeler-draw",
          eventId: "pick-draw-event",
          contestantId: "heeler",
          role: "Heeler",
          entries: 1,
          checkedIn: false,
          status: "entered",
          notes: "",
          paid: true,
        },
        {
          id: "heeler-two-draw",
          eventId: "pick-draw-event",
          contestantId: "heeler-two",
          role: "Heeler",
          entries: 1,
          checkedIn: false,
          status: "entered",
          notes: "",
          paid: true,
        },
      ],
    };

    const result = submitLocalRegistrationDeskSignup(
      pickAndDrawData,
      {
        submissionId: "pick-draw-entry",
        contestantId: "rider",
        eventId: "pick-draw-event",
        role: "Header",
        entries: 2,
        partnerIds: ["heeler", "heeler-two"],
        paymentConfirmed: true,
        paymentMethod: "cash",
      },
      new Date("2026-08-05T21:00:00"),
    );

    expect(result.data.teams).toHaveLength(2);
    expect(result.data.registrations).toHaveLength(3);
    expect(result.result.registrations[0]).toMatchObject({
      contestantId: "rider",
      entries: 2,
    });
    expect(result.result.registrations[0].sourceTeamId).toBeUndefined();
    expect(() =>
      submitLocalRegistrationDeskSignup(
        pickAndDrawData,
        {
          submissionId: "too-few-draws",
          contestantId: "rider",
          eventId: "pick-draw-event",
          role: "Header",
          entries: 1,
          partnerIds: ["heeler"],
          paymentConfirmed: true,
          paymentMethod: "cash",
        },
        new Date("2026-08-05T21:00:00"),
      ),
    ).toThrow("at least 2 draw entries");
  });

  it("rejects a picked partner who is not entered in the draw", () => {
    const pickAndDrawData: ArenaData = {
      ...data,
      events: [
        {
          ...data.events[0],
          id: "pick-draw-event",
          competitionType: "pick-and-draw",
          pickDrawRole: "header",
          entriesAllowed: 4,
          minDrawsAllowed: 1,
        },
      ],
      contestants: [
        ...data.contestants,
        {
          id: "heeler",
          name: "Picked Heeler",
          role: "Heeler",
          headerHandicap: 0,
          heelerHandicap: 4,
          photo: "",
          phone: "",
          email: "",
          hometown: "",
        },
      ],
      teams: [],
      registrations: [],
    };

    expect(() =>
      submitLocalRegistrationDeskSignup(
        pickAndDrawData,
        {
          submissionId: "missing-partner-draw",
          contestantId: "rider",
          eventId: "pick-draw-event",
          role: "Header",
          entries: 1,
          partnerIds: ["heeler"],
          paymentConfirmed: true,
          paymentMethod: "cash",
        },
        new Date("2026-08-05T21:00:00"),
      ),
    ).toThrow("Every rider on a picked team");
  });

  it("does not create draw records before cashier payment confirmation", () => {
    expect(() =>
      submitLocalRegistrationDeskSignup(
        data,
        {
          submissionId: "unpaid-desk-entry",
          contestantId: "rider",
          eventId: "open-event",
          role: "Header",
          entries: 1,
          paymentMethod: "cash",
        },
        new Date("2026-08-05T21:00:00"),
      ),
    ).toThrow("confirm payment");
  });

  it("opens an unpaid tab while clearing its entries for the draw", () => {
    const result = submitLocalRegistrationDeskSignup(
      data,
      {
        submissionId: "desk-tab-entry",
        contestantId: "rider",
        eventId: "open-event",
        role: "Header",
        entries: 1,
        paymentMethod: "tab",
      },
      new Date("2026-08-05T21:00:00"),
    );

    expect(result.data.registrations[0]).toMatchObject({
      paid: false,
      paymentMethod: "tab",
    });
    expect(entryClearedForDraw(result.data.registrations[0])).toBe(true);
  });
});
