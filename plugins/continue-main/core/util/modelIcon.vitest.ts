import { describe, expect, it } from "vitest";
import { getModelIcon } from "./modelIcon";

describe("model family branding", () => {
  it.each([
    [
      "gpt://test-folder/deepseek-v4-flash/latest",
      "yandex_gpt",
      "deepseek.png",
    ],
    [
      "yandex/gpt://test-folder/qwen3.6-35b-a3b/latest",
      "yandex_gpt",
      "qwen.png",
    ],
    ["gpt://test-folder/aliceai-llm/latest", "openai", "yandexgpt.png"],
    ["gpt://test-folder/yandexgpt-5-pro/latest", "openai", "yandexgpt.png"],
    ["gpt://test-folder/gpt-oss-120b/latest", "yandex_gpt", "openai.png"],
    ["qwen/qwen3", "openai", "qwen.png"],
    ["claude-sonnet", "openrouter", "anthropic.png"],
    ["gemini-2.5-pro", "openai", "gemini.png"],
    ["gpt-4o", "openai", "openai.png"],
    ["custom-model", "openai", undefined],
    ["gpt://test-folder/custom-model/latest", "openai", undefined],
  ])("%s on %s has the correct icon", (model, provider, icon) => {
    expect(getModelIcon(model, provider)).toBe(icon);
  });
});
