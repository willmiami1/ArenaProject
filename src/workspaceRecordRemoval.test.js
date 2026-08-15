import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backendMirror = readFileSync(
  new URL("../wix/backend/arena-data.web.js", import.meta.url),
  "utf8",
);

describe("workspace record removal", () => {
  it("removes stored records the workspace no longer sends", () => {
    expect(backendMirror).toContain(
      "!incomingIds.has(item.appId) && !protectedAppIds.has(item.appId),",
    );
  });

  it("no longer gates removal behind a set of parsed payload ids", () => {
    expect(backendMirror).not.toContain("removableAppIds");
    expect(backendMirror).not.toContain("removableIds");
  });

  it("protects only online submissions newer than the workspace load", () => {
    expect(backendMirror).toContain("function protectedOnlineAppIds(");
    expect(backendMirror).toContain('record.source === "online" &&');
    expect(backendMirror).toContain(
      'Date.parse(record.submittedAt || "") > loadedAt,',
    );
  });

  it("does not let an unparseable timestamp block removal", () => {
    expect(backendMirror).not.toContain(
      'Date.parse(record.submittedAt || "") <= loadedAt',
    );
  });
});
