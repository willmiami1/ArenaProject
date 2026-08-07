import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  ledQualifiedRunsThroughRound,
  ledShowsFinalResults,
  resolveLedRunDeskState,
} from "./ledDisplay";
import type { ArenaEvent, Team } from "./types";

const event: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "event",
  parentEventId: "meet",
  name: "Live Roping",
  date: "2026-08-07",
  startTime: "18:00",
  location: "Arena",
  status: "Live",
  entryFee: 50,
  rounds: 2,
  activeRound: 1,
  activeRunId: "round-one-next",
};

const team = (id: string, round: number, status: Team["status"]): Team => ({
  id,
  eventId: event.id,
  headerId: `header-${id}`,
  heelerId: `heeler-${id}`,
  drawPosition: 1,
  status,
  rawTime: status === "complete" ? 7 : null,
  penalties: 0,
  notes: "",
  round,
  checkedIn: true,
  scratched: false,
  generated: round > 1,
  points: status === "complete" ? 1 : 0,
});

describe("LED Run Desk synchronization", () => {
  it("stays on the persisted round after the popup team completes", () => {
    const result = resolveLedRunDeskState(
      event,
      [
        team("popup-team", 1, "complete"),
        team("round-one-next", 1, "ready"),
        team("qualified-round-two", 2, "ready"),
      ],
      1,
      "popup-team",
    );

    expect(result).toEqual({
      round: 1,
      activeTeamId: "round-one-next",
    });
  });

  it("moves only when Run Desk persists the next round", () => {
    const result = resolveLedRunDeskState(
      {
        ...event,
        activeRound: 2,
        activeRunId: "qualified-round-two",
      },
      [
        team("round-one-next", 1, "ready"),
        team("qualified-round-two", 2, "ready"),
      ],
      1,
      "round-one-next",
    );

    expect(result).toEqual({
      round: 2,
      activeTeamId: "qualified-round-two",
    });
  });

  it("keeps prior qualified runs until the next-round result is entered", () => {
    const firstRound = team("first-round", 1, "complete");
    const secondRound = {
      ...team("second-round", 2, "ready"),
      headerId: firstRound.headerId,
      heelerId: firstRound.heelerId,
    };

    expect(
      ledQualifiedRunsThroughRound(event.id, [firstRound, secondRound], 2),
    ).toEqual([firstRound]);
    expect(
      ledQualifiedRunsThroughRound(
        event.id,
        [firstRound, { ...secondRound, status: "no-time" }],
        2,
      ),
    ).toEqual([]);
  });

  it("shows final results only after every final-round run is resolved", () => {
    expect(
      ledShowsFinalResults(
        event,
        [team("final-complete", 2, "complete"), team("final-ready", 2, "ready")],
        2,
      ),
    ).toBe(false);
    expect(
      ledShowsFinalResults(
        event,
        [team("final-complete", 2, "complete"), team("final-no-time", 2, "no-time")],
        2,
      ),
    ).toBe(true);
  });
});
