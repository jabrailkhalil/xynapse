import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { StringDecoder } from "node:string_decoder";
import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js";
import { PublicError } from "../../util/publicError.js";
import { BaseLLM } from "../index.js";
import { fromChatCompletionChunk } from "../openaiTypeConverters.js";

class GigaChatLLM extends BaseLLM {
  static providerName = "gigachat";
  static defaultOptions: Partial<LLMOptions> = {
    model: "GigaChat",
    apiBase: "https://gigachat.devices.sberbank.ru/api/v1/",
    contextLength: 8192,
    completionOptions: { model: "GigaChat", maxTokens: 2048, temperature: 0.7 },
  };
  private static readonly OAUTH_URL =
    "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private scope: string;

  constructor(options: LLMOptions) {
    super(options);
    this.scope =
      options.requestOptions?.extraBodyProperties?.scope || "GIGACHAT_API_PERS";
    this.requestOptions = {
      ...this.requestOptions,
      verifySsl: this.requestOptions?.verifySsl ?? true,
    };
    this.apiBase ||= GigaChatLLM.defaultOptions.apiBase;
  }

  private getVerifySsl(): boolean {
    return this.requestOptions?.verifySsl ?? true;
  }

  private async request(
    url: URL | string,
    body: string,
    headers: Record<string, string>,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: "POST",
          headers,
          signal,
          rejectUnauthorized: this.getVerifySsl(),
        },
        resolve,
      );
      // requestOptions.timeout uses seconds, consistently with other providers.
      req.setTimeout((this.requestOptions?.timeout ?? 30) * 1000, () => {
        req.destroy(new PublicError("GigaChat request timed out. Try again."));
      });
      req.on("error", reject);
      req.end(body);
    });
  }

  private checkStatus(response: IncomingMessage, phase: string): void {
    const status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) return;
    response.destroy();
    if (status === 401 || status === 403) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      throw new PublicError(
        `GigaChat ${phase}: access denied. Check the API key and scope.`,
      );
    }
    if (status === 429)
      throw new PublicError("GigaChat rate limit reached. Try again later.");
    throw new PublicError(
      `GigaChat ${phase} failed (HTTP ${status}). Try again.`,
    );
  }

  private async getAccessToken(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000)
      return this.accessToken;
    if (!this.apiKey)
      throw new PublicError(
        "GigaChat API key is missing. Configure the authorization key.",
      );
    // Preserve direct-token compatibility. Ordinary authorization keys use OAuth.
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        this.apiKey,
      )
    )
      return this.apiKey;
    const response = await this.request(
      GigaChatLLM.OAUTH_URL,
      `scope=${encodeURIComponent(this.scope)}`,
      {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${this.apiKey}`,
        RqUID: randomUUID(),
      },
      signal,
    );
    this.checkStatus(response, "authorization");
    let body = "";
    for await (const part of response) {
      signal.throwIfAborted();
      body += part.toString("utf8");
      if (body.length > 64000)
        throw new PublicError(
          "GigaChat returned an invalid authorization response.",
        );
    }
    let data: { access_token?: unknown; expires_at?: unknown };
    try {
      data = JSON.parse(body);
    } catch {
      throw new PublicError(
        "GigaChat returned an invalid authorization response.",
      );
    }
    if (
      typeof data.access_token !== "string" ||
      !data.access_token ||
      typeof data.expires_at !== "number" ||
      !Number.isFinite(data.expires_at) ||
      data.expires_at <= Date.now()
    ) {
      throw new PublicError(
        "GigaChat returned an invalid or expired access token.",
      );
    }
    this.accessToken = data.access_token;
    // The API returns the Unix expiration timestamp in milliseconds.
    this.tokenExpiry = data.expires_at;
    return this.accessToken;
  }

  private convertMessages(messages: ChatMessage[]) {
    return messages
      .filter((msg) => msg.role !== "thinking")
      .map((msg) => ({
        role: ["system", "user", "assistant"].includes(msg.role)
          ? msg.role
          : "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter((part) => part.type === "text")
                  .map((part) => (part as { text: string }).text)
                  .join("\n")
              : "",
      }));
  }

  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    let response: IncomingMessage | undefined;
    try {
      const accessToken = await this.getAccessToken(controller.signal);
      const body = JSON.stringify({
        model: this.model || "GigaChat",
        messages: this.convertMessages(messages),
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
      });
      response = await this.request(
        new URL("chat/completions", this.apiBase),
        body,
        {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${accessToken}`,
        },
        controller.signal,
      );
      this.checkStatus(response, "completion");
      let terminal = false;
      for await (const value of this.parseSSE(response)) {
        controller.signal.throwIfAborted();
        const reason = value.choices?.[0]?.finish_reason;
        if (value.error || reason === "error")
          throw new PublicError(
            "GigaChat reported a failed completion. Try again.",
          );
        if (reason) {
          if (
            ![
              "stop",
              "length",
              "blacklist",
              "content_filter",
              "refusal",
            ].includes(reason)
          ) {
            throw new PublicError(
              "GigaChat did not return a completed text response.",
            );
          }
          terminal = true;
          if (reason === "blacklist")
            value.choices[0].finish_reason = "refusal";
        }
        const chunk = fromChatCompletionChunk(value);
        if (chunk) yield chunk;
      }
      controller.signal.throwIfAborted();
      if (!terminal)
        throw new PublicError(
          "GigaChat stream ended before completion was confirmed. Try again.",
        );
    } catch (error) {
      if (signal.aborted) {
        const cancelled = new Error("The request was cancelled.");
        cancelled.name = "AbortError";
        throw cancelled;
      }
      if (error instanceof PublicError) throw error;
      throw new PublicError(
        "GigaChat connection failed. Check the connection and TLS certificates, then try again.",
      );
    } finally {
      signal.removeEventListener("abort", abort);
      controller.abort();
      response?.destroy();
    }
  }

  private async *parseSSE(response: IncomingMessage): AsyncGenerator<any> {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    for await (const part of response) {
      buffer += decoder.write(Buffer.isBuffer(part) ? part : Buffer.from(part));
      if (buffer.length > 1000000)
        throw new PublicError("GigaChat returned an oversized stream event.");
      let position: number;
      while ((position = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, position).trimEnd();
        buffer = buffer.slice(position + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (!data) continue;
        let value: any;
        try {
          value = JSON.parse(data);
        } catch {
          throw new PublicError("GigaChat returned an invalid stream event.");
        }
        if (!value || typeof value !== "object")
          throw new PublicError("GigaChat returned an invalid stream event.");
        yield value;
      }
    }
    buffer += decoder.end();
    if (buffer.trim())
      throw new PublicError("GigaChat stream ended with an incomplete event.");
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
    for await (const chunk of this._streamComplete(prompt, signal, options))
      result += chunk;
    return result;
  }
}
export default GigaChatLLM;
