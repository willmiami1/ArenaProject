export type View = "overview" | "events" | "contestants" | "teams" | "reserved" | "run-desk" | "reports";
export type EventStatus = "Upcoming" | "Live" | "Complete";
export type RunStatus = "ready" | "complete" | "no-time";
export type CompetitionType =
  | "draw-pot"
  | "pick-only"
  | "pick-and-draw"
  | "round-robin"
  | "slide";
export type PickDrawRole = "header" | "heeler" | "both";
export type EntryStatus = "entered" | "waitlist" | "scratched";

export interface ReservedSpot {
  id: string;
  name: string;
  position: "Header" | "Heeler" | "Both";
  phone?: string;
  notes?: string;
  source: "staff" | "online";
  contestantId?: string;
  createdAt: string;
}

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
  description?: string;
  date: string;
  startTime: string;
  location: string;
  status: EventStatus;
  entryFee: number;
  competitionType: CompetitionType;
  pickDrawRole: PickDrawRole;
  registrationOpen: boolean;
  drawLocked: boolean;
  drawApproved?: boolean;
  resultsPublished: boolean;
  entriesAllowed: number;
  maxHeaders?: number;
  maxHeelers?: number;
  minDrawsAllowed: number;
  allowRepeatPartners: boolean;
  allowSamePartnerDrawAndPick?: boolean;
  handicapTotal: number;
  slideNumber?: number;
  maxContestantHandicap: number;
  timeLimit: number;
  rounds: number;
  shortGoTeams: number;
  progressiveAfterRound: number;
  addedMoney: number;
  incentivePayouts: boolean;
  incentiveHandicapTotal: number;
  incentiveTeams: number;
  incentiveAmountPerTeam: number;
  officeCharge: number;
  stockCharge: number;
  producerFeePercent: number;
  payoutPercentages: number[];
  payoutMode?: "custom" | "formula";
  reservedSpots?: ReservedSpot[];
  drawHistory: DrawSnapshot[];
  activeRunId?: string;
  activeRound?: number;
  supportedEntryTypes?: Array<"draws" | "picked-teams">;
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
  horses?: string[];
  membershipNumber?: string;
  email?: string;
  categoryNumber?: string;
  source?: "online" | "staff";
  submittedAt?: string;
  clearPhoto?: boolean;
}

export interface Team {
  id: string;
  eventId: string;
  headerId: string;
  heelerId: string;
  headerHorseName?: string;
  heelerHorseName?: string;
  drawPosition: number;
  originalTeamNumber?: number;
  status: RunStatus;
  rawTime: number | null;
  penalties: number;
  notes: string;
  round: number;
  checkedIn: boolean;
  scratched: boolean;
  generated: boolean;
  rideIn?: boolean;
  rolled?: boolean;
  points: number;
  headerEntryNumber?: number;
  heelerEntryNumber?: number;
  headerFreeRun?: boolean;
  heelerFreeRun?: boolean;
  steerNumber?: string;
  arenaPosition?: string;
  barrierPenalty?: boolean;
  paid?: boolean;
  paymentMethod?: "cash" | "card" | "tab";
  paymentReference?: string;
  source?: "online" | "staff";
  submissionId?: string;
  submittedAt?: string;
  rowId?: string;
  entryType?: "draws" | "picked-teams";
  payerContestantId?: string;
  submissionFingerprint?: string;
  predictionClosesAt?: string;
}

export interface Spectator {
  id: string;
  name: string;
  phone?: string;
  createdAt: string;
}

export interface SpectatorPrediction {
  id: string;
  spectatorId: string;
  eventId: string;
  teamId: string;
  round: number;
  choice: "steer" | "cowboys";
  submittedAt: string;
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
  sourceTeamId?: string;
  horseName?: string;
  role: "Header" | "Heeler";
  entries: number;
  checkedIn: boolean;
  status: EntryStatus;
  notes: string;
  paid?: boolean;
  paymentMethod?: "cash" | "card" | "tab";
  paymentReference?: string;
  source?: "online" | "staff";
  submissionId?: string;
  submittedAt?: string;
  entryType?: "draws" | "picked-teams";
  payerContestantId?: string;
  submissionFingerprint?: string;
}

export interface ArenaData {
  participantDatabaseVersion: number;
  meets: ArenaMeet[];
  events: ArenaEvent[];
  contestants: Contestant[];
  teams: Team[];
  registrations: EventRegistration[];
  spectators: Spectator[];
  spectatorPredictions: SpectatorPrediction[];
  activeEventId: string;
  revision?: number;
  staffRevision?: number;
  onlineRevision?: number;
  loadedAt?: string;
}
