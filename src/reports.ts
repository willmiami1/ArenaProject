import {
  calculatePayouts,
  calculatePurse,
  competitionName,
  officialRunTime,
  slideTimeAdjustment,
  teamHandicapTotal,
} from "./competition";
import {
  aggregateStandings,
  teamEntryKey,
  type AggregateStanding,
} from "./standings";
import type {
  ArenaData,
  ArenaEvent,
  Contestant,
  EventRegistration,
  Team,
} from "./types";

export type ReportRole =
  | "Administrator"
  | "Event Producer"
  | "Secretary"
  | "Announcer"
  | "Read-Only User";

export type ReportSection = "event" | "competition";
export type ReportKind =
  | "summary"
  | "financial"
  | "contestant"
  | "contestant-financial"
  | "team"
  | "registration"
  | "status"
  | "draw"
  | "results"
  | "standings"
  | "payout"
  | "stock"
  | "arena";

export interface ReportDefinition {
  id: string;
  title: string;
  description: string;
  section: ReportSection;
  category: "Event Reports" | "Competition Reports" | "Financial Reports" | "Payout Reports" | "Draw Reports" | "Results Reports" | "Statistics";
  kind: ReportKind;
  roles: ReportRole[];
}

export interface ReportFilters {
  meetId: string;
  competitionId: string;
  date: string;
  categoryNumber: string;
  role: "" | "Header" | "Heeler";
  team: string;
  round: string;
  drawPosition: string;
  qualifiedOnly: boolean;
  noTimesOnly: boolean;
  paidStatus: "" | "paid" | "unpaid";
  checkedInOnly: boolean;
  scratchedOnly: boolean;
  search: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export type ReportValue = string | number;
export type ReportRow = Record<string, ReportValue>;

export interface ReportMetric {
  label: string;
  value: string;
  numericValue?: number;
}

export interface GeneratedReport {
  definition: ReportDefinition;
  eventName: string;
  competitionName: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  metrics: ReportMetric[];
  generatedAt: string;
}

const allRoles: ReportRole[] = [
  "Administrator",
  "Event Producer",
  "Secretary",
  "Announcer",
  "Read-Only User",
];
const operationsRoles: ReportRole[] = [
  "Administrator",
  "Event Producer",
  "Secretary",
  "Read-Only User",
];
const liveRoles: ReportRole[] = allRoles;
const financialRoles: ReportRole[] = [
  "Administrator",
  "Event Producer",
  "Secretary",
  "Read-Only User",
];

export const reportDefinitions: ReportDefinition[] = [
  { id: "event-summary", title: "Event Summary", description: "Complete operational and financial snapshot for the event.", section: "event", category: "Event Reports", kind: "summary", roles: allRoles },
  { id: "event-financial", title: "Financial Summary", description: "Fees, charges, purses, payouts, and remaining funds.", section: "event", category: "Financial Reports", kind: "financial", roles: financialRoles },
  { id: "event-contestants", title: "Contestant Report", description: "Entries, roles, contact details, check-in, and winnings.", section: "event", category: "Event Reports", kind: "contestant", roles: operationsRoles },
  { id: "event-teams", title: "Team Report", description: "Every team, draw position, result, earnings, and standing.", section: "event", category: "Event Reports", kind: "team", roles: operationsRoles },
  { id: "event-draw", title: "Draw Report", description: "Printable draw-sheet running order for every competition.", section: "event", category: "Draw Reports", kind: "draw", roles: liveRoles },
  { id: "event-results", title: "Results Report", description: "Round results, averages, rankings, and prize money.", section: "event", category: "Results Reports", kind: "results", roles: liveRoles },
  { id: "event-payout", title: "Payout Report", description: "Places, teams, times, incentives, and total paid.", section: "event", category: "Payout Reports", kind: "payout", roles: financialRoles },
  { id: "event-stock", title: "Stock Report", description: "Steer assignments, run counts, times, and barrier calls.", section: "event", category: "Event Reports", kind: "stock", roles: operationsRoles },
  { id: "event-arena", title: "Arena Statistics", description: "Runs, clean catches, no-times, penalties, and time trends.", section: "event", category: "Statistics", kind: "arena", roles: allRoles },

  { id: "competition-registration", title: "Registration List", description: "Entries, payment, check-in, and scratch status.", section: "competition", category: "Competition Reports", kind: "registration", roles: financialRoles },
  { id: "competition-contestant-financials", title: "Contestant Spending & Earnings", description: "Entry spending, payout earnings, net results, and places for each contestant.", section: "competition", category: "Financial Reports", kind: "contestant-financial", roles: financialRoles },
  { id: "competition-contestants", title: "Contestant List", description: "Contestants entered in the selected competition.", section: "competition", category: "Competition Reports", kind: "contestant", roles: operationsRoles },
  { id: "competition-teams", title: "Team List", description: "Complete selected-competition team roster.", section: "competition", category: "Competition Reports", kind: "team", roles: operationsRoles },
  { id: "competition-draw", title: "Draw Sheets", description: "Print-ready draw order and arena positions.", section: "competition", category: "Draw Reports", kind: "draw", roles: liveRoles },
  { id: "competition-round", title: "Round Results", description: "Times and status for every selected round.", section: "competition", category: "Results Reports", kind: "results", roles: liveRoles },
  { id: "competition-progressive", title: "Progressive Results", description: "Teams advancing through progressive rounds.", section: "competition", category: "Results Reports", kind: "standings", roles: liveRoles },
  { id: "competition-average", title: "Average Results", description: "Aggregate team times across completed rounds.", section: "competition", category: "Results Reports", kind: "standings", roles: liveRoles },
  { id: "competition-final", title: "Final Standings", description: "Final ranking, average, and prize money.", section: "competition", category: "Results Reports", kind: "standings", roles: liveRoles },
  { id: "competition-score", title: "Score Sheets", description: "Judge-ready team and scoring worksheet.", section: "competition", category: "Competition Reports", kind: "team", roles: operationsRoles },
  { id: "competition-time", title: "Time Sheets", description: "Raw time, penalties, and calculated time.", section: "competition", category: "Competition Reports", kind: "results", roles: operationsRoles },
  { id: "competition-payout", title: "Payout Report", description: "Projected and earned payouts by final place.", section: "competition", category: "Payout Reports", kind: "payout", roles: financialRoles },
  { id: "competition-incentive", title: "Incentive Report", description: "Incentive-eligible teams and payout tracking.", section: "competition", category: "Payout Reports", kind: "payout", roles: financialRoles },
  { id: "competition-team-stats", title: "Team Statistics", description: "Round count, averages, penalties, and performance.", section: "competition", category: "Statistics", kind: "standings", roles: allRoles },
  { id: "competition-arena", title: "Arena Statistics", description: "Selected-competition run and time statistics.", section: "competition", category: "Statistics", kind: "arena", roles: allRoles },
  { id: "competition-judge", title: "Judge Report", description: "Barrier calls, penalties, no-times, and notes.", section: "competition", category: "Competition Reports", kind: "results", roles: operationsRoles },
  { id: "competition-scratch", title: "Scratch List", description: "Scratched teams and registration entries.", section: "competition", category: "Competition Reports", kind: "status", roles: financialRoles },
  { id: "competition-checkin", title: "Check-In Report", description: "Contestant and team check-in status.", section: "competition", category: "Competition Reports", kind: "status", roles: financialRoles },
  { id: "competition-stock", title: "Stock Assignment Report", description: "Steer numbers, teams, positions, and outcomes.", section: "competition", category: "Competition Reports", kind: "stock", roles: operationsRoles },
];

export const emptyReportFilters = (data: ArenaData): ReportFilters => ({
  meetId:
    data.events.find((event) => event.id === data.activeEventId)?.parentEventId ??
    data.meets[0]?.id ??
    "",
  competitionId: data.activeEventId || data.events[0]?.id || "",
  date: "",
  categoryNumber: "",
  role: "",
  team: "",
  round: "",
  drawPosition: "",
  qualifiedOnly: false,
  noTimesOnly: false,
  paidStatus: "",
  checkedInOnly: false,
  scratchedOnly: false,
  search: "",
});

const money = (value: number) =>
  value.toLocaleString(undefined, { style: "currency", currency: "USD" });

const finalTime = (
  event: ArenaEvent | undefined,
  team: Team,
  contestants: Contestant[],
) =>
  event
    ? officialRunTime(event, team, contestants)
    : team.rawTime === null
      ? null
      : team.rawTime + team.penalties;

const contestantName = (contestants: Contestant[], id: string) =>
  contestants.find((contestant) => contestant.id === id)?.name ?? "Unknown";

function slideReportDetails(
  event: ArenaEvent | undefined,
  headerId: string,
  heelerId: string,
  contestants: Contestant[],
) {
  if (event?.competitionType !== "slide") {
    return {
      header: contestantName(contestants, headerId),
      heeler: contestantName(contestants, heelerId),
      teamHandicap: "—",
      slideAdjustment: "—",
    };
  }

  const header = contestants.find((contestant) => contestant.id === headerId);
  const heeler = contestants.find((contestant) => contestant.id === heelerId);
  const adjustment = slideTimeAdjustment(
    event,
    { headerId, heelerId, round: 2 },
    contestants,
  );
  return {
    header: `${header?.name ?? "Unknown"} (HC ${header?.headerHandicap ?? 3})`,
    heeler: `${heeler?.name ?? "Unknown"} (HC ${heeler?.heelerHandicap ?? 3})`,
    teamHandicap: teamHandicapTotal(headerId, heelerId, contestants),
    slideAdjustment:
      adjustment > 0
        ? `${adjustment.toFixed(1)}s added`
        : adjustment < 0
          ? `${Math.abs(adjustment).toFixed(1)}s deducted`
          : "0.0s",
  };
}

function incentiveAwards(
  event: ArenaEvent,
  standings: AggregateStanding[],
  contestants: Contestant[],
  teams: Team[],
) {
  if (!event.incentivePayouts) {
    return {
      eligible: [] as AggregateStanding[],
      awards: new Map<string, { place: number; amount: number }>(),
    };
  }
  const standingsByKey = new Map(
    standings.map((standing) => [standing.key, standing]),
  );
  const roundOneByEntry = new Map<string, Team>();
  teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        team.round === 1 &&
        team.status === "complete" &&
        team.rawTime !== null &&
        !team.scratched &&
        teamHandicapTotal(team.headerId, team.heelerId, contestants) ===
          (event.incentiveHandicapTotal ?? 7),
    )
    .forEach((team) => {
      const key = teamEntryKey(team);
      const current = roundOneByEntry.get(key);
      if (
        !current ||
        (officialRunTime(event, team, contestants) ?? Infinity) <
          (officialRunTime(event, current, contestants) ?? Infinity)
      ) {
        roundOneByEntry.set(key, team);
      }
    });
  const eligible = [...roundOneByEntry.entries()]
    .map(([key, roundOne]) => ({
      roundOne,
      standing: standingsByKey.get(key),
      time: officialRunTime(event, roundOne, contestants),
    }))
    .filter(
      (
        item,
      ): item is {
        roundOne: Team;
        standing: AggregateStanding;
        time: number;
      } => Boolean(item.standing) && item.time !== null,
    )
    .sort(
      (left, right) =>
        left.time - right.time ||
        left.roundOne.drawPosition - right.roundOne.drawPosition,
    )
    .map((item, index) => ({
      ...item.standing,
      rounds: 1,
      total: item.time,
      average: item.time,
      qualified: true,
      status: "qualified" as const,
      rank: index + 1,
    }));
  const winners = eligible.slice(
    0,
    Math.max(0, Math.floor(event.incentiveTeams ?? 1)),
  );
  return {
    eligible,
    awards: new Map(
      winners.map((standing, index) => [
        standing.key,
        {
          place: index + 1,
          amount: Math.max(0, event.incentiveAmountPerTeam ?? 0),
        },
      ]),
    ),
  };
}

