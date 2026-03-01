import {
  ChatMessage,
  CompletionOptions,
  LLMOptions,
  Tool,
  ToolCallDelta,
  AssistantChatMessage,
} from "../../index.js";
import { BaseLLM } from "../index.js";
import { v4 as uuidv4 } from "uuid";

function resolveEnvPlaceholder(value: string | undefined): string {
  if (!value || typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const braced = trimmed.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (braced) {
    return process.env[braced[1]] || "";
  }

  const direct = trimmed.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/);
  if (direct) {
    return process.env[direct[1]] || "";
  }

  return trimmed;
}

/**
 * YandexGPT Provider for Xynapse Assistant
 *
 * Uses Yandex Cloud AI Studio API with full tool calling support
 * API Documentation: https://cloud.yandex.ru/docs/yandexgpt/
 *
 * Required config:
 * - apiKey: API key from Yandex Cloud (Api-Key format)
 * - folderId: Folder ID from Yandex Cloud (can be set via env YANDEX_FOLDER_ID)
 *
 * Tool Calling:
 * - Supported in YandexGPT Pro and Llama 70B models
 * - NOT supported in YandexGPT Lite
 */
class YandexGptLLM extends BaseLLM {
  // Disable native tool calling - use system message tools instead
  supportsTools = true;
  static providerName = "yandex_gpt";
  static defaultOptions: Partial<LLMOptions> = {
    model: "yandexgpt",
    apiBase: "https://llm.api.cloud.yandex.net/foundationModels/v1/",
    contextLength: 8192,
    completionOptions: {
      model: "yandexgpt",
      maxTokens: 2048,
      temperature: 0.3,
    },
  };

  private folderId: string;
  private actualApiKey: string;

  constructor(options: LLMOptions) {
    super(options);

    // Support "API_KEY:FOLDER_ID" format, including env placeholders.
    const rawApiKey = options.apiKey || "";
    let parsedApiKey = "";
    let parsedFolderId = "";

    if (rawApiKey.includes(":")) {
      const parts = rawApiKey.split(":");
      parsedApiKey = resolveEnvPlaceholder(parts[0]);
      parsedFolderId = resolveEnvPlaceholder(parts.slice(1).join(":"));
    } else {
      parsedApiKey = resolveEnvPlaceholder(rawApiKey);
    }

    const folderIdFromConfig = resolveEnvPlaceholder(
      (options as any).folderId ||
        options.requestOptions?.extraBodyProperties?.folderId ||
        (options as any).extraBodyProperties?.folderId,
    );

    this.actualApiKey = parsedApiKey || process.env.YANDEX_API_KEY || "";
    this.folderId =
      folderIdFromConfig ||
      parsedFolderId ||
      process.env.YANDEX_FOLDER_ID ||
      "";

    if (!this.apiBase) {
      this.apiBase = "https://llm.api.cloud.yandex.net/foundationModels/v1/";
    }
  }

  /**
   * Get model URI for YandexGPT API
   * Format: gpt://{folderId}/{modelName}/latest
   */
  private getModelUri(): string {
    const modelName = this.model || "yandexgpt";
    return `gpt://${this.folderId}/${modelName}/latest`;
  }

  /**
   * Check if current model supports tool calling
   * YandexGPT Pro and Llama 70B support it, Lite does not
   */
  private supportsToolCalling(): boolean {
    const model = (this.model || "").toLowerCase();
    return model.includes("yandexgpt") && !model.includes("lite");
  }

  /**
   * Convert Xynapse Tool to YandexGPT function format
   */
  private convertToolToYandexFunction(tool: Tool): any {
    return {
      function: {
        name: tool.function.name,
        description: tool.function.description || "",
        parameters: tool.function.parameters || {
          type: "object",
          properties: {},
        },
      },
    };
  }

  /**
   * Find the function name for a tool call ID by looking through messages
   */
  private findToolCallName(
    messages: ChatMessage[],
    toolCallId: string,
  ): string {
    for (const msg of messages) {
      if (msg.role === "assistant") {
        const toolCalls = (msg as AssistantChatMessage).toolCalls;
        if (toolCalls) {
          for (const tc of toolCalls) {
            if (tc.id === toolCallId) {
              return tc.function?.name || "unknown";
            }
          }
        }
      }
    }
    return "unknown";
  }

