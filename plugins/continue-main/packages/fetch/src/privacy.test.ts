import { afterEach, expect, test, vi } from "vitest";
import { Response } from "node-fetch";
vi.mock("./node-fetch-patch.js", () => ({ default: vi.fn() }));
import patchedFetch from "./node-fetch-patch.js";
import { fetchwithRequestOptions } from "./fetch.js";
import { parseDataLine } from "./stream.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
test("verbose HTTP diagnostics omit credentials, bodies and provider errors", async () => {
  vi.stubEnv("VERBOSE_FETCH", "1");
  const logs = vi.spyOn(console, "log").mockImplementation(() => {});
  const key = "test-private-value";
  vi.mocked(patchedFetch).mockResolvedValueOnce(
    new Response("", { status: 200, headers: { "set-cookie": key } }),
  );
  await fetchwithRequestOptions(`https://example.test/${key}?api_key=${key}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: key,
  });
  vi.mocked(patchedFetch).mockRejectedValueOnce(new Error(key));
  await expect(
    fetchwithRequestOptions("https://example.test"),
  ).rejects.toThrow();
  expect(JSON.stringify(logs.mock.calls)).not.toContain(key);
  expect(JSON.stringify(logs.mock.calls)).toContain("HTTP request");
});
test("stream parsing failures do not repeat provider text", () => {
  for (const line of [
    'data: {"error":{"message":"test-private-value"}}',
    "data: {test-private-value",
  ]) {
    try {
      parseDataLine(line);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain("test-private-value");
    }
  }
});
