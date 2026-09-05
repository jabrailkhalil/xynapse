import { describe, expect, it } from "vitest";

import type {
  ChatCompletion,
  ChatCompletionChunk,
} from "openai/resources/index";
import type {
  Response as OpenAIResponse,
  ResponseStreamEvent,
} from "openai/resources/responses/responses.mjs";

import {
  fromChatCompletionChunk,
  fromChatResponse,
  fromResponsesChunk,
} from "./openaiTypeConverters.js";

describe("fromChatCompletionChunk completion metadata", () => {
  it("keeps finish reason and usage on a content chunk", () => {
    const message = fromChatCompletionChunk({
      id: "chunk-1",
      created: 0,
      model: "test",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: { content: "done" },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    });

    expect(message).toMatchObject({
      role: "assistant",
      content: "done",
      metadata: { finishReason: "stop" },
      usage: {
        promptTokens: 11,
        completionTokens: 7,
        promptTokensDetails: { cachedTokens: 3 },
        completionTokensDetails: { reasoningTokens: 2 },
      },
    });
  });

  it("emits a final metadata-only message for length termination", () => {
    const message = fromChatCompletionChunk({
      id: "chunk-2",
      created: 0,
      model: "test",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "length" }],
    });

    expect(message).toEqual({
      role: "assistant",
      content: "",
      metadata: { finishReason: "length" },
      usage: undefined,
    });
  });

  it("preserves terminal metadata on a reasoning-only chunk", () => {
    const message = fromChatCompletionChunk({
      choices: [
        {
          delta: { reasoning_content: "Still considering" },
          finish_reason: "length",
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 20, total_tokens: 28 },
    } as unknown as ChatCompletionChunk);

    expect(message).toMatchObject({
      role: "thinking",
      content: "Still considering",
      metadata: { finishReason: "length" },
      usage: { promptTokens: 8, completionTokens: 20 },
    });
  });

  it("keeps the final usage-only chunk with no choices", () => {
    expect(
      fromChatCompletionChunk({
        choices: [],
        usage: { prompt_tokens: 8, completion_tokens: 20, total_tokens: 28 },
      } as unknown as ChatCompletionChunk),
    ).toMatchObject({
      role: "assistant",
      content: "",
      usage: { promptTokens: 8, completionTokens: 20 },
    });
  });

  it("does not report a refusal delta as successful completion", () => {
    expect(
      fromChatCompletionChunk({
        choices: [
          { delta: { refusal: "Cannot comply" }, finish_reason: "stop" },
        ],
      } as unknown as ChatCompletionChunk),
    ).toMatchObject({
      role: "assistant",
      content: "Cannot comply",
      metadata: { finishReason: "refusal" },
    });
  });
});

describe("fromChatResponse completion metadata", () => {
  it("retains length termination and usage on nonstream output", () => {
    expect(
      fromChatResponse({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Partial plan",
              reasoning: "Considering",
            },
            finish_reason: "length",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 20, total_tokens: 28 },
      } as unknown as ChatCompletion),
    ).toEqual([
      expect.objectContaining({ role: "thinking", content: "Considering" }),
      expect.objectContaining({
        role: "assistant",
        content: "Partial plan",
        metadata: { finishReason: "length" },
        usage: expect.objectContaining({
          promptTokens: 8,
          completionTokens: 20,
        }),
      }),
    ]);
  });
});

describe("fromResponsesChunk completion metadata", () => {
  const usage = {
    input_tokens: 12,
    output_tokens: 30,
    total_tokens: 42,
    input_tokens_details: { cached_tokens: 5 },
    output_tokens_details: { reasoning_tokens: 20 },
  };

  function terminal(status: string, extra: Record<string, unknown> = {}) {
    return fromResponsesChunk({
      type: `response.${status}`,
      response: { status, output: [], usage, ...extra },
    } as unknown as ResponseStreamEvent);
  }

  it("emits completion and usage without replaying streamed output", () => {
    const message = terminal("completed", {
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Already streamed" }],
        },
      ],
    });
    expect(message).toMatchObject({
      role: "assistant",
      content: "",
      metadata: { finishReason: "stop", responseStatus: "completed" },
      usage: {
        promptTokens: 12,
        completionTokens: 30,
        promptTokensDetails: { cachedTokens: 5 },
        completionTokensDetails: { reasoningTokens: 20 },
      },
    });
  });

  it.each([
    ["max_output_tokens", "length"],
    ["content_filter", "content_filter"],
    ["future_reason", "incomplete"],
    [undefined, "incomplete"],
  ])("marks incomplete output (%s) as %s", (reason, finishReason) => {
    expect(
      terminal("incomplete", { incomplete_details: { reason } }),
    ).toMatchObject({
      content: "",
      metadata: { finishReason },
      usage: { completionTokens: 30 },
    });
  });

  it("keeps failure metadata and usage", () => {
    expect(
      terminal("failed", { error: { message: "Server unavailable" } }),
    ).toMatchObject({
      metadata: { finishReason: "error", responseError: "Server unavailable" },
      usage: { completionTokens: 30 },
    });
  });

  it("marks refusals even when the response status is completed", () => {
    expect(
      terminal("completed", {
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "Cannot comply" }],
          },
        ],
      }),
    ).toMatchObject({ metadata: { finishReason: "refusal" } });
  });

  it("streams refusal text once and marks the done event", () => {
    expect(
      fromResponsesChunk({
        type: "response.refusal.delta",
        delta: "Cannot comply",
      } as ResponseStreamEvent),
    ).toMatchObject({
      content: "Cannot comply",
      metadata: { finishReason: "refusal" },
    });
    expect(
      fromResponsesChunk({
        type: "response.refusal.done",
        refusal: "Cannot comply",
      } as ResponseStreamEvent),
    ).toMatchObject({
      content: "",
      metadata: { finishReason: "refusal" },
    });
  });

  it("throws an explicit Responses API error event", () => {
    expect(() =>
      fromResponsesChunk({
        type: "error",
        message: "Transport failed",
      } as ResponseStreamEvent),
    ).toThrow("Transport failed");
  });

  it("retains final status alongside nonstream response items", () => {
    const messages = fromResponsesChunk({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          id: "message-1",
          type: "message",
          content: [{ type: "output_text", text: "Partial plan" }],
        },
      ],
      usage,
    } as unknown as OpenAIResponse);
    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Partial plan" }),
      expect.objectContaining({
        metadata: expect.objectContaining({ finishReason: "length" }),
        usage: expect.objectContaining({ completionTokens: 30 }),
      }),
    ]);
  });
});
