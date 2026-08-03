import type { ArenaData } from "./types";
import { defaultCompetitionSettings } from "./competition";

export const seedData: ArenaData = {
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
      handicapTotal: 10,
      timeLimit: 13,
      rounds: 2,
      producerFeePercent: 49.9,
      incentivePayouts: true,
    },
  ],
  contestants: [
    { id: "rider-1", name: "Colt James", role: "Header", headerHandicap: 6, heelerHandicap: 5, photo: "", phone: "555-0142", hometown: "Mesa, AZ" },
    { id: "rider-2", name: "Ty Walker", role: "Heeler", headerHandicap: 4, heelerHandicap: 6, photo: "", phone: "555-0188", hometown: "Gilbert, AZ" },
    { id: "rider-3", name: "Lena Ortiz", role: "Both", headerHandicap: 5.5, heelerHandicap: 5.5, photo: "", phone: "555-0129", hometown: "Queen Creek, AZ" },
    { id: "rider-4", name: "Beau Carter", role: "Header", headerHandicap: 6.5, heelerHandicap: 5, photo: "", phone: "555-0195", hometown: "Cave Creek, AZ" },
    { id: "rider-5", name: "Mia Bennett", role: "Heeler", headerHandicap: 4.5, heelerHandicap: 6.5, photo: "", phone: "555-0161", hometown: "Chandler, AZ" },
    { id: "rider-6", name: "Jace Morgan", role: "Both", headerHandicap: 5, heelerHandicap: 5, photo: "", phone: "555-0117", hometown: "Scottsdale, AZ" },
    { id: "rider-7", name: "Riley Shaw", role: "Header", headerHandicap: 7, heelerHandicap: 5.5, photo: "", phone: "555-0174", hometown: "Tempe, AZ" },
    { id: "rider-8", name: "Cody Lane", role: "Heeler", headerHandicap: 4, heelerHandicap: 6, photo: "", phone: "555-0136", hometown: "Buckeye, AZ" },
  ],
  teams: [],
  registrations: [],
  activeEventId: "event-1785786853437-hui1w",
};
