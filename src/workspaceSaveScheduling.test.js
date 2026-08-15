import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldRearmWorkspaceSaveAfterBusySave } from "./useArenaData";

const source = readFileSync(new URL("./useArenaData.ts", import.meta.url), "utf8");

describe("workspace save scheduling", () => {
  it("re-arms a deferred workspace save while local changes are still unsaved", () => {
    expect(shouldRearmWorkspaceSaveAfterBusySave(true, false)).toBe(true);
  });

  it("does not re-arm when nothing is dirty", () => {
    expect(shouldRearmWorkspaceSaveAfterBusySave(false, false)).toBe(false);
  });

  it("does not re-arm while a granular Event save is failing", () => {
    expect(shouldRearmWorkspaceSaveAfterBusySave(true, true)).toBe(false);
  });

  it("keeps the debounced workspace save in a ref instead of an effect-local timer", () => {
    expect(source).toContain("const workspaceSaveTimer = useRef(0);");
    expect(source).toContain(
      "workspaceSaveTimer.current = window.setTimeout(async () => {",
    );
  });

  it("never cancels a pending workspace save from the autosave effect cleanup", () => {
    expect(source).not.toContain("return () => window.clearTimeout(timeout);");
  });

  it("re-arms rather than dropping a workspace save that collides with another save", () => {
    expect(source).toContain("shouldRearmWorkspaceSaveAfterBusySave(");
    expect(source).toContain("saveIdleWaiters.current.push(() => {");
  });

  it("saves the latest local workspace state when the debounce finally fires", () => {
    expect(source).toContain("const submitted = dataRef.current;");
    expect(source).not.toContain("const submitted = data;");
  });
});
