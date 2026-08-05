import {
  authenticateContestant,
  loadPublicArenaData,
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

const EMBED_ELEMENT_ID = "#comp-msgn54ge";

$w.onReady(() => {
  $w(EMBED_ELEMENT_ID).onMessage(async (event) => {
    const message = event.data;
    if (message?.source !== "arena-command-app" || !message.requestId) return;

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
        data = await loadPublicArenaData();
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
      $w(EMBED_ELEMENT_ID).postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: true,
        data,
      });
    } catch (error) {
      console.error("Arena Command persistence failed.", error);
      $w(EMBED_ELEMENT_ID).postMessage({
        source: "arena-wix-host",
        requestId: message.requestId,
        ok: false,
        error: error?.message || "Wix Data request failed.",
      });
    }
  });
});
