import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  Filter,
  History,
  Mail,
  Eye,
  Printer,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trophy,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import type { ArenaData } from "./types";
import {
  canExportReports,
  emptyReportFilters,
  formatGeneratedAt,
  generateReport,
  reportDefinitions,
  reportFileName,
  type GeneratedReport,
  type ReportDefinition,
  type ReportFilters,
  type ReportRole,
} from "./reports";
import type { Row } from "write-excel-file";

interface ReportHistoryEntry {
  id: string;
  reportId: string;
  reportName: string;
  event: string;
  competition: string;
  user: ReportRole;
  generatedAt: string;
  format: string;
  pages: number;
  filters: ReportFilters;
}

const HISTORY_KEY = "arena-command-report-history-v1";
const ROLE_KEY = "arena-command-report-role-v1";
const COLUMN_PREFERENCES_KEY = "arena-command-report-columns-v1";
const PAGE_SIZE = 50;

const roles: ReportRole[] = [
  "Administrator",
  "Event Producer",
  "Secretary",
  "Announcer",
  "Read-Only User",
];

const dashboardCards = [
  { title: "Event Reports", description: "Full-event summaries, contestants, teams, and stock.", icon: ClipboardList },
  { title: "Competition Reports", description: "Registration, rounds, check-in, judge, and scratch reports.", icon: Trophy },
  { title: "Financial Reports", description: "Entry fees, charges, producer fees, and balances.", icon: WalletCards },
  { title: "Payout Reports", description: "Places, prizes, incentives, and total paid.", icon: FileSpreadsheet },
  { title: "Draw Reports", description: "Professional running orders and draw sheets.", icon: UsersRound },
  { title: "Results Reports", description: "Round, progressive, average, and final results.", icon: FileText },
  { title: "Statistics", description: "Arena, team, participation, and time analytics.", icon: BarChart3 },
  { title: "Export Center", description: "Recent PDF, Excel, CSV, print, and email actions.", icon: FileDown },
] as const;

function loadHistory() {
  try {
    return JSON.parse(
      window.localStorage.getItem(HISTORY_KEY) ?? "[]",
    ) as ReportHistoryEntry[];
  } catch {
    return [];
  }
}

function loadRole(): ReportRole {
  const saved = window.localStorage.getItem(ROLE_KEY) as ReportRole | null;
  return saved && roles.includes(saved) ? saved : "Administrator";
}

function loadColumnPreferences() {
  try {
    return JSON.parse(
      window.localStorage.getItem(COLUMN_PREFERENCES_KEY) ?? "{}",
    ) as Record<string, string[]>;
  } catch {
    return {};
  }
}

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const csvValue = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
const isHorseColumn = (key: string) =>
  key === "horse" || key === "horses" || key.endsWith("Horse");

