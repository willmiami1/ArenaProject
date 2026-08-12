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

  it("keeps Clear, Cancel, and Sign directly below the signature pad", () => {
    const canvasIndex = dialogSource.indexOf("<canvas");
    const canvasEnd = dialogSource.indexOf("/>", canvasIndex) + 2;
    const actionsIndex = dialogSource.indexOf(
      'className="registration-waiver-canvas-actions"',
    );
    const actionsElementStart = dialogSource.lastIndexOf("<div", actionsIndex);
    const signingSectionEnd = dialogSource.indexOf("</section>", actionsIndex);
    const actionBlock = dialogSource.slice(actionsIndex, signingSectionEnd);
    const clearIndex = actionBlock.indexOf("onClick={clearSignature}");
    const cancelIndex = actionBlock.indexOf("onClick={onCancel}");
    const signIndex = actionBlock.indexOf('type="submit"');

    expect(canvasIndex).toBeGreaterThan(-1);
    expect(canvasEnd).toBeGreaterThan(canvasIndex);
    expect(actionsIndex).toBeGreaterThan(canvasIndex);
    expect(actionsElementStart).toBeGreaterThan(canvasEnd);
    expect(dialogSource.slice(canvasEnd, actionsElementStart).trim()).toBe("");
    expect(signingSectionEnd).toBeGreaterThan(actionsIndex);
    expect(clearIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeGreaterThan(clearIndex);
    expect(signIndex).toBeGreaterThan(cancelIndex);
    expect(actionBlock).toContain("disabled={!signatureReady}");
    expect(actionBlock).toContain('{busy ? "Signing…" : "Sign waiver"}');
    expect(dialogSource).not.toContain(
      '<footer className="registration-waiver-actions">',
    );
    expect(dialogSource).toContain(
      'className="registration-waiver-unavailable-cancel"',
    );

    const actions = cssRule(".registration-waiver-canvas-actions");
    const buttons = cssRule(
      ".registration-waiver-canvas-buttons button,.registration-waiver-unavailable-cancel",
    );
    expect(actions).toContain("display: grid");
    expect(buttons).toContain("min-height: 50px");
  });
});
