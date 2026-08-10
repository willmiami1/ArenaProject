import { describe, expect, it } from "vitest";
import {
  normalizedRunDeskRound,
  runDeskSelectionToPersist,
} from "./runDeskActiveSelection";
import type { Team } from "./types";

const team = (id: string, overrides: Partial<Team> = {}): Team => ({
  id,
  eventId: "event",
  headerId: "header",
  heelerId: "heeler",
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: true,
  scratched: false,
  generated: false,
  points: 0,
  paid: true,
  ...overrides,
});

describe("Run Desk active selection persistence", () => {
  it("normalizes missing, fractional, and out-of-range rounds", () => {
    expect(normalizedRunDeskRound(undefined, 3)).toBe(1);
    expect(normalizedRunDeskRound(1.5, 3)).toBe(1);
    expect(normalizedRunDeskRound(5, 3)).toBe(3);
    expect(normalizedRunDeskRound(2, 3)).toBe(2);
  });

  it("persists the displayed next ready team when no active ID exists", () => {
    expect(
      runDeskSelectionToPersist(
        { activeRunId: undefined, activeRound: undefined },
        [
          team("rolled", { rolled: true, drawPosition: 1 }),
          team("next", { drawPosition: 2 }),
        ],
        1,
      ),
    ).toEqual({ activeRunId: "next", activeRound: 1 });
  });

  it("repairs a stale ID with the displayed fallback team", () => {
    expect(
      runDeskSelectionToPersist(
        { activeRunId: "removed", activeRound: 1 },
        [team("next")],
        1,
      ),
    ).toEqual({ activeRunId: "next", activeRound: 1 });
  });

  it("preserves an explicit existing selection and avoids duplicate saves", () => {
    expect(
      runDeskSelectionToPersist(
        { activeRunId: "selected", activeRound: 1 },
        [team("first"), team("selected", { status: "complete" })],
        1,
      ),
    ).toBeNull();
  });

  it("repairs an invalid stored round using the normalized event round", () => {
    expect(
      runDeskSelectionToPersist(
        { activeRunId: "removed", activeRound: 3 },
        [team("round-two", { round: 2 })],
        2,
      ),
    ).toEqual({ activeRunId: "round-two", activeRound: 2 });
  });

  it("clears a stale ID when the round has no ready fallback", () => {
    expect(
      runDeskSelectionToPersist(
        { activeRunId: "removed", activeRound: 1 },
        [team("complete", { status: "complete" })],
        1,
      ),
    ).toEqual({ activeRunId: undefined, activeRound: 1 });
  });
});
