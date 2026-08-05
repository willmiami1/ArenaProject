export function normalizeHorseNames(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const horses = new Map<string, string>();
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const horse = value.trim().replace(/\s+/g, " ");
    const key = horse.toLowerCase();
    if (horse && !horses.has(key)) horses.set(key, horse);
  });
  return [...horses.values()];
}
