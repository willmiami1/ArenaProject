import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings, generateCompetitionDraw } from "./competition";
import {
  competitionGroup,
  parsePublicRoute,
  projectPublicArenaData,
} from "./publicData";
import { publicStandingRows } from "./standings";
import { createOnlineSignup, mergeStaleOnlineEntries } from "./onlineSignup";
import type { ArenaData, ArenaEvent, Contestant, Team } from "./types";
import { canMountArenaCommand, localAdminAccess } from "./adminAccess";
import { normalizeData } from "./useArenaData";
import {
  createSpectatorPrediction,
  spectatorLeaderboard,
} from "./spectatorPredictions";

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
  spectators: [],
  spectatorPredictions: [],
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

  describe("admin access boundary", () => {
    it("allows an explicit local bypass only in development builds", () => {
      expect(localAdminAccess(false, true)).toBe("local-development");
      expect(canMountArenaCommand(localAdminAccess(false, true))).toBe(true);
      expect(localAdminAccess(false, false)).toBe("unavailable");
      expect(canMountArenaCommand(localAdminAccess(false, false))).toBe(false);
    });

    it("always requires Wix verification for embedded production routes", () => {
      expect(localAdminAccess(true, true)).toBe("checking");
      expect(localAdminAccess(true, false)).toBe("checking");
      expect(canMountArenaCommand("checking")).toBe(false);
      expect(canMountArenaCommand("denied")).toBe(false);
      expect(canMountArenaCommand("authorized")).toBe(true);
    });
  });
});

