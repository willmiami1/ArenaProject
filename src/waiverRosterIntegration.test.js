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
const registrationDeskWaiver = source("./registrationDeskWaiver.ts");
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
const backendContract = source(
  "../wix/backend/registration-desk-waiver-contract.js",
);

describe("workspace waiver roster integration", () => {
  it("relays the no-payload admin action to an index-only normal read", () => {
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
    expect(endpoint).toContain("loadRegistrationDeskWaiverStatusSnapshot");
    expect(endpoint).not.toContain("WAIVER_SIGNATURES_COLLECTION");
    expect(endpoint).not.toContain("parseRegistrationDeskWaiverStorageItem");
    expect(endpoint).not.toContain("signatureDataUrl");
    const normalRead = backendMirror.slice(
      backendMirror.indexOf(
        "async function readRegistrationDeskWaiverStatusRecords(",
      ),
      backendMirror.indexOf(
        "async function findRegistrationDeskWaiverStorageItem(",
      ),
    );
    expect(normalRead).toMatch(
      /query\(WAIVER_STATUS_INDEX_COLLECTION\)[\s\S]*?\.eq\("source", "registration-desk"\)[\s\S]*?\.eq\("waiverVersion", waiverVersion\)/,
    );
    expect(normalRead).toContain("CONSISTENT_READ_OPTIONS");
    expect(normalRead).toContain("while (result.hasNext())");
    expect(normalRead).toContain("result = await result.next()");
    expect(normalRead).not.toMatch(
      /WAIVER_SIGNATURES_COLLECTION|payload|JSON\.parse|signatureDataUrl|waiverText/,
    );
  });

  it("creates a private six-field index with a bounded one-time migration", () => {
    expect(backendMirror).toContain(
      'const WAIVER_STATUS_INDEX_COLLECTION = "ArenaWaiverStatusIndex";',
    );
    expect(backendMirror).toContain(
      '"arena-waiver-status-index-2026-08-12-v1"',
    );
    const collection = backendMirror.slice(
      backendMirror.indexOf(
        "async function ensureRegistrationDeskWaiverStatusIndexCollection()",
      ),
      backendMirror.indexOf(
        "async function ensureRegistrationDeskWaiverCollections()",
      ),
    );
    for (const field of [
      "source",
      "contestantId",
      "eventId",
      "signedAt",
      "waiverVersion",
      "evidenceAppId",
    ]) {
      expect(collection).toContain(`key: "${field}"`);
    }
    expect(collection).not.toContain("PAYLOAD_FIELDS");
    expect(collection).not.toMatch(
      /signatureDataUrl|waiverTitle|waiverText|signerName|contestantName|staffMemberId/,
    );

    const migration = backendMirror.slice(
      backendMirror.indexOf(
        "async function migrateLegacyRegistrationDeskWaiverStatuses(",
      ),
      backendMirror.indexOf(
        "async function readRegistrationDeskWaiverStatusRecords(",
      ),
    );
    expect(migration).toMatch(
      /withRegistrationDeskLocks\(\s*\[WAIVER_STATUS_INDEX_MIGRATION_ID\]/,
    );
    expect(migration).toContain("WAIVER_SIGNATURES_COLLECTION");
    expect(migration).toContain(
      ".limit(WAIVER_STATUS_MIGRATION_PAGE_SIZE)",
    );
    expect(migration).toContain("result = await result.next()");
    expect(migration).toContain(
      "migrateRegistrationDeskWaiverStatusIndex",
    );
    expect(migration).toMatch(
      /while \(true\)[\s\S]*?await wixData\.save\([\s\S]*?WAIVER_STATUS_INDEX_MIGRATION_ID[\s\S]*?value: 1/,
    );
  });

  it("repairs status after immutable evidence under shared locks", () => {
    const statusInsert = backendMirror.slice(
      backendMirror.indexOf(
        "async function ensureRegistrationDeskWaiverStatusForEvidence(",
      ),
      backendMirror.indexOf(
        "async function registrationDeskWaiverStatusMigrationIsComplete()",
      ),
    );
    expect(statusInsert).toMatch(
      /_id: arenaRecordStorageId\(\s*WAIVER_STATUS_INDEX_COLLECTION,\s*status\.evidenceAppId/,
    );
    expect(statusInsert).not.toMatch(
      /signatureDataUrl|waiverTitle|waiverText|signerName|contestantName|staffMemberId/,
    );
    const evidenceInsert = backendMirror.slice(
      backendMirror.indexOf(
        "async function insertImmutableRegistrationDeskWaiver(",
      ),
      backendMirror.indexOf(
        "async function ensureRiderAccountCollections()",
      ),
    );
    expect(evidenceInsert).toContain("wixData.insert(");
    expect(evidenceInsert).toContain(
      "resolveRegistrationDeskWaiverRetry(persisted, prepared)",
    );
    expect(evidenceInsert).not.toMatch(/wixData\.(?:save|update)\(/);

    const submission = backendMirror.slice(
      backendMirror.indexOf(
        "export const submitRegistrationDeskWaiver = webMethod(",
      ),
      backendMirror.indexOf(
        "export const submitSpectatorPrediction = webMethod(",
      ),
    );
    expect(submission).toContain(
      "await ensureRegistrationDeskWaiverCollections()",
    );
    expect(submission).toMatch(
      /withRegistrationDeskLocks\([\s\S]*?WAIVER_STATUS_INDEX_MIGRATION_ID[\s\S]*?`registration-desk-waiver-\$\{signatureId\}`/,
    );
    expect(submission).toContain(
      "findRegistrationDeskWaiverStorageItem(signatureId)",
    );
    expect(submission).toContain(
      "await ensureRegistrationDeskWaiverStatusForEvidence(",
    );
    expect(backendContract).toContain(
      "export async function ensureRegistrationDeskWaiverStatusIndexRecord",
    );
    expect(backendContract).toContain(
      "export async function loadContestantWaiverStatusesFromIndex",
    );
  });

  it("uses the global minimal status in Registration Desk across events", () => {
    const projection = backendMirror.slice(
      backendMirror.indexOf("async function registrationDeskProjection("),
      backendMirror.indexOf("export const loadRegistrationDeskData"),
    );
    expect(projection).toContain(
      "loadRegistrationDeskWaiverStatusSnapshot(waiverDocument)",
    );
    expect(projection).toContain("waiverStatus");
    expect(projection).not.toContain("WAIVER_SIGNATURES_COLLECTION");
    expect(projection).not.toContain("signatureDataUrl");
    expect(registrationDeskWaiver).toContain(
      "data.waiverStatus.waiverVersion === data.waiverDocument.version",
    );
    expect(registrationDeskWaiver).toContain(
      "status.contestantId === contestantId",
    );
    expect(registrationDeskWaiver).not.toContain(
      "status.eventId === eventId",
    );
    expect(registrationDesk).toContain(
      "status={registrationDeskWaiverStatus(",
    );
  });

  it("stops repeating waiver status on the desk roster once confirmed", () => {
    const rosterSection = registrationDesk.slice(
      registrationDesk.indexOf('className="registration-waiver-roster"'),
      registrationDesk.indexOf("{!event ? ("),
    );
    expect(rosterSection).toContain("outstandingWaivers.map");
    expect(rosterSection).toContain("Waivers still needed");
    expect(rosterSection).not.toContain("registrationDeskWaiverStatus(");
    expect(rosterSection).not.toContain("status=");
    expect(registrationDesk).toContain(
      "registrationDeskOutstandingWaiverParticipants(data, eventId, eventRoster)",
    );
    expect(registrationDesk).toContain("outstandingWaivers.length > 0");
    expect(registrationDeskWaiver).toContain(
      "!registrationDeskWaiverStatus(data, eventId, contestantId)",
    );
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
