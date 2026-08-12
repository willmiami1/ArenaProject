export interface ContestantWaiverStatus {
  contestantId: string;
  signedAt: string;
  eventId: string;
}

export interface ContestantWaiverStatusesResponse {
  waiverVersion: string;
  statuses: ContestantWaiverStatus[];
}

export type ContestantWaiverStatusesState =
  | { phase: "loading" }
  | {
      phase: "ready";
      waiverVersion: string;
      byContestantId: ReadonlyMap<string, ContestantWaiverStatus>;
    }
  | { phase: "error"; message: string };

export type ContestantWaiverStatusPresentation =
  | { kind: "loading"; label: "Loading…" }
  | { kind: "unavailable"; label: "Unavailable"; message: string }
  | { kind: "not-signed"; label: "Not signed" }
  | {
      kind: "signed";
      label: "Signed";
      signedAt: string;
      dateLabel: string;
      fullDateLabel: string;
    };

const requiredText = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Wix returned an invalid waiver ${field}.`);
  }
  return value.trim();
};

export function normalizeContestantWaiverStatusesResponse(
  value: unknown,
): ContestantWaiverStatusesResponse {
  if (!value || typeof value !== "object") {
    throw new Error("Wix returned an invalid waiver status response.");
  }
  const response = value as {
    waiverVersion?: unknown;
    statuses?: unknown;
  };
  const waiverVersion = requiredText(response.waiverVersion, "version");
  if (!Array.isArray(response.statuses)) {
    throw new Error("Wix returned an invalid waiver status list.");
  }
  const statuses = response.statuses.map((value, index) => {
    if (!value || typeof value !== "object") {
      throw new Error(`Wix returned an invalid waiver status at row ${index + 1}.`);
    }
    const record = value as {
      contestantId?: unknown;
      signedAt?: unknown;
      eventId?: unknown;
    };
    const signedAt = requiredText(record.signedAt, "signed timestamp");
    if (!Number.isFinite(Date.parse(signedAt))) {
      throw new Error(`Wix returned an invalid waiver status at row ${index + 1}.`);
    }
    return {
      contestantId: requiredText(record.contestantId, "contestant ID"),
      signedAt,
      eventId: requiredText(record.eventId, "event ID"),
    };
  });
  return { waiverVersion, statuses };
}

export function readyContestantWaiverStatuses(
  response: ContestantWaiverStatusesResponse,
  contestantIds: Iterable<string>,
): ContestantWaiverStatusesState {
  const knownContestantIds = new Set(contestantIds);
  const byContestantId = new Map<string, ContestantWaiverStatus>();
  for (const status of response.statuses) {
    if (!knownContestantIds.has(status.contestantId)) continue;
    const prior = byContestantId.get(status.contestantId);
    if (
      !prior ||
      Date.parse(status.signedAt) > Date.parse(prior.signedAt)
    ) {
      byContestantId.set(status.contestantId, status);
    }
  }
  return {
    phase: "ready",
    waiverVersion: response.waiverVersion,
    byContestantId,
  };
}

export function contestantWaiverStatusPresentation(
  state: ContestantWaiverStatusesState,
  contestantId: string,
  locales?: string | string[],
): ContestantWaiverStatusPresentation {
  if (state.phase === "loading") {
    return { kind: "loading", label: "Loading…" };
  }
  if (state.phase === "error") {
    return {
      kind: "unavailable",
      label: "Unavailable",
      message: state.message,
    };
  }
  const status = state.byContestantId.get(contestantId);
  if (!status) {
    return { kind: "not-signed", label: "Not signed" };
  }
  const signedAt = new Date(status.signedAt);
  return {
    kind: "signed",
    label: "Signed",
    signedAt: status.signedAt,
    dateLabel: new Intl.DateTimeFormat(locales, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(signedAt),
    fullDateLabel: new Intl.DateTimeFormat(locales, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(signedAt),
  };
}
