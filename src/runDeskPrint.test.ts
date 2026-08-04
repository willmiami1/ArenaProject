import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import { roundTimeSheetHtml } from "./runDeskPrint";
import type { ArenaEvent, Contestant, Team } from "./types";

const event: ArenaEvent = {
  ...defaultCompetitionSettings,
  id: "event-1",
  parentEventId: "meet-1",
  name: "Tuesday Roping",
  date: "2026-08-04",
  startTime: "18:00",
  location: "Destiny Ranch Arena",
  status: "Live",
  entryFee: 100,
};

const contestants: Contestant[] = [
  { id: "header", name: "Ada <Header>", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "", phone: "", hometown: "" },
  { id: "heeler", name: "Bo & Heeler", role: "Heeler", headerHandicap: 0, heelerHandicap: 4, photo: "", phone: "", hometown: "" },
];

const team = (overrides: Partial<Team> = {}): Team => ({
  id: "team-1",
  eventId: event.id,
  headerId: "header",
  heelerId: "heeler",
  drawPosition: 1,
  status: "ready",
  rawTime: null,
  penalties: 0,
  notes: "",
  round: 1,
  checkedIn: true,
  scratched: false,
  generated: true,
  points: 0,
  ...overrides,
});

describe("Run Desk manual time sheet", () => {
  it("prints only the requested round in draw order with blank entry columns", () => {
    const html = roundTimeSheetHtml(
      event,
      [
        team({ id: "second", drawPosition: 2 }),
        team({ id: "first", drawPosition: 1 }),
        team({ id: "later", round: 2 }),
        team({ id: "scratched", drawPosition: 3, scratched: true }),
      ],
      contestants,
      1,
    );

    expect(html).toContain("Round 1 Manual Time Sheet");
    expect(html).toContain("Raw Time");
    expect(html).not.toContain("No teams in this round.");
    expect(html.match(/Ada &lt;Header&gt;/g)).toHaveLength(2);
    expect(html).not.toContain("scratched");
  });

  it("escapes contestant names before writing the printable document", () => {
    const html = roundTimeSheetHtml(event, [team()], contestants, 1);

    expect(html).toContain("Ada &lt;Header&gt;");
    expect(html).toContain("Bo &amp; Heeler");
    expect(html).not.toContain("Ada <Header>");
  });
});
