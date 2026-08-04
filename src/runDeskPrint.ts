import type { ArenaEvent, Contestant, Team } from "./types";

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function roundTimeSheetFileName(eventName: string, round: number) {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-round-${round}-time-sheet.html`;
}

export function roundTimeSheetHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
  round: number,
) {
  const contestantNames = new Map(
    contestants.map((contestant) => [contestant.id, contestant.name]),
  );
  const rows = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        team.round === round &&
        !team.scratched,
    )
    .sort((left, right) => left.drawPosition - right.drawPosition)
    .map((team) => {
      const header = contestantNames.get(team.headerId) ?? "Unknown";
      const heeler = contestantNames.get(team.heelerId) ?? "Unknown";
      return `<tr>
        <td class="draw">${team.drawPosition}</td>
        <td>${escapeHtml(header)}${team.headerFreeRun ? " (FR)" : ""}</td>
        <td>${escapeHtml(heeler)}${team.heelerFreeRun ? " (FR)" : ""}</td>
        <td>${escapeHtml(team.steerNumber ?? "")}</td>
        <td class="write"></td>
        <td class="write"></td>
        <td class="write"></td>
        <td class="notes"></td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(event.name)} - Round ${round} Time Sheet</title>
  <style>
    @page { size: landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17201c; font: 12px Arial, sans-serif; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding-bottom: 12px; border-bottom: 3px solid #285f46; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    header p { margin: 0; color: #58645d; }
    header strong { color: #285f46; font-size: 18px; }
    table { width: 100%; margin-top: 14px; border-collapse: collapse; table-layout: fixed; }
    th { padding: 7px 6px; color: #fff; background: #285f46; border: 1px solid #285f46; font-size: 10px; text-align: left; text-transform: uppercase; }
    td { height: 34px; padding: 5px 6px; border: 1px solid #9fa8a2; vertical-align: middle; }
    .draw { width: 6%; font-size: 15px; font-weight: 700; text-align: center; }
    th:nth-child(2), th:nth-child(3) { width: 18%; }
    th:nth-child(4) { width: 8%; }
    th:nth-child(5), th:nth-child(6), th:nth-child(7) { width: 10%; }
    th:nth-child(8) { width: 20%; }
    .write, .notes { background: #fff; }
    footer { display: flex; justify-content: space-between; margin-top: 10px; color: #66716b; font-size: 9px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <p>${escapeHtml(event.date)} · ${escapeHtml(event.location)}</p>
    </div>
    <strong>Round ${round} Manual Time Sheet</strong>
  </header>
  <table>
    <thead>
      <tr><th>Draw</th><th>Header</th><th>Heeler</th><th>Steer</th><th>Raw Time</th><th>Penalty</th><th>Total / NT</th><th>Notes</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="8">No teams in this round.</td></tr>'}</tbody>
  </table>
  <footer><span>Destiny Ranch Arena · Record times on paper, then enter them in Run Desk.</span><span>${teams.filter((team) => team.eventId === event.id && team.round === round && !team.scratched).length} teams</span></footer>
</body>
</html>`;
}
