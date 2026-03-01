import {
  AssistantUnrolled,
  BLOCK_TYPES,
  ConfigResult,
  ConfigValidationError,
  isAssistantUnrolledNonNullable,
  mergeConfigYamlRequestOptions,
  mergeUnrolledAssistants,
  ModelRole,
  PackageIdentifier,
  RegistryClient,
  unrollAssistant,
  validateConfigYaml,
} from "@xynapse/config-yaml";
import * as fs from "fs";
import { dirname } from "node:path";
import * as YAML from "yaml";

import {
  XynapseConfig,
  IDE,
  IdeInfo,
  IdeSettings,
  ILLMLogger,
  InternalMcpOptions,
} from "../..";
import { MCPManagerSingleton } from "../../context/mcp/MCPManagerSingleton";
import { ControlPlaneClient } from "../../control-plane/client";
import TransformersJsEmbeddingsProvider from "../../llm/llms/TransformersJsEmbeddingsProvider";
import { getAllPromptFiles } from "../../promptFiles/getPromptFiles";
import { GlobalContext } from "../../util/GlobalContext";
import { modifyAnyConfigWithSharedConfig } from "../sharedConfig";

import { getLegacyBuiltInSlashCommandFromDescription } from "../../commands/slash/built-in-legacy";
import { convertPromptBlockToSlashCommand } from "../../commands/slash/promptBlockSlashCommand";
import { slashCommandFromPromptFile } from "../../commands/slash/promptFileSlashCommand";
import { loadJsonMcpConfigs } from "../../context/mcp/json/loadJsonMcpConfigs";
import { getControlPlaneEnvSync } from "../../control-plane/env";
import { PolicySingleton } from "../../control-plane/PolicySingleton";
import { getBaseToolDefinitions } from "../../tools";
import { getCleanUriPath } from "../../util/uri";
import { loadConfigContextProviders } from "../loadContextProviders";
import { getAllDotXynapseDefinitionFiles } from "../loadLocalAssistants";
import { unrollLocalYamlBlocks } from "./loadLocalYamlBlocks";
import { LocalPlatformClient } from "./LocalPlatformClient";
import { llmsFromModelConfig } from "./models";
import {
  convertYamlMcpConfigToInternalMcpOptions,
  convertYamlRuleToXynapseRule,
} from "./yamlToXynapseConfig";

