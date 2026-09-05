import {
  captureException,
  captureLog,
  createSpan,
  initializeSentry,
  SentryLogger,
} from "./SentryLogger";

describe("SentryLogger (Xynapse distribution)", () => {
  const ideInfo = {
    name: "Xynapse",
    ideType: "vscode",
    version: "1.108.0",
    extensionVersion: "1.1.0",
    remoteName: "local",
    isPrerelease: false,
  } as const;

  beforeEach(() => {
    SentryLogger.allowTelemetry = false;
    SentryLogger.client = undefined;
    SentryLogger.scope = undefined;
  });

  it("stays disabled even when telemetry is requested", async () => {
    await SentryLogger.setup(true, "test-id", ideInfo);
    expect(SentryLogger.allowTelemetry).toBe(false);
    expect(SentryLogger.client).toBeUndefined();
    expect(SentryLogger.scope).toBeUndefined();
    expect(SentryLogger.uniqueId).toBe("test-id");
    expect(SentryLogger.ideInfo).toBe(ideInfo);
  });

  it("returns no remote client or scope", () => {
    expect(initializeSentry()).toEqual({ client: undefined, scope: undefined });
    expect(SentryLogger.lazyClient).toBeUndefined();
    expect(SentryLogger.lazyScope).toBeUndefined();
  });

  it("executes synchronous span callbacks locally", () => {
    expect(createSpan("test", "sync", () => 42)).toBe(42);
  });

  it("executes asynchronous span callbacks locally", async () => {
    await expect(createSpan("test", "async", async () => 42)).resolves.toBe(42);
  });

  it("accepts error and log calls without network clients", () => {
    expect(() => captureException(new Error("local error"), { safe: true })).not.toThrow();
    expect(() => captureLog("local log", "warning", { safe: true })).not.toThrow();
  });

  it("shutdown remains idempotent", () => {
    expect(() => SentryLogger.shutdownSentryClient()).not.toThrow();
    expect(() => SentryLogger.shutdownSentryClient()).not.toThrow();
  });
});
