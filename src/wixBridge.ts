import type {
  ArenaData,
  ArenaEvent,
  ArenaMeet,
  Contestant,
  EventRegistration,
  Team,
} from "./types";
import type { PublicArenaData } from "./publicData";
import type { SignupRequest } from "./onlineSignup";
import type { AdminAccessResult } from "./adminAccess";

type WixAction =
  | "load"
  | "save"
  | "authenticateContestant"
  | "setContestantPin"
  | "loadPublicArenaData"
  | "loadSignupOptions"
  | "submitOnlineSignup"
  | "getAdminAccess"
  | "promptAdminLogin";

export interface ContestantPortalData {
  contestant: Contestant;
  contestants: Pick<Contestant, "id" | "name">[];
  meets: ArenaMeet[];
  events: ArenaEvent[];
  registrations: EventRegistration[];
  teams: Team[];
}

export interface SignupOptions {
  contestant: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap">;
  partners: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap">[];
}

export interface SignupConfirmation {
  submissionId: string;
  competitionId: string;
  summary: string;
  existing: boolean;
}

interface WixResponse<T> {
  source: "arena-wix-host";
  requestId: string;
  ok: boolean;
  data?: T | null;
  error?: string;
}

export function isWixEmbed() {
  return window.parent !== window;
}

function requestWix<T>(
  action: WixAction,
  data?: unknown,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const sensitiveAction =
      action === "authenticateContestant" ||
      action === "setContestantPin" ||
      action === "loadSignupOptions" ||
      action === "submitOnlineSignup" ||
      action === "getAdminAccess" ||
      action === "promptAdminLogin";
    let targetOrigin = "*";
    if (sensitiveAction) {
      const configuredOrigin = import.meta.env.VITE_WIX_HOST_ORIGIN?.trim();
      const parentOrigin = document.referrer
        ? new URL(document.referrer).origin
        : "";
      if (!configuredOrigin || parentOrigin !== configuredOrigin) {
        reject(new Error("Secure Wix login is not configured for this site."));
        return;
      }
      targetOrigin = configuredOrigin;
    }
    const requestId =
      window.crypto.randomUUID?.() ??
      `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("Wix persistence did not respond."));
    }, 8000);

    function handleMessage(event: MessageEvent<WixResponse<T>>) {
      if (
        event.source !== window.parent ||
        (sensitiveAction && event.origin !== targetOrigin) ||
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
      targetOrigin,
    );
  });
}

export function requestWixData(
  action: "load" | "save",
  data?: ArenaData,
) {
  return requestWix<ArenaData>(action, data);
}

export function loadPublicArenaData() {
  return requestWix<PublicArenaData>("loadPublicArenaData");
}

export function getAdminAccess() {
  return requestWix<AdminAccessResult>("getAdminAccess");
}

export function promptAdminLogin() {
  return requestWix<AdminAccessResult>("promptAdminLogin");
}

export function loadSignupOptions(
  competitionId: string,
  email: string,
  pin: string,
) {
  return requestWix<SignupOptions>("loadSignupOptions", {
    competitionId,
    email,
    pin,
  });
}

export function submitOnlineSignup(
  credentials: { email: string; pin: string },
  signup: SignupRequest,
) {
  return requestWix<SignupConfirmation>("submitOnlineSignup", {
    ...credentials,
    ...signup,
  });
}

export function authenticateContestant(email: string, pin: string) {
  return requestWix<ContestantPortalData>("authenticateContestant", {
    email,
    pin,
  });
}

export function setContestantPin(
  contestant: Contestant,
  pin: string,
) {
  return requestWix<{ configured: boolean }>("setContestantPin", {
    contestantId: contestant.id,
    email: contestant.email,
    pin,
    contestant,
  });
}
