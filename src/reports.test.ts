import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import { contestantFinancials } from "./reports";
import type {
  ArenaData,
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

const event: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "event-1",
  parentEventId: "meet-1",
  name: "Tuesday Roping",
  date: "2026-08-04",
  startTime: "18:00",
  location: "Destiny Ranch Arena",
  status: "Complete",
  entryFee: 100,
  officeCharge: 0,
  stockCharge: 0,
  producerFeePercent: 0,
  addedMoney: 0,
  payoutPercentages: [1],
};

const contestants: Contestant[] = [
  { id: "header", name: "Ada Header", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "", phone: "", hometown: "" },
  { id: "heeler", name: "Bo Heeler", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "", hometown: "" },
];

const team = (overrides: Partial<Team> = {}): Team => ({
  id: "team-1",
  eventId: event.id,
  headerId: "header",
  heelerId: "heeler",
  drawPosition: 1,
  status: "complete",
  rawTime: 8,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: true,
  scratched: false,
  generated: false,
  paid: true,
  points: 1,
  ...overrides,
});

const data = (
  teams: Team[],
  registrations: EventRegistration[] = [],
): ArenaData => ({
  participantDatabaseVersion: 2,
  meets: [{ id: "meet-1", name: "Arena Day", date: event.date, startTime: event.startTime, location: event.location }],
  events: [event],
  contestants,
  teams,
  registrations,
  activeEventId: event.id,
});

describe("contestant spending and earnings", () => {
  it("splits fixed-team entry spending and payout earnings between partners", () => {
    const rows = contestantFinancials(data([team()]), [event]);

    expect(rows).toEqual([
      expect.objectContaining({ contestantId: "header", entries: 1, spent: 50, earnings: 50, net: 0 }),
      expect.objectContaining({ contestantId: "heeler", entries: 1, spent: 50, earnings: 50, net: 0 }),
    ]);
  });

  it("awards the full payout to the eligible partner on a free run", () => {
    const rows = contestantFinancials(
      data([team({ headerFreeRun: true })]),
      [event],
    );

    expect(rows.find((row) => row.contestantId === "header")?.earnings).toBe(0);
    expect(rows.find((row) => row.contestantId === "heeler")?.earnings).toBe(100);
  });

  it("ignores orphan registrations in a pick-only roping", () => {
    const pickOnly = { ...event, competitionType: "pick-only" as const };
    const workspace = data([team()], [{
      id: "registration-1",
      eventId: event.id,
      contestantId: "header",
      role: "Header",
      entries: 2,
      checkedIn: true,
      status: "entered",
      notes: "",
      paid: true,
    }]);
    workspace.events = [pickOnly];

    const header = contestantFinancials(workspace, [pickOnly]).find(
      (row) => row.contestantId === "header",
    );

    expect(header).toMatchObject({ entries: 1, spent: 50 });
  });
});
