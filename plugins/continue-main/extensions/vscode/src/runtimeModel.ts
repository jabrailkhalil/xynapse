import { PublicError } from "../../../core/util/publicError";

type Model = Record<string, any>;
export type RuntimeModelRequest = {
  modelTitle?: string;
  model?: string;
  provider?: string;
};
const providerName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
export function toYandexOpenAiModelUri(
  model: string,
  folder: string,
): string | undefined {
  if (/\s|[{}$]/.test(model + folder)) return undefined;
  const uri =
    model.startsWith("gpt:///") && folder
      ? `gpt://${folder}/${model.slice(7)}`
      : model.startsWith("gpt://")
        ? model
        : folder
          ? `gpt://${folder}/${model}${model.includes("/") ? "" : "/latest"}`
          : undefined;
  return uri && /^gpt:\/\/[A-Za-z0-9_-]+\/[^/]+\/.+/.test(uri)
    ? uri
    : undefined;
}
const environmentKeys = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "YANDEX_API_KEY",
  "YANDEX_BASE_URL",
  "YANDEX_FOLDER_ID",
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "DASHSCOPE_API_KEY",
  "DASHSCOPE_BASE_URL",
] as const;

function field(value: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof value !== "string") return "";
  let resolved = value.trim();
  const alias = resolved.match(
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/,
  );
  if (alias) resolved = env[alias[1] ?? alias[2]] ?? "";
  if (/\$\{|\$[A-Za-z_]|[{}]/.test(resolved) || (alias && !resolved)) {
    throw new PublicError(
      "The selected model contains an unresolved secret or environment reference. Configure that value before running the model.",
    );
  }
  return resolved;
}

function modelsFromConfig(config: Model): Model[] {
  return [
    ...new Set<Model>(
      [
        ...Object.values(config.selectedModelByRole ?? {}),
        ...(config.models ?? []),
        ...Object.values(config.modelsByRole ?? {}).flatMap((value) =>
          Array.isArray(value) ? value : [],
        ),
      ].filter((value) => value && typeof value === "object") as Model[],
    ),
  ];
}

/** Build the route and its credentials from the SAME resolved, selected model. */
export function planResolvedRuntimeModel(
  config: Model,
  request: RuntimeModelRequest = {},
  override?: string,
  inherited: NodeJS.ProcessEnv = process.env,
): { model: string; env: Record<string, string>; label: string } | undefined {
  const models = modelsFromConfig(config);
  const requestedProvider = providerName(request.provider);
  const matches = (model: Model) =>
    (!request.modelTitle ||
      model.title === request.modelTitle ||
      model.name === request.modelTitle ||
      model.model === request.modelTitle) &&
    (!request.model ||
      model.model === request.model ||
      model.title === request.model) &&
    (!requestedProvider ||
      providerName(model.providerName ?? model.provider) === requestedProvider);
  const explicit = Boolean(
    request.modelTitle || request.model || requestedProvider,
  );
  const selected = explicit
    ? models.find(matches)
    : (config.selectedModelByRole?.chat ??
      config.selectedModelByRole?.edit ??
      config.modelsByRole?.chat?.[0] ??
      models[0]);
  if (explicit && !selected)
    throw new PublicError(
      "The requested model is unavailable in the active configuration. Select an available model and try again.",
    );
  if (!selected) return undefined;
  const provider = providerName(selected.providerName ?? selected.provider);
  const modelName = field(selected.model, inherited);
  const key = field(selected.actualApiKey ?? selected.apiKey, inherited);
  const base = field(selected.apiBase ?? selected.baseUrl, inherited);
  const folder = field(
    selected.folderId ?? selected.requestOptions?.extraBodyProperties?.folderId,
    inherited,
  );
  // Avoid inheriting credentials belonging to an unrelated configured model.
  const env: Record<string, string> = Object.fromEntries(
    environmentKeys.map((name) => [name, ""]),
  );
  const credentials = (prefix: string, defaultBase: string) => {
    env[`${prefix}_API_KEY`] =
      key || field(inherited[`${prefix}_API_KEY`], inherited);
    env[`${prefix}_BASE_URL`] = base || defaultBase;
  };
  let route: string | undefined;
  if (provider.includes("yandex")) {
    const resolvedFolder =
      folder ||
      modelName.match(/^gpt:\/\/([^/]+)\//)?.[1] ||
      field(inherited.YANDEX_FOLDER_ID, inherited);
    if (!resolvedFolder || !/^[A-Za-z0-9_-]+$/.test(resolvedFolder))
      throw new PublicError(
        "Yandex Cloud folder ID is missing or invalid. Configure the selected model's folder.",
      );
    const uri = modelName.startsWith("gpt://")
      ? modelName
      : `gpt://${resolvedFolder}/${modelName}${modelName.includes("/") ? "" : "/latest"}`;
    if (!uri.startsWith(`gpt://${resolvedFolder}/`))
      throw new PublicError(
        "The Yandex model URI and configured folder do not match.",
      );
    route = `yandex/${uri}`;
    credentials("YANDEX", "https://ai.api.cloud.yandex.net/v1");
    env.YANDEX_FOLDER_ID = resolvedFolder;
  } else if (provider.includes("anthropic")) {
    route = modelName;
    credentials("ANTHROPIC", "https://api.anthropic.com");
    if (!env.ANTHROPIC_API_KEY)
      env.ANTHROPIC_AUTH_TOKEN = field(
        inherited.ANTHROPIC_AUTH_TOKEN,
        inherited,
      );
  } else if (provider.includes("openai") || provider.includes("deepseek")) {
    route = /^(?:openai\/|gpt-|o[134])/.test(modelName)
      ? modelName
      : `openai/${modelName}`;
    credentials(
      "OPENAI",
      provider.includes("deepseek")
        ? "https://api.deepseek.com/v1"
        : "https://api.openai.com/v1",
    );
  } else if (provider === "xai" || provider === "grok") {
    route = /^grok[/-]/.test(modelName) ? modelName : `grok/${modelName}`;
    credentials("XAI", "https://api.x.ai/v1");
  } else if (["dashscope", "qwen", "kimi"].includes(provider)) {
    route = /^(qwen|kimi)[/-]/.test(modelName)
      ? modelName
      : `${provider === "kimi" ? "kimi" : "qwen"}/${modelName}`;
    credentials(
      "DASHSCOPE",
      provider === "kimi"
        ? "https://api.moonshot.cn/v1"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
  }
  if (!route) return undefined;
  if (override) {
    const candidate = field(override, inherited);
    // An override must not silently move a selected model's credentials to another provider.
    const family = (value: string) =>
      value.startsWith("yandex/")
        ? "yandex"
        : value.startsWith("grok")
          ? "xai"
          : /^(qwen|kimi)[/-]/.test(value)
            ? "dashscope"
            : /^(openai\/|gpt-|o[134])/.test(value)
              ? "openai"
              : "anthropic";
    if (family(candidate) !== family(route))
      throw new PublicError(
        "The runtime model override uses a different provider. Select a matching model or clear the override.",
      );
    route = candidate;
  }
  if (!modelName || /\s|[{}$]/.test(route))
    throw new PublicError(
      "The selected runtime model identifier is invalid. Check its model name and resolved references.",
    );
  for (const [name, value] of Object.entries(env)) {
    if (name.endsWith("BASE_URL") && value) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new PublicError("The selected provider endpoint is invalid.");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new PublicError(
          "Use an HTTP(S) model endpoint without embedded credentials.",
        );
    }
  }
  return {
    model: route,
    env,
    label: String(selected.title ?? selected.name ?? modelName),
  };
}
