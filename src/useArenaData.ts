import { useCallback, useEffect, useRef, useState } from "react";
import { seedData } from "./data";
import {
  assignOriginalTeamNumbers,
  defaultCompetitionSettings,
  reconcilePickDrawRegistrations,
  reconcileQualifiedAdvancements,
  resetInheritedPredictionCutoffs,
} from "./competition";
import { normalizeHorseNames } from "./contestantHorses";
import type {
  ArenaData,
  ArenaEvent,
  ArenaMeet,
  Contestant,
  EventRegistration,
} from "./types";
import {
  isWixEmbed,
  isWorkspaceSaveConfirmation,
  publishPublicSchedule,
  requestWixData,
  saveContestant,
  saveEvent,
  saveRegistration,
  setActiveRun,
  type ContestantSaveConfirmation,
  type RegistrationSaveConfirmation,
  type WorkspaceSaveConfirmation,
} from "./wixBridge";
import {
  activeRunConfirmationIsCurrent,
  ActiveRunSaveError,
  LatestActiveRunSaveQueue,
  reconcileActiveRunConfirmation,
  type ActiveRunConfirmation,
  type ActiveRunSelection,
} from "./activeRunSaveQueue";
import {
  applyEventLocally,
  EventSaveFailureTracker,
  EventSaveQueue,
  eventSaveHasPendingChanges,
  eventSaveHasUnrelatedChanges,
  eventSubmissionIsNoOp,
  preserveEventActiveSelection,
  reconcileEventSaveConfirmation,
  type EventSaveConfirmation,
} from "./eventSaveQueue";

const STORAGE_KEY = "arena-command-data-v1";
const PARTICIPANT_DATABASE_VERSION = 4;
const WORKSPACE_REFRESH_MS = 3000;
const LEGACY_SAMPLE_MEETS = new Set([
  "Summer Buckle Series",
  "Friday Night Jackpot",
]);

export type PersistenceStatus =
  | "loading"
  | "saving"
  | "saved"
  | "local"
  | "error";

export function normalizeData(parsed: ArenaData): ArenaData {
  const applyHandicapDefaults =
    (parsed.participantDatabaseVersion ?? 0) < PARTICIPANT_DATABASE_VERSION;
  const meets: ArenaMeet[] = (
    parsed.meets ??
    parsed.events.map((event) => ({
      id: `meet-${event.id}`,
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      location: event.location,
    }))
  ).map((meet) => ({
    ...meet,
    producer: meet.producer ?? "",
  }));
  const events = parsed.events.map((event) => {
    const legacyEvent = event as typeof event & {
      producerFee?: number;
      handicapCategory?: string;
      incentiveAddedMoney?: number;
      incentivePayoutPercentages?: number[];
    };
    return {
      ...defaultCompetitionSettings,
      ...event,
      pickDrawRole: "both" as const,
      description: event.description ?? "",
      parentEventId: event.parentEventId ?? `meet-${event.id}`,
      allowRepeatPartners: event.allowRepeatPartners ?? false,
      producerFeePercent:
        event.producerFeePercent ?? legacyEvent.producerFee ?? 0,
      handicapTotal: applyHandicapDefaults
        ? 20
        : event.handicapTotal ??
          (Number(legacyEvent.handicapCategory) || 20),
      maxContestantHandicap: applyHandicapDefaults
        ? 10
        : event.maxContestantHandicap ?? 10,
      minDrawsAllowed: event.minDrawsAllowed ?? 0,
      maxHeaders:
        Number.isInteger(event.maxHeaders) && Number(event.maxHeaders) > 0
          ? Number(event.maxHeaders)
          : undefined,
      maxHeelers:
        Number.isInteger(event.maxHeelers) && Number(event.maxHeelers) > 0
          ? Number(event.maxHeelers)
          : undefined,
      slideNumber: event.slideNumber ?? 10,
      shortGoTeams: event.shortGoTeams ?? 0,
      incentiveHandicapTotal: event.incentiveHandicapTotal ?? 7,
      incentiveTeams:
        event.incentiveTeams ??
        Math.max(1, legacyEvent.incentivePayoutPercentages?.length ?? 1),
      incentiveAmountPerTeam:
        event.incentiveAmountPerTeam ?? legacyEvent.incentiveAddedMoney ?? 0,
      drawHistory: event.drawHistory ?? [],
      drawApproved:
        event.drawApproved ?? Boolean(event.drawHistory?.length),
    };
  });
  const teams = (parsed.teams ?? []).map((team) => ({
    ...team,
    round: team.round ?? 1,
    checkedIn: team.checkedIn ?? false,
    scratched: team.scratched ?? false,
    generated: team.generated ?? false,
    points: team.points ?? 0,
    headerFreeRun: team.headerFreeRun ?? false,
    heelerFreeRun: team.heelerFreeRun ?? false,
    paid: team.paid ?? true,
  }));

  const registrations = (parsed.registrations ?? []).map(
    (registration) => ({
      ...registration,
      paid: registration.paid ?? true,
    }),
  );
  const contestants = (parsed.contestants ?? []).map((contestant) => ({
    ...contestant,
    role:
      (contestant.role as string) === "Either" ? "Both" : contestant.role,
    headerHandicap:
      Number.isFinite(Number(contestant.headerHandicap)) &&
      Number(contestant.headerHandicap) > 0
        ? Number(contestant.headerHandicap)
        : 3,
    heelerHandicap:
      Number.isFinite(Number(contestant.heelerHandicap)) &&
      Number(contestant.heelerHandicap) > 0
        ? Number(contestant.heelerHandicap)
        : 3,
    photo: contestant.photo ?? "",
    horses: normalizeHorseNames(contestant.horses).slice(0, 20),
  }));

  return {
    ...parsed,
    revision: parsed.revision ?? 0,
    participantDatabaseVersion: PARTICIPANT_DATABASE_VERSION,
    meets,
    events,
    contestants,
    teams: reconcileQualifiedAdvancements(
      assignOriginalTeamNumbers(resetInheritedPredictionCutoffs(teams)),
      events,
      contestants,
    ),
    registrations: reconcilePickDrawRegistrations(
      registrations,
      teams,
      events,
    ),
    spectators: parsed.spectators ?? [],
    spectatorPredictions: parsed.spectatorPredictions ?? [],
  };
}

