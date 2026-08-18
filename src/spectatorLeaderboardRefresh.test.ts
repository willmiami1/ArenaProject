import { describe, expect, it } from "vitest";
import {
  refreshedSpectatorLeaderboardState,
  type PublicArenaData,
  type PublicSpectatorLeaderboardRow,
} from "./publicData";

const fallbackRows: PublicSpectatorLeaderboardRow[] = [
  { name: "WILL", round: 1, picks: 2, correct: 2 },
  { name: "XXXX", round: 1, picks: 1, correct: 1 },
];

const competition = (
  spectatorLeaderboards: PublicSpectatorLeaderboardRow[],
  predictionRuns: Array<{ id: string; open: boolean }> = [],
) =>
  ({
    id: "event-1",
    spectatorLeaderboards,
    predictionRuns,
  }) as unknown as PublicArenaData["competitions"][number];

const publicData = (
  competitions: PublicArenaData["competitions"],
): Pick<PublicArenaData, "competitions"> => ({ competitions });

describe("refreshedSpectatorLeaderboardState", () => {
  it("keeps fallback rows when public data is unavailable", () => {
    const state = refreshedSpectatorLeaderboardState(
      null,
      "event-1",
      1,
      fallbackRows,
    );
    expect(state.rows).toEqual(fallbackRows);
    expect(state.picksClosed).toBe(false);
  });

  it("keeps fallback rows when the competition is missing from the payload", () => {
    const other = {
      ...competition([]),
      id: "other",
    } as PublicArenaData["competitions"][number];
    const state = refreshedSpectatorLeaderboardState(
      publicData([other]),
      "event-1",
      1,
      fallbackRows,
    );
    expect(state.rows).toEqual(fallbackRows);
  });

  it("clears rows when the competition exists with an empty scoreboard", () => {
    const state = refreshedSpectatorLeaderboardState(
      publicData([competition([])]),
      "event-1",
      1,
      fallbackRows,
    );
    expect(state.rows).toEqual([]);
  });

  it("aggregates rows through the requested round and reports closed picks", () => {
    const state = refreshedSpectatorLeaderboardState(
      publicData([
        competition(
          [
            { name: "WILL", round: 1, picks: 2, correct: 2 },
            { name: "WILL", round: 2, picks: 1, correct: 0 },
            { name: "XXXX", round: 3, picks: 4, correct: 4 },
          ],
          [{ id: "team-1", open: false }],
        ),
      ]),
      "event-1",
      2,
      fallbackRows,
      "team-1",
    );
    expect(state.rows).toEqual([
      { name: "WILL", round: 0, picks: 3, correct: 2 },
    ]);
    expect(state.picksClosed).toBe(true);
  });
});
