import { describe, expect, it } from "vitest";
import {
  registrationDeskEntryPatch,
  registrationDeskEntryPermissions,
  registrationDeskScratchRequest,
  type RegistrationDeskEntryDraft,
} from "./registrationDeskEntryActions";
import type { RegistrationDeskEvent } from "./registrationDeskData";

const liveEvent = {
  status: "Live",
  registrationOpen: true,
  drawLocked: false,
} as RegistrationDeskEvent;

const draft: RegistrationDeskEntryDraft = {
  key: "registration:entry:Header",
  eventId: "event",
  recordType: "registration",
  recordId: "entry",
  role: "Header",
  entries: 2,
  horseName: " HORSE ",
  paid: true,
  paymentMethod: "cash",
};

describe("Registration Desk entry actions", () => {
  it("allows edits only for secured, open, unlocked live entries", () => {
    expect(registrationDeskEntryPermissions(liveEvent, true, false)).toEqual({
      canEdit: true,
      canScratch: true,
    });
    expect(
      registrationDeskEntryPermissions(
        { ...liveEvent, drawLocked: true },
        true,
        false,
      ).canEdit,
    ).toBe(false);
    expect(registrationDeskEntryPermissions(liveEvent, false, false)).toEqual({
      canEdit: false,
      canScratch: false,
    });
  });

  it("blocks generated team edits while retaining whole-team scratch", () => {
    expect(registrationDeskEntryPermissions(liveEvent, true, true)).toEqual({
      canEdit: false,
      canScratch: true,
    });
  });

  it("builds only the authoritative registration allowlist", () => {
    expect(registrationDeskEntryPatch(draft)).toEqual({
      role: "Header",
      entries: 2,
      horseName: "HORSE",
      paid: true,
      paymentMethod: "cash",
    });
  });

  it("updates only the selected team role horse and payment fields", () => {
    expect(
      registrationDeskEntryPatch({
        ...draft,
        recordType: "team",
        role: "Heeler",
        paymentMethod: "",
      }),
    ).toEqual({
      heelerHorseName: "HORSE",
      paid: true,
    });
  });

  it("builds a confirmed scratch only for the selected event", () => {
    expect(registrationDeskScratchRequest(draft, "event")).toEqual({
      eventId: "event",
      recordType: "registration",
      recordId: "entry",
      confirmed: true,
    });
    expect(() => registrationDeskScratchRequest(draft, "another-event")).toThrow(
      "owns this entry",
    );
  });
});
