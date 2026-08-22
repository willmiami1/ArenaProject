import { describe, expect, it } from "vitest";
import { defaultCompetitionSettings } from "./competition";
import {
  positionCheckFileName,
  positionCheckHtml,
  riderPostingFileName,
  riderPostingHtml,
} from "./drawReports";
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
  { id: "ada", name: "Ada <Header>", role: "Header", headerHandicap: 4, heelerHandicap: 0, photo: "", phone: "", hometown: "" },
  { id: "bo", name: "Bo & Heeler", role: "Heeler", headerHandicap: 0, heelerHandicap: 5, photo: "", phone: "", hometown: "" },
  { id: "cy", name: "Cy Both", role: "Both", headerHandicap: 3, heelerHandicap: 2, photo: "", phone: "", hometown: "" },
];

const team = (overrides: Partial<Team> = {}): Team => ({
  id: "team-1",
  eventId: event.id,
  headerId: "ada",
  heelerId: "bo",
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

describe("position check report", () => {
  it("lists headers on one side and heelers on the other, alphabetically with entry counts", () => {
    const html = positionCheckHtml(
      event,
      [
        team({ id: "t1", drawPosition: 1 }),
        team({ id: "t2", drawPosition: 2, headerId: "cy", heelerId: "bo" }),
        team({ id: "t3", drawPosition: 3, headerId: "ada", heelerId: "cy" }),
        team({ id: "scratched", drawPosition: 4, scratched: true }),
        team({ id: "round2", drawPosition: 5, round: 2 }),
      ],
      contestants,
    );

    expect(html).toContain("Header / Heeler Position Check");
    expect(html).toContain("Headers (3 entries)");
    expect(html).toContain("Heelers (3 entries)");
    // Ada heads twice → one row with 2 entries
    expect(html).toContain('<td class="entries">2</td>');
    // Cy appears on both sides
    expect(html.match(/Cy Both/g)?.length).toBe(2);
    // scratched and round-2 teams excluded → Ada has 2 header entries, not 4
    expect(html).toContain("3 teams");
  });

  it("marks free-run entries and escapes names", () => {
    const html = positionCheckHtml(
      event,
      [team({ heelerFreeRun: true })],
      contestants,
    );

    expect(html).toContain("Bo &amp; Heeler <b class=\"fr\">FR</b>");
    expect(html).toContain("Ada &lt;Header&gt;");
    expect(html).not.toContain("Ada <Header>");
  });

  it("creates a safe downloadable file name", () => {
    expect(positionCheckFileName("Tuesday Roping #4")).toBe(
      "tuesday-roping-4-position-check.html",
    );
  });
});

describe("rider posting report", () => {
  it("lists riders alphabetically with team number, partner, and handicap total under each name", () => {
    const html = riderPostingHtml(
      event,
      [
        team({ id: "t1", drawPosition: 2, originalTeamNumber: 2 }),
        team({ id: "t2", drawPosition: 1, originalTeamNumber: 1, headerId: "cy", heelerId: "bo" }),
      ],
      contestants,
    );

    expect(html).toContain("Rider Posting List");
    const ada = html.indexOf("Ada &lt;Header&gt;");
    const bo = html.indexOf("<h2>Bo &amp; Heeler</h2>");
    const cy = html.indexOf("<h2>Cy Both</h2>");
    expect(ada).toBeGreaterThan(-1);
    expect(bo).toBeGreaterThan(ada);
    expect(cy).toBeGreaterThan(bo);
    // Ada heads team 2 with Bo, HC 4 + 5 = 9
    expect(html).toContain("Team 2 · Heading for Bo &amp; Heeler · HC 9");
    // Bo heels team 1 for Cy, HC 3 + 5 = 8
    expect(html).toContain("Team 1 · Heeling for Cy Both · HC 8");
    expect(html).toContain("3 riders · 2 teams");
  });

  it("bolds free runs", () => {
    const html = riderPostingHtml(
      event,
      [
        team({ id: "free", drawPosition: 1, headerFreeRun: true }),
        team({ id: "paid", drawPosition: 2, headerId: "cy", heelerId: "bo" }),
      ],
      contestants,
    );

    expect(html).toContain('<li class="free-run">Team 1 · Heading for Bo &amp; Heeler · HC 9 · FREE RUN</li>');
    expect(html).toContain('<li class="">Team 2 · Heading for Bo &amp; Heeler · HC 8</li>');
    expect(html).toContain(".rider li.free-run { font-weight: 700; }");
  });

  it("uses the original team number when the draw has been renumbered", () => {
    const html = riderPostingHtml(
      event,
      [team({ drawPosition: 9, originalTeamNumber: 4 })],
      contestants,
    );

    expect(html).toContain("Team 4 ·");
    expect(html).not.toContain("Team 9 ·");
  });

  it("creates a safe downloadable file name", () => {
    expect(riderPostingFileName("Tuesday Roping #4")).toBe(
      "tuesday-roping-4-rider-posting.html",
    );
  });
});
