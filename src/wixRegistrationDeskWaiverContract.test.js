import { describe, expect, it } from "vitest";
import {
  normalizeRegistrationDeskWaiverDocument,
  prepareRegistrationDeskWaiver,
  registrationDeskWaiverSignatureProjection,
} from "../wix/backend/registration-desk-waiver-contract.js";

const workspace = {
  events: [{ id: "event-1", name: "Roping", status: "Live" }],
  contestants: [{ id: "contestant-1", name: "RIDER ONE" }],
};

const document = {
  title: "Configured waiver",
  version: "v1",
  text: "Arena-supplied authoritative text.",
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
      waiverVersion: "v1",
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
});
