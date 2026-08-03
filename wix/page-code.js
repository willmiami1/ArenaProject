import {
  loadArenaData,
  saveArenaData,
} from "backend/arena-data.web";

const EMBED_ELEMENT_ID = "#arenaCommandEmbed";

$w.onReady(() => {
  $w(EMBED_ELEMENT_ID).onMessage(async (event) => {
    const message = event.data;
    if (message?.source !== "arena-command-app" || !message.requestId) return;

    try {
      const data =
        message.action === "load"
          ? await loadArenaData()
          : await saveArenaData(message.data);
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
