import { describe, expect, it, vi } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  applyEventLocally,
  EventSaveFailureTracker,
  EventSaveQueue,
  eventSaveHasPendingChanges,
  eventSubmissionIsNoOp,
  eventSubmissionNeedsSave,
  preserveEventActiveSelection,
  reconcileEventSaveConfirmation,
} from "./eventSaveQueue";
import type { ArenaData, ArenaEvent } from "./types";
import { eventSaveRequest } from "./wixBridge";

const event = (overrides: Partial<ArenaEvent> = {}): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "event",
  parentEventId: "meet",
  name: "ROPING",
  description: "",
  date: "2026-08-10",
  startTime: "18:00",
  location: "Arena",
  status: "Live",
  entryFee: 50,
  activeRunId: "run-2",
  activeRound: 2,
  ...overrides,
});

const workspace = (competition = event()): ArenaData => ({
  participantDatabaseVersion: 4,
  revision: 10,
  staffRevision: 7,
  onlineRevision: 3,
  loadedAt: "2026-08-10T22:00:00.000Z",
  meets: [],
  events: [competition],
  contestants: [],
  teams: [],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: competition.id,
});

describe("direct Event saves", () => {
  it("detects a semantically unchanged Event without a request", async () => {
    const save = vi.fn();
    const current = event();

    if (eventSubmissionNeedsSave(current, { ...current })) {
      await save(current);
    }

    expect(save).not.toHaveBeenCalled();
  });

  it("retries an unchanged local Event that is not in persisted state", () => {
    expect(
      eventSubmissionNeedsSave(event({ name: "PERSISTED" }), event({ name: "LOCAL" })),
    ).toBe(true);
  });

  it("queues a rapid revert when the current optimistic Event still differs", () => {
    const persisted = event({ name: "ORIGINAL" });
    const optimistic = event({ name: "FIRST EDIT" });
    const reverted = event({ name: "ORIGINAL" });

    expect(eventSubmissionIsNoOp(persisted, optimistic, reverted)).toBe(false);
    expect(eventSubmissionIsNoOp(persisted, reverted, reverted)).toBe(true);
  });

  it("builds a focused optimistic revision request instead of a workspace save", () => {
    const data = workspace();
    const changed = event({ name: "CHANGED" });

    expect(eventSaveRequest(data, changed)).toEqual({
      event: changed,
      revision: 10,
      staffRevision: 7,
      onlineRevision: 3,
    });
    expect(eventSaveRequest(data, changed)).not.toHaveProperty("events");
  });

  it("reconciles the authoritative Event and compact durable acknowledgement", () => {
    const original = workspace();
    const submitted = event({ name: "SUBMITTED" });
    const authoritative = event({ name: "NORMALIZED" });
    const reconciled = reconcileEventSaveConfirmation(
      { ...original, events: [submitted] },
      submitted,
      {
        event: authoritative,
        revision: 11,
        staffRevision: 8,
        onlineRevision: 3,
        loadedAt: "2026-08-10T22:01:00.000Z",
      },
    );

    expect(reconciled.events[0].name).toBe("NORMALIZED");
    expect(reconciled).toMatchObject({
      revision: 11,
      staffRevision: 8,
      onlineRevision: 3,
      loadedAt: "2026-08-10T22:01:00.000Z",
    });
  });

  it("preserves activeRunId and activeRound during Event acknowledgement", () => {
    const submitted = event({ name: "CHANGED" });
    const current = workspace({
      ...submitted,
      activeRunId: "run-3",
      activeRound: 3,
    });
    const reconciled = reconcileEventSaveConfirmation(current, submitted, {
      event: { ...submitted, activeRunId: "run-1", activeRound: 1 },
      revision: 11,
      staffRevision: 8,
      onlineRevision: 3,
      loadedAt: "2026-08-10T22:01:00.000Z",
    });

    expect(reconciled.events[0]).toMatchObject({
      activeRunId: "run-3",
      activeRound: 3,
    });
  });

  it("preserves a newer active selection before applying and sending the form", () => {
    const submitted = event({ activeRunId: "run-1", activeRound: 1 });
    const current = event({ activeRunId: "run-3", activeRound: 3 });

    expect(preserveEventActiveSelection(current, submitted)).toMatchObject({
      activeRunId: "run-3",
      activeRound: 3,
    });
  });

  it("recognizes newer local Event edits after an acknowledgement", () => {
    const persisted = workspace();
    const submitted = event({ name: "FIRST" });
    const current = workspace(event({ name: "SECOND" }));

    expect(eventSaveHasPendingChanges(current, persisted, submitted)).toBe(true);
  });

  it("keeps the locally submitted Event when the direct save fails", async () => {
    const changed = event({ name: "LOCAL PRESERVED" });
    const local = applyEventLocally(workspace(), changed);
    const queue = new EventSaveQueue(async () => {
      throw new Error("Unable to handle request");
    });

    await expect(queue.enqueue(changed)).rejects.toThrow("Unable to handle request");
    expect(local.events[0]).toEqual(changed);
  });

  it("surfaces stale revision failures and continues with a later save", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "Arena data changed in another staff session. Reload before saving again.",
        ),
      )
      .mockResolvedValueOnce("saved");
    const queue = new EventSaveQueue(save);

    await expect(queue.enqueue(event({ name: "STALE" }))).rejects.toThrow(
      "changed in another staff session",
    );
    await expect(queue.enqueue(event({ name: "LOCAL PRESERVED" }))).resolves.toBe(
      "saved",
    );
  });

  it("continues a queued batch after an earlier Event fails", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale Event"))
      .mockResolvedValueOnce("saved later Event");
    const queue = new EventSaveQueue(save);
    const first = queue.enqueue(event({ id: "event-1" }));
    const second = queue.enqueue(event({ id: "event-2" }));

    await expect(first).rejects.toThrow("stale Event");
    await expect(second).resolves.toBe("saved later Event");
    expect(queue.isIdle).toBe(true);
  });

  it("keeps failed Event IDs unresolved until that Event succeeds", () => {
    const failures = new EventSaveFailureTracker();

    failures.recordFailure("event-a");
    failures.recordSuccess("event-b");
    expect(failures.hasFailures).toBe(true);

    failures.recordSuccess("event-a");
    expect(failures.hasFailures).toBe(false);
  });

  it("serializes rapid repeated saves without dropping the latest Event", async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const saved: string[] = [];
    const queue = new EventSaveQueue(async (submitted) => {
      saved.push(submitted.name);
      if (saved.length === 1) await firstPending;
      return submitted.name;
    });

    const first = queue.enqueue(event({ name: "FIRST" }));
    const second = queue.enqueue(event({ name: "SECOND" }));
    expect(queue.isIdle).toBe(false);
    releaseFirst();

    await expect(first).resolves.toBe("FIRST");
    await expect(second).resolves.toBe("SECOND");
    expect(queue.isIdle).toBe(true);
    expect(saved).toEqual(["FIRST", "SECOND"]);
  });
});
