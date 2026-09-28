import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings, drawPairingProblems } from "./competition";
import type { ArenaEvent, Contestant, EventRegistration } from "./types";

const event = (overrides: Partial<ArenaEvent> = {}): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "competition-1",
  parentEventId: "meet-1",
  name: "10.5 Roping",
  date: "2026-08-05",
  startTime: "18:00",
  location: "Destiny Arena",
  status: "Upcoming",
  entryFee: 50,
  competitionType: "draw-pot",
  handicapTotal: 10.5,
  maxContestantHandicap: 7,
  allowRepeatPartners: false,
  ...overrides,
});

const contestant = (
  id: string,
  role: Contestant["role"],
  headerHandicap: number,
  heelerHandicap: number,
): Contestant => ({
  id,
  name: id.toUpperCase(),
  role,
  headerHandicap,
  heelerHandicap,
  photo: "",
  phone: "",
  email: "",
  hometown: "",
  horses: [],
});

const registration = (
  contestantId: string,
  role: EventRegistration["role"],
  entries = 1,
): EventRegistration => ({
  id: `reg-${role}-${contestantId}`,
  eventId: "competition-1",
  contestantId,
  role,
  entries,
  checkedIn: true,
  status: "entered",
  notes: "",
  paid: true,
});

describe("drawPairingProblems", () => {
  it("names the rider who has no partner low enough for the handicap total", () => {
    const contestants = [
      contestant("h5", "Header", 5, 0),
      contestant("h4", "Header", 4, 0),
      contestant("l7", "Heeler", 0, 7),
      contestant("l5", "Heeler", 0, 5),
    ];
    const registrations = [
      registration("h5", "Header"),
      registration("h4", "Header"),
      registration("l7", "Heeler"),
      registration("l5", "Heeler"),
    ];
    const problems = drawPairingProblems(event(), registrations, [], contestants);
    expect(problems.map((problem) => problem.contestantId)).toEqual(["l7"]);
    expect(problems[0].reason).toContain("L7 (#7 heeler)");
    expect(problems[0].reason).toContain("#3.5 or lower");
  });

  it("flags riders whose entries exceed their eligible partners without repeat runs", () => {
    const contestants = [
      contestant("h3", "Header", 3, 0),
      contestant("l7", "Heeler", 0, 7),
      contestant("l6", "Heeler", 0, 6),
    ];
    const registrations = [
      registration("h3", "Header", 2),
      registration("l7", "Heeler", 2),
      registration("l6", "Heeler"),
    ];
    const problems = drawPairingProblems(event(), registrations, [], contestants);
    expect(problems.map((problem) => problem.contestantId)).toEqual(["l7"]);
    expect(problems[0].reason).toContain("has 2 entries but only 1 eligible header");
  });

  it("reports nothing when every entry can be matched", () => {
    const contestants = [
      contestant("h3", "Header", 3, 0),
      contestant("l7", "Heeler", 0, 7),
    ];
    const registrations = [registration("h3", "Header"), registration("l7", "Heeler")];
    expect(drawPairingProblems(event(), registrations, [], contestants)).toEqual([]);
  });
});
