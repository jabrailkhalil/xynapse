import { describe, expect, it, vi } from "vitest";

import type { ChatMessage, ILLM, XynapseSDK } from "../../../index.js";

vi.mock("../../../indexing/ignore.js", () => ({
  DEFAULT_IGNORE: [],
  gitIgArrayFromFile: () => [],
}));
vi.mock("../../../indexing/xynapseignore.js", () => ({
  getGlobalXynapseIgArray: () => [],
}));

import { BvcCommand } from "./council.js";

const plan = `# Project Plan

## Description
Preserve empty parser inputs.

## Disputed Decisions
No unresolved objections.

## File Structure
src/parser.ts

## File Descriptions
The parser implementation.

## Implementation Order
1. Add an empty-input regression test, fix parsing, and run the test.

## Technologies
TypeScript.
`;
const decisions = JSON.stringify({
  bvc_decisions: {
    root_cause_location: "src/parser.ts",
    fix_strategy: "preserve empty inputs",
    dependencies_to_update: "NA",
    test_coverage: "add parser unit tests",
  },
});

type StreamHandler = (args: {
  messages: ChatMessage[];
  isPlan: boolean;
  signal: AbortSignal;
}) => AsyncGenerator<ChatMessage>;

function fixture(handler?: StreamHandler) {
  const requests: ChatMessage[][] = [];
  const abortController = new AbortController();
  const model = {
    title: "Local model",
    model: "local-test",
    providerName: "mock",
    uniqueId: "None",
    async *streamChat(messages: ChatMessage[], signal: AbortSignal) {
      requests.push(messages);
      const isPlan = messages.some(
        (message) =>
          message.role === "system" &&
          String(message.content).includes("FINAL PROJECT PLAN"),
      );
      if (handler) {
        yield* handler({ messages, isPlan, signal });
        return;
      }
      yield {
        role: "assistant" as const,
        content: isPlan ? plan : decisions,
        metadata: { finishReason: "stop" },
      };
    },
  } as unknown as ILLM;
  const ide = {
    getWorkspaceDirs: vi.fn(async () => ["file:///workspace"]),
    listDir: vi.fn(async () => []),
    fileExists: vi.fn(async () => false),
    readFile: vi.fn(async () => ""),
    readRangeInFile: vi.fn(async () => "return input ?? '';"),
    writeFile: vi.fn(async () => undefined),
    openFile: vi.fn(async () => undefined),
    showVirtualFile: vi.fn(async () => undefined),
  };
  const sdk = {
    ide,
    llm: model,
    input: "easy Fix empty inputs in src/parser.ts",
    config: { modelsByRole: { chat: [model] } },
    contextItems: [],
    selectedCode: [],
    abortController,
  } as unknown as XynapseSDK;
  return { sdk, ide, model, requests, abortController };
}

async function consume(sdk: XynapseSDK, onChunk?: (chunk: string) => void) {
  let output = "";
  for await (const chunk of BvcCommand.run(sdk)) {
    if (chunk) {
      output += chunk;
      onChunk?.(chunk);
    }
  }
  return output;
}

