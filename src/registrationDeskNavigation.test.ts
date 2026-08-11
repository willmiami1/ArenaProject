import { describe, expect, it } from "vitest";
import { registrationDeskWorkspaceHref } from "./registrationDeskNavigation";

describe("Registration Desk workspace navigation", () => {
  it("opens Arena Command and preserves the Wix relay origin", () => {
    expect(
      registrationDeskWorkspaceHref(
        "https://embed.example/?app=registration&wixHostOrigin=https%3A%2F%2Fwww.destinyrancharena.com",
      ),
    ).toBe(
      "?app=command&wixHostOrigin=https%3A%2F%2Fwww.destinyrancharena.com",
    );
  });

  it("opens the local Arena Command route without relay metadata", () => {
    expect(
      registrationDeskWorkspaceHref("http://localhost:5173/?app=registration"),
    ).toBe("?app=command");
  });
});
