import type { ArenaData } from "./types";
import { defaultCompetitionSettings } from "./competition";

export const seedData: ArenaData = {
  meets: [
    {
      id: "meet-summer-series",
      name: "Summer Buckle Series",
      date: "2026-08-08",
      startTime: "18:30",
      location: "Sagebrush Arena",
    },
    {
      id: "meet-friday-night",
      name: "Friday Night Jackpot",
      date: "2026-08-21",
      startTime: "19:00",
      location: "Sagebrush Arena",
    },
  ],
  events: [
    {
      id: "event-summer-series",
      parentEventId: "meet-summer-series",
      name: "Open Pick Only",
      date: "2026-08-08",
      startTime: "18:30",
      location: "Sagebrush Arena",
      status: "Live",
      entryFee: 75,
      ...defaultCompetitionSettings,
      competitionType: "pick-only",
    },
    {
      id: "event-friday-night",
      parentEventId: "meet-friday-night",
      name: "Open Draw Pot",
      date: "2026-08-21",
      startTime: "19:00",
      location: "Sagebrush Arena",
      status: "Upcoming",
      entryFee: 60,
      ...defaultCompetitionSettings,
      competitionType: "draw-pot",
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
  teams: [
    { id: "team-1", eventId: "event-summer-series", headerId: "rider-1", heelerId: "rider-2", drawPosition: 1, status: "complete", rawTime: 6.82, penalties: 0, notes: "", round: 1, checkedIn: true, scratched: false, generated: false, points: 0 },
    { id: "team-2", eventId: "event-summer-series", headerId: "rider-3", heelerId: "rider-5", drawPosition: 2, status: "complete", rawTime: 7.14, penalties: 5, notes: "One leg", round: 1, checkedIn: true, scratched: false, generated: false, points: 0 },
    { id: "team-3", eventId: "event-summer-series", headerId: "rider-4", heelerId: "rider-6", drawPosition: 3, status: "ready", rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: false, scratched: false, generated: false, points: 0 },
    { id: "team-4", eventId: "event-summer-series", headerId: "rider-7", heelerId: "rider-8", drawPosition: 4, status: "ready", rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: false, scratched: false, generated: false, points: 0 },
    { id: "team-5", eventId: "event-summer-series", headerId: "rider-1", heelerId: "rider-5", drawPosition: 5, status: "ready", rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: false, scratched: false, generated: false, points: 0 },
    { id: "team-6", eventId: "event-summer-series", headerId: "rider-3", heelerId: "rider-2", drawPosition: 6, status: "ready", rawTime: null, penalties: 0, notes: "", round: 1, checkedIn: false, scratched: false, generated: false, points: 0 },
  ],
  registrations: [],
  activeEventId: "event-summer-series",
};
