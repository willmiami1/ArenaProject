import type { ArenaData } from "./types";
import { defaultCompetitionSettings } from "./competition";

export const seedData: ArenaData = {
  participantDatabaseVersion: 4,
  meets: [
    {
      id: "meet-summer-series",
      name: "Mixed Roping",
      date: "2026-08-28",
      startTime: "20:30",
      location: "Destiny Arena",
      producer: "Destiny Ranch Arena",
    },
  ],
  events: [
    {
      ...defaultCompetitionSettings,
      id: "event-1785786853437-hui1w",
      parentEventId: "meet-summer-series",
      name: "DRAW5 AND PICK",
      date: "2026-08-28",
      startTime: "20:30",
      location: "Destiny Arena",
      status: "Upcoming",
      entryFee: 40,
      competitionType: "pick-and-draw",
      pickDrawRole: "both",
      entriesAllowed: 10,
      handicapTotal: 20,
      maxContestantHandicap: 10,
      timeLimit: 13,
      rounds: 2,
      producerFeePercent: 49.9,
      incentivePayouts: true,
    },
  ],
  contestants: [],
  teams: [],
  registrations: [],
  spectators: [],
  spectatorPredictions: [],
  activeEventId: "event-1785786853437-hui1w",
};
