import fs from "fs";

import { getXynapseGlobalPath } from "core/util/paths";
import { ExtensionContext } from "vscode";

/**
 * Clear all Continue-related artifacts to simulate a brand new user
 */
export function cleanSlate(context: ExtensionContext) {
  // Commented just to be safe
  // // Remove ~/.continue
  // const continuePath = getXynapseGlobalPath();
  // if (fs.existsSync(continuePath)) {
  //   fs.rmSync(continuePath, { recursive: true, force: true });
  // }
  // // Clear extension's globalState
  // context.globalState.keys().forEach((key) => {
  //   context.globalState.update(key, undefined);
  // });
}
