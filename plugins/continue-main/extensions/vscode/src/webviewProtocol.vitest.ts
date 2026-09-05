import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("vscode", () => ({}));
vi.mock("core/util/posthog", () => ({ Telemetry: { capture: vi.fn() } }));
import { VsCodeWebviewProtocol } from "./webviewProtocol";

afterEach(() => vi.restoreAllMocks());
describe("webview error privacy", () => {
  for (const messageType of [
    "config/addModel",
    "config/importYandexCloud",
    "config/completeOnboarding",
    "llm/streamChat",
  ]) {
    it(`does not expose credentials from a failed ${messageType}`, async () => {
      const key = "test-private-credential-not-real";
      const protocol = new VsCodeWebviewProtocol();
      const replies: unknown[] = [];
      const logs = vi.spyOn(console, "error").mockImplementation(() => {});
      let receive: (value: any) => Promise<void> = async () => {};
      protocol.webview = {
        postMessage: (reply: unknown) => replies.push(reply),
        onDidReceiveMessage: (fn: typeof receive) => {
          receive = fn;
          return { dispose() {} };
        },
      } as any;
      protocol.on(messageType as any, () => {
        throw new Error(`Provider rejected Authorization: Bearer ${key}`);
      });
      await receive({
        messageType,
        messageId: "test-id",
        data: {
          model: { apiKey: key },
          nested: { headers: { Authorization: `Bearer ${key}` } },
        },
      });
      expect(replies).toHaveLength(1);
      expect(JSON.stringify(replies)).not.toContain(key);
      expect(JSON.stringify(logs.mock.calls)).not.toContain(key);
      expect(JSON.stringify(logs.mock.calls)).not.toContain("Authorization");
      expect(JSON.stringify(replies)).toContain('"status":"error"');
    });
  }
  it("preserves streaming success responses", async () => {
    const protocol = new VsCodeWebviewProtocol();
    const replies: any[] = [];
    let receive: (value: any) => Promise<void> = async () => {};
    protocol.webview = {
      postMessage: (reply: unknown) => replies.push(reply),
      onDidReceiveMessage: (fn: typeof receive) => {
        receive = fn;
        return { dispose() {} };
      },
    } as any;
    protocol.on(
      "llm/streamChat" as any,
      async function* () {
        yield "first";
        return "done";
      } as any,
    );
    await receive({
      messageType: "llm/streamChat",
      messageId: "test-id",
      data: {},
    });
    expect(replies.map((reply) => reply.data)).toEqual([
      { done: false, content: "first", status: "success" },
      { done: true, content: "done", status: "success" },
    ]);
  });
});
