import { useEffect, useState } from "react";

declare const __ARENA_BUILD_ID__: string;

export const CURRENT_BUILD_ID: string =
  typeof __ARENA_BUILD_ID__ === "string" ? __ARENA_BUILD_ID__ : "dev";

const CHECK_INTERVAL_MS = 60_000;

type Listener = (updateAvailable: boolean) => void;
const listeners = new Set<Listener>();
let updateAvailable = false;
let started = false;

function notify() {
  for (const listener of listeners) listener(updateAvailable);
}

async function fetchDeployedBuildId(): Promise<string | null> {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { buildId?: unknown };
    return typeof body.buildId === "string" ? body.buildId : null;
  } catch {
    return null;
  }
}

export async function checkForAppUpdate(): Promise<boolean> {
  if (CURRENT_BUILD_ID === "dev") return false;
  const deployed = await fetchDeployedBuildId();
  if (deployed && deployed !== CURRENT_BUILD_ID && !updateAvailable) {
    updateAvailable = true;
    notify();
  }
  return updateAvailable;
}

export function reloadForUpdate() {
  window.location.reload();
}

// Unattended screens (livestream, LED board) can reload the moment a new
// build lands; staff pages wait until nobody is looking at them so an
// attendant mid-entry is never interrupted.
function reloadsSilently(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has("display");
}

export function startAppUpdateWatcher() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (CURRENT_BUILD_ID === "dev") return;

  const check = () => {
    void checkForAppUpdate().then((available) => {
      if (available && (reloadsSilently() || document.hidden)) reloadForUpdate();
    });
  };

  window.setInterval(check, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (updateAvailable) reloadForUpdate();
      return;
    }
    check();
  });
  window.addEventListener("focus", check);
  window.setTimeout(check, 5_000);
}

export function useAppUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(updateAvailable);
  useEffect(() => {
    listeners.add(setAvailable);
    setAvailable(updateAvailable);
    return () => {
      listeners.delete(setAvailable);
    };
  }, []);
  return available;
}
