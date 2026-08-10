import type { ArenaData } from "./types";

export interface ActiveRunSelection {
  eventId: string;
  activeRunId?: string;
  activeRound?: number;
}

export interface ActiveRunConfirmation {
  eventId: string;
  activeRunId: string;
  activeRound: number;
  revision: number;
  staffRevision: number;
  onlineRevision: number;
  loadedAt: string;
}

export class ActiveRunSaveError extends Error {
  constructor(
    error: unknown,
    readonly confirmedSelection: ActiveRunSelection,
  ) {
    super(
      error instanceof Error
        ? error.message
        : "Wix did not confirm the Roping Now selection.",
    );
    this.name = "ActiveRunSaveError";
  }
}

export function activeRunConfirmationIsCurrent(
  data: Pick<ArenaData, "revision">,
  confirmation: Pick<ActiveRunConfirmation, "revision">,
) {
  return Number(confirmation.revision) >= Number(data.revision ?? 0);
}

export function reconcileActiveRunConfirmation(
  data: ArenaData,
  confirmation: ActiveRunConfirmation,
) {
  return {
    ...data,
    revision: confirmation.revision,
    staffRevision: confirmation.staffRevision,
    onlineRevision: confirmation.onlineRevision,
    loadedAt: confirmation.loadedAt,
    events: data.events.map((event) =>
      event.id === confirmation.eventId
        ? {
            ...event,
            activeRunId: confirmation.activeRunId,
            activeRound: confirmation.activeRound,
          }
        : event,
    ),
  };
}

export class LatestActiveRunSaveQueue<T> {
  private pending?: ActiveRunSelection;
  private running?: Promise<T>;

  constructor(
    private readonly save: (selection: ActiveRunSelection) => Promise<T>,
    private readonly onSaved?: (saved: T) => void,
  ) {}

  enqueue(selection: ActiveRunSelection) {
    this.pending = selection;
    if (!this.running) {
      this.running = this.flush();
    }
    return this.running;
  }

  private async flush() {
    let saved: T | undefined;
    try {
      while (this.pending) {
        const selection = this.pending;
        this.pending = undefined;
        saved = await this.save(selection);
        this.onSaved?.(saved);
      }
      return saved as T;
    } catch (error) {
      this.pending = undefined;
      throw error;
    } finally {
      // Clear synchronously before the returned promise settles so a new click
      // cannot attach to a completed run and strand its pending selection.
      this.running = undefined;
    }
  }
}