function eventEntries(
  event: ArenaEvent,
  teams: Team[],
  registrations: EventRegistration[],
) {
  const registrationEntries = registrations
    .filter(
      (registration) =>
        registration.eventId === event.id &&
        registration.status !== "scratched" &&
        registration.paid !== false,
    )
    .reduce((sum, registration) => sum + registration.entries, 0);
  const fixedTeamEntries = teams.filter(
    (team) =>
      team.eventId === event.id &&
      team.round === 1 &&
      !team.generated &&
      !team.scratched &&
      team.paid !== false,
  ).length;
  if (event.competitionType === "pick-only") return fixedTeamEntries;
  if (event.competitionType === "pick-and-draw") {
    return fixedTeamEntries + registrationEntries;
  }
  return registrationEntries + fixedTeamEntries;
}

function eventFinancials(
  event: ArenaEvent,
  teams: Team[],
  registrations: EventRegistration[],
  contestants: Contestant[] = [],
) {
  const entries = eventEntries(event, teams, registrations);
  const collected = entries * event.entryFee;
  const office = entries * event.officeCharge;
  const stock = entries * event.stockCharge;
  const feeBase = Math.max(0, event.entryFee - event.officeCharge - event.stockCharge);
  const producer = entries * feeBase * (event.producerFeePercent / 100);
  const purse = calculatePurse(event, entries);
  const standings = aggregateStandings(event, teams, contestants);
  const qualified = standings.filter(
    (standing) => standing.qualified,
  );
  const payouts = calculatePayouts(
    purse,
    qualified.length,
    event.payoutPercentages,
  );
  const totalPayouts = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  const incentives = incentiveAwards(event, standings, contestants, teams);
  const totalIncentivePayouts = [...incentives.awards.values()].reduce(
    (sum, payout) => sum + payout.amount,
    0,
  );
  const remaining =
    collected +
    event.addedMoney -
    office -
    stock -
    producer -
    totalPayouts -
    totalIncentivePayouts;
  return {
    entries,
    collected,
    office,
    stock,
    producer,
    added: event.addedMoney,
    purse,
    totalPayouts,
    totalIncentivePayouts,
    remaining,
  };
}

