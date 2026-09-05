import fs from "fs";
import os from "os";
import path from "path";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importYandexCloudModels,
  parseYandexModels,
  YANDEX_CLOUD_API_BASE,
} from "./yandexCloud";

const credentials = { apiKey: "test-only-api-key", folderId: "test-folder" };
const directories: string[] = [];
function configFile(
  content = "name: Local\nversion: 1.0.0\nschema: v1\nmodels: []\n",
  extension = "yaml",
) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "xynapse-yandex-test-"),
  );
  directories.push(directory);
  const file = path.join(directory, `config.${extension}`);
  fs.writeFileSync(file, content);
  return file;
}
const ids = ["deepseek-v4-flash/latest", "qwen3.6-35b-a3b/latest"];
function modelsFetch(modelIds = ids) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          data: modelIds.map((id) => ({
            id: `gpt://${credentials.folderId}/${id}`,
          })),
        }),
      ),
    );
}
afterEach(() => {
  for (const directory of directories.splice(0)) {
    // Only remove absolute temporary directories created by this test.
    if (
      path.dirname(directory) !== os.tmpdir() ||
      !path.basename(directory).startsWith("xynapse-yandex-test-")
    )
      throw new Error("Invalid test directory");
    fs.rmSync(directory, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

describe("Yandex Cloud bulk import", () => {
  it("keeps exact chat revisions, removes duplicate IDs and ignores other folders and modalities", () => {
    const payload = {
      data: [
        { id: "gpt://test-folder/qwen3.6-35b-a3b/latest" },
        { id: "gpt://test-folder/qwen3.6-35b-a3b/latest" },
        { id: "gpt://test-folder/custom-model/rc" },
        { id: "gpt://another-folder/private/latest" },
        { id: "emb://test-folder/text-embeddings/latest" },
        { id: "gpt://test-folder/invalid model/latest" },
        null,
      ],
    };
    expect(parseYandexModels(payload, credentials.folderId)).toEqual([
      { id: "custom-model/rc", name: "custom-model (rc)" },
      { id: "qwen3.6-35b-a3b/latest", name: "Qwen3.6 35B" },
    ]);
  });

  it("imports all discovered chat models with credentials and URIs usable by the native runtime", async () => {
    const file = configFile();
    const fetcher = modelsFetch();
    const result = await importYandexCloudModels(
      credentials,
      () => file,
      fetcher,
    );
    expect(result).toMatchObject({ ok: true, added: 2, updated: 0 });
    expect(fetcher).toHaveBeenCalledWith(
      `${YANDEX_CLOUD_API_BASE}/models`,
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: `Api-Key ${credentials.apiKey}`,
          "x-folder-id": credentials.folderId,
        }),
      }),
    );
    const saved = YAML.parse(fs.readFileSync(file, "utf8"));
    expect(saved.models).toHaveLength(2);
    for (const model of saved.models) {
      expect(model.apiKey).toBe(credentials.apiKey);
      expect(model.apiBase).toBe(YANDEX_CLOUD_API_BASE);
      expect(model.model).toMatch(/^gpt:\/\/test-folder\/[^\s${}]+\/latest$/);
      expect(model.roles).toEqual(["chat", "edit", "apply"]);
      expect(model.requestOptions.extraBodyProperties.folderId).toBe(
        credentials.folderId,
      );
    }
    expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(result)).not.toContain(credentials.folderId);
  });

  it("updates short IDs and rotates the key without duplicates or changing other models", async () => {
    const unrelated = {
      name: "Elsewhere",
      model: "deepseek-v4-flash",
      provider: "deepseek",
      apiKey: "unrelated-test-key",
    };
    const file = configFile(
      YAML.stringify({
        name: "Local",
        models: [
          unrelated,
          {
            name: "My coding model",
            provider: "yandexgpt",
            model: "deepseek-v4-flash",
            apiKey: "old-test-key",
            requestOptions: {
              timeout: 60000,
              extraBodyProperties: { folderId: credentials.folderId },
            },
            roles: ["summarize"],
            defaultCompletionOptions: { temperature: 0.2 },
          },
        ],
        rules: ["Keep this rule"],
      }),
    );
    await importYandexCloudModels(credentials, () => file, modelsFetch());
    const again = await importYandexCloudModels(
      { ...credentials, apiKey: "rotated-test-key" },
      () => file,
      modelsFetch(),
    );
    expect(again).toMatchObject({ ok: true, added: 0, updated: 2 });
    const saved = YAML.parse(fs.readFileSync(file, "utf8"));
    expect(saved.models).toHaveLength(3);
    expect(saved.models[0]).toEqual(unrelated);
    expect(saved.models[1]).toMatchObject({
      name: "My coding model",
      apiKey: "rotated-test-key",
      requestOptions: { timeout: 60000 },
      defaultCompletionOptions: { temperature: 0.2 },
      roles: ["summarize", "chat", "edit", "apply"],
    });
    expect(saved.rules).toEqual(["Keep this rule"]);
  });

  it("supports legacy JSON configuration and unique display names", async () => {
    const file = configFile(
      '{\n// User setting\n"models":[{"title":"DeepSeek V4 Flash","provider":"deepseek","model":"deepseek-chat"}],"allowAnonymousTelemetry":false\n}',
      "json",
    );
    await importYandexCloudModels(credentials, () => file, modelsFetch());
    const again = await importYandexCloudModels(
      credentials,
      () => file,
      modelsFetch(),
    );
    expect(again).toMatchObject({ ok: true, added: 0, updated: 2 });
    const saved = fs.readFileSync(file, "utf8");
    expect(saved).toContain("// User setting");
    expect(saved).toContain("DeepSeek V4 Flash (Yandex Cloud 2)");
    expect(saved).toContain('"allowAnonymousTelemetry": false');
  });

  it.each([401, 403, 429, 500])(
    "keeps config intact and hides response bodies for HTTP %s",
    async (status) => {
      const file = configFile();
      const before = fs.readFileSync(file, "utf8");
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(credentials.apiKey, { status }));
      const result = await importYandexCloudModels(
        credentials,
        () => file,
        fetcher,
      );
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    },
  );

  it.each(["invalid json", '{"data":[]}'])(
    "does not write on an empty or malformed API result",
    async (body) => {
      const getPath = vi.fn();
      const result = await importYandexCloudModels(
        credentials,
        getPath,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
      );
      expect(result.ok).toBe(false);
      expect(getPath).not.toHaveBeenCalled();
    },
  );

  it("does not leak a transport exception even if it starts with the provider name", async () => {
    const result = await importYandexCloudModels(
      credentials,
      vi.fn(),
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error(`Yandex Cloud ${credentials.apiKey}`)),
    );
    expect(result).toEqual({
      ok: false,
      message:
        "Could not connect to Yandex Cloud. Check your connection and try again.",
    });
  });

  it("rejects unresolved placeholders before any request", async () => {
    const fetcher = modelsFetch();
    const result = await importYandexCloudModels(
      { ...credentials, folderId: "${{ secrets.YANDEX_FOLDER_ID }}" },
      vi.fn(),
      fetcher,
    );
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves a malformed local config without exposing its contents", async () => {
    const source = `models: [\napiKey: ${credentials.apiKey}`;
    const file = configFile(source);
    const result = await importYandexCloudModels(
      credentials,
      () => file,
      modelsFetch(),
    );
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(credentials.apiKey);
    expect(fs.readFileSync(file, "utf8")).toBe(source);
  });

  it("stops a stalled request after the connection timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const pending = importYandexCloudModels(credentials, vi.fn(), fetcher);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toEqual({
      ok: false,
      message: "Yandex Cloud connection timed out. Try again.",
    });
  });
});
