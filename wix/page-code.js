import {
  authenticateContestant,
  loadPublicArenaData,
  loadPublicSchedule,
  publishPublicSchedule,
  loadSignupOptions,
  loadArenaData,
  saveArenaData,
  setContestantPin,
  submitOnlineSignup,
  submitSpectatorPrediction,
  createContestantAccount,
  createRiderAccount,
  getAdminAccess as getAdminAccessFromBackend,
  getRegistrationDeskAccess as getRegistrationDeskAccessFromBackend,
  loadRegistrationDeskData,
  saveRegistrationDeskContestant,
  setRegistrationDeskContestantPin,
  submitRegistrationDeskSignup,
} from "backend/arena-data.web";
import { authentication } from "wix-members-frontend";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const ADMIN_LOGOUT_ACTIONS = new Set([
  "logoutAdmin",
  "logoutRegistrationDesk",
]);
const ADMIN_SESSION_RETRY_DELAYS_MS = [250, 500, 1000, 1500, 2500];

async function getAccessWhenSessionIsReady(getAccess) {
  let access = await getAccess();
  for (const delay of ADMIN_SESSION_RETRY_DELAYS_MS) {
    if (access?.state !== "login-required") return access;
    await wait(delay);
    access = await getAccess();
  }
  if (access?.state === "login-required") {
    throw new Error(
      "Wix login completed, but the member session is not available yet. Wait a moment and try again.",
    );
  }
  return access;
}

async function promptLogin(getAccess) {
  await authentication.promptLogin({ mode: "login", modal: false });
  return getAccessWhenSessionIsReady(getAccess);
}

async function loadPublicArenaDataWhenReady() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await loadPublicArenaData();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}

$w.onReady(() => {
  const [embed] = $w("HtmlComponent");
  if (!embed) {
    console.error("Add an HTML Component containing the Arena app bridge.");
    return;
  }
  const pendingRequests = new Set();
  embed.onMessage(async (event) => {
    const message = event.data;
    if (message?.source !== "arena-command-app" || !message.requestId) return;
    if (pendingRequests.has(message.requestId)) return;
    pendingRequests.add(message.requestId);

    try {
      let data;
      if (message.action === "load") data = await loadArenaData();
      else if (message.action === "save") {
        data = await saveArenaData(message.data);
      } else if (message.action === "authenticateContestant") {
        data = await authenticateContestant(message.data);
      } else if (message.action === "setContestantPin") {
        data = await setContestantPin(message.data);
      } else if (message.action === "loadPublicArenaData") {
        data = await loadPublicArenaDataWhenReady();
      } else if (message.action === "loadPublicSchedule") {
        data = await loadPublicSchedule();
      } else if (message.action === "publishPublicSchedule") {
        data = await publishPublicSchedule(message.data);
      } else if (message.action === "loadSignupOptions") {
        data = await loadSignupOptions(message.data);
      } else if (message.action === "submitOnlineSignup") {
        data = await submitOnlineSignup(message.data);
      } else if (message.action === "submitSpectatorPrediction") {
        data = await submitSpectatorPrediction(message.data);
      } else if (message.action === "createContestantAccount") {
        data = await createContestantAccount(message.data);
      } else if (message.action === "createRiderAccount") {
        data = await createRiderAccount(message.data);
      } else if (message.action === "getAdminAccess") {
        data = await getAdminAccessFromBackend();
      } else if (message.action === "promptAdminLogin") {
        data = await promptLogin(getAdminAccessFromBackend);
      } else if (message.action === "getRegistrationDeskAccess") {
        data = await getRegistrationDeskAccessFromBackend();
      } else if (message.action === "promptRegistrationDeskLogin") {
        data = await promptLogin(getRegistrationDeskAccessFromBackend);
      } else if (message.action === "loadRegistrationDeskData") {
        data = await loadRegistrationDeskData();
      } else if (message.action === "saveRegistrationDeskContestant") {
        data = await saveRegistrationDeskContestant(message.data);
      } else if (message.action === "setRegistrationDeskContestantPin") {
        data = await setRegistrationDeskContestantPin(message.data);
      } else if (message.action === "submitRegistrationDeskSignup") {
        data = await submitRegistrationDeskSignup(message.data);
      } else if (ADMIN_LOGOUT_ACTIONS.has(message.action)) {
        await authentication.logout();
        data = { loggedOut: true };
      } else {
        throw new Error("Unsupported Arena Command action.");
      }
      embed.postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      console.error("Arena Command action failed.", {
        action: message.action,
        message: error instanceof Error ? error.message : String(error),
      });
      embed.postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: false,
        error: error?.message || "The requested Arena action failed.",
      });
    } finally {
      pendingRequests.delete(message.requestId);
    }
  });
});
