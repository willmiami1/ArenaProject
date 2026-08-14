import { items } from "@wix/data";
import { elevate } from "wix-auth";

export function createConditionalLockApi() {
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
