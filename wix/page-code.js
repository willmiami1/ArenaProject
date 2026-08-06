import {
  authenticateContestant,
  loadPublicArenaData,
  loadPublicSchedule,
  loadSignupOptions,
  loadArenaData,
  saveArenaData,
  setContestantPin,
  submitOnlineSignup,
  submitSpectatorPrediction,
  createContestantAccount,
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
      } else if (message.action === "loadSignupOptions") {
        data = await loadSignupOptions(message.data);
      } else if (message.action === "submitOnlineSignup") {
        data = await submitOnlineSignup(message.data);
      } else if (message.action === "submitSpectatorPrediction") {
        data = await submitSpectatorPrediction(message.data);
      } else if (message.action === "createContestantAccount") {
        data = await createContestantAccount(message.data);
      } else if (message.action === "getAdminAccess") {
        data = await getAdminAccessFromBackend();
      } else if (message.action === "promptAdminLogin") {
        await authentication.promptLogin({ mode: "login", modal: true });
        data = await getAdminAccessFromBackend();
      } else if (message.action === "logoutAdmin") {
        await authentication.logout();
        data = { loggedOut: true };
      } else if (message.action === "getRegistrationDeskAccess") {
        data = await getRegistrationDeskAccessFromBackend();
      } else if (message.action === "promptRegistrationDeskLogin") {
        await authentication.promptLogin({ mode: "login", modal: true });
        data = await getRegistrationDeskAccessFromBackend();
      } else if (message.action === "loadRegistrationDeskData") {
        data = await loadRegistrationDeskData();
      } else if (message.action === "saveRegistrationDeskContestant") {
        data = await saveRegistrationDeskContestant(message.data);
      } else if (message.action === "setRegistrationDeskContestantPin") {
        data = await setRegistrationDeskContestantPin(message.data);
      } else if (message.action === "submitRegistrationDeskSignup") {
        data = await submitRegistrationDeskSignup(message.data);
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
      console.error("Arena Command persistence failed.", error);
      embed.postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: false,
        error: error?.message || "Wix Data request failed.",
      });
    } finally {
      pendingRequests.delete(message.requestId);
    }
  });
});
