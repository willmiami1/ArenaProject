import { createHash } from "crypto";

const validId = /^[A-Za-z0-9_-]{1,100}$/;
const pngDataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export const REGISTRATION_DESK_WAIVER_ERROR_CODES = Object.freeze({
  recordConflict: "WAIVER_RECORD_CONFLICT",
});

export class RegistrationDeskWaiverError extends Error {
  constructor(code) {
    super(
      code === REGISTRATION_DESK_WAIVER_ERROR_CODES.recordConflict
        ? "The existing waiver signature record does not match this competition, contestant, and waiver version."
        : "The waiver signature record is invalid.",
    );
    this.name = "RegistrationDeskWaiverError";
    this.code = code;
  }
}

const waiverRecordConflict = () =>
  new RegistrationDeskWaiverError(
    REGISTRATION_DESK_WAIVER_ERROR_CODES.recordConflict,
  );

export const unavailableRegistrationDeskWaiverDocument = Object.freeze({
  title: "",
  version: "",
  text: "",
  available: false,
});

export function normalizeRegistrationDeskWaiverDocument(record) {
  let source = record?.payload ?? record;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source);
    } catch {
      return { ...unavailableRegistrationDeskWaiverDocument };
    }
  }
  const title = typeof source?.title === "string" ? source.title.trim() : "";
  const version =
    typeof source?.version === "string" ? source.version.trim() : "";
  const text = typeof source?.text === "string" ? source.text.trim() : "";
  return {
    title,
    version,
    text,
    available: source?.available !== false && Boolean(title && version && text),
  };
}

export function registrationDeskWaiverRecordId(
  eventId,
  contestantId,
  waiverVersion,
) {
  const digest = createHash("sha256")
    .update(JSON.stringify([eventId, contestantId, waiverVersion]))
    .digest("hex")
    .slice(0, 32);
  return `waiver-${digest}`;
}

export function registrationDeskWaiverSignatureProjection(record) {
  if (
    !record ||
    typeof record.id !== "string" ||
    typeof record.eventId !== "string" ||
    typeof record.contestantId !== "string" ||
    typeof record.contestantName !== "string" ||
    typeof record.signerName !== "string" ||
    typeof record.signedAt !== "string" ||
    typeof record.waiverVersion !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    eventId: record.eventId,
    contestantId: record.contestantId,
    contestantName: record.contestantName,
    signerName: record.signerName,
    signedAt: record.signedAt,
    waiverVersion: record.waiverVersion,
  };
}

const compareCanonicalText = (left, right) =>
  left < right ? -1 : left > right ? 1 : 0;

const canonicalWaiverName = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const assertRegistrationDeskWaiverEvidence = (
  record,
  eventId,
  contestantId,
  waiverDocument,
) => {
  const document = normalizeRegistrationDeskWaiverDocument(waiverDocument);
  const signature = registrationDeskWaiverSignatureProjection(record);
  const contestantName = canonicalWaiverName(record?.contestantName);
  const signerName = canonicalWaiverName(record?.signerName);
  const signedAtMs = Date.parse(signature?.signedAt || "");
  const expectedId = registrationDeskWaiverRecordId(
    eventId,
    contestantId,
    document.version,
  );
  if (
    !document.available ||
    !signature ||
    signature.id !== expectedId ||
    signature.eventId !== eventId ||
    signature.contestantId !== contestantId ||
    signature.waiverVersion !== document.version ||
    !contestantName ||
    contestantName !== record.contestantName ||
    !signerName ||
    signerName !== record.signerName ||
    signerName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(signerName) ||
    record.source !== "registration-desk" ||
    record.accepted !== true ||
    record.waiverTitle !== document.title ||
    record.waiverText !== document.text ||
    typeof record.signatureDataUrl !== "string" ||
    record.signatureDataUrl.length > 4_000_000 ||
    !pngDataUrlPattern.test(record.signatureDataUrl) ||
    !Number.isFinite(signedAtMs) ||
    new Date(signedAtMs).toISOString() !== signature.signedAt
  ) {
    throw waiverRecordConflict();
  }
  return record;
};

export function resolveRegistrationDeskWaiverRetry(evidence, prepared) {
  const persisted = assertRegistrationDeskWaiverEvidence(
    evidence,
    prepared?.signature?.eventId,
    prepared?.signature?.contestantId,
    prepared?.waiverDocument,
  );
  return registrationDeskWaiverSignatureProjection(persisted);
}

