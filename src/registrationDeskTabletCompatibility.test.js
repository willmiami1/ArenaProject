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
    expect(content).toContain("overflow-x: hidden");
    expect(content).toContain("overflow-y: auto");
    expect(dialogSource).not.toContain("document.body.style.overflow");
  });

  it("uses one DOM and grid column without inheriting workspace main positioning", () => {
    const dialog = cssRule(".registration-waiver-dialog");
    const content = cssRule(".registration-waiver-content");
    const documentIndex = dialogSource.indexOf(
      'className="registration-waiver-document"',
    );
    const signerNameIndex = dialogSource.indexOf(
      'className="registration-waiver-name"',
    );
    const acceptanceIndex = dialogSource.indexOf(
      'className="registration-waiver-acceptance"',
    );
    const canvasIndex = dialogSource.indexOf("<canvas");

    expect(dialog).toContain("grid-template-columns: minmax(0,1fr)");
    expect(content).toContain("grid-template-columns: minmax(0,1fr)");
    expect(content).toContain("grid-column: 1");
    expect(styles).not.toContain("minmax(360px,.85fr)");
    expect(styles).not.toContain("minmax(0,1.15fr)");
    expect(dialogSource).not.toContain(
      '<main className="registration-waiver',
    );
    expect(documentIndex).toBeGreaterThan(-1);
    expect(signerNameIndex).toBeGreaterThan(documentIndex);
    expect(acceptanceIndex).toBeGreaterThan(signerNameIndex);
    expect(canvasIndex).toBeGreaterThan(acceptanceIndex);
  });

  it("contains the dialog, text, controls, and canvas within safe viewport bounds", () => {
    const overlay = cssRule(".registration-waiver-overlay");
    const dialog = cssRule(".registration-waiver-dialog");
    const content = cssRule(".registration-waiver-content");
    const sections = cssRule(
      ".registration-waiver-document,.registration-waiver-signing",
    );
    const nameInput = cssRule(".registration-waiver-name input");
    const canvas = cssRule(".registration-waiver-canvas");
    const canvasField = cssRule(".registration-waiver-canvas-field");
    const actions = cssRule(".registration-waiver-canvas-actions");
    const buttons = cssRule(".registration-waiver-canvas-buttons button");
    const legalText = cssRule(".registration-waiver-document>div");

    expect(overlay).toContain("width: 100vw");
    expect(overlay).toContain("width: 100dvw");
    expect(overlay).toContain("height: 100dvh");
    expect(overlay).toContain("max-width: 100%");
    expect(overlay).toContain("box-sizing: border-box");
    expect(overlay).toContain("env(safe-area-inset-left,0)");
    expect(overlay).toContain("overflow-x: hidden");
    [dialog, content, sections, nameInput, canvas, canvasField, actions, buttons].forEach(
      (rule) => {
        expect(rule).toContain("max-width: 100%");
        expect(rule).toContain("min-width: 0");
      },
    );
    expect(canvas).toContain("width: 100%");
    expect(canvas).toContain("box-sizing: border-box");
    expect(legalText).toContain("overflow-wrap: anywhere");
    expect(legalText).toContain("white-space: pre-wrap");
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
    const canvasButtons = cssRule(
      ".registration-waiver-canvas-buttons button",
    );
    expect(actions).toContain("display: grid");
    expect(buttons).toContain("min-height: 50px");
    expect(canvasButtons).toContain("width: 100%");
    expect(canvasButtons).toContain("max-width: 100%");
    expect(canvasButtons).toContain("min-width: 0");
  });
});
