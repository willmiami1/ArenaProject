import type {
  ArenaEvent,
  CompetitionType,
  Contestant,
  EventRegistration,
  PickDrawRole,
  Team,
} from "./types";

export const competitionTypes: {
  id: CompetitionType;
  name: string;
  setupTime: string;
  description: string;
  features: string[];
}[] = [
  {
    id: "draw-pot",
    name: "Draw Pot",
    setupTime: "5-10 min",
    description: "Headers and heelers enter individually, then partners are assigned at random.",
    features: ["Random partners", "Multiple entries", "Scratch and redraw"],
  },
  {
    id: "pick-only",
    name: "Pick Only",
    setupTime: "3-5 min",
    description: "Contestants enter as complete teams and keep the same partner throughout.",
    features: ["Fixed teams", "Duplicate prevention", "Team check-in"],
  },
  {
    id: "pick-and-draw",
    name: "Pick and Draw",
    setupTime: "8-12 min",
    description: "Each chosen team receives an additional randomly assigned partner.",
    features: ["Chosen partners", "Configurable draw role", "Scratch replacement"],
  },
  {
    id: "round-robin",
    name: "Round Robin",
    setupTime: "10-15 min",
    description: "Automatically rotate eligible contestants through every unique matchup.",
    features: ["Full rotation", "Cumulative points", "Automatic schedule"],
  },
  {
    id: "slide",
    name: "Slide",
    setupTime: "3-5 min",
    description:
      "Fixed teams receive a handicap-based time adjustment in Round 2.",
    features: ["Fixed teams", "Round 2 adjustment", "Four-second cap"],
  },
];

export const competitionName = (type: CompetitionType) =>
  competitionTypes.find((item) => item.id === type)?.name ?? "Competition";

export const minimumDrawEntries = (
  event: Pick<ArenaEvent, "minDrawsAllowed">,
) => Math.max(1, Number(event.minDrawsAllowed ?? 0));

export function reconcilePickDrawRegistrations(
  registrations: EventRegistration[],
  _teams: Team[],
  events: ArenaEvent[],
) {
  const pickAndDrawIds = new Set(
    events
      .filter((event) => event.competitionType === "pick-and-draw")
      .map((event) => event.id),
  );
  return registrations.filter(
    (registration) =>
      !registration.sourceTeamId ||
      !pickAndDrawIds.has(registration.eventId),
  );
}

export const defaultCompetitionSettings = {
  competitionType: "pick-only" as CompetitionType,
  pickDrawRole: "both" as PickDrawRole,
  registrationOpen: true,
  drawLocked: false,
  resultsPublished: false,
  entriesAllowed: 1,
  minDrawsAllowed: 0,
  allowRepeatPartners: false,
  allowSamePartnerDrawAndPick: false,
  handicapTotal: 20,
  slideNumber: 10,
  slideRulesEnabled: false,
  maxContestantHandicap: 10,
  timeLimit: 30,
  rounds: 1,
  shortGoTeams: 0,
  progressiveAfterRound: 0,
  addedMoney: 0,
  incentivePayouts: false,
  incentiveHandicapTotal: 7,
  incentiveTeams: 1,
  incentiveAmountPerTeam: 0,
  officeCharge: 0,
  stockCharge: 0,
  producerFeePercent: 0,
  payoutPercentages: [50, 30, 20],
  drawHistory: [],
};

export interface PayoutFormulaTier {
  minTeams: number;
  maxTeams: number | null;
  payoutPercent: number;
  percentages: number[];
}

// Standard payoff chart: the paying-team count sets both the share of the
// pot that is paid out and how the payout splits across places.
export const PAYOUT_FORMULA_TIERS: PayoutFormulaTier[] = [
  { minTeams: 1, maxTeams: 49, payoutPercent: 40, percentages: [60, 40] },
  { minTeams: 50, maxTeams: 99, payoutPercent: 50, percentages: [50, 30, 20] },
  { minTeams: 100, maxTeams: 124, payoutPercent: 55, percentages: [40, 30, 20, 10] },
  { minTeams: 125, maxTeams: 149, payoutPercent: 60, percentages: [33, 26, 20, 14, 7] },
  { minTeams: 150, maxTeams: 199, payoutPercent: 65, percentages: [30, 24, 18, 12, 9, 7] },
  { minTeams: 200, maxTeams: 249, payoutPercent: 70, percentages: [25, 20, 15, 12, 10, 8, 6, 4] },
  { minTeams: 250, maxTeams: null, payoutPercent: 75, percentages: [20, 16, 14, 10, 9, 8, 7, 6, 5, 4] },
];

