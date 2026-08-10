import { describe, expect, it } from "vitest";
import {
  assertSpectatorPredictionRunIsActive,
  effectivePublicPredictionState,
  publicPredictionRunProjection,
  publicRegisteredRiders,
} from "../wix/backend/public-prediction-projection.js";

const event = {
  id: "event",
  status: "Live",
  activeRound: 1,
  activeRunId: "run-1",
};

const team = {
  id: "run-1",
  eventId: event.id,
  round: 1,
  drawPosition: 2,
  headerId: "header",
  heelerId: "heeler",
  scratched: false,
  rolled: false,
  status: "ready",
};

const contestants = new Map([
  [team.headerId, { id: team.headerId, name: "Header" }],
  [team.heelerId, { id: team.heelerId, name: "Heeler" }],
]);

describe("Wix public prediction projection", () => {
  it("requires an exact eligible active run instead of falling back", () => {
    const eligibleRuns = [
      team,
      { ...team, id: "run-2", drawPosition: 1 },
    ];

    for (const activeRunId of [undefined, "", "removed-run"]) {
      const currentEvent = { ...event, activeRunId };
      const state = effectivePublicPredictionState(currentEvent, eligibleRuns);
      const projection = publicPredictionRunProjection(
        currentEvent,
        eligibleRuns,
        contestants,
      );

      expect(state.activeRun).toBeNull();
      expect(state.runs.map(({ id }) => id)).toEqual(["run-2", "run-1"]);
      expect(projection.predictionRuns.map(({ id }) => id)).toEqual([
        "run-2",
        "run-1",
      ]);
      expect(projection).not.toHaveProperty("activePredictionRunId");
    }
  });

  it("requires the active run to belong to the event and active round", () => {
    const wrongEvent = { ...team, eventId: "other-event" };
    const nextRound = { ...team, round: 2 };

    expect(
      effectivePublicPredictionState(event, [wrongEvent]).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(event, [nextRound]).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(
        { ...event, activeRound: 2 },
        [team],
      ).activeRun,
    ).toBeNull();
    expect(
      effectivePublicPredictionState(
        { ...event, activeRound: 2 },
        [team, nextRound],
      ).activeRun?.round,
    ).toBe(2);
  });

  it("tracks exact active run changes without marking another run active", () => {
    const secondTeam = { ...team, id: "run-2", drawPosition: 1 };

    expect(
      effectivePublicPredictionState(event, [team, secondTeam]).activeRun?.id,
    ).toBe("run-1");
    expect(
      effectivePublicPredictionState(
        { ...event, activeRunId: "run-2" },
        [team, secondTeam],
      ).activeRun?.id,
    ).toBe("run-2");
  });

  it("rejects scratched, rolled, and non-ready active run IDs", () => {
    for (const ineligibleTeam of [
      { ...team, scratched: true },
      { ...team, rolled: true },
      { ...team, status: "completed" },
    ]) {
      expect(
        effectivePublicPredictionState(event, [ineligibleTeam]).activeRun,
      ).toBeNull();
    }
  });

  it("rejects submissions when the active run is missing or different", () => {
    const secondTeam = { ...team, id: "run-2" };

    for (const currentEvent of [
      { ...event, activeRunId: undefined },
      { ...event, activeRunId: "removed-run" },
      { ...event, activeRunId: secondTeam.id },
    ]) {
      expect(() =>
        assertSpectatorPredictionRunIsActive(
          currentEvent,
          team,
          [team, secondTeam],
        ),
      ).toThrowError("That run is not active at the Run Desk.");
    }
  });

  it("preserves availability and picks-open error precedence", () => {
    const inactiveEvent = { ...event, activeRunId: "other-run" };

    expect(() =>
      assertSpectatorPredictionRunIsActive(
        { ...inactiveEvent, status: "Upcoming" },
        team,
        [team],
      ),
    ).toThrowError("That live run is not available.");
    expect(() =>
      assertSpectatorPredictionRunIsActive(
        inactiveEvent,
        { ...team, status: "completed" },
        [team],
      ),
    ).toThrowError("Predictions are closed for this run.");
  });
});

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
});
