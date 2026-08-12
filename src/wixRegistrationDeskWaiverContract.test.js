import { describe, expect, it } from "vitest";
import {
  contestantWaiverStatusesProjection,
  normalizeRegistrationDeskWaiverDocument,
  prepareRegistrationDeskWaiver,
  registrationDeskWaiverSignatureProjection,
} from "../wix/backend/registration-desk-waiver-contract.js";

const workspace = {
  events: [{ id: "event-1", name: "Roping", status: "Live" }],
  contestants: [{ id: "contestant-1", name: "RIDER ONE" }],
};

const document = {
  title: "ACTIVITY WAIVER AGREEMENT",
  version: "2026-08-12-v1",
  text: `In consideration of being allowed to participate in team roping or any horse back riding at Destiny Ranch Arena located at Destiny Ranch LLC. 2549 E C 476 Bushnell FL 33513 also known as Destiny Ranch Events.
 I, for myself hereby acknowledge the risks of injury or damage (to property, personal injury and/or death) involved in participating in the above mentioned activity. I understand that there is a risk in riding live animals and acknowledge that my participation in this activity is purely voluntary. I assume full responsibility for myself, for any bodily injury, accident, illness, paralysis, death, loss of personal property and expenses thereof as a result of any accident which may occur while I participate in this activity at Destiny Ranch Arena.. I further agree to abide by all safety instructions, and to wear any safety equipment provided on the horseback ride while participating in the activity. I, for myself and hereby release, acquit and forgive Destiny Ranch LLC, family, heirs, employees, visitors and volunteers for any and all liability of any nature for any and all injury or damage (including property damage, personal injury, illness, paralysis, and/or death) as the result of my participation in the horseback activities. I, for myself also hereby expressly waive any claim, lawsuit, complaint, charge, or cause of action against Destiny Ranch LLC, family, heirs, employees, visitors, and volunteers and for any and all injury or damage including property damage, personal injury, illness, paralysis, and/or death, This waiver is made voluntarily. I have read this Release and Waiver Agreement and understand that by signing this document, I am waiving valuable legal rights including any and all rights that I may have against the Releases named above.`,
  available: true,
};

const request = {
  eventId: "event-1",
  contestantId: "contestant-1",
  signerName: "Rider One",
  signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  accepted: true,
};

describe("Wix Registration Desk waiver contract", () => {
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

  it("separates persisted evidence from projected status metadata", () => {
    const prepared = prepareRegistrationDeskWaiver(
      workspace,
      document,
      request,
      {
        id: "waiver-1",
        signedAt: "2026-08-12T15:00:00.000Z",
      },
    );
    expect(prepared.signature).toEqual({
      id: "waiver-1",
      eventId: "event-1",
      contestantId: "contestant-1",
      contestantName: "RIDER ONE",
      signerName: "Rider One",
      signedAt: "2026-08-12T15:00:00.000Z",
      waiverVersion: "2026-08-12-v1",
    });
    expect(prepared.evidence).toMatchObject({
      accepted: true,
      signatureDataUrl: request.signatureDataUrl,
      waiverTitle: document.title,
      waiverText: document.text,
    });
    expect(
      registrationDeskWaiverSignatureProjection(prepared.evidence),
    ).toEqual(prepared.signature);
    expect(
      registrationDeskWaiverSignatureProjection(prepared.evidence),
    ).not.toHaveProperty("signatureDataUrl");
  });

  it("rejects signing when the document is unavailable", () => {
    expect(() =>
      prepareRegistrationDeskWaiver(
        workspace,
        { title: "", version: "", text: "", available: false },
        request,
        { id: "waiver-1" },
      ),
    ).toThrow(/authoritative legal document is configured/);
  });

  it("projects only the latest current-version status without private evidence", () => {
    const evidence = (overrides) => ({
      id: "waiver-current",
      eventId: "event-current",
      contestantId: "contestant-1",
      contestantName: "RIDER ONE",
      signerName: "Rider One",
      signedAt: "2026-08-12T15:00:00.000Z",
      waiverVersion: document.version,
      accepted: true,
      signatureDataUrl: request.signatureDataUrl,
      waiverTitle: document.title,
      waiverText: document.text,
      ...overrides,
    });
    const records = [
      evidence({
        id: "waiver-old-version",
        eventId: "event-old",
        signedAt: "2026-08-13T15:00:00.000Z",
        waiverVersion: "2026-08-11-v1",
      }),
      evidence({
        id: "waiver-current-earlier",
        eventId: "event-1",
        signedAt: "2026-08-12T15:00:00.000Z",
      }),
      evidence({
        id: "waiver-current-latest",
        eventId: "event-z",
        signedAt: "2026-08-13T15:00:00.000Z",
      }),
      evidence({
        id: "waiver-current-tie",
        eventId: "event-a",
        signedAt: "2026-08-13T15:00:00.000Z",
      }),
      evidence({
        id: "waiver-incomplete",
        eventId: "event-incomplete",
        signatureDataUrl: undefined,
      }),
    ];
    const statuses = contestantWaiverStatusesProjection(records, document);
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
    expect(JSON.stringify(statuses)).not.toContain("signatureDataUrl");
    expect(JSON.stringify(statuses)).not.toContain("signerName");
    expect(
      contestantWaiverStatusesProjection(
        [],
        { ...document, available: false },
      ),
    ).toEqual({ waiverVersion: "", statuses: [] });
  });
});
