import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings, generateCompetitionDraw } from "./competition";
import {
  meetGroup,
  parsePublicRoute,
  projectPublicArenaData,
} from "./publicData";
import { publicStandingRows } from "./standings";
import { createOnlineSignup, mergeStaleOnlineEntries } from "./onlineSignup";
import type { ArenaData, ArenaEvent, Contestant, Team } from "./types";

const event = (overrides: Partial<ArenaEvent> = {}): ArenaEvent => ({
  ...defaultCompetitionSettings,
  id: "competition-1",
  parentEventId: "meet-1",
  name: "Roping",
  date: "2026-08-04",
  startTime: "18:00",
  location: "Destiny Arena",
  status: "Upcoming",
  entryFee: 50,
  ...overrides,
});
const contestants: Contestant[] = [
  { id: "header", name: "Ada Header", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "data:image/png;base64,secret", phone: "555", email: "ada@example.com", hometown: "Texas" },
  { id: "heeler", name: "Bo Heeler", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "555", email: "bo@example.com", hometown: "Texas" },
];
const run = (overrides: Partial<Team> = {}): Team => ({
  id: "team-1",
  eventId: "competition-1",
  headerId: "header",
  heelerId: "heeler",
  drawPosition: 1,
  status: "complete",
  rawTime: 8,
  penalties: 5,
  notes: "private",
  round: 1,
  checkedIn: true,
  scratched: false,
  generated: false,
  points: 0,
  paid: true,
  ...overrides,
});
const workspace = (competition = event(), teams: Team[] = []): ArenaData => ({
  participantDatabaseVersion: 2,
  revision: 1,
  meets: [{ id: "meet-1", name: "Arena Day", date: competition.date, startTime: competition.startTime, location: competition.location, producer: "Destiny Ranch" }],
  events: [competition],
  contestants,
  teams,
  registrations: [],
  activeEventId: competition.id,
});

describe("public routing", () => {
  it("defaults to public home and preserves operational precedence", () => {
    expect(parsePublicRoute("")).toEqual({ kind: "home" });
    expect(parsePublicRoute("?page=events&app=command")).toEqual({ kind: "staff" });
    expect(parsePublicRoute("?page=home&portal=contestant")).toEqual({ kind: "contestant" });
    expect(parsePublicRoute("?display=leaderboard&page=event&id=x")).toEqual({ kind: "leaderboard" });
    expect(parsePublicRoute("?page=competition&id=c")).toEqual({ kind: "competition", id: "c" });
  });
});

describe("public grouping and privacy", () => {
  const today = new Date(2026, 7, 3);
  it("lets explicit live status win and handles future/all-complete", () => {
    expect(meetGroup({ date: "2020-01-01" }, [{ status: "Live" }], today)).toBe("live");
    expect(meetGroup({ date: "2026-08-03" }, [{ status: "Upcoming" }], today)).toBe("future");
    expect(meetGroup({ date: "2026-08-30" }, [{ status: "Complete" }], today)).toBe("past");
  });

  it("projects only public fields and gates unpublished results", () => {
    const data = workspace(event({ resultsPublished: false }), [run()]);
    const serialized = JSON.stringify(projectPublicArenaData(data, today));
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("checkedIn");
    expect(serialized).not.toContain("\"paid\"");
    expect(projectPublicArenaData(data, today).meets[0].competitions[0].results).toEqual([]);
  });
});

describe("aggregate public standings", () => {
  it("keeps entry numbers distinct and aggregates penalties, no-times, and scratches", () => {
    const competition = event({ resultsPublished: true });
    const teams = [
      run(),
      run({ id: "round-2", round: 2, rawTime: 7, penalties: 0 }),
      run({ id: "entry-2", headerEntryNumber: 2, heelerEntryNumber: 2, rawTime: 9, penalties: 0 }),
      run({ id: "no-time", headerEntryNumber: 3, heelerEntryNumber: 3, status: "no-time", rawTime: null }),
      run({ id: "scratch", headerEntryNumber: 4, heelerEntryNumber: 4, scratched: true }),
    ];
    const rows = publicStandingRows(competition, teams, contestants);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ rounds: 2, officialTotal: 20, status: "qualified" });
    expect(rows[2]).toMatchObject({ officialTotal: null, status: "no-time" });
  });
});

