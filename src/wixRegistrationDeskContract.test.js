import { describe, expect, it } from "vitest";
import {
  prepareRegistrationDeskSignup,
  supportedRegistrationDeskEntryTypes,
} from "../wix/backend/registration-desk-signup-contract.js";

const event = {
  id: "event-1",
  competitionType: "slide",
  entriesAllowed: 5,
  handicapTotal: 10,
  maxContestantHandicap: 8,
};

const contestant = (id) => ({
  id,
  name: id,
  role: "Both",
  headerHandicap: 4,
  heelerHandicap: 4,
  horses: [],
});

describe("Wix Registration Desk batch contract", () => {
  it("honors an explicit projected entry-type restriction", () => {
    expect(
      supportedRegistrationDeskEntryTypes({
        ...event,
        supportedEntryTypes: ["picked-teams"],
      }),
    ).toEqual(["picked-teams"]);
  });

  it("canonicalizes the discriminated picked-team request", () => {
    const prepared = prepareRegistrationDeskSignup(
      {
        events: [event],
        contestants: [contestant("header"), contestant("heeler")],
        registrations: [],
        teams: [],
      },
      {
        entryType: "picked-teams",
        eventId: event.id,
        submissionId: "submission-1",
        teams: [{
          rowId: "row-1",
          headerId: "header",
          heelerId: "heeler",
        }],
        payerContestantId: "header",
        paymentMethod: "tab",
        paymentConfirmed: false,
      },
    );

    expect(prepared.canonicalRequest).toEqual({
      entryType: "picked-teams",
      eventId: "event-1",
      submissionId: "submission-1",
      teams: [{
        rowId: "row-1",
        headerId: "header",
        headerHorseName: "",
        heelerId: "heeler",
        heelerHorseName: "",
      }],
      payerContestantId: "header",
      paymentMethod: "tab",
      paymentConfirmed: false,
    });
    expect(prepared.recordIds).toEqual({
      registrations: [],
      teams: ["desk-team-912834d48d8bec6c7d2fb2d072022e14"],
    });
  });
});
