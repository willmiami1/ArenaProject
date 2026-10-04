import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { startAppUpdateWatcher } from "./appUpdate";
import "./styles.css";
import "./public.css";

// Cache the app on this computer so the LED screen and workspace can open
// even without an internet connection. Re-check the service worker every
// minute so long-running tablets pick up new deploys instead of serving the
// cached copy indefinitely.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    window.setInterval(() => void registration.update(), 60_000);
  },
});
startAppUpdateWatcher();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