async function loadConfigYaml(options: {
  overrideConfigYaml: AssistantUnrolled | undefined;
  controlPlaneClient: ControlPlaneClient;
  orgScopeId: string | null;
  ideSettings: IdeSettings;
  ide: IDE;
  packageIdentifier: PackageIdentifier;
}): Promise<ConfigResult<AssistantUnrolled>> {
  const {
    overrideConfigYaml,
    controlPlaneClient,
    orgScopeId,
    ideSettings,
    ide,
    packageIdentifier,
  } = options;

  // Add local .xynapse blocks
  const localBlockPromises = BLOCK_TYPES.map(async (blockType) => {
    const localBlocks = await getAllDotXynapseDefinitionFiles(
      ide,
      { includeGlobal: true, includeWorkspace: true, fileExtType: "yaml" },
      blockType,
    );
    return localBlocks.map((b) => ({
      uriType: "file" as const,
      fileUri: b.path,
    }));
  });
  const localPackageIdentifiers: PackageIdentifier[] = (
    await Promise.all(localBlockPromises)
  ).flat();

  // logger.info(
  //   `Loading config.yaml from ${JSON.stringify(packageIdentifier)} with root path ${rootPath}`,
  // );

  // Registry client is only used if local blocks are present, but logic same for hub/local assistants
  const getRegistryClient = async () => {
    const rootPath =
      packageIdentifier.uriType === "file"
        ? dirname(getCleanUriPath(packageIdentifier.fileUri))
        : undefined;
    return new RegistryClient({
      accessToken: await controlPlaneClient.getAccessToken(),
      apiBase: getControlPlaneEnvSync(ideSettings.xynapseTestEnvironment)
        .CONTROL_PLANE_URL,
      rootPath,
    });
  };

  const errors: ConfigValidationError[] = [];

  let config: AssistantUnrolled | undefined;

  if (overrideConfigYaml) {
    config = overrideConfigYaml;
    if (localPackageIdentifiers.length > 0) {
      const unrolledLocal = await unrollLocalYamlBlocks(
        localPackageIdentifiers,
        ide,
        await getRegistryClient(),
        orgScopeId,
        controlPlaneClient,
      );
      if (unrolledLocal.errors) {
        errors.push(...unrolledLocal.errors);
      }
      if (unrolledLocal.config) {
        config = mergeUnrolledAssistants(config, unrolledLocal.config);
      }
    }
  } else {
    // This is how we allow use of blocks locally
    const unrollResult = await unrollAssistant(
      packageIdentifier,
      await getRegistryClient(),
      {
        renderSecrets: true,
        currentUserSlug: "",
        onPremProxyUrl: null,
        orgScopeId,
        platformClient: new LocalPlatformClient(
          orgScopeId,
          controlPlaneClient,
          ide,
        ),
        injectBlocks: localPackageIdentifiers,
      },
    );
    config = unrollResult.config;
    console.log("[Xynapse] unrollAssistant result - has config:", !!config, "models count:", config?.models?.length ?? 0);
    if (unrollResult.errors?.length) {
      console.log("[Xynapse] unrollAssistant errors:", JSON.stringify(unrollResult.errors));
    }
    if (unrollResult.errors) {
      errors.push(...unrollResult.errors);
    }
  }

  if (config && isAssistantUnrolledNonNullable(config)) {
    const validationErrors = validateConfigYaml(config);
    if (validationErrors.length) {
      console.log("[Xynapse] Validation errors:", JSON.stringify(validationErrors));
    }
    errors.push(...validationErrors);
  }

  if (errors?.some((error) => error.fatal)) {
    console.error("[Xynapse] Fatal config errors, aborting:", JSON.stringify(errors.filter(e => e.fatal)));
    return {
      errors,
      config: undefined,
      configLoadInterrupted: true,
    };
  }

  // Set defaults if undefined (this lets us keep config.json uncluttered for new users)
  return {
    config,
    errors,
    configLoadInterrupted: false,
  };
}

