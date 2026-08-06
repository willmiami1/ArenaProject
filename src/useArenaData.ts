import { useEffect, useRef, useState } from "react";
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
    teams: appendMissingOnlineRecords(submitted.teams, saved.teams),
    registrations: appendMissingOnlineRecords(
      submitted.registrations,
      saved.registrations,
    ),
    spectators: saved.spectators,
    spectatorPredictions: saved.spectatorPredictions,
  });
}

export function useArenaData() {
  const [data, setData] = useState<ArenaData>(loadLocalData);
  const [status, setStatus] = useState<PersistenceStatus>("loading");
  const [ready, setReady] = useState(false);
  const [wixConnected, setWixConnected] = useState(false);
  const skipNextSave = useRef(false);

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
          skipNextSave.current = true;
          setData(normalizeData(saved));
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
      return;
    }
    if (!wixConnected) {
      if (status !== "error") setStatus("local");
      return;
    }

    setStatus("saving");
    const timeout = window.setTimeout(async () => {
      try {
        const submitted = data;
        const saved = await requestWixData("save", submitted);
        if (saved && saved.revision !== submitted.revision) {
          setData((current) => {
            if (current !== submitted) {
              return { ...current, revision: saved.revision };
            }
            skipNextSave.current = true;
            return mergeSavedArenaData(submitted, saved);
          });
        }
        setStatus("saved");
      } catch (error) {
        console.error("Could not save arena data to Wix.", error);
        setStatus("error");
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

  return [data, setData, status] as const;
}
