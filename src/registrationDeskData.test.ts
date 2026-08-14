import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings, entryClearedForDraw } from "./competition";
import {
  registrationDeskProjection,
  submitLocalRegistrationDeskSignup,
  upsertRegistrationDeskContestant,
} from "./registrationDeskData";
import type {
  RegistrationDeskPickedTeamsRequest,
  RegistrationDeskSignupRequest,
} from "./registrationDeskSignup";
import type { ArenaData, ArenaEvent, Contestant, EventRegistration } from "./types";

const contestant = (
  id: string,
  role: Contestant["role"],
  headerHandicap: number,
  heelerHandicap: number,
  horses: string[] = [],
): Contestant => ({
  id,
  name: id.toUpperCase(),
  role,
  headerHandicap,
  heelerHandicap,
  horses,
  photo: "",
  phone: "",
  email: `${id}@example.com`,
  hometown: "Arena",
});

const contestants = [
  contestant("header-1", "Header", 3, 9, ["HEADER HORSE"]),
  contestant("header-2", "Both", 4, 4, ["SECOND HEADER"]),
  contestant("heeler-1", "Heeler", 9, 3, ["HEELER HORSE"]),
  contestant("heeler-2", "Both", 4, 4, ["SECOND HEELER"]),
  contestant("outside", "Both", 3, 3),
];

const event = (
  competitionType: ArenaEvent["competitionType"],
  overrides: Partial<ArenaEvent> = {},
): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: `event-${competitionType}`,
  parentEventId: "meet",
  name: `${competitionType} event`,
  date: "2026-08-11",
  startTime: "18:00",
  location: "Arena",
  status: "Live",
  registrationOpen: true,
  drawLocked: false,
  competitionType,
  entryFee: 50,
  entriesAllowed: 5,
  handicapTotal: 10,
  maxContestantHandicap: 8,
  ...overrides,
});

const workspace = (
  selectedEvent: ArenaEvent,
  overrides: Partial<ArenaData> = {},
): ArenaData => ({
  participantDatabaseVersion: 2,
  meets: [],
  events: [selectedEvent],
  contestants,
  teams: [],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: selectedEvent.id,
  ...overrides,
});

const draw = (
  selectedEvent: ArenaEvent,
  overrides: Partial<RegistrationDeskSignupRequest> = {},
): RegistrationDeskSignupRequest => ({
  entryType: "draws",
  submissionId: "draw-submission",
  eventId: selectedEvent.id,
  contestantId: "header-1",
  horseName: "header horse",
  role: "Header",
  entries: 1,
  payerContestantId: "header-1",
  paymentMethod: "cash",
  paymentConfirmed: true,
  ...overrides,
} as RegistrationDeskSignupRequest);

const picked = (
  selectedEvent: ArenaEvent,
  overrides: Partial<RegistrationDeskPickedTeamsRequest> = {},
): RegistrationDeskPickedTeamsRequest => ({
  entryType: "picked-teams",
  submissionId: "picked-submission",
  eventId: selectedEvent.id,
  teams: [
    {
      rowId: "row-1",
      headerId: "header-1",
      headerHorseName: "header horse",
      heelerId: "heeler-1",
      heelerHorseName: "heeler horse",
    },
  ],
  payerContestantId: "header-1",
  paymentMethod: "card",
  paymentConfirmed: true,
  ...overrides,
});

const drawRegistration = (
  selectedEvent: ArenaEvent,
  contestantId: string,
  entries = 1,
): EventRegistration => ({
  id: `draw-${contestantId}`,
  eventId: selectedEvent.id,
  contestantId,
  role: contestantId.startsWith("header") ? "Header" : "Heeler",
  entries,
  checkedIn: false,
  status: "entered",
  notes: "",
});

