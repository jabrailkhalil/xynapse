import { ConfigYaml } from "@xynapse/config-yaml";

export const XYNAPSE_YANDEX_API_KEY = process.env.XYNAPSE_YANDEX_API_KEY || "";
export const XYNAPSE_YANDEX_FOLDER_ID =
  process.env.XYNAPSE_YANDEX_FOLDER_ID || "";
const hasBundledYandexCredentials =
  XYNAPSE_YANDEX_API_KEY.trim() !== "" &&
  XYNAPSE_YANDEX_FOLDER_ID.trim() !== "";

export const defaultConfig: ConfigYaml = {
  name: "Xynapse Config",
  version: "1.0.0",
  schema: "v1",
  models: hasBundledYandexCredentials
    ? [
        // ===== Native Yandex/Alice models =====
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
          name: "YandexGPT Pro 5.1",
          provider: "yandex_gpt",
          model: "yandexgpt-5.1",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["chat"],
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
          name: "Alice AI LLM",
          provider: "yandex_gpt",
          model: "aliceai-llm",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["chat"],
          defaultCompletionOptions: {
            contextLength: 131072,
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
          name: "Alice AI LLM Flash",
          provider: "yandex_gpt",
          model: "aliceai-llm-flash",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["chat"],
          defaultCompletionOptions: {
            contextLength: 65536,
            temperature: 0.3,
            maxTokens: 8192,
          },
          requestOptions: {
            extraBodyProperties: {
              folderId: XYNAPSE_YANDEX_FOLDER_ID,
            },
          },
        },
        // ===== Third-party models on Yandex Cloud =====
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
          name: "Qwen3 235B",
          provider: "yandex_gpt",
          model: "qwen3-235b-a22b-fp8",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["chat", "summarize"],
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
        {
          name: "Qwen3.6 35B",
          provider: "yandex_gpt",
          model: "qwen3.6-35b-a3b",
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
        {
          name: "gpt-oss-120b",
          provider: "yandex_gpt",
          model: "gpt-oss-120b",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["chat", "edit"],
          defaultCompletionOptions: {
            contextLength: 131072,
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
          name: "gpt-oss-20b",
          provider: "yandex_gpt",
          model: "gpt-oss-20b",
          apiKey: XYNAPSE_YANDEX_API_KEY,
          roles: ["autocomplete"],
          defaultCompletionOptions: {
            contextLength: 131072,
            temperature: 0.1,
            maxTokens: 4096,
          },
          requestOptions: {
            extraBodyProperties: {
              folderId: XYNAPSE_YANDEX_FOLDER_ID,
            },
          },
        },
      ]
    : [],
};
