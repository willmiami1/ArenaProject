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
import type { ActiveRunConfirmation } from "./activeRunSaveQueue";

type WixAction =
  | "load"
  | "save"
  | "saveContestant"
  | "saveRegistration"
  | "setActiveRun"
  | "authenticateContestant"
  | "setContestantPin"
  | "loadPublicArenaData"
  | "loadPublicSchedule"
  | "publishPublicSchedule"
  | "loadSignupOptions"
  | "startPublicSignupPayment"
  | "getPublicSignupPaymentStatus"
  | "submitOnlineSignup"
  | "submitSpectatorPrediction"
  | "createContestantAccount"
  | "createRiderAccount"
  | "getAdminAccess"
  | "promptAdminLogin"
  | "logoutAdmin"
  | "getRegistrationDeskAccess"
  | "promptRegistrationDeskLogin"
  | "loadRegistrationDeskData"
  | "saveRegistrationDeskContestant"
  | "setRegistrationDeskContestantPin"
  | "submitRegistrationDeskSignup"
  | "updateRegistrationDeskEntry"
  | "scratchRegistrationDeskEntry";

export interface ContestantPortalData {
  contestant: Contestant;
  contestants: Pick<Contestant, "id" | "name">[];
  meets: ArenaMeet[];
  events: ArenaEvent[];
  registrations: EventRegistration[];
  teams: Team[];
}

export interface WorkspaceSaveConfirmation {
  saved: true;
  revision: number;
  staffRevision: number;
  onlineRevision: number;
  loadedAt: string;
}

export interface ContestantSaveConfirmation {
  contestant: Contestant;
  revision: number;
  staffRevision: number;
  onlineRevision: number;
  loadedAt: string;
}

export interface RegistrationSaveConfirmation {
  registration: EventRegistration;
  revision: number;
  staffRevision: number;
  onlineRevision: number;
  loadedAt: string;
}

export function isWorkspaceSaveConfirmation(
  value: ArenaData | WorkspaceSaveConfirmation,
): value is WorkspaceSaveConfirmation {
  return (
    "saved" in value &&
    value.saved === true &&
    Number.isFinite(value.revision) &&
    Number.isFinite(value.staffRevision) &&
    Number.isFinite(value.onlineRevision) &&
    typeof value.loadedAt === "string"
  );
}

export interface SignupOptions {
  contestant: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap" | "horses">;
  partners: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap">[];
}

export interface PublicSignupCompetition {
  id: string;
  name: string;
  date: string;
  startTime: string;
  competitionType: "slide" | "round-robin" | "pick-and-draw";
  registrationClosesAt: string;
  roles: Array<"Header" | "Heeler">;
  roleCapacities?: Array<{
    role: "Header" | "Heeler";
    registered: number;
    maximum: number;
    full: boolean;
  }>;
  requiresPartner: boolean;
  partners: Array<
    Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap"> & {
      eligibleRoles: Array<"Header" | "Heeler">;
    }
  >;
}

export interface PublicSignupSelection {
  competitionId: string;
  role: "Header" | "Heeler";
  partnerId?: string;
}

export interface PublicSignupPayment {
  submissionId: string;
  paymentId: string;
  status:
    | "creating"
    | "payment-created"
    | "pending"
    | "successful"
    | "failed"
    | "cancelled"
    | "expired"
    | "fulfillment-failed";
  amount: number;
  currency: "USD";
  competitionIds: string[];
  message: string;
  checkoutStatus?: string;
}

export interface PublicSignupOptions {
  contestant: Pick<Contestant, "id" | "name" | "role" | "headerHandicap" | "heelerHandicap">;
  signupToken: string;
  expiresAt: string;
  price: { amount: number; currency: "USD" };
  competitions: PublicSignupCompetition[];
  activePayment?: PublicSignupPayment;
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
  error?: string | { code: string; message: string };
}

export function wixResponseErrorMessage(error: WixResponse<unknown>["error"]) {
  return typeof error === "string" ? error : error?.message;
}

const wixRelayStorageKey = "arena-command-wix-relay-origin";

export function trustedWixRelayOrigin(
  configuredOrigin: string,
  configuredRelayHost: string | null,
  ancestorOrigins: string[],
  parentOrigin: string,
) {
  const parent = new URL(parentOrigin);
  const configuredHost = new URL(configuredOrigin).hostname.toLowerCase();
  const siteRelayHost = `${configuredHost.replace(/\./g, "-")}.filesusr.com`;
  const siteSpecificRelay = parent.hostname.toLowerCase() === siteRelayHost;
  const wixRelay =
    parent.hostname === "htmlcomponentservice.com" ||
    parent.hostname.endsWith(".htmlcomponentservice.com") ||
    parent.hostname.endsWith(".filesusr.com") ||
    parent.hostname.endsWith(".wixstatic.com");
  const configuredSiteIsAncestor = ancestorOrigins.includes(configuredOrigin);
  const explicitRelayContext =
    ancestorOrigins.length === 0 && configuredRelayHost === configuredOrigin;
  return wixRelay &&
    (siteSpecificRelay || configuredSiteIsAncestor || explicitRelayContext)
    ? parent.origin
    : false;
}

