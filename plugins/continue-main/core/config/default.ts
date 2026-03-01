import { ConfigYaml } from "@xynapse/config-yaml";

export const XYNAPSE_YANDEX_API_KEY = "AQVN0pzR9Gww7IXeid0lIOUxDMHYa3TahQrVbgkp";
export const XYNAPSE_YANDEX_FOLDER_ID = "b1gv4m4vdn58mat55ggl";

export const defaultConfig: ConfigYaml = {
  name: "Xynapse Config",
  version: "1.0.0",
  schema: "v1",
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
    {
      name: "YandexGPT 32K",
      provider: "yandex_gpt",
      model: "yandexgpt-32k",
      apiKey: XYNAPSE_YANDEX_API_KEY,
      roles: ["summarize"],
      defaultCompletionOptions: {
        temperature: 0.3,
        maxTokens: 16384,
      },
      requestOptions: {
        extraBodyProperties: {
          folderId: XYNAPSE_YANDEX_FOLDER_ID,
        },
      },
    },
  ],
};
