import fs from "fs";
import { randomUUID } from "crypto";
import * as JSONC from "comment-json";
import YAML from "yaml";

export const YANDEX_CLOUD_API_BASE = "https://ai.api.cloud.yandex.net/v1";

export interface YandexCloudCredentials {
  apiKey: string;
  folderId: string;
}

export interface YandexCloudModel {
  id: string;
  name: string;
}

export type YandexCloudImportResult =
  | {
      ok: true;
      added: number;
      updated: number;
      models: YandexCloudModel[];
      warning?: string;
    }
  | { ok: false; message: string };

class YandexCloudError extends Error {}

const modelDetails: Record<string, [string, number]> = {
  "yandexgpt-5-pro": ["YandexGPT Pro 5", 32768],
  "yandexgpt-5.1": ["YandexGPT Pro 5.1", 32768],
  "yandexgpt-5-lite": ["YandexGPT Lite 5", 32768],
  "aliceai-llm": ["Alice AI LLM", 131072],
  "aliceai-llm-flash": ["Alice AI LLM Flash", 65536],
  "deepseek-v4-flash": ["DeepSeek V4 Flash", 1048576],
  "qwen3-235b-a22b-fp8": ["Qwen3 235B", 262144],
  "qwen3.6-35b-a3b": ["Qwen3.6 35B", 262144],
  "gpt-oss-120b": ["GPT-OSS 120B", 131072],
  "gpt-oss-20b": ["GPT-OSS 20B", 131072],
};

export function validateYandexCredentials(
  input: YandexCloudCredentials,
): YandexCloudCredentials {
  const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
  const folderId =
    typeof input?.folderId === "string" ? input.folderId.trim() : "";
  if (!apiKey || /[\s${}]/.test(apiKey)) {
    throw new YandexCloudError("Enter a valid Yandex Cloud API key.");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    throw new YandexCloudError("Enter the Folder ID from Yandex Cloud.");
  }
  return { apiKey, folderId };
}

/** Keep the exact API model revision; embeddings and other non-chat models are excluded. */
export function parseYandexModels(
  payload: unknown,
  folderId: string,
): YandexCloudModel[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !Array.isArray((payload as any).data)
  ) {
    throw new YandexCloudError(
      "Yandex Cloud returned an invalid model list. Try again.",
    );
  }
  const ids = new Set<string>();
  for (const item of (payload as { data: unknown[] }).data) {
    if (
      !item ||
      typeof item !== "object" ||
      !("id" in item) ||
      typeof item.id !== "string"
    )
      continue;
    const match = /^gpt:\/\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.@/-]+)$/.exec(
      item.id,
    );
    if (match?.[1] === folderId) ids.add(match[2]);
  }
  return [...ids].sort().map((id) => {
    const [base, ...revision] = id.split("/");
    const label = modelDetails[base]?.[0] ?? base;
    return {
      id,
      name:
        revision.join("/") === "latest"
          ? label
          : `${label} (${revision.join("/") || "default"})`,
    };
  });
}