export async function configYamlToXynapseConfig(options: {
  config: AssistantUnrolled;
  ide: IDE;
  ideInfo: IdeInfo;
  uniqueId: string;
  llmLogger: ILLMLogger;
  workOsAccessToken: string | undefined;
}): Promise<{ config: XynapseConfig; errors: ConfigValidationError[] }> {
  let { config, ide, ideInfo, uniqueId, llmLogger } = options;

  const localErrors: ConfigValidationError[] = [];

  const xynapseConfig: XynapseConfig = {
    slashCommands: [],
    tools: getBaseToolDefinitions(),
    mcpServerStatuses: [],
    contextProviders: [],
    modelsByRole: {
      chat: [],
      edit: [],
      apply: [],
      embed: [],
      autocomplete: [],
      rerank: [],
      summarize: [],
    },
    selectedModelByRole: {
      chat: null,
      edit: null, // not currently used
      apply: null,
      embed: null,
      autocomplete: null,
      rerank: null,
      summarize: null,
    },
    rules: [],
    requestOptions: { ...config.requestOptions },
  };

  // Right now, if there are any missing packages in the config, then we will just throw an error
  if (!isAssistantUnrolledNonNullable(config)) {
    return {
      config: xynapseConfig,
      errors: [
        {
          message:
            "Failed to load config due to missing blocks, see which blocks are missing below",
          fatal: true,
        },
      ],
    };
  }

  for (const rule of config.rules ?? []) {
    const convertedRule = convertYamlRuleToXynapseRule(rule);
    xynapseConfig.rules.push(convertedRule);
  }

  xynapseConfig.data = config.data?.map((d) => ({
    ...d,
    requestOptions: mergeConfigYamlRequestOptions(
      d.requestOptions,
      xynapseConfig.requestOptions,
    ),
  }));
  xynapseConfig.docs = config.docs?.map((doc) => ({
    title: doc.name,
    startUrl: doc.startUrl,
    rootUrl: doc.rootUrl,
    faviconUrl: doc.faviconUrl,
    useLocalCrawling: doc.useLocalCrawling,
    sourceFile: doc.sourceFile,
  }));

  // Prompt files -
  try {
    const promptFiles = await getAllPromptFiles(ide, undefined, true);

    promptFiles.forEach((file) => {
      try {
        const slashCommand = slashCommandFromPromptFile(
          file.path,
          file.content,
        );
        if (slashCommand) {
          xynapseConfig.slashCommands?.push(slashCommand);
        }
      } catch (e) {
        localErrors.push({
          fatal: false,
          message: `Failed to convert prompt file ${file.path} to slash command: ${e instanceof Error ? e.message : e}`,
        });
      }
    });
  } catch (e) {
    localErrors.push({
      fatal: false,
      message: `Error loading local prompt files: ${e instanceof Error ? e.message : e}`,
    });
  }

  config.prompts?.forEach((prompt) => {
    try {
      const slashCommand = convertPromptBlockToSlashCommand(prompt);
      xynapseConfig.slashCommands?.push(slashCommand);
    } catch (e) {
      localErrors.push({
        message: `Error loading prompt ${prompt.name}: ${e instanceof Error ? e.message : e}`,
        fatal: false,
      });
    }
  });

  // Load legacy built-in slash commands from raw YAML slashCommands section
  // (zod schema strips this field, so we read the raw YAML file directly)
  try {
    const { getConfigYamlPath } = await import("../../util/paths");
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      const rawYaml = YAML.parse(fs.readFileSync(yamlPath, "utf-8"));
      if (Array.isArray(rawYaml?.slashCommands)) {
        for (const desc of rawYaml.slashCommands) {
          if (desc?.name) {
            const builtIn = getLegacyBuiltInSlashCommandFromDescription(desc);
            if (builtIn) {
              xynapseConfig.slashCommands?.push(builtIn);
            }
          }
        }
      }
    }
  } catch (e) {
    // Non-fatal: slash commands from YAML are optional
  }

  // Models
  let warnAboutFreeTrial = false;
  const defaultModelRoles: ModelRole[] = ["chat", "summarize", "apply", "edit"];
  console.log("[Xynapse] Config models count:", config.models?.length ?? 0);
  console.log("[Xynapse] Config models:", JSON.stringify(config.models?.map(m => ({ name: m.name, provider: m.provider, model: m.model, hasApiKey: !!m.apiKey, hasFolderId: !!(m as any).folderId, roles: m.roles })), null, 2));
  for (const model of config.models ?? []) {
    model.roles = model.roles ?? defaultModelRoles; // Default to all 4 chat-esque roles if not specified

    if (model.provider === "free-trial") {
      warnAboutFreeTrial = true;
    }
    try {
      const llms = await llmsFromModelConfig({
        model,
        uniqueId,
        llmLogger,
        config: xynapseConfig,
      });
      console.log(`[Xynapse] Model "${model.name}" (${model.provider}) loaded: ${llms.length} LLMs`);

      if (model.roles?.includes("chat")) {
        xynapseConfig.modelsByRole.chat.push(...llms);
      }

      if (model.roles?.includes("summarize")) {
        xynapseConfig.modelsByRole.summarize.push(...llms);
      }

      if (model.roles?.includes("apply")) {
        xynapseConfig.modelsByRole.apply.push(...llms);
      }

      if (model.roles?.includes("edit")) {
        xynapseConfig.modelsByRole.edit.push(...llms);
      }

      if (model.roles?.includes("autocomplete")) {
        xynapseConfig.modelsByRole.autocomplete.push(...llms);
      }

      if (model.roles?.includes("embed")) {
        const { provider } = model;
        if (provider === "transformers.js") {
          if (ideInfo.ideType === "vscode") {
            xynapseConfig.modelsByRole.embed.push(
              new TransformersJsEmbeddingsProvider(),
            );
          } else {
            localErrors.push({
              fatal: false,
              message: `Transformers.js embeddings provider not supported in this IDE.`,
            });
          }
        } else {
          xynapseConfig.modelsByRole.embed.push(...llms);
        }
      }

      if (model.roles?.includes("rerank")) {
        xynapseConfig.modelsByRole.rerank.push(...llms);
      }
    } catch (e) {
      console.error(`[Xynapse] Failed to load model "${model.name}":`, e instanceof Error ? e.message : e);
      localErrors.push({
        fatal: false,
        message: `Failed to load model:\nName: ${model.name}\nModel: ${model.model}\nProvider: ${model.provider}\n${e instanceof Error ? e.message : e}`,
      });
    }
  }

  // Add transformers js to the embed models in vs code if not already added
  if (
    ideInfo.ideType === "vscode" &&
    !xynapseConfig.modelsByRole.embed.find(
      (m) => m.providerName === "transformers.js",
    )
  ) {
    xynapseConfig.modelsByRole.embed.push(
      new TransformersJsEmbeddingsProvider(),
    );
  }

  if (warnAboutFreeTrial) {
    localErrors.push({
      fatal: false,
      message:
        "Model provider 'free-trial' is no longer supported, will be ignored.",
    });
  }

  const { providers, errors: contextErrors } = loadConfigContextProviders(
    config.context,
    !!config.docs?.length,
    ideInfo.ideType,
  );

  xynapseConfig.contextProviders = providers;
  localErrors.push(...contextErrors);

  // Trigger MCP server refreshes (Config is reloaded again once connected!)
  const mcpManager = MCPManagerSingleton.getInstance();

  const orgPolicy = PolicySingleton.getInstance().policy;
  if (orgPolicy?.policy?.allowMcpServers === false) {
    await mcpManager.shutdown();
  } else {
    const mcpOptions: InternalMcpOptions[] = (config.mcpServers ?? []).map(
      (server) =>
        convertYamlMcpConfigToInternalMcpOptions(server, config.requestOptions),
    );
    const { errors: jsonMcpErrors, mcpServers } = await loadJsonMcpConfigs(
      ide,
      true,
      config.requestOptions,
    );
    localErrors.push(...jsonMcpErrors);
    mcpOptions.push(...mcpServers);
    mcpManager.setConnections(mcpOptions, false, { ide });
  }

  return { config: xynapseConfig, errors: localErrors };
}

