const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const money = (value: number) =>
  `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export interface PayoffWinnerRow {
  place: number;
  percentage: number;
  header: string;
  heeler: string;
  rounds: string;
  totalTime: string;
  amount: number;
  note: string;
}

export interface PayoffRiderShareRow {
  name: string;
  places: string;
  amount: number;
  freeRunReduced?: boolean;
}

export interface PayoffReportPayload {
  eventName: string;
  eventDate: string;
  eventLocation: string;
  participants: number;
  headers: number;
  heelers: number;
  teams: number;
  totalPot: number;
  freeRuns: number;
  freeRunDeduction: number;
  jackpot: number;
  winners: PayoffWinnerRow[];
  riderShares: PayoffRiderShareRow[];
}

export function payoffReportFileName(eventName: string) {
  const safeName = eventName
    .trim()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${safeName || "roping"}-payoff.html`;
}

export function payoffReportHtml(payload: PayoffReportPayload) {
  const stats: [string, string][] = [
    ["Participants", String(payload.participants)],
    ["Headers", String(payload.headers)],
    ["Heelers", String(payload.heelers)],
    ["Teams", String(payload.teams)],
    ["Total money in the pot", money(payload.totalPot)],
    ["Total free runs", String(payload.freeRuns)],
    ["Total money deducted from free runs", money(payload.freeRunDeduction)],
    ["Total jackpot money", money(payload.jackpot)],
  ];

  const statRows = stats
    .map(
      ([label, value]) =>
        `<tr><td>${escapeHtml(label)}</td><td class="value">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const winnerRows = payload.winners
    .map(
      (winner) => `<tr>
        <td class="place">${winner.place}</td>
        <td>${escapeHtml(winner.header)} x ${escapeHtml(winner.heeler)}${winner.note ? `<small>${escapeHtml(winner.note)}</small>` : ""}</td>
        <td>${escapeHtml(winner.rounds)}</td>
        <td>${escapeHtml(winner.totalTime)}s</td>
        <td>${winner.percentage}%</td>
        <td class="value">${money(winner.amount)}</td>
      </tr>`,
    )
    .join("");

  const shareRows = payload.riderShares
    .map(
      (share) => `<tr${share.freeRunReduced ? ' class="fr-reduced"' : ""}>
        <td>${escapeHtml(share.name)}${share.freeRunReduced ? ' <b class="fr">FR</b>' : ""}</td>
        <td>${escapeHtml(share.places)}${share.freeRunReduced ? "<small>Reduced amount — free-run winners receive 50% of the regular pay.</small>" : ""}</td>
        <td class="value${share.freeRunReduced ? " reduced" : ""}">${money(share.amount)}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(payload.eventName)} - Payoff Report</title>
  <style>
    @page { size: portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17201c; font: 12px Arial, sans-serif; }
    header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding-bottom: 12px; border-bottom: 3px solid #285f46; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    header p { margin: 0; color: #58645d; }
    header strong { color: #285f46; font-size: 18px; }
    h2 { margin: 18px 0 6px; color: #285f46; font-size: 14px; text-transform: uppercase; letter-spacing: .05em; }
    h2 .note { color: #66716b; font-size: 9px; font-weight: 400; text-transform: none; letter-spacing: 0; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 6px 8px; color: #fff; background: #285f46; border: 1px solid #285f46; font-size: 10px; text-align: left; text-transform: uppercase; }
    td { padding: 6px 8px; border: 1px solid #9fa8a2; vertical-align: middle; }
    td.value { font-weight: 700; text-align: right; white-space: nowrap; }
    td.place { width: 8%; font-size: 14px; font-weight: 700; text-align: center; }
    td small { display: block; margin-top: 2px; color: #58645d; font-size: 9px; }
    tr.fr-reduced td { background: #fdf3e0; }
    tr.fr-reduced .fr { color: #9a5d15; }
    td.value.reduced { color: #9a5d15; }
    .stats td:first-child { width: 60%; color: #38423c; }
    footer { display: flex; justify-content: space-between; margin-top: 14px; color: #66716b; font-size: 9px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(payload.eventName)}</h1>
      <p>${escapeHtml(payload.eventDate)}${payload.eventLocation ? ` · ${escapeHtml(payload.eventLocation)}` : ""}</p>
    </div>
    <strong>Payoff Report</strong>
  </header>
  <h2>Competition Summary</h2>
  <table class="stats"><tbody>${statRows}</tbody></table>
  <h2>Winners</h2>
  <table>
    <thead>
      <tr><th>Place</th><th>Team</th><th>Rounds</th><th>Total Time</th><th>%</th><th>Amount to Split</th></tr>
    </thead>
    <tbody>${winnerRows || '<tr><td colspan="6">No qualified winners yet.</td></tr>'}</tbody>
  </table>
  <h2>Rider Shares <span class="note">Rounded to the nearest $20</span></h2>
  <table>
    <thead>
      <tr><th>Rider</th><th>Places Won</th><th>Total Share</th></tr>
    </thead>
    <tbody>${shareRows || '<tr><td colspan="3">Rider shares appear once winners are known.</td></tr>'}</tbody>
  </table>
  <footer><span>Destiny Ranch Arena · Free-run winners receive 50% of the regular pay · Rider shares are rounded to the nearest $20.</span><span>Printed ${escapeHtml(new Date().toLocaleString())}</span></footer>
</body>
</html>`;
}
