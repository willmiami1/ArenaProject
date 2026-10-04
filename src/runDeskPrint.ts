import type { ArenaEvent, Contestant, Team } from "./types";

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export type TimeSheetSource = "draw" | "pick";

const sourceLabel = (source: TimeSheetSource) =>
  source === "pick" ? "Picked Teams" : "Draw Teams";

const sourceMatches = (team: Team, source: TimeSheetSource) =>
  source === "pick" ? !team.generated : !!team.generated;

export function roundTimeSheetFileName(
  eventName: string,
  round: number,
  source: TimeSheetSource = "draw",
) {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-round-${round}-${source === "pick" ? "picked-teams" : "draw"}-time-sheet.html`;
}

export function roundTimeSheetHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
  round: number,
  source: TimeSheetSource = "draw",
) {
  const contestantNames = new Map(
    contestants.map((contestant) => [contestant.id, contestant.name]),
  );
  const sheetTeams = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        team.round === round &&
        !team.scratched &&
        sourceMatches(team, source),
    )
    .sort((left, right) => left.drawPosition - right.drawPosition);
  const rows = sheetTeams
    .map((team) => {
      const header = contestantNames.get(team.headerId) ?? "Unknown";
      const heeler = contestantNames.get(team.heelerId) ?? "Unknown";
      return `<tr>
        <td class="draw">${team.originalTeamNumber ?? team.drawPosition}</td>
        <td>${escapeHtml(header)}${team.headerFreeRun ? " (FR)" : ""}</td>
        <td>${escapeHtml(heeler)}${team.heelerFreeRun ? " (FR)" : ""}</td>
        <td class="write"></td>
        <td class="write"></td>
        <td class="write"></td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(event.name)} - Round ${round} ${sourceLabel(source)} Time Sheet</title>
  <style>
    @page { size: portrait; margin: 8mm 9mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17201c; font: 11px Arial, sans-serif; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 6px; border-bottom: 3px solid #285f46; }
    h1 { margin: 0 0 2px; font-size: 18px; }
    header p { margin: 0; color: #58645d; font-size: 10px; }
    header strong { color: #285f46; font-size: 14px; white-space: nowrap; }
    table { width: 100%; margin-top: 8px; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { padding: 4px 5px; color: #fff; background: #285f46; border: 1px solid #285f46; font-size: 9px; text-align: left; text-transform: uppercase; }
    td { height: 24px; padding: 2px 5px; border: 1px solid #9fa8a2; vertical-align: middle; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .draw { width: 9%; font-size: 13px; font-weight: 700; text-align: center; }
    th:nth-child(2), th:nth-child(3) { width: 27%; }
    th:nth-child(4), th:nth-child(5) { width: 11%; }
    th:nth-child(6) { width: 15%; }
    .write { background: #fff; }
    footer { display: flex; justify-content: space-between; margin-top: 6px; color: #66716b; font-size: 8px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <p>${escapeHtml(event.date)} · ${escapeHtml(event.location)}</p>
    </div>
    <strong>Round ${round} ${sourceLabel(source)} Time Sheet</strong>
  </header>
  <table>
    <thead>
      <tr><th>Original Team #</th><th>Header</th><th>Heeler</th><th>Raw Time</th><th>Penalty</th><th>Total / NT</th></tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="6">No ${source === "pick" ? "picked" : "draw"} teams in this round.</td></tr>`}</tbody>
  </table>
  <footer><span>Destiny Ranch Arena · Record times on paper, then enter them in Run Desk.</span><span>${sheetTeams.length} ${source === "pick" ? "picked" : "draw"} teams</span></footer>
</body>
</html>`;
}