export async function listYandexCloudModels(
  credentials: YandexCloudCredentials,
  fetcher: typeof fetch = fetch,
): Promise<YandexCloudModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetcher(`${YANDEX_CLOUD_API_BASE}/models`, {
      headers: {
        Authorization: `Api-Key ${credentials.apiKey}`,
        "x-folder-id": credentials.folderId,
        "x-project": credentials.folderId,
      },
      signal: controller.signal,
      redirect: "error",
    });
    if (response.status === 401)
      throw new YandexCloudError(
        "Yandex Cloud rejected the API key. Check it and try again.",
      );
    if (response.status === 403)
      throw new YandexCloudError(
        "Access denied. Check the Folder ID, the ai.languageModels.user role, and the yc.ai.models.viewer key scope.",
      );
    if (response.status === 429)
      throw new YandexCloudError(
        "Yandex Cloud rate limit reached. Try again shortly.",
      );
    if (!response.ok)
      throw new YandexCloudError(
        "Yandex Cloud could not list models. Try again later.",
      );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new YandexCloudError(
        "Yandex Cloud returned an invalid model list. Try again.",
      );
    }
    return parseYandexModels(payload, credentials.folderId);
  } catch (error) {
    // Never expose transport errors, request headers, or response bodies.
    if (error instanceof YandexCloudError) throw error;
    throw new YandexCloudError(
      controller.signal.aborted
        ? "Yandex Cloud connection timed out. Try again."
        : "Could not connect to Yandex Cloud. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function matchesModel(
  existing: any,
  model: YandexCloudModel,
  folderId: string,
): boolean {
  if (!existing || !String(existing.provider ?? "").includes("yandex"))
    return false;
  const uri = /^gpt:\/\/([^/]+)\/(.+)$/.exec(existing.model ?? "");
  const existingFolder =
    uri?.[1] ??
    existing.folderId ??
    existing.requestOptions?.extraBodyProperties?.folderId;
  const id = uri?.[2] ?? existing.model;
  return (
    existingFolder === folderId &&
    (id?.includes("/") ? id : `${id}/latest`) === model.id
  );
}

/** One atomic local write for the whole import, with no changes to unrelated providers. */
export function saveYandexCloudModels(
  configPath: string,
  credentials: YandexCloudCredentials,
  models: YandexCloudModel[],
) {
  const isYaml = /\.ya?ml$/i.test(configPath);
  const source = fs.readFileSync(configPath, "utf8");
  const doc = isYaml ? YAML.parseDocument(source) : undefined;
  if (doc?.errors.length)
    throw new YandexCloudError("Invalid local configuration");
  const config = doc ? doc.toJSON() : JSONC.parse(source);
  if (
    !config ||
    typeof config !== "object" ||
    (config.models !== undefined && !Array.isArray(config.models))
  )
    throw new YandexCloudError("Invalid local configuration");
  const entries: any[] = [...(config.models ?? [])];
  const titleKey = isYaml ? "name" : "title";
  let added = 0;
  let updated = 0;
  const imported: YandexCloudModel[] = [];
  for (const model of models) {
    const index = entries.findIndex((entry) =>
      matchesModel(entry, model, credentials.folderId),
    );
    const old = index >= 0 ? entries[index] : undefined;
    let name = old?.[titleKey] || model.name;
    if (!old) {
      const baseName = name;
      let suffix = 2;
      while (entries.some((entry) => entry?.[titleKey] === name))
        name = `${baseName} (Yandex Cloud ${suffix++})`;
    }
    const contextLength = modelDetails[model.id.split("/")[0]]?.[1] ?? 8192;
    const entry = {
      ...old,
      [titleKey]: name,
      provider: "yandex_gpt",
      model: `gpt://${credentials.folderId}/${model.id}`,
      apiBase: YANDEX_CLOUD_API_BASE,
      // Local literal values are also supported by the native runtime's raw-config path.
      apiKey: credentials.apiKey,
      requestOptions: {
        ...old?.requestOptions,
        extraBodyProperties: {
          ...old?.requestOptions?.extraBodyProperties,
          folderId: credentials.folderId,
        },
      },
      ...(isYaml
        ? {
            roles: [
              ...new Set([...(old?.roles ?? []), "chat", "edit", "apply"]),
            ],
            defaultCompletionOptions: {
              contextLength,
              ...old?.defaultCompletionOptions,
            },
          }
        : { contextLength: old?.contextLength ?? contextLength }),
    };
    if (old?.folderId !== undefined) entry.folderId = credentials.folderId;
    if (index >= 0) {
      entries[index] = entry;
      updated++;
    } else {
      entries.push(entry);
      added++;
    }
    imported.push({ id: model.id, name });
  }
  let output: string;
  if (doc) {
    doc.set("models", entries);
    output = doc.toString();
  } else {
    config.models = entries;
    output = JSONC.stringify(config, null, 2);
  }
  const temporary = `${configPath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, output, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, configPath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return { added, updated, models: imported };
}

export async function importYandexCloudModels(
  input: YandexCloudCredentials,
  getConfigPath: () => string,
  fetcher: typeof fetch = fetch,
): Promise<YandexCloudImportResult> {
  let credentials: YandexCloudCredentials;
  try {
    credentials = validateYandexCredentials(input);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  let models: YandexCloudModel[];
  try {
    models = await listYandexCloudModels(credentials, fetcher);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (!models.length)
    return {
      ok: false,
      message:
        "No chat models are available in this folder. Check the Folder ID and API key permissions.",
    };
  try {
    return {
      ok: true,
      ...saveYandexCloudModels(getConfigPath(), credentials, models),
    };
  } catch {
    return {
      ok: false,
      message:
        "Could not save the local configuration. Check its syntax and file permissions, then try again.",
    };
  }
}
