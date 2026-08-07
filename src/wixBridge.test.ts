import { describe, expect, it } from "vitest";
import { trustedWixRelayOrigin } from "./wixBridge";

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
