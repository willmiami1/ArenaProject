import { Permissions, webMethod } from "wix-web-module";
import wixData from "wix-data";

const COLLECTIONS = {
  meets: "ArenaMeets",
  events: "ArenaCompetitions",
  contestants: "ArenaContestants",
  teams: "ArenaTeams",
  registrations: "ArenaRegistrations",
};
const SETTINGS_COLLECTION = "ArenaSettings";
const SETTINGS_ID = "arena-command-settings";
const OPTIONS = { suppressAuth: true };

async function readAll(collectionId) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const items = [...result.items];
  while (result.hasNext()) {
    result = await result.next();
    items.push(...result.items);
  }
  return items.map((item) => JSON.parse(item.payload));
}

async function replaceAll(collectionId, records) {
  let result = await wixData.query(collectionId).limit(1000).find(OPTIONS);
  const ids = result.items.map((item) => item._id);
  while (result.hasNext()) {
    result = await result.next();
    ids.push(...result.items.map((item) => item._id));
  }
  if (ids.length) await wixData.bulkRemove(collectionId, ids, OPTIONS);
  if (records.length) {
    await wixData.bulkInsert(
      collectionId,
      records.map((record) => ({
        appId: record.id,
        payload: JSON.stringify(record),
      })),
      OPTIONS,
    );
  }
}

export const loadArenaData = webMethod(Permissions.Admin, async () => {
  const settings = await wixData
    .get(SETTINGS_COLLECTION, SETTINGS_ID, OPTIONS)
    .catch(() => null);
  if (!settings) return null;

  const [meets, events, contestants, teams, registrations] = await Promise.all([
    readAll(COLLECTIONS.meets),
    readAll(COLLECTIONS.events),
    readAll(COLLECTIONS.contestants),
    readAll(COLLECTIONS.teams),
    readAll(COLLECTIONS.registrations),
  ]);
  return {
    meets,
    events,
    contestants,
    teams,
    registrations,
    activeEventId: settings.activeEventId || "",
  };
});

export const saveArenaData = webMethod(Permissions.Admin, async (data) => {
  await Promise.all([
    replaceAll(COLLECTIONS.meets, data.meets || []),
    replaceAll(COLLECTIONS.events, data.events || []),
    replaceAll(COLLECTIONS.contestants, data.contestants || []),
    replaceAll(COLLECTIONS.teams, data.teams || []),
    replaceAll(COLLECTIONS.registrations, data.registrations || []),
  ]);
  await wixData.save(
    SETTINGS_COLLECTION,
    {
      _id: SETTINGS_ID,
      activeEventId: data.activeEventId || "",
      updatedAt: new Date(),
    },
    OPTIONS,
  );
  return { saved: true };
});
