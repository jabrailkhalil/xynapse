import {
  ConfigYaml,
  ModelConfig,
  validateConfigYaml,
} from "@xynapse/config-yaml";
import { describe, expect, test } from "vitest";
import { setupProviderConfig } from "./onboarding";

const EMPTY_CONFIG: ConfigYaml = {
  name: "Test config",
  version: "1.0.0",
  schema: "v1",
  models: [],
};

const YANDEX_MODELS = [
  "yandexgpt-5-pro",
  "yandexgpt-5.1",
  "yandexgpt-5-lite",
  "aliceai-llm",
  "aliceai-llm-flash",
  "deepseek-v4-flash",
  "qwen3-235b-a22b-fp8",
  "qwen3.6-35b-a3b",
  "gpt-oss-120b",
  "gpt-oss-20b",
] as const;

function directModels(config: ConfigYaml) {
  return (config.models ?? []).filter(
    (model): model is ModelConfig => "provider" in model,
  );
}

describe("Yandex onboarding configuration", () => {
  const configured = setupProviderConfig(
    EMPTY_CONFIG,
    "yandex_gpt",
    "test-api-key",
    "test-folder",
  );
  const models = directModels(configured);

  test("adds the complete verified model catalog", () => {
    expect(models).toHaveLength(YANDEX_MODELS.length);
    expect(models.map((model) => model.model)).toEqual(YANDEX_MODELS);
  });

  test.each(YANDEX_MODELS)(
    "configures %s with credentials and folder",
    (id) => {
      const model = models.find((candidate) => candidate.model === id);
      expect(model).toMatchObject({
        provider: "yandex_gpt",
        apiKey: "test-api-key",
        requestOptions: {
          extraBodyProperties: { folderId: "test-folder" },
        },
      });
      expect(model).not.toHaveProperty("folderId");
    },
  );

  test("produces schema-valid YAML configuration", () => {
    expect(validateConfigYaml(configured)).toEqual([]);
  });

  test("supports the historical API_KEY:FOLDER_ID input", () => {
    const result = setupProviderConfig(
      EMPTY_CONFIG,
      "yandexgpt",
      "legacy-key:legacy-folder",
    );
    expect(directModels(result)[0]).toMatchObject({
      apiKey: "legacy-key",
      requestOptions: {
        extraBodyProperties: { folderId: "legacy-folder" },
      },
    });
  });

  test("prefers an explicit folder over a folder bundled with the key", () => {
    const result = setupProviderConfig(
      EMPTY_CONFIG,
      "yandex_gpt",
      "key:bundled-folder",
      "explicit-folder",
    );
    expect(directModels(result)[0].requestOptions?.extraBodyProperties).toEqual(
      {
        folderId: "explicit-folder",
      },
    );
  });

  test("keeps pre-existing models", () => {
    const existing: ConfigYaml = {
      ...EMPTY_CONFIG,
      models: [
        {
          name: "Local model",
          provider: "ollama",
          model: "qwen2.5-coder",
        },
      ],
    };
    const result = setupProviderConfig(existing, "yandex_gpt", "key", "folder");
    expect(directModels(result)[0]).toMatchObject({ provider: "ollama" });
    expect(directModels(result)).toHaveLength(YANDEX_MODELS.length + 1);
  });

  test("rejects unknown providers instead of writing a broken config", () => {
    expect(() =>
      setupProviderConfig(EMPTY_CONFIG, "not-a-provider", "key"),
    ).toThrow("Unknown provider");
  });
});
