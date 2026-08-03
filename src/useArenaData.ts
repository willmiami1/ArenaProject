import { useEffect, useState } from "react";
import { seedData } from "./data";
import {
  defaultCompetitionSettings,
  reconcileQualifiedAdvancements,
} from "./competition";
import type { ArenaData, ArenaMeet } from "./types";

const STORAGE_KEY = "arena-command-data-v1";

function loadData(): ArenaData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return seedData;

    const parsed = JSON.parse(saved) as ArenaData;
    const meets: ArenaMeet[] =
      parsed.meets ??
      parsed.events.map((event) => ({
        id: `meet-${event.id}`,
        name: event.name,
        date: event.date,
        startTime: event.startTime,
        location: event.location,
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
      registrations: parsed.registrations ?? [],
    };
  } catch {
    return seedData;
  }
}

export function useArenaData() {
  const [data, setData] = useState<ArenaData>(loadData);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  return [data, setData] as const;
}