function scopedData(data: ArenaData, definition: ReportDefinition, filters: ReportFilters) {
  let events =
    definition.section === "competition"
      ? data.events.filter((event) => event.id === filters.competitionId)
      : data.events.filter(
          (event) => !filters.meetId || event.parentEventId === filters.meetId,
        );
  if (filters.date) {
    events = events.filter((event) => event.date === filters.date);
  }
  const eventIds = new Set(events.map((event) => event.id));
  let teams = data.teams.filter((team) => eventIds.has(team.eventId));
  let registrations = data.registrations.filter((registration) =>
    eventIds.has(registration.eventId),
  );

  if (filters.round) {
    teams = teams.filter((team) => team.round === Number(filters.round));
  }
  if (filters.drawPosition) {
    teams = teams.filter(
      (team) => team.drawPosition === Number(filters.drawPosition),
    );
  }
  if (filters.qualifiedOnly) {
    teams = teams.filter((team) => team.status === "complete");
  }
  if (filters.noTimesOnly) {
    teams = teams.filter((team) => team.status === "no-time");
  }
  if (filters.checkedInOnly) {
    teams = teams.filter((team) => team.checkedIn);
    registrations = registrations.filter((registration) => registration.checkedIn);
  }
  if (filters.scratchedOnly) {
    teams = teams.filter((team) => team.scratched);
    registrations = registrations.filter(
      (registration) => registration.status === "scratched",
    );
  }
  if (filters.paidStatus) {
    registrations = registrations.filter((registration) =>
      filters.paidStatus === "paid"
        ? registration.paid !== false
        : registration.paid === false,
    );
    teams = teams.filter((team) =>
      filters.paidStatus === "paid" ? team.paid !== false : team.paid === false,
    );
  }
  if (filters.role) {
    registrations = registrations.filter(
      (registration) => registration.role === filters.role,
    );
  }
  if (filters.team) {
    const query = filters.team.toLowerCase();
    teams = teams.filter((team) =>
      `${contestantName(data.contestants, team.headerId)} ${contestantName(
        data.contestants,
        team.heelerId,
      )}`
        .toLowerCase()
        .includes(query),
    );
  }
  return { events, teams, registrations };
}

function teamRows(
  data: ArenaData,
  events: ArenaEvent[],
  teams: Team[],
  includeResult: boolean,
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const payouts = new Map<string, { rank: number; amount: number }>();
  events.forEach((event) => {
    const standings = aggregateStandings(event, teams, data.contestants);
    const financials = eventFinancials(event, data.teams, data.registrations, data.contestants);
    const projected = calculatePayouts(
      financials.purse,
      standings.filter((standing) => standing.qualified).length,
      event.payoutPercentages,
    );
    standings.forEach((standing) => {
      payouts.set(`${event.id}|${standing.key}`, {
        rank: standing.rank,
        amount: projected[standing.rank - 1]?.amount ?? 0,
      });
    });
  });
  return teams
    .sort((a, b) => a.round - b.round || a.drawPosition - b.drawPosition)
    .map((team) => {
      const event = eventMap.get(team.eventId);
      const slideDetails = slideReportDetails(
        event,
        team.headerId,
        team.heelerId,
        data.contestants,
      );
      const result = payouts.get(
        `${team.eventId}|${team.headerId}|${team.heelerId}|${team.headerEntryNumber ?? 1}|${team.heelerEntryNumber ?? 1}`,
      );
      return {
        competition: event?.name ?? "Unknown",
        round: team.round,
        draw: team.drawPosition,
        teamNumber: team.drawPosition,
        header: slideDetails.header,
        heeler: slideDetails.heeler,
        teamHandicap: slideDetails.teamHandicap,
        slideAdjustment: slideDetails.slideAdjustment,
        arenaPosition: team.arenaPosition ?? "—",
        steer: team.steerNumber ?? "—",
        rawTime: team.rawTime ?? "—",
        penalties: team.penalties,
        time: finalTime(event, team, data.contestants) ?? "—",
        status: team.scratched
          ? "Scratched"
          : team.status === "no-time"
            ? "No Time"
            : team.status === "complete"
              ? "Qualified"
              : "Ready",
        standing: includeResult && result ? result.rank : "—",
        earnings: includeResult && result ? money(result.amount) : money(0),
        notes: team.notes || "—",
      };
    });
}

