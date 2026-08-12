import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageRelay = readFileSync(
  new URL("../wix/page-code.js", import.meta.url),
  "utf8",
);
const publicSite = readFileSync(
  new URL("./PublicSite.tsx", import.meta.url),
  "utf8",
);
const onlineSignup = readFileSync(
  new URL("./onlineSignup.ts", import.meta.url),
  "utf8",
);

describe("Registration Desk waiver surface isolation", () => {
  it("relays the dedicated bridge action to the backend", () => {
    expect(pageRelay).toContain("submitRegistrationDeskWaiver,");
    expect(pageRelay).toContain(
      'message.action === "submitRegistrationDeskWaiver"',
    );
    expect(pageRelay).toContain(
      "submitRegistrationDeskWaiver(message.data)",
    );
  });

  it("does not add waiver signing to public or online signup code", () => {
    expect(publicSite).not.toContain("submitRegistrationDeskWaiver");
    expect(onlineSignup).not.toContain("submitRegistrationDeskWaiver");
    expect(publicSite).not.toContain("RegistrationDeskWaiverDialog");
    expect(onlineSignup).not.toContain("RegistrationDeskWaiverDialog");
  });
});
