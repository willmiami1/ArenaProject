import type { ArenaData, ArenaEvent } from "./types";

export interface EventSaveConfirmation {
  event: ArenaEvent;
  saved?: boolean;
  revision: number;
  staffRevision: number;
  onlineRevision: number;
  loadedAt: string;
}

export function eventsSemanticallyEqual(
  left: ArenaEvent | undefined,
  right: ArenaEvent | undefined,
) {
  if (!left || !right) return left === right;
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
          .map(([key, item]) => [key, canonicalize(item)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function eventConfigurationSemanticallyEqual(
  left: ArenaEvent | undefined,
  right: ArenaEvent | undefined,
) {
  const withoutActiveSelection = (event: ArenaEvent | undefined) => {
    if (!event) return event;
    const {
      activeRunId: _activeRunId,
      activeRound: _activeRound,
      ...configuration
    } = event;
    return configuration as ArenaEvent;
  };
  return eventsSemanticallyEqual(
    withoutActiveSelection(left),
    withoutActiveSelection(right),
  );
}

export function preserveEventActiveSelection(
  current: ArenaEvent | undefined,
  submitted: ArenaEvent,
) {
  if (!current) return submitted;
  return {
    ...submitted,
    activeRunId: current.activeRunId,
    activeRound: current.activeRound,
  };
}

export function eventSubmissionNeedsSave(
  persisted: ArenaEvent | undefined,
  submitted: ArenaEvent,
) {
  return !eventConfigurationSemanticallyEqual(persisted, submitted);
}

export function eventSubmissionIsNoOp(
  persisted: ArenaEvent | undefined,
  current: ArenaEvent | undefined,
  submitted: ArenaEvent,
) {
  return (
    !eventSubmissionNeedsSave(persisted, submitted) &&
    !eventSubmissionNeedsSave(current, submitted)
  );
}

export function applyEventLocally(data: ArenaData, event: ArenaEvent) {
  const exists = data.events.some((item) => item.id === event.id);
  return {
    ...data,
    events: exists
      ? data.events.map((item) => (item.id === event.id ? event : item))
      : [...data.events, event],
    activeEventId: exists ? data.activeEventId : event.id,
  };
}

export function reconcileEventSaveConfirmation(
  data: ArenaData,
  submitted: ArenaEvent,
  confirmation: EventSaveConfirmation,
) {
  const currentEvent = data.events.find((event) => event.id === submitted.id);
  const newerLocalEvent =
    currentEvent &&
    !eventConfigurationSemanticallyEqual(currentEvent, submitted);
  const confirmedEvent = currentEvent
    ? {
        ...(newerLocalEvent ? currentEvent : confirmation.event),
        activeRunId: currentEvent.activeRunId,
        activeRound: currentEvent.activeRound,
      }
    : confirmation.event;
  return {
    ...data,
    revision: confirmation.revision,
    staffRevision: confirmation.staffRevision,
    onlineRevision: confirmation.onlineRevision,
    loadedAt: confirmation.loadedAt,
    events: data.events.some((event) => event.id === submitted.id)
      ? data.events.map((event) =>
          event.id === submitted.id ? confirmedEvent : event,
        )
      : [...data.events, confirmedEvent],
  };
}

export function eventSaveHasPendingChanges(
  current: ArenaData,
  persisted: ArenaData,
  submitted: ArenaEvent,
) {
  const currentEvent = current.events.find((event) => event.id === submitted.id);
  if (!eventConfigurationSemanticallyEqual(currentEvent, submitted)) return true;
  return eventSaveHasUnrelatedChanges(current, persisted, submitted);
}

export function eventSaveHasUnrelatedChanges(
  current: ArenaData,
  persisted: ArenaData,
  submitted: ArenaEvent,
) {
  const comparable = (data: ArenaData) => {
    const {
      revision: _revision,
      staffRevision: _staffRevision,
      onlineRevision: _onlineRevision,
      loadedAt: _loadedAt,
      ...content
    } = data;
    const submittedWasCreated = !persisted.events.some(
      (event) => event.id === submitted.id,
    );
    return {
      ...content,
      activeEventId:
        submittedWasCreated && content.activeEventId === submitted.id
          ? persisted.activeEventId
          : content.activeEventId,
      events: content.events.filter((event) => event.id !== submitted.id),
    };
  };
  return (
    JSON.stringify(comparable(current)) !==
    JSON.stringify(comparable(persisted))
  );
}

export class EventSaveQueue<T> {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  constructor(private readonly save: (event: ArenaEvent) => Promise<T>) {}

  get isIdle() {
    return this.pendingCount === 0;
  }

  enqueue(event: ArenaEvent) {
    this.pendingCount += 1;
    const operation = this.tail.then(() => this.save(event));
    const tracked = operation.finally(() => {
      this.pendingCount -= 1;
    });
    this.tail = tracked.then(
      () => undefined,
      () => undefined,
    );
    return tracked;
  }
}

export class EventSaveFailureTracker {
  private readonly eventIds = new Set<string>();

  get hasFailures() {
    return this.eventIds.size > 0;
  }

  recordFailure(eventId: string) {
    this.eventIds.add(eventId);
  }

  recordSuccess(eventId: string) {
    this.eventIds.delete(eventId);
  }
}