const WAIVER_STATUS_CUSTOM_FIELDS = new Set([
  "source",
  "contestantId",
  "eventId",
  "signedAt",
  "waiverVersion",
  "evidenceAppId",
]);

const contestantWaiverStatusCandidate = (record, waiverDocument) => {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).some(
      (field) =>
        !field.startsWith("_") && !WAIVER_STATUS_CUSTOM_FIELDS.has(field),
    ) ||
    record.source !== "registration-desk" ||
    record.waiverVersion !== waiverDocument.version ||
    !validId.test(String(record.eventId || "")) ||
    !validId.test(String(record.contestantId || "")) ||
    !validId.test(String(record.evidenceAppId || "")) ||
    record.evidenceAppId !==
      registrationDeskWaiverRecordId(
        record.eventId,
        record.contestantId,
        waiverDocument.version,
      ) ||
    (!(record.signedAt instanceof Date) &&
      typeof record.signedAt !== "string")
  ) {
    return null;
  }

  const signedAtMs = new Date(record.signedAt).getTime();
  if (!Number.isFinite(signedAtMs)) return null;
  const signedAt = new Date(signedAtMs).toISOString();
  if (typeof record.signedAt === "string" && record.signedAt !== signedAt) {
    return null;
  }
  return {
    contestantId: record.contestantId,
    signedAt,
    signedAtMs,
    eventId: record.eventId,
    evidenceAppId: record.evidenceAppId,
  };
};

const contestantWaiverStatusIsPreferred = (candidate, current) =>
  candidate.signedAtMs > current.signedAtMs ||
  (candidate.signedAtMs === current.signedAtMs &&
    (compareCanonicalText(candidate.eventId, current.eventId) < 0 ||
      (candidate.eventId === current.eventId &&
        compareCanonicalText(
          candidate.evidenceAppId,
          current.evidenceAppId,
        ) < 0)));

export function createRegistrationDeskWaiverStatusRecord(
  evidence,
  waiverDocument,
) {
  const document = normalizeRegistrationDeskWaiverDocument(waiverDocument);
  const persisted = assertRegistrationDeskWaiverEvidence(
    evidence,
    evidence?.eventId,
    evidence?.contestantId,
    document,
  );
  return {
    source: persisted.source,
    contestantId: persisted.contestantId,
    eventId: persisted.eventId,
    signedAt: persisted.signedAt,
    waiverVersion: persisted.waiverVersion,
    evidenceAppId: persisted.id,
  };
}

const resolveRegistrationDeskWaiverStatusRecord = (
  record,
  expected,
  waiverDocument,
) => {
  const candidate = contestantWaiverStatusCandidate(record, waiverDocument);
  if (
    !candidate ||
    candidate.contestantId !== expected.contestantId ||
    candidate.eventId !== expected.eventId ||
    candidate.signedAt !== expected.signedAt ||
    candidate.evidenceAppId !== expected.evidenceAppId
  ) {
    throw waiverRecordConflict();
  }
  return expected;
};

export async function ensureRegistrationDeskWaiverStatusIndexRecord({
  evidence,
  readStatusRecord,
  insertStatusRecord,
  waiverDocument,
}) {
  const document = normalizeRegistrationDeskWaiverDocument(waiverDocument);
  const expected = createRegistrationDeskWaiverStatusRecord(
    evidence,
    document,
  );
  const existing = await readStatusRecord(expected);
  if (existing) {
    return resolveRegistrationDeskWaiverStatusRecord(
      existing,
      expected,
      document,
    );
  }

  try {
    await insertStatusRecord(expected);
    return expected;
  } catch (error) {
    const collision = await readStatusRecord(expected);
    if (!collision) throw error;
    return resolveRegistrationDeskWaiverStatusRecord(
      collision,
      expected,
      document,
    );
  }
}

export async function migrateRegistrationDeskWaiverStatusIndex({
  evidenceRecords,
  ensureStatusRecord,
  waiverDocument,
}) {
  let indexed = 0;
  for (const evidence of Array.isArray(evidenceRecords)
    ? evidenceRecords
    : []) {
    try {
      createRegistrationDeskWaiverStatusRecord(evidence, waiverDocument);
    } catch (error) {
      if (error instanceof RegistrationDeskWaiverError) continue;
      throw error;
    }
    await ensureStatusRecord(evidence);
    indexed += 1;
  }
  return indexed;
}