export function payoutFormulaTier(payingTeams: number): PayoutFormulaTier {
  return (
    [...PAYOUT_FORMULA_TIERS]
      .reverse()
      .find((tier) => payingTeams >= tier.minTeams) ?? PAYOUT_FORMULA_TIERS[0]
  );
}

export function eventPayoutPercentages(
  event: ArenaEvent | undefined,
  payingTeams: number,
) {
  if (!event) return [50, 30, 20];
  if (event.payoutMode === "formula") {
    return payoutFormulaTier(payingTeams).percentages;
  }
  return event.payoutPercentages ?? [50, 30, 20];
}

// Slide rules apply to Slide competitions and to Round Robins that opt in.
export const slideRulesActive = (
  event: Pick<ArenaEvent, "competitionType" | "slideRulesEnabled">,
) =>
  event.competitionType === "slide" ||
  (event.competitionType === "round-robin" &&
    event.slideRulesEnabled === true);

export function slideTimeAdjustment(
  event: Pick<
    ArenaEvent,
    "competitionType" | "slideNumber" | "slideRulesEnabled"
  >,
  team: Pick<Team, "round" | "headerId" | "heelerId">,
  contestants: Contestant[],
) {
  if (!slideRulesActive(event) || team.round !== 2) return 0;
  const difference =
    teamHandicapTotal(team.headerId, team.heelerId, contestants) -
    Number(event.slideNumber ?? 10);
  return Math.max(-4, Math.min(4, Math.round(difference * 2) / 2));
}

export function officialRunTime(
  event: Pick<
    ArenaEvent,
    "competitionType" | "slideNumber" | "slideRulesEnabled"
  >,
  team: Pick<
    Team,
    "round" | "headerId" | "heelerId" | "rawTime" | "penalties"
  >,
  contestants: Contestant[],
) {
  if (team.rawTime === null) return null;
  return (
    team.rawTime +
    team.penalties +
    slideTimeAdjustment(event, team, contestants)
  );
}

