import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { execFileWithoutShell } from "./execFile.js";

describe("execFileWithoutShell", () => {
  const marker = path.join(
    os.tmpdir(),
    `xynapse-shell-injection-${process.pid}-${Date.now()}`,
  );

  afterAll(() => {
    fs.rmSync(marker, { force: true });
  });

  const dangerousArguments = [
    "; echo INJECTED",
    "safe && echo INJECTED",
    "safe || echo INJECTED",
    "safe | echo INJECTED",
    "$(echo INJECTED)",
    "`echo INJECTED`",
    "$HOME",
    "%USERPROFILE%",
    "message > injected.txt",
    "line1\necho INJECTED\nline3",
    `; node -e "require('fs').writeFileSync('${marker}', 'bad')"`,
  ];

  it.each(dangerousArguments)(
    "passes %s as literal data without shell interpretation",
    async (argument) => {
      const [stdout] = await execFileWithoutShell(process.execPath, [
        "-e",
        "process.stdout.write(process.argv[1])",
        argument,
      ]);

      expect(stdout).toBe(argument);
      expect(fs.existsSync(marker)).toBe(false);
    },
  );
});
