import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { BaseLLM } from "../index.js";
import { request as httpsRequest } from "https";

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
 * - GigaChat - base model
 * - GigaChat-Plus - enhanced model
 * - GigaChat-Pro - professional model
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
        this.requestOptions = {
            ...this.requestOptions,
            verifySsl: this.requestOptions?.verifySsl ?? true,
        };

        if (!this.apiBase) {
            this.apiBase = "https://gigachat.devices.sberbank.ru/api/v1/";
        }
    }

    private getVerifySsl(): boolean {
        return this.requestOptions?.verifySsl ?? true;
    }

    private async requestText(
        url: URL | string,
        init: {
            method: string;
            headers: Record<string, string>;
            body?: string;
            signal?: AbortSignal;
        },
    ): Promise<{ ok: boolean; status: number; statusText: string; text: string }> {
        return await new Promise((resolve, reject) => {
            const requestUrl = typeof url === "string" ? new URL(url) : url;
            const req = httpsRequest(
                requestUrl,
                {
                    method: init.method,
                    headers: init.headers,
                    rejectUnauthorized: this.getVerifySsl(),
                    signal: init.signal,
                } as any,
                (res) => {
                    const chunks: Uint8Array[] = [];
                    res.on("data", (chunk) =>
                        chunks.push(new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))),
                    );
                    res.on("end", () => {
                        const status = res.statusCode ?? 0;
                        resolve({
                            ok: status >= 200 && status < 300,
                            status,
                            statusText: res.statusMessage ?? "",
                            text: Buffer.concat(chunks as any).toString("utf8"),
                        });
                    });
                },
            );

            req.on("error", reject);

            if (init.body) {
                req.write(init.body);
            }
            req.end();
        });
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
            const body = `scope=${this.scope}`;
            const response = await this.requestText(GigaChatLLM.OAUTH_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                    "Authorization": `Basic ${this.apiKey}`,
                    "RqUID": this.generateRqUID(),
                    "Content-Length": Buffer.byteLength(body).toString(),
                },
                body,
            });

            if (!response.ok) {
                const errorText = response.text;
                throw new Error(`OAuth error (${response.status}): ${errorText}`);
            }

            const data = JSON.parse(response.text);
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
        // Filter out thinking/reasoning messages — GigaChat API only accepts
        // system, user, assistant roles.
        return messages
            .filter(msg => msg.role !== "thinking")
            .map(msg => {
                const content = typeof msg.content === "string"
                    ? msg.content
                    : Array.isArray(msg.content)
                        ? msg.content
                            .filter((p): p is { type: "text"; text: string } => p.type === "text")
                            .map(p => p.text)
                            .join("\n")
                        : "";

                // Ensure only valid roles reach the API
                let role = msg.role;
                if (role !== "system" && role !== "user" && role !== "assistant") {
                    role = "user";
                }

                return { role, content };
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
                content: "Error: API key not specified. Add apiKey to config.yaml.\n\nFormat: Base64 of 'ClientID:ClientSecret' or access token.",
            };
            return;
        }

        let accessToken: string;
        try {
            accessToken = await this.getAccessToken();
        } catch (error) {
            yield {
                role: "assistant",
                content: `GigaChat authorization error: ${error instanceof Error ? error.message : String(error)}`,
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
            const response = await this.requestText(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "text/event-stream",
                    "Authorization": `Bearer ${accessToken}`,
                    "Content-Length": Buffer.byteLength(JSON.stringify(body)).toString(),
                },
                body: JSON.stringify(body),
                signal,
            });

            if (!response.ok) {
                const errorText = response.text;

                // If unauthorized, clear token and retry once
                if (response.status === 401) {
                    this.accessToken = null;
                    this.tokenExpiry = 0;
                }

                yield {
                    role: "assistant",
                    content: `GigaChat API error (${response.status}): ${errorText}`,
                };
                return;
            }

            // GigaChat uses SSE format like OpenAI
            for await (const chunk of this.parseSSE(response.text)) {
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
                content: `GigaChat request error: ${errorMessage}`,
            };
        }
    }

    /**
     * Stream SSE response from GigaChat (OpenAI-compatible format)
     */
    private async *parseSSE(text: string): AsyncGenerator<any> {
        for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;

            if (trimmed.startsWith("data: ")) {
                const jsonStr = trimmed.slice(6);
                try {
                    yield JSON.parse(jsonStr);
                } catch {
                    // Skip invalid JSON lines
                }
            }
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
