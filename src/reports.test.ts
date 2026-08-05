import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  contestantFinancials,
  emptyReportFilters,
  generateReport,
  reportDefinitions,
} from "./reports";
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
  spectators: [],
  spectatorPredictions: [],
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

describe("event summary", () => {
  it("counts contestant free-run slots once from Round 1", () => {
    const workspace = data([
      team({ headerFreeRun: true }),
      team({
        id: "round-2",
        round: 2,
        headerFreeRun: true,
        heelerFreeRun: true,
      }),
      team({
        id: "second-entry",
        drawPosition: 2,
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
        heelerFreeRun: true,
      }),
    ]);
    const definition = reportDefinitions.find(
      (report) => report.id === "event-summary",
    );

    expect(definition).toBeDefined();
    const report = generateReport(
      workspace,
      definition!,
      emptyReportFilters(workspace),
    );

    expect(report.rows[0].freeRuns).toBe(2);
    expect(report.columns).toContainEqual({
      key: "freeRuns",
      label: "Free Runs",
    });
  });
});

describe("Slide reports", () => {
  it("shows rider handicaps, combined handicap, and adjustment", () => {
    const slide = {
      ...event,
      competitionType: "slide" as const,
      slideNumber: 10,
      rounds: 2,
    };
    const workspace = data([
      team(),
      team({ id: "round-2", round: 2, rawTime: 8 }),
    ]);
    workspace.events = [slide];
    const definition = reportDefinitions.find(
      (report) => report.id === "competition-final",
    )!;
    const filters = {
      ...emptyReportFilters(workspace),
      competitionId: slide.id,
    };

    const report = generateReport(workspace, definition, filters);

    expect(report.rows[0]).toMatchObject({
      header: "Ada Header (HC 4)",
      heeler: "Bo Heeler (HC 4)",
      teamHandicap: 8,
      slideAdjustment: "2.0s deducted",
    });
  });
});

describe("incentive rules", () => {
  it("ranks Round 1 teams and awards the fixed amount per team", () => {
    const incentiveEvent = {
      ...event,
      incentivePayouts: true,
      incentiveHandicapTotal: 8,
      incentiveTeams: 1,
      incentiveAmountPerTeam: 100,
    };
    const workspace = data([
      team({ rawTime: 6, headerEntryNumber: 1, heelerEntryNumber: 1 }),
      team({
        id: "entry-1-round-2",
        round: 2,
        status: "no-time",
        rawTime: null,
        headerEntryNumber: 1,
        heelerEntryNumber: 1,
      }),
      team({
        id: "entry-2-round-1",
        drawPosition: 2,
        rawTime: 7,
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
      }),
      team({
        id: "entry-2-round-2",
        drawPosition: 2,
        round: 2,
        rawTime: 6,
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
      }),
    ]);
    workspace.events = [incentiveEvent];
    const definition = reportDefinitions.find(
      (report) => report.id === "competition-incentive",
    )!;

    const report = generateReport(workspace, definition, {
      ...emptyReportFilters(workspace),
      competitionId: incentiveEvent.id,
    });

    expect(report.rows[0]).toMatchObject({
      place: 1,
      bonus: "$100.00",
      totalPaid: "$100.00",
      time: 6,
    });
    expect(String(report.rows[0].incentives)).toContain("Team HC 8 / 8");
    expect(
      contestantFinancials(workspace, [incentiveEvent]).map(
        (summary) => summary.earnings,
      ),
    ).toEqual([150, 150]);
  });

  it("requires an exact combined handicap", () => {
    const incentiveEvent = {
      ...event,
      incentivePayouts: true,
      incentiveHandicapTotal: 8,
      incentiveTeams: 3,
      incentiveAmountPerTeam: 75,
    };
    const workspace = data([
      team(),
      team({
        id: "low-team",
        headerId: "low-header",
        drawPosition: 2,
        rawTime: 5,
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
      }),
      team({
        id: "high-team",
        headerId: "high-header",
        drawPosition: 3,
        rawTime: 4,
        headerEntryNumber: 3,
        heelerEntryNumber: 3,
      }),
    ]);
    workspace.events = [incentiveEvent];
    workspace.contestants = [
      ...contestants,
      {
        ...contestants[0],
        id: "low-header",
        name: "Low Header",
        headerHandicap: 3.5,
      },
      {
        ...contestants[0],
        id: "high-header",
        name: "High Header",
        headerHandicap: 4.5,
      },
    ];
    const definition = reportDefinitions.find(
      (report) => report.id === "competition-incentive",
    )!;

    const report = generateReport(workspace, definition, {
      ...emptyReportFilters(workspace),
      competitionId: incentiveEvent.id,
    });

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      team: "Ada Header / Bo Heeler",
      bonus: "$75.00",
    });
  });
});
