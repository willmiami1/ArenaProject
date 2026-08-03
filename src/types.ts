export type View = "overview" | "events" | "contestants" | "teams" | "run-desk";
export type EventStatus = "Upcoming" | "Live" | "Complete";
export type RunStatus = "ready" | "complete" | "no-time";

export interface ArenaEvent {
  id: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  status: EventStatus;
  entryFee: number;
}

export interface Contestant {
  id: string;
  name: string;
  role: "Header" | "Heeler" | "Either";
  phone: string;
  hometown: string;
}

export interface Team {
  id: string;
  eventId: string;
  headerId: string;
  heelerId: string;
  drawPosition: number;
  status: RunStatus;
  rawTime: number | null;
  penalties: number;
  notes: string;
}

export interface ArenaData {
  events: ArenaEvent[];
  contestants: Contestant[];
  teams: Team[];
  activeEventId: string;
}
