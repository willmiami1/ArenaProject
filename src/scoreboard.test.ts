import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import { parsePublicRoute } from "./publicData";
import { publicScoreboardProjection } from "./scoreboard";
import type { ArenaEvent, Contestant, Team } from "./types";

const event = (overrides: Partial<ArenaEvent> = {}): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "e1",
  parentEventId: "m1",
  name: "Roping",
  date: "2026-08-05",
  startTime: "18:00",
  location: "Destiny Arena",
  status: "Live",
  entryFee: 50,
  rounds: 3,
  drawApproved: true,
  ...overrides,
});
const contestants: Contestant[] = [
  { id: "a", name: "ADA", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "", phone: "", email: "", hometown: "", horses: [] },
  { id: "b", name: "BO", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "", email: "", hometown: "", horses: [] },
  { id: "c", name: "CY", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "", phone: "", email: "", hometown: "", horses: [] },
  { id: "d", name: "DEE", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "", email: "", hometown: "", horses: [] },
];
const run = (overrides: Partial<Team>): Team => ({
  id: "t",
  eventId: "e1",
  headerId: "a",
  heelerId: "b",
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: true,
  scratched: false,
  generated: true,
  points: 0,
  ...overrides,
});

describe("public scoreboard", () => {
  it("routes ?page=scoreboard to the scoreboard page", () => {
    expect(parsePublicRoute("?page=scoreboard&id=e1")).toEqual({ kind: "scoreboard", id: "e1" });
  });

  it("is hidden until the draw is approved", () => {
    expect(publicScoreboardProjection(event({ drawApproved: false }), [run({})], contestants)).toBeUndefined();
  });

  it("shows the active team, the next two, and the Run Desk classification", () => {
    const teams = [
      run({ id: "r1-ab", round: 1, drawPosition: 1, status: "complete", rawTime: 8, penalties: 0 }),
      run({ id: "r1-cd", round: 1, drawPosition: 2, headerId: "c", heelerId: "d", status: "complete", rawTime: 7, penalties: 5 }),
      run({ id: "r1-ad", round: 1, drawPosition: 3, headerId: "a", heelerId: "d", status: "no-time" }),
      run({ id: "r2-ab", round: 2, drawPosition: 2, originalTeamNumber: 1, status: "complete", rawTime: 9, penalties: 0 }),
      run({ id: "r2-cd", round: 2, drawPosition: 1, originalTeamNumber: 2, headerId: "c", heelerId: "d" }),
      run({ id: "r2-ad", round: 2, drawPosition: 3, originalTeamNumber: 3, headerId: "a", heelerId: "d" }),
      run({ id: "r2-cb", round: 2, drawPosition: 4, originalTeamNumber: 4, headerId: "c", heelerId: "b" }),
    ];
    const board = publicScoreboardProjection(
      event({ activeRound: 2, activeRunId: "r2-cd" }),
      teams,
      contestants,
    );
    expect(board).toMatchObject({ round: 2, roundCount: 3, roundComplete: false, finalResults: false });
    expect(board?.current).toMatchObject({ id: "r2-cd", teamNumber: 2, drawPosition: 1, headerName: "CY", heelerName: "DEE" });
    expect(board?.upNext.map((team) => team.id)).toEqual(["r2-ad", "r2-cb"]);
    expect(board?.standings.map((row) => [row.place, row.headerName, row.heelerName, row.rounds, row.total, row.teamNumber, row.drawPosition, row.advances])).toEqual([
      [1, "ADA", "BO", 2, 17, 1, 2, true],
      [2, "CY", "DEE", 1, 12, 2, 2, false],
    ]);
  });

  it("falls back to the highest round with teams still to rope", () => {
    const teams = [
      run({ id: "r1-ab", round: 1, status: "complete", rawTime: 8 }),
      run({ id: "r2-ab", round: 2, drawPosition: 1, rolled: true }),
      run({ id: "r2-cd", round: 2, drawPosition: 2, headerId: "c", heelerId: "d" }),
    ];
    const board = publicScoreboardProjection(event(), teams, contestants);
    expect(board?.round).toBe(2);
    expect(board?.current?.id).toBe("r2-cd");
    expect(board?.upNext.map((team) => team.id)).toEqual(["r2-ab"]);
  });

  it("lists every recorded run in the stage with misses and penalty calls", () => {
    const teams = [
      run({ id: "r1-ab", drawPosition: 1, status: "complete", rawTime: 8, penalties: 5, barrierPenalty: true }),
      run({ id: "r1-cd", drawPosition: 2, headerId: "c", heelerId: "d", status: "no-time", noTimeReason: "heeler", legPenalty: true }),
      run({ id: "r1-ad", drawPosition: 3, headerId: "a", heelerId: "d" }),
    ];
    const board = publicScoreboardProjection(event({ rounds: 1 }), teams, contestants);
    expect(board?.standings[0]).toMatchObject({ total: 13, calls: "Barrier" });
    expect(board?.runs).toEqual([
      { teamNumber: 2, drawPosition: 2, round: 1, headerName: "CY", heelerName: "DEE", time: null, result: "Heeler miss", calls: "One leg" },
      { teamNumber: 1, drawPosition: 1, round: 1, headerName: "ADA", heelerName: "BO", time: 13, result: "", calls: "Barrier" },
    ]);
  });
});
