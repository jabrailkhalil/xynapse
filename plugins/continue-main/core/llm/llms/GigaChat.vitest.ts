import { describe, expect, test } from "vitest";
import GigaChat from "./GigaChat.js";

function createLlm(requestOptions?: Record<string, unknown>) {
  return new GigaChat({
    model: "GigaChat",
    apiKey: "test-authorization-key",
    requestOptions,
  } as any) as any;
}

describe("GigaChat transport security", () => {
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
      createLlm({ extraBodyProperties: { scope: "GIGACHAT_API_CORP" } })
        .scope,
    ).toBe("GIGACHAT_API_CORP");
  });
});
