import { describe, expect, it } from "vitest";
import type { PublicCompetition, PublicPredictionRun } from "./publicData";
import {
  effectiveActivePredictionRun,
  PublicPollGuard,
  publicRefreshInterval,
  submissionMatchesCurrentRun,
} from "./publicSpectatorSync";

const run = (id: string, round = 1): PublicPredictionRun => ({
  id,
  round,
  drawPosition: 1,
  headerName: `${id} Header`,
  heelerName: `${id} Heeler`,
  steerNumber: id,
  open: true,
});

const competition = (
  activePredictionRunId: string | undefined,
  predictionRuns: PublicPredictionRun[],
): PublicCompetition =>
  ({
    id: "event",
    activePredictionRunId,
    predictionRuns,
  }) as PublicCompetition;

describe("public spectator active-run synchronization", () => {
  it("switches strictly when the authoritative active ID changes", () => {
    expect(
      effectiveActivePredictionRun(competition("run-1", [run("run-1"), run("run-2")]))
        ?.id,
    ).toBe("run-1");
    expect(
      effectiveActivePredictionRun(competition("run-2", [run("run-1"), run("run-2")]))
        ?.id,
    ).toBe("run-2");
  });

  it("shows no run when the active ID disappears or is removed", () => {
    expect(effectiveActivePredictionRun(competition(undefined, [run("run-1")]))).toBeUndefined();
    expect(effectiveActivePredictionRun(competition("removed", [run("run-1")]))).toBeUndefined();
  });

  it("uses only a matching run across event round changes", () => {
    expect(
      effectiveActivePredictionRun(competition("round-2", [run("round-2", 2)]))
        ?.round,
    ).toBe(2);
    expect(
      effectiveActivePredictionRun(competition("round-1", [run("round-2", 2)])),
    ).toBeUndefined();
  });

  it("prevents overlap and rejects stale responses", () => {
    const guard = new PublicPollGuard();
    const first = guard.begin();
    expect(first).toBe(1);
    expect(guard.begin()).toBeNull();
    guard.cancel();
    const second = guard.begin();
    expect(second).toBe(3);
    expect(guard.complete(first!)).toBe(false);
    expect(guard.complete(second!)).toBe(true);
  });

  it("rejects submission snapshots after the active run changes", () => {
    expect(submissionMatchesCurrentRun("run-1", "run-1", "run-1")).toBe(true);
    expect(submissionMatchesCurrentRun("run-1", "run-2", "run-1")).toBe(false);
    expect(submissionMatchesCurrentRun("run-1", "run-1", "run-2")).toBe(false);
    expect(submissionMatchesCurrentRun("run-1", "run-1", undefined)).toBe(false);
  });

  it("polls public listings without changing the spectator cadence", () => {
    expect(publicRefreshInterval("spectator")).toBe(1500);
    expect(publicRefreshInterval("home")).toBe(15000);
    expect(publicRefreshInterval("events")).toBe(15000);
    expect(publicRefreshInterval("event")).toBe(15000);
    expect(publicRefreshInterval("competition")).toBe(15000);
    expect(publicRefreshInterval("signup")).toBeUndefined();
  });
});
