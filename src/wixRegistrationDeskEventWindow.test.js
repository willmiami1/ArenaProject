import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backend = readFileSync(
  new URL("../wix/backend/arena-data.web.js", import.meta.url),
  "utf8",
);

describe("Wix Registration Desk event window source contract", () => {
  it("mirrors the open, unlocked Live and Upcoming projection and assertion", () => {
    expect(backend).toMatch(
      /const registrationDeskIsVisible = \(event\) =>\s+\(event\.status === "Live" \|\| event\.status === "Upcoming"\) &&\s+event\.registrationOpen === true &&\s+event\.drawLocked === false;/,
    );
    expect(backend).toMatch(
      /if \(event\.status !== "Live" && event\.status !== "Upcoming"\)/,
    );
    expect(backend).toContain(
      "Registration Desk entries are limited to Live or Upcoming competitions.",
    );
    expect(backend).not.toContain(
      "Registration Desk entries are limited to live competitions.",
    );
  });
});