function wixParentOrigin() {
  if (window.parent === window) return false;
  const configuredOrigin = import.meta.env.VITE_WIX_HOST_ORIGIN?.trim();
  if (!configuredOrigin) return false;
  try {
    const referrerOrigin = document.referrer
      ? new URL(document.referrer).origin
      : "";
    if (referrerOrigin === configuredOrigin) {
      window.sessionStorage.setItem(wixRelayStorageKey, referrerOrigin);
      return referrerOrigin;
    }
    const configuredRelayHost = new URL(
      window.location.href,
    ).searchParams.get("wixHostOrigin");
    const ancestorOrigins = Array.from(
      window.location.ancestorOrigins ?? [],
    );
    const parentOrigin = ancestorOrigins[0] || referrerOrigin;
    const cachedRelayOrigin = window.sessionStorage.getItem(wixRelayStorageKey) ?? "";
    const trustedOrigin =
      (parentOrigin &&
        trustedWixRelayOrigin(
          configuredOrigin,
          configuredRelayHost,
          ancestorOrigins,
          parentOrigin,
        )) ||
      (cachedRelayOrigin === configuredOrigin
        ? configuredOrigin
        : cachedRelayOrigin &&
          trustedWixRelayOrigin(
            configuredOrigin,
            configuredRelayHost,
            ancestorOrigins,
            cachedRelayOrigin,
          ));
    if (trustedOrigin) {
      window.sessionStorage.setItem(wixRelayStorageKey, trustedOrigin);
    }
    return trustedOrigin || false;
  } catch {
    return false;
  }
}

export function isWixEmbed() {
  return Boolean(wixParentOrigin());
}

const publicEventSectionIds = {
  events: "events",
  live: "events-live",
  current: "events-live",
  future: "events-future",
  past: "events-past",
} as const;

export function publicEventSectionTargetId(section: unknown) {
  return typeof section === "string" && section in publicEventSectionIds
    ? publicEventSectionIds[section as keyof typeof publicEventSectionIds]
    : null;
}

