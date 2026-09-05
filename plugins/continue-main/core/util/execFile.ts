import { execFile } from "node:child_process";

/** Execute a program with an argument vector and no command shell. */
export function execFileWithoutShell(
  executable: string,
  args: readonly string[],
  cwd?: string,
): Promise<[stdout: string, stderr: string]> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve([stdout, stderr]);
    });
  });
}
