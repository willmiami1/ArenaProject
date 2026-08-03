export type View = "overview" | "events" | "contestants" | "teams" | "run-desk" | "reports";
export type EventStatus = "Upcoming" | "Live" | "Complete";
export type RunStatus = "ready" | "complete" | "no-time";
export type CompetitionType = "draw-pot" | "pick-only" | "pick-and-draw" | "round-robin";
export type PickDrawRole = "header" | "heeler" | "both";
export type EntryStatus = "entered" | "waitlist" | "scratched";

export interface ArenaMeet {
  id: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  producer?: string;
}

export interface ArenaEvent {
  id: string;
  parentEventId: string;
  name: string;
  date: string;
  startTime: string;
  location: string;
  status: EventStatus;
  entryFee: number;
  competitionType: CompetitionType;
  pickDrawRole: PickDrawRole;
  registrationOpen: boolean;
  drawLocked: boolean;
  resultsPublished: boolean;
  entriesAllowed: number;
  handicapTotal: number;
  timeLimit: number;
  rounds: number;
  shortGoTeams: number;
  progressiveAfterRound: number;
  addedMoney: number;
  incentivePayouts: boolean;
  officeCharge: number;
  stockCharge: number;
  producerFeePercent: number;
  payoutPercentages: number[];
  drawHistory: DrawSnapshot[];
}

export interface Contestant {
  id: string;
  name: string;
  role: "Header" | "Heeler" | "Both";
  headerHandicap: number;
  heelerHandicap: number;
  photo: string;
  phone: string;
  hometown: string;
  membershipNumber?: string;
  email?: string;
  categoryNumber?: string;
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
  round: number;
  checkedIn: boolean;
  scratched: boolean;
  generated: boolean;
  points: number;
  headerEntryNumber?: number;
  heelerEntryNumber?: number;
  headerFreeRun?: boolean;
  heelerFreeRun?: boolean;
  steerNumber?: string;
  arenaPosition?: string;
  barrierPenalty?: boolean;
  paid?: boolean;
}

export interface DrawSnapshot {
  id: string;
  createdAt: string;
  teams: Team[];
}

export interface EventRegistration {
  id: string;
  eventId: string;
  contestantId: string;
  role: "Header" | "Heeler";
  entries: number;
  checkedIn: boolean;
  status: EntryStatus;
  notes: string;
  paid?: boolean;
}

export interface ArenaData {
  participantDatabaseVersion: number;
  meets: ArenaMeet[];
  events: ArenaEvent[];
  contestants: Contestant[];
  teams: Team[];
  registrations: EventRegistration[];
  activeEventId: string;
}
