import { describe, expect, it } from "vitest";
import {
  defaultCompetitionSettings,
  generateCompetitionDraw,
  officialRunTime,
  repeatedTeamPairKeys,
  reorderDraftDrawTeams,
  spaceDrawTeamsApart,
  slideTimeAdjustment,
} from "./competition";
import {
  competitionGroup,
  parsePublicRoute,
  projectPublicArenaData,
} from "./publicData";
import { publicStandingRows } from "./standings";
import { createOnlineSignup, mergeStaleOnlineEntries } from "./onlineSignup";
import type { ArenaData, ArenaEvent, Contestant, Team } from "./types";
import {
  canMountArenaCommand,
  isBrowserStoragePreview,
  localAdminAccess,
} from "./adminAccess";
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
  date: "2026-08-05",
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
    expect(parsePublicRoute("?app=registration")).toEqual({
      kind: "registration-desk",
    });
    expect(parsePublicRoute("?page=home&portal=contestant")).toEqual({ kind: "contestant" });
    expect(parsePublicRoute("?display=leaderboard&page=event&id=x")).toEqual({ kind: "leaderboard" });
    expect(parsePublicRoute("?page=competition&id=c")).toEqual({ kind: "competition", id: "c" });
  });

  describe("admin access boundary", () => {
    it("allows development and local-storage preview access", () => {
      expect(localAdminAccess(false, true)).toBe("local-development");
      expect(canMountArenaCommand(localAdminAccess(false, true))).toBe(true);
      expect(localAdminAccess(false, false, true)).toBe("local-development");
      expect(localAdminAccess(false, false)).toBe("unavailable");
      expect(canMountArenaCommand(localAdminAccess(false, false))).toBe(false);
      expect(isBrowserStoragePreview("127.0.0.1", "/")).toBe(true);
      expect(
        isBrowserStoragePreview("willmiami1.github.io", "/ArenaProject/"),
      ).toBe(true);
      expect(isBrowserStoragePreview("example.com", "/ArenaProject/")).toBe(false);
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

  it("projects profile photos only for the current prediction team", () => {
    const projected = projectPublicArenaData(
      workspace(event({ status: "Live" }), [
        run({
          status: "ready",
          rawTime: null,
          predictionClosesAt: "2026-08-05T23:00:00.000Z",
        }),
      ]),
      today,
    );

    expect(projected.competitions[0].predictionRuns[0]).toMatchObject({
      headerPhoto: "data:image/png;base64,secret",
      heelerPhoto: undefined,
    });
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

  it("applies the Slide adjustment only in Round 2 and caps it at four seconds", () => {
    const slide = event({
      competitionType: "slide",
      slideNumber: 10,
      resultsPublished: true,
    });
    const handicapNine = [
      { ...contestants[0], headerHandicap: 4.5 },
      { ...contestants[1], heelerHandicap: 4.5 },
    ];
    const roundOne = run({ round: 1, rawTime: 8, penalties: 0 });
    const roundTwo = run({ id: "round-2", round: 2, rawTime: 8, penalties: 0 });

    expect(slideTimeAdjustment(slide, roundOne, handicapNine)).toBe(0);
    expect(slideTimeAdjustment(slide, roundTwo, handicapNine)).toBe(-1);
    expect(officialRunTime(slide, roundTwo, handicapNine)).toBe(7);
    expect(
      slideTimeAdjustment(
        slide,
        roundTwo,
        [
          { ...contestants[0], headerHandicap: 7.25 },
          { ...contestants[1], heelerHandicap: 3.25 },
        ],
      ),
    ).toBe(0.5);
    expect(
      slideTimeAdjustment(
        slide,
        roundTwo,
        [
          { ...contestants[0], headerHandicap: 10 },
          { ...contestants[1], heelerHandicap: 10 },
        ],
      ),
    ).toBe(4);
    expect(
      slideTimeAdjustment(
        slide,
        roundTwo,
        [
          { ...contestants[0], headerHandicap: 1 },
          { ...contestants[1], heelerHandicap: 1 },
        ],
      ),
    ).toBe(-4);
    expect(
      publicStandingRows(slide, [roundOne, roundTwo], handicapNine)[0]
        .officialTotal,
    ).toBe(15);
  });
});

describe("online signup", () => {
  const beforeCutoff = new Date("2026-08-05T16:59:59");
  const atCutoff = new Date("2026-08-05T17:00:00");

  it("accepts Future or Live entries only until one hour before start", () => {
    const request = {
      submissionId: "cutoff-entry",
      contestantId: "header",
      eventId: "competition-1",
      role: "Header" as const,
      entries: 1,
    };
    expect(
      createOnlineSignup(
        workspace(event({ competitionType: "draw-pot", status: "Live" })),
        request,
        beforeCutoff,
      ).registrations,
    ).toHaveLength(1);
    expect(() =>
      createOnlineSignup(
        workspace(event({ competitionType: "draw-pot", status: "Live" })),
        request,
        atCutoff,
      ),
    ).toThrow("one hour");
  });

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

  it("enforces the configured minimum draw entries", () => {
    expect(() =>
      createOnlineSignup(
        workspace(
          event({
            competitionType: "draw-pot",
            minDrawsAllowed: 2,
            entriesAllowed: 4,
          }),
        ),
        {
          submissionId: "below-minimum-draws",
          contestantId: "header",
          eventId: "competition-1",
          role: "Header",
          entries: 1,
        },
      ),
    ).toThrow("at least 2 draw entries");
  });

  it.each(["pick-only", "pick-and-draw"] as const)(
    "supports %s fixed teams",
    (competitionType) => {
      const data = workspace(
        event({
          competitionType,
          handicapTotal: 8,
          entriesAllowed: 3,
          pickDrawRole: "both",
        }),
      );
      if (competitionType === "pick-and-draw") {
        data.registrations = [
          {
            id: "heeler-draw",
            eventId: "competition-1",
            contestantId: "heeler",
            role: "Heeler",
            entries: 1,
            checkedIn: false,
            status: "entered",
            notes: "",
            paid: true,
          },
        ];
      }
      const created = createOnlineSignup(
        data,
        {
          submissionId: `${competitionType}-team`,
          contestantId: "header",
          eventId: "competition-1",
          role: "Header",
          partnerId: "heeler",
          entries: competitionType === "pick-and-draw" ? 1 : undefined,
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

  it("requires every picked-team rider to be entered in the draw", () => {
    const data = workspace(
      event({
        competitionType: "pick-and-draw",
        pickDrawRole: "both",
        handicapTotal: 8,
        entriesAllowed: 3,
      }),
    );
    expect(() =>
      createOnlineSignup(data, {
        submissionId: "missing-draw",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        partnerId: "heeler",
        entries: 1,
      }),
    ).toThrow("Every rider on a picked team");
    expect(
      generateCompetitionDraw(
        data.events[0],
        [],
        [run({ id: "legacy-pick-without-draw" })],
        data.contestants,
      ),
    ).toEqual([]);
    data.registrations = [
      {
        id: "heeler-draw",
        eventId: "competition-1",
        contestantId: "heeler",
        role: "Heeler",
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "",
        paid: true,
      },
    ];
    const created = createOnlineSignup(data, {
      submissionId: "fixed-1",
      contestantId: "header",
      eventId: "competition-1",
      role: "Header",
      partnerId: "heeler",
      entries: 1,
    });
    expect(created.teams[0].paid).toBe(false);
    expect(created.registrations).toHaveLength(1);
  });

  it("places picked teams after every generated Pick and Draw team", () => {
    const competition = event({
      competitionType: "pick-and-draw",
      pickDrawRole: "both",
      allowRepeatPartners: true,
    });

    const fixedTeam = run({
      id: "picked-team",
      status: "ready",
      rawTime: null,
      drawPosition: 0,
    });
    const registrations = [
      {
        id: "header-draw",
        eventId: competition.id,
        contestantId: "header",
        role: "Header" as const,
        entries: 1,
        checkedIn: false,
        status: "entered" as const,
        notes: "",
        paid: true,
      },
      {
        id: "heeler-draw",
        eventId: competition.id,
        contestantId: "heeler",
        role: "Heeler" as const,
        entries: 1,
        checkedIn: false,
        status: "entered" as const,
        notes: "",
        paid: true,
      },
    ];

    const draw = generateCompetitionDraw(
      competition,
      registrations,
      [fixedTeam],
      contestants,
    );

    expect(draw.map((team) => team.generated)).toEqual([true, false]);
    expect(draw.map((team) => team.drawPosition)).toEqual([1, 2]);
    expect(draw[draw.length - 1]?.id).toBe("picked-team");
  });

  it("combines Slide draw entries with picked teams", () => {
    const competition = event({
      competitionType: "slide",
      allowRepeatPartners: true,
    });
    const registrations = [
      {
        id: "slide-header",
        eventId: competition.id,
        contestantId: "header",
        role: "Header" as const,
        entries: 1,
        checkedIn: false,
        status: "entered" as const,
        notes: "",
        paid: true,
      },
      {
        id: "slide-heeler",
        eventId: competition.id,
        contestantId: "heeler",
        role: "Heeler" as const,
        entries: 1,
        checkedIn: false,
        status: "entered" as const,
        notes: "",
        paid: true,
      },
    ];
    const pickedTeam = run({
      id: "slide-picked",
      status: "ready",
      rawTime: null,
    });

    const draw = generateCompetitionDraw(
      competition,
      registrations,
      [pickedTeam],
      contestants,
    );

    expect(draw.map((team) => team.generated)).toEqual([true, false]);
    expect(draw.map((team) => team.drawPosition)).toEqual([1, 2]);
  });

  it("accepts individual draw entries for Slide competitions", () => {
    const data = workspace(
      event({ competitionType: "slide", entriesAllowed: 3 }),
    );
    const created = createOnlineSignup(data, {
      submissionId: "slide-draw",
      contestantId: "header",
      eventId: "competition-1",
      role: "Header",
      entries: 2,
    });

    expect(created.teams).toEqual([]);
    expect(created.registrations[0]).toMatchObject({
      contestantId: "header",
      role: "Header",
      entries: 2,
    });
  });

  it("reorders draft teams only within the same draw section", () => {
    const generatedOne = run({ id: "generated-1", generated: true, drawPosition: 1 });
    const generatedTwo = run({ id: "generated-2", generated: true, drawPosition: 2 });
    const picked = run({ id: "picked", generated: false, drawPosition: 3 });
    const teams = [generatedOne, generatedTwo, picked];

    expect(
      reorderDraftDrawTeams(teams, "generated-2", "generated-1").map(
        (team) => [team.id, team.drawPosition],
      ),
    ).toEqual([
      ["generated-2", 1],
      ["generated-1", 2],
      ["picked", 3],
    ]);
    expect(reorderDraftDrawTeams(teams, "picked", "generated-1")).toBe(teams);
  });

  it("marks only exact teams entered more than once in round one", () => {
    const firstEntry = run({ id: "entry-1", round: 1 });
    const secondEntry = run({
      id: "entry-2",
      round: 1,
      headerEntryNumber: 2,
      heelerEntryNumber: 2,
    });
    const advancedRound = run({ id: "round-2", round: 2 });

    expect(repeatedTeamPairKeys([firstEntry, secondEntry])).toEqual(
      new Set(["header|heeler"]),
    );
    expect(repeatedTeamPairKeys([firstEntry, advancedRound])).toEqual(
      new Set(),
    );
  });

  it("spaces repeated riders and teams as far apart as the draw allows", () => {
    const spaced = spaceDrawTeamsApart([
      run({ id: "repeat-team-1", headerId: "repeat-header", heelerId: "repeat-heeler" }),
      run({ id: "repeat-team-2", headerId: "repeat-header", heelerId: "repeat-heeler" }),
      run({ id: "repeat-rider", headerId: "repeat-header", heelerId: "other-heeler" }),
      run({ id: "unique-1", headerId: "header-1", heelerId: "heeler-1" }),
      run({ id: "unique-2", headerId: "header-2", heelerId: "heeler-2" }),
      run({ id: "unique-3", headerId: "header-3", heelerId: "heeler-3" }),
    ]);
    const repeatedRiderPositions = spaced
      .map((team, index) =>
        team.headerId === "repeat-header" || team.heelerId === "repeat-header"
          ? index + 1
          : 0,
      )
      .filter(Boolean);
    const repeatedTeamPositions = spaced
      .map((team, index) =>
        team.headerId === "repeat-header" && team.heelerId === "repeat-heeler"
          ? index + 1
          : 0,
      )
      .filter(Boolean);

    const repeatedRiderGaps = repeatedRiderPositions.slice(1).map(
        (position, index) => position - repeatedRiderPositions[index],
      );
    expect(Math.min(...repeatedRiderGaps)).toBeGreaterThanOrEqual(2);
    expect(repeatedRiderGaps.reduce((total, gap) => total + gap, 0)).toBeGreaterThanOrEqual(4);
    expect(repeatedTeamPositions[1] - repeatedTeamPositions[0]).toBeGreaterThanOrEqual(2);
    expect(spaced.map((team) => team.drawPosition)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("removes legacy picked-team registrations from the Draw Pot pool", () => {
    const data = workspace(
      event({ competitionType: "pick-and-draw" }),
      [run({ id: "picked-team" })],
    );
    data.registrations = [
      {
        id: "legacy-picked-registration",
        eventId: "competition-1",
        contestantId: "header",
        sourceTeamId: "picked-team",
        role: "Header",
        entries: 1,
        checkedIn: false,
        status: "entered",
        notes: "Automatically added from picked team.",
        paid: true,
      },
    ];

    expect(normalizeData(data).registrations).toEqual([]);
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
  it("defaults legacy ropings without newer registration limits", () => {
    const legacy = workspace();
    delete (legacy.events[0] as Partial<ArenaEvent>).maxContestantHandicap;
    delete (legacy.events[0] as Partial<ArenaEvent>).minDrawsAllowed;

    expect(normalizeData(legacy).events[0].handicapTotal).toBe(20);
    expect(normalizeData(legacy).events[0].maxContestantHandicap).toBe(10);
    expect(normalizeData(legacy).events[0].minDrawsAllowed).toBe(0);
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

    it("keeps the current ready team open until staff closes picks", () => {
      const competition = event({ status: "Live" });
      const currentRun = run({
        status: "ready",
        rawTime: null,
        predictionClosesAt: undefined,
      });

      expect(projectPublicArenaData(workspace(competition, [currentRun]), now)
        .competitions[0].predictionRuns[0]).toMatchObject({
          id: currentRun.id,
          open: true,
        });
      expect(() =>
        createSpectatorPrediction(
          workspace(competition, [currentRun]),
          {
            name: "Taylor Fan",
            eventId: competition.id,
            teamId: currentRun.id,
            choice: "cowboys",
          },
          now,
        ),
      ).not.toThrow();
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