  /**
   * Extract text content from a ChatMessage
   */
  private extractText(msg: ChatMessage): string {
    return typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content
            .filter(
              (p): p is { type: "text"; text: string } => p.type === "text",
            )
            .map((p) => p.text)
            .join("\n")
        : "";
  }

  /**
   * Convert Xynapse messages to YandexGPT format
   *
   * Key: consecutive tool-result messages are merged into a single
   * `toolResultList` message, because the YandexGPT API expects ALL
   * results for a preceding `toolCallList` in ONE message.
   */
  private convertMessages(messages: ChatMessage[]): Array<any> {
    const result: any[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      // --- Consecutive tool results → single toolResultList ---
      if (msg.role === "tool") {
        const toolResults: any[] = [];

        while (i < messages.length && messages[i].role === "tool") {
          const toolMsg = messages[i];
          const toolCallId = (toolMsg as any).toolCallId || "";
          const functionName = this.findToolCallName(messages, toolCallId);
          const content =
            typeof toolMsg.content === "string"
              ? toolMsg.content
              : JSON.stringify(toolMsg.content);

          toolResults.push({
            functionResult: {
              name: functionName,
              content,
            },
          });
          i++;
        }

        result.push({
          role: "user",
          toolResultList: { toolResults },
        });
        continue;
      }

      // --- Assistant with tool calls (may also have text) ---
      if (
        msg.role === "assistant" &&
        (msg as AssistantChatMessage).toolCalls?.length
      ) {
        const toolCalls = (msg as AssistantChatMessage).toolCalls || [];
        const assistantMsg: any = {
          role: "assistant",
          toolCallList: {
            toolCalls: toolCalls.map((tc) => {
              let argsObj: Record<string, any> = {};
              if (tc.function?.arguments) {
                if (typeof tc.function.arguments === "string") {
                  try {
                    argsObj = JSON.parse(tc.function.arguments);
                  } catch {
                    argsObj = {};
                  }
                } else {
                  argsObj = tc.function.arguments as any;
                }
              }
              return {
                functionCall: {
                  name: tc.function?.name || "",
                  arguments: argsObj,
                },
              };
            }),
          },
        };

        // Preserve any accompanying text (YandexGPT allows text + toolCallList)
        const text = this.extractText(msg);
        if (text) {
          assistantMsg.text = text;
        }

        result.push(assistantMsg);
        i++;
        continue;
      }

      // --- Regular message (user / assistant / system) ---
      let role = msg.role;
      if (role !== "user" && role !== "assistant" && role !== "system") {
        role = "user";
      }

      result.push({ role, text: this.extractText(msg) });
      i++;
    }

    return result;
  }

