import type { ArenaData } from "./types";

type WixAction = "load" | "save";

interface WixResponse {
  source: "arena-wix-host";
  requestId: string;
  ok: boolean;
  data?: ArenaData | null;
  error?: string;
}

export function isWixEmbed() {
  return window.parent !== window;
}

export function requestWixData(
  action: WixAction,
  data?: ArenaData,
): Promise<ArenaData | null> {
  return new Promise((resolve, reject) => {
    const requestId =
      window.crypto.randomUUID?.() ??
      `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Wix persistence did not respond."));
    }, 8000);

    function handleMessage(event: MessageEvent<WixResponse>) {
      if (
        event.source !== window.parent ||
        event.data?.source !== "arena-wix-host" ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      if (!event.data.ok) {
        reject(new Error(event.data.error || "Wix persistence failed."));
        return;
      }
      resolve(event.data.data ?? null);
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(
      {
        source: "arena-command-app",
        requestId,
        action,
        data,
      },
      "*",
    );
  });
}
