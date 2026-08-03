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

export const defaultCompetitionSettings = {
  competitionType: "pick-only" as CompetitionType,
  pickDrawRole: "heeler" as PickDrawRole,
  registrationOpen: true,
  drawLocked: false,
  resultsPublished: false,
  entriesAllowed: 1,
  handicapTotal: 99,
  timeLimit: 30,
  rounds: 1,
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

function eligiblePair(
  event: ArenaEvent,
  headerId: string,
  heelerId: string,
  contestants: Contestant[],
) {
  return (
    headerId !== heelerId &&
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
      entry.paid !== false,
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
        if (heelerIndex < 0) {
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

      if (!failed) completedPairs = pairs;
    }

    if (!completedPairs) continue;
    completedPairs.forEach(({ header, heeler }) => {
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

function pickAndDrawTeams(
  event: ArenaEvent,
  fixedTeams: Team[],
  contestants: Contestant[],
  registrations: EventRegistration[],
) {
  const baseTeams = fixedTeams.filter((team) => team.eventId === event.id && !team.generated && !team.scratched);
  const activeDrawEntries = registrations.filter(
    (registration) =>
      registration.eventId === event.id &&
      registration.status === "entered" &&
      registration.paid !== false,
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
      ) ??
      shuffle(eligible).find(({ headerId, heelerId }) =>
        headerId === slotId || heelerId === slotId,
      )
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
    const shuffledHeaders = shuffle(headers);
    const shuffledHeelers = shuffle(heelers);
    for (let index = 0; index < count; index += 1) {
      const header = shuffledHeaders[index % shuffledHeaders.length];
      const candidates = shuffledHeelers.map((heeler) => ({
        headerId: header.contestantId,
        heelerId: heeler.contestantId,
        heeler,
      }));
      const selected =
        shuffle(candidates).find(
          (candidate) =>
            eligiblePair(event, candidate.headerId, candidate.heelerId, contestants) &&
            !used.has(pairKey(candidate.headerId, candidate.heelerId)),
        ) ??
        shuffle(candidates).find((candidate) =>
          eligiblePair(event, candidate.headerId, candidate.heelerId, contestants),
        );
      if (!selected) continue;
      used.add(pairKey(selected.headerId, selected.heelerId));
      generated.push(
        newTeam(
          event.id,
          selected.headerId,
          selected.heelerId,
          baseTeams.length + generated.length + 1,
          1,
          header.entryNumber,
          selected.heeler.entryNumber,
          index >= headers.length,
          index >= heelers.length,
        ),
      );
    }
  }
  return [...baseTeams, ...generated].map((team, index) => ({ ...team, drawPosition: index + 1 }));
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
      registration.paid !== false,
  );
  const headerIds = [...new Set(
    active
      .filter((registration) => registration.role === "Header")
      .map((registration) => registration.contestantId),
  )];
  const heelerIds = [...new Set(
    active
      .filter((registration) => registration.role === "Heeler")
      .map((registration) => registration.contestantId),
  )];
  const pairings = headerIds.flatMap((header) =>
    heelerIds
      .filter((heelerId) => eligiblePair(event, header, heelerId, contestants))
      .map((heelerId) => ({ headerId: header, heelerId })),
  );

  return shuffle(pairings).map((pair, index) =>
    newTeam(event.id, pair.headerId, pair.heelerId, index + 1),
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
    (team) => team.eventId === event.id && !team.generated && !team.scratched,
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
    team.heelerId === source.heelerId;

  if (!qualified) {
    return nextTeams.filter(
      (team) => !(sameTeam(team) && team.round > source.round),
    );
  }

  if (
    source.round >= maxRounds ||
    nextTeams.some((team) => sameTeam(team) && team.round === source.round + 1)
  ) {
    return nextTeams;
  }

  const nextRound = source.round + 1;
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
        ),
      currentTeams,
    );
  }, teams);
}