describe("online signup", () => {
  it.each(["draw-pot", "round-robin"] as const)(
    "supports %s individual entries",
    (competitionType) => {
      const created = createOnlineSignup(
        workspace(event({ competitionType, entriesAllowed: 2 })),
        {
          submissionId: `${competitionType}-entry`,
          contestantId: "header",
          eventId: "competition-1",
          role: "Header",
          entries: 1,
        },
      );
      expect(created.registrations).toHaveLength(1);
    },
  );

  it.each(["pick-only", "pick-and-draw"] as const)(
    "supports %s fixed teams",
    (competitionType) => {
      const created = createOnlineSignup(
        workspace(event({ competitionType, handicapTotal: 8 })),
        {
          submissionId: `${competitionType}-team`,
          contestantId: "header",
          eventId: "competition-1",
          role: "Header",
          partnerId: "heeler",
        },
      );
      expect(created.teams).toHaveLength(1);
    },
  );

  it("creates unpaid deterministic draw registrations and is idempotent", () => {
    const data = workspace(event({ competitionType: "draw-pot", entriesAllowed: 3 }));
    const request = { submissionId: "request-1", contestantId: "header", eventId: "competition-1", role: "Header" as const, entries: 2 };
    const created = createOnlineSignup(data, request, new Date("2026-08-03T12:00:00Z"));
    expect(created.registrations[0]).toMatchObject({ id: "online-registration-request-1", paid: false, source: "online" });
    const repeated = createOnlineSignup({ ...data, registrations: created.registrations }, request);
    expect(repeated.existing).toBe(true);
  });

  it("validates fixed partners and adds unpaid Pick and Draw registrations", () => {
    const data = workspace(event({ competitionType: "pick-and-draw", pickDrawRole: "both", handicapTotal: 8 }));
    const created = createOnlineSignup(data, { submissionId: "fixed-1", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "heeler" });
    expect(created.teams[0].paid).toBe(false);
    expect(created.registrations).toHaveLength(2);
    expect(created.registrations.every((registration) => registration.paid === false)).toBe(true);
    expect(
      generateCompetitionDraw(
        data.events[0],
        created.registrations,
        created.teams,
        data.contestants,
      ),
    ).toEqual([]);
  });

  it("rejects closed, locked, duplicate, self-paired, and over-limit entries", () => {
    expect(() => createOnlineSignup(workspace(event({ registrationOpen: false })), { submissionId: "a", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "heeler" })).toThrow("closed");
    expect(() => createOnlineSignup(workspace(event({ drawLocked: true })), { submissionId: "b", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "heeler" })).toThrow("locked");
    expect(() => createOnlineSignup(workspace(event()), { submissionId: "c", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "header" })).toThrow("eligible partner");
    expect(() => createOnlineSignup(workspace(event({ entriesAllowed: 1 }), [run()]), { submissionId: "d", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "heeler" })).toThrow();
    expect(() => createOnlineSignup(workspace(event({ handicapTotal: 7 })), { submissionId: "e", contestantId: "header", eventId: "competition-1", role: "Header", partnerId: "heeler" })).toThrow("handicap");
  });

  it("enforces the fixed-team entry limit for the selected partner", () => {
    const data = workspace(event({ entriesAllowed: 1 }), [
      run({ id: "partner-entry", headerId: "other-header", heelerId: "heeler" }),
    ]);
    data.contestants.push({
      id: "other-header",
      name: "Other Header",
      role: "Header",
      headerHandicap: 3,
      heelerHandicap: 0,
      photo: "",
      phone: "",
      hometown: "",
    });
    expect(() =>
      createOnlineSignup(data, {
        submissionId: "partner-limit",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        partnerId: "heeler",
      }),
    ).toThrow("Entry limit");
  });
});

describe("revision merge", () => {
  it("preserves fresh online records only for stale staff saves", () => {
    const staff = workspace(event());
    const online = run({ id: "online-team-new", source: "online", submissionId: "new" });
    const latest = { ...staff, revision: 2, teams: [online] };
    expect(mergeStaleOnlineEntries(staff, latest).teams).toContainEqual(online);
    expect(mergeStaleOnlineEntries({ ...staff, revision: 2 }, latest).teams).toEqual([]);
  });
});
