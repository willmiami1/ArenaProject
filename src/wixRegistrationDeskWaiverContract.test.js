import { describe, expect, it } from "vitest";
import {
  contestantWaiverStatusesProjection,
  createRegistrationDeskWaiverStatusRecord,
  ensureRegistrationDeskWaiverStatusIndexRecord,
  loadContestantWaiverStatusesFromIndex,
  migrateRegistrationDeskWaiverStatusIndex,
  normalizeRegistrationDeskWaiverDocument,
  prepareRegistrationDeskWaiver,
  registrationDeskWaiverRecordId,
  registrationDeskWaiverSignatureProjection,
  resolveRegistrationDeskWaiverRetry,
} from "../wix/backend/registration-desk-waiver-contract.js";

const document = {
  title: "ACTIVITY WAIVER AGREEMENT",
  version: "2026-08-12-v1",
  text: `In consideration of being allowed to participate in team roping or any horse back riding at Destiny Ranch Arena located at Destiny Ranch LLC. 2549 E C 476 Bushnell FL 33513 also known as Destiny Ranch Events.
 I, for myself hereby acknowledge the risks of injury or damage (to property, personal injury and/or death) involved in participating in the above mentioned activity. I understand that there is a risk in riding live animals and acknowledge that my participation in this activity is purely voluntary. I assume full responsibility for myself, for any bodily injury, accident, illness, paralysis, death, loss of personal property and expenses thereof as a result of any accident which may occur while I participate in this activity at Destiny Ranch Arena.. I further agree to abide by all safety instructions, and to wear any safety equipment provided on the horseback ride while participating in the activity. I, for myself and hereby release, acquit and forgive Destiny Ranch LLC, family, heirs, employees, visitors and volunteers for any and all liability of any nature for any and all injury or damage (including property damage, personal injury, illness, paralysis, and/or death) as the result of my participation in the horseback activities. I, for myself also hereby expressly waive any claim, lawsuit, complaint, charge, or cause of action against Destiny Ranch LLC, family, heirs, employees, visitors, and volunteers and for any and all injury or damage including property damage, personal injury, illness, paralysis, and/or death, This waiver is made voluntarily. I have read this Release and Waiver Agreement and understand that by signing this document, I am waiving valuable legal rights including any and all rights that I may have against the Releases named above.`,
  available: true,
};

const signatureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const preparedFor = ({
  eventId = "event-1",
  contestantId = "contestant-1",
  signedAt = "2026-08-12T15:00:00.000Z",
  waiverDocument = document,
  status = "Live",
} = {}) =>
  prepareRegistrationDeskWaiver(
    {
      events: [{ id: eventId, name: "Roping", status }],
      contestants: [{ id: contestantId, name: contestantId.toUpperCase() }],
    },
    waiverDocument,
    {
      eventId,
      contestantId,
      signerName: "Rider One",
      signatureDataUrl,
      accepted: true,
    },
    {
      id: registrationDeskWaiverRecordId(
        eventId,
        contestantId,
        waiverDocument.version,
      ),
      signedAt,
    },
  );

const evidenceFor = (options) => preparedFor(options).evidence;

