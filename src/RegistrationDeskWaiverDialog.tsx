import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { CheckCircle2, Eraser, X } from "lucide-react";
import type { RegistrationDeskWaiverDocument } from "./registrationDeskData";
import {
  drawSignatureStrokes,
  signatureCanvasPngDataUrl,
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
  type SignatureClientPoint,
} from "./signatureCanvas";

interface RegistrationDeskWaiverDialogProps {
  contestantName: string;
  eventName: string;
  waiverDocument: RegistrationDeskWaiverDocument;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (signature: {
    signerName: string;
    signatureDataUrl: string;
  }) => Promise<void>;
}

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "canvas[tabindex]",
  "[href]",
].join(",");

const touchWithIdentifier = (touches: TouchList, identifier: number) => {
  for (let index = 0; index < touches.length; index += 1) {
    if (touches[index].identifier === identifier) return touches[index];
  }
  return null;
};

const preventCanvasGesture = (event: Event) => {
  if (event.cancelable) event.preventDefault();
};

export function RegistrationDeskWaiverDialog({
  contestantName,
  eventName,
  waiverDocument,
  busy,
  error,
  onCancel,
  onSubmit,
}: RegistrationDeskWaiverDialogProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef(new SignatureStrokeTracker());
  const pixelRatioRef = useRef(1);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const [signerName, setSignerName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [, setMarkRevision] = useState(0);
  const [validationMessage, setValidationMessage] = useState("");
  const strokes = trackerRef.current.getStrokes();
  const hasMark = strokes.some((stroke) => stroke.length > 0);
  const markIsValid = signatureMarkIsValid(strokes);
  const signatureReady = signatureSubmissionReady({
    accepted,
    signerName,
    strokes,
    busy,
  });

  useEffect(() => {
    busyRef.current = busy;
    onCancelRef.current = onCancel;
  }, [busy, onCancel]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawSignatureStrokes(
      context,
      trackerRef.current.getStrokes(),
      canvas.width,
      canvas.height,
      pixelRatioRef.current,
    );
  }, []);

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current;
    const pointerId = trackerRef.current.getActivePointerId();
    if (canvas && pointerId !== null) {
      tryReleaseSignaturePointerCapture(canvas, pointerId);
    }
    trackerRef.current.clear();
    setMarkRevision((revision) => revision + 1);
    setValidationMessage("");
    redraw();
  }, [redraw]);

  const notifyStrokeChanged = useCallback(() => {
    setValidationMessage("");
    setMarkRevision((revision) => revision + 1);
    redraw();
  }, [redraw]);

  const pointFromClient = useCallback((point: SignatureClientPoint) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return bounds ? signaturePointFromClient(point, bounds) : null;
  }, []);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    cancelButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialogRef.current.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waiverDocument.available) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const plan = signatureCanvasResizePlan(
        bounds.width,
        bounds.height,
        window.devicePixelRatio,
        canvas.width,
        canvas.height,
      );
      if (!plan) return;
      pixelRatioRef.current = plan.pixelRatio;
      if (plan.changed) {
        canvas.width = plan.width;
        canvas.height = plan.height;
      }
      redraw();
    };
    resize();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(resize);
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("orientationchange", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [redraw, waiverDocument.available]);

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      busy ||
      !waiverDocument.available ||
      !signaturePointerCanStart(event.nativeEvent)
    ) {
      return;
    }
    const point = pointFromClient(event.nativeEvent);
    if (!point) return;
    event.preventDefault();
    const tracker = trackerRef.current;
    const changed = tracker.startPointer(event.pointerId, point);
    if (tracker.getActivePointerId() === event.pointerId) {
      trySetSignaturePointerCapture(event.currentTarget, event.pointerId);
    }
    if (changed) notifyStrokeChanged();
  };

  useEffect(() => {
    if (!waiverDocument.available) return;

    const movePointer = (event: PointerEvent) => {
      const tracker = trackerRef.current;
      if (tracker.getActivePointerId() !== event.pointerId) return;
      preventCanvasGesture(event);
      if (!signaturePointerIsPressed(event)) {
        tracker.endPointer(event.pointerId);
        if (canvasRef.current) {
          tryReleaseSignaturePointerCapture(
            canvasRef.current,
            event.pointerId,
          );
        }
        notifyStrokeChanged();
        return;
      }
      const points = signaturePointerSamples(event)
        .map(pointFromClient)
        .filter((point) => point !== null);
      if (tracker.movePointer(event.pointerId, points)) {
        notifyStrokeChanged();
      }
    };

    const finishPointer = (event: PointerEvent) => {
      const tracker = trackerRef.current;
      if (tracker.getActivePointerId() !== event.pointerId) return;
      preventCanvasGesture(event);
      const handled =
        event.type === "pointercancel"
          ? tracker.cancelPointer(event.pointerId)
          : tracker.endPointer(event.pointerId);
      if (canvasRef.current) {
        tryReleaseSignaturePointerCapture(canvasRef.current, event.pointerId);
      }
      if (handled) notifyStrokeChanged();
    };

    const pointerOptions: AddEventListenerOptions = { passive: false };
    window.addEventListener("pointermove", movePointer, pointerOptions);
    window.addEventListener("pointerup", finishPointer, pointerOptions);
    window.addEventListener("pointercancel", finishPointer, pointerOptions);
    return () => {
      window.removeEventListener("pointermove", movePointer, pointerOptions);
      window.removeEventListener("pointerup", finishPointer, pointerOptions);
      window.removeEventListener(
        "pointercancel",
        finishPointer,
        pointerOptions,
      );
    };
  }, [
    notifyStrokeChanged,
    pointFromClient,
    waiverDocument.available,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waiverDocument.available) return;

    const startTouch = (event: TouchEvent) => {
      if (busyRef.current) return;
      const tracker = trackerRef.current;
      if (tracker.getActiveTouchId() !== null) {
        preventCanvasGesture(event);
        return;
      }
      const touch = event.changedTouches[0];
      if (!touch) return;
      const point = pointFromClient(touch);
      if (!point) return;
      const changed = tracker.startTouch(touch.identifier, point);
      if (tracker.getActiveTouchId() === touch.identifier) {
        preventCanvasGesture(event);
      }
      if (changed) notifyStrokeChanged();
    };

    const moveTouch = (event: TouchEvent) => {
      const tracker = trackerRef.current;
      const touchId = tracker.getActiveTouchId();
      if (touchId === null) return;
      const touch =
        touchWithIdentifier(event.touches, touchId) ||
        touchWithIdentifier(event.changedTouches, touchId);
      if (!touch) return;
      preventCanvasGesture(event);
      const point = pointFromClient(touch);
      if (point && tracker.moveTouch(touchId, [point])) {
        notifyStrokeChanged();
      }
    };

    const finishTouch = (event: TouchEvent) => {
      const tracker = trackerRef.current;
      const touchId = tracker.getActiveTouchId();
      if (touchId === null) return;
      const ended =
        Boolean(touchWithIdentifier(event.changedTouches, touchId)) ||
        !touchWithIdentifier(event.touches, touchId);
      if (!ended) return;
      preventCanvasGesture(event);
      const pointerId = tracker.getActivePointerId();
      const handled =
        event.type === "touchcancel"
          ? tracker.cancelTouch(touchId)
          : tracker.endTouch(touchId);
      if (pointerId !== null) {
        tryReleaseSignaturePointerCapture(canvas, pointerId);
      }
      if (handled) notifyStrokeChanged();
    };

    const touchOptions: AddEventListenerOptions = { passive: false };
    canvas.addEventListener("touchstart", startTouch, touchOptions);
    canvas.addEventListener("touchmove", moveTouch, touchOptions);
    canvas.addEventListener("touchend", finishTouch, touchOptions);
    canvas.addEventListener("touchcancel", finishTouch, touchOptions);
    return () => {
      canvas.removeEventListener("touchstart", startTouch, touchOptions);
      canvas.removeEventListener("touchmove", moveTouch, touchOptions);
      canvas.removeEventListener("touchend", finishTouch, touchOptions);
      canvas.removeEventListener("touchcancel", finishTouch, touchOptions);
    };
  }, [
    notifyStrokeChanged,
    pointFromClient,
    waiverDocument.available,
  ]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const legalName = signerName.trim().replace(/\s+/g, " ");
    if (!waiverDocument.available) {
      setValidationMessage(
        "Waiver signing is unavailable until staff configures the legal document.",
      );
      return;
    }
    if (!accepted) {
      setValidationMessage("Explicitly accept the waiver before signing.");
      return;
    }
    if (legalName.length < 2) {
      setValidationMessage("Enter the signer's legal name.");
      return;
    }
    if (!markIsValid) {
      setValidationMessage(
        "Draw a complete signature. A blank canvas or minimal mark is not accepted.",
      );
      canvasRef.current?.focus();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      setValidationMessage("Signature capture is not available.");
      return;
    }
    try {
      const signatureDataUrl = signatureCanvasPngDataUrl(
        canvas,
        pixelRatioRef.current,
      );
      setValidationMessage("");
      await onSubmit({ signerName: legalName, signatureDataUrl });
    } catch (submissionError) {
      setValidationMessage(
        submissionError instanceof Error
          ? submissionError.message
          : "The signature could not be prepared.",
      );
    }
  };

  return (
    <div className="registration-waiver-overlay">
      <form
        ref={dialogRef}
        className="registration-waiver-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="registration-waiver-title"
        aria-describedby="registration-waiver-context"
        tabIndex={-1}
        onSubmit={submit}
      >
        <header className="registration-waiver-header">
          <div>
            <span>Registration Desk tablet waiver</span>
            <h1 id="registration-waiver-title">
              {waiverDocument.available
                ? waiverDocument.title
                : "Waiver unavailable"}
            </h1>
            <p id="registration-waiver-context">
              {contestantName} · {eventName}
              {waiverDocument.available
                ? ` · Version ${waiverDocument.version}`
                : ""}
            </p>
          </div>
          <button
            ref={cancelButtonRef}
            type="button"
            className="registration-waiver-close"
            aria-label="Cancel and close waiver"
            disabled={busy}
            onClick={onCancel}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {!waiverDocument.available ? (
          <main className="registration-waiver-unavailable" role="status">
            <strong>Staff setup required</strong>
            <p>
              Configure the authoritative waiver title, version, and legal text
              in the Registration Desk backend before handing the tablet to a
              participant. Signing is disabled and no placeholder waiver is
              shown.
            </p>
          </main>
        ) : (
          <main className="registration-waiver-content">
            <section
              className="registration-waiver-document"
              aria-label="Waiver document"
            >
              <h2>{waiverDocument.title}</h2>
              <div>{waiverDocument.text}</div>
            </section>

            <section
              className="registration-waiver-signing"
              aria-labelledby="registration-waiver-signing-title"
            >
              <h2 id="registration-waiver-signing-title">
                Acceptance and signature
              </h2>
              <label className="registration-waiver-acceptance">
                <input
                  type="checkbox"
                  checked={accepted}
                  disabled={busy}
                  onChange={(event) => {
                    setAccepted(event.target.checked);
                    setValidationMessage("");
                  }}
                />
                <span>
                  <strong>I have read and explicitly accept this waiver.</strong>
                  <small>
                    Acceptance is required before the signature can be submitted.
                  </small>
                </span>
              </label>
              <label className="registration-waiver-name">
                Signer legal name
                <input
                  required
                  maxLength={120}
                  autoComplete="name"
                  autoCapitalize="words"
                  disabled={busy}
                  value={signerName}
                  onChange={(event) => {
                    setSignerName(event.target.value);
                    setValidationMessage("");
                  }}
                />
              </label>
              <div className="registration-waiver-canvas-field">
                <div>
                  <strong>Draw signature</strong>
                  <small id="registration-waiver-canvas-help">
                    Use a finger, stylus, mouse, or pointer. Draw a complete
                    signature inside the box.
                  </small>
                </div>
                <canvas
                  ref={canvasRef}
                  className="registration-waiver-canvas"
                  role="img"
                  aria-label="Signature drawing canvas"
                  aria-describedby="registration-waiver-canvas-help"
                  aria-invalid={hasMark && !markIsValid}
                  tabIndex={0}
                  onPointerDown={startStroke}
                  onContextMenu={(event) => event.preventDefault()}
                  onKeyDown={(event) => {
                    if (event.key === "Delete" || event.key === "Backspace") {
                      event.preventDefault();
                      clearSignature();
                    }
                  }}
                />
                <p className="registration-waiver-mark-status" role="status">
                  {markIsValid
                    ? "Signature captured."
                    : hasMark
                      ? "Keep drawing a complete signature."
                      : "Signature required."}
                </p>
              </div>
              {(validationMessage || error) && (
                <p className="registration-waiver-error" role="alert">
                  {validationMessage || error}
                </p>
              )}
            </section>
          </main>
        )}

        <footer className="registration-waiver-actions">
          {waiverDocument.available && (
            <button
              type="button"
              disabled={busy || !hasMark}
              onClick={clearSignature}
            >
              <Eraser aria-hidden="true" /> Clear
            </button>
          )}
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {waiverDocument.available && (
            <button
              type="submit"
              className="primary"
              disabled={!signatureReady}
            >
              <CheckCircle2 aria-hidden="true" />
              {busy ? "Signing…" : "Sign waiver"}
            </button>
          )}
        </footer>
      </form>
    </div>
  );
}