function loadLocalData(): ArenaData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return seedData;

    const parsed = JSON.parse(saved) as ArenaData;
    const hasLegacySampleEvents =
      parsed.meets?.length === LEGACY_SAMPLE_MEETS.size &&
      parsed.meets.every((meet) => LEGACY_SAMPLE_MEETS.has(meet.name));

    if (hasLegacySampleEvents) {
      return normalizeData({
        ...seedData,
        participantDatabaseVersion: parsed.participantDatabaseVersion ?? 1,
        contestants: parsed.contestants ?? seedData.contestants,
      });
    }

    return normalizeData(parsed);
  } catch (error) {
    console.error("Could not load local arena data.", error);
    return seedData;
  }
}

export function mergeSavedArenaData(submitted: ArenaData, saved: ArenaData) {
  const appendMissingOnlineRecords = <T extends { id: string; source?: string }>(
    incoming: T[],
    persisted: T[],
  ) => {
    const incomingIds = new Set(incoming.map((record) => record.id));
    return [
      ...incoming,
      ...persisted.filter(
        (record) => record.source === "online" && !incomingIds.has(record.id),
      ),
    ];
  };
  return normalizeData({
    ...submitted,
    revision: saved.revision,
    staffRevision: saved.staffRevision,
    onlineRevision: saved.onlineRevision,
    loadedAt: saved.loadedAt,
    contestants: appendMissingOnlineRecords(
      submitted.contestants,
      saved.contestants,
    ),
    teams: appendMissingOnlineRecords(submitted.teams, saved.teams),
    registrations: appendMissingOnlineRecords(
      submitted.registrations,
      saved.registrations,
    ),
    spectators: saved.spectators,
    spectatorPredictions: saved.spectatorPredictions,
  });
}

export function mergeConcurrentSavedArenaData(
  submitted: ArenaData,
  current: ArenaData,
  saved: ArenaData,
) {
  const mergeRecords = <T extends { id: string }>(
    submittedRecords: T[],
    currentRecords: T[],
    savedRecords: T[],
  ) => {
    const equal = (left: unknown, right: unknown) =>
      JSON.stringify(left) === JSON.stringify(right);
    const mergeValue = (
      baseline: unknown,
      local: unknown,
      remote: unknown,
    ): unknown => {
      if (equal(local, baseline)) return remote;
      if (equal(remote, baseline) || equal(local, remote)) return local;
      if (
        baseline &&
        local &&
        remote &&
        typeof baseline === "object" &&
        typeof local === "object" &&
        typeof remote === "object" &&
        !Array.isArray(baseline) &&
        !Array.isArray(local) &&
        !Array.isArray(remote)
      ) {
        const baselineObject = baseline as Record<string, unknown>;
        const localObject = local as Record<string, unknown>;
        const remoteObject = remote as Record<string, unknown>;
        const keys = new Set([
          ...Object.keys(baselineObject),
          ...Object.keys(localObject),
          ...Object.keys(remoteObject),
        ]);
        return Object.fromEntries(
          [...keys].map((key) => [
            key,
            mergeValue(
              baselineObject[key],
              localObject[key],
              remoteObject[key],
            ),
          ]),
        );
      }
      return local;
    };
    const submittedById = new Map(
      submittedRecords.map((record) => [record.id, record]),
    );
    const currentById = new Map(
      currentRecords.map((record) => [record.id, record]),
    );
    const savedById = new Map(savedRecords.map((record) => [record.id, record]));
    const ids = new Set([
      ...submittedById.keys(),
      ...currentById.keys(),
      ...savedById.keys(),
    ]);
    return [...ids].flatMap((id) => {
      const baseline = submittedById.get(id);
      const local = currentById.get(id);
      const remote = savedById.get(id);
      if (!baseline) return local ? [local] : remote ? [remote] : [];
      if (!local) return [];
      if (!remote) {
        return equal(local, baseline) ? [] : [local];
      }
      return [mergeValue(baseline, local, remote) as T];
    });
  };
  const mergeScalar = <T>(baseline: T, local: T, remote: T) =>
    JSON.stringify(local) === JSON.stringify(baseline) ? remote : local;
  return normalizeData({
    ...current,
    revision: saved.revision,
    staffRevision: saved.staffRevision,
    onlineRevision: saved.onlineRevision,
    loadedAt: saved.loadedAt,
    activeEventId: mergeScalar(
      submitted.activeEventId,
      current.activeEventId,
      saved.activeEventId,
    ),
    meets: mergeRecords(submitted.meets, current.meets, saved.meets),
    events: mergeRecords(submitted.events, current.events, saved.events),
    contestants: mergeRecords(
      submitted.contestants,
      current.contestants,
      saved.contestants,
    ),
    teams: mergeRecords(
      submitted.teams,
      current.teams,
      saved.teams,
    ),
    registrations: mergeRecords(
      submitted.registrations,
      current.registrations,
      saved.registrations,
    ),
    spectators: saved.spectators,
    spectatorPredictions: saved.spectatorPredictions,
  });
}

