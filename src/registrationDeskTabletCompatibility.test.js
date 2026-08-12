import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(
  new URL("./RegistrationDeskWaiverDialog.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("./styles.css", import.meta.url),
  "utf8",
);

const cssRule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped} \\{([^}]*)\\}`))?.[1] ?? "";
};

describe("Registration Desk tablet browser compatibility", () => {
  it("scopes touch blocking to the signature canvas while keeping dialog scrolling", () => {
    const canvas = cssRule(".registration-waiver-canvas");
    const content = cssRule(".registration-waiver-content");
    expect(canvas).toContain("touch-action: none");
    expect(canvas).toContain("overscroll-behavior: contain");
    expect(canvas).toContain("-webkit-touch-callout: none");
    expect(content).toContain("touch-action: pan-y");
    expect(content).toContain("-webkit-overflow-scrolling: touch");
    expect(dialogSource).not.toContain("document.body.style.overflow");
  });

  it("registers non-passive native touch fallback and guarded pointer continuation", () => {
    expect(dialogSource).toContain(
      'canvas.addEventListener("touchstart", startTouch, touchOptions)',
    );
    expect(dialogSource).toContain(
      'canvas.addEventListener("touchmove", moveTouch, touchOptions)',
    );
    expect(dialogSource).toContain(
      'const touchOptions: AddEventListenerOptions = { passive: false }',
    );
    expect(dialogSource).toContain(
      'window.addEventListener("pointermove", movePointer, pointerOptions)',
    );
    expect(dialogSource).toContain("trySetSignaturePointerCapture");
    expect(dialogSource).not.toContain(
      "event.currentTarget.setPointerCapture(event.pointerId)",
    );
  });

  it("observes orientation and visual viewport changes for high-DPI redraw", () => {
    expect(dialogSource).toContain(
      'window.addEventListener("orientationchange", resize)',
    );
    expect(dialogSource).toContain(
      'window.visualViewport?.addEventListener("resize", resize)',
    );
    expect(dialogSource).toContain("signatureCanvasResizePlan(");
  });
});
