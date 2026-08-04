import {
  authenticateContestant,
  loadArenaData,
  saveArenaData,
  setContestantPin,
} from "backend/arena-data.web";

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