function contestantRows(
  data: ArenaData,
  events: ArenaEvent[],
  teams: Team[],
  registrations: EventRegistration[],
  filters: ReportFilters,
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const registrationsByContestant = new Map<string, EventRegistration[]>();
  registrations.forEach((registration) => {
    registrationsByContestant.set(registration.contestantId, [
      ...(registrationsByContestant.get(registration.contestantId) ?? []),
      registration,
    ]);
  });
  const teamsByContestant = new Map<string, Team[]>();
  teams.forEach((team) => {
    [team.headerId, team.heelerId].forEach((contestantId) => {
      teamsByContestant.set(contestantId, [
        ...(teamsByContestant.get(contestantId) ?? []),
        team,
      ]);
    });
  });
  const winnings = contestantWinnings(data, events);
  const enteredIds = new Set([
    ...teams.flatMap((team) => [team.headerId, team.heelerId]),
    ...registrations.map((registration) => registration.contestantId),
  ]);
  const source = enteredIds.size
    ? data.contestants.filter((contestant) => enteredIds.has(contestant.id))
    : data.contestants;
  return source
    .filter(
      (contestant) =>
        (!filters.categoryNumber ||
          contestant.categoryNumber === filters.categoryNumber) &&
        (!filters.role ||
          contestant.role === filters.role ||
          contestant.role === "Both"),
    )
    .map((contestant) => {
      const contestantRegistrations =
        registrationsByContestant.get(contestant.id) ?? [];
      const contestantTeams = teamsByContestant.get(contestant.id) ?? [];
      const competitionNames = new Set([
        ...contestantRegistrations.map(
          (registration) => eventMap.get(registration.eventId)?.name,
        ),
        ...contestantTeams.map((team) => eventMap.get(team.eventId)?.name),
      ]);
      return {
        name: contestant.name,
        role: contestant.role,
        membership: contestant.membershipNumber ?? "—",
        phone: contestant.phone || "—",
        email: contestant.email ?? "—",
        category: contestant.categoryNumber ?? "—",
        entries: contestantRegistrations.reduce(
          (sum, registration) => sum + registration.entries,
          0,
        ) || contestantTeams.filter((team) => team.round === 1).length,
        competitions: [...competitionNames].filter(Boolean).join(", ") || "—",
        checkedIn:
          contestantRegistrations.some((registration) => registration.checkedIn) ||
          contestantTeams.some((team) => team.checkedIn)
            ? "Yes"
            : "No",
        winnings: money(winnings.get(contestant.id) ?? 0),
      };
    });
}

export interface ContestantFinancialSummary {
  contestantId: string;
  entries: number;
  spent: number;
  earnings: number;
  net: number;
  places: string[];
}

export function contestantFinancials(
  data: ArenaData,
  events: ArenaEvent[],
): ContestantFinancialSummary[] {
  const summaries = new Map<string, ContestantFinancialSummary>();
  const ensureSummary = (contestantId: string) => {
    const existing = summaries.get(contestantId);
    if (existing) return existing;
    const created = {
      contestantId,
      entries: 0,
      spent: 0,
      earnings: 0,
      net: 0,
      places: [],
    };
    summaries.set(contestantId, created);
    return created;
  };

  events.forEach((event) => {
    const eventTeams = data.teams.filter(
      (team) => team.eventId === event.id && !team.scratched,
    );
    const eventRegistrations = data.registrations.filter(
      (registration) =>
        registration.eventId === event.id &&
        registration.status !== "scratched",
    );

    eventTeams.forEach((team) => {
      ensureSummary(team.headerId);
      ensureSummary(team.heelerId);
    });
    eventRegistrations.forEach((registration) => {
      const summary = ensureSummary(registration.contestantId);
      if (event.competitionType === "pick-only") return;
      summary.entries += registration.entries;
      if (registration.paid !== false) {
        summary.spent += registration.entries * event.entryFee;
      }
    });

    eventTeams
      .filter((team) => team.round === 1 && !team.generated)
      .forEach((team) => {
        const contestantIds = [...new Set([team.headerId, team.heelerId])];
        contestantIds.forEach((contestantId) => {
          ensureSummary(contestantId).entries += 1;
        });
        if (team.paid === false) return;
        const payingContestants = team.headerFreeRun
          ? [team.heelerId]
          : team.heelerFreeRun
            ? [team.headerId]
            : contestantIds;
        const share = event.entryFee / Math.max(payingContestants.length, 1);
        payingContestants.forEach((contestantId) => {
          ensureSummary(contestantId).spent += share;
        });
      });

    const allStandings = aggregateStandings(
      event,
      data.teams,
      data.contestants,
    );
    const standings = allStandings.filter(
      (standing) => standing.qualified,
    );
    const financials = eventFinancials(event, data.teams, data.registrations, data.contestants);
    const payouts = calculatePayouts(
      financials.purse,
      standings.length,
      event.payoutPercentages,
    );
    payouts.forEach((payout) => {
      const standing = standings[payout.place - 1];
      if (!standing) return;
      const sourceTeam = eventTeams.find(
        (team) =>
          team.round === 1 && teamEntryKey(team) === standing.key,
      );
      const recipients = sourceTeam?.headerFreeRun
        ? [standing.heelerId]
        : sourceTeam?.heelerFreeRun
          ? [standing.headerId]
          : [...new Set([standing.headerId, standing.heelerId])];
      const share = payout.amount / Math.max(recipients.length, 1);
      recipients.forEach((contestantId) => {
        const summary = ensureSummary(contestantId);
        summary.earnings += share;
        summary.places.push(`${event.name}: #${payout.place}`);
      });
    });
    const incentives = incentiveAwards(
      event,
      allStandings,
      data.contestants,
      eventTeams,
    );
    incentives.awards.forEach((award, standingKey) => {
      const standing = incentives.eligible.find(
        (item) => item.key === standingKey,
      );
      if (!standing) return;
      const sourceTeam = eventTeams.find(
        (team) => teamEntryKey(team) === standing.key,
      );
      const recipients = sourceTeam?.headerFreeRun
        ? [standing.heelerId]
        : sourceTeam?.heelerFreeRun
          ? [standing.headerId]
          : [...new Set([standing.headerId, standing.heelerId])];
      const share = award.amount / Math.max(recipients.length, 1);
      recipients.forEach((contestantId) => {
        const summary = ensureSummary(contestantId);
        summary.earnings += share;
        summary.places.push(`${event.name} incentive: #${award.place}`);
      });
    });
  });

  return [...summaries.values()]
    .map((summary) => ({
      ...summary,
      net: summary.earnings - summary.spent,
    }))
    .sort((left, right) =>
      contestantName(data.contestants, left.contestantId).localeCompare(
        contestantName(data.contestants, right.contestantId),
      ),
    );
}

