import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  buildRegistrationDeskDrawRequest,
  buildRegistrationDeskPickedTeamsRequest,
  createRegistrationDeskTeamRow,
  defaultRegistrationDeskMode,
  pickedTeamRowsError,
  registrationDeskPayerCandidates,
  registrationDeskReviewComplete,
  registrationDeskRoleCandidates,
  registrationDeskTotals,
  resetRegistrationDeskEntryState,
  supportedRegistrationDeskModes,
  type RegistrationDeskTeamRow,
} from "./registrationDeskSignup";
import type { ArenaEvent, Contestant, EventRegistration } from "./types";

const event = (competitionType: ArenaEvent["competitionType"]): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: `event-${competitionType}`,
  parentEventId: "meet",
  name: competitionType,
  date: "2026-08-11",
  startTime: "18:00",
  location: "Arena",
  status: "Live",
  competitionType,
  entryFee: 50,
});

const contestant = (id: string, name: string): Contestant => ({
  id,
  name,
  role: "Both",
  headerHandicap: 4,
  heelerHandicap: 4,
  photo: "",
  phone: "",
  hometown: "",
});

const row = (
  rowId: string,
  headerId = "header",
  heelerId = "heeler",
): RegistrationDeskTeamRow => ({
  rowId,
  headerId,
  headerHorseName: "HEADER HORSE",
  heelerId,
  heelerHorseName: "HEELER HORSE",
});

describe("Registration Desk signup helpers", () => {
  it("limits pick-and-draw picked-team candidates to riders in the draw", () => {
    const riders = [
      contestant("in-draw", "IN DRAW"),
      contestant("no-draw", "NO DRAW"),
    ];
    const registrations: EventRegistration[] = [
      {
        id: "reg-1",
        eventId: "event-pick-and-draw",
        contestantId: "in-draw",
        role: "Header",
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
      },
    ];
    expect(
      registrationDeskRoleCandidates(
        riders,
        event("pick-and-draw"),
        registrations,
        "Header",
      ).map(({ id }) => id),
    ).toEqual(["in-draw"]);
    expect(
      registrationDeskRoleCandidates(
        riders,
        event("pick-only"),
        [],
        "Heeler",
      ).map(({ id }) => id),
    ).toEqual(["in-draw", "no-draw"]);
  });

  it("derives format availability and defaults", () => {
    expect(supportedRegistrationDeskModes(event("draw-pot"))).toEqual(["draws"]);
    expect(supportedRegistrationDeskModes(event("round-robin"))).toEqual(["draws"]);
    expect(supportedRegistrationDeskModes(event("pick-only"))).toEqual([
      "picked-teams",
    ]);
    expect(supportedRegistrationDeskModes(event("pick-and-draw"))).toEqual([
      "draws",
      "picked-teams",
    ]);
    expect(supportedRegistrationDeskModes(event("slide"))).toEqual([
      "draws",
      "picked-teams",
    ]);
    expect(
      supportedRegistrationDeskModes({
        ...event("slide"),
        supportedEntryTypes: ["picked-teams"],
      }),
    ).toEqual(["picked-teams"]);
    expect(defaultRegistrationDeskMode(event("pick-only"), "draws")).toBe(
      "picked-teams",
    );
  });

  it("resets incompatible mode state and creates stable valid rows", () => {
    const reset = resetRegistrationDeskEntryState(event("slide"), () => "row_1");
    expect(reset).toEqual({
      entryMode: "draws",
      teamRows: [
        {
          rowId: "row_1",
          headerId: "",
          headerHorseName: "",
          heelerId: "",
          heelerHorseName: "",
        },
      ],
      payerContestantId: "",
      paymentMethod: "",
      review: false,
      submissionId: "",
    });
    const stable = createRegistrationDeskTeamRow(() => "stable-row");
    expect({ ...stable, headerId: "header" }.rowId).toBe("stable-row");
  });

  it("builds the exact Draws request without old fields", () => {
    expect(
      buildRegistrationDeskDrawRequest({
        submissionId: "submission-1",
        eventId: "event-1",
        contestantId: "rider-1",
        horseName: " HORSE  ONE ",
        role: "Header",
        entries: 2,
        paymentMethod: "cash",
      }),
    ).toEqual({
      entryType: "draws",
      submissionId: "submission-1",
      eventId: "event-1",
      contestantId: "rider-1",
      horseName: "HORSE ONE",
      role: "Header",
      entries: 2,
      payerContestantId: "rider-1",
      paymentMethod: "cash",
      paymentConfirmed: true,
    });
  });

  it("builds the exact multi-team request with both horses", () => {
    expect(
      buildRegistrationDeskPickedTeamsRequest({
        submissionId: "submission-2",
        eventId: "event-2",
        rows: [row("row-a"), row("row-b", "header-2", "heeler-2")],
        payerContestantId: "heeler-2",
        paymentMethod: "tab",
      }),
    ).toEqual({
      entryType: "picked-teams",
      submissionId: "submission-2",
      eventId: "event-2",
      teams: [
        {
          rowId: "row-a",
          headerId: "header",
          headerHorseName: "HEADER HORSE",
          heelerId: "heeler",
          heelerHorseName: "HEELER HORSE",
        },
        {
          rowId: "row-b",
          headerId: "header-2",
          headerHorseName: "HEADER HORSE",
          heelerId: "heeler-2",
          heelerHorseName: "HEELER HORSE",
        },
      ],
      payerContestantId: "heeler-2",
      paymentMethod: "tab",
      paymentConfirmed: false,
    });
  });

  it("derives de-duplicated payers and invalidates removed riders", () => {
    const contestants = [
      contestant("header", "Header"),
      contestant("heeler", "Heeler"),
      contestant("other", "Other"),
    ];
    expect(
      registrationDeskPayerCandidates(
        [row("one"), row("two", "header", "other")],
        contestants,
      ).map(({ id }) => id),
    ).toEqual(["header", "heeler", "other"]);
    expect(pickedTeamRowsError([row("one")], "other")).toMatch(/riders/);
  });

  it("calculates totals and review completeness", () => {
    expect(registrationDeskTotals("draws", 3, [row("one")], 50)).toEqual({
      runCount: 3,
      amount: 150,
    });
    expect(
      registrationDeskTotals(
        "picked-teams",
        9,
        [row("one"), row("two")],
        50,
      ),
    ).toEqual({ runCount: 2, amount: 100 });
    expect(
      registrationDeskReviewComplete("picked-teams", {
        rows: [row("one")],
        payerContestantId: "header",
        paymentMethod: "card",
      }),
    ).toBe(true);
  });

  it("rejects incomplete rows, same rider, duplicate row IDs, and outside payers", () => {
    expect(pickedTeamRowsError([{ ...row("one"), heelerId: "" }])).toMatch(
      /every team/,
    );
    expect(pickedTeamRowsError([row("one", "same", "same")])).toMatch(
      /both Header and Heeler/,
    );
    expect(pickedTeamRowsError([row("same"), row("same")])).toMatch(/unique/);
    expect(pickedTeamRowsError([row("one")], "outsider")).toMatch(/payer/);
    expect(() =>
      buildRegistrationDeskPickedTeamsRequest({
        submissionId: "submission",
        eventId: "event",
        rows: [row("one", "same", "same")],
        payerContestantId: "same",
        paymentMethod: "cash",
      }),
    ).toThrow(/both Header and Heeler/);
  });
});
