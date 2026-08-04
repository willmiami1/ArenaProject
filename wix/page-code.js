import {
  authenticateContestant,
  loadPublicArenaData,
  loadSignupOptions,
  loadArenaData,
  saveArenaData,
  setContestantPin,
  submitOnlineSignup,
  getAdminAccess as getAdminAccessFromBackend,
} from "backend/arena-data.web";
import { authentication } from "wix-members-frontend";

const EMBED_ELEMENT_ID = "#arenaCommandEmbed";

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
      } else if (message.action === "getAdminAccess") {
        data = await getAdminAccessFromBackend();
      } else if (message.action === "promptAdminLogin") {
        await authentication.promptLogin({ mode: "login", modal: true });
        data = await getAdminAccessFromBackend();
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