export function subscribeToWixSectionNavigation(
  onNavigate: (targetId: string) => void,
) {
  const trustedOrigin = wixParentOrigin();
  if (!trustedOrigin) return () => undefined;
  const handleMessage = (event: MessageEvent) => {
    if (
      event.source !== window.parent ||
      event.origin !== trustedOrigin ||
      typeof event.data !== "object" ||
      event.data === null ||
      event.data.type !== "arena:navigate-section"
    ) {
      return;
    }
    const targetId = publicEventSectionTargetId(event.data.section);
    if (targetId) onNavigate(targetId);
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}

export function sensitiveWixAction(action: WixAction) {
  return (
    action === "authenticateContestant" ||
    action === "saveContestant" ||
    action === "saveRegistration" ||
    action === "setActiveRun" ||
    action === "setContestantPin" ||
    action === "loadSignupOptions" ||
    action === "startPublicSignupPayment" ||
    action === "getPublicSignupPaymentStatus" ||
    action === "submitOnlineSignup" ||
    action === "submitSpectatorPrediction" ||
    action === "createContestantAccount" ||
    action === "createRiderAccount" ||
    action === "getAdminAccess" ||
    action === "promptAdminLogin" ||
    action === "logoutAdmin" ||
    action === "getRegistrationDeskAccess" ||
    action === "promptRegistrationDeskLogin" ||
    action === "loadRegistrationDeskData" ||
    action === "saveRegistrationDeskContestant" ||
    action === "setRegistrationDeskContestantPin" ||
    action === "submitRegistrationDeskSignup" ||
    action === "updateRegistrationDeskEntry" ||
    action === "scratchRegistrationDeskEntry"
  );
}

function discoverWixParentOrigin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const configuredOrigin = import.meta.env.VITE_WIX_HOST_ORIGIN?.trim();
    if (!configuredOrigin || window.parent === window) {
      reject(new Error("Rider account creation is available on the Destiny Ranch Arena website."));
      return;
    }
    const trustedSiteOrigin = configuredOrigin;
    const requestId =
      window.crypto.randomUUID?.() ??
      `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const message = {
      source: "arena-command-app",
      requestId,
      action: "loadPublicSchedule",
    };
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", handleMessage);
      reject(new Error("The secure Wix connection did not respond. Refresh the arena website and try again."));
    }, 8000);

    function handleMessage(event: MessageEvent<WixResponse<unknown>>) {
      if (
        event.source !== window.parent ||
        event.data?.source !== "arena-wix-host" ||
        event.data.requestId !== requestId
      ) {
        return;
      }
      let trustedOrigin: string | false = false;
      try {
        trustedOrigin = trustedWixRelayOrigin(
          trustedSiteOrigin,
          null,
          [],
          event.origin,
        );
      } catch {
        trustedOrigin = false;
      }
      if (!trustedOrigin) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleMessage);
      window.sessionStorage.setItem(wixRelayStorageKey, trustedOrigin);
      resolve(trustedOrigin);
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(message, "*");
  });
}

async function requestWix<T>(
  action: WixAction,
  data?: unknown,
): Promise<T | null> {
  const sensitiveAction = sensitiveWixAction(action);
  const targetOrigin = sensitiveAction
    ? wixParentOrigin() || await discoverWixParentOrigin()
    : "*";
  return requestWixFromOrigin<T>(action, data, targetOrigin, sensitiveAction);
}

function requestWixFromOrigin<T>(
  action: WixAction,
  data: unknown,
  targetOrigin: string,
  sensitiveAction: boolean,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
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
    const timeoutMilliseconds =
      action === "promptAdminLogin" ||
      action === "promptRegistrationDeskLogin" ||
      action === "startPublicSignupPayment"
        ? 5 * 60 * 1000
        : action === "save"
          ? 30 * 1000
        : 8000;
    const timeout = window.setTimeout(() => {
      if (retry !== undefined) window.clearInterval(retry);
      window.removeEventListener("message", handleMessage);
      reject(new Error("Wix persistence did not respond."));
    }, timeoutMilliseconds);

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
        const message = wixResponseErrorMessage(event.data.error);
        reject(new Error(message || "Wix persistence failed."));
        return;
      }
      resolve(event.data.data ?? null);
    }

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(message, targetOrigin);
  });
}

export function requestWixData(action: "load"): Promise<ArenaData | null>;
export function requestWixData(
  action: "save",
  data: ArenaData,
): Promise<ArenaData | WorkspaceSaveConfirmation | null>;
export function requestWixData(action: "load" | "save", data?: ArenaData) {
  return requestWix<ArenaData | WorkspaceSaveConfirmation>(action, data);
}

export async function saveContestant(contestant: Contestant) {
  const confirmation = await requestWix<ContestantSaveConfirmation>(
    "saveContestant",
    contestant,
  );
  if (!confirmation) {
    throw new Error("Wix did not confirm the contestant save.");
  }
  return confirmation;
}

export async function saveRegistration(registration: EventRegistration) {
  const confirmation = await requestWix<RegistrationSaveConfirmation>(
    "saveRegistration",
    registration,
  );
  if (!confirmation) {
    throw new Error("Wix did not confirm the registration save.");
  }
  return confirmation;
}

export async function setActiveRun(data: {
  eventId: string;
  teamId: string;
}) {
  const confirmation = await requestWix<ActiveRunConfirmation>(
    "setActiveRun",
    data,
  );
  if (!confirmation) {
    throw new Error("Wix did not confirm the Roping Now selection.");
  }
  return confirmation;
}

export function loadPublicArenaData() {
  return requestWix<PublicArenaData>("loadPublicArenaData");
}

export function loadPublicSchedule() {
  return requestWix<PublicArenaData & { scheduleError?: string }>(
    "loadPublicSchedule",
  ).then((data) => {
    if (!data) throw new Error("Wix returned an empty event schedule.");
    if (data.scheduleError) throw new Error(data.scheduleError);
    return data;
  });
}

export function publishPublicSchedule(events: ArenaData["events"]) {
  return requestWix<{ publishedAt: string; count: number }>(
    "publishPublicSchedule",
    events,
  );
}

export function getAdminAccess() {
  return requestWix<AdminAccessResult>("getAdminAccess");
}

export function promptAdminLogin() {
  return requestWix<AdminAccessResult>("promptAdminLogin");
}

export function logoutAdmin() {
  return requestWix<{ loggedOut: boolean }>("logoutAdmin");
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

export interface RegistrationDeskEntryRequest {
  eventId: string;
  recordType: "registration" | "team";
  recordId: string;
}

export interface RegistrationDeskEntryResult extends RegistrationDeskEntryRequest {
  summary: string;
  data: RegistrationDeskData;
}

export function updateRegistrationDeskEntry(
  request: RegistrationDeskEntryRequest & { patch: Record<string, unknown> },
) {
  return requestWix<RegistrationDeskEntryResult>(
    "updateRegistrationDeskEntry",
    request,
  );
}

export function scratchRegistrationDeskEntry(
  request: RegistrationDeskEntryRequest & { confirmed: true },
) {
  return requestWix<RegistrationDeskEntryResult>(
    "scratchRegistrationDeskEntry",
    request,
  );
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
  competitionId: string | undefined,
  email: string,
  pin: string,
) {
  return requestWix<PublicSignupOptions>("loadSignupOptions", {
    competitionId,
    email,
    pin,
  });
}

export function startPublicSignupPayment(
  signupToken: string,
  submissionId: string,
  selections: PublicSignupSelection[],
) {
  return requestWix<PublicSignupPayment>("startPublicSignupPayment", {
    signupToken,
    submissionId,
    selections,
  });
}

export function getPublicSignupPaymentStatus(
  signupToken: string,
  submissionId: string,
) {
  return requestWix<PublicSignupPayment>("getPublicSignupPaymentStatus", {
    signupToken,
    submissionId,
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

export function createRiderAccount(account: ContestantAccountRequest) {
  return requestWix<{ contestantId: string; name: string }>(
    "createRiderAccount",
    account,
  );
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
