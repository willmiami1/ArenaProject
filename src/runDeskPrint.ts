import type { ArenaEvent, Contestant, Team } from "./types";

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const rotationSuffix = (rotation?: number) =>
  rotation ? `-rotation-${rotation}` : "";

const rotationTitle = (rotation?: number) =>
  rotation ? ` Rotation ${rotation}` : "";

const inRotation = (team: Team, rotation?: number) =>
  rotation === undefined || team.rotation === rotation;

export function pickedTeamsPostingFileName(
  eventName: string,
  round: number,
  rotation?: number,
) {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-round-${round}${rotationSuffix(rotation)}-picked-teams-posting.html`;
}

// Large-print list of picked (ride-in) teams to post for riders.
export function pickedTeamsPostingHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
  round: number,
  rotation?: number,
) {
  const byId = new Map(contestants.map((contestant) => [contestant.id, contestant]));
  const posted = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        team.round === round &&
        inRotation(team, rotation) &&
        !team.scratched &&
        !team.generated,
    )
    .sort((left, right) => left.drawPosition - right.drawPosition);
  const rows = posted
    .map((team) => {
      const header = byId.get(team.headerId);
      const heeler = byId.get(team.heelerId);
      const headerHc = header?.headerHandicap ?? 0;
      const heelerHc = heeler?.heelerHandicap ?? 0;
      return `<tr>
        <td class="num">${team.originalTeamNumber ?? team.drawPosition}</td>
        <td class="hc">${headerHc}</td>
        <td>${escapeHtml(header?.name ?? "Unknown")}</td>
        <td class="hc">${heelerHc}</td>
        <td>${escapeHtml(heeler?.name ?? "Unknown")}</td>
        <td class="hc">${headerHc + heelerHc}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(event.name)} - Round ${round}${rotationTitle(rotation)} Picked Teams</title>
  <style>
    @page { size: portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17201c; font: 14px Arial, sans-serif; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 8px; border-bottom: 3px solid #285f46; }
    h1 { margin: 0 0 2px; font-size: 22px; }
    header p { margin: 0; color: #58645d; font-size: 12px; }
    header strong { color: #285f46; font-size: 18px; white-space: nowrap; }
    table { width: 100%; margin-top: 10px; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { padding: 6px; color: #fff; background: #285f46; border: 1px solid #285f46; font-size: 11px; text-align: left; text-transform: uppercase; }
    td { height: 30px; padding: 4px 6px; border: 1px solid #9fa8a2; vertical-align: middle; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 15px; }
    .num { width: 10%; font-size: 18px; font-weight: 700; text-align: center; }
    .hc { width: 10%; text-align: center; font-weight: 700; }
    th:nth-child(3), th:nth-child(5) { width: 30%; }
    footer { display: flex; justify-content: space-between; margin-top: 8px; color: #66716b; font-size: 10px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <p>${escapeHtml(event.date)} · ${escapeHtml(event.location)}</p>
    </div>
    <strong>Round ${round}${rotationTitle(rotation)} Picked Teams</strong>
  </header>
  <table>
    <thead>
      <tr><th>Team #</th><th>Header HC</th><th>Header</th><th>Heeler HC</th><th>Heeler</th><th>Total HC</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">No picked teams in this round.</td></tr>'}</tbody>
  </table>
  <footer><span>Destiny Ranch Arena</span><span>${posted.length} picked teams</span></footer>
</body>
</html>`;
}

export type TimeSheetSource = "draw" | "pick";

const sourceLabel = (source: TimeSheetSource) =>
  source === "pick" ? "Picked Teams" : "Draw Teams";

const sourceMatches = (team: Team, source: TimeSheetSource) =>
  source === "pick" ? !team.generated : !!team.generated;

export function roundTimeSheetFileName(
  eventName: string,
  round: number,
  source: TimeSheetSource = "draw",
  rotation?: number,
) {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-round-${round}${rotationSuffix(rotation)}-${source === "pick" ? "picked-teams" : "draw"}-time-sheet.html`;
}

export function roundTimeSheetHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
  round: number,
  source: TimeSheetSource = "draw",
  rotation?: number,
) {
  const contestantNames = new Map(
    contestants.map((contestant) => [contestant.id, contestant.name]),
  );
  const sheetTeams = teams
    .filter(
      (team) =>
        team.eventId === event.id &&
        team.round === round &&
        inRotation(team, rotation) &&
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
  <title>${escapeHtml(event.name)} - Round ${round}${rotationTitle(rotation)} ${sourceLabel(source)} Time Sheet</title>
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
    <strong>Round ${round}${rotationTitle(rotation)} ${sourceLabel(source)} Time Sheet</strong>
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