describe("Wix Registration Desk waiver contract", () => {
  it("allows upcoming waivers and rejects completed competitions", () => {
    expect(preparedFor({ status: "Upcoming" }).signature.eventId).toBe(
      "event-1",
    );
    expect(() => preparedFor({ status: "Complete" })).toThrow(
      "live or upcoming",
    );
  });

  it("returns unavailable without inventing missing legal language", () => {
    expect(normalizeRegistrationDeskWaiverDocument(null)).toEqual({
      title: "",
      version: "",
      text: "",
      available: false,
    });
    expect(
      normalizeRegistrationDeskWaiverDocument({
        payload: JSON.stringify({ title: "Only a title" }),
      }),
    ).toEqual({
      title: "Only a title",
      version: "",
      text: "",
      available: false,
    });
  });

  it("separates immutable evidence from the exact minimal status record", () => {
    const evidence = evidenceFor();
    const signature = registrationDeskWaiverSignatureProjection(evidence);
    expect(signature).toEqual({
      id: registrationDeskWaiverRecordId(
        "event-1",
        "contestant-1",
        document.version,
      ),
      eventId: "event-1",
      contestantId: "contestant-1",
      contestantName: "CONTESTANT-1",
      signerName: "Rider One",
      signedAt: "2026-08-12T15:00:00.000Z",
      waiverVersion: document.version,
    });
    expect(evidence).toMatchObject({
      source: "registration-desk",
      accepted: true,
      signatureDataUrl,
      waiverTitle: document.title,
      waiverText: document.text,
    });

    const status = createRegistrationDeskWaiverStatusRecord(evidence, document);
    expect(status).toEqual({
      source: "registration-desk",
      contestantId: "contestant-1",
      eventId: "event-1",
      signedAt: "2026-08-12T15:00:00.000Z",
      waiverVersion: document.version,
      evidenceAppId: evidence.id,
    });
    expect(Object.keys(status)).toEqual([
      "source",
      "contestantId",
      "eventId",
      "signedAt",
      "waiverVersion",
      "evidenceAppId",
    ]);
    expect(JSON.stringify(status)).not.toMatch(
      /signatureDataUrl|waiverTitle|waiverText|signerName|contestantName|staff/i,
    );
  });

  it("rejects signing when the document is unavailable", () => {
    expect(() =>
      prepareRegistrationDeskWaiver(
        {
          events: [{ id: "event-1", status: "Live" }],
          contestants: [{ id: "contestant-1", name: "RIDER ONE" }],
        },
        { title: "", version: "", text: "", available: false },
        {
          eventId: "event-1",
          contestantId: "contestant-1",
          signerName: "Rider One",
          signatureDataUrl,
          accepted: true,
        },
        { id: "waiver-1" },
      ),
    ).toThrow(/authoritative legal document is configured/);
  });

  it("projects only current-version minimal index rows without private reads", () => {
    const earlier = createRegistrationDeskWaiverStatusRecord(
      evidenceFor({
        eventId: "event-1",
        signedAt: "2026-08-12T15:00:00.000Z",
      }),
      document,
    );
    const latest = createRegistrationDeskWaiverStatusRecord(
      evidenceFor({
        eventId: "event-z",
        signedAt: "2026-08-13T15:00:00.000Z",
      }),
      document,
    );
    const tied = createRegistrationDeskWaiverStatusRecord(
      evidenceFor({
        eventId: "event-a",
        signedAt: "2026-08-13T15:00:00.000Z",
      }),
      document,
    );
    const previousDocument = {
      ...document,
      version: "2026-08-11-v1",
    };
    const oldVersion = createRegistrationDeskWaiverStatusRecord(
      evidenceFor({
        eventId: "event-old",
        signedAt: "2026-08-14T15:00:00.000Z",
        waiverDocument: previousDocument,
      }),
      previousDocument,
    );
    const privateReads = [];
    for (const privateField of [
      "signatureDataUrl",
      "waiverTitle",
      "waiverText",
      "signerName",
      "contestantName",
      "staffMemberId",
    ]) {
      Object.defineProperty(tied, privateField, {
        get() {
          privateReads.push(privateField);
          throw new Error(`Read private field ${privateField}`);
        },
      });
    }

    const statuses = contestantWaiverStatusesProjection(
      [
        evidenceFor(),
        oldVersion,
        { ...earlier, source: "online" },
        { ...earlier, signedAt: "not-a-date" },
        { ...earlier, evidenceAppId: "wrong-evidence-id" },
        { ...earlier, signatureDataUrl: "must-not-be-indexed" },
        earlier,
        latest,
        tied,
      ],
      document,
    );
    expect(statuses).toEqual({
      waiverVersion: document.version,
      statuses: [
        {
          contestantId: "contestant-1",
          signedAt: "2026-08-13T15:00:00.000Z",
          eventId: "event-a",
        },
      ],
    });
    expect(privateReads).toEqual([]);
    expect(JSON.stringify(statuses)).not.toMatch(
      /signatureDataUrl|waiverTitle|waiverText|signerName|contestantName|staff/i,
    );
    expect(
      contestantWaiverStatusesProjection([], {
        ...document,
        available: false,
      }),
    ).toEqual({ waiverVersion: "", statuses: [] });
  });

  it("repairs a missing status without overwriting immutable evidence", async () => {
    const prepared = preparedFor({
      eventId: "event-repair",
      contestantId: "contestant-repair",
    });
    const evidence = prepared.evidence;
    const evidenceSnapshot = JSON.stringify(evidence);
    expect(resolveRegistrationDeskWaiverRetry(evidence, prepared)).toEqual(
      prepared.signature,
    );
    expect(JSON.stringify(evidence)).toBe(evidenceSnapshot);
    let storedStatus = null;
    let insertAttempts = 0;
    const readStatusRecord = async () => storedStatus;

    await expect(
      ensureRegistrationDeskWaiverStatusIndexRecord({
        evidence,
        waiverDocument: document,
        readStatusRecord,
        insertStatusRecord: async () => {
          insertAttempts += 1;
          throw new Error("Simulated status write failure");
        },
      }),
    ).rejects.toThrow(/Simulated status write failure/);

    const repaired = await ensureRegistrationDeskWaiverStatusIndexRecord({
      evidence,
      waiverDocument: document,
      readStatusRecord,
      insertStatusRecord: async (status) => {
        insertAttempts += 1;
        storedStatus = {
          _id: "wix-system-id",
          ...status,
          signedAt: new Date(status.signedAt),
        };
      },
    });
    expect(repaired.evidenceAppId).toBe(evidence.id);

    const verified = await ensureRegistrationDeskWaiverStatusIndexRecord({
      evidence,
      waiverDocument: document,
      readStatusRecord,
      insertStatusRecord: async () => {
        throw new Error("Existing status must not be overwritten");
      },
    });
    expect(verified).toEqual(repaired);
    expect(insertAttempts).toBe(2);
    expect(evidence.signatureDataUrl).toBe(signatureDataUrl);
  });

  it("normal status loads read only the minimal index", async () => {
    const status = createRegistrationDeskWaiverStatusRecord(
      evidenceFor({
        eventId: "event-indexed",
        contestantId: "contestant-indexed",
      }),
      document,
    );
    let migrationCalls = 0;
    let statusReads = 0;

    const result = await loadContestantWaiverStatusesFromIndex({
      isMigrationComplete: async () => true,
      migrateLegacyEvidence: async () => {
        migrationCalls += 1;
        throw new Error("Normal load must not read evidence");
      },
      readStatusRecords: async (waiverVersion) => {
        statusReads += 1;
        expect(waiverVersion).toBe(document.version);
        return [status];
      },
      waiverDocument: document,
    });

    expect(migrationCalls).toBe(0);
    expect(statusReads).toBe(1);
    expect(result.statuses).toEqual([
      {
        contestantId: "contestant-indexed",
        signedAt: "2026-08-12T15:00:00.000Z",
        eventId: "event-indexed",
      },
    ]);
  });

  it("migrates once and remains idempotent after a partial failure", async () => {
    const previousDocument = {
      ...document,
      version: "2026-08-11-v1",
    };
    const oldEvidence = evidenceFor({
      eventId: "event-old",
      contestantId: "contestant-old",
      waiverDocument: previousDocument,
    });
    const evidenceRecords = [
      evidenceFor({
        eventId: "event-first",
        contestantId: "contestant-first",
      }),
      evidenceFor({
        eventId: "event-second",
        contestantId: "contestant-second",
      }),
    ];
    const stored = new Map();
    let insertionAttempts = 0;
    let failSecondOnce = true;
    const ensureStatusRecord = (evidence) =>
      ensureRegistrationDeskWaiverStatusIndexRecord({
        evidence,
        waiverDocument: document,
        readStatusRecord: async ({ evidenceAppId }) =>
          stored.get(evidenceAppId) || null,
        insertStatusRecord: async (status) => {
          insertionAttempts += 1;
          if (
            status.contestantId === "contestant-second" &&
            failSecondOnce
          ) {
            failSecondOnce = false;
            throw new Error("Simulated partial migration failure");
          }
          stored.set(status.evidenceAppId, status);
        },
      });

    await expect(
      migrateRegistrationDeskWaiverStatusIndex({
        evidenceRecords: [
          { malformed: true },
          { ...evidenceRecords[0], source: "online" },
          oldEvidence,
          evidenceRecords[0],
          evidenceRecords[1],
        ],
        ensureStatusRecord,
        waiverDocument: document,
      }),
    ).rejects.toThrow(/partial migration failure/);
    expect(stored.size).toBe(1);

    await expect(
      migrateRegistrationDeskWaiverStatusIndex({
        evidenceRecords,
        ensureStatusRecord,
        waiverDocument: document,
      }),
    ).resolves.toBe(2);
    expect(stored.size).toBe(2);
    expect(insertionAttempts).toBe(3);

    let migrationComplete = false;
    let evidenceScans = 0;
    const load = () =>
      loadContestantWaiverStatusesFromIndex({
        isMigrationComplete: async () => migrationComplete,
        migrateLegacyEvidence: async () => {
          evidenceScans += 1;
          migrationComplete = true;
        },
        readStatusRecords: async () => [...stored.values()],
        waiverDocument: document,
      });
    const migrated = await load();
    expect(evidenceScans).toBe(1);
    expect(await load()).toEqual(migrated);
    expect(evidenceScans).toBe(1);
  });
});
