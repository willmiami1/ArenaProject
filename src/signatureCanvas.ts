export interface SignaturePoint {
  x: number;
  y: number;
}

export type SignatureStroke = SignaturePoint[];

export interface SignatureMarkMetrics {
  pointCount: number;
  pathLength: number;
  width: number;
  height: number;
}

export interface SignaturePixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function signatureMarkMetrics(
  strokes: SignatureStroke[],
): SignatureMarkMetrics {
  let pointCount = 0;
  let pathLength = 0;
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;

  strokes.forEach((stroke) => {
    stroke.forEach((point, index) => {
      pointCount += 1;
      minimumX = Math.min(minimumX, point.x);
      minimumY = Math.min(minimumY, point.y);
      maximumX = Math.max(maximumX, point.x);
      maximumY = Math.max(maximumY, point.y);
      if (index > 0) {
        const previous = stroke[index - 1];
        pathLength += Math.hypot(
          point.x - previous.x,
          point.y - previous.y,
        );
      }
    });
  });

  return {
    pointCount,
    pathLength,
    width: pointCount ? maximumX - minimumX : 0,
    height: pointCount ? maximumY - minimumY : 0,
  };
}

export function signatureMarkIsValid(strokes: SignatureStroke[]) {
  const metrics = signatureMarkMetrics(strokes);
  return (
    metrics.pointCount >= 6 &&
    metrics.pathLength >= 0.08 &&
    Math.max(metrics.width, metrics.height) >= 0.04
  );
}

export function signatureCanvasBitmapSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
) {
  const pixelRatio = Math.max(1, Math.min(devicePixelRatio || 1, 3));
  return {
    width: Math.max(1, Math.round(cssWidth * pixelRatio)),
    height: Math.max(1, Math.round(cssHeight * pixelRatio)),
    pixelRatio,
  };
}

export function drawSignatureStrokes(
  context: CanvasRenderingContext2D,
  strokes: SignatureStroke[],
  width: number,
  height: number,
  pixelRatio: number,
) {
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#17110d";
  context.fillStyle = "#17110d";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(2, 3 * pixelRatio);

  strokes.forEach((stroke) => {
    if (!stroke.length) return;
    if (stroke.length === 1) {
      context.beginPath();
      context.arc(
        stroke[0].x * width,
        stroke[0].y * height,
        context.lineWidth / 2,
        0,
        Math.PI * 2,
      );
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(stroke[0].x * width, stroke[0].y * height);
    stroke.slice(1).forEach((point) => {
      context.lineTo(point.x * width, point.y * height);
    });
    context.stroke();
  });
}

export function signatureAlphaBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): SignaturePixelBounds | null {
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }
  return maximumX < minimumX
    ? null
    : {
        x: minimumX,
        y: minimumY,
        width: maximumX - minimumX + 1,
        height: maximumY - minimumY + 1,
      };
}

export function paddedSignatureBounds(
  bounds: SignaturePixelBounds,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): SignaturePixelBounds {
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(
    canvasWidth,
    bounds.x + bounds.width + padding,
  );
  const bottom = Math.min(
    canvasHeight,
    bounds.y + bounds.height + padding,
  );
  return { x, y, width: right - x, height: bottom - y };
}

export function signatureCanvasPngDataUrl(
  canvas: HTMLCanvasElement,
  pixelRatio: number,
) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Signature capture is not available.");
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const inkBounds = signatureAlphaBounds(
    image.data,
    canvas.width,
    canvas.height,
  );
  if (!inkBounds) throw new Error("Draw your signature before signing.");
  const bounds = paddedSignatureBounds(
    inkBounds,
    canvas.width,
    canvas.height,
    Math.max(12, Math.round(16 * pixelRatio)),
  );
  const cropped = canvas.ownerDocument.createElement("canvas");
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) throw new Error("Signature capture is not available.");
  croppedContext.fillStyle = "#ffffff";
  croppedContext.fillRect(0, 0, cropped.width, cropped.height);
  croppedContext.drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );
  return cropped.toDataURL("image/png");
}
