import { describe, expect, it } from "vitest";
import {
  applyRunResult,
  assignRotations,
  clearRotations,
  defaultCompetitionSettings,
  rotationCount,
  runDeskStages,
  stageLabel,
  stageTeams,
} from "./competition";
import type { ArenaEvent, Team } from "./types";

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
