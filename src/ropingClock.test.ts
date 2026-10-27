import { describe, expect, it } from "vitest";
import { advanceRopingClock, formatRopingClock, defaultCompetitionSettings } from "./competition";
import type { ArenaEvent, Team } from "./types";

const event = { ...defaultCompetitionSettings, id: "e", drawHistory: [] } as unknown as ArenaEvent;
const team = (id: string, status: Team["status"]): Team =>
  ({ id, eventId: "e", headerId: "h", heelerId: "l", drawPosition: 1, status, rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: true, scratched: false, generated: true, points: 0 }) as Team;

describe("roping clock", () => {
  it("starts on the first result and stops when nothing is left to rope", () => {
    const idle = advanceRopingClock(event, [team("a", "ready"), team("b", "ready")], "T0");
    expect(idle).toBe(event);
    const started = advanceRopingClock(event, [team("a", "complete"), team("b", "ready")], "T1");
    expect(started.ropingClockStartedAt).toBe("T1");
    expect(started.ropingClockStoppedAt).toBeUndefined();
    const still = advanceRopingClock(started, [team("a", "complete"), team("b", "ready")], "T2");
    expect(still).toBe(started);
    const done = advanceRopingClock(started, [team("a", "complete"), team("b", "no-time")], "T3");
    expect(done).toMatchObject({ ropingClockStartedAt: "T1", ropingClockStoppedAt: "T3" });
    const resumed = advanceRopingClock(done, [team("a", "complete"), team("b", "no-time"), team("c", "ready")], "T4");
    expect(resumed).toMatchObject({ ropingClockStartedAt: "T1", ropingClockStoppedAt: undefined });
    const cleared = advanceRopingClock(done, [team("a", "ready"), team("b", "ready")], "T5");
    expect(cleared.ropingClockStartedAt).toBeUndefined();
  });
  it("formats elapsed time", () => {
    expect(formatRopingClock("2026-01-01T10:00:00Z", "2026-01-01T13:05:09Z")).toBe("3:05:09");
  });
});
