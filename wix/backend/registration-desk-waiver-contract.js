const validId = /^[A-Za-z0-9_-]{1,100}$/;
const pngDataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

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
    available: Boolean(title && version && text),
  };
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

const contestantWaiverStatusCandidate = (record, waiverDocument) => {
  const signature = registrationDeskWaiverSignatureProjection(record);
  const contestantName = canonicalWaiverName(record?.contestantName);
  const signerName = canonicalWaiverName(record?.signerName);
  const signedAtMs = Date.parse(signature?.signedAt || "");
  if (
    !signature ||
    !validId.test(signature.id) ||
    !validId.test(signature.eventId) ||
    !validId.test(signature.contestantId) ||
    signature.waiverVersion !== waiverDocument.version ||
    !contestantName ||
    contestantName !== record.contestantName ||
    !signerName ||
    signerName !== record.signerName ||
    signerName.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(signerName) ||
    record.accepted !== true ||
    record.waiverTitle !== waiverDocument.title ||
    record.waiverText !== waiverDocument.text ||
    typeof record.signatureDataUrl !== "string" ||
    record.signatureDataUrl.length > 4_000_000 ||
    !pngDataUrlPattern.test(record.signatureDataUrl) ||
    !Number.isFinite(signedAtMs) ||
    new Date(signedAtMs).toISOString() !== signature.signedAt
  ) {
    return null;
  }
  return {
    contestantId: signature.contestantId,
    signedAt: signature.signedAt,
    signedAtMs,
    eventId: signature.eventId,
    recordId: signature.id,
  };
};

const contestantWaiverStatusIsPreferred = (candidate, current) =>
  candidate.signedAtMs > current.signedAtMs ||
  (candidate.signedAtMs === current.signedAtMs &&
    (compareCanonicalText(candidate.eventId, current.eventId) < 0 ||
      (candidate.eventId === current.eventId &&
        compareCanonicalText(candidate.recordId, current.recordId) < 0)));

export function contestantWaiverStatusesProjection(records, waiverDocument) {
  const waiverVersion =
    waiverDocument?.available === true &&
    typeof waiverDocument.version === "string"
      ? waiverDocument.version.trim()
      : "";
  if (!waiverVersion || !Array.isArray(records)) {
    return { waiverVersion, statuses: [] };
  }
  const latestByContestantId = new Map();
  for (const record of records) {
    const candidate = contestantWaiverStatusCandidate(record, waiverDocument);
    if (!candidate) continue;
    const prior = latestByContestantId.get(candidate.contestantId);
    if (!prior || contestantWaiverStatusIsPreferred(candidate, prior)) {
      latestByContestantId.set(candidate.contestantId, candidate);
    }
  }
  return {
    waiverVersion,
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
  if (!event || event.status !== "Live") {
    throw new Error("Waivers can be signed only for a live Registration Desk competition.");
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
  if (!validId.test(id || "")) {
    throw new Error("The waiver signature ID is invalid.");
  }

  const signature = {
    id,
    eventId: event.id,
    contestantId: contestant.id,
    contestantName: contestant.name,
    signerName,
    signedAt,
    waiverVersion: waiverDocument.version,
  };
  return {
    signature,
    evidence: {
      ...signature,
      accepted: true,
      signatureDataUrl,
      waiverTitle: waiverDocument.title,
      waiverText: waiverDocument.text,
    },
  };
}