describe("BVC slash-command integration", () => {
  it("keeps explicit /bvc in council mode and saves a completed plan", async () => {
    const { sdk, ide, requests } = fixture();
    const output = await consume(sdk);
    expect(requests).toHaveLength(5);
    expect(output).toContain("**Mode:** council");
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///workspace/bvc-plan.md",
      plan,
    );
    expect(ide.writeFile).toHaveBeenCalledWith(
      "file:///workspace/bvc-discussion.md",
      expect.stringContaining("**Verification:** not_run"),
    );
  });

  it("passes attached context and selected code to the model", async () => {
    const { sdk, ide, requests } = fixture();
    sdk.contextItems = [
      {
        name: "Parser constraints",
        content: "Keep empty strings valid.",
        description: "Requirements",
        id: { providerTitle: "test", itemId: "constraints" },
      },
    ];
    sdk.selectedCode = [
      {
        filepath: "file:///workspace/src/parser.ts",
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 18 },
        },
      },
    ];
    await consume(sdk);
    expect(ide.readRangeInFile).toHaveBeenCalledWith(
      sdk.selectedCode[0].filepath,
      sdk.selectedCode[0].range,
    );
    const prompt = requests[0].map((message) => message.content).join("\n");
    expect(prompt).toContain("Keep empty strings valid.");
    expect(prompt).toContain("return input ?? '';");
  });

  it("does not silently restore adaptive routing from legacy GUI settings", async () => {
    const { sdk, requests } = fixture();
    sdk.input = `${JSON.stringify({
      difficulty: "easy",
      roles: ["Architect", "Developer", "Reviewer", "Tester"].map((name) => ({
        name,
        modelTitle: "Local model",
      })),
      bvcParams: { selectiveActivation: true },
    })}\nFix empty inputs in src/parser.ts`;
    const output = await consume(sdk);
    expect(output).toContain("**Mode:** council");
    expect(requests).toHaveLength(5);
  });

  it("keeps different configured models when both have the default None identifier", async () => {
    const { sdk, model, requests } = fixture();
    const secondStream = vi.fn(model.streamChat.bind(model));
    const secondModel = {
      ...model,
      title: "Second model",
      model: "other-test",
      streamChat: secondStream,
    };
    sdk.config.modelsByRole.chat = [model, secondModel];
    await consume(sdk);
    expect(requests).toHaveLength(5);
    expect(secondStream).toHaveBeenCalledTimes(2);
  });

  it.each(["length", "content_filter"])(
    "does not save a syntactically valid plan with finish reason %s",
    async (finishReason) => {
      const { sdk, ide } = fixture(async function* ({ isPlan }) {
        yield {
          role: "assistant",
          content: isPlan ? plan : decisions,
          metadata: { finishReason: isPlan ? finishReason : "stop" },
        };
      });
      expect(await consume(sdk)).toContain("No plan saved");
      expect(ide.writeFile).not.toHaveBeenCalled();
    },
  );

  it("rejects plan text followed by a transport error", async () => {
    const { sdk, ide } = fixture(async function* ({ isPlan }) {
      yield {
        role: "assistant",
        content: isPlan ? plan : decisions,
      };
      if (isPlan) throw new Error("connection interrupted");
      yield {
        role: "assistant",
        content: "",
        metadata: { finishReason: "stop" },
      };
    });
    expect(await consume(sdk)).toContain("No plan saved");
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("honors truncation metadata carried by a thinking chunk", async () => {
    const { sdk, ide } = fixture(async function* ({ isPlan }) {
      yield {
        role: "assistant",
        content: isPlan ? plan : decisions,
      };
      if (isPlan) {
        yield {
          role: "thinking",
          content: "private reasoning should not enter the saved report",
          metadata: { finishReason: "length" },
        };
      } else {
        yield {
          role: "assistant",
          content: "",
          metadata: { finishReason: "stop" },
        };
      }
    });
    const output = await consume(sdk);
    expect(output).toContain("No plan saved");
    expect(output).not.toContain("private reasoning");
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("does not save or start subsequent calls after cancellation", async () => {
    const fixtureResult = fixture(async function* () {
      yield { role: "assistant", content: decisions };
      fixtureResult.abortController.abort();
    });
    await consume(fixtureResult.sdk);
    expect(fixtureResult.requests).toHaveLength(1);
    expect(fixtureResult.ide.writeFile).not.toHaveBeenCalled();
  });

  it("honors cancellation after synthesis but before persistence", async () => {
    const { sdk, ide, abortController } = fixture();
    await consume(sdk, (chunk) => {
      if (chunk.includes("**Run:**")) abortController.abort();
    });
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("reports an unavailable selected model without calling a substitute", async () => {
    const { sdk, ide, requests } = fixture();
    sdk.input = `${JSON.stringify({
      difficulty: "easy",
      roles: [{ name: "Architect", modelTitle: "Missing model" }],
    })}\nFix the parser`;
    expect(await consume(sdk)).toContain("unavailable models: Missing model");
    expect(requests).toHaveLength(0);
    expect(ide.writeFile).not.toHaveBeenCalled();
  });

  it("opens a completed plan in memory when there is no workspace", async () => {
    const { sdk, ide } = fixture();
    ide.getWorkspaceDirs.mockResolvedValue([]);
    await consume(sdk);
    expect(ide.showVirtualFile).toHaveBeenCalledWith("bvc-plan.md", plan);
    expect(ide.writeFile).not.toHaveBeenCalled();
  });
  it("does not save a final plan with unknown completion metadata", async () => {
    const { sdk, ide } = fixture(async function* ({ isPlan }) {
      yield { role: "assistant", content: isPlan ? plan : decisions };
    });
    expect(await consume(sdk)).toContain("unconfirmed provider completion");
    expect(ide.writeFile).not.toHaveBeenCalled();
  });
});
