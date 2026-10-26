import { contestantEligibleForRole, teamHandicapTotal } from "./competition";
import type { ArenaEvent, Contestant, EventRegistration, Team } from "./types";

export const TEST_TEAM_MIN = 1;
export const TEST_TEAM_MAX = 500;

type Role = EventRegistration["role"];

export interface GeneratedTestEntries {
  registrations: EventRegistration[];
  teams: Team[];
  message: string;
}

const shuffle = <T>(items: T[], random: () => number) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};

const plural = (count: number, word: string, many = `${word}s`) =>
  `${count} ${count === 1 ? word : many}`;

/**
 * Builds throwaway entries for a test roping from riders already in the database.
 * Draw-pool formats get one registration per rider on each side; pick-only
 * formats get picked teams. Riders already entered on a side are skipped.
 */
export function generateTestEntries(
  event: ArenaEvent,
  contestants: Contestant[],
  registrations: EventRegistration[],
  teams: Team[],
  requestedCount: number,
  makeId: (prefix: string) => string,
  random: () => number = Math.random,
): GeneratedTestEntries {
  const count = Math.min(
    TEST_TEAM_MAX,
    Math.max(TEST_TEAM_MIN, Math.floor(Number(requestedCount) || 0)),
  );
  const eligible = (role: Role) =>
    contestants.filter((contestant) =>
      contestantEligibleForRole(event, contestant, role),
    );
  const usesDrawPool =
    event.competitionType === "draw-pot" ||
    event.competitionType === "round-robin" ||
    event.competitionType === "pick-and-draw" ||
    event.competitionType === "slide";

  if (usesDrawPool) {
    const alreadyEntered = (role: Role) =>
      new Set(
        registrations
          .filter(
            (entry) =>
              entry.eventId === event.id &&
              entry.role === role &&
              !entry.sourceTeamId &&
              entry.status !== "scratched",
          )
          .map((entry) => entry.contestantId),
      );
    const pick = (role: Role, avoid: Set<string>) => {
      const entered = alreadyEntered(role);
      const fresh = shuffle(
        eligible(role).filter((contestant) => !entered.has(contestant.id)),
        random,
      );
      // Prefer riders not already used on the other side so teams look real.
      const preferred = fresh.filter((contestant) => !avoid.has(contestant.id));
      const fallback = fresh.filter((contestant) => avoid.has(contestant.id));
      return [...preferred, ...fallback].slice(0, count);
    };
    const headers = pick("Header", new Set());
    const heelers = pick("Heeler", new Set(headers.map((item) => item.id)));
    const build = (
      contestant: Contestant,
      role: Role,
      entries: number,
    ): EventRegistration => ({
      id: makeId("registration"),
      eventId: event.id,
      contestantId: contestant.id,
      role,
      entries,
      checkedIn: false,
      status: "entered",
      notes: "Test entry",
      paid: true,
      source: "staff",
    });
    // Spread the requested runs across the riders; when the count is larger
    // than the rider pool, riders get more than one entry (up to the event cap).
    const maxEntries = Math.max(1, Number(event.entriesAllowed) || count);
    const spread = (riders: Contestant[], role: Role) => {
      if (!riders.length) return { entries: [] as EventRegistration[], total: 0 };
      const base = Math.min(maxEntries, Math.floor(count / riders.length));
      const extra = base < maxEntries ? count - base * riders.length : 0;
      let total = 0;
      const entries = riders.map((contestant, index) => {
        const runs = Math.max(1, base + (index < extra ? 1 : 0));
        total += runs;
        return build(contestant, role, runs);
      });
      return { entries, total };
    };
    const headerSpread = spread(headers, "Header");
    const heelerSpread = spread(heelers, "Heeler");
    const generated = [...headerSpread.entries, ...heelerSpread.entries];
    const short =
      headerSpread.total < count || heelerSpread.total < count
        ? ` Only ${headerSpread.total} header and ${heelerSpread.total} heeler entries fit with ${headers.length} eligible headers, ${heelers.length} eligible heelers and a limit of ${maxEntries} entries each.`
        : "";
    return {
      registrations: generated,
      teams: [],
      message: generated.length
        ? `Added ${plural(headerSpread.total, "header entry", "header entries")} across ${plural(headers.length, "rider")} and ${plural(heelerSpread.total, "heeler entry", "heeler entries")} across ${plural(heelers.length, "rider")}.${short}`
        : "No eligible riders are left in the database to enter.",
    };
  }

  const existingPairs = new Set(
    teams
      .filter((team) => team.eventId === event.id)
      .map((team) => `${team.headerId}|${team.heelerId}`),
  );
  const headers = shuffle(eligible("Header"), random);
  const heelers = shuffle(eligible("Heeler"), random);
  const picked: Team[] = [];
  const used = new Set<string>();
  const startPosition =
    teams.filter((team) => team.eventId === event.id).length + 1;
  const buildTeam = (header: Contestant, heeler: Contestant): Team => ({
    id: makeId("team"),
    eventId: event.id,
    headerId: header.id,
    heelerId: heeler.id,
    drawPosition: startPosition + picked.length,
    status: "ready",
    rawTime: null,
    penalties: 0,
    notes: "Test team",
    round: 1,
    checkedIn: false,
    scratched: false,
    generated: false,
    points: 0,
    headerEntryNumber: 1,
    heelerEntryNumber: 1,
    headerFreeRun: false,
    heelerFreeRun: false,
    paid: true,
  });
  outer: for (const header of headers) {
    for (const heeler of heelers) {
      if (picked.length >= count) break outer;
      if (heeler.id === header.id) continue;
      const key = `${header.id}|${heeler.id}`;
      if (existingPairs.has(key) || used.has(key)) continue;
      if (teamHandicapTotal(header.id, heeler.id, contestants) > event.handicapTotal) continue;
      used.add(key);
      picked.push(buildTeam(header, heeler));
      // Move on to the next header so the same rider is not on every team.
      continue outer;
    }
  }
  if (picked.length < count) {
    // Second pass lets headers repeat with different partners when the database is small.
    outer2: for (const header of headers) {
      for (const heeler of heelers) {
        if (picked.length >= count) break outer2;
        if (heeler.id === header.id) continue;
        const key = `${header.id}|${heeler.id}`;
        if (existingPairs.has(key) || used.has(key)) continue;
        if (teamHandicapTotal(header.id, heeler.id, contestants) > event.handicapTotal) continue;
        used.add(key);
        picked.push(buildTeam(header, heeler));
      }
    }
  }
  return {
    registrations: [],
    teams: picked,
    message: picked.length
      ? `Added ${plural(picked.length, "test team")}.${picked.length < count ? ` Only ${picked.length} unique eligible pairings were available.` : ""}`
      : "No eligible header and heeler pairings are available in the database.",
  };
}
