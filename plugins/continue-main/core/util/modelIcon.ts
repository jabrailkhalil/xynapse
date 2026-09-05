/** Model branding takes precedence over the hosting provider and API protocol. */
export function getModelIcon(
  model?: string,
  provider?: string,
): string | undefined {
  const id = (model ?? "")
    .toLowerCase()
    .replace(/^(?:yandex\/)?gpt:\/\/[^/]+\//, "");
  const families: [RegExp, string][] = [
    [/deepseek/, "deepseek.png"],
    [/qwen|qwq/, "qwen.png"],
    [/yandex|aliceai|alice-ai/, "yandexgpt.png"],
    [/gigachat/, "gigachat.png"],
    [/claude/, "anthropic.png"],
    [/gemini|gemma/, "gemini.png"],
    [/mistral|mixtral|codestral|devstral/, "mistral.png"],
    [/llama/, "meta.png"],
    [/kimi|moonshot/, "moonshot.png"],
    [/grok/, "xAI.png"],
    [/(^|\/)(gpt-|o[134](?:-|$))/, "openai.png"],
  ];
  const match = families.find(([pattern]) => pattern.test(id));
  if (match) return match[1];
  const providers: Record<string, string> = {
    yandex_gpt: "yandexgpt.png",
    yandexgpt: "yandexgpt.png",
    yandex: "yandexgpt.png",
    deepseek: "deepseek.png",
    qwen: "qwen.png",
    anthropic: "anthropic.png",
    gemini: "gemini.png",
    gigachat: "gigachat.png",
    mistral: "mistral.png",
    ollama: "ollama.png",
    lmstudio: "lmstudio.png",
  };
  return providers[(provider ?? "").toLowerCase()];
}
