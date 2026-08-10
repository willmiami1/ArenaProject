import { describe, expect, it } from "vitest";
import {
  applyActiveRunSelection,
  LatestActiveRunSaveQueue,
} from "./activeRunSaveQueue";
import { defaultCompetitionSettings } from "./competition";
import type { ArenaData } from "./types";

const workspace = (): ArenaData => ({
  participantDatabaseVersion: 2,
  revision: 1,
  meets: [],
  events: [
    {
      ...defaultCompetitionSettings,
      id: "event",
      parentEventId: "meet",
      name: "Roping",
      date: "2026-08-10",
      startTime: "18:00",
      location: "Arena",
      status: "Live",
      entryFee: 0,
      activeRunId: "draw-1",
      activeRound: 1,
    },
  ],
  contestants: [],
  teams: [],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: "event",
});

describe("immediate active-run save queue", () => {
  it("adds the explicit selection to the full workspace snapshot", () => {
    const updated = applyActiveRunSelection(workspace(), {
      eventId: "event",
      activeRunId: "draw-4",
      activeRound: 1,
    });

    expect(updated.events[0]).toMatchObject({
      activeRunId: "draw-4",
      activeRound: 1,
    });
  });

  it("serializes behind an in-flight save and persists the latest selection", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const saved: string[] = [];
    const queue = new LatestActiveRunSaveQueue(async (selection) => {
      saved.push(selection.activeRunId ?? "");
      if (saved.length === 1) await firstPending;
      return selection.activeRunId;
    });

    const first = queue.enqueue({
      eventId: "event",
      activeRunId: "draw-1",
      activeRound: 1,
    });
    const latest = queue.enqueue({
      eventId: "event",
      activeRunId: "draw-3",
      activeRound: 1,
    });
    queue.enqueue({
      eventId: "event",
      activeRunId: "draw-4",
      activeRound: 1,
    });
    releaseFirst();

    await expect(first).resolves.toBe("draw-4");
    await expect(latest).resolves.toBe("draw-4");
    expect(saved).toEqual(["draw-1", "draw-4"]);
  });

  it("surfaces a save rejection", async () => {
    const queue = new LatestActiveRunSaveQueue(async () => {
      throw new Error("Wix did not confirm the workspace save.");
    });

    await expect(
      queue.enqueue({
        eventId: "event",
        activeRunId: "draw-4",
        activeRound: 1,
      }),
    ).rejects.toThrow("Wix did not confirm");
  });

  it("lets the latest click reselect the run that is currently saving", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const saved: string[] = [];
    const queue = new LatestActiveRunSaveQueue(async (selection) => {
      saved.push(selection.activeRunId ?? "");
      if (saved.length === 1) await firstPending;
      return selection.activeRunId;
    });

    const result = queue.enqueue({
      eventId: "event",
      activeRunId: "draw-1",
      activeRound: 1,
    });
    queue.enqueue({
      eventId: "event",
      activeRunId: "draw-4",
      activeRound: 1,
    });
    queue.enqueue({
      eventId: "event",
      activeRunId: "draw-1",
      activeRound: 1,
    });
    releaseFirst();

    await expect(result).resolves.toBe("draw-1");
    expect(saved).toEqual(["draw-1", "draw-1"]);
  });
});
