import { afterEach, describe, expect, test, vi } from "vitest";
import { ILLM } from "../../index.js";
import OpenAI from "./OpenAI.js";

describe("OpenAI Responses terminal events", () => {
  function modelWithEvents(events: object[]) {
    const model = new OpenAI({ apiKey: "test-api-key", model: "gpt-5" });
    (model as any).fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
    return model;
  }

  const text = { type: "response.output_text.delta", delta: "Partial plan" };
  const usage = { input_tokens: 4, output_tokens: 9, total_tokens: 13 };

  test("delivers final status and usage through streamChat without duplicate text", async () => {
    const model = modelWithEvents([
      text,
      {
        type: "response.completed",
        response: { status: "completed", output: [], usage },
      },
    ]);
    const messages = [];
    for await (const message of model.streamChat(
      [{ role: "user", content: "Plan a change" }],
      new AbortController().signal,
    ))
      messages.push(message);
    expect(messages).toEqual([
      expect.objectContaining({ content: "Partial plan" }),
      expect.objectContaining({
        content: "",
        metadata: expect.objectContaining({ finishReason: "stop" }),
        usage: expect.objectContaining({
          promptTokens: 4,
          completionTokens: 9,
        }),
      }),
    ]);
  });

  test.each([
    [
      {
        type: "response.failed",
        response: {
          status: "failed",
          output: [],
          usage,
          error: { message: "Provider failed" },
        },
      },
      "Provider failed",
    ],
    [{ type: "error", message: "Transport failed" }, "Transport failed"],
  ])(
    "does not swallow failure after text was streamed",
    async (terminal, error) => {
      const model = modelWithEvents([text, terminal]);
      const stream = (model as any)._streamResponses(
        [],
        new AbortController().signal,
        { model: "gpt-5" },
      );
      expect((await stream.next()).value.content).toBe("Partial plan");
      await expect(
        (async () => {
          for await (const _ of stream) {
            /* consume terminal metadata */
          }
        })(),
      ).rejects.toThrow(error);
    },
  );

  test("rejects a stream that closes before the terminal event", async () => {
    const model = modelWithEvents([text]);
    const stream = (model as any)._streamResponses(
      [],
      new AbortController().signal,
      { model: "gpt-5" },
    );
    expect((await stream.next()).value.content).toBe("Partial plan");
    await expect(stream.next()).rejects.toThrow("before a terminal event");
  });

  test("unpacks nonstream Responses items and retains terminal metadata", async () => {
    const model = new OpenAI({ apiKey: "test-api-key", model: "o1" });
    (model as any).fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          usage,
          output: [
            {
              type: "message",
              id: "message-1",
              content: [{ type: "output_text", text: "Partial plan" }],
            },
          ],
        }),
      ),
    );
    const messages = [];
    for await (const message of model.streamChat(
      [{ role: "user", content: "Plan a change" }],
      new AbortController().signal,
    ))
      messages.push(message);
    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", content: "Partial plan" }),
      expect.objectContaining({
        content: "",
        metadata: expect.objectContaining({ finishReason: "length" }),
        usage: expect.objectContaining({
          promptTokens: 4,
          completionTokens: 9,
        }),
      }),
    ]);
  });
});

interface LlmTestCase {
  llm: ILLM;
  methodToTest: keyof ILLM;
  params: any[];
  expectedRequest: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: Record<string, any>;
  };
  mockResponse?: any;
  mockStream?: any[];
}

function createMockStream(mockStream: any[]) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of mockStream) {
        controller.enqueue(
          encoder.encode(
            `data: ${
              typeof chunk === "string" ? chunk : JSON.stringify(chunk)
            }\n\n`,
          ),
        );
      }
      controller.close();
    },
  });
}

function setupMockFetch(mockResponse?: any, mockStream?: any[]) {
  const mockFetch = vi.fn();

  if (mockStream) {
    const stream = createMockStream(mockStream);
    mockFetch.mockResolvedValue(
      new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
        },
      }),
    );
  } else {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  return mockFetch;
}

function setupReadableStreamPolyfill() {
  // This can be removed if https://github.com/nodejs/undici/issues/2888 is resolved
  // @ts-ignore
  const originalFrom = ReadableStream.from;
  // @ts-ignore
  ReadableStream.from = (body) => {
    if (body?.source) {
      return body;
    }
    return originalFrom(body);
  };
}

