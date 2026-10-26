import { describe, expect, it } from "vitest";
import {
  applyRunResult,
  assignRotations,
  clearRotations,
  defaultCompetitionSettings,
  drawPotTeamsByRotation,
  generateCompetitionDraw,
  rotationCount,
  runDeskStages,
  stageLabel,
  stageTeams,
} from "./competition";
import type { ArenaEvent, Contestant, EventRegistration, Team } from "./types";

const event: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "event-1",
  parentEventId: "meet-1",
  name: "Rotation Roping",
  date: "2026-08-04",
  startTime: "18:00",
  location: "Destiny Ranch Arena",
  status: "Live",
  entryFee: 100,
  rounds: 3,
  rotationSize: 20,
};

const team = (overrides: Partial<Team> = {}): Team => ({
  id: "team-1",
  eventId: event.id,
  headerId: "h1",
  heelerId: "l1",
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: false,
  scratched: false,
  generated: true,
  points: 0,
  ...overrides,
});

const drawOf = (count: number, headers: string[], heelers: string[]) =>
  Array.from({ length: count }, (_, index) =>
    team({
      id: `t${index + 1}`,
      drawPosition: index + 1,
      originalTeamNumber: index + 1,
      headerId: headers[index % headers.length],
      heelerId: heelers[index % heelers.length],
    }),
  );

