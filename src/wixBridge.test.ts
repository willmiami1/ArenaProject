import { describe, expect, it } from "vitest";
import {
  publicEventSectionTargetId,
  isWorkspaceSaveConfirmation,
  sensitiveWixAction,
  trustedWixRelayOrigin,
  wixResponseErrorMessage,
} from "./wixBridge";

describe("trusted Wix relay origin", () => {
  const siteOrigin = "https://www.destinyrancharena.com";
  const relayOrigin = "https://www-destinyrancharena-com.filesusr.com";

  it("accepts a Wix relay when the configured site is in the ancestor chain", () => {
    expect(
      trustedWixRelayOrigin(
        siteOrigin,
        null,
        [relayOrigin, siteOrigin],
        relayOrigin,
      ),
    ).toBe(relayOrigin);
  });

  describe("Wix relay errors", () => {
    it("reads structured public signup failures without exposing the error code", () => {
      expect(
        wixResponseErrorMessage({
          code: "INVALID_CREDENTIALS",
          message: "Email or PIN is incorrect.",
        }),
      ).toBe("Email or PIN is incorrect.");
    });

    it("recognizes only complete compact workspace save confirmations", () => {
      expect(
        isWorkspaceSaveConfirmation({
          saved: true,
          revision: 12,
          staffRevision: 9,
          onlineRevision: 3,
          loadedAt: "2026-08-10T20:20:00.000Z",
        }),
      ).toBe(true);
      expect(
        isWorkspaceSaveConfirmation({
          saved: true,
          revision: 12,
          staffRevision: 9,
          onlineRevision: Number.NaN,
          loadedAt: "2026-08-10T20:20:00.000Z",
        }),
      ).toBe(false);
    });

    it("keeps legacy string relay failures compatible", () => {
      expect(wixResponseErrorMessage("The requested Arena action failed.")).toBe(
        "The requested Arena action failed.",
      );
    });

    it("requires the trusted Wix relay for direct contestant saves", () => {
      expect(sensitiveWixAction("saveContestant")).toBe(true);
    });

    it("requires the trusted Wix relay for direct Event saves", () => {
      expect(sensitiveWixAction("saveEvent")).toBe(true);
    });

    it("requires the trusted Wix relay for direct registration saves", () => {
      expect(sensitiveWixAction("saveRegistration")).toBe(true);
    });

    it("requires the trusted Wix relay for Registration Desk waiver evidence", () => {
      expect(sensitiveWixAction("submitRegistrationDeskWaiver")).toBe(true);
    });

    it("requires the trusted Wix relay for contestant waiver status", () => {
      expect(sensitiveWixAction("loadContestantWaiverStatuses")).toBe(true);
    });

    it("requires the trusted Wix relay for signed waiver evidence", () => {
      expect(sensitiveWixAction("loadContestantSignedWaiver")).toBe(true);
    });

    it("requires the trusted Wix relay for cash signup submission", () => {
      expect(sensitiveWixAction("submitPublicSignupCash")).toBe(true);
    });
  });

  describe("public event section links", () => {
    it("maps Wix section values to public event anchors", () => {
      expect(publicEventSectionTargetId("future")).toBe("events-future");
      expect(publicEventSectionTargetId("current")).toBe("events-live");
      expect(publicEventSectionTargetId("live")).toBe("events-live");
      expect(publicEventSectionTargetId("past")).toBe("events-past");
      expect(publicEventSectionTargetId("events")).toBe("events");
    });

    it("rejects unknown or malformed section values", () => {
      expect(publicEventSectionTargetId("admin")).toBeNull();
      expect(publicEventSectionTargetId(null)).toBeNull();
    });
  });

  it("accepts the explicit host parameter when ancestor origins are unavailable", () => {
    expect(
      trustedWixRelayOrigin(siteOrigin, siteOrigin, [], relayOrigin),
    ).toBe(relayOrigin);
  });

  it("accepts only the configured site's exact filesusr relay without metadata", () => {
    expect(
      trustedWixRelayOrigin(siteOrigin, null, [], relayOrigin),
    ).toBe(relayOrigin);
    expect(
      trustedWixRelayOrigin(
        siteOrigin,
        null,
        [],
        "https://another-site.filesusr.com",
      ),
    ).toBe(false);
  });

  it("rejects untrusted sites and non-Wix parents", () => {
    expect(
      trustedWixRelayOrigin(
        siteOrigin,
        null,
        ["https://another-site.filesusr.com", "https://attacker.example"],
        "https://another-site.filesusr.com",
      ),
    ).toBe(false);
    expect(
      trustedWixRelayOrigin(
        siteOrigin,
        siteOrigin,
        [],
        "https://attacker.example",
      ),
    ).toBe(false);
  });
});