export function contestantWaiverStatusesProjection(records, waiverDocument) {
  const document = normalizeRegistrationDeskWaiverDocument(waiverDocument);
  if (!document.available) {
    return { waiverVersion: "", statuses: [] };
  }
  const latestByContestantId = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const candidate = contestantWaiverStatusCandidate(record, document);
    if (!candidate) continue;
    const prior = latestByContestantId.get(candidate.contestantId);
    if (!prior || contestantWaiverStatusIsPreferred(candidate, prior)) {
      latestByContestantId.set(candidate.contestantId, candidate);
    }
  }
  return {
    waiverVersion: document.version,
    statuses: [...latestByContestantId.values()]
      .sort((left, right) =>
        compareCanonicalText(left.contestantId, right.contestantId),
      )
      .map(({ contestantId, signedAt, eventId }) => ({
        contestantId,
        signedAt,
        eventId,
      })),
  };
}

export async function loadContestantWaiverStatusesFromIndex({
  isMigrationComplete,
  migrateLegacyEvidence,
  readStatusRecords,
  waiverDocument,
}) {
  const document = normalizeRegistrationDeskWaiverDocument(waiverDocument);
  if (!document.available) {
    return { waiverVersion: "", statuses: [] };
  }
  if (!(await isMigrationComplete())) {
    await migrateLegacyEvidence();
  }
  return contestantWaiverStatusesProjection(
    await readStatusRecords(document.version),
    document,
  );
}

export function prepareRegistrationDeskWaiver(
  workspace,
  waiverDocument,
  request,
  { id, signedAt = new Date().toISOString() },
) {
  if (
    !waiverDocument?.available ||
    !waiverDocument.title ||
    !waiverDocument.version ||
    !waiverDocument.text
  ) {
    throw new Error(
      "Waiver signing is unavailable until the authoritative legal document is configured.",
    );
  }
  if (
    !request ||
    request.accepted !== true ||
    !validId.test(request.eventId || "") ||
    !validId.test(request.contestantId || "")
  ) {
    throw new Error("Choose a valid competition and contestant, then accept the waiver.");
  }
  const event = workspace.events.find(({ id: eventId }) => eventId === request.eventId);
  if (
    !event ||
    (event.status !== "Live" && event.status !== "Upcoming") ||
    event.registrationOpen !== true ||
    event.drawLocked !== false
  ) {
    throw new Error(
      "Waivers can be signed only for an open, unlocked Live or Upcoming Registration Desk competition.",
    );
  }
  const contestant = workspace.contestants.find(
    ({ id: contestantId }) => contestantId === request.contestantId,
  );
  if (!contestant) throw new Error("Contestant not found.");
  const signerName = String(request.signerName || "").trim().replace(/\s+/g, " ");
  if (signerName.length < 2 || signerName.length > 120) {
    throw new Error("Enter the signer's legal name.");
  }
  const signatureDataUrl = String(request.signatureDataUrl || "");
  if (
    signatureDataUrl.length > 4_000_000 ||
    !pngDataUrlPattern.test(signatureDataUrl)
  ) {
    throw new Error("Capture a valid PNG signature.");
  }
  const expectedId = registrationDeskWaiverRecordId(
    request.eventId,
    request.contestantId,
    waiverDocument.version,
  );
  if (!validId.test(id || "") || id !== expectedId) {
    throw new Error("The waiver signature ID is invalid.");
  }
  const signedAtMs = new Date(signedAt).getTime();
  if (!Number.isFinite(signedAtMs)) {
    throw new Error("The waiver signature timestamp is invalid.");
  }

  const signature = {
    id,
    eventId: event.id,
    contestantId: contestant.id,
    contestantName: contestant.name,
    signerName,
    signedAt: new Date(signedAtMs).toISOString(),
    waiverVersion: waiverDocument.version,
  };
  return {
    signature,
    evidence: {
      ...signature,
      source: "registration-desk",
      accepted: true,
      signatureDataUrl,
      waiverTitle: waiverDocument.title,
      waiverText: waiverDocument.text,
    },
    waiverDocument: {
      title: waiverDocument.title,
      version: waiverDocument.version,
      text: waiverDocument.text,
      available: true,
    },
  };
}
