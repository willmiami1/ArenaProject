import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clearSpectatorScoreboard, clearTeamPredictions } from "./spectatorPredictions";
import { sensitiveWixAction } from "./wixBridge";

const prediction = (id, eventId, overrides = {}) => ({
  id,
  spectatorId: `spectator-${id}`,
  eventId,
  teamId: `team-${id}`,
  round: 1,
  choice: "cowboys",
  submittedAt: "2026-08-18T12:00:00.000Z",
  ...overrides,
});

describe("Cowboys × Steer scoreboard reset", () => {
  it("clears every pick for the roping across all rounds and keeps other events", () => {
    const predictions = [
      prediction("a", "event-1", { round: 1 }),
      prediction("b", "event-1", { round: 2, choice: "steer" }),
      prediction("c", "event-2"),
    ];
    const result = clearSpectatorScoreboard(
      { spectatorPredictions: predictions },
      "event-1",
    );
    expect(result.cleared).toBe(2);
    expect(result.spectatorPredictions).toEqual([predictions[2]]);
  });

  it("reports zero cleared picks when the roping has no scoreboard data", () => {
    const predictions = [prediction("a", "event-2")];
    const result = clearSpectatorScoreboard(
      { spectatorPredictions: predictions },
      "event-1",
    );
    expect(result.cleared).toBe(0);
    expect(result.spectatorPredictions).toEqual(predictions);
  });

  it("treats the scoreboard reset as a sensitive Wix action", () => {
    expect(sensitiveWixAction("resetSpectatorScoreboard")).toBe(true);
  });

  it("wires the reset through the Wix backend and page relay", () => {
    const backend = readFileSync(
      new URL("../wix/backend/arena-data.web.js", import.meta.url),
      "utf8",
    );
    expect(backend).toContain("export const resetSpectatorScoreboard = webMethod(");
    expect(backend).toMatch(
      /resetSpectatorScoreboard = webMethod\(\s*Permissions\.SiteMember,\s*async \(request\) => \{\s*await requireArenaAdmin\(\);/,
    );
    expect(backend).toContain(
      "[WORKSPACE_MUTATION_LOCK_RESOURCE, request.eventId],",
    );

    const pageCode = readFileSync(
      new URL("../wix/page-code.js", import.meta.url),
      "utf8",
    );
    expect(pageCode).toContain('message.action === "resetSpectatorScoreboard"');
    expect(pageCode).toContain(
      "data = await resetSpectatorScoreboard(message.data);",
    );
  });
});

describe("Referee re-run pick reset", () => {
  it("clears only the re-run team's picks and keeps everyone else's", () => {
    const predictions = [
      prediction("a", "event-1", { teamId: "team-x", round: 1 }),
      prediction("b", "event-1", { teamId: "team-x", round: 1, choice: "steer" }),
      prediction("c", "event-1", { teamId: "team-y" }),
      prediction("d", "event-2", { teamId: "team-x" }),
    ];
    const result = clearTeamPredictions(
      { spectatorPredictions: predictions },
      "team-x",
    );
    expect(result.cleared).toBe(3);
    expect(result.spectatorPredictions).toEqual([predictions[2]]);
  });

  it("reports zero cleared picks when nobody picked the team", () => {
    const predictions = [prediction("a", "event-1", { teamId: "team-y" })];
    const result = clearTeamPredictions(
      { spectatorPredictions: predictions },
      "team-x",
    );
    expect(result.cleared).toBe(0);
    expect(result.spectatorPredictions).toEqual(predictions);
  });

  it("treats the team pick reset as a sensitive Wix action", () => {
    expect(sensitiveWixAction("clearTeamSpectatorPredictions")).toBe(true);
  });

  it("wires the team pick reset through the Wix backend and page relay", () => {
    const backend = readFileSync(
      new URL("../wix/backend/arena-data.web.js", import.meta.url),
      "utf8",
    );
    expect(backend).toContain(
      "export const clearTeamSpectatorPredictions = webMethod(",
    );
    expect(backend).toMatch(
      /clearTeamSpectatorPredictions = webMethod\(\s*Permissions\.SiteMember,\s*async \(request\) => \{\s*await requireArenaAdmin\(\);/,
    );
    expect(backend).toContain(
      "(!teamId || payload?.teamId === teamId)",
    );

    const pageCode = readFileSync(
      new URL("../wix/page-code.js", import.meta.url),
      "utf8",
    );
    expect(pageCode).toContain(
      'message.action === "clearTeamSpectatorPredictions"',
    );
    expect(pageCode).toContain(
      "data = await clearTeamSpectatorPredictions(message.data);",
    );
  });
});
