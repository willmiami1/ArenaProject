import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import { generateTestEntries } from "./testTeams";
import type { ArenaEvent, Contestant, EventRegistration } from "./types";

const baseEvent: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "event-1",
  parentEventId: "meet-1",
  name: "Test Roping",
  date: "2026-08-04",
  startTime: "18:00",
  location: "Destiny Ranch Arena",
  status: "Live",
  entryFee: 100,
  competitionType: "draw-pot",
  maxContestantHandicap: 6,
  handicapTotal: 10,
};

const rider = (
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
  hometown: "",
});

const contestants: Contestant[] = [
  rider("h1", "Header", 4, 0),
  rider("h2", "Header", 3, 0),
  rider("h3", "Header", 9, 0),
  rider("b1", "Both", 3, 3),
  rider("e1", "Heeler", 0, 5),
  rider("e2", "Heeler", 0, 2),
];

let seq = 0;
const makeId = (prefix: string) => `${prefix}-${(seq += 1)}`;
const fixedRandom = () => 0.5;

describe("generate test entries", () => {
  it("registers eligible headers and heelers in the draw, skipping riders already entered", () => {
    const existing: EventRegistration[] = [
      { id: "r1", eventId: "event-1", contestantId: "h1", role: "Header", entries: 1, checkedIn: false, status: "entered", notes: "" },
    ];
    const result = generateTestEntries(baseEvent, contestants, existing, [], 2, makeId, fixedRandom);

    const headers = result.registrations.filter((entry) => entry.role === "Header").map((entry) => entry.contestantId).sort();
    const heelers = result.registrations.filter((entry) => entry.role === "Heeler").map((entry) => entry.contestantId).sort();
    expect(headers).toHaveLength(2);
    expect(headers).not.toContain("h1");
    expect(headers).not.toContain("h3");
    expect(heelers).toHaveLength(2);
    expect(result.registrations.every((entry) => entry.entries === 1 && entry.paid && entry.status === "entered")).toBe(true);
    expect(result.teams).toEqual([]);
    expect(result.message).toContain("2 header entries across 2 riders");
  });

  it("spreads extra entries across riders when the count exceeds the rider pool", () => {
    const result = generateTestEntries({ ...baseEvent, entriesAllowed: 12 }, contestants, [], [], 10, makeId, fixedRandom);
    const headers = result.registrations.filter((entry) => entry.role === "Header");
    const heelers = result.registrations.filter((entry) => entry.role === "Heeler");
    expect(headers).toHaveLength(3);
    expect(headers.reduce((sum, entry) => sum + entry.entries, 0)).toBe(10);
    expect(headers.map((entry) => entry.entries).sort()).toEqual([3, 3, 4]);
    expect(heelers.reduce((sum, entry) => sum + entry.entries, 0)).toBe(10);
    expect(result.message).toContain("10 header entries across 3 riders");
  });

  it("explains when the per-rider entry cap stops it from reaching the count", () => {
    const result = generateTestEntries({ ...baseEvent, entriesAllowed: 2 }, contestants, [], [], 10, makeId, fixedRandom);
    const headers = result.registrations.filter((entry) => entry.role === "Header");
    expect(headers.every((entry) => entry.entries === 2)).toBe(true);
    expect(result.message).toContain("Only 6 header and 6 heeler entries fit");
  });

  it("builds picked teams within the handicap total for pick-only ropings", () => {
    const event: ArenaEvent = { ...baseEvent, competitionType: "pick-only", handicapTotal: 7 };
    const result = generateTestEntries(event, contestants, [], [], 3, makeId, fixedRandom);

    expect(result.registrations).toEqual([]);
    expect(result.teams).toHaveLength(3);
    expect(result.teams.map((team) => team.drawPosition)).toEqual([1, 2, 3]);
    result.teams.forEach((team) => {
      expect(team.headerId).not.toBe(team.heelerId);
      expect(team.generated).toBe(false);
      const header = contestants.find((item) => item.id === team.headerId)!;
      const heeler = contestants.find((item) => item.id === team.heelerId)!;
      expect(header.headerHandicap + heeler.heelerHandicap).toBeLessThanOrEqual(7);
    });
    const keys = result.teams.map((team) => `${team.headerId}|${team.heelerId}`);
    expect(new Set(keys).size).toBe(3);
  });

  it("clamps the requested count", () => {
    const result = generateTestEntries(baseEvent, contestants, [], [], 0, makeId, fixedRandom);
    expect(result.registrations.filter((entry) => entry.role === "Header")).toHaveLength(1);
  });
});
