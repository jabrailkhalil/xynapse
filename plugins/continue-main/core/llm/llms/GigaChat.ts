import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { BaseLLM } from "../index.js";

/**
 * GigaChat Provider for Xynapse Assistant
 *
 * Uses Sber GigaChat API with OAuth 2.0 authentication
 * API Documentation: https://developers.sber.ru/docs/ru/gigachat/
 *
 * Required config:
 * - apiKey: Authorization credentials (Client ID:Client Secret in Base64 or access token)
 * - requestOptions.extraBodyProperties.scope: API scope (GIGACHAT_API_PERS or GIGACHAT_API_CORP)
 *
 * Available models:
 * - GigaChat - базовая модель
 * - GigaChat-Plus - улучшенная модель
 * - GigaChat-Pro - профессиональная модель
 */
class GigaChatLLM extends BaseLLM {
    static providerName = "gigachat";
    static defaultOptions: Partial<LLMOptions> = {
        model: "GigaChat",
        apiBase: "https://gigachat.devices.sberbank.ru/api/v1/",
        contextLength: 8192,
        completionOptions: {
            model: "GigaChat",
            maxTokens: 2048,
            temperature: 0.7,
        },
    };

    private static readonly OAUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;
    private scope: string;

    constructor(options: LLMOptions) {
        super(options);
        this.scope = options.requestOptions?.extraBodyProperties?.scope || "GIGACHAT_API_PERS";

        if (!this.apiBase) {
            this.apiBase = "https://gigachat.devices.sberbank.ru/api/v1/";
        }
    }

    /**
     * Get OAuth access token from GigaChat
     * Token is cached and refreshed when expired
     */
    private async getAccessToken(): Promise<string> {
        // Check if we have a valid cached token
        if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
            return this.accessToken;
        }

        if (!this.apiKey) {
            throw new Error("API key is required. Use 'Client ID:Client Secret' in Base64 format.");
        }

        // If apiKey looks like a UUID (access token), use it directly
        if (this.apiKey.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            return this.apiKey;
        }

        try {
            const response = await this.fetch(GigaChatLLM.OAUTH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                    "Authorization": `Basic ${this.apiKey}`,
                    "RqUID": this.generateRqUID(),
                },
                body: `scope=${this.scope}`,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OAuth error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            this.accessToken = data.access_token;
            // Token expires in 30 minutes by default
            this.tokenExpiry = Date.now() + (data.expires_at ? data.expires_at * 1000 - Date.now() : 30 * 60 * 1000);

            return this.accessToken!;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to get GigaChat access token: ${errorMessage}`);
        }
    }

    /**
     * Generate unique request ID for GigaChat API
     */
    private generateRqUID(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Convert Xynapse messages to GigaChat format (OpenAI-compatible)
     */
    private convertMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
        return messages.map(msg => {
            const content = typeof msg.content === "string"
                ? msg.content
                : Array.isArray(msg.content)
                    ? msg.content
                        .filter((p): p is { type: "text"; text: string } => p.type === "text")
                        .map(p => p.text)
                        .join("\n")
                    : "";

            return { role: msg.role, content };
        });
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
        if (!this.apiKey) {
            yield {
                role: "assistant",
                content: "❌ Ошибка: Не указан API ключ. Добавьте apiKey в config.yaml.\n\nФормат: Base64 от 'ClientID:ClientSecret' или access token.",
            };
            return;
        }

        let accessToken: string;
        try {
            accessToken = await this.getAccessToken();
        } catch (error) {
            yield {
                role: "assistant",
                content: `❌ Ошибка авторизации GigaChat: ${error instanceof Error ? error.message : String(error)}`,
            };
            return;
        }

        const endpoint = new URL("chat/completions", this.apiBase);

        const body = {
            model: this.model || "GigaChat",
            messages: this.convertMessages(messages),
            stream: true,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.maxTokens ?? 2048,
        };

        try {
            const response = await this.fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    "Authorization": `Bearer ${accessToken}`,
                },
                body: JSON.stringify(body),
                signal,
            });

            if (!response.ok) {
                const errorText = await response.text();

                // If unauthorized, clear token and retry once
                if (response.status === 401) {
                    this.accessToken = null;
                    this.tokenExpiry = 0;
                }

                yield {
                    role: "assistant",
                    content: `❌ Ошибка GigaChat API (${response.status}): ${errorText}`,
                };
                return;
            }

            // GigaChat uses SSE format like OpenAI
            for await (const chunk of this.streamSSE(response)) {
                if (chunk.choices?.[0]?.delta?.content) {
                    yield {
                        role: "assistant",
                        content: chunk.choices[0].delta.content,
                    };
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            yield {
                role: "assistant",
                content: `❌ Ошибка при запросе к GigaChat: ${errorMessage}`,
            };
        }
    }

    /**
     * Stream SSE response from GigaChat (OpenAI-compatible format)
     */
    private async *streamSSE(response: Response): AsyncGenerator<any> {
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === "data: [DONE]") continue;

                    if (trimmed.startsWith("data: ")) {
                        const jsonStr = trimmed.slice(6);
                        try {
                            const parsed = JSON.parse(jsonStr);
                            yield parsed;
                        } catch {
                            // Skip invalid JSON lines
                        }
                    }
                }
            }

            // Process remaining buffer
            if (buffer.trim() && buffer.trim().startsWith("data: ")) {
                const jsonStr = buffer.trim().slice(6);
                if (jsonStr !== "[DONE]") {
                    try {
                        const parsed = JSON.parse(jsonStr);
                        yield parsed;
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
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

export default GigaChatLLM;
