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
): AdminAccessState {
  if (embeddedInWix) return "checking";
  return developmentBuild ? "local-development" : "unavailable";
}

export function canMountArenaCommand(state: AdminAccessState) {
  return state === "authorized" || state === "local-development";
}
