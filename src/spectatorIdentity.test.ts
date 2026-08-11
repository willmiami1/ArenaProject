import { describe, expect, it } from "vitest";
import {
  spectatorAvatarInitials,
  spectatorIdentityInput,
  spectatorIdentityLabel,
} from "./spectatorIdentity";

describe("spectator play identity", () => {
  it("uppercases lowercase typing in controlled state", () => {
    expect(spectatorIdentityInput("will rider")).toBe("WILL RIDER");
  });

  it("uppercases pasted mixed-case text without trimming it early", () => {
    expect(spectatorIdentityInput("  Will McRider  ")).toBe(
      "  WILL MCRIDER  ",
    );
  });

  it("renders stored mixed-case names and avatar initials in uppercase", () => {
    expect(spectatorIdentityLabel("Will McRider")).toBe("WILL MCRIDER");
    expect(spectatorAvatarInitials("Will McRider")).toBe("WM");
    expect(spectatorAvatarInitials("  lone  ")).toBe("L");
  });
});