const workspaceRevisionConflict = (error: unknown) =>
  error instanceof Error &&
  error.message.includes("changed in another staff session");

export function staffWorkspaceIsNewer(
  current: Pick<ArenaData, "revision" | "staffRevision">,
  remote: Pick<ArenaData, "revision" | "staffRevision">,
) {
  return (
    Number(remote.staffRevision ?? remote.revision ?? 0) >
    Number(current.staffRevision ?? current.revision ?? 0)
  );
}

export function remoteWorkspaceIsNewer(
  current: Pick<ArenaData, "revision" | "staffRevision" | "onlineRevision">,
  remote: Pick<ArenaData, "revision" | "staffRevision" | "onlineRevision">,
) {
  const revision = (
    data: Pick<ArenaData, "revision" | "staffRevision" | "onlineRevision">,
  ) =>
    Number(
      data.revision ??
        Number(data.staffRevision || 0) + Number(data.onlineRevision || 0),
    );
  return revision(remote) > revision(current);
}

export function workspaceSaveNeedsFollowUp(
  submitted: ArenaData,
  current: ArenaData,
  localDirty: boolean,
) {
  return localDirty && current !== submitted;
}

export function shouldRearmWorkspaceSaveAfterBusySave(
  localDirty: boolean,
  hasEventSaveFailures: boolean,
) {
  return localDirty && !hasEventSaveFailures;
}

export function reconcileWorkspaceSaveConfirmation(
  submitted: ArenaData,
  confirmation: WorkspaceSaveConfirmation,
) {
  return {
    ...submitted,
    revision: confirmation.revision,
    staffRevision: confirmation.staffRevision,
    onlineRevision: confirmation.onlineRevision,
    loadedAt: confirmation.loadedAt,
  };
}

export function reconcileContestantSaveConfirmation(
  data: ArenaData,
  confirmation: ContestantSaveConfirmation,
) {
  const exists = data.contestants.some(
    (contestant) => contestant.id === confirmation.contestant.id,
  );
  return {
    ...data,
    revision: confirmation.revision,
    staffRevision: confirmation.staffRevision,
    onlineRevision: confirmation.onlineRevision,
    loadedAt: confirmation.loadedAt,
    contestants: exists
      ? data.contestants.map((contestant) =>
          contestant.id === confirmation.contestant.id
            ? confirmation.contestant
            : contestant,
        )
      : [...data.contestants, confirmation.contestant],
  };
}

export function contestantSaveHasUnrelatedChanges(
  current: ArenaData,
  persisted: ArenaData,
  contestantId: string,
) {
  const comparable = (data: ArenaData) => {
    const {
      revision: _revision,
      staffRevision: _staffRevision,
      onlineRevision: _onlineRevision,
      loadedAt: _loadedAt,
      ...content
    } = data;
    return {
      ...content,
      contestants: content.contestants.filter(
        (contestant) => contestant.id !== contestantId,
      ),
    };
  };
  return (
    JSON.stringify(comparable(current)) !==
    JSON.stringify(comparable(persisted))
  );
}

export function reconcileRegistrationSaveConfirmation(
  data: ArenaData,
  confirmation: RegistrationSaveConfirmation,
) {
  const exists = data.registrations.some(
    (registration) => registration.id === confirmation.registration.id,
  );
  return {
    ...data,
    revision: confirmation.revision,
    staffRevision: confirmation.staffRevision,
    onlineRevision: confirmation.onlineRevision,
    loadedAt: confirmation.loadedAt,
    registrations: exists
      ? data.registrations.map((registration) =>
          registration.id === confirmation.registration.id
            ? confirmation.registration
            : registration,
        )
      : [...data.registrations, confirmation.registration],
  };
}

export function registrationSaveHasUnrelatedChanges(
  current: ArenaData,
  persisted: ArenaData,
  registrationId: string,
) {
  const comparable = (data: ArenaData) => {
    const {
      revision: _revision,
      staffRevision: _staffRevision,
      onlineRevision: _onlineRevision,
      loadedAt: _loadedAt,
      ...content
    } = data;
    return {
      ...content,
      registrations: content.registrations.filter(
        (registration) => registration.id !== registrationId,
      ),
    };
  };
  return (
    JSON.stringify(comparable(current)) !==
    JSON.stringify(comparable(persisted))
  );
}

export function shouldSkipDirectMutationReconciliationSave(
  data: ArenaData,
  reconciliationSnapshot: string,
) {
  return (
    reconciliationSnapshot !== "" &&
    JSON.stringify(data) === reconciliationSnapshot
  );
}

