import { ConfigYaml } from "@xynapse/config-yaml";
import { XYNAPSE_YANDEX_API_KEY, XYNAPSE_YANDEX_FOLDER_ID } from "./default";

export const LOCAL_ONBOARDING_PROVIDER_TITLE = "Ollama";
export const LOCAL_ONBOARDING_FIM_MODEL = "qwen2.5-coder:1.5b-base";
export const LOCAL_ONBOARDING_FIM_TITLE = "Qwen2.5-Coder 1.5B";
export const LOCAL_ONBOARDING_CHAT_MODEL = "llama3.1:8b";
export const LOCAL_ONBOARDING_CHAT_TITLE = "Llama 3.1 8B";
export const LOCAL_ONBOARDING_EMBEDDINGS_MODEL = "nomic-embed-text:latest";
export const LOCAL_ONBOARDING_EMBEDDINGS_TITLE = "Nomic Embed";

const ANTHROPIC_MODEL_CONFIG = {
  slugs: ["anthropic/claude-3-7-sonnet", "anthropic/claude-4-sonnet"],
  apiKeyInputName: "ANTHROPIC_API_KEY",
};
const OPENAI_MODEL_CONFIG = {
  slugs: ["openai/gpt-4.1", "openai/o3", "openai/gpt-4.1-mini"],
  apiKeyInputName: "OPENAI_API_KEY",
};

// TODO: These need updating on the hub
const GEMINI_MODEL_CONFIG = {
  slugs: ["google/gemini-2.5-pro", "google/gemini-2.0-flash"],
  apiKeyInputName: "GEMINI_API_KEY",
};
const YANDEXGPT_MODEL_CONFIG = {
  provider: "yandex_gpt",
  models: [
    { name: "YandexGPT", model: "yandexgpt" },
    { name: "YandexGPT Lite", model: "yandexgpt-lite" },
    { name: "YandexGPT Pro", model: "yandexgpt-pro" },
  ],
};
const GIGACHAT_MODEL_CONFIG = {
  provider: "gigachat",
  models: [
    { name: "GigaChat", model: "GigaChat" },
    { name: "GigaChat Plus", model: "GigaChat-Plus" },
    { name: "GigaChat Pro", model: "GigaChat-Pro" },
  ],
};

/**
 * We set the "best" chat + autocomplete models by default
 * whenever a user doesn't have a config.json
 * For Xynapse IDE, this pre-configures YandexGPT models
 */
export function setupBestConfig(config: ConfigYaml): ConfigYaml {
  const hasYandexModel = config.models?.some(
    (m) => m.provider === "yandex_gpt" && m.apiKey && m.apiKey !== "",
  );

  if (hasYandexModel) {
    return { ...config, models: config.models };
  }

  return {
    ...config,
    models: [
      {
        name: "YandexGPT Pro",
        provider: "yandex_gpt",
        model: "yandexgpt",
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["chat", "edit", "apply"],
        defaultCompletionOptions: {
          temperature: 0.3,
          maxTokens: 8192,
        },
        requestOptions: {
          extraBodyProperties: {
            folderId: XYNAPSE_YANDEX_FOLDER_ID,
          },
        },
      },
      {
        name: "YandexGPT Lite",
        provider: "yandex_gpt",
        model: "yandexgpt-lite",
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["autocomplete"],
        defaultCompletionOptions: {
          temperature: 0.1,
          maxTokens: 2048,
        },
        requestOptions: {
          extraBodyProperties: {
            folderId: XYNAPSE_YANDEX_FOLDER_ID,
          },
        },
      },
      ...(config.models ?? []),
    ],
  };
}

export function setupLocalConfig(config: ConfigYaml): ConfigYaml {
  return {
    ...config,
    models: [
      {
        name: LOCAL_ONBOARDING_CHAT_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_CHAT_MODEL,
        roles: ["chat", "edit", "apply"],
      },
      {
        name: LOCAL_ONBOARDING_FIM_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_FIM_MODEL,
        roles: ["autocomplete"],
      },
      {
        name: LOCAL_ONBOARDING_EMBEDDINGS_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_EMBEDDINGS_MODEL,
        roles: ["embed"],
      },
      ...(config.models ?? []),
    ],
  };
}

export function setupQuickstartConfig(config: ConfigYaml): ConfigYaml {
  return config;
}

export function setupProviderConfig(
  config: ConfigYaml,
  provider: string,
  apiKey: string,
  folderId?: string,
): ConfigYaml {
  let newModels;

  const isYandexProvider = provider === "yandex_gpt" || provider === "yandexgpt";
  let normalizedApiKey = apiKey;
  let normalizedFolderId = folderId?.trim();

  // Backward compatibility: allow "API_KEY:FOLDER_ID" in one field.
  if (isYandexProvider && !normalizedFolderId && apiKey.includes(":")) {
    const [rawApiKey, ...rawFolderIdParts] = apiKey.split(":");
    normalizedApiKey = rawApiKey.trim();
    normalizedFolderId = rawFolderIdParts.join(":").trim();
  }

  switch (provider) {
    case "openai":
      newModels = OPENAI_MODEL_CONFIG.slugs.map((slug) => ({
        uses: slug,
        with: {
          [OPENAI_MODEL_CONFIG.apiKeyInputName]: apiKey,
        },
      }));
      break;
    case "anthropic":
      newModels = ANTHROPIC_MODEL_CONFIG.slugs.map((slug) => ({
        uses: slug,
        with: {
          [ANTHROPIC_MODEL_CONFIG.apiKeyInputName]: apiKey,
        },
      }));
      break;
    case "gemini":
      newModels = GEMINI_MODEL_CONFIG.slugs.map((slug) => ({
        uses: slug,
        with: {
          [GEMINI_MODEL_CONFIG.apiKeyInputName]: apiKey,
        },
      }));
      break;
    case "yandex_gpt":
    case "yandexgpt":
      {
        const yandexFolderId = normalizedFolderId || XYNAPSE_YANDEX_FOLDER_ID;
        newModels = YANDEXGPT_MODEL_CONFIG.models.map((modelConfig) => ({
          name: modelConfig.name,
          provider: YANDEXGPT_MODEL_CONFIG.provider,
          model: modelConfig.model,
          apiKey: normalizedApiKey,
          folderId: yandexFolderId,
          requestOptions: {
            extraBodyProperties: {
              folderId: yandexFolderId,
            },
          },
          roles: modelConfig.model.includes("lite")
            ? ["autocomplete"]
            : ["chat", "edit", "apply"],
        }));
        break;
      }
    case "gigachat":
      newModels = GIGACHAT_MODEL_CONFIG.models.map((modelConfig) => ({
        name: modelConfig.name,
        provider: GIGACHAT_MODEL_CONFIG.provider,
        model: modelConfig.model,
        apiKey: normalizedApiKey,
        roles: ["chat", "edit", "apply"],
      }));
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    ...config,
    models: [...(config.models ?? []), ...newModels],
  };
}