describe("Registration Desk local mirror", () => {
  it("projects only open, unlocked Live and Upcoming events", () => {
    const selectedEvent = event("pick-and-draw");
    const upcoming = event("pick-only", {
      id: "upcoming",
      status: "Upcoming",
    });
    const projected = registrationDeskProjection(
      workspace(selectedEvent, {
        events: [
          selectedEvent,
          upcoming,
          event("pick-only", { id: "complete", status: "Complete" }),
          event("pick-only", { id: "closed", registrationOpen: false }),
          event("pick-only", { id: "locked", drawLocked: true }),
        ],
        registrations: [drawRegistration(upcoming, "header-1")],
      }),
    );
    expect(projected.events.map(({ id }) => id)).toEqual([
      selectedEvent.id,
      upcoming.id,
    ]);
    expect(projected.events[0].supportedEntryTypes).toEqual([
      "draws",
      "picked-teams",
    ]);
    expect(projected.registrations).toHaveLength(1);
    expect(projected.registrations[0].eventId).toBe(upcoming.id);
  });

  it("accepts an open Upcoming entry and rejects unavailable statuses and windows", () => {
    const upcoming = event("draw-pot", { status: "Upcoming" });
    expect(
      submitLocalRegistrationDeskSignup(
        workspace(upcoming),
        draw(upcoming),
      ).data.registrations,
    ).toHaveLength(1);

    for (const [overrides, message] of [
      [{ status: "Upcoming", registrationOpen: false }, /Registration is closed/],
      [{ status: "Upcoming", drawLocked: true }, /draw is locked/],
      [{ status: "Complete" }, /Live or Upcoming/],
    ] as const) {
      const unavailable = event("draw-pot", overrides);
      expect(() =>
        submitLocalRegistrationDeskSignup(
          workspace(unavailable),
          draw(unavailable),
        ),
      ).toThrow(message);
    }
  });

  it("keeps contestant profile validation and canonical horse names", () => {
    const selectedEvent = event("draw-pot");
    const result = upsertRegistrationDeskContestant(workspace(selectedEvent), {
      name: " New Rider ",
      role: "Both",
      headerHandicap: 3,
      heelerHandicap: 3,
      phone: "",
      email: "NEW@example.com",
      hometown: "Arena",
      horses: [" Lucky  Star ", "lucky star"],
    });
    expect(result.contestant).toMatchObject({
      name: "New Rider",
      email: "new@example.com",
      horses: ["Lucky Star"],
    });
  });

  it("persists multiple unrelated picked pairs, both horses, and payer metadata", () => {
    const selectedEvent = event("pick-only");
    const result = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      picked(selectedEvent, {
        teams: [
          picked(selectedEvent).teams[0],
          {
            rowId: "row-2",
            headerId: "header-2",
            headerHorseName: "second header",
            heelerId: "heeler-2",
            heelerHorseName: "second heeler",
          },
        ],
        payerContestantId: "heeler-2",
      }),
    );
    expect(result.data.teams).toHaveLength(2);
    expect(result.data.teams[0]).toMatchObject({
      id: "desk-team-80ad60702c05fea20d6adb9f639af81f",
      rowId: "row-1",
      headerHorseName: "HEADER HORSE",
      heelerHorseName: "HEELER HORSE",
      payerContestantId: "heeler-2",
      paymentMethod: "card",
      paid: true,
      entryType: "picked-teams",
    });
    expect(result.result.recordIds.teams).toHaveLength(2);
  });

  it.each(["pick-only", "pick-and-draw", "slide"] as const)(
    "allows %s teams without draw registrations",
    (competitionType) => {
      const selectedEvent = event(competitionType);
      expect(
        submitLocalRegistrationDeskSignup(
          workspace(selectedEvent),
          picked(selectedEvent),
        ).data.teams,
      ).toHaveLength(1);
    },
  );

  it("aggregates persisted draws and all in-batch teams against rider capacity", () => {
    const selectedEvent = event("pick-only", { entriesAllowed: 3 });
    const data = workspace(selectedEvent, {
      registrations: [drawRegistration(selectedEvent, "header-1", 2)],
    });
    expect(() =>
      submitLocalRegistrationDeskSignup(
        data,
        picked(selectedEvent, {
          teams: [
            picked(selectedEvent).teams[0],
            {
              rowId: "row-2",
              headerId: "header-1",
              heelerId: "heeler-2",
            },
          ],
        }),
      ),
    ).toThrow(/Entry limit exceeded for HEADER-1/);
  });

  it("enforces repeat policy against existing and in-batch pairs", () => {
    const selectedEvent = event("pick-only");
    const first = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      picked(selectedEvent, { submissionId: "first" }),
    );
    expect(() =>
      submitLocalRegistrationDeskSignup(
        first.data,
        picked(selectedEvent, { submissionId: "second" }),
      ),
    ).toThrow(/partnership is already entered/);
    expect(() =>
      submitLocalRegistrationDeskSignup(
        workspace(selectedEvent),
        picked(selectedEvent, {
          teams: [
            picked(selectedEvent).teams[0],
            { ...picked(selectedEvent).teams[0], rowId: "row-2" },
          ],
        }),
      ),
    ).toThrow(/partnership is already entered/);
  });

  it("allows identical rows with distinct row IDs when repeats are enabled", () => {
    const selectedEvent = event("pick-only", {
      allowRepeatPartners: true,
    });
    const result = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      picked(selectedEvent, {
        teams: [
          picked(selectedEvent).teams[0],
          { ...picked(selectedEvent).teams[0], rowId: "row-2" },
        ],
      }),
    );
    expect(result.data.teams).toHaveLength(2);
    expect(new Set(result.data.teams.map(({ id }) => id)).size).toBe(2);
  });

  it("treats reordered rows as the same logical retry without duplicates", () => {
    const selectedEvent = event("pick-only");
    const request = picked(selectedEvent, {
      teams: [
        picked(selectedEvent).teams[0],
        {
          rowId: "row-2",
          headerId: "header-2",
          heelerId: "heeler-2",
        },
      ],
    });
    const first = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      request,
    );
    const retry = submitLocalRegistrationDeskSignup(first.data, {
      ...request,
      teams: [...request.teams].reverse(),
    });
    expect(retry.result.existing).toBe(true);
    expect(retry.data.teams).toHaveLength(2);
  });

  it.each([
    ["rows", { teams: [{ ...picked(event("pick-only")).teams[0], heelerId: "heeler-2", heelerHorseName: "second heeler" }] }],
    ["horses", { teams: [{ ...picked(event("pick-only")).teams[0], headerHorseName: "" }] }],
    ["payer", { payerContestantId: "heeler-1" }],
    ["payment", { paymentMethod: "cash" as const }],
  ])("conflicts when retry changes %s", (_label, change) => {
    const selectedEvent = event("pick-only");
    const request = picked(selectedEvent);
    const first = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      request,
    );
    expect(() =>
      submitLocalRegistrationDeskSignup(first.data, {
        ...request,
        ...change,
      } as RegistrationDeskPickedTeamsRequest),
    ).toThrow(/submission ID is already in use/);
  });

  it("requires cash/card confirmation and keeps tab entries draw-cleared", () => {
    const selectedEvent = event("draw-pot");
    expect(() =>
      submitLocalRegistrationDeskSignup(
        workspace(selectedEvent),
        draw(selectedEvent, { paymentConfirmed: false }),
      ),
    ).toThrow(/confirm the payment/);
    expect(() =>
      submitLocalRegistrationDeskSignup(
        workspace(selectedEvent),
        draw(selectedEvent, {
          paymentMethod: "card",
          paymentConfirmed: false,
        }),
      ),
    ).toThrow(/confirm the payment/);

    const cash = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      draw(selectedEvent),
    );
    expect(cash.data.registrations[0]).toMatchObject({
      id: "desk-registration-ac8883bd317944d98229e89c5cb3d6cc",
      horseName: "HEADER HORSE",
      paid: true,
      payerContestantId: "header-1",
      paymentMethod: "cash",
      submissionFingerprint:
        "e64c53d1ef70ce0cde296b4db74858678ae4fa28b67547f6c734dfabd2bab044",
    });

    const tab = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      draw(selectedEvent, {
        submissionId: "tab-submission",
        paymentMethod: "tab",
        paymentConfirmed: false,
      }),
    );
    expect(tab.data.registrations[0]).toMatchObject({
      paid: false,
      paymentMethod: "tab",
    });
    expect(entryClearedForDraw(tab.data.registrations[0])).toBe(true);
  });

  it("canonicalizes omitted horse fields exactly like the backend contract", () => {
    const selectedEvent = event("pick-only");
    const result = submitLocalRegistrationDeskSignup(
      workspace(selectedEvent),
      picked(selectedEvent, {
        teams: [{
          rowId: "empty-horses",
          headerId: "header-1",
          heelerId: "heeler-1",
        }],
      }),
    );
    expect(result.data.teams[0]).toMatchObject({
      headerHorseName: "",
      heelerHorseName: "",
    });
  });
});