function saveBlob(content: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function reportHtml(report: GeneratedReport, columns: string[], user: ReportRole) {
  const visibleColumns = report.columns.filter((column) =>
    columns.includes(column.key),
  );
  const pages = Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(report.definition.title)}</title>
<style>
@page { size: landscape; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; color: #17201c; font: 11px Arial, sans-serif; }
header { display:flex; align-items:center; gap:16px; padding-bottom:14px; border-bottom:3px solid #285f46; }
header img { width:84px; height:58px; object-fit:contain; background:#111; border-radius:6px; }
h1 { margin:0 0 4px; font-size:22px; } h2 { margin:0; color:#285f46; font-size:13px; }
.meta { margin-left:auto; text-align:right; color:#5f6964; line-height:1.6; }
.summary { display:grid; grid-template-columns:repeat(5,1fr); gap:8px; margin:14px 0; }
.summary div { padding:8px; background:#f2f6f3; border:1px solid #dce5df; border-radius:5px; }
.summary span { display:block; color:#6e7872; font-size:8px; text-transform:uppercase; }
.summary strong { display:block; margin-top:3px; font-size:13px; }
table { width:100%; border-collapse:collapse; }
th { color:#fff; background:#285f46; text-align:left; }
th,td { padding:6px 7px; border:1px solid #dfe3df; }
tr { break-inside:avoid; } tr:nth-child(even) td { background:#f8faf8; }
td.horse { color:#6e7872; font-size:8px; font-weight:700; }
footer { margin-top:12px; padding-top:8px; display:flex; justify-content:space-between; color:#737d77; border-top:1px solid #dfe3df; font-size:9px; }
</style></head><body>
<header>
  <img src="${new URL("./destiny-ranch-arena-logo.png", window.location.href).href}" alt="Destiny Ranch Arena">
  <div><h1>${escapeHtml(report.definition.title)}</h1><h2>${escapeHtml(report.eventName)} · ${escapeHtml(report.competitionName)}</h2></div>
  <div class="meta">Generated ${escapeHtml(formatGeneratedAt(report.generatedAt))}<br>Generated by ${escapeHtml(user)}</div>
</header>
<div class="summary">${report.metrics.slice(0, 10).map((metric) => `<div><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong></div>`).join("")}</div>
<table><thead><tr>${visibleColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>
<tbody>${report.rows.map((row) => `<tr>${visibleColumns.map((column) => `<td${isHorseColumn(column.key) ? ' class="horse"' : ""}>${escapeHtml(row[column.key] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>
<footer><span>Destiny Ranch Arena · ${escapeHtml(report.definition.title)}</span><span>Page 1 of ${pages}</span></footer>
</body></html>`;
}

export function ReportsModule({ data }: { data: ArenaData }) {
  const [role, setRole] = useState<ReportRole>(loadRole);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selected, setSelected] = useState<ReportDefinition | null>(null);
  const [filters, setFilters] = useState<ReportFilters>(() =>
    emptyReportFilters(data),
  );
  const [history, setHistory] = useState<ReportHistoryEntry[]>(loadHistory);
  const [historySearch, setHistorySearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showColumns, setShowColumns] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [columnPreferences, setColumnPreferences] =
    useState<Record<string, string[]>>(loadColumnPreferences);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "",
    direction: "asc",
  });
  const [page, setPage] = useState(1);

  const allowedDefinitions = useMemo(
    () => reportDefinitions.filter((definition) => definition.roles.includes(role)),
    [role],
  );

  const catalog = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return allowedDefinitions.filter(
      (definition) =>
        !query ||
        `${definition.title} ${definition.description} ${definition.category}`
          .toLowerCase()
          .includes(query),
    );
  }, [allowedDefinitions, catalogSearch]);

  const report = useMemo(
    () => (selected ? generateReport(data, selected, filters) : null),
    [data, filters, selected],
  );

  useEffect(() => {
    window.localStorage.setItem(ROLE_KEY, role);
    if (selected && !selected.roles.includes(role)) setSelected(null);
    setPreviewOpen(false);
  }, [role]);

  useEffect(() => {
    if (!report) return;
    const preferenceKey = `${role}:${report.definition.id}`;
    const preferredColumns = columnPreferences[preferenceKey];
    setVisibleColumns(
      preferredColumns
        ? [
            ...preferredColumns.filter((key) =>
              report.columns.some((column) => column.key === key),
            ),
            ...report.columns
              .map((column) => column.key)
              .filter((key) => !preferredColumns.includes(key)),
          ]
        : report.columns.map((column) => column.key),
    );
    setSort({ key: "", direction: "asc" });
    setPage(1);
  }, [report?.definition.id, role]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
  }, [history]);

  useEffect(() => {
    window.localStorage.setItem(
      COLUMN_PREFERENCES_KEY,
      JSON.stringify(columnPreferences),
    );
  }, [columnPreferences]);

  const sortedRows = useMemo(() => {
    if (!report || !sort.key) return report?.rows ?? [];
    return [...report.rows].sort((left, right) => {
      const a = left[sort.key] ?? "";
      const b = right[sort.key] ?? "";
      const result =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      return sort.direction === "asc" ? result : -result;
    });
  }, [report, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const exportAllowed = canExportReports(role);

  const recordHistory = (
    format: string,
    currentReport = report,
    historyFilters = filters,
  ) => {
    if (!currentReport) return;
    setHistory((current) => [
      {
        id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        reportId: currentReport.definition.id,
        reportName: currentReport.definition.title,
        event: currentReport.eventName,
        competition: currentReport.competitionName,
        user: role,
        generatedAt: new Date().toISOString(),
        format,
        pages: Math.max(1, Math.ceil(currentReport.rows.length / PAGE_SIZE)),
        filters: historyFilters,
      },
      ...current,
    ].slice(0, 100));
  };

  const openReport = (definition: ReportDefinition) => {
    const nextFilters = {
      ...filters,
      competitionId:
        filters.competitionId || data.activeEventId || data.events[0]?.id || "",
    };
    setFilters(nextFilters);
    setSelected(definition);
    setShowHistory(false);
    setPreviewOpen(false);
  };

  const openPreview = () => {
    if (!report) return;
    setPage(1);
    setPreviewOpen(true);
    recordHistory("Preview");
  };

  const printReport = () => {
    if (!report || !previewOpen) return;
    const popup = window.open("", "_blank", "width=1200,height=800");
    if (!popup) {
      window.alert("Allow pop-ups to preview and print this report.");
      return;
    }
    popup.opener = null;
    popup.document.write(reportHtml(report, visibleColumns, role));
    popup.document.close();
    popup.addEventListener("load", () => popup.print(), { once: true });
    recordHistory("Print");
  };

  const exportPdf = async () => {
    if (!report || !previewOpen || !exportAllowed) return;
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${report.eventName} - ${report.definition.title}`);
    pdf.setAuthor("Destiny Ranch Arena");
    pdf.setCreator("Arena Command");
    pdf.setCreationDate(new Date(report.generatedAt));
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const columns = report.columns.filter((column) =>
      visibleColumns.includes(column.key),
    );
    const landscape = { width: 792, height: 612 };
    const margin = 30;
    const tableWidth = landscape.width - margin * 2;
    const columnWidth = tableWidth / Math.max(columns.length, 1);
    const rowHeight = 17;
    const rowsPerPage = 25;
    const pages = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
    const safeText = (value: unknown) =>
      String(value ?? "—")
        .replace(/[^\x20-\x7E]/g, "-")
        .replace(/\s+/g, " ");
    const fitText = (value: unknown, width: number, fontSize: number) => {
      const text = safeText(value);
      if (regular.widthOfTextAtSize(text, fontSize) <= width) return text;
      let fitted = text;
      while (
        fitted.length > 1 &&
        regular.widthOfTextAtSize(`${fitted}...`, fontSize) > width
      ) {
        fitted = fitted.slice(0, -1);
      }
      return `${fitted}...`;
    };
    let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
    try {
      const logoBytes = await fetch("./destiny-ranch-arena-logo.png").then(
        (response) => {
          if (!response.ok) throw new Error("Logo could not be loaded.");
          return response.arrayBuffer();
        },
      );
      logo = await pdf.embedPng(logoBytes);
    } catch (error) {
      console.error("Could not add the arena logo to the PDF.", error);
    }

    for (let pageIndex = 0; pageIndex < pages; pageIndex += 1) {
      const page = pdf.addPage([landscape.width, landscape.height]);
      if (logo) {
        page.drawImage(logo, { x: margin, y: 530, width: 72, height: 48 });
      }
      page.drawText(report.definition.title, {
        x: logo ? 115 : margin,
        y: 560,
        size: 18,
        font: bold,
        color: rgb(0.09, 0.13, 0.11),
      });
      page.drawText(
        fitText(
          `${report.eventName} - ${report.competitionName}`,
          390,
          10,
        ),
        {
          x: logo ? 115 : margin,
          y: 543,
          size: 10,
          font: bold,
          color: rgb(0.16, 0.37, 0.27),
        },
      );
      page.drawText(`Generated ${safeText(formatGeneratedAt(report.generatedAt))}`, {
        x: 570,
        y: 560,
        size: 8,
        font: regular,
        color: rgb(0.4, 0.45, 0.42),
      });
      page.drawText(`By ${safeText(role)}`, {
        x: 570,
        y: 546,
        size: 8,
        font: regular,
        color: rgb(0.4, 0.45, 0.42),
      });
      page.drawRectangle({
        x: margin,
        y: 520,
        width: tableWidth,
        height: 3,
        color: rgb(0.16, 0.37, 0.27),
      });

      const headerY = 497;
      columns.forEach((column, columnIndex) => {
        const x = margin + columnIndex * columnWidth;
        page.drawRectangle({
          x,
          y: headerY,
          width: columnWidth,
          height: rowHeight,
          color: rgb(0.16, 0.37, 0.27),
        });
        page.drawText(fitText(column.label, columnWidth - 8, 6.5), {
          x: x + 4,
          y: headerY + 5,
          size: 6.5,
          font: bold,
          color: rgb(1, 1, 1),
        });
      });

      const pageRowsForPdf = sortedRows.slice(
        pageIndex * rowsPerPage,
        (pageIndex + 1) * rowsPerPage,
      );
      pageRowsForPdf.forEach((row, rowIndex) => {
        const y = headerY - (rowIndex + 1) * rowHeight;
        if (rowIndex % 2 === 1) {
          page.drawRectangle({
            x: margin,
            y,
            width: tableWidth,
            height: rowHeight,
            color: rgb(0.97, 0.98, 0.97),
          });
        }
        columns.forEach((column, columnIndex) => {
          const x = margin + columnIndex * columnWidth;
          page.drawRectangle({
            x,
            y,
            width: columnWidth,
            height: rowHeight,
            borderColor: rgb(0.87, 0.89, 0.87),
            borderWidth: 0.4,
          });
          page.drawText(
            fitText(
              row[column.key] ?? "—",
              columnWidth - 8,
              isHorseColumn(column.key) ? 5.4 : 6.5,
            ),
            {
              x: x + 4,
              y: y + 5,
              size: isHorseColumn(column.key) ? 5.4 : 6.5,
              font: regular,
              color: rgb(0.15, 0.2, 0.17),
            },
          );
        });
      });
      page.drawText(
        `Destiny Ranch Arena - ${safeText(report.definition.title)}`,
        {
          x: margin,
          y: 20,
          size: 7,
          font: regular,
          color: rgb(0.4, 0.45, 0.42),
        },
      );
      page.drawText(`Page ${pageIndex + 1} of ${pages}`, {
        x: 700,
        y: 20,
        size: 7,
        font: regular,
        color: rgb(0.4, 0.45, 0.42),
      });
    }

    const bytes = await pdf.save();
    saveBlob(
      bytes,
      "application/pdf",
      reportFileName(report, "pdf"),
    );
    recordHistory("PDF");
  };

  const exportCsv = () => {
    if (!report || !previewOpen || !exportAllowed) return;
    const columns = report.columns.filter((column) =>
      visibleColumns.includes(column.key),
    );
    const csv = [
      columns.map((column) => csvValue(column.label)).join(","),
      ...sortedRows.map((row) =>
        columns.map((column) => csvValue(row[column.key] ?? "")).join(","),
      ),
    ].join("\r\n");
    saveBlob(csv, "text/csv;charset=utf-8", reportFileName(report, "csv"));
    recordHistory("CSV");
  };

  const exportExcel = async () => {
    if (!report || !previewOpen || !exportAllowed) return;
    const columns = report.columns.filter((column) =>
      visibleColumns.includes(column.key),
    );
    const rows: Row[] = [
      columns.map((column) => ({
        value: column.label,
        fontWeight: "bold",
        color: "#FFFFFF",
        backgroundColor: "#285F46",
      })),
      ...sortedRows.map((row) =>
        columns.map((column) => {
          const value = row[column.key] ?? "";
          return {
            value,
            type: typeof value === "number" ? Number : String,
            ...(isHorseColumn(column.key) ? { fontSize: 8 } : {}),
          };
        }),
      ),
    ];
    const { default: writeXlsxFile } = await import("write-excel-file");
    await writeXlsxFile(rows, {
      fileName: reportFileName(report, "xlsx"),
      sheet: "Arena Report",
      columns: columns.map(() => ({ width: 20 })),
    });
    recordHistory("Excel");
  };

  const downloadHtml = () => {
    if (!report || !previewOpen || !exportAllowed) return;
    saveBlob(
      reportHtml(report, visibleColumns, role),
      "text/html;charset=utf-8",
      reportFileName(report, "html"),
    );
    recordHistory("Download");
  };

  const emailReport = () => {
    if (!report || !previewOpen || !exportAllowed) return;
    const metrics = report.metrics
      .slice(0, 8)
      .map((metric) => `${metric.label}: ${metric.value}`)
      .join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent(
      `${report.eventName} — ${report.definition.title}`,
    )}&body=${encodeURIComponent(
      `${report.definition.title}\n${report.eventName}\n${report.competitionName}\n\n${metrics}\n\nGenerated ${formatGeneratedAt(report.generatedAt)}.`,
    )}`;
    recordHistory("Email");
  };

  const regenerate = (entry: ReportHistoryEntry) => {
    const definition = reportDefinitions.find(
      (item) => item.id === entry.reportId && item.roles.includes(role),
    );
    if (!definition) return;
    setFilters(entry.filters);
    setSelected(definition);
    setShowHistory(false);
    setPreviewOpen(true);
    recordHistory(
      "Regenerated",
      generateReport(data, definition, entry.filters),
      entry.filters,
    );
  };

  const updateFilter = <Key extends keyof ReportFilters>(
    key: Key,
    value: ReportFilters[Key],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setPreviewOpen(false);
  };

  const toggleColumn = (key: string, checked: boolean) => {
    if (!report) return;
    const next = checked
      ? [...visibleColumns, key]
      : visibleColumns.filter((columnKey) => columnKey !== key);
    setVisibleColumns(next);
    setPreviewOpen(false);
    setColumnPreferences((current) => ({
      ...current,
      [`${role}:${report.definition.id}`]: next,
    }));
  };

  const filteredHistory = history.filter((entry) =>
    `${entry.reportName} ${entry.event} ${entry.competition} ${entry.user} ${entry.format}`
      .toLowerCase()
      .includes(historySearch.toLowerCase()),
  );

  if (showHistory) {
    return (
      <div className="reports-workspace">
        <ReportHeader role={role} setRole={setRole} onHistory={() => setShowHistory(false)} historyActive />
        <section className="panel report-history-panel">
          <div className="table-toolbar">
            <div><h3>Report history</h3><p>Search, audit, and regenerate the last 100 report actions.</p></div>
            <label className="search"><Search size={16} /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search report history" /></label>
          </div>
          <div className="data-table report-history-table">
            <div className="table-row table-header"><span>Report</span><span>Event / Competition</span><span>User</span><span>Generated</span><span>Format</span><span>Pages</span><span /></div>
            {filteredHistory.map((entry) => (
              <div className="table-row" key={entry.id}>
                <strong>{entry.reportName}</strong>
                <span>{entry.event}<small>{entry.competition}</small></span>
                <span>{entry.user}</span>
                <span>{formatGeneratedAt(entry.generatedAt)}</span>
                <span className="tag neutral">{entry.format}</span>
                <span>{entry.pages}</span>
                <button className="icon-action" onClick={() => regenerate(entry)} title="Regenerate report"><RefreshCw size={15} /></button>
              </div>
            ))}
            {!filteredHistory.length && <div className="empty-state"><History size={28} /><p>No report history matches this search.</p></div>}
          </div>
        </section>
      </div>
    );
  }

  if (!selected || !report) {
    return (
      <div className="reports-workspace">
        <ReportHeader role={role} setRole={setRole} onHistory={() => setShowHistory(true)} />
        <section className="reports-hero">
          <div>
            <span className="eyebrow">Reporting command center</span>
            <h2>Professional reports, ready in seconds.</h2>
            <p>Generate event-wide or competition-specific reports, then print, export, download, or email them.</p>
          </div>
          <div className="reports-hero-stat"><strong>{allowedDefinitions.length}</strong><span>available reports</span></div>
        </section>
        <div className="reports-search-row">
          <label className="search report-search"><Search size={17} /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search reports by name, category, or purpose" /></label>
        </div>
        <div className="report-dashboard-grid">
          {dashboardCards.map(({ title, description, icon: Icon }) => {
            const matching = title === "Export Center"
              ? history.length
              : catalog.filter((definition) => definition.category === title).length;
            return (
              <article className="report-dashboard-card" key={title}>
                <div className="report-card-icon"><Icon size={21} /></div>
                <div><h3>{title}</h3><p>{description}</p></div>
                <strong>{matching}<span>{title === "Export Center" ? "recent actions" : "reports"}</span></strong>
                <button className="secondary" onClick={() => {
                  if (title === "Export Center") setShowHistory(true);
                  else {
                    const first = catalog.find((definition) => definition.category === title);
                    if (first) openReport(first);
                  }
                }}>{title === "Export Center" ? "Open history" : "Generate report"}</button>
              </article>
            );
          })}
        </div>
        <section className="panel report-catalog">
          <div className="panel-heading"><div><h3>All available reports</h3><p>Access is filtered for the selected user role.</p></div></div>
          <div className="report-catalog-list">
            {catalog.map((definition) => (
              <button key={definition.id} onClick={() => openReport(definition)}>
                <span className="report-type-icon"><FileText size={17} /></span>
                <span><strong>{definition.title}</strong><small>{definition.description}</small></span>
                <em>{definition.section}</em>
                <ChevronRight size={17} />
              </button>
            ))}
            {!catalog.length && <div className="empty-state"><Search size={26} /><p>No reports match this search or role.</p></div>}
          </div>
        </section>
      </div>
    );
  }

  const visibleReportColumns = report.columns.filter((column) =>
    visibleColumns.includes(column.key),
  );
  const chartMetrics = report.metrics
    .filter((metric) => (metric.numericValue ?? 0) > 0)
    .slice(0, 6);
  const chartMax = Math.max(
    1,
    ...chartMetrics.map((metric) => metric.numericValue ?? 0),
  );

  return (
    <div className="reports-workspace">
      <ReportHeader role={role} setRole={setRole} onHistory={() => setShowHistory(true)} />
      {!previewOpen ? (
        <>
          <div className="report-builder-heading">
            <button className="secondary" onClick={() => setSelected(null)}><ChevronLeft size={16} /> Reports</button>
            <div><span className="tag neutral">{report.definition.section} report</span><h2>{report.definition.title}</h2><p>{report.definition.description}</p></div>
          </div>

          <section className="report-action-bar no-print">
            <button className="secondary" onClick={() => setShowFilters((current) => !current)}><Filter size={16} /> Filters</button>
            <button className="secondary" onClick={() => setShowColumns((current) => !current)}><Settings2 size={16} /> Columns</button>
            <span />
            <button className="primary" onClick={openPreview}><Eye size={16} /> Preview report</button>
          </section>

          {showFilters && (
            <section className="report-filters no-print">
              <div className="report-filter-heading"><div><Filter size={17} /><strong>Report filters</strong></div><button onClick={() => setShowFilters(false)}><X size={17} /></button></div>
              <div className="report-filter-grid">
                <label><span>Event</span><select value={filters.meetId} onChange={(event) => {
                  const meetId = event.target.value;
                  const competitionId = data.events.find(
                    (competition) =>
                      !meetId || competition.parentEventId === meetId,
                  )?.id ?? "";
                  setFilters((current) => ({
                    ...current,
                    meetId,
                    competitionId,
                  }));
                  setPage(1);
                  setPreviewOpen(false);
                }}><option value="">All events</option>{data.meets.map((meet) => <option value={meet.id} key={meet.id}>{meet.name}</option>)}</select></label>
                <label><span>Competition</span><select value={filters.competitionId} onChange={(event) => updateFilter("competitionId", event.target.value)}><option value="">All competitions</option>{data.events.filter((event) => !filters.meetId || event.parentEventId === filters.meetId).map((event) => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label>
                <label><span>Date</span><input type="date" value={filters.date} onChange={(event) => updateFilter("date", event.target.value)} /></label>
                <label><span>Category #</span><input value={filters.categoryNumber} onChange={(event) => updateFilter("categoryNumber", event.target.value)} placeholder="All categories" /></label>
                <label><span>Position</span><select value={filters.role} onChange={(event) => updateFilter("role", event.target.value as ReportFilters["role"])}><option value="">Header & Heeler</option><option value="Header">Header</option><option value="Heeler">Heeler</option></select></label>
                <label><span>Team</span><input value={filters.team} onChange={(event) => updateFilter("team", event.target.value)} placeholder="Header or heeler" /></label>
                <label><span>Round</span><select value={filters.round} onChange={(event) => updateFilter("round", event.target.value)}><option value="">All rounds</option>{Array.from({ length: Math.max(1, ...data.events.map((event) => event.rounds)) }, (_, index) => <option key={index + 1} value={index + 1}>Round {index + 1}</option>)}</select></label>
                <label><span>Draw position</span><input type="number" min="1" value={filters.drawPosition} onChange={(event) => updateFilter("drawPosition", event.target.value)} placeholder="All positions" /></label>
                <label><span>Payment</span><select value={filters.paidStatus} onChange={(event) => updateFilter("paidStatus", event.target.value as ReportFilters["paidStatus"])}><option value="">Paid & unpaid</option><option value="paid">Paid entries</option><option value="unpaid">Unpaid entries</option></select></label>
                <label className="report-row-search"><span>Search results</span><input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Search every report column" /></label>
              </div>
              <div className="report-filter-toggles">
                <label><input type="checkbox" checked={filters.qualifiedOnly} onChange={(event) => updateFilter("qualifiedOnly", event.target.checked)} /> Qualified only</label>
                <label><input type="checkbox" checked={filters.noTimesOnly} onChange={(event) => updateFilter("noTimesOnly", event.target.checked)} /> No times only</label>
                <label><input type="checkbox" checked={filters.checkedInOnly} onChange={(event) => updateFilter("checkedInOnly", event.target.checked)} /> Checked-in only</label>
                <label><input type="checkbox" checked={filters.scratchedOnly} onChange={(event) => updateFilter("scratchedOnly", event.target.checked)} /> Scratched only</label>
              </div>
            </section>
          )}

          {showColumns && (
            <section className="report-columns no-print">
              <strong>Customize columns</strong>
              {report.columns.map((column) => (
                <label key={column.key}><input type="checkbox" checked={visibleColumns.includes(column.key)} onChange={(event) => toggleColumn(column.key, event.target.checked)} /> {column.label}</label>
              ))}
            </section>
          )}

          <section className="report-ready-card">
            <span className="report-ready-icon"><Eye size={26} /></span>
            <div>
              <span className="eyebrow">Ready to preview</span>
              <h3>{report.definition.title}</h3>
              <p>{sortedRows.length.toLocaleString()} matching rows · {visibleReportColumns.length} visible columns</p>
            </div>
            <button className="primary" onClick={openPreview}><Eye size={16} /> Preview report</button>
          </section>
        </>
      ) : (
        <section className="report-preview-screen">
          <div className="report-preview-toolbar no-print">
            <button className="secondary" onClick={() => setPreviewOpen(false)}><ChevronLeft size={16} /> Back to setup</button>
            <div><span className="eyebrow">Report preview</span><strong>{report.definition.title}</strong></div>
            <span />
            <button className="secondary" onClick={printReport}><Printer size={16} /> Print</button>
            <button className="secondary" disabled={!exportAllowed} onClick={() => void exportPdf()}><FileDown size={16} /> Save PDF</button>
            <button className="secondary" disabled={!exportAllowed} onClick={() => void exportExcel()}><FileSpreadsheet size={16} /> Excel</button>
            <button className="secondary" disabled={!exportAllowed} onClick={exportCsv}><Download size={16} /> CSV</button>
            <button className="secondary" disabled={!exportAllowed} onClick={downloadHtml}><FileText size={16} /> Download</button>
            <button className="secondary" disabled={!exportAllowed} onClick={emailReport}><Mail size={16} /> Email</button>
          </div>

          <article className="report-preview">
        <header className="report-document-header">
          <img src="./destiny-ranch-arena-logo.png" alt="Destiny Ranch Arena" />
          <div><span>Destiny Ranch Arena</span><h2>{report.definition.title}</h2><p>{report.eventName} · {report.competitionName}</p></div>
          <div><span>Generated</span><strong>{formatGeneratedAt(report.generatedAt)}</strong><small>{role}</small></div>
        </header>
        <div className="report-metric-grid">
          {report.metrics.slice(0, 10).map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong></div>)}
        </div>
        {!!chartMetrics.length && (
          <div className="report-chart">
            <div className="report-chart-title"><BarChart3 size={17} /><strong>Summary dashboard</strong></div>
            <div className="report-bars">{chartMetrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><i><b style={{ width: `${Math.max(3, ((metric.numericValue ?? 0) / chartMax) * 100)}%` }} /></i><strong>{metric.value}</strong></div>)}</div>
          </div>
        )}
        <div className="report-table-wrap">
          <table className="report-table">
            <thead><tr>{visibleReportColumns.map((column) => <th key={column.key}><button onClick={() => setSort((current) => ({ key: column.key, direction: current.key === column.key && current.direction === "asc" ? "desc" : "asc" }))}>{column.label}{sort.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}</button></th>)}</tr></thead>
            <tbody>{pageRows.map((row, index) => <tr key={`${page}-${index}`}>{visibleReportColumns.map((column) => <td className={isHorseColumn(column.key) ? "report-horse" : undefined} key={column.key}>{row[column.key] ?? "—"}</td>)}</tr>)}</tbody>
          </table>
          {!pageRows.length && <div className="empty-state"><FileText size={27} /><p>No records match the selected report filters.</p></div>}
        </div>
        <footer className="report-document-footer"><span>Destiny Ranch Arena · {report.definition.title}</span><span>Page {page} of {pageCount}</span></footer>
          </article>

          <div className="report-pagination no-print">
            <span>{sortedRows.length.toLocaleString()} rows · {PAGE_SIZE} per page</span>
            <div><button disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button><strong>{page} / {pageCount}</strong><button disabled={page === pageCount} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button></div>
          </div>
        </section>
      )}
    </div>
  );
}

function ReportHeader({
  role,
  setRole,
  onHistory,
  historyActive = false,
}: {
  role: ReportRole;
  setRole: (role: ReportRole) => void;
  onHistory: () => void;
  historyActive?: boolean;
}) {
  return (
    <div className="reports-top-controls no-print">
      <label><ShieldCheck size={16} /><span>Access role</span><select value={role} onChange={(event) => setRole(event.target.value as ReportRole)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
      <button className={historyActive ? "selected-button" : "secondary"} onClick={onHistory}><History size={16} /> {historyActive ? "Back to dashboard" : "Report history"}</button>
    </div>
  );
}