export function useArenaData() {
  const [data, setData] = useState<ArenaData>(loadLocalData);
  const [status, setStatus] = useState<PersistenceStatus>("loading");
  const [lastSaveError, setLastSaveError] = useState("");
  const [ready, setReady] = useState(false);
  const [wixConnected, setWixConnected] = useState(false);
  const skipNextSave = useRef(false);
  const directMutationReconciliationSnapshot = useRef("");
  const preserveDirtyOnSkippedSave = useRef(false);
  const localDirty = useRef(false);
  const saveInFlight = useRef(false);
  const activeRunSaveInFlight = useRef(false);
  const contestantSaveInFlight = useRef(false);
  const contestantSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const eventSaveInFlight = useRef(false);
  const eventSaveQueue = useRef<EventSaveQueue<EventSaveConfirmation> | null>(null);
  const eventSaveFailures = useRef(new EventSaveFailureTracker());
  const eventWorkspaceFollowUpNeeded = useRef(false);
  const registrationSaveInFlight = useRef(false);
  const registrationSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveIdleWaiters = useRef<Array<() => void>>([]);
  const conflictRetryCount = useRef(0);
  const automaticRetryCount = useRef(0);
  const lastFailedSnapshot = useRef("");
  const pendingAuthoritativeRefreshRevision = useRef<number | null>(null);
  const saveRetryTimer = useRef(0);
  const workspaceSaveTimer = useRef(0);
  const activeRunSaveQueue =
    useRef<LatestActiveRunSaveQueue<ActiveRunConfirmation> | null>(null);
  const dataRef = useRef(data);
  const persistedDataRef = useRef(data);
  const statusRef = useRef(status);
  dataRef.current = data;
  statusRef.current = status;
  const releaseSaveIdleWaiters = () => {
    const waiters = saveIdleWaiters.current.splice(0);
    waiters.forEach((resolve) => resolve());
  };
  const retryWorkspaceSave = useCallback(() => {
    if (
      !localDirty.current ||
      saveInFlight.current ||
      activeRunSaveInFlight.current ||
      contestantSaveInFlight.current ||
      eventSaveInFlight.current ||
      eventSaveFailures.current.hasFailures ||
      registrationSaveInFlight.current
    ) {
      return;
    }
    automaticRetryCount.current = 0;
    conflictRetryCount.current = 0;
    lastFailedSnapshot.current = "";
    setLastSaveError("");
    setStatus("saving");
    setData((current) => ({ ...current }));
  }, []);
  const refreshFromWix = useCallback(async () => {
    if (!isWixEmbed()) {
      throw new Error("Open Arena Command from the published Wix site to refresh live data.");
    }
    const writePending = () =>
      localDirty.current ||
      saveInFlight.current ||
      activeRunSaveInFlight.current ||
      contestantSaveInFlight.current ||
      eventSaveInFlight.current ||
      registrationSaveInFlight.current ||
      statusRef.current === "saving";
    if (writePending()) {
      throw new Error("Wait for the current workspace changes to finish saving before refreshing.");
    }
    setStatus("loading");
    try {
      const saved = await requestWixData("load");
      if (!saved) throw new Error("No Arena Command workspace was found in Wix.");
      if (writePending()) {
        throw new Error("New workspace changes are still saving. Refresh again when saving is complete.");
      }
      const normalized = normalizeData(saved);
      if (remoteWorkspaceIsNewer(normalized, dataRef.current)) {
        setStatus("saved");
        return dataRef.current;
      }
      skipNextSave.current = true;
      localDirty.current = false;
      persistedDataRef.current = normalized;
      dataRef.current = normalized;
      setData(normalized);
      setWixConnected(true);
      setStatus("saved");
      window.clearTimeout(saveRetryTimer.current);
      return normalized;
    } catch (error) {
      if (!writePending()) {
        setStatus("error");
      }
      throw error;
    }
  }, []);
  const saveImmediately = useCallback(async (submitted: ArenaData) => {
    if (eventSaveFailures.current.hasFailures) {
      throw new Error(
        "Resolve the failed Event save before saving the full workspace.",
      );
    }
    if (!isWixEmbed()) {
      const normalized = normalizeData(submitted);
      skipNextSave.current = true;
      setData(normalized);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      setStatus("local");
      localDirty.current = false;
      return normalized;
    }
    if (
      saveInFlight.current ||
      activeRunSaveInFlight.current ||
      contestantSaveInFlight.current ||
      eventSaveInFlight.current ||
      registrationSaveInFlight.current
    ) {
      throw new Error("Wait for the current workspace save to finish, then try again.");
    }
    if (statusRef.current === "error") {
      conflictRetryCount.current = 0;
      automaticRetryCount.current = 0;
    }
    localDirty.current = true;
    skipNextSave.current = true;
    preserveDirtyOnSkippedSave.current = true;
    dataRef.current = submitted;
    setData(submitted);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submitted));
    setStatus("saving");
    saveInFlight.current = true;
    try {
      const saved = await requestWixData("save", submitted);
      if (!saved) throw new Error("Wix did not confirm the workspace save.");
      const compactConfirmation = isWorkspaceSaveConfirmation(saved);
      const normalized = compactConfirmation
        ? reconcileWorkspaceSaveConfirmation(submitted, saved)
        : mergeSavedArenaData(submitted, saved);
      persistedDataRef.current = compactConfirmation
        ? normalized
        : normalizeData(saved);
      pendingAuthoritativeRefreshRevision.current = compactConfirmation
        ? saved.revision
        : null;
      conflictRetryCount.current = 0;
      automaticRetryCount.current = 0;
      if (dataRef.current === submitted) {
        skipNextSave.current = true;
        localDirty.current = false;
        dataRef.current = normalized;
        setData(normalized);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      } else {
        const current = mergeConcurrentSavedArenaData(
          submitted,
          dataRef.current,
          normalized,
        );
        dataRef.current = current;
        setData(current);
      }
      setWixConnected(true);
      setLastSaveError("");
      setStatus("saved");
      return normalized;
    } catch (error) {
      setLastSaveError(
        error instanceof Error ? error.message : String(error),
      );
      try {
        const latest = await requestWixData("load");
        if (latest) {
          const latestNormalized = normalizeData(latest);
          if (
            workspaceRevisionConflict(error) ||
            staffWorkspaceIsNewer(
              persistedDataRef.current,
              latestNormalized,
            )
          ) {
            if (conflictRetryCount.current >= 3) {
              setStatus("error");
              throw new Error(
                "Workspace kept changing on another computer. Your changes remain on this device; wait for the other computer to finish, then try again.",
              );
            }
            const rebased = mergeConcurrentSavedArenaData(
              persistedDataRef.current,
              dataRef.current,
              latestNormalized,
            );
            persistedDataRef.current = latestNormalized;
            conflictRetryCount.current += 1;
            dataRef.current = rebased;
            localDirty.current = true;
            setData(rebased);
            setStatus("saving");
            throw new Error(
              "Workspace changed on another computer. Your changes were preserved and are retrying.",
            );
          }
        }
      } catch (rebaseError) {
        if (
          rebaseError instanceof Error &&
          (rebaseError.message.includes("preserved and are retrying") ||
            rebaseError.message.includes("kept changing on another computer"))
        ) {
          throw rebaseError;
        }
        console.error("Could not rebase the immediate workspace save.", rebaseError);
      }
      if (dataRef.current === submitted) {
        localDirty.current = true;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submitted));
      } else {
        localDirty.current = true;
        setData((current) => ({ ...current }));
      }
      setStatus("error");
      throw error;
    } finally {
      saveInFlight.current = false;
      releaseSaveIdleWaiters();
      if (
        workspaceSaveNeedsFollowUp(
          submitted,
          dataRef.current,
          localDirty.current,
        )
      ) {
        setStatus("saving");
        setData((current) => ({ ...current }));
      }
    }
  }, []);

  const saveContestantImmediately = useCallback(
    (contestant: Contestant) => {
      const operation = contestantSaveQueue.current.then(async () => {
        while (
          saveInFlight.current ||
          activeRunSaveInFlight.current ||
          eventSaveInFlight.current ||
          registrationSaveInFlight.current
        ) {
          await new Promise<void>((resolve) => {
            saveIdleWaiters.current.push(resolve);
          });
        }
        contestantSaveInFlight.current = true;
        try {
          window.clearTimeout(saveRetryTimer.current);
          saveRetryTimer.current = 0;
          if (
            localDirty.current &&
            !contestantSaveHasUnrelatedChanges(
              dataRef.current,
              persistedDataRef.current,
              contestant.id,
            )
          ) {
            localDirty.current = false;
            automaticRetryCount.current = 0;
            conflictRetryCount.current = 0;
            lastFailedSnapshot.current = "";
          }
          const confirmation = await saveContestant(contestant);
          const currentWasDirty =
            localDirty.current &&
            contestantSaveHasUnrelatedChanges(
              dataRef.current,
              persistedDataRef.current,
              confirmation.contestant.id,
            );
          const reconciled = reconcileContestantSaveConfirmation(
            dataRef.current,
            confirmation,
          );
          persistedDataRef.current = reconcileContestantSaveConfirmation(
            persistedDataRef.current,
            confirmation,
          );
          skipNextSave.current = !currentWasDirty;
          directMutationReconciliationSnapshot.current = currentWasDirty
            ? ""
            : JSON.stringify(reconciled);
          preserveDirtyOnSkippedSave.current = false;
          localDirty.current = currentWasDirty;
          dataRef.current = reconciled;
          setData(reconciled);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
          if (!eventSaveFailures.current.hasFailures) {
            setLastSaveError("");
          }
          automaticRetryCount.current = 0;
          conflictRetryCount.current = 0;
          lastFailedSnapshot.current = "";
          setStatus(currentWasDirty ? "saving" : "saved");
          return confirmation.contestant;
        } finally {
          contestantSaveInFlight.current = false;
          releaseSaveIdleWaiters();
          if (localDirty.current) {
            setStatus("saving");
            setData((current) => ({ ...current }));
          }
        }
      });
      contestantSaveQueue.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [],
  );

  const saveEventImmediately = useCallback((event: ArenaEvent) => {
    const existing = dataRef.current.events.find((item) => item.id === event.id);
    const submittedEvent = preserveEventActiveSelection(existing, event);
    const persistedEvent = persistedDataRef.current.events.find(
      (item) => item.id === event.id,
    );
    if (eventSubmissionIsNoOp(persistedEvent, existing, submittedEvent)) {
      return Promise.resolve(existing ?? submittedEvent);
    }

    const submittedData = applyEventLocally(dataRef.current, submittedEvent);
    skipNextSave.current = true;
    preserveDirtyOnSkippedSave.current = true;
    localDirty.current = isWixEmbed();
    dataRef.current = submittedData;
    setData(submittedData);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(submittedData));

    if (!isWixEmbed()) {
      setStatus("local");
      return Promise.resolve(submittedEvent);
    }

    setStatus("saving");
    if (!eventSaveQueue.current) {
      eventSaveQueue.current = new EventSaveQueue(async (submittedEvent) => {
        let scheduleWorkspaceFollowUp = false;
        while (
          saveInFlight.current ||
          activeRunSaveInFlight.current ||
          contestantSaveInFlight.current ||
          registrationSaveInFlight.current
        ) {
          await new Promise<void>((resolve) => {
            saveIdleWaiters.current.push(resolve);
          });
        }
        eventSaveInFlight.current = true;
        try {
          window.clearTimeout(saveRetryTimer.current);
          saveRetryTimer.current = 0;
          const confirmation = await saveEvent(
            dataRef.current,
            submittedEvent,
          );
          scheduleWorkspaceFollowUp =
            localDirty.current &&
            eventSaveHasUnrelatedChanges(
              dataRef.current,
              persistedDataRef.current,
              submittedEvent,
            );
          const currentWasDirty = eventSaveHasPendingChanges(
            dataRef.current,
            persistedDataRef.current,
            submittedEvent,
          );
          const reconciled = reconcileEventSaveConfirmation(
            dataRef.current,
            submittedEvent,
            confirmation,
          );
          persistedDataRef.current = reconcileEventSaveConfirmation(
            persistedDataRef.current,
            submittedEvent,
            confirmation,
          );
          eventSaveFailures.current.recordSuccess(submittedEvent.id);
          eventWorkspaceFollowUpNeeded.current ||= scheduleWorkspaceFollowUp;
          skipNextSave.current = true;
          directMutationReconciliationSnapshot.current = JSON.stringify(reconciled);
          preserveDirtyOnSkippedSave.current = currentWasDirty;
          localDirty.current = currentWasDirty;
          dataRef.current = reconciled;
          setData(reconciled);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
          if (!eventSaveFailures.current.hasFailures) {
            setLastSaveError("");
          }
          automaticRetryCount.current = 0;
          conflictRetryCount.current = 0;
          lastFailedSnapshot.current = "";
          setStatus(
            eventSaveFailures.current.hasFailures
              ? "error"
              : currentWasDirty
                ? "saving"
                : "saved",
          );
          return confirmation;
        } catch (error) {
          eventSaveFailures.current.recordFailure(submittedEvent.id);
          localDirty.current = true;
          setLastSaveError(error instanceof Error ? error.message : String(error));
          setStatus("error");
          throw error;
        } finally {
          eventSaveInFlight.current = false;
          releaseSaveIdleWaiters();
        }
      });
    }
    const queue = eventSaveQueue.current;
    if (queue.isIdle) {
      eventWorkspaceFollowUpNeeded.current = false;
    }
    return queue.enqueue(submittedEvent).then(
      (confirmation) => {
        if (
          queue.isIdle &&
          !eventSaveFailures.current.hasFailures &&
          eventWorkspaceFollowUpNeeded.current
        ) {
          eventWorkspaceFollowUpNeeded.current = false;
          skipNextSave.current = false;
          directMutationReconciliationSnapshot.current = "";
          preserveDirtyOnSkippedSave.current = false;
          setStatus("saving");
          setData((current) => ({ ...current }));
        } else if (queue.isIdle && eventSaveFailures.current.hasFailures) {
          eventWorkspaceFollowUpNeeded.current = false;
        }
        return confirmation.event;
      },
      (error) => {
        if (queue.isIdle) {
          eventWorkspaceFollowUpNeeded.current = false;
        }
        throw error;
      },
    );
  }, []);

  const saveRegistrationImmediately = useCallback(
    (registration: EventRegistration) => {
      const operation = registrationSaveQueue.current.then(async () => {
        while (
          saveInFlight.current ||
          activeRunSaveInFlight.current ||
          contestantSaveInFlight.current ||
          eventSaveInFlight.current
        ) {
          await new Promise<void>((resolve) => {
            saveIdleWaiters.current.push(resolve);
          });
        }
        registrationSaveInFlight.current = true;
        try {
          window.clearTimeout(saveRetryTimer.current);
          saveRetryTimer.current = 0;
          if (
            localDirty.current &&
            !registrationSaveHasUnrelatedChanges(
              dataRef.current,
              persistedDataRef.current,
              registration.id,
            )
          ) {
            localDirty.current = false;
            automaticRetryCount.current = 0;
            conflictRetryCount.current = 0;
            lastFailedSnapshot.current = "";
          }
          const confirmation = await saveRegistration(registration);
          const currentWasDirty =
            localDirty.current &&
            registrationSaveHasUnrelatedChanges(
              dataRef.current,
              persistedDataRef.current,
              confirmation.registration.id,
            );
          const reconciled = reconcileRegistrationSaveConfirmation(
            dataRef.current,
            confirmation,
          );
          persistedDataRef.current = reconcileRegistrationSaveConfirmation(
            persistedDataRef.current,
            confirmation,
          );
          skipNextSave.current = !currentWasDirty;
          directMutationReconciliationSnapshot.current = currentWasDirty
            ? ""
            : JSON.stringify(reconciled);
          preserveDirtyOnSkippedSave.current = false;
          localDirty.current = currentWasDirty;
          dataRef.current = reconciled;
          setData(reconciled);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
          if (!eventSaveFailures.current.hasFailures) {
            setLastSaveError("");
          }
          automaticRetryCount.current = 0;
          conflictRetryCount.current = 0;
          lastFailedSnapshot.current = "";
          setStatus(currentWasDirty ? "saving" : "saved");
          return confirmation.registration;
        } finally {
          registrationSaveInFlight.current = false;
          releaseSaveIdleWaiters();
          if (localDirty.current) {
            setStatus("saving");
            setData((current) => ({ ...current }));
          }
        }
      });
      registrationSaveQueue.current = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    [],
  );

  const saveActiveRunImmediately = useCallback(
    (selection: ActiveRunSelection) => {
      const applyConfirmation = (confirmation: ActiveRunConfirmation) => {
        if (!activeRunConfirmationIsCurrent(dataRef.current, confirmation)) {
          return;
        }
        const currentWasDirty = localDirty.current;
        const reconciled = reconcileActiveRunConfirmation(
          dataRef.current,
          confirmation,
        );
        persistedDataRef.current = reconcileActiveRunConfirmation(
          persistedDataRef.current,
          confirmation,
        );
        skipNextSave.current = !currentWasDirty;
        preserveDirtyOnSkippedSave.current = false;
        localDirty.current = currentWasDirty;
        dataRef.current = reconciled;
        setData(reconciled);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reconciled));
        setStatus(currentWasDirty ? "saving" : "saved");
      };
      if (!activeRunSaveQueue.current) {
        activeRunSaveQueue.current = new LatestActiveRunSaveQueue(
          async (latestSelection) => {
            if (!latestSelection.activeRunId) {
              throw new Error("Select a valid team for Roping Now.");
            }
            while (
              saveInFlight.current ||
              contestantSaveInFlight.current ||
              eventSaveInFlight.current ||
              registrationSaveInFlight.current
            ) {
              await new Promise<void>((resolve) => {
                saveIdleWaiters.current.push(resolve);
              });
            }
            activeRunSaveInFlight.current = true;
            try {
              return await setActiveRun({
                eventId: latestSelection.eventId,
                teamId: latestSelection.activeRunId,
              });
            } finally {
              activeRunSaveInFlight.current = false;
              releaseSaveIdleWaiters();
              if (localDirty.current) {
                setStatus("saving");
                setData((current) => ({ ...current }));
              }
            }
          },
          applyConfirmation,
        );
      }
      return activeRunSaveQueue.current.enqueue(selection).catch((error) => {
        const confirmedEvent = dataRef.current.events.find(
          (event) => event.id === selection.eventId,
        );
        throw new ActiveRunSaveError(error, {
          eventId: selection.eventId,
          activeRunId: confirmedEvent?.activeRunId,
          activeRound: confirmedEvent?.activeRound,
        });
      });
    },
    [],
  );

  useEffect(
    () => () => window.clearTimeout(saveRetryTimer.current),
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!isWixEmbed()) {
        setStatus("local");
        setReady(true);
        return;
      }
      try {
        const saved = await requestWixData("load");
        if (cancelled) return;
        if (saved) {
          const normalized = normalizeData(saved);
          skipNextSave.current = true;
          persistedDataRef.current = normalized;
          dataRef.current = normalized;
          setData(normalized);
        } else {
          await publishPublicSchedule(data.events);
        }
        setWixConnected(true);
        setStatus(saved ? "saved" : "saving");
      } catch (error) {
        if (cancelled) return;
        console.error("Could not connect to Wix Data.", error);
        try {
          await publishPublicSchedule(data.events);
        } catch (publishError) {
          console.error("Could not publish the public event schedule.", publishError);
        }
        setStatus("error");
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if (skipNextSave.current) {
      skipNextSave.current = false;
      const directMutationSnapshot =
        directMutationReconciliationSnapshot.current;
      const shouldSkip =
        directMutationSnapshot === "" ||
        shouldSkipDirectMutationReconciliationSave(
          data,
          directMutationSnapshot,
        );
      directMutationReconciliationSnapshot.current = "";
      if (preserveDirtyOnSkippedSave.current) {
        preserveDirtyOnSkippedSave.current = false;
      } else if (shouldSkip) {
        localDirty.current = false;
      }
      if (shouldSkip) return;
    }
    if (eventSaveFailures.current.hasFailures) {
      localDirty.current = true;
      setStatus("error");
      return;
    }
    if (!wixConnected) {
      if (status !== "error") setStatus("local");
      return;
    }
    if (
      automaticRetryCount.current >= 3 &&
      JSON.stringify(data) === lastFailedSnapshot.current
    ) {
      setStatus("error");
      return;
    }
    if (JSON.stringify(data) !== lastFailedSnapshot.current) {
      automaticRetryCount.current = 0;
    }

    localDirty.current = true;
    setStatus("saving");
    window.clearTimeout(workspaceSaveTimer.current);
    workspaceSaveTimer.current = window.setTimeout(async () => {
      workspaceSaveTimer.current = 0;
      if (
        saveInFlight.current ||
        activeRunSaveInFlight.current ||
        contestantSaveInFlight.current ||
        eventSaveInFlight.current ||
        registrationSaveInFlight.current
      ) {
        if (
          shouldRearmWorkspaceSaveAfterBusySave(
            localDirty.current,
            eventSaveFailures.current.hasFailures,
          )
        ) {
          saveIdleWaiters.current.push(() => {
            if (!localDirty.current || saveInFlight.current) return;
            skipNextSave.current = false;
            directMutationReconciliationSnapshot.current = "";
            preserveDirtyOnSkippedSave.current = false;
            setStatus("saving");
            setData((current) => ({ ...current }));
          });
        }
        return;
      }
      const submitted = dataRef.current;
      if (
        eventSaveFailures.current.hasFailures ||
        (automaticRetryCount.current >= 3 &&
          JSON.stringify(submitted) === lastFailedSnapshot.current)
      ) {
        localDirty.current = true;
        setStatus("error");
        return;
      }
      saveInFlight.current = true;
      try {
        const saved = await requestWixData("save", submitted);
        if (!saved) throw new Error("Wix did not confirm the workspace save.");
        const compactConfirmation = isWorkspaceSaveConfirmation(saved);
        const confirmed = compactConfirmation
          ? reconcileWorkspaceSaveConfirmation(submitted, saved)
          : normalizeData(saved);
        persistedDataRef.current = confirmed;
        pendingAuthoritativeRefreshRevision.current = compactConfirmation
          ? saved.revision
          : null;
        conflictRetryCount.current = 0;
        automaticRetryCount.current = 0;
        lastFailedSnapshot.current = "";
        setLastSaveError("");
        if (
          compactConfirmation ||
          confirmed.revision !== submitted.revision
        ) {
          setData((current) => {
            if (current !== submitted) {
              return mergeConcurrentSavedArenaData(
                submitted,
                current,
                confirmed,
              );
            }
            skipNextSave.current = true;
            return mergeSavedArenaData(submitted, confirmed);
          });
        }
        setStatus("saved");
        window.clearTimeout(saveRetryTimer.current);
        if (dataRef.current === submitted) localDirty.current = false;
      } catch (error) {
        console.error("Could not save arena data to Wix.", error);
        const saveError =
          error instanceof Error ? error.message : String(error);
        let rebased = false;
        let conflictExhausted = false;
        try {
          const latest = await requestWixData("load");
          if (latest) {
            const latestNormalized = normalizeData(latest);
            if (
              workspaceRevisionConflict(error) ||
              staffWorkspaceIsNewer(
                persistedDataRef.current,
                latestNormalized,
              )
            ) {
              if (conflictRetryCount.current >= 3) {
                conflictExhausted = true;
              } else {
                const current = mergeConcurrentSavedArenaData(
                  persistedDataRef.current,
                  dataRef.current,
                  latestNormalized,
                );
                persistedDataRef.current = latestNormalized;
                conflictRetryCount.current += 1;
                dataRef.current = current;
                localDirty.current = true;
                setData(current);
                rebased = true;
              }
            }
          }
        } catch (rebaseError) {
          console.error("Could not inspect the latest workspace after save failure.", rebaseError);
        }
        if (rebased) {
          setLastSaveError("");
        } else if (conflictExhausted) {
          setLastSaveError(
            `${saveError} Your local changes are still preserved and can be retried when the other save finishes.`,
          );
        } else {
          setLastSaveError(saveError || "Wix persistence failed.");
        }
        setStatus(rebased ? "saving" : "error");
        if (!rebased && !conflictExhausted) {
          automaticRetryCount.current += 1;
          lastFailedSnapshot.current = JSON.stringify(dataRef.current);
          if (automaticRetryCount.current < 3) {
            window.clearTimeout(saveRetryTimer.current);
            saveRetryTimer.current = window.setTimeout(() => {
              saveRetryTimer.current = 0;
              if (localDirty.current && !saveInFlight.current) {
                setData((current) => ({ ...current }));
              }
            }, WORKSPACE_REFRESH_MS);
          }
        }
      } finally {
        saveInFlight.current = false;
        releaseSaveIdleWaiters();
        if (
          workspaceSaveNeedsFollowUp(
            submitted,
            dataRef.current,
            localDirty.current,
          )
        ) {
          setStatus("saving");
          setData((current) => ({ ...current }));
        }
      }
    }, 500);
  }, [data, ready, wixConnected]);

  useEffect(
    () => () => {
      window.clearTimeout(workspaceSaveTimer.current);
      workspaceSaveTimer.current = 0;
    },
    [],
  );

  useEffect(() => {
    const syncLocalWindow = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const nextData = normalizeData(JSON.parse(event.newValue) as ArenaData);
        setData((current) =>
          JSON.stringify(current) === event.newValue ? current : nextData,
        );
      } catch (error) {
        console.error("Could not sync arena display data.", error);
      }
    };
    window.addEventListener("storage", syncLocalWindow);
    return () => window.removeEventListener("storage", syncLocalWindow);
  }, []);

  useEffect(() => {
    if (!ready || !wixConnected || !isWixEmbed()) return;
    let cancelled = false;
    let timer = 0;
    let refreshing = false;
    const localWriteIsPending = () =>
      localDirty.current ||
      saveInFlight.current ||
      activeRunSaveInFlight.current ||
      contestantSaveInFlight.current ||
      eventSaveInFlight.current ||
      registrationSaveInFlight.current ||
      statusRef.current === "saving";

    const refreshNewerWorkspace = async () => {
      if (
        cancelled ||
        refreshing ||
        localWriteIsPending()
      ) {
        return;
      }
      refreshing = true;
      const stateAtLoadStart = dataRef.current;
      try {
        const saved = await requestWixData("load");
        if (
          cancelled ||
          !saved ||
          dataRef.current !== stateAtLoadStart ||
          localWriteIsPending()
        ) {
          return;
        }
        const normalized = normalizeData(saved);
        if (
          pendingAuthoritativeRefreshRevision.current !== null &&
          normalized.revision === pendingAuthoritativeRefreshRevision.current
        ) {
          pendingAuthoritativeRefreshRevision.current = null;
          skipNextSave.current = true;
          localDirty.current = false;
          persistedDataRef.current = normalized;
          dataRef.current = normalized;
          setData(normalized);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
          setStatus("saved");
          return;
        }
        if (
          pendingAuthoritativeRefreshRevision.current !== null &&
          Number(normalized.revision ?? 0) >
            pendingAuthoritativeRefreshRevision.current
        ) {
          pendingAuthoritativeRefreshRevision.current = null;
        }
        if (!remoteWorkspaceIsNewer(dataRef.current, normalized)) return;
        skipNextSave.current = true;
        localDirty.current = false;
        persistedDataRef.current = normalized;
        dataRef.current = normalized;
        setData(normalized);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
        setStatus("saved");
      } catch (error) {
        console.error("Could not refresh newer Arena Command data.", error);
      } finally {
        refreshing = false;
      }
    };

    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await refreshNewerWorkspace();
        if (!cancelled) scheduleRefresh();
      }, WORKSPACE_REFRESH_MS);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshNewerWorkspace();
      }
    };

    scheduleRefresh();
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [ready, wixConnected]);

  return [
    data,
    setData,
    status,
    refreshFromWix,
    saveImmediately,
    saveContestantImmediately,
    saveEventImmediately,
    saveRegistrationImmediately,
    saveActiveRunImmediately,
    lastSaveError,
    retryWorkspaceSave,
  ] as const;
}
