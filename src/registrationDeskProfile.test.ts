import { describe, expect, it } from "vitest";
import { showStandaloneRegistrationProfile } from "./registrationDeskProfile";

describe("Registration Desk contestant profile placement", () => {
  it("shows Add Contestant when no contestant is selected", () => {
    expect(
      showStandaloneRegistrationProfile(true, undefined, undefined),
    ).toBe(true);
  });

  it("keeps editing the selected contestant in the inline panel", () => {
    expect(
      showStandaloneRegistrationProfile(true, "contestant-1", "contestant-1"),
    ).toBe(false);
  });

  it("does not render a closed profile", () => {
    expect(
      showStandaloneRegistrationProfile(false, undefined, undefined),
    ).toBe(false);
  });
});