describe("rotations", () => {
  it("splits round 1 into balanced rotations within the size limits", () => {
    const teams = drawOf(45, ["a", "b", "c", "d", "e"], ["v", "w", "x", "y", "z"]);
    const assigned = assignRotations(teams, event.id, 20);
    const counts = new Map<number, number>();
    assigned.forEach((entry) =>
      counts.set(entry.rotation!, (counts.get(entry.rotation!) ?? 0) + 1),
    );
    expect([...counts.keys()].sort()).toEqual([1, 2, 3]);
    expect([...counts.values()].every((size) => size <= 15)).toBe(true);
    expect(rotationCount(event, assigned)).toBe(3);
  });

  it("renumbers the draw so each rotation is a contiguous block in draw order", () => {
    const teams = drawOf(60, ["a", "b", "c", "d", "e", "f"], ["u", "v", "w", "x", "y", "z"]);
    const assigned = assignRotations(teams, event.id, 20);
    const byNumber = [...assigned].sort((a, b) => a.drawPosition - b.drawPosition);
    expect(byNumber.map((entry) => entry.drawPosition)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(byNumber.every((entry) => entry.originalTeamNumber === entry.drawPosition)).toBe(true);
    expect(byNumber.slice(0, 20).every((entry) => entry.rotation === 1)).toBe(true);
    expect(byNumber.slice(20, 40).every((entry) => entry.rotation === 2)).toBe(true);
    expect(byNumber.slice(40).every((entry) => entry.rotation === 3)).toBe(true);
    // Original draw order is preserved inside each rotation.
    for (let rotation = 1; rotation <= 3; rotation += 1) {
      const block = byNumber.filter((entry) => entry.rotation === rotation);
      const originalOrder = block.map((entry) => Number(entry.id.slice(1)));
      expect(originalOrder).toEqual([...originalOrder].sort((a, b) => a - b));
    }
  });

  it("keeps each rider's runs inside a single rotation when the draw allows it", () => {
    // 30 headers × 3 runs and 30 heelers × 3 runs, dealt round-robin so every
    // rider's runs are spread across the whole draw before rotations are applied.
    const headers = Array.from({ length: 30 }, (_, i) => `h${i}`);
    const heelers = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const teams = Array.from({ length: 90 }, (_, index) =>
      team({
        id: `t${index + 1}`,
        drawPosition: index + 1,
        headerId: headers[index % 30],
        heelerId: heelers[(index * 7) % 30],
      }),
    );
    const assigned = assignRotations(teams, event.id, 30);
    const rotationsFor = (rider: string, role: "headerId" | "heelerId") =>
      new Set(assigned.filter((entry) => entry[role] === rider).map((entry) => entry.rotation)).size;
    const split = [
      ...headers.map((rider) => rotationsFor(rider, "headerId")),
      ...heelers.map((rider) => rotationsFor(rider, "heelerId")),
    ].filter((rotations) => rotations > 1).length;
    expect(split).toBe(0);
  });

  it("keeps a rider's heading and heeling runs in different rotations when possible", () => {
    // "cy" heads twice and heels twice; the scorer should separate those jobs.
    const teams = [
      team({ id: "t1", drawPosition: 1, headerId: "cy", heelerId: "l1" }),
      team({ id: "t2", drawPosition: 2, headerId: "h2", heelerId: "cy" }),
      team({ id: "t3", drawPosition: 3, headerId: "cy", heelerId: "l3" }),
      team({ id: "t4", drawPosition: 4, headerId: "h4", heelerId: "cy" }),
      ...drawOf(36, ["p", "q", "r"], ["s", "t", "u"]).map((entry, index) => ({
        ...entry,
        id: `f${index}`,
        drawPosition: index + 5,
      })),
    ];
    const assigned = assignRotations(teams, event.id, 20);
    const rotationOf = (id: string) => assigned.find((entry) => entry.id === id)!.rotation;
    expect(rotationOf("t1")).toBe(rotationOf("t3"));
    expect(rotationOf("t2")).toBe(rotationOf("t4"));
    expect(rotationOf("t1")).not.toBe(rotationOf("t2"));
  });

  it("builds run desk stages per rotation, then one short round", () => {
    const teams = assignRotations(drawOf(40, ["a", "b"], ["x", "y"]), event.id, 20);
    const stages = runDeskStages(event, teams);
    expect(stages).toEqual([
      { round: 1, rotation: 1 },
      { round: 2, rotation: 1 },
      { round: 1, rotation: 2 },
      { round: 2, rotation: 2 },
      { round: 3 },
    ]);
    expect(stageLabel(stages[1])).toBe("Round 2 · Rotation 1");
    expect(stageLabel(stages[4])).toBe("Round 3");
    expect(stageTeams(teams, stages[0])).toHaveLength(20);
  });

  it("falls back to plain rounds without rotations", () => {
    const teams = drawOf(10, ["a"], ["x"]);
    expect(runDeskStages({ ...event, rotationSize: 0 }, teams)).toEqual([
      { round: 1 },
      { round: 2 },
      { round: 3 },
    ]);
    expect(clearRotations(assignRotations(teams, event.id, 20), event.id).every(
      (entry) => entry.rotation === undefined,
    )).toBe(true);
  });

  it("carries the rotation into the next preliminary round", () => {
    const teams = assignRotations(drawOf(40, ["a", "b"], ["x", "y"]), event.id, 20);
    const first = teams[0];
    const next = applyRunResult(
      teams,
      first.id,
      { status: "complete", rawTime: 8.5 },
      event.rounds,
      0,
      event,
    );
    const advanced = next.find((entry) => entry.round === 2);
    expect(advanced?.rotation).toBe(first.rotation);
  });
});

describe("draw pot drawn by rotation", () => {
  const rider = (id: string, role: Contestant["role"], hc = 3): Contestant => ({
    id,
    name: id,
    role,
    headerHandicap: hc,
    heelerHandicap: hc,
    photo: "",
    phone: "",
    hometown: "",
  });
  const registration = (
    contestantId: string,
    role: "Header" | "Heeler",
    entries: number,
  ): EventRegistration => ({
    id: `${contestantId}-${role}`,
    eventId: event.id,
    contestantId,
    role,
    entries,
    checkedIn: false,
    status: "entered",
    notes: "",
    paid: true,
  });
  const drawEvent: ArenaEvent = {
    ...event,
    competitionType: "draw-pot",
    handicapTotal: 20,
    maxContestantHandicap: 10,
    allowRepeatPartners: false,
  };

  it("numbers rotations contiguously and keeps every rider inside one rotation when they fit", () => {
    // 15 headers × 4 runs and 15 heelers × 4 runs = 60 teams → 3 rotations of 20.
    const headers = Array.from({ length: 15 }, (_, i) => `h${i}`);
    const heelers = Array.from({ length: 15 }, (_, i) => `l${i}`);
    const contestants = [
      ...headers.map((id) => rider(id, "Header")),
      ...heelers.map((id) => rider(id, "Heeler")),
    ];
    const registrations = [
      ...headers.map((id) => registration(id, "Header", 4)),
      ...heelers.map((id) => registration(id, "Heeler", 4)),
    ];
    const draw = drawPotTeamsByRotation(drawEvent, registrations, contestants, 20);
    expect(draw).not.toBeNull();
    expect(draw!).toHaveLength(60);
    expect(draw!.map((team) => team.drawPosition)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(draw!.slice(0, 20).every((team) => team.rotation === 1)).toBe(true);
    expect(draw!.slice(20, 40).every((team) => team.rotation === 2)).toBe(true);
    expect(draw!.slice(40).every((team) => team.rotation === 3)).toBe(true);
    const rotationsOf = (id: string, key: "headerId" | "heelerId") =>
      new Set(draw!.filter((team) => team[key] === id).map((team) => team.rotation)).size;
    expect(headers.every((id) => rotationsOf(id, "headerId") === 1)).toBe(true);
    expect(heelers.every((id) => rotationsOf(id, "heelerId") === 1)).toBe(true);
    // No repeated partnerships.
    const keys = draw!.map((team) => `${team.headerId}|${team.heelerId}`);
    expect(new Set(keys).size).toBe(60);
  });

  it("puts a rider's heading and heeling in different rotations", () => {
    const both = Array.from({ length: 6 }, (_, i) => `b${i}`);
    const headers = Array.from({ length: 14 }, (_, i) => `h${i}`);
    const heelers = Array.from({ length: 14 }, (_, i) => `l${i}`);
    const contestants = [
      ...both.map((id) => rider(id, "Both")),
      ...headers.map((id) => rider(id, "Header")),
      ...heelers.map((id) => rider(id, "Heeler")),
    ];
    const registrations = [
      ...both.map((id) => registration(id, "Header", 3)),
      ...both.map((id) => registration(id, "Heeler", 3)),
      ...headers.map((id) => registration(id, "Header", 3)),
      ...heelers.map((id) => registration(id, "Heeler", 3)),
    ];
    const draw = drawPotTeamsByRotation(drawEvent, registrations, contestants, 20);
    expect(draw).not.toBeNull();
    expect(draw!).toHaveLength(60);
    both.forEach((id) => {
      const heads = new Set(draw!.filter((team) => team.headerId === id).map((team) => team.rotation));
      const heels = new Set(draw!.filter((team) => team.heelerId === id).map((team) => team.rotation));
      expect([...heads].some((rotation) => heels.has(rotation))).toBe(false);
    });
  });

  it("balances free runs when one side is short", () => {
    const headers = Array.from({ length: 10 }, (_, i) => `h${i}`);
    const heelers = Array.from({ length: 8 }, (_, i) => `l${i}`);
    const contestants = [
      ...headers.map((id) => rider(id, "Header")),
      ...heelers.map((id) => rider(id, "Heeler")),
    ];
    const registrations = [
      ...headers.map((id) => registration(id, "Header", 4)),
      ...heelers.map((id) => registration(id, "Heeler", 4)),
    ];
    const draw = drawPotTeamsByRotation(drawEvent, registrations, contestants, 20);
    expect(draw!).toHaveLength(40);
    expect(draw!.filter((team) => team.heelerFreeRun)).toHaveLength(8);
    expect(draw!.some((team) => team.headerFreeRun)).toBe(false);
  });

  it("falls back to a normal draw split afterwards when rotations cannot be paired", () => {
    // Two headers and two heelers with 10 runs each cannot make 20 unique pairs.
    const contestants = [rider("h1", "Header"), rider("h2", "Header"), rider("l1", "Heeler"), rider("l2", "Heeler")];
    const registrations = [
      registration("h1", "Header", 10),
      registration("h2", "Header", 10),
      registration("l1", "Heeler", 10),
      registration("l2", "Heeler", 10),
    ];
    expect(drawPotTeamsByRotation(drawEvent, registrations, contestants, 20)).toBeNull();
    const repeatEvent = { ...drawEvent, allowRepeatPartners: true };
    const draw = generateCompetitionDraw(repeatEvent, registrations, [], contestants, { rotationSize: 20 });
    expect(draw).toHaveLength(20);
    expect(draw.every((team) => team.rotation === 1)).toBe(true);
  });
});