function contestantWinnings(data: ArenaData, events: ArenaEvent[]) {
  return new Map(
    contestantFinancials(data, events).map((summary) => [
      summary.contestantId,
      summary.earnings,
    ]),
  );
}

function registrationRows(
  data: ArenaData,
  events: ArenaEvent[],
  registrations: EventRegistration[],
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  return registrations.map((registration) => ({
    competition: eventMap.get(registration.eventId)?.name ?? "Unknown",
    contestant: contestantName(data.contestants, registration.contestantId),
    role: registration.role,
    entries: registration.entries,
    payment: registration.paid === false ? "Unpaid" : "Paid",
    checkedIn: registration.checkedIn ? "Yes" : "No",
    status: registration.status,
    notes: registration.notes || "—",
  }));
}

function statusRows(
  data: ArenaData,
  events: ArenaEvent[],
  teams: Team[],
  registrations: EventRegistration[],
  scratchesOnly: boolean,
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const registrationRows = registrations
    .filter(
      (registration) =>
        !scratchesOnly || registration.status === "scratched",
    )
    .map((registration) => ({
      competition: eventMap.get(registration.eventId)?.name ?? "Unknown",
      recordType: "Registration",
      contestantTeam: contestantName(
        data.contestants,
        registration.contestantId,
      ),
      position: registration.role,
      entries: registration.entries,
      payment: registration.paid === false ? "Unpaid" : "Paid",
      checkedIn: registration.checkedIn ? "Yes" : "No",
      status: registration.status,
      notes: registration.notes || "—",
    }));
  const teamRows = teams
    .filter(
      (team) =>
        (scratchesOnly || team.round === 1) &&
        (!scratchesOnly || team.scratched),
    )
    .map((team) => ({
      competition: eventMap.get(team.eventId)?.name ?? "Unknown",
      recordType: "Team",
      contestantTeam: `${contestantName(
        data.contestants,
        team.headerId,
      )} / ${contestantName(data.contestants, team.heelerId)}`,
      position: `Draw ${team.drawPosition}`,
      entries: 1,
      payment: team.paid === false ? "Unpaid" : "Paid",
      checkedIn: team.checkedIn ? "Yes" : "No",
      status: team.scratched ? "scratched" : team.status,
      notes: team.notes || "—",
    }));
  return [...registrationRows, ...teamRows];
}

function payoutRows(
  data: ArenaData,
  events: ArenaEvent[],
  teams: Team[],
  incentiveOnly = false,
) {
  return events.flatMap((event) => {
    const allStandings = aggregateStandings(
      event,
      teams,
      data.contestants,
    );
    const standings = allStandings.filter(
      (standing) => standing.qualified,
    );
    const financials = eventFinancials(event, data.teams, data.registrations, data.contestants);
    const payouts = calculatePayouts(
      financials.purse,
      standings.length,
      event.payoutPercentages,
    );
    const mainAwards = new Map(
      payouts.map((payout) => [
        standings[payout.place - 1].key,
        payout.amount,
      ]),
    );
    const incentives = incentiveAwards(
      event,
      allStandings,
      data.contestants,
      teams,
    );
    const displayedStandings = incentiveOnly
      ? incentives.eligible.filter((standing) =>
          incentives.awards.has(standing.key),
        )
      : standings.filter(
          (standing) =>
            mainAwards.has(standing.key) ||
            incentives.awards.has(standing.key),
        );
    return displayedStandings.map((standing) => {
      const mainPrize = mainAwards.get(standing.key) ?? 0;
      const incentive = incentives.awards.get(standing.key);
      const slideDetails = standing
        ? slideReportDetails(
            event,
            standing.headerId,
            standing.heelerId,
            data.contestants,
          )
        : null;
      return {
        competition: event.name,
        place: incentiveOnly ? (incentive?.place ?? "—") : standing.rank,
        team: standing && slideDetails
          ? event.competitionType === "slide"
            ? `${slideDetails.header} / ${slideDetails.heeler} · Team HC ${slideDetails.teamHandicap} · ${slideDetails.slideAdjustment}`
            : `${slideDetails.header} / ${slideDetails.heeler}`
          : "TBD",
        time: standing?.total ?? "—",
        prize: money(mainPrize),
        bonus: money(incentive?.amount ?? 0),
        incentives: incentive
          ? `#${incentive.place} · Team HC ${teamHandicapTotal(
              standing.headerId,
              standing.heelerId,
              data.contestants,
            )} / ${event.incentiveHandicapTotal ?? 7} · Fastest Round 1`
          : event.incentivePayouts
            ? "Not eligible"
            : "—",
        totalPaid: money(mainPrize + (incentive?.amount ?? 0)),
      };
    });
  });
}

