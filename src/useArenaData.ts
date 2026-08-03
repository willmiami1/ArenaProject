import { useEffect, useState } from "react";
import { seedData } from "./data";
import {
  defaultCompetitionSettings,
  reconcileQualifiedAdvancements,
} from "./competition";
import type { ArenaData, ArenaMeet } from "./types";
import { isWixEmbed, requestWixData } from "./wixBridge";

const STORAGE_KEY = "arena-command-data-v1";
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

function normalizeData(parsed: ArenaData): ArenaData {
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
  const events = parsed.events.map((event) => ({
    ...defaultCompetitionSettings,
    ...event,
    parentEventId: event.parentEventId ?? `meet-${event.id}`,
    producerFeePercent:
      event.producerFeePercent ??
      (event as typeof event & { producerFee?: number }).producerFee ??
      0,
    handicapTotal:
      event.handicapTotal ??
      (Number(
        (event as typeof event & { handicapCategory?: string }).handicapCategory,
      ) || 99),
  }));
  const teams = parsed.teams.map((team) => ({
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

  return {
    ...parsed,
    meets,
    events,
    contestants: parsed.contestants.map((contestant) => ({
      ...contestant,
      role: (contestant.role as string) === "Either" ? "Both" : contestant.role,
      headerHandicap: contestant.headerHandicap ?? 0,
      heelerHandicap: contestant.heelerHandicap ?? 0,
      photo: contestant.photo ?? "",
    })),
    teams: reconcileQualifiedAdvancements(teams, events),
    registrations: (parsed.registrations ?? []).map((registration) => ({
      ...registration,
      paid: registration.paid ?? true,
    })),
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
        contestants: parsed.contestants ?? seedData.contestants,
      });
    }

    return normalizeData(parsed);
  } catch (error) {
    console.error("Could not load local arena data.", error);
    return seedData;
  }
}

export function useArenaData() {
  const [data, setData] = useState<ArenaData>(loadLocalData);
  const [status, setStatus] = useState<PersistenceStatus>("loading");
  const [ready, setReady] = useState(false);
  const [wixConnected, setWixConnected] = useState(false);

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
        if (saved) setData(normalizeData(saved));
        setWixConnected(true);
        setStatus(saved ? "saved" : "saving");
      } catch (error) {
        if (cancelled) return;
        console.error("Could not connect to Wix Data.", error);
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
    if (!wixConnected) {
      if (status !== "error") setStatus("local");
      return;
    }

    setStatus("saving");
    const timeout = window.setTimeout(async () => {
      try {
        await requestWixData("save", data);
        setStatus("saved");
      } catch (error) {
        console.error("Could not save arena data to Wix.", error);
        setStatus("error");
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [data, ready, wixConnected]);

  return [data, setData, status] as const;
}
