import type { ArenaEvent, Contestant, Team } from "./types";
import { teamHandicapTotal } from "./competition";

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const reportFileName = (eventName: string, suffix: string) => {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-${suffix}.html`;
};

export const positionCheckFileName = (eventName: string) =>
  reportFileName(eventName, "position-check");

export const riderPostingFileName = (eventName: string) =>
  reportFileName(eventName, "rider-posting");

const drawTeams = (event: ArenaEvent, teams: Team[]) =>
  teams
    .filter(
      (team) =>
        team.eventId === event.id && team.round === 1 && !team.scratched,
    )
    .sort(
      (left, right) =>
        (left.originalTeamNumber ?? left.drawPosition) -
        (right.originalTeamNumber ?? right.drawPosition),
    );

const reportShellStyles = `
    @page { margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17201c; font: 13px Arial, sans-serif; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding-bottom: 12px; border-bottom: 3px solid #285f46; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    header p { margin: 0; color: #58645d; }
    header strong { color: #285f46; font-size: 18px; }
    footer { display: flex; justify-content: space-between; margin-top: 14px; color: #66716b; font-size: 9px; }`;

interface PositionEntry {
  name: string;
  handicap: number;
  entries: number;
  freeRuns: number;
}

const positionEntries = (
  teams: Team[],
  contestants: Contestant[],
  side: "header" | "heeler",
): PositionEntry[] => {
  const byId = new Map<string, PositionEntry>();
  teams.forEach((team) => {
    const riderId = side === "header" ? team.headerId : team.heelerId;
    const freeRun =
      side === "header" ? team.headerFreeRun : team.heelerFreeRun;
    const contestant = contestants.find((item) => item.id === riderId);
    const current = byId.get(riderId) ?? {
      name: contestant?.name ?? "Unknown",
      handicap:
        (side === "header"
          ? contestant?.headerHandicap
          : contestant?.heelerHandicap) ?? 0,
      entries: 0,
      freeRuns: 0,
    };
    current.entries += 1;
    if (freeRun) current.freeRuns += 1;
    byId.set(riderId, current);
  });
  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
};

export function positionCheckHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
) {
  const included = drawTeams(event, teams);
  const headers = positionEntries(included, contestants, "header");
  const heelers = positionEntries(included, contestants, "heeler");
  const sideRows = (entries: PositionEntry[]) =>
    entries
      .map(
        (entry) => `<tr>
        <td class="name">${escapeHtml(entry.name)}${entry.freeRuns ? ' <b class="fr">FR</b>' : ""}</td>
        <td class="hc">${entry.handicap}</td>
        <td class="entries">${entry.entries}</td>
      </tr>`,
      )
      .join("");
  const sideTable = (title: string, entries: PositionEntry[]) => `<div class="side">
      <h2>${title} (${entries.reduce((total, entry) => total + entry.entries, 0)} entries)</h2>
      <table>
        <thead><tr><th>Name</th><th>HC</th><th>Entries</th></tr></thead>
        <tbody>${sideRows(entries) || '<tr><td colspan="3">No riders.</td></tr>'}</tbody>
      </table>
    </div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(event.name)} - Position Check</title>
  <style>${reportShellStyles}
    .sides { display: flex; gap: 24px; margin-top: 14px; align-items: flex-start; }
    .side { flex: 1; }
    .side h2 { margin: 0 0 8px; padding-bottom: 4px; font-size: 16px; color: #285f46; border-bottom: 2px solid #285f46; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 6px; color: #fff; background: #285f46; border: 1px solid #285f46; font-size: 10px; text-align: left; text-transform: uppercase; }
    td { padding: 6px; border: 1px solid #9fa8a2; }
    .name { font-size: 14px; font-weight: 600; }
    .hc, .entries { width: 18%; text-align: center; }
    .fr { color: #285f46; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <p>${escapeHtml(event.date)} · ${escapeHtml(event.location)}</p>
    </div>
    <strong>Header / Heeler Position Check</strong>
  </header>
  <div class="sides">
    ${sideTable("Headers", headers)}
    ${sideTable("Heelers", heelers)}
  </div>
  <footer><span>Destiny Ranch Arena · Call each name to confirm riders are entered in the correct position.</span><span>${included.length} teams</span></footer>
</body>
</html>`;
}

export function riderPostingHtml(
  event: ArenaEvent,
  teams: Team[],
  contestants: Contestant[],
) {
  const included = drawTeams(event, teams);
  const names = new Map(
    contestants.map((contestant) => [contestant.id, contestant.name]),
  );
  const riderIds = new Map<string, string>();
  included.forEach((team) => {
    riderIds.set(team.headerId, names.get(team.headerId) ?? "Unknown");
    riderIds.set(team.heelerId, names.get(team.heelerId) ?? "Unknown");
  });
  const riders = [...riderIds.entries()].sort((left, right) =>
    left[1].localeCompare(right[1], undefined, { sensitivity: "base" }),
  );

  const riderBlocks = riders
    .map(([riderId, riderName]) => {
      const runs = included
        .filter(
          (team) => team.headerId === riderId || team.heelerId === riderId,
        )
        .map((team) => {
          const heading = team.headerId === riderId;
          const partnerId = heading ? team.heelerId : team.headerId;
          const partnerName = names.get(partnerId) ?? "Unknown";
          const freeRun = Boolean(team.headerFreeRun || team.heelerFreeRun);
          const teamNumber = team.originalTeamNumber ?? team.drawPosition;
          const handicap = teamHandicapTotal(
            team.headerId,
            team.heelerId,
            contestants,
          );
          const line = `Team ${teamNumber} · ${heading ? "Heading for" : "Heeling for"} ${escapeHtml(partnerName)} · HC ${handicap}${freeRun ? " · FREE RUN" : ""}`;
          return `<li class="${freeRun ? "free-run" : ""}">${line}</li>`;
        })
        .join("");
      return `<section class="rider">
      <h2>${escapeHtml(riderName)}</h2>
      <ul>${runs}</ul>
    </section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(event.name)} - Rider Posting</title>
  <style>${reportShellStyles}
    .riders { margin-top: 14px; columns: 2; column-gap: 28px; }
    .rider { break-inside: avoid; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #c9d1cc; }
    .rider h2 { margin: 0 0 4px; font-size: 16px; text-transform: uppercase; }
    .rider ul { margin: 0; padding-left: 18px; }
    .rider li { margin: 2px 0; }
    .rider li.free-run { font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(event.name)}</h1>
      <p>${escapeHtml(event.date)} · ${escapeHtml(event.location)}</p>
    </div>
    <strong>Rider Posting List</strong>
  </header>
  <div class="riders">${riderBlocks || "<p>No teams in the draw.</p>"}</div>
  <footer><span>Destiny Ranch Arena · Post at the arena. Free runs are shown in bold.</span><span>${riders.length} riders · ${included.length} teams</span></footer>
</body>
</html>`;
}
