import { describe, expect, test, vi } from "vitest";
import { PassThrough, Readable } from "node:stream";
import { request as httpsRequest } from "node:https";
import { runBvc } from "../../../packages/bvc/src/index.js";
import GigaChat from "./GigaChat.js";

vi.mock("node:https", () => ({ request: vi.fn() }));

function createLlm(requestOptions?: Record<string, unknown>) {
  return new GigaChat({
    model: "GigaChat",
    apiKey: "test-authorization-key",
    requestOptions,
  } as any) as any;
}

describe("GigaChat transport security", () => {
  test("passes the abort signal and converts configured timeout seconds to milliseconds", async () => {
    const llm = createLlm({ timeout: 300 });
    const signal = new AbortController().signal;
    const req = {
      setTimeout: vi.fn(),
      on: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    };
    const response = streamed("");
    vi.mocked(httpsRequest).mockImplementationOnce((...args: any[]) => {
      queueMicrotask(() => args[2](response));
      return req as any;
    });
    expect(await llm.request("https://example.invalid", "{}", {}, signal)).toBe(
      response,
    );
    expect(httpsRequest).toHaveBeenCalledWith(
      "https://example.invalid",
      expect.objectContaining({ signal, rejectUnauthorized: true }),
      expect.any(Function),
    );
    expect(req.setTimeout).toHaveBeenCalledWith(300000, expect.any(Function));
    expect(req.end).toHaveBeenCalledWith("{}");
  });

  test("verifies TLS certificates by default", () => {
    const llm = createLlm();

    expect(llm.requestOptions.verifySsl).toBe(true);
    expect(llm.getVerifySsl()).toBe(true);
  });

  test("preserves an explicit TLS verification override", () => {
    const llm = createLlm({ verifySsl: false });

    expect(llm.requestOptions.verifySsl).toBe(false);
    expect(llm.getVerifySsl()).toBe(false);
  });

  test("uses the personal API scope unless a scope is configured", () => {
    expect(createLlm().scope).toBe("GIGACHAT_API_PERS");
    expect(
      createLlm({ extraBodyProperties: { scope: "GIGACHAT_API_CORP" } }).scope,
    ).toBe("GIGACHAT_API_CORP");
  });
});

const event = (content: string, finish_reason?: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason }], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`;
function streamed(text: string) {
  return Object.assign(Readable.from([Buffer.from(text)]), { statusCode: 200 });
}
async function chunks(llm: any, signal = new AbortController().signal) {
  const output = [];
  for await (const chunk of llm._streamChat(
    [{ role: "user", content: "Test" }],
    signal,
    {},
  ))
    output.push(chunk);
  return output;
}
function mocked() {
  const llm = createLlm();
  llm.getAccessToken = vi.fn(async () => "test-access-token");
  return llm;
}

describe("GigaChat streaming and completion contract", () => {
  for (const [reason, expected] of [
    ["stop", "stop"],
    ["length", "length"],
    ["blacklist", "refusal"],
  ]) {
    test(`forwards ${reason} and usage`, async () => {
      const llm = mocked();
      llm.request = vi.fn(async () =>
        streamed(event("hello") + event("", reason) + "data: [DONE]\n"),
      );
      const output = await chunks(llm);
      expect(output.at(-1).metadata.finishReason).toBe(expected);
      expect(output.at(-1).usage).toMatchObject({
        promptTokens: 12,
        completionTokens: 7,
      });
    });
  }
  test("yields tokens before the response ends and handles split UTF-8", async () => {
    const llm = mocked();
    const body = Object.assign(new PassThrough(), { statusCode: 200 });
    llm.request = vi.fn(async () => body);
    const iterator = llm._streamChat([], new AbortController().signal, {});
    const next = iterator.next();
    const data = Buffer.from(event("Привет"));
    const cut = data.indexOf("Привет") + 1;
    body.write(data.subarray(0, cut));
    body.write(data.subarray(cut));
    expect((await next).value.content).toBe("Привет");
    body.end(event("", "stop") + "data: [DONE]\n");
    for await (const _chunk of iterator) {
      /* consume terminal metadata */
    }
    expect(body.destroyed).toBe(true);
  });
  for (const tail of [
    "",
    "data: [DONE]\n",
    "data: {bad test-private-content}\n",
    'data: {"error":{"message":"test-private-content"}}\n',
  ]) {
    test("rejects missing completion, malformed events and provider errors without echoing bodies", async () => {
      const llm = mocked();
      llm.request = vi.fn(async () => streamed(event("partial") + tail));
      await expect(chunks(llm)).rejects.toThrow(/GigaChat/);
      try {
        await chunks(llm);
      } catch (error) {
        expect(String(error)).not.toContain("test-private-content");
      }
    });
  }
  test("does not turn an HTTP authentication failure into assistant content", async () => {
    const llm = mocked();
    llm.request = vi.fn(async () =>
      Object.assign(streamed("test-private-content"), { statusCode: 401 }),
    );
    await expect(chunks(llm)).rejects.toThrow("access denied");
  });
  test("cancels a pending stream and stops reading", async () => {
    const llm = mocked();
    const parent = new AbortController();
    const body = Object.assign(new PassThrough(), { statusCode: 200 });
    llm.request = vi.fn(async (_url, _body, _headers, signal) => {
      signal.addEventListener("abort", () =>
        body.destroy(new Error("cancelled")),
      );
      return body;
    });
    const output = chunks(llm, parent.signal);
    await vi.waitFor(() => expect(llm.request).toHaveBeenCalled());
    parent.abort();
    await expect(output).rejects.toMatchObject({ name: "AbortError" });
    expect(body.destroyed).toBe(true);
  });
  test("passes cancellation to OAuth and caches millisecond expiry correctly", async () => {
    const llm = createLlm();
    const signal = new AbortController().signal;
    llm.request = vi.fn(async () =>
      streamed(
        JSON.stringify({
          access_token: "test-access-token",
          expires_at: Date.now() + 1800000,
        }),
      ),
    );
    expect(await llm.getAccessToken(signal)).toBe("test-access-token");
    expect(await llm.getAccessToken(signal)).toBe("test-access-token");
    expect(llm.request).toHaveBeenCalledTimes(1);
    expect(llm.request.mock.calls[0][3]).toBe(signal);
  });
  test("a real GigaChat stream cannot supply a length-limited final BVC plan", async () => {
    const llm = mocked();
    const plan =
      "# Project Plan\n\n## Description\nFix parser.\n\n## Disputed Decisions\nKeep objections.\n\n## File Structure\nsrc/parser.ts\n\n## File Descriptions\nParser.\n\n## Implementation Order\n1. Add tests.\n\n## Technologies\nTypeScript.";
    llm.request = vi.fn(async () =>
      streamed(event(plan) + event("", "length") + "data: [DONE]\n"),
    );
    let result: any;
    for await (const item of runBvc({
      task: "Fix parser",
      roles: [{ name: "Planner", modelId: "GigaChat" }],
      options: { mode: "single", requireConfirmedSynthesis: true },
      adapter: {
        async *stream(request) {
          for await (const chunk of llm._streamChat(
            request.messages,
            request.signal,
            {},
          )) {
            yield {
              text: chunk.content,
              finishReason: chunk.metadata?.finishReason,
            };
          }
        },
      },
    }))
      if (item.type === "complete") result = item.result;
    expect(result.status).toBe("failed");
    expect(result.plan).toBeUndefined();
    expect(result.calls.at(-1).status).toBe("truncated");
  });
});
