import { describe, expect, it } from "vitest";
import {
  assertSpectatorPredictionRunIsActive,
  effectivePublicPredictionState,
  publicPredictionRunProjection,
  publicRegisteredRiders,
  publicRoundRobinRoleCapacities,
} from "../wix/backend/public-prediction-projection.js";

const predictionEvent = {
  id: "event",
  status: "Live",
  activeRound: 1,
  activeRunId: "run-1",
};

const predictionTeam = {
  id: "run-1",
  eventId: predictionEvent.id,
  round: 1,
  drawPosition: 2,
  headerId: "header",
  heelerId: "heeler",
  status: "ready",
};

const predictionContestants = new Map([
  ["header", { id: "header", name: "Header" }],
  ["heeler", { id: "heeler", name: "Heeler" }],
]);

describe("Wix public registered rider projection", () => {
  it("matches role, eligibility, dedupe, sorting, and privacy rules", () => {
    const contestants = new Map([
      ["header", { id: "header", name: "Ada Header", photo: "data:image/png;base64,a", email: "private@example.com" }],
      ["heeler", { id: "heeler", name: "Bo Heeler", photo: "" }],
      ["both", { id: "both", name: "Cal Both", photo: "https://example.com/not-safe.jpg", horses: ["Profile Horse"] }],
    ]);
    const registrations = [
      { eventId: "event", contestantId: "both", role: "Header", status: "entered", horseName: " Ace " },
      { eventId: "event", contestantId: "both", role: "Header", status: "entered", horseName: "Ace" },
      { eventId: "event", contestantId: "both", role: "Heeler", status: "entered", horseName: "Switch" },
      { eventId: "event", contestantId: "header", role: "Heeler", status: "scratched" },
    ];
    const teams = [
      { eventId: "event", round: 1, headerId: "header", heelerId: "heeler", headerHorseName: "Bravo", heelerHorseName: "Delta", generated: false, scratched: false },
      { eventId: "event", round: 1, headerId: "header", heelerId: "heeler", headerHorseName: "Alpha", heelerHorseName: "Echo", generated: false, scratched: false },
      { eventId: "event", round: 1, headerId: "both", heelerId: "both", generated: true, scratched: false },
      { eventId: "event", round: 2, headerId: "both", heelerId: "both", generated: false, scratched: false },
    ];

    const projected = publicRegisteredRiders(
      "event",
      registrations,
      teams,
      contestants,
    );

    expect(projected).toEqual({
      headers: [
        { id: "header", name: "Ada Header", photo: "data:image/png;base64,a", horseNames: ["Alpha", "Bravo"] },
        { id: "both", name: "Cal Both", photo: undefined, horseNames: ["Ace"] },
      ],
      heelers: [
        { id: "heeler", name: "Bo Heeler", photo: undefined, horseNames: ["Delta", "Echo"] },
        { id: "both", name: "Cal Both", photo: undefined, horseNames: ["Switch"] },
      ],
    });

    expect(JSON.stringify(projected)).not.toContain("private@example.com");
    expect(JSON.stringify(projected)).not.toContain("Profile Horse");
  });

  it("shows open-tab riders but hides fully unpaid entries", () => {
    const contestants = new Map([
      ["tab-rider", { id: "tab-rider", name: "Harrison Teixeira" }],
      ["unpaid-rider", { id: "unpaid-rider", name: "Unpaid Rider" }],
      ["heeler", { id: "heeler", name: "Bo Heeler" }],
    ]);
    const registrations = [
      { eventId: "event", contestantId: "tab-rider", role: "Header", status: "entered", paid: false, paymentMethod: "tab" },
      { eventId: "event", contestantId: "unpaid-rider", role: "Header", status: "entered", paid: false, paymentMethod: "cash" },
    ];
    const teams = [
      { eventId: "event", round: 1, headerId: "tab-rider", heelerId: "heeler", generated: false, scratched: false, paid: false, paymentMethod: "tab" },
    ];

    const projected = publicRegisteredRiders(
      "event",
      registrations,
      teams,
      contestants,
    );

    expect(projected.headers.map(({ name }) => name)).toEqual([
      "Harrison Teixeira",
    ]);
    expect(projected.heelers.map(({ name }) => name)).toEqual(["Bo Heeler"]);
  });
});

