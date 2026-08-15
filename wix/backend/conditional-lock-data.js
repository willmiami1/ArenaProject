import { elevate } from "wix-auth";

// Defer the CommonJS SDK load so unrelated login methods can still initialize.
const loadWixDataModule = () => require("@wix/data");

export function createConditionalLockApi(loadModule = loadWixDataModule) {
  const { items } = loadModule();
  if (
    typeof items?.filter !== "function" ||
    typeof items?.update !== "function" ||
    typeof items?.remove !== "function"
  ) {
    throw new Error("The Wix Data Items SDK exports are incomplete.");
  }
  return {
    items,
    update: elevate(items.update),
    remove: elevate(items.remove),
  };
}