const shuffle = <T,>(items: T[]) =>
  items
    .map((item) => ({ item, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);

const pairKey = (headerId: string, heelerId: string) => `${headerId}|${heelerId}`;

// Expands a side's entry pool to `count` slots. Extra slots become free runs
// spread as evenly as possible across distinct riders: no rider receives a
// second free run until every rider on that side has one.
const expandPoolWithFreeRuns = <T extends { contestantId: string }>(
  pool: T[],
  count: number,
): (T & { freeRun: boolean })[] => {
  const base = shuffle(pool).map((entry) => ({ ...entry, freeRun: false }));
  const extra = count - base.length;
  if (extra <= 0) return base;
  const entriesByContestant = new Map<string, typeof base>();
  base.forEach((entry) => {
    const list = entriesByContestant.get(entry.contestantId) ?? [];
    list.push(entry);
    entriesByContestant.set(entry.contestantId, list);
  });
  const contestantOrder = shuffle([...entriesByContestant.keys()]);
  const freeRuns = Array.from({ length: extra }, (_, index) => {
    const contestantId = contestantOrder[index % contestantOrder.length];
    const entries = entriesByContestant.get(contestantId)!;
    const source =
      entries[Math.floor(index / contestantOrder.length) % entries.length];
    return { ...source, freeRun: true };
  });
  return [...base, ...freeRuns];
};

function spacingQuality(teams: Team[]) {
  const lastRiderPosition = new Map<string, number>();
  const lastPairPosition = new Map<string, number>();
  let minimumGap = teams.length + 1;
  let totalGap = 0;
  let repeatCount = 0;
  teams.forEach((team, index) => {
    const position = index + 1;
    [team.headerId, team.heelerId].forEach((contestantId) => {
      const previous = lastRiderPosition.get(contestantId);
      if (previous !== undefined) {
        const gap = position - previous;
        minimumGap = Math.min(minimumGap, gap);
        totalGap += gap;
        repeatCount += 1;
      }
      lastRiderPosition.set(contestantId, position);
    });
    const key = pairKey(team.headerId, team.heelerId);
    const previousPair = lastPairPosition.get(key);
    if (previousPair !== undefined) {
      const gap = position - previousPair;
      minimumGap = Math.min(minimumGap, gap);
      totalGap += gap * 2;
      repeatCount += 1;
    }
    lastPairPosition.set(key, position);
  });
  return {
    minimumGap: repeatCount ? minimumGap : teams.length + 1,
    totalGap,
  };
}

export function spaceDrawTeamsApart(teams: Team[]) {
  if (teams.length < 3) {
    return teams.map((team, index) => ({ ...team, drawPosition: index + 1 }));
  }
  let bestOrder = teams;
  let bestQuality = spacingQuality(teams);
  const attempts = Math.min(100, Math.max(20, teams.length * 2));
  const considerOrder = (order: Team[]) => {
    const quality = spacingQuality(order);
    if (
      quality.minimumGap > bestQuality.minimumGap ||
      (quality.minimumGap === bestQuality.minimumGap &&
        quality.totalGap > bestQuality.totalGap)
    ) {
      bestOrder = [...order];
      bestQuality = quality;
    }
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = shuffle(teams);
    considerOrder(remaining);
    const ordered: Team[] = [];
    const lastRiderPosition = new Map<string, number>();
    const lastPairPosition = new Map<string, number>();

    while (remaining.length) {
      const position = ordered.length + 1;
      let bestCandidateIndex = 0;
      let bestCandidateScore = Number.NEGATIVE_INFINITY;
      remaining.forEach((team, candidateIndex) => {
        const riderDistances = [team.headerId, team.heelerId]
          .map((contestantId) => lastRiderPosition.get(contestantId))
          .filter((previous): previous is number => previous !== undefined)
          .map((previous) => position - previous);
        const previousPair = lastPairPosition.get(
          pairKey(team.headerId, team.heelerId),
        );
        const riderGap = riderDistances.length
          ? Math.min(...riderDistances)
          : teams.length + 1;
        const pairGap =
          previousPair === undefined
            ? teams.length + 1
            : position - previousPair;
        const score =
          Math.min(riderGap, pairGap) * 10000 +
          pairGap * 100 +
          riderGap +
          Math.random();
        if (score > bestCandidateScore) {
          bestCandidateScore = score;
          bestCandidateIndex = candidateIndex;
        }
      });
      const [selected] = remaining.splice(bestCandidateIndex, 1);
      ordered.push(selected);
      lastRiderPosition.set(selected.headerId, position);
      lastRiderPosition.set(selected.heelerId, position);
      lastPairPosition.set(
        pairKey(selected.headerId, selected.heelerId),
        position,
      );
    }

    considerOrder(ordered);
  }

  if (teams.length <= 8) {
    const permute = (prefix: Team[], remaining: Team[]) => {
      if (!remaining.length) {
        considerOrder(prefix);
        return;
      }
      remaining.forEach((team, index) => {
        permute(
          [...prefix, team],
          [...remaining.slice(0, index), ...remaining.slice(index + 1)],
        );
      });
    };
    permute([], teams);
  }

  return bestOrder.map((team, index) => ({
    ...team,
    drawPosition: index + 1,
  }));
}

export function teamHandicapTotal(
  headerId: string,
  heelerId: string,
  contestants: Contestant[],
) {
  const header = contestants.find((contestant) => contestant.id === headerId);
  const heeler = contestants.find((contestant) => contestant.id === heelerId);
  return (header?.headerHandicap ?? 0) + (heeler?.heelerHandicap ?? 0);
}

export function repeatPairingBlockMessage(
  event: Pick<ArenaEvent, "allowRepeatPartners" | "allowSamePartnerDrawAndPick">,
  existingPairTeams: Pick<Team, "generated">[],
  newTeamGenerated: boolean,
): string {
  if (!existingPairTeams.length || event.allowRepeatPartners) return "";
  if (event.allowSamePartnerDrawAndPick) {
    if (existingPairTeams.length > 1) {
      return "That partnership already has both of its runs (one draw and one pick).";
    }
    const existingGenerated = Boolean(existingPairTeams[0].generated);
    if (existingGenerated !== newTeamGenerated) return "";
    return existingGenerated
      ? "That partnership already has its draw run. The second run must be a picked team."
      : "That partnership already has a picked run. The second run must come from the draw.";
  }
  return "That header and heeler are already entered as a team.";
}

export function contestantEligibleForRole(
  event: ArenaEvent,
  contestant: Contestant | undefined,
  role: EventRegistration["role"],
) {
  if (!contestant) return false;
  const canRope =
    contestant.role === "Both" || contestant.role === role;
  const handicap =
    role === "Header"
      ? contestant.headerHandicap
      : contestant.heelerHandicap;
  return canRope && handicap <= (event.maxContestantHandicap ?? 10);
}

function eligiblePair(
  event: ArenaEvent,
  headerId: string,
  heelerId: string,
  contestants: Contestant[],
) {
  const header = contestants.find((contestant) => contestant.id === headerId);
  const heeler = contestants.find((contestant) => contestant.id === heelerId);
  return (
    headerId !== heelerId &&
    contestantEligibleForRole(event, header, "Header") &&
    contestantEligibleForRole(event, heeler, "Heeler") &&
    teamHandicapTotal(headerId, heelerId, contestants) <= event.handicapTotal
  );
}

const newTeam = (
  eventId: string,
  headerId: string,
  heelerId: string,
  drawPosition: number,
  round = 1,
  headerEntryNumber = 1,
  heelerEntryNumber = 1,
  headerFreeRun = false,
  heelerFreeRun = false,
  headerHorseName?: string,
  heelerHorseName?: string,
): Team => ({
  id: `team-${Date.now()}-${drawPosition}-${Math.random().toString(36).slice(2, 6)}`,
  eventId,
  headerId,
  heelerId,
  drawPosition,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round,
  checkedIn: false,
  scratched: false,
  generated: true,
  points: 0,
  headerEntryNumber,
  heelerEntryNumber,
  headerFreeRun,
  heelerFreeRun,
  headerHorseName,
  heelerHorseName,
  paid: true,
});

function drawPotTeams(
  event: ArenaEvent,
  registrations: EventRegistration[],
  contestants: Contestant[],
) {
  const active = registrations.filter(
    (entry) =>
      entry.eventId === event.id &&
      entry.status === "entered" &&
      entryClearedForDraw(entry),
  );
  const headerEntries =
    active
      .filter((entry) => entry.role === "Header")
      .flatMap((entry) =>
        Array.from({ length: entry.entries }, (_, index) => ({
          contestantId: entry.contestantId,
          entryNumber: index + 1,
          horseName: entry.horseName,
        })),
      );
  const heelerEntries =
    active
      .filter((entry) => entry.role === "Heeler")
      .flatMap((entry) =>
        Array.from({ length: entry.entries }, (_, index) => ({
          contestantId: entry.contestantId,
          entryNumber: index + 1,
          horseName: entry.horseName,
        })),
      );
  if (!headerEntries.length || !heelerEntries.length) return [];

  const used = new Set<string>();
  const teams: Team[] = [];
  type DrawPair = {
    header: (typeof headerEntries)[number] & { freeRun: boolean };
    heeler: (typeof heelerEntries)[number] & { freeRun: boolean };
  };

  for (let roundIndex = 0; roundIndex < 1; roundIndex += 1) {
    const count = Math.max(headerEntries.length, heelerEntries.length);
    let completedPairs: DrawPair[] | null = null;
    let bestPairs: DrawPair[] = [];

    for (let attempt = 0; attempt < 100 && !completedPairs; attempt += 1) {
      const headers = shuffle(expandPoolWithFreeRuns(headerEntries, count));
      const heelers = shuffle(expandPoolWithFreeRuns(heelerEntries, count));
      const roundUsed = new Set(used);
      const pairs: DrawPair[] = [];
      let failed = false;

      for (let index = 0; index < count; index += 1) {
        const header = headers[index];
        let heelerIndex = heelers.findIndex(
          (heeler, candidateIndex) =>
            candidateIndex >= index &&
            eligiblePair(event, header.contestantId, heeler.contestantId, contestants) &&
            !roundUsed.has(pairKey(header.contestantId, heeler.contestantId)),
        );
        if (heelerIndex < 0 && event.allowRepeatPartners) {
          heelerIndex = heelers.findIndex(
            (heeler, candidateIndex) =>
              candidateIndex >= index &&
              eligiblePair(event, header.contestantId, heeler.contestantId, contestants),
          );
        }
        if (heelerIndex < 0) {
          failed = true;
          break;
        }
        [heelers[index], heelers[heelerIndex]] = [heelers[heelerIndex], heelers[index]];
        const heeler = heelers[index];
        roundUsed.add(pairKey(header.contestantId, heeler.contestantId));
        pairs.push({ header, heeler });
      }

      if (pairs.length > bestPairs.length) bestPairs = pairs;
      if (!failed) completedPairs = pairs;
    }

    const selectedPairs = completedPairs ?? bestPairs;
    if (!selectedPairs.length) continue;
    selectedPairs.forEach(({ header, heeler }) => {
      used.add(pairKey(header.contestantId, heeler.contestantId));
      teams.push(newTeam(
        event.id,
        header.contestantId,
        heeler.contestantId,
        teams.length + 1,
        roundIndex + 1,
        header.entryNumber,
        heeler.entryNumber,
        header.freeRun,
        heeler.freeRun,
        header.horseName,
        heeler.horseName,
      ));
    });
    }
  return spaceDrawTeamsApart(teams);
}

export function teamEligibleForCompetition(
  event: ArenaEvent,
  team: Pick<Team, "headerId" | "heelerId">,
  contestants: Contestant[],
) {
  return eligiblePair(event, team.headerId, team.heelerId, contestants);
}

export const entryClearedForDraw = (
  entry: Pick<Team | EventRegistration, "paid" | "paymentMethod">,
) => entry.paid !== false || entry.paymentMethod === "tab";

export function contestantHasDrawRegistration(
  registrations: EventRegistration[],
  eventId: string,
  contestantId: string,
) {
  return registrations.some(
    (registration) =>
      registration.eventId === eventId &&
      registration.contestantId === contestantId &&
      !registration.sourceTeamId &&
      registration.status === "entered" &&
      registration.entries > 0,
  );
}

export function pickedTeamRidersMissingFromDraw(
  registrations: EventRegistration[],
  eventId: string,
  team: Pick<Team, "headerId" | "heelerId">,
) {
  return [team.headerId, team.heelerId].filter(
    (contestantId) =>
      !contestantHasDrawRegistration(registrations, eventId, contestantId),
  );
}

export function reorderDraftDrawTeams(
  teams: Team[],
  movingTeamId: string,
  targetTeamId: string,
) {
  const movingIndex = teams.findIndex((team) => team.id === movingTeamId);
  const targetIndex = teams.findIndex((team) => team.id === targetTeamId);
  if (
    movingIndex < 0 ||
    targetIndex < 0 ||
    movingIndex === targetIndex ||
    Boolean(teams[movingIndex].generated) !== Boolean(teams[targetIndex].generated)
  ) {
    return teams;
  }
  const reordered = [...teams];
  const [movingTeam] = reordered.splice(movingIndex, 1);
  reordered.splice(targetIndex, 0, movingTeam);
  return reordered.map((team, index) => ({
    ...team,
    drawPosition: index + 1,
    originalTeamNumber: index + 1,
  }));
}

export function reorderRunOrderTeams(
  teams: Team[],
  movingTeamId: string,
  targetTeamId: string,
) {
  const movingTeam = teams.find((team) => team.id === movingTeamId);
  const targetTeam = teams.find((team) => team.id === targetTeamId);
  if (
    !movingTeam ||
    !targetTeam ||
    movingTeam.id === targetTeam.id ||
    movingTeam.eventId !== targetTeam.eventId ||
    movingTeam.round !== targetTeam.round ||
    movingTeam.scratched ||
    targetTeam.scratched
  ) {
    return teams;
  }
  const roundTeams = teams
    .filter(
      (team) =>
        team.eventId === movingTeam.eventId &&
        team.round === movingTeam.round &&
        !team.scratched,
    )
    .sort((a, b) => a.drawPosition - b.drawPosition);
  const positions = roundTeams.map((team) => team.drawPosition);
  const movingIndex = roundTeams.findIndex((team) => team.id === movingTeamId);
  const targetIndex = roundTeams.findIndex((team) => team.id === targetTeamId);
  const reordered = [...roundTeams];
  const [moved] = reordered.splice(movingIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  const nextPositions = new Map(
    reordered.map((team, index) => [team.id, positions[index]]),
  );
  return teams.map((team) => {
    const drawPosition = nextPositions.get(team.id);
    return drawPosition === undefined || drawPosition === team.drawPosition
      ? team
      : { ...team, drawPosition };
  });
}

export function repeatedTeamPairKeys(teams: Team[]) {
  const pairCounts = teams
    .filter((team) => team.round === 1 && !team.scratched)
    .reduce((counts, team) => {
      const key = pairKey(team.headerId, team.heelerId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map<string, number>());
  return new Set(
    [...pairCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key),
  );
}

function pickAndDrawTeams(
  event: ArenaEvent,
  fixedTeams: Team[],
  contestants: Contestant[],
  registrations: EventRegistration[],
) {
  const baseTeams = fixedTeams.filter(
    (team) =>
      team.eventId === event.id &&
      !team.generated &&
      !team.scratched &&
      entryClearedForDraw(team) &&
      pickedTeamRidersMissingFromDraw(
        registrations,
        event.id,
        team,
      ).length === 0 &&
      teamEligibleForCompetition(event, team, contestants),
  );
  const activeDrawEntries = registrations.filter(
    (registration) =>
      registration.eventId === event.id &&
      registration.status === "entered" &&
      !registration.sourceTeamId &&
      entryClearedForDraw(registration),
  );
  const headers = activeDrawEntries
    .filter((registration) => registration.role === "Header")
    .flatMap((registration) =>
      Array.from({ length: registration.entries }, (_, index) => ({
        contestantId: registration.contestantId,
        entryNumber: index + 1,
        horseName: registration.horseName,
      })),
    );
  const heelers = activeDrawEntries
    .filter((registration) => registration.role === "Heeler")
    .flatMap((registration) =>
      Array.from({ length: registration.entries }, (_, index) => ({
        contestantId: registration.contestantId,
        entryNumber: index + 1,
        horseName: registration.horseName,
      })),
    );
  const used = new Set(baseTeams.map((team) => pairKey(team.headerId, team.heelerId)));
  const generated: Team[] = [];

  if (headers.length && heelers.length) {
    const count = Math.max(headers.length, heelers.length);
    type DrawEntry = (typeof headers)[number] & { freeRun: boolean };
    type DrawPair = { header: DrawEntry; heeler: DrawEntry };
    let completedPairs: DrawPair[] | null = null;

    for (let attempt = 0; attempt < 250 && !completedPairs; attempt += 1) {
      const availableHeaders = shuffle(expandPoolWithFreeRuns(headers, count));
      const availableHeelers = shuffle(expandPoolWithFreeRuns(heelers, count));
      const attemptUsed = new Set(used);
      const pairs: DrawPair[] = [];

      for (let index = 0; index < count; index += 1) {
        const header = availableHeaders[index];
        let selectedIndex = availableHeelers.findIndex(
          (heeler, candidateIndex) =>
            candidateIndex >= index &&
            eligiblePair(
              event,
              header.contestantId,
              heeler.contestantId,
              contestants,
            ) &&
            !attemptUsed.has(
              pairKey(header.contestantId, heeler.contestantId),
            ),
        );
        if (selectedIndex < 0 && event.allowRepeatPartners) {
          selectedIndex = availableHeelers.findIndex(
            (heeler, candidateIndex) =>
              candidateIndex >= index &&
              eligiblePair(
                event,
                header.contestantId,
                heeler.contestantId,
                contestants,
              ),
          );
        }
        if (selectedIndex < 0) break;

        [availableHeelers[index], availableHeelers[selectedIndex]] = [
          availableHeelers[selectedIndex],
          availableHeelers[index],
        ];
        const heeler = availableHeelers[index];
        attemptUsed.add(pairKey(header.contestantId, heeler.contestantId));
        pairs.push({ header, heeler });
      }
      if (pairs.length === count) completedPairs = pairs;
    }

    completedPairs?.forEach(({ header, heeler }) => {
      used.add(pairKey(header.contestantId, heeler.contestantId));
      generated.push(
        newTeam(
          event.id,
          header.contestantId,
          heeler.contestantId,
          baseTeams.length + generated.length + 1,
          1,
          header.entryNumber,
          heeler.entryNumber,
          header.freeRun,
          heeler.freeRun,
          header.horseName,
          heeler.horseName,
        ),
      );
    });
  }
  return [
    ...spaceDrawTeamsApart(generated),
    ...spaceDrawTeamsApart(baseTeams),
  ].map((team, index) => ({
    ...team,
    drawPosition: index + 1,
    originalTeamNumber: index + 1,
  }));
}

function roundRobinTeams(
  event: ArenaEvent,
  contestants: Contestant[],
  registrations: EventRegistration[],
) {
  const active = registrations.filter(
    (registration) =>
      registration.eventId === event.id &&
      registration.status === "entered" &&
      entryClearedForDraw(registration),
  );
  const headerEntries = active.filter(
    (registration) => registration.role === "Header",
  );
  const heelerEntries = active.filter(
    (registration) => registration.role === "Heeler",
  );
  const pairings = headerEntries.flatMap((header) =>
    heelerEntries
      .filter((heeler) =>
        eligiblePair(
          event,
          header.contestantId,
          heeler.contestantId,
          contestants,
        ),
      )
      .flatMap((heeler) => {
        const runs = event.allowRepeatPartners
          ? Math.max(header.entries, heeler.entries)
          : 1;
        return Array.from({ length: runs }, (_, index) => ({
          headerId: header.contestantId,
          heelerId: heeler.contestantId,
          entryNumber: index + 1,
          headerHorseName: header.horseName,
          heelerHorseName: heeler.horseName,
        }));
      }),
  );

  return spaceDrawTeamsApart(
    shuffle(pairings).map((pair, index) =>
      newTeam(
        event.id,
        pair.headerId,
        pair.heelerId,
        index + 1,
        1,
        pair.entryNumber,
        pair.entryNumber,
        false,
        false,
        pair.headerHorseName,
        pair.heelerHorseName,
      ),
    ),
  );
}

export function generateCompetitionDraw(
  event: ArenaEvent,
  registrations: EventRegistration[],
  teams: Team[],
  contestants: Contestant[],
) {
  if (event.competitionType === "draw-pot") {
    return drawPotTeams(event, registrations, contestants);
  }
  if (event.competitionType === "pick-and-draw") {
    return pickAndDrawTeams(event, teams, contestants, registrations);
  }
  if (event.competitionType === "round-robin") {
    return roundRobinTeams(event, contestants, registrations);
  }
  const baseTeams = teams.filter(
    (team) =>
      team.eventId === event.id &&
      !team.generated &&
      !team.scratched &&
      entryClearedForDraw(team) &&
      teamEligibleForCompetition(event, team, contestants),
  );
  const fixedTeams = spaceDrawTeamsApart(
    shuffle(baseTeams).map((team) => ({
      ...team,
      round: 1,
      status: "ready" as const,
      rawTime: null,
      penalties: 0,
      points: 0,
    })),
  );
  if (event.competitionType === "slide") {
    const drawTeams = drawPotTeams(event, registrations, contestants);
    return [...drawTeams, ...fixedTeams].map((team, index) => ({
      ...team,
      drawPosition: index + 1,
      originalTeamNumber: index + 1,
    }));
  }
  return fixedTeams;
}

export function calculatePurse(
  event: ArenaEvent,
  teamCount: number,
  payingTeams = teamCount,
) {
  if (event.payoutMode === "formula") {
    const tier = payoutFormulaTier(payingTeams);
    return Math.max(
      0,
      teamCount * event.entryFee * (tier.payoutPercent / 100) +
        event.addedMoney,
    );
  }
  const feeBase = Math.max(0, event.entryFee - event.officeCharge - event.stockCharge);
  const producerFee = feeBase * (event.producerFeePercent / 100);
  const payoutPerEntry = Math.max(0, feeBase - producerFee);
  return Math.max(0, teamCount * payoutPerEntry + event.addedMoney);
}

export function calculatePayouts(
  purse: number,
  qualifiedTeams: number,
  configuredPercentages = [50, 30, 20],
) {
  if (qualifiedTeams <= 0) return [];
  const configured = configuredPercentages
    .filter((percentage) => percentage > 0)
    .slice(0, qualifiedTeams);
  const total = configured.reduce((sum, percentage) => sum + percentage, 0);
  const percentages =
    qualifiedTeams === 1 || total === 0
      ? [1]
      : configured.map((percentage) => percentage / total);
  return percentages.slice(0, qualifiedTeams).map((percentage, index) => ({
    place: index + 1,
    percentage,
    amount: Math.round(purse * percentage * 100) / 100,
  }));
}

export function applyRunResult(
  teams: Team[],
  teamId: string,
  update: Partial<Team>,
  maxRounds: number,
  shortGoTeams = 0,
  event?: ArenaEvent,
  contestants: Contestant[] = [],
) {
  const source = teams.find((team) => team.id === teamId);
  if (!source) return teams;

  let nextTeams = teams.map((team) =>
    team.id === teamId ? { ...team, ...update } : team,
  );
  const qualified = update.status === "complete";
  const sameTeam = (team: Team) =>
    team.eventId === source.eventId &&
    team.headerId === source.headerId &&
    team.heelerId === source.heelerId &&
    (team.headerEntryNumber ?? 1) === (source.headerEntryNumber ?? 1) &&
    (team.heelerEntryNumber ?? 1) === (source.heelerEntryNumber ?? 1);

  if (!qualified) {
    nextTeams = nextTeams.filter(
      (team) => !(sameTeam(team) && team.round > source.round),
    );
    return syncShortGoFinalists(
      nextTeams,
      source.eventId,
      maxRounds,
      shortGoTeams,
      event,
      contestants,
    );
  }

  if (source.round >= maxRounds) return nextTeams;
  const nextRound = source.round + 1;
  if (nextRound === maxRounds) {
    return syncShortGoFinalists(
      nextTeams,
      source.eventId,
      maxRounds,
      shortGoTeams,
      event,
      contestants,
    );
  }
  if (
    nextTeams.some(
      (team) => sameTeam(team) && team.round === source.round + 1,
    )
  ) {
    return nextTeams;
  }
  const nextDrawPosition =
    nextTeams.filter(
      (team) => team.eventId === source.eventId && team.round === nextRound,
    ).length + 1;
  nextTeams.push({
    ...source,
    ...update,
    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    drawPosition: nextDrawPosition,
    originalTeamNumber: source.originalTeamNumber ?? source.drawPosition,
    round: nextRound,
    status: "ready",
    rawTime: null,
    penalties: 0,
    notes: "",
    checkedIn: false,
    generated: true,
    points: 0,
    predictionClosesAt: undefined,
  });
  return nextTeams;
}

function entryKey(team: Team) {
  return [
    team.eventId,
    team.headerId,
    team.heelerId,
    team.headerEntryNumber ?? 1,
    team.heelerEntryNumber ?? 1,
  ].join("|");
}

export function assignOriginalTeamNumbers(teams: Team[]) {
  const roundOneNumbers = new Map(
    teams
      .filter((team) => team.round === 1)
      .map((team) => [entryKey(team), team.originalTeamNumber ?? team.drawPosition]),
  );
  return teams.map((team) => ({
    ...team,
    originalTeamNumber:
      team.originalTeamNumber ??
      roundOneNumbers.get(entryKey(team)) ??
      team.drawPosition,
  }));
}

export function resetInheritedPredictionCutoffs(teams: Team[]) {
  const byEntryAndRound = new Map(
    teams.map((team) => [`${entryKey(team)}|${team.round}`, team]),
  );
  return teams.map((team) => {
    if (team.round <= 1 || !team.predictionClosesAt) return team;
    const previousRound = byEntryAndRound.get(
      `${entryKey(team)}|${team.round - 1}`,
    );
    return previousRound?.predictionClosesAt === team.predictionClosesAt
      ? { ...team, predictionClosesAt: undefined }
      : team;
  });
}

function syncShortGoFinalists(
  teams: Team[],
  eventId: string,
  maxRounds: number,
  shortGoTeams: number,
  event?: ArenaEvent,
  contestants: Contestant[] = [],
) {
  if (maxRounds < 2) return teams;

  const finalRound = maxRounds;
  const qualifierRound = finalRound - 1;
  const qualifierTeams = teams.filter(
    (team) =>
      team.eventId === eventId &&
      team.round === qualifierRound &&
      !team.scratched,
  );
  const finalTeams = teams.filter(
    (team) => team.eventId === eventId && team.round === finalRound,
  );
  if (
    !qualifierTeams.length ||
    qualifierTeams.some((team) => team.status === "ready") ||
    finalTeams.some((team) => team.status !== "ready" || team.rawTime !== null)
  ) {
    return teams;
  }

  const finalists = qualifierTeams
    .filter((team) => team.status === "complete" && team.rawTime !== null)
    .map((qualifier) => {
      const key = entryKey(qualifier);
      const completedRounds = teams.filter(
        (team) =>
          entryKey(team) === key &&
          team.round <= qualifierRound &&
          team.status === "complete" &&
          team.rawTime !== null,
      );
      return {
        qualifier,
        total: completedRounds.reduce(
          (sum, team) =>
            sum +
            (event
              ? (officialRunTime(event, team, contestants) ?? 0)
              : (team.rawTime ?? 0) + team.penalties),
          0,
        ),
      };
    })
    .sort(
      (a, b) =>
        a.total - b.total ||
        a.qualifier.drawPosition - b.qualifier.drawPosition,
    )
    .slice(0, shortGoTeams > 0 ? shortGoTeams : undefined)
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.qualifier.drawPosition - b.qualifier.drawPosition,
    );

  const withoutReadyFinalists = teams.filter(
    (team) =>
      !(
        team.eventId === eventId &&
        team.round === finalRound &&
        team.status === "ready"
      ),
  );
  const existingFinalists = new Map(
    finalTeams.map((team) => [entryKey(team), team]),
  );
  return [
    ...withoutReadyFinalists,
    ...finalists.map(({ qualifier }, index) => {
      const existing = existingFinalists.get(entryKey(qualifier));
      return {
        ...qualifier,
        ...existing,
        id:
          existing?.id ??
          `team-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        drawPosition: index + 1,
        // Final-round teams are renumbered by standings: slowest qualifier
        // ropes first as the highest number, fastest ropes last as Team #1.
        originalTeamNumber: finalists.length - index,
        round: finalRound,
        status: "ready" as const,
        rawTime: null,
        penalties: 0,
        notes: existing?.notes ?? "",
        checkedIn: existing?.checkedIn ?? false,
        generated: true,
        points: 0,
        predictionClosesAt: existing?.predictionClosesAt,
        rolled: existing?.rolled,
      };
    }),
  ];
}

export function reconcileQualifiedAdvancements(
  teams: Team[],
  events: ArenaEvent[],
  contestants: Contestant[] = [],
) {
  return events.reduce((currentTeams, event) => {
    const completed = currentTeams
      .filter(
        (team) =>
          team.eventId === event.id &&
          team.status === "complete" &&
          team.rawTime !== null,
      )
      .sort((a, b) => a.round - b.round);

    return completed.reduce(
      (eventTeams, team) =>
        applyRunResult(
          eventTeams,
          team.id,
          {
            status: team.status,
            rawTime: team.rawTime,
            penalties: team.penalties,
            points: team.points,
          },
          event.rounds,
          event.shortGoTeams,
          event,
          contestants,
        ),
      currentTeams,
    );
  }, teams);
}
