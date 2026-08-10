import type { ArenaData } from "./types";

export interface ActiveRunSelection {
  eventId: string;
  activeRunId?: string;
  activeRound?: number;
}

export function applyActiveRunSelection(
  data: ArenaData,
  selection: ActiveRunSelection,
) {
  return {
    ...data,
    events: data.events.map((event) =>
      event.id === selection.eventId
        ? {
            ...event,
            activeRunId: selection.activeRunId,
            activeRound: selection.activeRound,
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
  ) {}

  enqueue(selection: ActiveRunSelection) {
    this.pending = selection;
    if (!this.running) {
      this.running = this.flush().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async flush() {
    let saved: T | undefined;
    while (this.pending) {
      const selection = this.pending;
      this.pending = undefined;
      saved = await this.save(selection);
    }
    return saved as T;
  }
}
