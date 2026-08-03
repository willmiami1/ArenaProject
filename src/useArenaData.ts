import { useEffect, useState } from "react";
import { seedData } from "./data";
import type { ArenaData } from "./types";

const STORAGE_KEY = "arena-command-data-v1";

function loadData(): ArenaData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as ArenaData) : seedData;
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