async function executeLlmMethod(
  llm: ILLM,
  methodToTest: keyof ILLM,
  params: any[],
) {
  if (typeof (llm as any)[methodToTest] !== "function") {
    throw new Error(
      `Method ${String(methodToTest)} does not exist on the LLM instance.`,
    );
  }

  const result = await (llm as any)[methodToTest](...params);
  if (result?.next) {
    for await (const _ of result) {
    }
  }
}

function assertFetchCall(mockFetch: any, expectedRequest: any) {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const [url, options] = mockFetch.mock.calls[0];

  expect(url.toString()).toBe(expectedRequest.url);
  expect(options.method).toBe(expectedRequest.method);

  if (expectedRequest.headers) {
    expect(options.headers).toEqual(
      expect.objectContaining(expectedRequest.headers),
    );
  }

  if (expectedRequest.body) {
    const actualBody = JSON.parse(options.body as string);
    expect(actualBody).toEqual(expectedRequest.body);
  }
}

async function runLlmTest(testCase: LlmTestCase) {
  const {
    llm,
    methodToTest,
    params,
    expectedRequest,
    mockResponse,
    mockStream,
  } = testCase;

  const mockFetch = setupMockFetch(mockResponse, mockStream);
  setupReadableStreamPolyfill();

  (llm as any).fetch = mockFetch;

  // Disable OpenAI adapter to use our custom fetch mock
  (llm as any).useOpenAIAdapterFor = [];

  await executeLlmMethod(llm, methodToTest, params);
  assertFetchCall(mockFetch, expectedRequest);
}

describe("OpenAI", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("streamChat should send a valid request", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "streamChat",
      params: [
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
      ],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
          max_tokens: 2048,
        },
      },
      mockStream: [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
      ],
    });
  });

  test("chat should send a valid request", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "chat",
      params: [
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
      ],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
          max_tokens: 2048,
        },
      },
      mockStream: [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
      ],
    });
  });

  test("streamComplete should send a valid request", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "streamComplete",
      params: ["Hello", new AbortController().signal],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          max_tokens: 2048,
        },
      },
      mockStream: [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
      ],
    });
  });

  test("complete should send a valid request", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "complete",
      params: ["Hello", new AbortController().signal],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
          max_tokens: 2048,
        },
      },
      mockStream: [
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
      ],
    });
  });

  test("should handle O1 models correctly", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "o3-mini",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "chat",
      params: [
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        { maxTokens: 100 },
      ],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "o3-mini",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
          max_completion_tokens: 100,
        },
      },
      mockStream: [{ choices: [{ delta: { content: "Hello world" } }] }],
    });
  });

  test("should handle tools", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "test_function",
          description: "Test function",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    await runLlmTest({
      llm: openai,
      methodToTest: "chat",
      params: [
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        { tools },
      ],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
          max_tokens: 2048,
          tools: [
            {
              type: "function",
              function: {
                name: "test_function",
                description: "Test function",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        },
      },
      mockStream: [{ choices: [{ delta: { content: "I'll help you" } }] }],
    });
  });

  test("should handle custom max tokens", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "gpt-4",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "chat",
      params: [
        [{ role: "user", content: "hello" }],
        new AbortController().signal,
        { maxTokens: 500 },
      ],
      expectedRequest: {
        url: "https://api.openai.com/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-api-key",
          "api-key": "test-api-key",
        },
        body: {
          model: "gpt-4",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
          max_tokens: 500,
        },
      },
      mockStream: [{ choices: [{ delta: { content: "Hello" } }] }],
    });
  });

  test("should handle embeddings", async () => {
    const openai = new OpenAI({
      apiKey: "test-api-key",
      model: "text-embedding-ada-002",
      apiBase: "https://api.openai.com/v1/",
    });

    await runLlmTest({
      llm: openai,
      methodToTest: "embed",
      params: [["Hello", "World"]],
      expectedRequest: {
        url: "https://api.openai.com/v1/embeddings",
        method: "POST",
        headers: {
          Authorization: "Bearer test-api-key",
          "Content-Type": "application/json",
          "api-key": "test-api-key",
        },
        body: {
          input: ["Hello", "World"],
          model: "text-embedding-ada-002",
        },
      },
      mockResponse: {
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
      },
    });
  });
});
