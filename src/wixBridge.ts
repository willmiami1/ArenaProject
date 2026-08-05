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
import type { SpectatorChoice } from "./spectatorPredictions";
import type { AdminAccessResult } from "./adminAccess";
import type { ContestantAccountRequest } from "./contestantAccount";
import type {
  RegistrationDeskContestantInput,
  RegistrationDeskData,
} from "./registrationDeskData";

type WixAction =
  | "load"
  | "save"
  | "authenticateContestant"
  | "setContestantPin"
  | "loadPublicArenaData"
  | "loadSignupOptions"
  | "submitOnlineSignup"
  | "submitSpectatorPrediction"
  | "createContestantAccount"
  | "getAdminAccess"
  | "promptAdminLogin"
  | "getRegistrationDeskAccess"
  | "promptRegistrationDeskLogin"
  | "loadRegistrationDeskData"
  | "saveRegistrationDeskContestant"
  | "setRegistrationDeskContestantPin"
  | "submitRegistrationDeskSignup";

export interface ContestantPortalData {
  contestant: Contestant;
  contestants: Pick<Contestant, "id" | "name">[];
  meets: ArenaMeet[];
  events: ArenaEvent[];
  registrations: EventRegistration[];
  teams: Team[];
}

export interface SignupOptions {
  contestant: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap" | "horses">;
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
  if (window.parent === window) return false;
  const configuredOrigin = import.meta.env.VITE_WIX_HOST_ORIGIN?.trim();
  if (!configuredOrigin || !document.referrer) return false;
  try {
    return new URL(document.referrer).origin === configuredOrigin;
  } catch {
    return false;
  }
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
      action === "submitSpectatorPrediction" ||
      action === "createContestantAccount" ||
      action === "getAdminAccess" ||
      action === "promptAdminLogin" ||
      action === "getRegistrationDeskAccess" ||
      action === "promptRegistrationDeskLogin" ||
      action === "loadRegistrationDeskData" ||
      action === "saveRegistrationDeskContestant" ||
      action === "setRegistrationDeskContestantPin" ||
      action === "submitRegistrationDeskSignup";
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
    const message = {
      source: "arena-command-app",
      requestId,
      action,
      data,
    };
    const retry =
      action === "loadPublicArenaData"
        ? window.setInterval(
            () => window.parent.postMessage(message, targetOrigin),
            750,
          )
        : undefined;
    const timeout = window.setTimeout(() => {
      if (retry !== undefined) window.clearInterval(retry);
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
      if (retry !== undefined) window.clearInterval(retry);
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      if (!event.data.ok) {
        reject(new Error(event.data.error || "Wix persistence failed."));
        return;
      }
      resolve(event.data.data ?? null);
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(message, targetOrigin);
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

export function getRegistrationDeskAccess() {
  return requestWix<AdminAccessResult>("getRegistrationDeskAccess");
}

export function promptRegistrationDeskLogin() {
  return requestWix<AdminAccessResult>("promptRegistrationDeskLogin");
}

export function loadRegistrationDeskData() {
  return requestWix<RegistrationDeskData>("loadRegistrationDeskData");
}

export function saveRegistrationDeskContestant(
  contestant: RegistrationDeskContestantInput,
) {
  return requestWix<{
    contestant: Contestant;
    data: RegistrationDeskData;
  }>("saveRegistrationDeskContestant", contestant);
}

export function submitRegistrationDeskSignup(signup: SignupRequest) {
  return requestWix<{
    summary: string;
    data: RegistrationDeskData;
  }>("submitRegistrationDeskSignup", signup);
}

export function setRegistrationDeskContestantPin(
  contestantId: string,
  pin: string,
) {
  return requestWix<{ configured: boolean }>(
    "setRegistrationDeskContestantPin",
    { contestantId, pin },
  );
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

export function submitSpectatorPrediction(request: {
  name: string;
  eventId: string;
  teamId: string;
  choice: SpectatorChoice;
}) {
  return requestWix<{
    spectatorName: string;
    existing: boolean;
    publicData: PublicArenaData;
  }>("submitSpectatorPrediction", request);
}

export function createContestantAccount(
  competitionId: string,
  account: ContestantAccountRequest,
) {
  return requestWix<SignupOptions>("createContestantAccount", {
    competitionId,
    ...account,
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
