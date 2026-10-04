import { RefreshCw } from "lucide-react";
import { reloadForUpdate, useAppUpdateAvailable } from "./appUpdate";

export function AppUpdateBanner() {
  const available = useAppUpdateAvailable();
  if (!available) return null;
  return (
    <div className="app-update-banner" role="status">
      <span>A new version of the arena app is ready.</span>
      <button type="button" onClick={reloadForUpdate}>
        <RefreshCw size={15} /> Update now
      </button>
    </div>
  );
}
