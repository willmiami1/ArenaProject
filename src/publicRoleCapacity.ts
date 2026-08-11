export type PublicRopingRole = "Header" | "Heeler";

export interface PublicRoleCapacity {
  role: PublicRopingRole;
  registered: number;
  maximum: number;
  full: boolean;
}

export function publicRoleCapacityLabel(
  capacity: PublicRoleCapacity | undefined,
) {
  if (
    !capacity ||
    !Number.isInteger(capacity.maximum) ||
    capacity.maximum <= 0 ||
    !Number.isFinite(capacity.registered)
  ) {
    return "";
  }
  const remaining = Math.max(0, capacity.maximum - capacity.registered);
  if (remaining === 0) return "Full";
  return `${remaining} ${remaining === 1 ? "spot" : "spots"} left`;
}

