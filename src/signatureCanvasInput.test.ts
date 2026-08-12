import { describe, expect, it } from "vitest";
import {
  signatureCanvasResizePlan,
  signatureMarkIsValid,
  signaturePointFromClient,
  signaturePointerCanStart,
  signaturePointerIsPressed,
  signaturePointerSamples,
  signatureSubmissionReady,
  SignatureStrokeTracker,
  tryReleaseSignaturePointerCapture,
  trySetSignaturePointerCapture,
  type SignaturePoint,
} from "./signatureCanvas";

const signaturePoints: SignaturePoint[] = [
  { x: 0.1, y: 0.5 },
  { x: 0.2, y: 0.32 },
  { x: 0.31, y: 0.61 },
  { x: 0.43, y: 0.38 },
  { x: 0.57, y: 0.62 },
  { x: 0.73, y: 0.41 },
];

describe("tablet signature input", () => {
  it("records a complete pointer stroke without depending on pointer capture", () => {
    const tracker = new SignatureStrokeTracker();
    const captureTarget = {
      setPointerCapture() {
        throw new DOMException("Pointer capture is unavailable.", "NotFoundError");
      },
    };

    expect(trySetSignaturePointerCapture(captureTarget, 7)).toBe(false);
    expect(tracker.startPointer(7, signaturePoints[0])).toBe(true);
    expect(tracker.movePointer(7, signaturePoints.slice(1))).toBe(true);
    expect(tracker.endPointer(7)).toBe(true);
    expect(signatureMarkIsValid(tracker.getStrokes())).toBe(true);
    expect(tracker.hasActiveInput()).toBe(false);
  });

  it("enables submission after a valid touch-only fallback sequence", () => {
    const tracker = new SignatureStrokeTracker();
    expect(tracker.startTouch(42, signaturePoints[0])).toBe(true);
    signaturePoints.slice(1).forEach((point) => {
      expect(tracker.moveTouch(42, [point])).toBe(true);
    });
    expect(tracker.endTouch(42)).toBe(true);

    expect(
      signatureSubmissionReady({
        accepted: true,
        signerName: "Rider One",
        strokes: tracker.getStrokes(),
      }),
    ).toBe(true);
  });

  it("keeps a minimal tablet mark invalid and submission disabled", () => {
    const tracker = new SignatureStrokeTracker();
    tracker.startTouch(12, { x: 0.5, y: 0.5 });
    [0.505, 0.51, 0.515, 0.52, 0.525].forEach((x) => {
      tracker.moveTouch(12, [{ x, y: 0.5 }]);
    });
    tracker.endTouch(12);

    expect(signatureMarkIsValid(tracker.getStrokes())).toBe(false);
    expect(
      signatureSubmissionReady({
        accepted: true,
        signerName: "Rider One",
        strokes: tracker.getStrokes(),
      }),
    ).toBe(false);
  });

  it("deduplicates pointer and touch events from the same physical stroke", () => {
    const tracker = new SignatureStrokeTracker();
    tracker.startPointer(3, signaturePoints[0]);
    tracker.startTouch(81, signaturePoints[0]);
    signaturePoints.slice(1).forEach((point) => {
      tracker.movePointer(3, [point]);
      tracker.moveTouch(81, [point]);
    });
    tracker.endTouch(81);

    expect(tracker.getStrokes()).toHaveLength(1);
    expect(tracker.getStrokes()[0]).toEqual(signaturePoints);
    expect(signatureMarkIsValid(tracker.getStrokes())).toBe(true);
  });

  it("continues through touch fallback after a pointer cancellation", () => {
    const tracker = new SignatureStrokeTracker();
    tracker.startPointer(9, signaturePoints[0]);
    tracker.startTouch(90, signaturePoints[0]);
    tracker.movePointer(9, signaturePoints.slice(1, 3));
    expect(tracker.cancelPointer(9)).toBe(true);
    expect(tracker.hasActiveInput()).toBe(true);
    tracker.moveTouch(90, signaturePoints.slice(3));
    tracker.endTouch(90);

    expect(signatureMarkIsValid(tracker.getStrokes())).toBe(true);
    expect(tracker.hasActiveInput()).toBe(false);
  });

  it("ends or cancels touch input cleanly without accepting stale moves", () => {
    const tracker = new SignatureStrokeTracker();
    tracker.startTouch(5, signaturePoints[0]);
    tracker.moveTouch(5, [signaturePoints[1]]);
    expect(tracker.cancelTouch(5)).toBe(true);
    expect(tracker.hasActiveInput()).toBe(false);
    expect(tracker.moveTouch(5, signaturePoints.slice(2))).toBe(false);

    expect(tracker.startTouch(6, signaturePoints[2])).toBe(true);
    tracker.moveTouch(6, signaturePoints.slice(3));
    expect(tracker.endTouch(6)).toBe(true);
    expect(tracker.getStrokes()).toHaveLength(2);
  });

  it("guards capture release errors and non-captured pointers", () => {
    expect(
      tryReleaseSignaturePointerCapture(
        {
          hasPointerCapture: () => false,
          releasePointerCapture: () => {
            throw new Error("should not run");
          },
        },
        2,
      ),
    ).toBe(true);
    expect(
      tryReleaseSignaturePointerCapture(
        {
          hasPointerCapture: () => true,
          releasePointerCapture: () => {
            throw new DOMException("Capture was lost.", "NotFoundError");
          },
        },
        2,
      ),
    ).toBe(false);
  });

  it("accepts primary finger and stylus input without mouse button assumptions", () => {
    expect(
      signaturePointerCanStart({
        pointerType: "touch",
        button: 0,
        isPrimary: true,
      }),
    ).toBe(true);
    expect(
      signaturePointerCanStart({
        pointerType: "pen",
        button: 0,
        isPrimary: true,
      }),
    ).toBe(true);
    expect(
      signaturePointerCanStart({
        pointerType: "mouse",
        button: 2,
        isPrimary: true,
      }),
    ).toBe(false);
    expect(
      signaturePointerCanStart({
        pointerType: "touch",
        button: 0,
        isPrimary: false,
      }),
    ).toBe(false);
    expect(
      signaturePointerIsPressed({ pointerType: "mouse", buttons: 0 }),
    ).toBe(false);
    expect(
      signaturePointerIsPressed({ pointerType: "touch", buttons: 0 }),
    ).toBe(true);
    expect(
      signaturePointerIsPressed({ pointerType: "pen", buttons: 0 }),
    ).toBe(true);
  });

  it("falls back to the current pointer sample when coalescing throws", () => {
    const event = {
      clientX: 12,
      clientY: 24,
      getCoalescedEvents() {
        throw new Error("Unsupported");
      },
    };
    expect(signaturePointerSamples(event)).toEqual([event]);
  });

  it("uses current canvas bounds and preserves normalized strokes across resize", () => {
    expect(
      signaturePointFromClient(
        { clientX: 150, clientY: 100 },
        { left: 100, top: 50, width: 200, height: 100 },
      ),
    ).toEqual({ x: 0.25, y: 0.5 });
    expect(
      signaturePointFromClient(
        { clientX: 500, clientY: -50 },
        { left: 100, top: 50, width: 200, height: 100 },
      ),
    ).toEqual({ x: 1, y: 0 });
    expect(
      signaturePointFromClient(
        { clientX: 1, clientY: 1 },
        { left: 0, top: 0, width: 0, height: 100 },
      ),
    ).toBeNull();

    const tracker = new SignatureStrokeTracker();
    tracker.startTouch(1, signaturePoints[0]);
    tracker.moveTouch(1, signaturePoints.slice(1));
    tracker.endTouch(1);
    const beforeResize = tracker.getStrokes().map((stroke) => [...stroke]);
    expect(signatureCanvasResizePlan(320, 180, 2, 0, 0)).toMatchObject({
      width: 640,
      height: 360,
      pixelRatio: 2,
      changed: true,
    });
    expect(signatureCanvasResizePlan(640, 300, 2, 640, 360)).toMatchObject({
      width: 1280,
      height: 600,
      pixelRatio: 2,
      changed: true,
    });
    expect(signatureCanvasResizePlan(0, 300, 2, 640, 360)).toBeNull();
    expect(tracker.getStrokes()).toEqual(beforeResize);
    expect(signatureMarkIsValid(tracker.getStrokes())).toBe(true);
  });
});
