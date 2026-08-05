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
];

export const competitionName = (type: CompetitionType) =>
  competitionTypes.find((item) => item.id === type)?.name ?? "Competition";

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
  pickDrawRole: "heeler" as PickDrawRole,
  registrationOpen: true,
  drawLocked: false,
  resultsPublished: false,
  entriesAllowed: 1,
  minDrawsAllowed: 0,
  allowRepeatPartners: false,
  handicapTotal: 99,
  maxContestantHandicap: 99,
  timeLimit: 30,
  rounds: 1,
  shortGoTeams: 0,
  progressiveAfterRound: 0,
  addedMoney: 0,
  incentivePayouts: false,
  officeCharge: 0,
  stockCharge: 0,
  producerFeePercent: 0,
  payoutPercentages: [50, 30, 20],
  drawHistory: [],
};

const shuffle = <T,>(items: T[]) =>
  items
    .map((item) => ({ item, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ item }) => item);

const pairKey = (headerId: string, heelerId: string) => `${headerId}|${heelerId}`;

export function teamHandicapTotal(
  headerId: string,
  heelerId: string,
  contestants: Contestant[],
) {
  const header = contestants.find((contestant) => contestant.id === headerId);
  const heeler = contestants.find((contestant) => contestant.id === heelerId);
  return (header?.headerHandicap ?? 0) + (heeler?.heelerHandicap ?? 0);
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
  return canRope && handicap <= (event.maxContestantHandicap ?? 99);
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
          freeRun: false,
        })),
      );
  const heelerEntries =
    active
      .filter((entry) => entry.role === "Heeler")
      .flatMap((entry) =>
        Array.from({ length: entry.entries }, (_, index) => ({
          contestantId: entry.contestantId,
          entryNumber: index + 1,
          freeRun: false,
        })),
      );
  if (!headerEntries.length || !heelerEntries.length) return [];

  const used = new Set<string>();
  const teams: Team[] = [];
  type DrawPair = {
    header: (typeof headerEntries)[number];
    heeler: (typeof heelerEntries)[number];
  };

  for (let roundIndex = 0; roundIndex < 1; roundIndex += 1) {
    const count = Math.max(headerEntries.length, heelerEntries.length);
    const expandPool = <T extends { freeRun: boolean }>(pool: T[]) => {
      const shuffled = shuffle([...pool]);
      return Array.from({ length: count }, (_, index) =>
        index < shuffled.length
          ? shuffled[index]
          : { ...shuffled[index % shuffled.length], freeRun: true },
      );
    };
    let completedPairs: DrawPair[] | null = null;
    let bestPairs: DrawPair[] = [];

    for (let attempt = 0; attempt < 100 && !completedPairs; attempt += 1) {
      const headers = shuffle(expandPool(headerEntries));
      const heelers = shuffle(expandPool(heelerEntries));
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
      ));
    });
    }
  return teams;
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
  }));
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
      })),
    );
  const heelers = activeDrawEntries
    .filter((registration) => registration.role === "Heeler")
    .flatMap((registration) =>
      Array.from({ length: registration.entries }, (_, index) => ({
        contestantId: registration.contestantId,
        entryNumber: index + 1,
      })),
    );
  const used = new Set(baseTeams.map((team) => pairKey(team.headerId, team.heelerId)));
  const generated: Team[] = [];

  const pickCandidate = (
    slotId: string,
    candidates: { headerId: string; heelerId: string }[],
  ) => {
    const eligible = candidates.filter(({ headerId, heelerId }) =>
      eligiblePair(event, headerId, heelerId, contestants),
    );
    return (
      shuffle(eligible).find(
        ({ headerId, heelerId }) => !used.has(pairKey(headerId, heelerId)),
      ) ?? (event.allowRepeatPartners
        ? shuffle(eligible).find(
            ({ headerId, heelerId }) =>
              headerId === slotId || heelerId === slotId,
          )
        : undefined)
    );
  };

  if (event.pickDrawRole === "heeler") {
    shuffle(heelers).forEach((slot) => {
      const partner = pickCandidate(
        slot.contestantId,
        baseTeams.map((team) => ({
          headerId: team.headerId,
          heelerId: slot.contestantId,
        })),
      );
      if (!partner) return;
      used.add(pairKey(partner.headerId, partner.heelerId));
      generated.push(
        newTeam(
          event.id,
          partner.headerId,
          partner.heelerId,
          baseTeams.length + generated.length + 1,
          1,
          1,
          slot.entryNumber,
        ),
      );
    });
  } else if (event.pickDrawRole === "header") {
    shuffle(headers).forEach((slot) => {
      const partner = pickCandidate(
        slot.contestantId,
        baseTeams.map((team) => ({
          headerId: slot.contestantId,
          heelerId: team.heelerId,
        })),
      );
      if (!partner) return;
      used.add(pairKey(partner.headerId, partner.heelerId));
      generated.push(
        newTeam(
          event.id,
          partner.headerId,
          partner.heelerId,
          baseTeams.length + generated.length + 1,
          1,
          slot.entryNumber,
          1,
        ),
      );
    });
  } else if (headers.length && heelers.length) {
    const count = Math.max(headers.length, heelers.length);
    type DrawEntry = (typeof headers)[number] & { freeRun: boolean };
    type DrawPair = { header: DrawEntry; heeler: DrawEntry };
    const expandPool = (pool: (typeof headers)[number][]) => {
      const randomized = shuffle(pool).map((entry) => ({
        ...entry,
        freeRun: false,
      }));
      return Array.from({ length: count }, (_, index) =>
        index < randomized.length
          ? randomized[index]
          : {
              ...randomized[index % randomized.length],
              freeRun: true,
            },
      );
    };
    let completedPairs: DrawPair[] | null = null;

    for (let attempt = 0; attempt < 250 && !completedPairs; attempt += 1) {
      const availableHeaders = shuffle(expandPool(headers));
      const availableHeelers = shuffle(expandPool(heelers));
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
        ),
      );
    });
  }
  return [...generated, ...baseTeams].map((team, index) => ({
    ...team,
    drawPosition: index + 1,
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
        }));
      }),
  );

  return shuffle(pairings).map((pair, index) =>
    newTeam(
      event.id,
      pair.headerId,
      pair.heelerId,
      index + 1,
      1,
      pair.entryNumber,
      pair.entryNumber,
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
  return shuffle(baseTeams).map((team, index) => ({
    ...team,
    drawPosition: index + 1,
    round: 1,
    status: "ready" as const,
    rawTime: null,
    penalties: 0,
    points: 0,
  }));
}

export function calculatePurse(event: ArenaEvent, teamCount: number) {
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
    round: nextRound,
    status: "ready",
    rawTime: null,
    penalties: 0,
    notes: "",
    checkedIn: false,
    generated: true,
    points: 0,
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

function syncShortGoFinalists(
  teams: Team[],
  eventId: string,
  maxRounds: number,
  shortGoTeams: number,
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
          (sum, team) => sum + (team.rawTime ?? 0) + team.penalties,
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
  return [
    ...withoutReadyFinalists,
    ...finalists.map(({ qualifier }, index) => ({
      ...qualifier,
      id: `team-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      drawPosition: index + 1,
      round: finalRound,
      status: "ready" as const,
      rawTime: null,
      penalties: 0,
      notes: "",
      checkedIn: false,
      generated: true,
      points: 0,
    })),
  ];
}

export function reconcileQualifiedAdvancements(
  teams: Team[],
  events: ArenaEvent[],
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
        ),
      currentTeams,
    );
  }, teams);
}
