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
  signatureCanvasBitmapSize,
  signatureCanvasPngDataUrl,
  signatureMarkIsValid,
  type SignaturePoint,
  type SignatureStroke,
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

const clamp = (value: number) => Math.min(1, Math.max(0, value));

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
  const strokesRef = useRef<SignatureStroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const pixelRatioRef = useRef(1);
  const busyRef = useRef(busy);
  const onCancelRef = useRef(onCancel);
  const [signerName, setSignerName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [markRevision, setMarkRevision] = useState(0);
  const [validationMessage, setValidationMessage] = useState("");
  const markIsValid = signatureMarkIsValid(strokesRef.current);

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
      strokesRef.current,
      canvas.width,
      canvas.height,
      pixelRatioRef.current,
    );
  }, []);

  const clearSignature = useCallback(() => {
    strokesRef.current = [];
    activePointerRef.current = null;
    setMarkRevision((revision) => revision + 1);
    setValidationMessage("");
    redraw();
  }, [redraw]);

  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const desk = document.querySelector<HTMLElement>(".registration-desk");
    const deskOverflow = desk?.style.overflow;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    if (desk) desk.style.overflow = "hidden";
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
      document.body.style.overflow = bodyOverflow;
      if (desk) desk.style.overflow = deskOverflow ?? "";
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waiverDocument.available) return;
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dimensions = signatureCanvasBitmapSize(
        bounds.width,
        bounds.height,
        window.devicePixelRatio,
      );
      pixelRatioRef.current = dimensions.pixelRatio;
      if (
        canvas.width !== dimensions.width ||
        canvas.height !== dimensions.height
      ) {
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
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
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [redraw, waiverDocument.available]);

  const pointFromEvent = (
    event: Pick<PointerEvent, "clientX" | "clientY">,
  ): SignaturePoint => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  };

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (busy || !waiverDocument.available) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    strokesRef.current = [
      ...strokesRef.current,
      [pointFromEvent(event.nativeEvent)],
    ];
    setValidationMessage("");
    setMarkRevision((revision) => revision + 1);
    redraw();
  };

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!stroke) return;
    const pointerEvents =
      event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    pointerEvents.forEach((pointerEvent) => {
      const point = pointFromEvent(pointerEvent);
      const previous = stroke[stroke.length - 1];
      if (
        !previous ||
        Math.hypot(point.x - previous.x, point.y - previous.y) >= 0.001
      ) {
        stroke.push(point);
      }
    });
    setMarkRevision((revision) => revision + 1);
    redraw();
  };

  const finishStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMarkRevision((revision) => revision + 1);
    redraw();
  };

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
                  aria-invalid={markRevision > 0 && !markIsValid}
                  tabIndex={0}
                  onPointerDown={startStroke}
                  onPointerMove={continueStroke}
                  onPointerUp={finishStroke}
                  onPointerCancel={finishStroke}
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
                    : markRevision
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
              disabled={busy || !markRevision}
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
              disabled={
                busy ||
                !accepted ||
                signerName.trim().length < 2 ||
                !markIsValid
              }
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