describe("Wix public Round Robin capacities", () => {
  it("projects configured roles with entered positive-entry semantics", () => {
    const event = {
      id: "event",
      competitionType: "round-robin",
      maxHeaders: 5,
      maxHeelers: 4,
    };
    const registrations = [
      { eventId: "event", role: "Header", status: "entered", entries: 2 },
      { eventId: "event", role: "Header", status: "entered", entries: 4 },
      { eventId: "event", role: "Header", status: "waitlist", entries: 9 },
      { eventId: "event", role: "Heeler", status: "entered", entries: 0 },
      { eventId: "other", role: "Heeler", status: "entered", entries: 4 },
    ];

    expect(publicRoundRobinRoleCapacities(event, registrations)).toEqual([
      {
        role: "Header",
        registered: 6,
        maximum: 5,
        full: true,
      },
      {
        role: "Heeler",
        registered: 0,
        maximum: 4,
        full: false,
      },
    ]);
  });

  it("handles one-sided caps and omits unlimited legacy roles", () => {
    expect(
      publicRoundRobinRoleCapacities(
        {
          id: "event",
          competitionType: "round-robin",
          maxHeaders: 5,
        },
        [],
      ),
    ).toEqual([
      {
        role: "Header",
        registered: 0,
        maximum: 5,
        full: false,
      },
    ]);
    expect(
      publicRoundRobinRoleCapacities(
        { id: "event", competitionType: "round-robin" },
        [],
      ),
    ).toEqual([]);
  });
});

describe("Wix public prediction active run", () => {
  it("requires an exact eligible active ID without changing eligible runs", () => {
    const runs = [
      predictionTeam,
      { ...predictionTeam, id: "run-2", drawPosition: 1 },
    ];

    for (const activeRunId of [undefined, "", "stale-run"]) {
      const event = { ...predictionEvent, activeRunId };
      const state = effectivePublicPredictionState(event, runs);
      const projection = publicPredictionRunProjection(
        event,
        runs,
        predictionContestants,
      );

      expect(state.activeRun).toBeNull();
      expect(state.runs.map(({ id }) => id)).toEqual(["run-2", "run-1"]);
      expect(projection).not.toHaveProperty("activePredictionRunId");
      expect(projection.predictionRuns.map(({ id }) => id)).toEqual([
        "run-2",
        "run-1",
      ]);
    }
  });

  it("rejects active IDs from another event or round", () => {
    const wrongEvent = { ...predictionTeam, eventId: "other-event" };
    const nextRound = { ...predictionTeam, round: 2 };

    expect(
      effectivePublicPredictionState(predictionEvent, [wrongEvent]).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(predictionEvent, [nextRound]).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(
        { ...predictionEvent, activeRound: 2 },
        [predictionTeam],
      ).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(
        { ...predictionEvent, activeRound: 2 },
        [predictionTeam, nextRound],
      ).activeRun?.round,
    ).toBe(2);
  });

  it("tracks exact active ID changes", () => {
    const secondTeam = { ...predictionTeam, id: "run-2", drawPosition: 1 };

    expect(
      effectivePublicPredictionState(
        predictionEvent,
        [predictionTeam, secondTeam],
      ).activeRun?.id,
    ).toBe("run-1");
    expect(
      effectivePublicPredictionState(
        { ...predictionEvent, activeRunId: "run-2" },
        [predictionTeam, secondTeam],
      ).activeRun?.id,
    ).toBe("run-2");
  });

  it("rejects scratched, rolled, and non-ready active IDs", () => {
    for (const ineligibleTeam of [
      { ...predictionTeam, scratched: true },
      { ...predictionTeam, rolled: true },
      { ...predictionTeam, status: "completed" },
    ]) {
      expect(
        effectivePublicPredictionState(
          predictionEvent,
          [ineligibleTeam],
        ).activeRun,
      ).toBeNull();
    }
  });

  it("rejects submissions without the exact active run", () => {
    const secondTeam = { ...predictionTeam, id: "run-2" };

    for (const event of [
      { ...predictionEvent, activeRunId: undefined },
      { ...predictionEvent, activeRunId: "stale-run" },
      { ...predictionEvent, activeRunId: secondTeam.id },
    ]) {
      expect(() =>
        assertSpectatorPredictionRunIsActive(event, predictionTeam, [
          predictionTeam,
          secondTeam,
        ]),
      ).toThrow("That run is not active at the Run Desk.");
    }
  });

  it("preserves availability and picks-open rejection order", () => {
    const nonmatchingEvent = {
      ...predictionEvent,
      activeRunId: "other-run",
    };

    expect(() =>
      assertSpectatorPredictionRunIsActive(
        { ...nonmatchingEvent, status: "Upcoming" },
        predictionTeam,
        [predictionTeam],
      ),
    ).toThrow("That live run is not available.");
    expect(() =>
      assertSpectatorPredictionRunIsActive(
        nonmatchingEvent,
        { ...predictionTeam, status: "completed" },
        [predictionTeam],
      ),
    ).toThrow("Predictions are closed for this run.");
  });
});
