import { describe, expect, it } from "vitest";
import {
  activeRunConfirmationIsCurrent,
  LatestActiveRunSaveQueue,
  reconcileActiveRunConfirmation,
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
  it("reconciles only the confirmed event and revision metadata", () => {
    const original = workspace();
    const updated = reconcileActiveRunConfirmation(original, {
      eventId: "event",
      activeRunId: "draw-4",
      activeRound: 1,
      revision: 7,
      staffRevision: 6,
      onlineRevision: 1,
      loadedAt: "2026-08-10T18:50:00.000Z",
    });

    expect(updated.events[0]).toMatchObject({
      activeRunId: "draw-4",
      activeRound: 1,
    });
    expect(updated).toMatchObject({
      revision: 7,
      staffRevision: 6,
      onlineRevision: 1,
      loadedAt: "2026-08-10T18:50:00.000Z",
      teams: original.teams,
      registrations: original.registrations,
    });
  });

  it("rejects a confirmation older than the current workspace revision", () => {
    expect(
      activeRunConfirmationIsCurrent({ revision: 8 }, { revision: 7 }),
    ).toBe(false);
    expect(
      activeRunConfirmationIsCurrent({ revision: 8 }, { revision: 8 }),
    ).toBe(true);
  });

  it("reports each successful confirmation before a later request fails", async () => {
    const confirmed: string[] = [];
    const queue = new LatestActiveRunSaveQueue(
      async (selection) => {
        if (selection.activeRunId === "draw-4") throw new Error("rejected");
        return selection.activeRunId ?? "";
      },
      (saved) => confirmed.push(saved),
    );

    const first = queue.enqueue({ eventId: "event", activeRunId: "draw-3" });
    queue.enqueue({ eventId: "event", activeRunId: "draw-4" });

    await expect(first).rejects.toThrow("rejected");
    expect(confirmed).toEqual(["draw-3"]);
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

  it("starts a third save queued as the prior run settles", async () => {
    let releaseFirst!: (value: string) => void;
    let releaseSecond!: (value: string) => void;
    let signalSecondStarted!: () => void;
    const firstPending = new Promise<string>((resolve) => {
      releaseFirst = resolve;
    });
    const secondPending = new Promise<string>((resolve) => {
      releaseSecond = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      signalSecondStarted = resolve;
    });
    const saved: string[] = [];
    const queue = new LatestActiveRunSaveQueue<string>((selection) => {
      const id = selection.activeRunId ?? "";
      saved.push(id);
      if (id === "draw-1") return firstPending;
      if (id === "draw-2") {
        signalSecondStarted();
        return secondPending;
      }
      return Promise.resolve(id);
    });

    const running = queue.enqueue({
      eventId: "event",
      activeRunId: "draw-1",
    });
    queue.enqueue({ eventId: "event", activeRunId: "draw-2" });
    releaseFirst("draw-1");
    await secondStarted;

    let third!: Promise<string>;
    secondPending.then(() => {
      third = queue.enqueue({ eventId: "event", activeRunId: "draw-3" });
    });
    releaseSecond("draw-2");

    await expect(running).resolves.toBe("draw-2");
    await expect(third).resolves.toBe("draw-3");
    expect(saved).toEqual(["draw-1", "draw-2", "draw-3"]);
  });

  it("accepts a fresh selection after an in-flight save rejects", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstPending = new Promise<string>((_, reject) => {
      rejectFirst = reject;
    });
    const saved: string[] = [];
    const queue = new LatestActiveRunSaveQueue<string>((selection) => {
      const id = selection.activeRunId ?? "";
      saved.push(id);
      return id === "draw-1" ? firstPending : Promise.resolve(id);
    });

    const first = queue.enqueue({ eventId: "event", activeRunId: "draw-1" });
    queue.enqueue({ eventId: "event", activeRunId: "draw-2" });
    rejectFirst(new Error("rejected"));

    await expect(first).rejects.toThrow("rejected");
    await expect(
      queue.enqueue({ eventId: "event", activeRunId: "draw-3" }),
    ).resolves.toBe("draw-3");
    expect(saved).toEqual(["draw-1", "draw-3"]);
  });
});
