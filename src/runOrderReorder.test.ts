import { describe, expect, it } from "vitest";
import { reorderRunOrderTeams } from "./competition";
import type { Team } from "./types";

const team = (overrides: Partial<Team> & Pick<Team, "id" | "drawPosition">): Team => ({
  eventId: "event-1",
  headerId: "header",
  heelerId: "heeler",
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

describe("reorderRunOrderTeams", () => {
  it("moves a team later in the run order", () => {
    const teams = [
      team({ id: "a", drawPosition: 1 }),
      team({ id: "b", drawPosition: 2 }),
      team({ id: "c", drawPosition: 3 }),
    ];
    expect(
      reorderRunOrderTeams(teams, "a", "c").map((item) => [
        item.id,
        item.drawPosition,
      ]),
    ).toEqual([
      ["a", 3],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("moves a team earlier in the run order", () => {
    const teams = [
      team({ id: "a", drawPosition: 1 }),
      team({ id: "b", drawPosition: 2 }),
      team({ id: "c", drawPosition: 3 }),
    ];
    expect(
      reorderRunOrderTeams(teams, "c", "a").map((item) => [
        item.id,
        item.drawPosition,
      ]),
    ).toEqual([
      ["a", 2],
      ["b", 3],
      ["c", 1],
    ]);
  });

  it("preserves non-contiguous draw positions within the round", () => {
    const teams = [
      team({ id: "a", drawPosition: 2 }),
      team({ id: "b", drawPosition: 5 }),
      team({ id: "c", drawPosition: 9 }),
    ];
    const reordered = reorderRunOrderTeams(teams, "c", "a");
    expect(
      reordered
        .slice()
        .sort((left, right) => left.drawPosition - right.drawPosition)
        .map((item) => item.id),
    ).toEqual(["c", "a", "b"]);
    expect(reordered.map((item) => item.drawPosition).sort((x, y) => x - y)).toEqual([
      2, 5, 9,
    ]);
  });

  it("only reorders teams in the same event and round", () => {
    const teams = [
      team({ id: "a", drawPosition: 1 }),
      team({ id: "other-round", drawPosition: 2, round: 2 }),
      team({ id: "other-event", drawPosition: 3, eventId: "event-2" }),
    ];
    expect(reorderRunOrderTeams(teams, "a", "other-round")).toBe(teams);
    expect(reorderRunOrderTeams(teams, "a", "other-event")).toBe(teams);
    expect(reorderRunOrderTeams(teams, "a", "missing")).toBe(teams);
    expect(reorderRunOrderTeams(teams, "a", "a")).toBe(teams);
  });

  it("leaves scratched teams untouched", () => {
    const teams = [
      team({ id: "a", drawPosition: 1 }),
      team({ id: "scratched", drawPosition: 2, scratched: true }),
      team({ id: "b", drawPosition: 3 }),
    ];
    const reordered = reorderRunOrderTeams(teams, "b", "a");
    expect(
      reordered.map((item) => [item.id, item.drawPosition]),
    ).toEqual([
      ["a", 3],
      ["scratched", 2],
      ["b", 1],
    ]);
    expect(reorderRunOrderTeams(teams, "scratched", "a")).toBe(teams);
  });
});