export async function loadXynapseConfigFromYaml(options: {
  ide: IDE;
  ideSettings: IdeSettings;
  ideInfo: IdeInfo;
  uniqueId: string;
  llmLogger: ILLMLogger;
  workOsAccessToken: string | undefined;
  overrideConfigYaml: AssistantUnrolled | undefined;
  controlPlaneClient: ControlPlaneClient;
  orgScopeId: string | null;
  packageIdentifier: PackageIdentifier;
}): Promise<ConfigResult<XynapseConfig>> {
  const {
    ide,
    ideSettings,
    ideInfo,
    uniqueId,
    llmLogger,
    workOsAccessToken,
    overrideConfigYaml,
    controlPlaneClient,
    orgScopeId,
    packageIdentifier,
  } = options;

  const configYamlResult = await loadConfigYaml({
    overrideConfigYaml,
    controlPlaneClient,
    orgScopeId,
    ideSettings,
    ide,
    packageIdentifier,
  });

  if (!configYamlResult.config || configYamlResult.configLoadInterrupted) {
    return {
      errors: configYamlResult.errors,
      config: undefined,
      configLoadInterrupted: true,
    };
  }

  const { config: xynapseConfig, errors: localErrors } =
    await configYamlToXynapseConfig({
      config: configYamlResult.config,
      ide,
      ideInfo,
      uniqueId,
      llmLogger,
      workOsAccessToken,
    });

  // Apply shared config
  // TODO: override several of these values with user/org shared config
  // Don't try catch this - has security implications and failure should be fatal
  const sharedConfig = new GlobalContext().getSharedConfig();
  const withShared = modifyAnyConfigWithSharedConfig(
    xynapseConfig,
    sharedConfig,
  );
  if (withShared.allowAnonymousTelemetry === undefined) {
    withShared.allowAnonymousTelemetry = true;
  }

  return {
    config: withShared,
    errors: [...(configYamlResult.errors ?? []), ...localErrors],
    configLoadInterrupted: false,
  };
}
