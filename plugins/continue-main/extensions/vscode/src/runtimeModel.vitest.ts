import { describe, expect, it } from "vitest";
import { planResolvedRuntimeModel } from "./runtimeModel";

const yandex = {
  providerName: "yandex_gpt",
  title: "Yandex",
  model: "gpt://test-folder/deepseek-v4-flash/latest",
  actualApiKey: "test-selected-key",
  folderId: "test-folder",
  apiBase: "https://ai.api.cloud.yandex.net/v1",
};
const openai = {
  providerName: "openai",
  title: "OpenAI",
  model: "gpt-test",
  apiKey: "test-openai-key",
  apiBase: "https://example.test/v1",
};
const config = (selected = yandex, models: unknown[] = [yandex, openai]) => ({
  selectedModelByRole: { chat: selected },
  modelsByRole: { chat: models },
});

describe("resolved native model planning", () => {
  it("uses the selected resolved model and replaces inherited credentials", () => {
    const result = planResolvedRuntimeModel(
      config(),
      { modelTitle: "Yandex" },
      undefined,
      {
        YANDEX_API_KEY: "test-stale-key",
        OPENAI_API_KEY: "test-unrelated-key",
        YANDEX_BASE_URL: "https://old.test",
      },
    );
    expect(result?.model).toBe(
      "yandex/gpt://test-folder/deepseek-v4-flash/latest",
    );
    expect(result?.env.YANDEX_API_KEY).toBe("test-selected-key");
    expect(result?.env.YANDEX_BASE_URL).toBe(yandex.apiBase);
    expect(result?.env.OPENAI_API_KEY).toBe("");
  });
  it("keeps different keys for two models of the same provider", () => {
    const second = {
      ...yandex,
      title: "Second",
      actualApiKey: "test-second-key",
      folderId: "second-folder",
      model: "gpt://second-folder/qwen/latest",
    };
    const result = planResolvedRuntimeModel(config(yandex, [yandex, second]), {
      modelTitle: "Second",
    });
    expect(result?.env.YANDEX_API_KEY).toBe("test-second-key");
    expect(result?.env.YANDEX_FOLDER_ID).toBe("second-folder");
  });
  it("uses provider identity when model labels collide", () => {
    const sameTitle = { ...openai, title: "Yandex" };
    const result = planResolvedRuntimeModel(
      config(yandex, [yandex, sameTitle]),
      { modelTitle: "Yandex", provider: "openai" },
    );
    expect(result?.env.OPENAI_API_KEY).toBe("test-openai-key");
    expect(result?.env.YANDEX_API_KEY).toBe("");
  });
  for (const patch of [
    { model: "gpt://${{ secrets.YANDEX_FOLDER_ID }}/deepseek/latest" },
    { actualApiKey: "${{ secrets.YANDEX_API_KEY }}" },
    { folderId: "$MISSING_FOLDER" },
    { apiBase: "https://user:test-password@example.test/v1" },
  ]) {
    it("rejects unresolved or unsafe config without echoing its contents", () => {
      const selected = { ...yandex, ...patch };
      expect(() =>
        planResolvedRuntimeModel(
          config(selected, [selected]),
          {},
          undefined,
          {},
        ),
      ).toThrow();
    });
  }
  it("resolves explicitly requested environment aliases", () => {
    const selected = { ...yandex, actualApiKey: "$AUDIT_API_KEY" };
    expect(
      planResolvedRuntimeModel(config(selected), {}, undefined, {
        AUDIT_API_KEY: "test-resolved",
      })?.env.YANDEX_API_KEY,
    ).toBe("test-resolved");
  });
  it("does not silently substitute an unavailable model", () => {
    expect(() =>
      planResolvedRuntimeModel(config(), { modelTitle: "Missing" }),
    ).toThrow("unavailable");
  });
  it("does not substitute another provider for an unsupported selected model", () => {
    expect(
      planResolvedRuntimeModel({
        selectedModelByRole: {
          chat: { providerName: "gigachat", model: "GigaChat" },
        },
        modelsByRole: { chat: [yandex] },
      }),
    ).toBeUndefined();
  });
  it("rejects a runtime override that changes providers", () => {
    expect(() =>
      planResolvedRuntimeModel(config(), {}, "openai/gpt-test"),
    ).toThrow("different provider");
  });
  it("rejects mismatched folder metadata", () => {
    const selected = { ...yandex, folderId: "other-folder" };
    expect(() => planResolvedRuntimeModel(config(selected))).toThrow(
      "do not match",
    );
  });
});
