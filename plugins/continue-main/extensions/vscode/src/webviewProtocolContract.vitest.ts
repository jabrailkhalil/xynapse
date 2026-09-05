import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

describe("Xynapse webview focus protocol", () => {
  test.each([
    ["commands.ts", "focusXynapseInputWithNewSession"],
    ["commands.ts", "focusXynapseInputWithoutClear"],
    ["diff/vertical/manager.ts", "focusXynapseInputWithoutClear"],
    ["quickEdit/AddCurrentSelection.ts", "focusXynapseInput"],
  ])("%s sends the active %s event", (sourceFile, messageName) => {
    expect(readSource(sourceFile)).toContain(`"${messageName}"`);
  });

  test.each([
    ["commands.ts", 'request("focusInputWithNewSession"'],
    ["commands.ts", 'request("focusInputWithoutClear"'],
    ["diff/vertical/manager.ts", '"focusInputWithoutClear"'],
    ["quickEdit/AddCurrentSelection.ts", 'request("focusInput"'],
  ])("%s does not send retired protocol event %s", (sourceFile, legacyCall) => {
    expect(readSource(sourceFile)).not.toContain(legacyCall);
  });
});
