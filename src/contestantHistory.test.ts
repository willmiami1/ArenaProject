import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import { contestantRopingHistory } from "./contestantHistory";
import type {
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

const contestants: Contestant[] = [
  {
    id: "rider",
    name: "Rider One",
    role: "Header",
    headerHandicap: 5,
    heelerHandicap: 0,
    photo: "",
    phone: "",
    hometown: "",
  },
  {
    id: "partner",
    name: "Partner Two",
    role: "Heeler",
    headerHandicap: 0,
    heelerHandicap: 5,
    photo: "",
    phone: "",
    hometown: "",
  },
];

const event = (overrides: Partial<ArenaEvent>): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "roping",
  parentEventId: "meet",
  name: "10 Slide",
  date: "2027-08-21",
  startTime: "19:30",
  location: "Destiny Ranch Arena",
  status: "Upcoming",
  resultsPublished: false,
  ...overrides,
  entryFee: overrides.entryFee ?? 50,
});

const team = (overrides: Partial<Team>): Team => ({
  id: "team",
  eventId: "roping",
  headerId: "rider",
  heelerId: "partner",
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: false,
  scratched: false,
  generated: false,
  points: 0,
  ...overrides,
});

describe("contestant roping history", () => {
  it("includes registered ropings and distinguishes participation", () => {
    const registration: EventRegistration = {
      id: "registration",
      eventId: "registration-only",
      contestantId: "rider",
      role: "Header",
      entries: 1,
      checkedIn: false,
      status: "entered",
      notes: "",
    };
    const history = contestantRopingHistory(
      "rider",
      [
        event({ id: "registration-only", date: "2027-09-01" }),
        event({ id: "roping" }),
      ],
      [team({})],
      [registration],
      contestants,
    );

    expect(history.map((item) => item.event.id)).toEqual([
      "registration-only",
      "roping",
    ]);
    expect(history[0].participated).toBe(false);
    expect(history[1].participated).toBe(false);
  });

  it("reports wins only from published qualified standings", () => {
    const completedTeam = team({ status: "complete", rawTime: 8.25 });
    const draft = contestantRopingHistory(
      "rider",
      [event({ status: "Complete" })],
      [completedTeam],
      [],
      contestants,
    )[0];
    const official = contestantRopingHistory(
      "rider",
      [event({ status: "Complete", resultsPublished: true })],
      [completedTeam],
      [],
      contestants,
    )[0];

    expect(draft).toMatchObject({ participated: true, won: false, bestPlace: null });
    expect(official).toMatchObject({ participated: true, won: true, bestPlace: 1 });
  });
});