describe("public grouping and privacy", () => {
  const today = new Date(2026, 7, 3);
  it("groups each roping from its own status", () => {
    expect(competitionGroup("Live")).toBe("live");
    expect(competitionGroup("Upcoming")).toBe("future");
    expect(competitionGroup("Complete")).toBe("past");
  });

  it("keeps every roping in the flat public list even with a legacy parent ID", () => {
    const data = workspace(event({ parentEventId: "legacy-parent", status: "Live" }));
    const projected = projectPublicArenaData(data, today);
    expect(projected.competitions).toHaveLength(1);
    expect(projected.competitions[0]).toMatchObject({
      name: "Roping",
      status: "Live",
    });
    expect(projected.meets[0].competitions).toHaveLength(0);
  });

  it("projects only public fields and gates unpublished results", () => {
    const data = workspace(
      event({ description: "Open to all eligible teams.", resultsPublished: false, maxContestantHandicap: 5 }),
      [run()],
    );
    const serialized = JSON.stringify(projectPublicArenaData(data, today));
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("data:image");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("checkedIn");
    expect(serialized).not.toContain("\"paid\"");
    expect(serialized).toContain("Open to all eligible teams.");
    expect(
      projectPublicArenaData(data, today).meets[0].competitions[0]
        .maxContestantHandicap,
    ).toBe(5);
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

  it("rejects contestants above the individual handicap cap", () => {
    const drawPot = workspace(event({
      competitionType: "draw-pot",
      maxContestantHandicap: 3,
    }));
    expect(() =>
      createOnlineSignup(drawPot, {
        submissionId: "capped-individual",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        entries: 1,
      }),
    ).toThrow("Contestant handicap");

    const pickOnly = workspace(event({
      competitionType: "pick-only",
      maxContestantHandicap: 3,
      handicapTotal: 10,
    }));
    expect(() =>
      createOnlineSignup(pickOnly, {
        submissionId: "capped-team",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        partnerId: "heeler",
      }),
    ).toThrow("contestant handicap");
  });

  it("allows a contestant whose handicap equals the individual cap", () => {
    const created = createOnlineSignup(
      workspace(event({
        competitionType: "draw-pot",
        maxContestantHandicap: 4,
      })),
      {
        submissionId: "at-cap",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        entries: 1,
      },
    );

    expect(created.registrations).toHaveLength(1);
  });

  it("does not generate draw teams with over-cap contestants", () => {
    const competition = event({
      competitionType: "draw-pot",
      maxContestantHandicap: 3,
      handicapTotal: 10,
    });
    const data = workspace(competition);
    data.registrations = [
      { id: "header-entry", eventId: competition.id, contestantId: "header", role: "Header", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
      { id: "heeler-entry", eventId: competition.id, contestantId: "heeler", role: "Heeler", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
    ];

    expect(
      generateCompetitionDraw(
        competition,
        data.registrations,
        [],
        data.contestants,
      ),
    ).toEqual([]);
  });

  it("excludes ineligible fixed teams when generating a draw", () => {
    const competition = event({
      competitionType: "pick-only",
      maxContestantHandicap: 3,
      handicapTotal: 10,
    });

    expect(
      generateCompetitionDraw(
        competition,
        [],
        [run({ status: "ready", rawTime: null })],
        contestants,
      ),
    ).toEqual([]);
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

describe("workspace compatibility", () => {
  it("defaults legacy ropings without an individual handicap cap", () => {
    const legacy = workspace();
    delete (legacy.events[0] as Partial<ArenaEvent>).maxContestantHandicap;

    expect(normalizeData(legacy).events[0].maxContestantHandicap).toBe(99);
  });

  describe("spectator predictions", () => {
    const now = new Date("2026-08-04T18:00:00Z");

    it("accepts one free pick per display name before cutoff", () => {
      const competition = event({ status: "Live" });
      const activeRun = run({
        status: "ready",
        rawTime: null,
        predictionClosesAt: "2026-08-04T18:05:00Z",
      });
      const data = workspace(competition, [activeRun]);
      const created = createSpectatorPrediction(
        data,
        {
          name: "Taylor Fan",
          eventId: competition.id,
          teamId: activeRun.id,
          choice: "cowboys",
        },
        now,
      );
      const updated = {
        ...data,
        spectators: created.spectators,
        spectatorPredictions: created.spectatorPredictions,
      };
      const publicData = projectPublicArenaData(updated, now);

      expect(created.existing).toBe(false);
      expect(publicData.meets[0].competitions[0].predictionRuns[0]).toMatchObject({
        id: activeRun.id,
        open: true,
      });
      expect(JSON.stringify(publicData)).not.toContain(created.spectator.id);

      const repeated = createSpectatorPrediction(
        updated,
        {
          name: "  taylor   fan ",
          eventId: competition.id,
          teamId: activeRun.id,
          choice: "steer",
        },
        now,
      );
      expect(repeated.existing).toBe(true);
      expect(repeated.spectatorPredictions).toHaveLength(1);
    });

    it("rejects picks at or after the administrator cutoff", () => {
      const competition = event({ status: "Live" });
      const data = workspace(competition, [
        run({
          status: "ready",
          rawTime: null,
          predictionClosesAt: now.toISOString(),
        }),
      ]);

      expect(() =>
        createSpectatorPrediction(
          data,
          {
            name: "Taylor Fan",
            eventId: competition.id,
            teamId: "team-1",
            choice: "steer",
          },
          now,
        ),
      ).toThrow("closed");
    });

    it("scores Cowboys on a qualified run and Steer on a no-time", () => {
      const competition = event({ status: "Live" });
      const data = workspace(competition, [
        run({ id: "caught", status: "complete", rawTime: 8 }),
        run({ id: "escaped", status: "no-time", rawTime: null, drawPosition: 2 }),
      ]);
      data.spectators = [
        { id: "fan-1", name: "Taylor Fan", phone: "5558675309", createdAt: now.toISOString() },
      ];
      data.spectatorPredictions = [
        { id: "pick-1", spectatorId: "fan-1", eventId: competition.id, teamId: "caught", round: 1, choice: "cowboys", submittedAt: now.toISOString() },
        { id: "pick-2", spectatorId: "fan-1", eventId: competition.id, teamId: "escaped", round: 1, choice: "steer", submittedAt: now.toISOString() },
      ];

      expect(spectatorLeaderboard(data, competition.id, 1)[0]).toMatchObject({
        name: "Taylor Fan",
        picks: 2,
        correct: 2,
      });
    });

    it("scores a Cowboys pick only when a run time is entered", () => {
      const competition = event({ status: "Live" });
      const data = workspace(competition, [
        run({ id: "timed", status: "ready", rawTime: 8 }),
        run({ id: "untimed", status: "complete", rawTime: null, drawPosition: 2 }),
      ]);
      data.spectators = [
        { id: "fan-1", name: "Taylor Fan", phone: "5558675309", createdAt: now.toISOString() },
      ];
      data.spectatorPredictions = [
        { id: "pick-1", spectatorId: "fan-1", eventId: competition.id, teamId: "timed", round: 1, choice: "cowboys", submittedAt: now.toISOString() },
        { id: "pick-2", spectatorId: "fan-1", eventId: competition.id, teamId: "untimed", round: 1, choice: "cowboys", submittedAt: now.toISOString() },
      ];

      expect(spectatorLeaderboard(data, competition.id, 1)[0]).toMatchObject({
        picks: 2,
        correct: 1,
      });
    });

    it("scores a Steer pick only when a finished run has no entered time", () => {
      const competition = event({ status: "Live" });
      const data = workspace(competition, [
        run({ id: "untimed", status: "complete", rawTime: null }),
        run({ id: "timed", status: "complete", rawTime: 8, drawPosition: 2 }),
      ]);
      data.spectators = [
        { id: "fan-1", name: "Taylor Fan", phone: "5558675309", createdAt: now.toISOString() },
      ];
      data.spectatorPredictions = [
        { id: "pick-1", spectatorId: "fan-1", eventId: competition.id, teamId: "untimed", round: 1, choice: "steer", submittedAt: now.toISOString() },
        { id: "pick-2", spectatorId: "fan-1", eventId: competition.id, teamId: "timed", round: 1, choice: "steer", submittedAt: now.toISOString() },
      ];

      expect(spectatorLeaderboard(data, competition.id, 1)[0]).toMatchObject({
        picks: 2,
        correct: 1,
      });
    });
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
