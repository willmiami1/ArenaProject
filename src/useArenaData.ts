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
import type { ArenaData, ArenaMeet } from "./types";
import {
  isWixEmbed,
  publishPublicSchedule,
  requestWixData,
} from "./wixBridge";

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

export function useArenaData() {
  const [data, setData] = useState<ArenaData>(loadLocalData);
  const [status, setStatus] = useState<PersistenceStatus>("loading");
  const [ready, setReady] = useState(false);
  const [wixConnected, setWixConnected] = useState(false);
  const skipNextSave = useRef(false);
  const preserveDirtyOnSkippedSave = useRef(false);
  const localDirty = useRef(false);
  const saveInFlight = useRef(false);
  const conflictRetryCount = useRef(0);
  const automaticRetryCount = useRef(0);
  const lastFailedSnapshot = useRef("");
  const saveRetryTimer = useRef(0);
  const dataRef = useRef(data);
  const persistedDataRef = useRef(data);
  const statusRef = useRef(status);
  dataRef.current = data;
  statusRef.current = status;
  const refreshFromWix = useCallback(async () => {
    if (!isWixEmbed()) {
      throw new Error("Open Arena Command from the published Wix site to refresh live data.");
    }
    const writePending = () =>
      localDirty.current ||
      saveInFlight.current ||
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
    const stateAtStart = dataRef.current;
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
      (localDirty.current && statusRef.current !== "error")
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
      const normalized = mergeSavedArenaData(submitted, saved);
      persistedDataRef.current = normalizeData(saved);
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
      setStatus("saved");
      return normalized;
    } catch (error) {
      if (workspaceRevisionConflict(error)) {
        if (conflictRetryCount.current >= 3) {
          setStatus("error");
          throw new Error(
            "Workspace kept changing on another computer. Your changes remain on this device; wait for the other computer to finish, then try again.",
          );
        }
        try {
          const latest = await requestWixData("load");
          if (latest) {
            const latestNormalized = normalizeData(latest);
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
        } catch (rebaseError) {
          if (
            rebaseError instanceof Error &&
            rebaseError.message.includes("preserved and are retrying")
          ) {
            throw rebaseError;
          }
          console.error("Could not rebase the immediate workspace save.", rebaseError);
        }
      }
      if (dataRef.current === submitted) {
        skipNextSave.current = true;
        preserveDirtyOnSkippedSave.current = false;
        localDirty.current = false;
        dataRef.current = stateAtStart;
        setData(stateAtStart);
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stateAtStart));
      } else {
        localDirty.current = true;
        setData((current) => ({ ...current }));
      }
      setStatus("error");
      throw error;
    } finally {
      saveInFlight.current = false;
    }
  }, []);

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
      if (preserveDirtyOnSkippedSave.current) {
        preserveDirtyOnSkippedSave.current = false;
      } else {
        localDirty.current = false;
      }
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
    const timeout = window.setTimeout(async () => {
      if (saveInFlight.current) return;
      saveInFlight.current = true;
      const submitted = data;
      try {
        const saved = await requestWixData("save", submitted);
        if (!saved) throw new Error("Wix did not confirm the workspace save.");
        if (saved) {
          persistedDataRef.current = normalizeData(saved);
          conflictRetryCount.current = 0;
          automaticRetryCount.current = 0;
          lastFailedSnapshot.current = "";
        }
        if (saved && saved.revision !== submitted.revision) {
          setData((current) => {
            if (current !== submitted) {
              return mergeConcurrentSavedArenaData(submitted, current, saved);
            }
            skipNextSave.current = true;
            return mergeSavedArenaData(submitted, saved);
          });
        }
        setStatus("saved");
        window.clearTimeout(saveRetryTimer.current);
        if (dataRef.current === submitted) localDirty.current = false;
      } catch (error) {
        console.error("Could not save arena data to Wix.", error);
        let rebased = false;
        let conflictExhausted = false;
        if (workspaceRevisionConflict(error)) {
          if (conflictRetryCount.current >= 3) {
            conflictExhausted = true;
          } else {
            try {
              const latest = await requestWixData("load");
              if (latest) {
                const latestNormalized = normalizeData(latest);
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
            } catch (rebaseError) {
              console.error("Could not rebase the workspace save.", rebaseError);
            }
          }
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
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [data, ready, wixConnected]);

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
      try {
        const saved = await requestWixData("load");
        if (
          cancelled ||
          !saved ||
          localWriteIsPending()
        ) {
          return;
        }
        const normalized = normalizeData(saved);
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

  return [data, setData, status, refreshFromWix, saveImmediately] as const;
}
