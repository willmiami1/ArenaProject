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
