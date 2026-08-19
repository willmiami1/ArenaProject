import { describe, expect, it } from "vitest";
import {
  applyRunResult,
  defaultCompetitionSettings,
  generateCompetitionDraw,
  officialRunTime,
  reconcileQualifiedAdvancements,
  repeatedTeamPairKeys,
  reorderDraftDrawTeams,
  resetInheritedPredictionCutoffs,
  spaceDrawTeamsApart,
  slideTimeAdjustment,
} from "./competition";
import {
  aggregatePublicSpectatorLeaderboard,
  competitionGroup,
  parsePublicRoute,
  publicHorseNamesLabel,
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
import {
  mergeConcurrentSavedArenaData,
  mergeSavedArenaData,
  normalizeData,
  contestantSaveHasUnrelatedChanges,
  reconcileContestantSaveConfirmation,
  reconcileRegistrationSaveConfirmation,
  reconcileWorkspaceSaveConfirmation,
  registrationSaveHasUnrelatedChanges,
  remoteWorkspaceIsNewer,
  staffWorkspaceIsNewer,
  shouldSkipDirectMutationReconciliationSave,
  workspaceSaveNeedsFollowUp,
} from "./useArenaData";
import {
  createSpectatorPrediction,
  spectatorLeaderboard,
} from "./spectatorPredictions";
import { runDeskSelectionToPersist } from "./runDeskActiveSelection";

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
  { id: "header", name: "Ada Header", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "data:image/png;base64,secret", phone: "555", email: "ada@example.com", hometown: "Texas", horses: ["Blue"] },
  { id: "heeler", name: "Bo Heeler", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "555", email: "bo@example.com", hometown: "Texas", horses: ["Star"] },
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

describe("workspace save queue", () => {
  it("reconciles a created contestant and revision metadata only", () => {
    const original = workspace();
    const contestant = {
      ...contestants[0],
      id: "new-rider",
      name: "NEW RIDER",
    };
    const reconciled = reconcileContestantSaveConfirmation(original, {
      contestant,
      revision: 12,
      staffRevision: 9,
      onlineRevision: 3,
      loadedAt: "2026-08-10T21:45:00.000Z",
    });

    expect(reconciled.contestants[reconciled.contestants.length - 1]).toEqual(
      contestant,
    );
    expect(reconciled.events).toBe(original.events);
    expect(reconciled.teams).toBe(original.teams);
    expect(reconciled).toMatchObject({
      revision: 12,
      staffRevision: 9,
      onlineRevision: 3,
      loadedAt: "2026-08-10T21:45:00.000Z",
    });
  });

  it("reconciles an updated contestant without changing other workspace records", () => {
    const original = workspace();
    const contestant = {
      ...contestants[0],
      name: "UPDATED RIDER",
      photo: "data:image/jpeg;base64,updated",
    };
    const reconciled = reconcileContestantSaveConfirmation(original, {
      contestant,
      revision: 8,
      staffRevision: 7,
      onlineRevision: 1,
      loadedAt: "2026-08-10T21:46:00.000Z",
    });

    expect(reconciled.contestants[0]).toEqual(contestant);
    expect(reconciled.contestants).toHaveLength(original.contestants.length);
    expect(reconciled.registrations).toBe(original.registrations);
  });

  it("does not retry a full save when only the confirmed contestant was dirty", () => {
    const persisted = workspace();
    const current = {
      ...persisted,
      contestants: [
        ...persisted.contestants,
        { ...contestants[0], id: "new-rider", name: "NEW RIDER" },
      ],
    };

    expect(
      contestantSaveHasUnrelatedChanges(current, persisted, "new-rider"),
    ).toBe(false);
    expect(
      contestantSaveHasUnrelatedChanges(
        { ...current, activeEventId: "another-event" },
        persisted,
        "new-rider",
      ),
    ).toBe(true);
  });

  it("saves a Draw entry added before contestant reconciliation finishes", () => {
    const reconciled = {
      ...workspace(),
      contestants: [
        ...contestants,
        { ...contestants[0], id: "new-rider", name: "NEW RIDER" },
      ],
    };
    const snapshot = JSON.stringify(reconciled);

    expect(
      shouldSkipDirectMutationReconciliationSave(reconciled, snapshot),
    ).toBe(true);
    expect(
      shouldSkipDirectMutationReconciliationSave(
        {
          ...reconciled,
          registrations: [
            ...reconciled.registrations,
            {
              id: "new-entry",
              eventId: reconciled.events[0].id,
              contestantId: "new-rider",
              role: "Header",
              entries: 1,
              checkedIn: false,
              status: "entered",
              notes: "",
              paid: true,
            },
          ],
        },
        snapshot,
      ),
    ).toBe(false);
  });

  it("reconciles a direct Draw registration and revision metadata only", () => {
    const original = workspace();
    const registration = {
      id: "direct-entry",
      eventId: original.events[0].id,
      contestantId: original.contestants[0].id,
      role: "Header" as const,
      entries: 1,
      checkedIn: false,
      status: "entered" as const,
      notes: "",
      paid: true,
    };
    const reconciled = reconcileRegistrationSaveConfirmation(original, {
      registration,
      revision: 18,
      staffRevision: 15,
      onlineRevision: 3,
      loadedAt: "2026-08-10T23:20:00.000Z",
    });

    expect(reconciled.registrations).toContainEqual(registration);
    expect(reconciled).toMatchObject({
      revision: 18,
      staffRevision: 15,
      onlineRevision: 3,
      loadedAt: "2026-08-10T23:20:00.000Z",
    });
    expect(reconciled.contestants).toBe(original.contestants);
    expect(
      registrationSaveHasUnrelatedChanges(
        reconciled,
        original,
        registration.id,
      ),
    ).toBe(false);
    expect(
      registrationSaveHasUnrelatedChanges(
        { ...reconciled, activeEventId: "other-event" },
        original,
        registration.id,
      ),
    ).toBe(true);
  });

  it("keeps submitted content while applying a compact save confirmation", () => {
    const submitted = workspace(
      event({ id: "new-event", name: "New Event", status: "Live" }),
    );
    const confirmed = reconcileWorkspaceSaveConfirmation(submitted, {
      saved: true,
      revision: 12,
      staffRevision: 9,
      onlineRevision: 3,
      loadedAt: "2026-08-10T20:20:00.000Z",
    });

    expect(confirmed.events).toEqual(submitted.events);
    expect(confirmed).toMatchObject({
      revision: 12,
      staffRevision: 9,
      onlineRevision: 3,
      loadedAt: "2026-08-10T20:20:00.000Z",
    });
    expect(confirmed).not.toHaveProperty("saved");
  });

  it("queues a newer Run Desk selection after an older save finishes", () => {
    const submitted = workspace(
      event({ activeRunId: "team-1", activeRound: 1 }),
    );
    const current = {
      ...submitted,
      events: [
        {
          ...submitted.events[0],
          activeRunId: "team-3",
        },
      ],
    };

    expect(workspaceSaveNeedsFollowUp(submitted, current, true)).toBe(true);
  });

  it("does not queue when the submitted snapshot is still current or clean", () => {
    const submitted = workspace();
    expect(workspaceSaveNeedsFollowUp(submitted, submitted, true)).toBe(false);
    expect(
      workspaceSaveNeedsFollowUp(submitted, { ...submitted }, false),
    ).toBe(false);
  });
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
    expect(parsePublicRoute("?page=rider-account")).toEqual({
      kind: "rider-account",
    });
    expect(parsePublicRoute("?page=rider")).toEqual({ kind: "rider" });
  });

  describe("admin access boundary", () => {
    it("allows development and localhost preview access only", () => {
      expect(localAdminAccess(false, true)).toBe("local-development");
      expect(canMountArenaCommand(localAdminAccess(false, true))).toBe(true);
      expect(localAdminAccess(false, false, true)).toBe("local-development");
      expect(localAdminAccess(false, false)).toBe("unavailable");
      expect(canMountArenaCommand(localAdminAccess(false, false))).toBe(false);
      expect(isBrowserStoragePreview("127.0.0.1", "/")).toBe(true);
      expect(
        isBrowserStoragePreview("willmiami1.github.io", "/ArenaProject/"),
      ).toBe(false);
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

describe("staff save reconciliation", () => {
  it("keeps explicit draw 3 queued after the older draw 1 save returns", () => {
    const drawOne = run({
      id: "draw-1",
      drawPosition: 1,
      status: "ready",
      rawTime: null,
    });
    const drawThree = run({
      id: "draw-3",
      drawPosition: 3,
      status: "ready",
      rawTime: null,
    });
    const submitted = workspace(
      event({ activeRunId: drawOne.id, activeRound: 1 }),
      [drawOne, drawThree],
    );
    const current = {
      ...submitted,
      events: [
        {
          ...submitted.events[0],
          activeRunId: drawThree.id,
        },
      ],
    };
    const saved = {
      ...submitted,
      revision: 2,
      staffRevision: 2,
    };

    const merged = mergeConcurrentSavedArenaData(
      submitted,
      current,
      saved,
    );

    expect(merged.events[0]).toMatchObject({
      activeRunId: drawThree.id,
      activeRound: 1,
    });
    expect(workspaceSaveNeedsFollowUp(submitted, merged, true)).toBe(true);
    expect(
      runDeskSelectionToPersist(merged.events[0], merged.teams, 1),
    ).toBeNull();
  });

  it("detects newer cross-device workspace revisions", () => {
    expect(
      remoteWorkspaceIsNewer(
        { revision: 4, staffRevision: 3, onlineRevision: 1 },
        { revision: 5, staffRevision: 4, onlineRevision: 1 },
      ),
    ).toBe(true);
    expect(
      remoteWorkspaceIsNewer(
        { staffRevision: 3, onlineRevision: 2 },
        { staffRevision: 3, onlineRevision: 2 },
      ),
    ).toBe(false);
    expect(
      remoteWorkspaceIsNewer(
        { revision: 6 },
        { revision: 5 },
      ),
    ).toBe(false);
    expect(
      staffWorkspaceIsNewer(
        { revision: 5, staffRevision: 3 },
        { revision: 6, staffRevision: 4 },
      ),
    ).toBe(true);
    expect(
      staffWorkspaceIsNewer(
        { revision: 5, staffRevision: 3 },
        { revision: 6, staffRevision: 3 },
      ),
    ).toBe(false);
  });

  it("keeps newer local edits and merged online records after an in-flight save", () => {
    const current = {
      ...workspace(event()),
      revision: 4,
      staffRevision: 3,
      onlineRevision: 1,
      events: [event({ name: "Newer local edit" })],
    };
    const onlineRider = {
      ...current.contestants[0],
      id: "concurrent-online-rider",
      name: "Concurrent Online Rider",
      source: "online" as const,
    };
    const submitted = {
      ...current,
      events: [event({ name: "Submitted edit" })],
    };
    const updated = mergeConcurrentSavedArenaData(submitted, current, {
      ...current,
      revision: 6,
      staffRevision: 5,
      onlineRevision: 1,
      loadedAt: "2026-08-07T18:40:00.000Z",
      events: [
        ...current.events,
        event({ id: "event-from-other-computer", name: "Remote Event" }),
      ],
      contestants: [...current.contestants, onlineRider],
    });

    expect(updated).toMatchObject({
      revision: 6,
      staffRevision: 5,
      onlineRevision: 1,
      loadedAt: "2026-08-07T18:40:00.000Z",
    });
    expect(updated.events[0].name).toBe("Newer local edit");
    expect(updated.events).toContainEqual(
      expect.objectContaining({
        id: "event-from-other-computer",
        name: "Remote Event",
      }),
    );
    expect(updated.contestants).toContainEqual(
      expect.objectContaining({
        id: onlineRider.id,
        name: onlineRider.name,
        source: "online",
      }),
    );
  });

  it("does not resurrect an online record deleted during an in-flight save", () => {
    const onlineRider = {
      ...workspace(event()).contestants[0],
      id: "deleted-online-rider",
      source: "online" as const,
    };
    const submitted = {
      ...workspace(event()),
      contestants: [...workspace(event()).contestants, onlineRider],
    };
    const current = {
      ...submitted,
      contestants: submitted.contestants.filter(
        (contestant) => contestant.id !== onlineRider.id,
      ),
    };
    const updated = mergeConcurrentSavedArenaData(
      submitted,
      current,
      submitted,
    );

    expect(updated.contestants).not.toContainEqual(
      expect.objectContaining({ id: onlineRider.id }),
    );
  });

  it("combines independent local and remote fields after a staff revision conflict", () => {
    const baseline = workspace(event({ name: "Original", status: "Upcoming" }));
    const local = {
      ...baseline,
      events: [event({ name: "Local Name", status: "Upcoming" })],
    };
    const remote = {
      ...baseline,
      revision: 2,
      staffRevision: 2,
      events: [event({ name: "Original", status: "Live" })],
    };

    const updated = mergeConcurrentSavedArenaData(baseline, local, remote);

    expect(updated.events[0]).toMatchObject({
      name: "Local Name",
      status: "Live",
    });
  });

  it("does not let a stale Wix response undo final-round Run Desk actions", () => {
    const competition = event({ rounds: 3, status: "Live" });
    const finalTeam = run({
      id: "final-team",
      round: 3,
      status: "ready",
      rawTime: null,
      predictionClosesAt: "2026-08-05T20:00:00.000Z",
      rolled: true,
    });
    const submitted = workspace(competition, [finalTeam]);
    const staleSaved = {
      ...submitted,
      revision: 2,
      staffRevision: 2,
      teams: [
        {
          ...finalTeam,
          predictionClosesAt: undefined,
          rolled: false,
        },
      ],
    };

    expect(mergeSavedArenaData(submitted, staleSaved).teams[0]).toMatchObject({
      id: "final-team",
      predictionClosesAt: "2026-08-05T20:00:00.000Z",
      rolled: true,
    });
  });

  it("keeps a rider created online when a stale workspace save returns", () => {
    const submitted = workspace(event());
    const rider = {
      ...submitted.contestants[0],
      id: "contestant-online",
      name: "Online Rider",
      source: "online" as const,
      submittedAt: "2026-08-06T23:22:00.000Z",
    };
    const saved = {
      ...submitted,
      revision: 2,
      onlineRevision: 1,
      contestants: [...submitted.contestants, rider],
    };

    expect(mergeSavedArenaData(submitted, saved).contestants).toContainEqual(
      expect.objectContaining({
        id: rider.id,
        name: rider.name,
        source: "online",
        submittedAt: rider.submittedAt,
      }),
    );
  });
});

describe("public grouping and privacy", () => {
  const today = new Date(2026, 7, 3);
  it("formats entry horse names only when present", () => {
    expect(publicHorseNamesLabel([])).toBe("");
    expect(publicHorseNamesLabel(["Ace"])).toBe("Horse: Ace");
    expect(publicHorseNamesLabel(["Ace", "Blue"])).toBe(
      "Horses: Ace, Blue",
    );
  });

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

  it("projects safe registered riders by role without duplicates or private fields", () => {
    const extraContestant: Contestant = {
      ...contestants[0],
      id: "both",
      name: "Cal Both",
      role: "Both",
      photo: "https://example.com/private.jpg",
      horses: ["Profile Horse"],
      email: "cal@example.com",
      phone: "867-5309",
      hometown: "Private Place",
    };
    const data = {
      ...workspace(event(), [
        run({ headerHorseName: "Bravo", heelerHorseName: "Delta" }),
        run({
          id: "duplicate-team",
          drawPosition: 2,
          headerHorseName: "Alpha",
          heelerHorseName: "Echo",
        }),
        run({ id: "generated-team", headerId: "both", generated: true }),
        run({ id: "scratched-team", heelerId: "both", scratched: true }),
        run({ id: "later-round", headerId: "both", round: 2 }),
      ]),
      contestants: [...contestants, extraContestant],
      registrations: [
        {
          id: "header-registration",
          eventId: "competition-1",
          contestantId: "both",
          role: "Header" as const,
          horseName: "  Ace  ",
          entries: 2,
          checkedIn: false,
          status: "entered" as const,
          notes: "do not publish",
        },
        {
          id: "heeler-registration",
          eventId: "competition-1",
          contestantId: "both",
          role: "Heeler" as const,
          horseName: "Switch",
          entries: 1,
          checkedIn: false,
          status: "entered" as const,
          notes: "do not publish",
        },
        {
          id: "scratched-registration",
          eventId: "competition-1",
          contestantId: "header",
          role: "Heeler" as const,
          entries: 1,
          checkedIn: false,
          status: "scratched" as const,
          notes: "do not publish",
        },
        {
          id: "duplicate-horse-registration",
          eventId: "competition-1",
          contestantId: "both",
          role: "Header" as const,
          horseName: "Ace",
          entries: 1,
          checkedIn: false,
          status: "entered" as const,
          notes: "",
        },
      ],
    };

    const registeredRiders =
      projectPublicArenaData(data, today).competitions[0].registeredRiders;
    expect(registeredRiders).toEqual({
      headers: [
        {
          id: "header",
          name: "Ada Header",
          photo: "data:image/png;base64,secret",
          horseNames: ["Alpha", "Bravo"],
        },
        {
          id: "both",
          name: "Cal Both",
          photo: undefined,
          horseNames: ["Ace"],
        },
      ],
      heelers: [
        {
          id: "heeler",
          name: "Bo Heeler",
          photo: undefined,
          horseNames: ["Delta", "Echo"],
        },
        {
          id: "both",
          name: "Cal Both",
          photo: undefined,
          horseNames: ["Switch"],
        },
      ],
    });
    const serialized = JSON.stringify(registeredRiders);
    expect(serialized).not.toContain("cal@example.com");
    expect(serialized).not.toContain("867-5309");
    expect(serialized).not.toContain("Private Place");
    expect(serialized).not.toContain("do not publish");
    expect(serialized).not.toContain("Profile Horse");
  });

  it("projects entered positive-entry Round Robin capacities independently", () => {
    const data = workspace(
      event({
        competitionType: "round-robin",
        maxHeaders: 5,
        maxHeelers: undefined,
      }),
    );
    data.registrations = [
      {
        id: "entered-header",
        eventId: "competition-1",
        contestantId: "header",
        role: "Header",
        entries: 2,
        checkedIn: false,
        status: "entered",
        notes: "",
      },
      {
        id: "waitlisted-header",
        eventId: "competition-1",
        contestantId: "header",
        role: "Header",
        entries: 8,
        checkedIn: false,
        status: "waitlist",
        notes: "",
      },
      {
        id: "invalid-header",
        eventId: "competition-1",
        contestantId: "header",
        role: "Header",
        entries: 0,
        checkedIn: false,
        status: "entered",
        notes: "",
      },
      {
        id: "entered-heeler",
        eventId: "competition-1",
        contestantId: "heeler",
        role: "Heeler",
        entries: 4,
        checkedIn: false,
        status: "entered",
        notes: "",
      },
    ];

    expect(projectPublicArenaData(data, today).competitions[0].roleCapacities)
      .toEqual([
        {
          role: "Header",
          registered: 2,
          maximum: 5,
          full: false,
        },
      ]);
  });

  it("omits capacities for unlimited legacy and non-Round Robin events", () => {
    expect(
      projectPublicArenaData(
        workspace(event({ competitionType: "round-robin" })),
        today,
      ).competitions[0].roleCapacities,
    ).toBeUndefined();
    expect(
      projectPublicArenaData(
        workspace(event({ competitionType: "draw-pot", maxHeaders: 5 })),
        today,
      ).competitions[0].roleCapacities,
    ).toBeUndefined();
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

  it("projects the Run Desk active team and excludes rolled teams", () => {
    const projected = projectPublicArenaData(
      workspace(
        event({
          status: "Live",
          activeRunId: "active-team",
          activeRound: 1,
        }),
        [
          run({
            id: "rolled-team",
            status: "ready",
            rawTime: null,
            rolled: true,
          }),
          run({
            id: "active-team",
            drawPosition: 2,
            status: "ready",
            rawTime: null,
          }),
          run({
            id: "future-round-team",
            round: 2,
            status: "ready",
            rawTime: null,
          }),
        ],
      ),
      today,
    );
    const competition = projected.competitions[0];

    expect(competition.activePredictionRunId).toBe("active-team");
    expect(competition.predictionRuns.map((prediction) => prediction.id)).toEqual([
      "active-team",
    ]);
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

describe("multi-round Run Desk results", () => {
  it("keeps a Round 2 Round Robin score and leaves the next team ready", () => {
    const competition = event({
      competitionType: "round-robin",
      rounds: 2,
      shortGoTeams: 0,
    });
    const roundOneTeams = [
      run({
        id: "round-1-team-1",
        drawPosition: 1,
        status: "complete",
        rawTime: 8,
        penalties: 0,
        predictionClosesAt: "2026-08-05T18:00:00.000Z",
      }),
      run({
        id: "round-1-team-2",
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
        drawPosition: 2,
        status: "complete",
        rawTime: 9,
        penalties: 0,
        predictionClosesAt: "2026-08-05T18:05:00.000Z",
      }),
    ];
    const withFinalists = applyRunResult(
      roundOneTeams,
      "round-1-team-2",
      { status: "complete", rawTime: 9, penalties: 0 },
      2,
      0,
      competition,
      contestants,
    );
    const roundTwoTeams = withFinalists.filter((team) => team.round === 2);
    expect(roundTwoTeams).toHaveLength(2);
    expect(roundTwoTeams.map((team) => team.originalTeamNumber).sort()).toEqual([
      1,
      2,
    ]);
    expect(roundTwoTeams.every((team) => team.predictionClosesAt === undefined))
      .toBe(true);

    const scoredTeam = roundTwoTeams[0];
    const nextTeams = applyRunResult(
      withFinalists,
      scoredTeam.id,
      { status: "complete", rawTime: 7.5, penalties: 0, points: 1 },
      2,
      0,
      competition,
      contestants,
    );

    expect(nextTeams.find((team) => team.id === scoredTeam.id)).toMatchObject({
      round: 2,
      status: "complete",
      rawTime: 7.5,
    });
    expect(
      nextTeams.filter((team) => team.round === 2 && team.status === "ready"),
    ).toHaveLength(1);
  });

  it("repairs inherited gates and saves Pick Only 11 Round 2 scores", () => {
    const competition = event({
      name: "Pick Only 11",
      competitionType: "pick-only",
      status: "Live",
      rounds: 2,
    });
    const inheritedCutoff = "2026-08-05T18:00:00.000Z";
    const teams = [
      run({ predictionClosesAt: inheritedCutoff }),
      run({
        id: "pick-only-11-round-2-a",
        round: 2,
        status: "ready",
        rawTime: null,
        predictionClosesAt: inheritedCutoff,
      }),
      run({
        id: "pick-only-11-round-2-b",
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
        round: 2,
        drawPosition: 2,
        status: "ready",
        rawTime: null,
      }),
    ];
    const repaired = resetInheritedPredictionCutoffs(teams);
    expect(
      repaired.find((team) => team.id === "pick-only-11-round-2-a")
        ?.predictionClosesAt,
    ).toBeUndefined();

    const saved = applyRunResult(
      repaired,
      "pick-only-11-round-2-a",
      { status: "complete", rawTime: 8.25, penalties: 0, points: 1 },
      2,
      0,
      competition,
      contestants,
    );
    expect(
      saved.find((team) => team.id === "pick-only-11-round-2-a"),
    ).toMatchObject({ status: "complete", rawTime: 8.25 });
    expect(
      saved.find((team) => team.id === "pick-only-11-round-2-b"),
    ).toMatchObject({ status: "ready" });
  });

  it("keeps final-round IDs, closed gates, and rolled state during reconciliation", () => {
    const competition = event({ status: "Live", rounds: 3 });
    const completedTeams = [
      run({ id: "r1-a", originalTeamNumber: 1 }),
      run({
        id: "r1-b",
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
        drawPosition: 2,
        originalTeamNumber: 2,
      }),
      run({ id: "r2-a", round: 2, rawTime: 7 }),
      run({
        id: "r2-b",
        headerEntryNumber: 2,
        heelerEntryNumber: 2,
        round: 2,
        drawPosition: 2,
        rawTime: 9,
      }),
    ];
    const generated = applyRunResult(
      completedTeams,
      "r2-b",
      { status: "complete", rawTime: 9, penalties: 0 },
      3,
      0,
      competition,
      contestants,
    );
    const finalTeam = generated.find((team) => team.round === 3)!;
    const cutoff = "2026-08-05T19:00:00.000Z";
    const withRunDeskState = generated.map((team) =>
      team.id === finalTeam.id
        ? { ...team, predictionClosesAt: cutoff, rolled: true }
        : team,
    );

    const reconciled = reconcileQualifiedAdvancements(
      withRunDeskState,
      [competition],
      contestants,
    );
    expect(reconciled.find((team) => team.id === finalTeam.id)).toMatchObject({
      round: 3,
      status: "ready",
      predictionClosesAt: cutoff,
      rolled: true,
    });
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

  it("enforces separate Round Robin Header and Heeler capacities", () => {
    const roundRobin = workspace(
      event({
        competitionType: "round-robin",
        entriesAllowed: 5,
        maxHeaders: 2,
        maxHeelers: 1,
      }),
    );
    roundRobin.registrations = [
      {
        id: "existing-header",
        eventId: "competition-1",
        contestantId: "partner",
        role: "Header",
        entries: 2,
        checkedIn: false,
        status: "entered",
        notes: "",
      },
    ];

    expect(() =>
      createOnlineSignup(roundRobin, {
        submissionId: "full-header-entry",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        entries: 1,
      }, beforeCutoff),
    ).toThrow("Header registration is full");
    expect(
      createOnlineSignup(roundRobin, {
        submissionId: "available-heeler-entry",
        contestantId: "heeler",
        eventId: "competition-1",
        role: "Heeler",
        entries: 1,
      }, beforeCutoff).registrations,
    ).toHaveLength(1);
  });

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

  it("always draws both Pick and Draw positions and places picked teams last", () => {
    const competition = event({
      competitionType: "pick-and-draw",
      pickDrawRole: "header",
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

  it("accepts either draw position regardless of legacy draw assignment", () => {
    const data = workspace(event({
      competitionType: "pick-and-draw",
      pickDrawRole: "header",
      entriesAllowed: 3,
    }));

    const created = createOnlineSignup(data, {
      submissionId: "both-draw-positions",
      contestantId: "heeler",
      eventId: "competition-1",
      role: "Heeler",
      drawRole: "Heeler",
      entries: 1,
    });

    expect(created.registrations[0]).toMatchObject({
      contestantId: "heeler",
      role: "Heeler",
    });
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

  it("validates and saves the authenticated contestant's horse", () => {
    const fixed = createOnlineSignup(workspace(event()), {
      submissionId: "horse-team",
      contestantId: "header",
      eventId: "competition-1",
      role: "Header",
      partnerId: "heeler",
      horseName: " blue ",
    });
    expect(fixed.teams[0].headerHorseName).toBe("Blue");
    expect(fixed.teams[0].heelerHorseName).toBeUndefined();

    expect(() =>
      createOnlineSignup(workspace(event()), {
        submissionId: "unknown-horse",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        partnerId: "heeler",
        horseName: "Not Mine",
      }),
    ).toThrow("saved on this contestant profile");

    const draw = createOnlineSignup(
      workspace(event({ competitionType: "draw-pot" })),
      {
        submissionId: "horse-registration",
        contestantId: "header",
        eventId: "competition-1",
        role: "Header",
        entries: 1,
        horseName: "Blue",
      },
    );
    expect(draw.registrations[0].horseName).toBe("Blue");
  });

  it("carries registration horses into generated draw teams", () => {
    const competition = event({ competitionType: "draw-pot" });
    const data = workspace(competition);
    data.registrations = [
      { id: "header-horse", eventId: competition.id, contestantId: "header", horseName: "Blue", role: "Header", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
      { id: "heeler-horse", eventId: competition.id, contestantId: "heeler", horseName: "Star", role: "Heeler", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
    ];

    const draw = generateCompetitionDraw(
      competition,
      data.registrations,
      [],
      data.contestants,
    );
    expect(draw[0]).toMatchObject({
      headerHorseName: "Blue",
      heelerHorseName: "Star",
    });
  });

  it("keeps each generated slot's source-registration horse", () => {
    const competition = event({
      competitionType: "draw-pot",
      allowRepeatPartners: true,
    });
    const data = workspace(competition);
    data.contestants[0].horses = ["Blue", "Red"];
    data.registrations = [
      { id: "header-blue", eventId: competition.id, contestantId: "header", horseName: "Blue", role: "Header", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
      { id: "header-red", eventId: competition.id, contestantId: "header", horseName: "Red", role: "Header", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
      { id: "heeler-star", eventId: competition.id, contestantId: "heeler", horseName: "Star", role: "Heeler", entries: 1, checkedIn: true, status: "entered", notes: "", paid: true },
    ];

    const draw = generateCompetitionDraw(
      competition,
      data.registrations,
      [],
      data.contestants,
    );
    expect(draw.map((team) => team.headerHorseName).sort()).toEqual(["Blue", "Red"]);
  });

  it("returns an existing signup even if the saved horse list changed", () => {
    const data = workspace(event());
    data.teams = [
      run({
        id: "online-team-retry-horse",
        submissionId: "retry-horse",
        headerHorseName: "Blue",
      }),
    ];
    data.contestants[0].horses = [];

    const repeated = createOnlineSignup(data, {
      submissionId: "retry-horse",
      contestantId: "header",
      eventId: "competition-1",
      role: "Header",
      partnerId: "heeler",
      horseName: "Blue",
    });
    expect(repeated.existing).toBe(true);
    expect(repeated.teams[0].headerHorseName).toBe("Blue");
  });
});

describe("workspace compatibility", () => {
  it("defaults legacy ropings without newer registration limits", () => {
    const legacy = workspace();
    delete (legacy.events[0] as Partial<ArenaEvent>).maxContestantHandicap;
    delete (legacy.events[0] as Partial<ArenaEvent>).minDrawsAllowed;
    delete (legacy.events[0] as Partial<ArenaEvent>).maxHeaders;
    delete (legacy.events[0] as Partial<ArenaEvent>).maxHeelers;
    delete (legacy.contestants[0] as Partial<Contestant>).headerHandicap;
    legacy.contestants[0].heelerHandicap = 0;

    expect(normalizeData(legacy).events[0].handicapTotal).toBe(20);
    expect(normalizeData(legacy).events[0].maxContestantHandicap).toBe(10);
    expect(normalizeData(legacy).events[0].minDrawsAllowed).toBe(0);
    expect(normalizeData(legacy).events[0].maxHeaders).toBeUndefined();
    expect(normalizeData(legacy).events[0].maxHeelers).toBeUndefined();
    expect(normalizeData(legacy).events[0].pickDrawRole).toBe("both");
    expect(normalizeData(legacy).contestants[0]).toMatchObject({
      headerHandicap: 3,
      heelerHandicap: 3,
    });
  });

  describe("spectator predictions", () => {
    const now = new Date("2026-08-04T18:00:00Z");

    it("accepts one free pick per display name before cutoff", () => {
      const activeRun = run({
        status: "ready",
        rawTime: null,
        predictionClosesAt: "2026-08-04T18:05:00Z",
      });
      const competition = event({
        status: "Live",
        activeRunId: activeRun.id,
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
      const currentRun = run({
        status: "ready",
        rawTime: null,
        predictionClosesAt: undefined,
      });
      const competition = event({
        status: "Live",
        activeRunId: currentRun.id,
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

    it("does not project a ready team when Run Desk has no active team", () => {
      const competition = event({ status: "Live", activeRunId: undefined });
      const readyRun = run({ status: "ready", rawTime: null });

      expect(projectPublicArenaData(workspace(competition, [readyRun]), now)
        .competitions[0]).toMatchObject({
          activePredictionRunId: undefined,
          predictionRuns: [expect.objectContaining({ id: readyRun.id })],
        });
    });

    it("removes rolled teams and rejects stale prediction requests", () => {
      const competition = event({ status: "Live", activeRunId: "team-1" });
      const rolledRun = run({
        status: "ready",
        rawTime: null,
        rolled: true,
      });
      const data = workspace(competition, [rolledRun]);

      expect(projectPublicArenaData(data, now).competitions[0]).toMatchObject({
        activePredictionRunId: undefined,
        predictionRuns: [],
      });
      expect(() =>
        createSpectatorPrediction(
          data,
          {
            name: "Taylor Fan",
            eventId: competition.id,
            teamId: rolledRun.id,
            choice: "cowboys",
          },
          now,
        ),
      ).toThrow("closed");
    });

    it("rejects predictions for ready teams that are not active at Run Desk", () => {
      const competition = event({
        status: "Live",
        activeRunId: "active-team",
        activeRound: 1,
      });
      const data = workspace(competition, [
        run({ id: "active-team", status: "ready", rawTime: null }),
        run({
          id: "future-team",
          drawPosition: 2,
          status: "ready",
          rawTime: null,
        }),
      ]);

      expect(() =>
        createSpectatorPrediction(
          data,
          {
            name: "Taylor Fan",
            eventId: competition.id,
            teamId: "future-team",
            choice: "cowboys",
          },
          now,
        ),
      ).toThrow("not active");
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

    it("combines spectator scores across all rounds", () => {
      expect(
        aggregatePublicSpectatorLeaderboard([
          { name: "Taylor Fan", round: 1, picks: 2, correct: 2 },
          { name: "Morgan Fan", round: 1, picks: 2, correct: 1 },
          { name: "Taylor Fan", round: 2, picks: 3, correct: 1 },
          { name: "Morgan Fan", round: 2, picks: 3, correct: 3 },
        ]),
      ).toEqual([
        { name: "Morgan Fan", round: 0, picks: 5, correct: 4 },
        { name: "Taylor Fan", round: 0, picks: 5, correct: 3 },
      ]);
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
