import { workspace } from "vscode";

export const XYNAPSE_WORKSPACE_KEY = "xynapse";

export function getXynapseWorkspaceConfig() {
  return workspace.getConfiguration(XYNAPSE_WORKSPACE_KEY);
}
