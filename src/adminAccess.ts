export type AdminAccessState =
  | "checking"
  | "login-required"
  | "denied"
  | "authorized"
  | "local-development"
  | "unavailable";

export interface AdminAccessResult {
  state: Exclude<AdminAccessState, "checking" | "local-development" | "unavailable">;
  message: string;
}

export function localAdminAccess(
  embeddedInWix: boolean,
  developmentBuild: boolean,
  browserStoragePreview = false,
): AdminAccessState {
  if (embeddedInWix) return "checking";
  return developmentBuild || browserStoragePreview
    ? "local-development"
    : "unavailable";
}

export function canMountArenaCommand(state: AdminAccessState) {
  return state === "authorized" || state === "local-development";
}

export function isBrowserStoragePreview(
  hostname = window.location.hostname,
  _pathname = window.location.pathname,
) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}
