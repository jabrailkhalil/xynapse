import { streamSse } from "@xynapse/fetch";
import {
  AssistantChatMessage,
  ChatMessage,
  CompletionOptions,
  LLMOptions,
} from "../../index.js";
import { BaseLLM } from "../index.js";
import { PublicError } from "../../util/publicError.js";
import { fromChatCompletionChunk } from "../openaiTypeConverters.js";

const YANDEX_OPENAI_API_BASE = "https://ai.api.cloud.yandex.net/v1";

function resolveEnvPlaceholder(value: string | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";

  const match = trimmed.match(
    /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$|^\$([A-Za-z_][A-Za-z0-9_]*)$/,
  );
  const envName = match?.[1] ?? match?.[2];
  return envName ? (process.env[envName] ?? "") : trimmed;
}

/**
 * Yandex Cloud AI Studio provider using its current OpenAI-compatible API.
 *
 * The single endpoint supports native Yandex/Alice models and the third-party
 * language models exposed by the folder. Model names are normalized to the
 * canonical `gpt://<folder>/<model>/latest` identifier returned by Models API.
 */
class YandexGptLLM extends BaseLLM {
  static providerName = "yandex_gpt";
  static defaultOptions: Partial<LLMOptions> = {
    model: "yandexgpt-5-pro",
    apiBase: YANDEX_OPENAI_API_BASE,
    contextLength: 32768,
    completionOptions: {
      model: "yandexgpt-5-pro",
      maxTokens: 4096,
      temperature: 0.3,
    },
  };

  private readonly folderId: string;
  private readonly actualApiKey: string;

  constructor(options: LLMOptions) {
    super(options);

    // Retain compatibility with the historical "API_KEY:FOLDER_ID" input.
    const rawApiKey = options.apiKey ?? "";
    const separator = rawApiKey.indexOf(":");
    const configuredApiKey =
      separator >= 0 ? rawApiKey.slice(0, separator) : rawApiKey;
    const bundledFolderId =
      separator >= 0 ? rawApiKey.slice(separator + 1) : "";
    const configuredFolderId =
      (options as any).folderId ??
      options.requestOptions?.extraBodyProperties?.folderId ??
      (options as any).extraBodyProperties?.folderId;

    this.actualApiKey =
      resolveEnvPlaceholder(configuredApiKey) ||
      process.env.YANDEX_API_KEY ||
      "";
    this.folderId =
      resolveEnvPlaceholder(configuredFolderId) ||
      resolveEnvPlaceholder(bundledFolderId) ||
      process.env.YANDEX_FOLDER_ID ||
      "";

    // folderId is transport configuration, not an OpenAI request field.
    if (this.requestOptions?.extraBodyProperties?.folderId) {
      delete this.requestOptions.extraBodyProperties.folderId;
    }

    this.apiBase = (this.apiBase || YANDEX_OPENAI_API_BASE).replace(/\/+$/, "");
    this.templateMessages = undefined;
  }

  private getModelId(): string {
    if (this.model.startsWith("gpt://")) return this.model;
    const model = this.model || "yandexgpt-5-pro";
    return `gpt://${this.folderId}/${model}${model.includes("/") ? "" : "/latest"}`;
  }

  private extractText(message: ChatMessage): string {
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return "";
    return message.content
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join("\n");
  }

  private toOpenAIMessages(
    messages: ChatMessage[],
  ): Array<Record<string, any>> {
    return messages
      .filter((message) =>
        ["system", "user", "assistant", "tool"].includes(message.role),
      )
      .map((message) => {
        const content = this.extractText(message);
        if (message.role === "tool") {
          return {
            role: "tool",
            content,
            tool_call_id: (message as any).toolCallId ?? "",
          };
        }

        const toolCalls = (message as AssistantChatMessage).toolCalls;
        if (message.role === "assistant" && toolCalls?.length) {
          return {
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: "function",
              function: {
                name: toolCall.function?.name ?? "",
                arguments:
                  typeof toolCall.function?.arguments === "string"
                    ? toolCall.function.arguments
                    : JSON.stringify(toolCall.function?.arguments ?? {}),
              },
            })),
          };
        }

        return { role: message.role, content };
      });
  }

  private assertConfigured(): void {
    if (!this.actualApiKey) {
      throw new Error(
        "Yandex Cloud API key is missing. Set apiKey or YANDEX_API_KEY.",
      );
    }
    if (!this.folderId && !this.model.startsWith("gpt://")) {
      throw new Error(
        "Yandex Cloud folder ID is missing. Set folderId or YANDEX_FOLDER_ID.",
      );
    }
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    this.assertConfigured();

    const body: Record<string, any> = {
      model: this.getModelId(),
      messages: this.toOpenAIMessages(messages),
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature ?? 0.3,
      stream: true,
    };

    if (options.topP !== undefined) body.top_p = options.topP;
    if (options.stop?.length) body.stop = options.stop;
    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.function.name,
          description: tool.function.description ?? "",
          parameters: tool.function.parameters ?? {
            type: "object",
            properties: {},
          },
        },
      }));
      if (options.toolChoice) body.tool_choice = options.toolChoice;
    }

    const response = await this.fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${this.actualApiKey}`,
        ...(this.folderId ? { "x-folder-id": this.folderId } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      throw new PublicError(
        `Yandex Cloud API request failed (HTTP ${response.status}). Check provider access and try again.`,
      );
    }

    for await (const value of streamSse(response)) {
      const chunk = fromChatCompletionChunk(value);
      if (chunk) yield chunk;
    }
  }

  protected async *_streamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    for await (const chunk of this._streamChat(
      [{ role: "user", content: prompt }],
      signal,
      options,
    )) {
      if (typeof chunk.content === "string") yield chunk.content;
    }
  }

  protected async _complete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): Promise<string> {
    let result = "";
    for await (const chunk of this._streamComplete(prompt, signal, options)) {
      result += chunk;
    }
    return result;
  }
}

export default YandexGptLLM;
