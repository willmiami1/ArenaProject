import type { ArenaData } from "./types";

export const seedData: ArenaData = {
  events: [
    {
      id: "event-summer-series",
      name: "Summer Buckle Series",
      date: "2026-08-08",
      startTime: "18:30",
      location: "Sagebrush Arena",
      status: "Live",
      entryFee: 75,
    },
    {
      id: "event-friday-night",
      name: "Friday Night Jackpot",
      date: "2026-08-21",
      startTime: "19:00",
      location: "Sagebrush Arena",
      status: "Upcoming",
      entryFee: 60,
    },
  ],
  contestants: [
    { id: "rider-1", name: "Colt James", role: "Header", phone: "555-0142", hometown: "Mesa, AZ" },
    { id: "rider-2", name: "Ty Walker", role: "Heeler", phone: "555-0188", hometown: "Gilbert, AZ" },
    { id: "rider-3", name: "Lena Ortiz", role: "Either", phone: "555-0129", hometown: "Queen Creek, AZ" },
    { id: "rider-4", name: "Beau Carter", role: "Header", phone: "555-0195", hometown: "Cave Creek, AZ" },
    { id: "rider-5", name: "Mia Bennett", role: "Heeler", phone: "555-0161", hometown: "Chandler, AZ" },
    { id: "rider-6", name: "Jace Morgan", role: "Either", phone: "555-0117", hometown: "Scottsdale, AZ" },
    { id: "rider-7", name: "Riley Shaw", role: "Header", phone: "555-0174", hometown: "Tempe, AZ" },
    { id: "rider-8", name: "Cody Lane", role: "Heeler", phone: "555-0136", hometown: "Buckeye, AZ" },
  ],
  teams: [
    { id: "team-1", eventId: "event-summer-series", headerId: "rider-1", heelerId: "rider-2", drawPosition: 1, status: "complete", rawTime: 6.82, penalties: 0, notes: "" },
    { id: "team-2", eventId: "event-summer-series", headerId: "rider-3", heelerId: "rider-5", drawPosition: 2, status: "complete", rawTime: 7.14, penalties: 5, notes: "One leg" },
    { id: "team-3", eventId: "event-summer-series", headerId: "rider-4", heelerId: "rider-6", drawPosition: 3, status: "ready", rawTime: null, penalties: 0, notes: "" },
    { id: "team-4", eventId: "event-summer-series", headerId: "rider-7", heelerId: "rider-8", drawPosition: 4, status: "ready", rawTime: null, penalties: 0, notes: "" },
    { id: "team-5", eventId: "event-summer-series", headerId: "rider-1", heelerId: "rider-5", drawPosition: 5, status: "ready", rawTime: null, penalties: 0, notes: "" },
    { id: "team-6", eventId: "event-summer-series", headerId: "rider-3", heelerId: "rider-2", drawPosition: 6, status: "ready", rawTime: null, penalties: 0, notes: "" },
  ],
  activeEventId: "event-summer-series",
};
