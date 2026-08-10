export function spectatorIdentityInput(value: string) {
  return value.toUpperCase();
}

export function spectatorIdentityLabel(value: string) {
  return value.toUpperCase();
}

export function spectatorAvatarInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
