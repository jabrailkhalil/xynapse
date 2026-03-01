import { ModelRole } from "@xynapse/config-yaml";

import { XynapseConfig, ILLM } from "..";
import { LLMConfigurationStatuses } from "../llm/constants";
import {
  GlobalContext,
  GlobalContextModelSelections,
} from "../util/GlobalContext";

export function rectifySelectedModelsFromGlobalContext(
  xynapseConfig: XynapseConfig,
  profileId: string,
): XynapseConfig {
  const configCopy = { ...xynapseConfig };

  const globalContext = new GlobalContext();
  const currentSelectedModels = globalContext.get("selectedModelsByProfileId");
  const currentForProfile: GlobalContextModelSelections =
    currentSelectedModels?.[profileId] ?? {};

  let fellBack = false;

  // summarize not implemented yet
  const roles: ModelRole[] = [
    "autocomplete",
    "apply",
    "edit",
    "embed",
    "rerank",
    "chat",
  ];

  for (const role of roles) {
    let newModel: ILLM | null = null;
    const currentSelection = currentForProfile[role] ?? null;

    if (currentSelection) {
      const match = xynapseConfig.modelsByRole[role].find(
        (m) => m.title === currentSelection,
      );
      if (match) {
        newModel = match;
      }
    }

    if (!newModel && xynapseConfig.modelsByRole[role].length > 0) {
      newModel = xynapseConfig.modelsByRole[role][0];
    }

    if (!(currentSelection === (newModel?.title ?? null))) {
      fellBack = true;
    }

    // Currently only check for configuration status for apply
    if (
      role === "apply" &&
      newModel?.getConfigurationStatus() !== LLMConfigurationStatuses.VALID
    ) {
      continue;
    }

    configCopy.selectedModelByRole[role] = newModel;
  }

  // In the case shared config wasn't respected,
  // Rewrite the shared config
  if (fellBack) {
    globalContext.update("selectedModelsByProfileId", {
      ...currentSelectedModels,
      [profileId]: Object.fromEntries(
        Object.entries(configCopy.selectedModelByRole).map(([key, value]) => [
          key,
          value?.title ?? null,
        ]),
      ),
    });
  }

  return configCopy;
}
