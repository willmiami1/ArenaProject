import type { RegistrationDeskEvent } from "./registrationDeskData";
import { registrationDeskIsVisible } from "./registrationWindow";

export interface RegistrationDeskEntryDraft {
  key: string;
  eventId: string;
  recordType: "registration" | "team";
  recordId: string;
  role: "Header" | "Heeler";
  entries: number;
  horseName: string;
  paid: boolean;
  paymentMethod: "" | "cash" | "card" | "tab";
}

export function registrationDeskEntryPermissions(
  event: RegistrationDeskEvent,
  embedded: boolean,
  generatedTeam: boolean,
) {
  const available = registrationDeskIsVisible(event);
  return {
    canEdit:
      embedded &&
      available &&
      !generatedTeam,
    canScratch: embedded && available,
  };
}

export function registrationDeskEntryPatch(
  draft: RegistrationDeskEntryDraft,
): Record<string, unknown> {
  const paymentPatch = draft.paymentMethod
    ? { paymentMethod: draft.paymentMethod }
    : {};
  if (draft.recordType === "registration") {
    return {
      role: draft.role,
      entries: draft.entries,
      horseName: draft.horseName.trim(),
      paid: draft.paid,
      ...paymentPatch,
    };
  }

  return {
    [draft.role === "Header" ? "headerHorseName" : "heelerHorseName"]:
      draft.horseName.trim(),
    paid: draft.paid,
    ...paymentPatch,
  };
}

export function registrationDeskScratchRequest(
  entry: Pick<
    RegistrationDeskEntryDraft,
    "eventId" | "recordType" | "recordId"
  >,
  selectedEventId: string,
) {
  if (entry.eventId !== selectedEventId) {
    throw new Error("Choose the competition that owns this entry before deleting it.");
  }
  return {
    eventId: selectedEventId,
    recordType: entry.recordType,
    recordId: entry.recordId,
    confirmed: true as const,
  };
}
