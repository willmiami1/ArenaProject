import type {
  RegistrationDeskData,
  RegistrationDeskWaiverRequest,
  RegistrationDeskWaiverResponse,
  RegistrationDeskWaiverSignature,
  RegistrationDeskWaiverStatus,
} from "./registrationDeskData";
import type { RegistrationDeskRosterEntry } from "./registrationDeskRoster";
import { registrationDeskIsVisible } from "./registrationWindow";

const pngDataUrlPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

export interface RegistrationDeskWaiverParticipant {
  contestantId: string;
  name: string;
}

export function registrationDeskWaiverParticipants(
  entries: RegistrationDeskRosterEntry[],
): RegistrationDeskWaiverParticipant[] {
  const participants = new Map<string, RegistrationDeskWaiverParticipant>();
  entries.forEach(({ contestantId, name }) => {
    if (!participants.has(contestantId)) {
      participants.set(contestantId, { contestantId, name });
    }
  });
  return [...participants.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.contestantId.localeCompare(right.contestantId),
  );
}

/**
 * Roster participants who still owe a current-version waiver. Contestants whose
 * waiver is already confirmed are omitted so the desk roster only lists work
 * that is still outstanding.
 */
export function registrationDeskOutstandingWaiverParticipants(
  data: RegistrationDeskData | null,
  eventId: string,
  entries: RegistrationDeskRosterEntry[],
): RegistrationDeskWaiverParticipant[] {
  return registrationDeskWaiverParticipants(entries).filter(
    ({ contestantId }) =>
      !registrationDeskWaiverStatus(data, eventId, contestantId),
  );
}

export function registrationDeskWaiverStatus(
  data: RegistrationDeskData | null,
  eventId: string,
  contestantId: string,
): RegistrationDeskWaiverStatus | undefined {
  if (!data || !eventId || !contestantId) return undefined;
  if (
    data.waiverDocument.version &&
    data.waiverStatus.waiverVersion === data.waiverDocument.version
  ) {
    const currentStatus = data.waiverStatus.statuses
      .filter((status) => status.contestantId === contestantId)
      .sort(
        (left, right) =>
          right.signedAt.localeCompare(left.signedAt) ||
          left.eventId.localeCompare(right.eventId),
      )[0];
    if (currentStatus) return currentStatus;
  }

  // Compatibility for a Registration Desk backend that predates the global
  // minimal status snapshot.
  return data.waiverSignatures
    .filter(
      (signature) =>
        signature.eventId === eventId &&
        signature.contestantId === contestantId &&
        signature.waiverVersion === data.waiverDocument.version,
    )
    .sort((left, right) => right.signedAt.localeCompare(left.signedAt))[0];
}

export function submitLocalRegistrationDeskWaiver(
  data: RegistrationDeskData,
  request: RegistrationDeskWaiverRequest,
  now = new Date(),
): RegistrationDeskWaiverResponse {
  const document = data.waiverDocument;
  if (
    !document.available ||
    !document.title.trim() ||
    !document.version.trim() ||
    !document.text.trim()
  ) {
    throw new Error(
      "Waiver signing is unavailable until the authoritative legal document is configured.",
    );
  }
  if (request.accepted !== true) {
    throw new Error("The participant must explicitly accept the waiver.");
  }
  const event = data.events.find(({ id }) => id === request.eventId);
  if (!event) throw new Error("Competition not found.");
  if (!registrationDeskIsVisible(event)) {
    throw new Error(
      "Waivers can be signed only for a live or upcoming Registration Desk competition.",
    );
  }
  const contestant = data.contestants.find(
    ({ id }) => id === request.contestantId,
  );
  if (!contestant) throw new Error("Contestant not found.");
  const signerName = request.signerName.trim().replace(/\s+/g, " ");
  if (signerName.length < 2 || signerName.length > 120) {
    throw new Error("Enter the signer's legal name.");
  }
  if (
    request.signatureDataUrl.length > 4_000_000 ||
    !pngDataUrlPattern.test(request.signatureDataUrl)
  ) {
    throw new Error("Capture a valid PNG signature.");
  }

  const signedAt = now.toISOString();
  const signature: RegistrationDeskWaiverSignature = {
    id: `local-waiver-${event.id}-${contestant.id}-${now.getTime()}`,
    eventId: event.id,
    contestantId: contestant.id,
    contestantName: contestant.name,
    signerName,
    signedAt,
    waiverVersion: document.version,
  };
  return {
    signature,
    data: {
      ...data,
      waiverStatus: {
        waiverVersion: document.version,
        statuses: [
          ...data.waiverStatus.statuses.filter(
            (item) => item.contestantId !== contestant.id,
          ),
          {
            contestantId: contestant.id,
            eventId: event.id,
            signedAt,
          },
        ],
      },
      waiverSignatures: [
        ...data.waiverSignatures.filter(
          (item) =>
            item.eventId !== event.id ||
            item.contestantId !== contestant.id,
        ),
        signature,
      ],
    },
  };
}
