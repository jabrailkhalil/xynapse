import { afterEach, describe, expect, test, vi } from "vitest";
import { Readable } from "node:stream";
import { AssistantChatMessage, ChatMessage, Tool } from "../../index.js";
import YandexGpt from "./YandexGpt.js";

const ACTIVE_MODELS = [
  "yandexgpt-5-pro",
  "yandexgpt-5.1",
  "yandexgpt-5-lite",
  "aliceai-llm",
  "aliceai-llm-flash",
  "deepseek-v4-flash",
  "qwen3-235b-a22b-fp8",
  "qwen3.6-35b-a3b",
  "gpt-oss-120b",
  "gpt-oss-20b",
] as const;

const TEST_TOOL: Tool = {
  type: "function",
  displayTitle: "Read file",
  wouldLikeTo: "read a file",
  isCurrently: "reading a file",
  hasAlready: "read a file",
  readonly: true,
  group: "File",
  function: {
    name: "read_file",
    description: "Read a workspace file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
};

function sseResponse(chunks: unknown[], status = 200): Response {
  const lines = [
    ...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`),
    "data: [DONE]\n\n",
  ].map((line) => Buffer.from(line, "utf8"));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: Readable.from(lines),
    text: async () => "",
    headers: new Headers({ "Content-Type": "text/event-stream" }),
  } as unknown as Response;
}

function completionChunk(delta: Record<string, unknown>) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test",
    choices: [{ index: 0, delta, finish_reason: null }],
  };
}

function createLlm(model = "yandexgpt-5-pro", overrides = {}) {
  return new YandexGpt({
    model,
    apiKey: "test-api-key",
    folderId: "test-folder",
    ...overrides,
  } as any);
}

async function collect(
  llm: YandexGpt,
  messages: ChatMessage[] = [{ role: "user", content: "Hello" }],
  options: Record<string, unknown> = {},
) {
  const result: ChatMessage[] = [];
  for await (const chunk of (llm as any)._streamChat(
    messages,
    new AbortController().signal,
    options,
  )) {
    result.push(chunk);
  }
  return result;
}

function mockSuccessfulFetch(llm: YandexGpt) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(sseResponse([completionChunk({ content: "OK" })]));
  (llm as any).fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.XYNAPSE_TEST_YANDEX_KEY;
  delete process.env.XYNAPSE_TEST_YANDEX_FOLDER;
});

describe("YandexGpt OpenAI-compatible transport", () => {
  test.each(ACTIVE_MODELS)(
    "normalizes active model %s to its canonical latest URI",
    async (model) => {
      const llm = createLlm(model);
      const fetchMock = mockSuccessfulFetch(llm);

      await collect(llm);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://ai.api.cloud.yandex.net/v1/chat/completions");
      const body = JSON.parse(init.body);
      expect(body.model).toBe(`gpt://test-folder/${model}/latest`);
      expect(body.stream).toBe(true);
    },
  );

  test.each(ACTIVE_MODELS)("passes tools to active model %s", async (model) => {
    const llm = createLlm(model);
    const fetchMock = mockSuccessfulFetch(llm);

    await collect(llm, undefined, {
      tools: [TEST_TOOL],
      toolChoice: { type: "function", function: { name: "read_file" } },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Read a workspace file",
          parameters: TEST_TOOL.function.parameters,
        },
      },
    ]);
    expect(body.tool_choice.function.name).toBe("read_file");
  });

  test("preserves a full model URI", async () => {
    const llm = createLlm("gpt://another-folder/qwen3.6-35b-a3b/latest", {
      folderId: "",
    });
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "gpt://another-folder/qwen3.6-35b-a3b/latest",
    );
  });

  test("preserves an explicit model version", async () => {
    const llm = createLlm("yandexgpt/rc");
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "gpt://test-folder/yandexgpt/rc",
    );
  });

  test("sends API-key auth and folder scope without leaking credentials into body", async () => {
    const llm = createLlm();
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm);

    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Api-Key test-api-key");
    expect(init.headers["x-folder-id"]).toBe("test-folder");
    expect(init.body).not.toContain("test-api-key");
  });

  test("resolves credential environment placeholders", async () => {
    process.env.XYNAPSE_TEST_YANDEX_KEY = "env-key";
    process.env.XYNAPSE_TEST_YANDEX_FOLDER = "env-folder";
    const llm = createLlm(undefined, {
      apiKey: "${XYNAPSE_TEST_YANDEX_KEY}",
      folderId: "$XYNAPSE_TEST_YANDEX_FOLDER",
    });
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Api-Key env-key",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toContain(
      "gpt://env-folder/",
    );
  });

  test("supports the historical API_KEY:FOLDER_ID format", async () => {
    const llm = createLlm(undefined, {
      apiKey: "bundled-key:bundled-folder",
      folderId: undefined,
    });
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Api-Key bundled-key",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toContain(
      "gpt://bundled-folder/",
    );
  });

  test("rejects a missing API key before making a request", async () => {
    const llm = createLlm(undefined, { apiKey: "" });
    const fetchMock = vi.fn();
    (llm as any).fetch = fetchMock;
    await expect(collect(llm)).rejects.toThrow("API key is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a missing folder for a short model name", async () => {
    const llm = createLlm(undefined, { folderId: "" });
    const fetchMock = vi.fn();
    (llm as any).fetch = fetchMock;
    await expect(collect(llm)).rejects.toThrow("folder ID is missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("converts assistant tool calls and tool results", async () => {
    const llm = createLlm();
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm, [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      { role: "tool", toolCallId: "call-1", content: "source" },
    ]);

    const messages = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(messages[0].tool_calls[0].function.name).toBe("read_file");
    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: "source",
    });
  });

  test("filters internal thinking messages from the request", async () => {
    const llm = createLlm();
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm, [
      { role: "thinking", content: "private chain" },
      { role: "user", content: "Question" },
    ] as ChatMessage[]);
    const messages = JSON.parse(fetchMock.mock.calls[0][1].body).messages;
    expect(messages).toEqual([{ role: "user", content: "Question" }]);
  });

  test("forwards completion controls", async () => {
    const llm = createLlm();
    const fetchMock = mockSuccessfulFetch(llm);
    await collect(llm, undefined, {
      maxTokens: 321,
      temperature: 0.15,
      topP: 0.8,
      stop: ["END"],
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      max_tokens: 321,
      temperature: 0.15,
      top_p: 0.8,
      stop: ["END"],
    });
  });

  test("parses text, reasoning and tool-call SSE deltas", async () => {
    const llm = createLlm();
    (llm as any).fetch = vi.fn().mockResolvedValue(
      sseResponse([
        completionChunk({ reasoning_content: "check" }),
        completionChunk({ content: "answer" }),
        completionChunk({
          tool_calls: [
            {
              index: 0,
              id: "call-1",
              type: "function",
              function: { name: "read_file", arguments: '{"path":"a"}' },
            },
          ],
        }),
      ]),
    );
    const chunks = await collect(llm);
    expect(chunks.map((chunk) => chunk.role)).toEqual([
      "thinking",
      "assistant",
      "assistant",
    ]);
    expect((chunks[2] as AssistantChatMessage).toolCalls?.[0].id).toBe(
      "call-1",
    );
  });

  test("throws an actionable HTTP error", async () => {
    const llm = createLlm();
    (llm as any).fetch = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"invalid model"}}', {
        status: 400,
      }),
    );
    await expect(collect(llm)).rejects.toThrow(
      "Yandex Cloud API request failed (400)",
    );
  });
});