  /**
   * Parse [TOOL_CALL_START] format from text response as fallback
   * Handles both JSON args and BEGIN_ARG/END_ARG format
   */
  private parseToolCallFromText(
    text: string,
  ): { prefix: string; toolCall: ToolCallDelta } | null {
    const markerLower = "[tool_call_start]";
    const startIdx = text.toLowerCase().indexOf(markerLower);
    if (startIdx === -1) return null;

    const prefix = text.substring(0, startIdx).trim();
    const afterMarker = text
      .substring(startIdx + markerLower.length)
      .trim();

    // Extract tool name: everything until first whitespace or '{'
    const nameEndIdx = afterMarker.search(/[\s{]/);
    if (nameEndIdx === -1) return null;

    const toolName = afterMarker.substring(0, nameEndIdx).trim();
    if (!toolName) return null;

    let afterName = afterMarker.substring(nameEndIdx).trim();

    // Remove [TOOL_CALL_END] if present
    const endIdx = afterName.toLowerCase().indexOf("[tool_call_end]");
    if (endIdx !== -1) {
      afterName = afterName.substring(0, endIdx).trim();
    }

    let argsJson = "{}";

    if (afterName.startsWith("{")) {
      // JSON format — handle triple-quoted strings """..."""
      let raw = afterName;
      raw = raw.replace(/"""([\s\S]*?)"""/g, (_, content) => {
        const escaped = content
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t");
        return `"${escaped}"`;
      });
      try {
        JSON.parse(raw);
        argsJson = raw;
      } catch {
        // JSON parse failed, ignore
      }
    } else if (/BEGIN_ARG:/i.test(afterName)) {
      // BEGIN_ARG:name value END_ARG format
      const argPairs: Record<string, string> = {};
      const argRegex = /BEGIN_ARG:(\w+)\s*([\s\S]*?)\s*END_ARG/gi;
      let match;
      while ((match = argRegex.exec(afterName)) !== null) {
        argPairs[match[1]] = match[2].trim();
      }
      argsJson = JSON.stringify(argPairs);
    }

    console.log(
      `[YandexGPT] Parsed text tool call: ${toolName}, args length: ${argsJson.length}`,
    );

    return {
      prefix,
      toolCall: {
        type: "function" as const,
        id: uuidv4(),
        function: {
          name: toolName,
          arguments: argsJson,
        },
      },
    };
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
      if (typeof chunk.content === "string") {
        yield chunk.content;
      }
    }
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    if (!this.folderId) {
      yield {
        role: "assistant",
        content:
          '❌ Ошибка: Не указан folderId.\n\nУкажите folderId в модели (поле folderId) или в requestOptions.extraBodyProperties.folderId.\nТакже можно использовать переменную окружения YANDEX_FOLDER_ID\nили формат apiKey: "ВАШ_API_КЛЮЧ:ВАШ_FOLDER_ID".',
      };
      return;
    }

    if (!this.actualApiKey) {
      yield {
        role: "assistant",
        content:
          '❌ Ошибка: Не указан API ключ.\n\nУкажите поле apiKey или переменную окружения YANDEX_API_KEY.\nПоддерживается формат apiKey: "ВАШ_API_КЛЮЧ:ВАШ_FOLDER_ID".',
      };
      return;
    }

    const endpoint = new URL("completion", this.apiBase);

    // Build request body
    const body: any = {
      modelUri: this.getModelUri(),
      completionOptions: {
        stream: false,
        temperature: options.temperature ?? 0.3,
        maxTokens: String(options.maxTokens ?? 2048),
      },
      messages: this.convertMessages(messages),
    };

    // Add tools if provided and model supports them
    if (options.tools?.length && this.supportsToolCalling()) {
      body.tools = options.tools.map((tool) =>
        this.convertToolToYandexFunction(tool),
      );
      console.log(
        "[YandexGPT] Using tools:",
        body.tools.map((t: any) => t.function.name),
      );
    }

    try {
      const response = await this.fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Api-Key ${this.actualApiKey}`,
          "x-folder-id": this.folderId,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        yield {
          role: "assistant",
          content: `❌ Ошибка YandexGPT API (${response.status}): ${errorText}`,
        };
        return;
      }

      const result = await response.json();
      const alternative = result.result?.alternatives?.[0];

      if (!alternative) {
        yield {
          role: "assistant",
          content: `❌ Неожиданный формат ответа: ${JSON.stringify(result)}`,
        };
        return;
      }

      const message = alternative.message;

      // Check for tool calls in response
      if (message?.toolCallList?.toolCalls?.length) {
        const toolCalls: ToolCallDelta[] = message.toolCallList.toolCalls.map(
          (tc: any) => ({
            type: "function" as const,
            id: uuidv4(),
            function: {
              name: tc.functionCall?.name || "",
              arguments:
                typeof tc.functionCall?.arguments === "string"
                  ? tc.functionCall.arguments
                  : JSON.stringify(tc.functionCall?.arguments || {}),
            },
          }),
        );

        console.log(
          "[YandexGPT] Tool calls received:",
          toolCalls.map((tc) => tc.function?.name),
        );

        const assistantMessage: AssistantChatMessage = {
          role: "assistant",
          content: message.text || "",
          toolCalls,
        };
        yield assistantMessage;
      } else if (message?.text) {
        // Fallback: check if model output contains [TOOL_CALL_START] as text
        const parsed = this.parseToolCallFromText(message.text);
        if (parsed) {
          if (parsed.prefix) {
            yield { role: "assistant", content: parsed.prefix };
          }
          const assistantMsg: AssistantChatMessage = {
            role: "assistant",
            content: "",
            toolCalls: [parsed.toolCall],
          };
          yield assistantMsg;
        } else {
          yield {
            role: "assistant",
            content: message.text,
          };
        }
      } else {
        yield {
          role: "assistant",
          content: `❌ Неожиданный формат ответа: ${JSON.stringify(result)}`,
        };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      yield {
        role: "assistant",
        content: `❌ Ошибка при запросе к YandexGPT: ${errorMessage}`,
      };
    }
  }

  /**
   * Non-streaming completion
   */
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