function standingRows(data: ArenaData, events: ArenaEvent[], teams: Team[]) {
  return events.flatMap((event) => {
    const standings = aggregateStandings(event, teams, data.contestants);
    const financials = eventFinancials(event, data.teams, data.registrations, data.contestants);
    const payouts = calculatePayouts(
      financials.purse,
      standings.filter((standing) => standing.qualified).length,
      event.payoutPercentages,
    );
    return standings.map((standing) => {
      const slideDetails = slideReportDetails(
        event,
        standing.headerId,
        standing.heelerId,
        data.contestants,
      );
      return {
        competition: event.name,
        rank: standing.rank,
        header: slideDetails.header,
        heeler: slideDetails.heeler,
        teamHandicap: slideDetails.teamHandicap,
        slideAdjustment: slideDetails.slideAdjustment,
        rounds: standing.rounds,
        total: standing.rounds ? standing.total.toFixed(2) : "—",
        average: standing.rounds ? standing.average.toFixed(2) : "—",
        status: standing.qualified ? "Qualified" : "No Time",
        prize: money(payouts[standing.rank - 1]?.amount ?? 0),
      };
    });
  });
}

function stockRows(
  data: ArenaData,
  events: ArenaEvent[],
  teams: Team[],
) {
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const grouped = new Map<string, Team[]>();
  teams.forEach((team) => {
    const key = team.steerNumber || "Unassigned";
    grouped.set(key, [...(grouped.get(key) ?? []), team]);
  });
  return [...grouped.entries()].map(([steer, steerTeams]) => {
    const times = steerTeams
      .map((team) =>
        finalTime(eventMap.get(team.eventId), team, data.contestants),
      )
      .filter((time): time is number => time !== null);
    return {
      steer,
      competition: [
        ...new Set(
          steerTeams.map((team) => eventMap.get(team.eventId)?.name ?? "Unknown"),
        ),
      ].join(", "),
      runs: steerTeams.length,
      average: times.length
        ? (times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(2)
        : "—",
      fastest: times.length ? Math.min(...times).toFixed(2) : "—",
      slowest: times.length ? Math.max(...times).toFixed(2) : "—",
      barrierCalls: steerTeams.filter(
        (team) => team.barrierPenalty || team.penalties > 0,
      ).length,
    };
  });
}

const columns = {
  summary: [
    ["event", "Event"],
    ["competition", "Competition"],
    ["date", "Date"],
    ["location", "Location"],
    ["producer", "Producer"],
    ["type", "Type"],
    ["contestants", "Contestants"],
    ["entries", "Entries"],
    ["teams", "Teams"],
    ["freeRuns", "Free Runs"],
    ["runs", "Runs"],
    ["average", "Average Time"],
    ["fastest", "Fastest Time"],
    ["slowest", "Slowest Time"],
    ["entryFees", "Entry Fees"],
    ["added", "Added Money"],
    ["office", "Office Charges"],
    ["stock", "Stock Charges"],
    ["payouts", "Payouts"],
    ["balance", "Balance"],
  ],
  financial: [
    ["competition", "Competition"],
    ["entryFees", "Entry Fees"],
    ["office", "Office Charges"],
    ["stock", "Stock Charges"],
    ["producer", "Producer Fees"],
    ["added", "Added Money"],
    ["jackpot", "Jackpot Total"],
    ["incentive", "Incentive Money"],
    ["payouts", "Total Payouts"],
    ["remaining", "Remaining Funds"],
    ["refunds", "Refunds"],
    ["scratches", "Scratches"],
    ["payment", "Payment Status"],
  ],
  contestant: [
    ["name", "Name"],
    ["role", "Header / Heeler"],
    ["membership", "Membership #"],
    ["phone", "Phone"],
    ["email", "Email"],
    ["category", "Category #"],
    ["entries", "Entries"],
    ["competitions", "Competitions"],
    ["checkedIn", "Checked In"],
    ["winnings", "Winnings"],
  ],
  "contestant-financial": [
    ["name", "Contestant"],
    ["role", "Header / Heeler"],
    ["entries", "Entries"],
    ["spent", "Amount Spent"],
    ["earnings", "Amount Earned"],
    ["net", "Net"],
    ["places", "Paying Places"],
  ],
  registration: [
    ["competition", "Competition"],
    ["contestant", "Contestant"],
    ["role", "Role"],
    ["entries", "Entries"],
    ["payment", "Payment"],
    ["checkedIn", "Checked In"],
    ["status", "Status"],
    ["notes", "Notes"],
  ],
  status: [
    ["competition", "Competition"],
    ["recordType", "Record Type"],
    ["contestantTeam", "Contestant / Team"],
    ["position", "Position / Draw"],
    ["entries", "Entries"],
    ["payment", "Payment"],
    ["checkedIn", "Checked In"],
    ["status", "Status"],
    ["notes", "Notes"],
  ],
  team: [
    ["competition", "Competition"],
    ["round", "Round"],
    ["draw", "Draw"],
    ["header", "Header"],
    ["heeler", "Heeler"],
    ["teamHandicap", "Team HC"],
    ["slideAdjustment", "Slide Adjustment"],
    ["time", "Time"],
    ["status", "Result"],
    ["standing", "Standing"],
    ["earnings", "Earnings"],
  ],
  draw: [
    ["competition", "Competition"],
    ["round", "Round"],
    ["draw", "Draw Order"],
    ["teamNumber", "Team #"],
    ["header", "Header"],
    ["heeler", "Heeler"],
    ["teamHandicap", "Team HC"],
    ["slideAdjustment", "Slide Adjustment"],
    ["arenaPosition", "Arena Position"],
  ],
  results: [
    ["competition", "Competition"],
    ["round", "Round"],
    ["draw", "Draw"],
    ["header", "Header"],
    ["heeler", "Heeler"],
    ["teamHandicap", "Team HC"],
    ["slideAdjustment", "Slide Adjustment"],
    ["rawTime", "Raw Time"],
    ["penalties", "Penalty"],
    ["time", "Total Time"],
    ["status", "Result"],
    ["standing", "Rank"],
    ["earnings", "Prize"],
    ["notes", "Judge Notes"],
  ],
  standings: [
    ["competition", "Competition"],
    ["rank", "Rank"],
    ["header", "Header"],
    ["heeler", "Heeler"],
    ["teamHandicap", "Team HC"],
    ["slideAdjustment", "Slide Adjustment"],
    ["rounds", "Rounds"],
    ["total", "Total"],
    ["average", "Average"],
    ["status", "Result"],
    ["prize", "Prize"],
  ],
  payout: [
    ["competition", "Competition"],
    ["place", "Place"],
    ["team", "Team"],
    ["time", "Time"],
    ["prize", "Prize"],
    ["bonus", "Bonus"],
    ["incentives", "Incentives"],
    ["totalPaid", "Total Paid"],
  ],
  stock: [
    ["steer", "Steer #"],
    ["competition", "Competition"],
    ["runs", "Runs"],
    ["average", "Average Time"],
    ["fastest", "Fastest"],
    ["slowest", "Slowest"],
    ["barrierCalls", "Barrier Calls"],
  ],
  arena: [
    ["metric", "Arena Statistic"],
    ["value", "Value"],
  ],
} satisfies Record<ReportKind, [string, string][]>;

export function generateReport(
  data: ArenaData,
  definition: ReportDefinition,
  filters: ReportFilters,
): GeneratedReport {
  const scoped = scopedData(data, definition, filters);
  const { events } = scoped;
  let { teams, registrations } = scoped;
  if (definition.id === "competition-scratch") {
    teams = teams.filter((team) => team.scratched);
    registrations = registrations.filter(
      (registration) => registration.status === "scratched",
    );
  }
  const meet =
    data.meets.find((item) => item.id === filters.meetId) ??
    data.meets.find((item) => item.id === events[0]?.parentEventId);
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const completeTeams = teams.filter(
    (team) =>
      team.status === "complete" &&
      finalTime(eventMap.get(team.eventId), team, data.contestants) !== null,
  );
  const times = completeTeams
    .map((team) => finalTime(eventMap.get(team.eventId), team, data.contestants))
    .filter((time): time is number => time !== null);
  const financials = events.map((event) =>
    eventFinancials(event, data.teams, data.registrations, data.contestants),
  );
  const totals = financials.reduce(
    (result, item) => ({
      entries: result.entries + item.entries,
      collected: result.collected + item.collected,
      office: result.office + item.office,
      stock: result.stock + item.stock,
      producer: result.producer + item.producer,
      added: result.added + item.added,
      incentive: result.incentive + item.totalIncentivePayouts,
      purse: result.purse + item.purse,
      payouts:
        result.payouts + item.totalPayouts + item.totalIncentivePayouts,
      remaining: result.remaining + item.remaining,
    }),
    {
      entries: 0,
      collected: 0,
      office: 0,
      stock: 0,
      producer: 0,
      added: 0,
      incentive: 0,
      purse: 0,
      payouts: 0,
      remaining: 0,
    },
  );

  let rows: ReportRow[];
  if (definition.kind === "summary") {
    rows = events.map((event) => {
      const eventTeams = data.teams.filter((team) => team.eventId === event.id);
      const eventTimes = eventTeams
        .map((team) => finalTime(event, team, data.contestants))
        .filter((time): time is number => time !== null);
      const eventFinance = eventFinancials(
        event,
        data.teams,
        data.registrations,
        data.contestants,
      );
      const eventContestants = new Set(
        eventTeams.flatMap((team) => [team.headerId, team.heelerId]),
      );
      data.registrations
        .filter((registration) => registration.eventId === event.id)
        .forEach((registration) =>
          eventContestants.add(registration.contestantId),
        );
      const parent = data.meets.find((meet) => meet.id === event.parentEventId);
      return {
        event: parent?.name ?? "Unknown",
        competition: event.name,
        date: event.date,
        location: event.location,
        producer: parent?.producer ?? "—",
        type: competitionName(event.competitionType),
        contestants: eventContestants.size || data.contestants.length,
        entries: eventFinance.entries,
        teams: eventTeams.filter((team) => team.round === 1).length,
        freeRuns: eventTeams
          .filter((team) => team.round === 1)
          .reduce(
            (count, team) =>
              count +
              Number(Boolean(team.headerFreeRun)) +
              Number(Boolean(team.heelerFreeRun)),
            0,
          ),
        runs: eventTeams.length,
        average: eventTimes.length
          ? (
              eventTimes.reduce((sum, time) => sum + time, 0) /
              eventTimes.length
            ).toFixed(2)
          : "—",
        fastest: eventTimes.length ? Math.min(...eventTimes).toFixed(2) : "—",
        slowest: eventTimes.length ? Math.max(...eventTimes).toFixed(2) : "—",
        entryFees: money(eventFinance.collected),
        added: money(eventFinance.added),
        office: money(eventFinance.office),
        stock: money(eventFinance.stock),
        payouts: money(
          eventFinance.totalPayouts + eventFinance.totalIncentivePayouts,
        ),
        balance: money(eventFinance.remaining),
      };
    });
  } else if (definition.kind === "financial") {
    rows = events.map((event) => {
      const item = eventFinancials(event, data.teams, data.registrations, data.contestants);
      const eventRegistrations = data.registrations.filter(
        (registration) => registration.eventId === event.id,
      );
      return {
        competition: event.name,
        entryFees: money(item.collected),
        office: money(item.office),
        stock: money(item.stock),
        producer: money(item.producer),
        added: money(item.added),
        jackpot: money(item.purse),
        incentive: money(item.totalIncentivePayouts),
        payouts: money(item.totalPayouts + item.totalIncentivePayouts),
        remaining: money(item.remaining),
        refunds: money(0),
        scratches:
          data.teams.filter(
            (team) => team.eventId === event.id && team.scratched,
          ).length +
          eventRegistrations.filter(
            (registration) => registration.status === "scratched",
          ).length,
        payment: eventRegistrations.some(
          (registration) => registration.paid === false,
        )
          ? "Payment Due"
          : "Paid",
      };
    });
    rows.push({
      competition: "TOTAL",
      entryFees: money(totals.collected),
      office: money(totals.office),
      stock: money(totals.stock),
      producer: money(totals.producer),
      added: money(totals.added),
      jackpot: money(totals.purse),
      incentive: money(totals.incentive),
      payouts: money(totals.payouts),
      remaining: money(totals.remaining),
      refunds: money(0),
      scratches: rows.reduce(
        (sum, row) => sum + Number(row.scratches ?? 0),
        0,
      ),
      payment: "Subtotal",
    });
  } else if (definition.kind === "contestant") {
    rows = contestantRows(data, events, teams, registrations, filters);
  } else if (definition.kind === "contestant-financial") {
    rows = contestantFinancials(data, events).map((summary) => {
      const contestant = data.contestants.find(
        (item) => item.id === summary.contestantId,
      );
      return {
        name: contestant?.name ?? "Unknown",
        role: contestant?.role ?? "—",
        entries: summary.entries,
        spent: money(summary.spent),
        earnings: money(summary.earnings),
        net: money(summary.net),
        places: summary.places.join(", ") || "—",
      };
    });
  } else if (definition.kind === "registration") {
    rows = registrationRows(data, events, registrations);
  } else if (definition.kind === "status") {
    rows = statusRows(
      data,
      events,
      teams,
      registrations,
      definition.id === "competition-scratch",
    );
  } else if (definition.kind === "team") {
    rows = teamRows(data, events, teams, true);
  } else if (definition.kind === "draw") {
    rows = teamRows(data, events, teams, false);
  } else if (definition.kind === "results") {
    rows = teamRows(data, events, teams, true);
  } else if (definition.kind === "standings") {
    rows = standingRows(data, events, teams);
  } else if (definition.kind === "payout") {
    rows = payoutRows(
      data,
      events,
      teams,
      definition.id === "competition-incentive",
    );
  } else if (definition.kind === "stock") {
    rows = stockRows(data, events, teams);
  } else {
    rows = [
      { metric: "Total Runs", value: teams.length },
      {
        metric: "Clean Runs",
        value: completeTeams.filter((team) => team.penalties === 0).length,
      },
      {
        metric: "No Times",
        value: teams.filter((team) => team.status === "no-time").length,
      },
      {
        metric: "Barrier Penalties",
        value: teams.filter(
          (team) => team.barrierPenalty || team.penalties > 0,
        ).length,
      },
      {
        metric: "Average Time",
        value: times.length
          ? (times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(2)
          : "—",
      },
      {
        metric: "Fastest Run",
        value: times.length ? Math.min(...times).toFixed(2) : "—",
      },
      {
        metric: "Slowest Run",
        value: times.length ? Math.max(...times).toFixed(2) : "—",
      },
    ];
  }

  const search = filters.search.trim().toLowerCase();
  if (search) {
    rows = rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value).toLowerCase().includes(search),
      ),
    );
  }

  const uniqueContestants = new Set(
    teams.flatMap((team) => [team.headerId, team.heelerId]),
  );
  registrations.forEach((registration) =>
    uniqueContestants.add(registration.contestantId),
  );
  const totalContestants =
    uniqueContestants.size ||
    (definition.section === "event" ? data.contestants.length : 0);
  const average = times.length
    ? times.reduce((sum, time) => sum + time, 0) / times.length
    : 0;

  return {
    definition,
    eventName: meet?.name ?? "All Events",
    competitionName:
      definition.section === "competition"
        ? eventMap.get(filters.competitionId)?.name ?? "Competition"
        : events.length === 1
          ? events[0].name
          : "All Competitions",
    columns: columns[definition.kind].map(([key, label]) => ({ key, label })),
    rows,
    metrics: [
      { label: "Competitions", value: String(events.length), numericValue: events.length },
      { label: "Contestants", value: String(totalContestants), numericValue: totalContestants },
      { label: "Entries", value: String(totals.entries), numericValue: totals.entries },
      { label: "Teams", value: String(teams.filter((team) => team.round === 1).length), numericValue: teams.length },
      { label: "Runs", value: String(teams.length), numericValue: teams.length },
      { label: "Average Time", value: average ? average.toFixed(2) : "—", numericValue: average },
      { label: "Fastest Time", value: times.length ? Math.min(...times).toFixed(2) : "—", numericValue: times.length ? Math.min(...times) : 0 },
      { label: "Entry Fees", value: money(totals.collected), numericValue: totals.collected },
      { label: "Total Payouts", value: money(totals.payouts), numericValue: totals.payouts },
      { label: "Remaining Funds", value: money(totals.remaining), numericValue: totals.remaining },
    ],
    generatedAt: new Date().toISOString(),
  };
}

export function reportFileName(report: GeneratedReport, extension: string) {
  const slug = `${report.eventName}-${report.definition.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "arena-report"}.${extension}`;
}

export function canExportReports(role: ReportRole) {
  return role !== "Read-Only User";
}

export function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
