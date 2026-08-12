import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const app = source("./App.tsx");
const styles = source("./styles.css");
const statusModel = source("./contestantWaiverStatus.ts");
const useArenaData = source("./useArenaData.ts");
const arenaTypes = source("./types.ts");
const publicSite = source("./PublicSite.tsx");
const contestantAccount = source("./contestantAccount.ts");
const registrationDesk = source("./RegistrationDesk.tsx");
const contestantPortal = app.slice(
  app.indexOf("function ContestantPortal()"),
  app.indexOf("function LedLeaderboard("),
);
const contestantsWorkspace = app.slice(
  app.indexOf("function ContestantWaiverStatus("),
  app.indexOf("function ContestantForm("),
);
const pageRelay = source("../wix/page-code.js");
const backendMirror = source("../wix/backend/arena-data.web.js");

describe("workspace waiver roster integration", () => {
  it("relays the no-payload admin action through the Wix mirror", () => {
    expect(pageRelay).toContain("loadContestantWaiverStatuses,");
    expect(pageRelay).toContain(
      'message.action === "loadContestantWaiverStatuses"',
    );
    expect(pageRelay).toContain("loadContestantWaiverStatuses()");
    expect(pageRelay).not.toContain(
      "loadContestantWaiverStatuses(message.data)",
    );
    expect(backendMirror).toContain(
      "export const loadContestantWaiverStatuses = webMethod(",
    );
    const endpoint = backendMirror.slice(
      backendMirror.indexOf(
        "export const loadContestantWaiverStatuses = webMethod(",
      ),
      backendMirror.indexOf("export const saveArenaData"),
    );
    expect(endpoint).toContain("await requireArenaAdmin()");
    expect(endpoint).toContain("contestantWaiverStatusesProjection");
    expect(endpoint).not.toContain("signatureDataUrl");
    expect(backendMirror).toContain(
      "async function readOptionalRegistrationDeskWaiverRecords()",
    );
    expect(backendMirror).toContain("consistentRead: true");
  });

  it("keeps waiver status out of ArenaData and browser persistence", () => {
    expect(statusModel).not.toContain("localStorage");
    expect(statusModel).not.toContain("ArenaData");
    expect(useArenaData).not.toContain("loadContestantWaiverStatuses");
    expect(arenaTypes).not.toContain("ContestantWaiverStatus");
  });

  it("renders a desktop waiver column with accessible signed timestamps", () => {
    expect(app).toContain("<span>Waiver</span>");
    expect(app).toContain('className="contestant-waiver-badge signed"');
    expect(app).toContain("<time");
    expect(app).toContain("dateTime={status.signedAt}");
    expect(app).toContain("title={status.fullDateLabel}");
  });

  it("switches the narrow roster to status-aware cards without overflow", () => {
    expect(app).toContain(
      'className="contestant-roster-cards" aria-label="Rider roster"',
    );
    expect(app).toContain('className="contestant-card-waiver"');
    expect(styles).toContain(
      ".contestant-roster-card { min-width: 0; overflow: hidden;",
    );
    expect(styles).toContain(
      ".contestant-roster-panel .roster-actions { width: 100%; justify-content: flex-start; }",
    );
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.contestant-table \{ display: none; \}[\s\S]*?\.contestant-roster-cards \{ min-width: 0; display: grid;/,
    );
  });

  it("provides refresh and retry without adding status loads elsewhere", () => {
    expect(app).toContain("Refresh waivers");
    expect(app).toContain("Retry waivers");
    expect(app).toContain("waiverResponseRef.current = response");
    expect(app).toContain("}, [contestantIdKey]);");
    expect(publicSite).not.toContain("loadContestantWaiverStatuses");
    expect(contestantAccount).not.toContain(
      "loadContestantWaiverStatuses",
    );
    expect(contestantPortal).not.toContain(
      "loadContestantWaiverStatuses",
    );
    expect(contestantPortal).not.toContain("contestant-waiver-badge");
    expect(registrationDesk).not.toContain(
      "loadContestantWaiverStatuses",
    );
    expect(contestantsWorkspace).not.toContain("submitRegistrationDeskWaiver");
    expect(contestantsWorkspace).not.toContain("signatureDataUrl");
    expect(contestantsWorkspace).not.toContain("waiverText");
  });
});
