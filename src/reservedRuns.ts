import type { ReservedSpot } from "./types";

// Riders reserve 2–12 runs per side (or none on a side they don't rope).
export const RESERVED_RUN_MIN = 2;
export const RESERVED_RUN_MAX = 12;
export const RESERVED_RUN_CHOICES = Array.from(
  { length: RESERVED_RUN_MAX - RESERVED_RUN_MIN + 1 },
  (_, index) => RESERVED_RUN_MIN + index,
);

export const normalizeReservedRuns = (value: unknown) => {
  const runs = Math.round(Number(value));
  if (!Number.isFinite(runs) || runs <= 0) return 0;
  return Math.min(RESERVED_RUN_MAX, Math.max(RESERVED_RUN_MIN, runs));
};

export const reservedPositionForRuns = (
  headerRuns: number,
  heelerRuns: number,
): ReservedSpot["position"] | null => {
  if (headerRuns > 0 && heelerRuns > 0) return "Both";
  if (headerRuns > 0) return "Header";
  if (heelerRuns > 0) return "Heeler";
  return null;
};

// Older reservations only carry a position; treat them as the minimum runs.
export const reservedHeaderRuns = (
  spot: Pick<ReservedSpot, "position" | "headerRuns">,
) =>
  spot.headerRuns !== undefined
    ? normalizeReservedRuns(spot.headerRuns)
    : spot.position !== "Heeler"
      ? RESERVED_RUN_MIN
      : 0;

export const reservedHeelerRuns = (
  spot: Pick<ReservedSpot, "position" | "heelerRuns">,
) =>
  spot.heelerRuns !== undefined
    ? normalizeReservedRuns(spot.heelerRuns)
    : spot.position !== "Header"
      ? RESERVED_RUN_MIN
      : 0;

export const reservedRunTotals = (spots: ReservedSpot[]) =>
  spots.reduce(
    (totals, spot) => ({
      headerRuns: totals.headerRuns + reservedHeaderRuns(spot),
      heelerRuns: totals.heelerRuns + reservedHeelerRuns(spot),
    }),
    { headerRuns: 0, heelerRuns: 0 },
  );
