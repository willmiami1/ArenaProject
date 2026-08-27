import { describe, expect, it } from "vitest";
import {
  defaultCompetitionSettings,
  generateCompetitionDraw,
} from "./competition";
import type {
  ArenaEvent,
  Contestant,
  EventRegistration,
} from "./types";

const event = (overrides: Partial<ArenaEvent> = {}): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "competition-1",
  parentEventId: "meet-1",
  name: "Roping",
  date: "2026-08-05",
  startTime: "18:00",
  location: "Destiny Arena",
  status: "Upcoming",
  entryFee: 50,
  allowRepeatPartners: true,
  ...overrides,
});

const contestant = (
  id: string,
  role: Contestant["role"],
): Contestant => ({
  id,
  name: id.toUpperCase(),
  role,
  headerHandicap: 3,
  heelerHandicap: 3,
  photo: "",
  phone: "",
  email: "",
  hometown: "",
  horses: [],
});

const registration = (
  contestantId: string,
  role: EventRegistration["role"],
  entries: number,
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

const buildRoster = (headerCount: number, heelerCount: number) => {
  const headers = Array.from({ length: headerCount }, (_, index) =>
    contestant(`header-${index + 1}`, "Header"),
  );
  const heelers = Array.from({ length: heelerCount }, (_, index) =>
    contestant(`heeler-${index + 1}`, "Heeler"),
  );
  return { headers, heelers, contestants: [...headers, ...heelers] };
};

const freeRunCounts = (
  teams: { heelerId: string; heelerFreeRun?: boolean }[],
) =>
  teams.reduce((counts, team) => {
    if (team.heelerFreeRun) {
      counts.set(team.heelerId, (counts.get(team.heelerId) ?? 0) + 1);
    }
    return counts;
  }, new Map<string, number>());

describe("free run distribution", () => {
  it("gives each short-side rider exactly one free run when extras divide evenly", () => {
    // 30 head entries (6 headers x 5) vs 25 heel entries (5 heelers x 5):
    // 5 free runs must land one per heeler.
    const { headers, heelers, contestants } = buildRoster(6, 5);
    const registrations = [
      ...headers.map((rider) => registration(rider.id, "Header", 5)),
      ...heelers.map((rider) => registration(rider.id, "Heeler", 5)),
    ];

    for (let trial = 0; trial < 10; trial += 1) {
      const draw = generateCompetitionDraw(
        event({ competitionType: "draw-pot" }),
        registrations,
        [],
        contestants,
      );

      expect(draw).toHaveLength(30);
      expect(draw.every((team) => !team.headerFreeRun)).toBe(true);
      const counts = freeRunCounts(draw);
      expect([...counts.values()]).toEqual([1, 1, 1, 1, 1]);
      expect(counts.size).toBe(5);
    }
  });

  it("never gives a rider a second free run before every rider has one", () => {
    // 32 head entries vs 25 heel entries: 7 free runs across 5 heelers
    // must split 2/2/1/1/1.
    const { headers, heelers, contestants } = buildRoster(8, 5);
    const registrations = [
      ...headers.map((rider) => registration(rider.id, "Header", 4)),
      ...heelers.map((rider) => registration(rider.id, "Heeler", 5)),
    ];

    for (let trial = 0; trial < 10; trial += 1) {
      const draw = generateCompetitionDraw(
        event({ competitionType: "draw-pot" }),
        registrations,
        [],
        contestants,
      );

      expect(draw).toHaveLength(32);
      const counts = freeRunCounts(draw);
      expect(counts.size).toBe(5);
      expect([...counts.values()].sort()).toEqual([1, 1, 1, 2, 2]);
    }
  });

  it("spreads free runs across riders in pick-and-draw competitions", () => {
    const { headers, heelers, contestants } = buildRoster(6, 5);
    const registrations = [
      ...headers.map((rider) => registration(rider.id, "Header", 5)),
      ...heelers.map((rider) => registration(rider.id, "Heeler", 5)),
    ];

    for (let trial = 0; trial < 10; trial += 1) {
      const draw = generateCompetitionDraw(
        event({ competitionType: "pick-and-draw" }),
        registrations,
        [],
        contestants,
      );

      expect(draw).toHaveLength(30);
      expect(draw.every((team) => !team.headerFreeRun)).toBe(true);
      const counts = freeRunCounts(draw);
      expect(counts.size).toBe(5);
      expect([...counts.values()]).toEqual([1, 1, 1, 1, 1]);
    }
  });
});
