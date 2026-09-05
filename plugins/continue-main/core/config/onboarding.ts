import { ConfigYaml, ModelRole } from "@xynapse/config-yaml";
import { XYNAPSE_YANDEX_API_KEY, XYNAPSE_YANDEX_FOLDER_ID } from "./default";

export const LOCAL_ONBOARDING_PROVIDER_TITLE = "Ollama";
export const LOCAL_ONBOARDING_FIM_MODEL = "qwen2.5-coder:1.5b-base";
export const LOCAL_ONBOARDING_FIM_TITLE = "Qwen2.5-Coder 1.5B";
export const LOCAL_ONBOARDING_CHAT_MODEL = "llama3.1:8b";
export const LOCAL_ONBOARDING_CHAT_TITLE = "Llama 3.1 8B";
export const LOCAL_ONBOARDING_EMBEDDINGS_MODEL = "nomic-embed-text:latest";
export const LOCAL_ONBOARDING_EMBEDDINGS_TITLE = "Nomic Embed";

const ANTHROPIC_MODEL_CONFIG = {
  slugs: [],
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
    { name: "YandexGPT Pro 5", model: "yandexgpt-5-pro" },
    { name: "YandexGPT Pro 5.1", model: "yandexgpt-5.1" },
    { name: "YandexGPT Lite 5", model: "yandexgpt-5-lite" },
    { name: "Alice AI LLM", model: "aliceai-llm" },
    { name: "Alice AI LLM Flash", model: "aliceai-llm-flash" },
    { name: "DeepSeek V4 Flash", model: "deepseek-v4-flash" },
    { name: "Qwen3 235B", model: "qwen3-235b-a22b-fp8" },
    { name: "Qwen3.6 35B", model: "qwen3.6-35b-a3b" },
    { name: "gpt-oss-120b", model: "gpt-oss-120b" },
    { name: "gpt-oss-20b", model: "gpt-oss-20b" },
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
    (m) =>
      "provider" in m &&
      "apiKey" in m &&
      m.provider === "yandex_gpt" &&
      Boolean(m.apiKey),
  );

  if (hasYandexModel) {
    return { ...config, models: config.models };
  }

  return {
    ...config,
    models: [
      {
        name: "YandexGPT Pro 5",
        provider: "yandex_gpt",
        model: "yandexgpt-5-pro",
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["chat", "edit", "apply"],
        defaultCompletionOptions: {
          contextLength: 32768,
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
        name: "YandexGPT Lite 5",
        provider: "yandex_gpt",
        model: "yandexgpt-5-lite",
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["autocomplete"],
        defaultCompletionOptions: {
          contextLength: 32768,
          temperature: 0.1,
          maxTokens: 2048,
        },
        requestOptions: {
          extraBodyProperties: {
            folderId: XYNAPSE_YANDEX_FOLDER_ID,
          },
        },
      },
      {
        name: "DeepSeek V4 Flash",
        provider: "yandex_gpt",
        model: "deepseek-v4-flash",
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["chat", "edit", "apply"],
        defaultCompletionOptions: {
          contextLength: 1048576,
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
        name: "Qwen3.6 35B",
        provider: "yandex_gpt",
        model: `gpt://${XYNAPSE_YANDEX_FOLDER_ID}/qwen3.6-35b-a3b`,
        apiKey: XYNAPSE_YANDEX_API_KEY,
        roles: ["chat", "edit"],
        defaultCompletionOptions: {
          contextLength: 262144,
          temperature: 0.3,
          maxTokens: 8192,
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
  let newModels: NonNullable<ConfigYaml["models"]>;

  const isYandexProvider =
    provider === "yandex_gpt" || provider === "yandexgpt";
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
    case "yandexgpt": {
      const yandexFolderId = normalizedFolderId || XYNAPSE_YANDEX_FOLDER_ID;
      newModels = YANDEXGPT_MODEL_CONFIG.models.map((modelConfig) => {
        const roles: ModelRole[] = modelConfig.model.includes("lite")
          ? ["autocomplete"]
          : ["chat", "edit", "apply"];
        return {
          name: modelConfig.name,
          provider: YANDEXGPT_MODEL_CONFIG.provider,
          model: modelConfig.model,
          apiKey: normalizedApiKey,
          requestOptions: {
            extraBodyProperties: {
              folderId: yandexFolderId,
            },
          },
          roles,
        };
      });
      break;
    }
    case "gigachat":
      newModels = GIGACHAT_MODEL_CONFIG.models.map((modelConfig) => {
        const roles: ModelRole[] = ["chat", "edit", "apply"];
        return {
          name: modelConfig.name,
          provider: GIGACHAT_MODEL_CONFIG.provider,
          model: modelConfig.model,
          apiKey: normalizedApiKey,
          roles,
        };
      });
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    ...config,
    models: [...(config.models ?? []), ...newModels],
  };
}
