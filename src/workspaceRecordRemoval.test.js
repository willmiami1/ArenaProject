import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const backendMirror = readFileSync(
  new URL("../wix/backend/arena-data.web.js", import.meta.url),
  "utf8",
);

const protectionHelper = backendMirror.slice(
  backendMirror.indexOf("function protectedOnlineAppIds("),
  backendMirror.indexOf("async function syncRecords("),
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
    expect(protectionHelper).toContain(
      'if (record.source !== "online") return false;',
    );
    expect(protectionHelper).toContain(
      "return submittedAt > loadedAt && submittedAt <= now;",
    );
  });

  it("does not let an unparseable or future-dated timestamp block removal", () => {
    expect(protectionHelper).not.toContain("<= loadedAt");
    expect(protectionHelper).not.toContain('submittedAt || "") > loadedAt,');
  });
});
