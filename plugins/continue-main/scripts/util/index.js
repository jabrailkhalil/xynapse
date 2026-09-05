const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function execCmdSync(command, options = {}) {
  console.log(`[cmd] ${command}`);
  execSync(command, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: "inherit",
  });
}

function autodetectPlatformAndArch() {
  const os = process.platform;
  const archMap = {
    arm: "armhf",
    arm64: "arm64",
    ia32: "x64",
    x64: "x64",
  };
  return [os, archMap[process.arch] ?? process.arch];
}

function validateFilesPresent(files) {
  const missing = files.filter((filePath) => {
    return !fs.existsSync(path.resolve(process.cwd(), filePath));
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing files required for packaging:\n${missing
        .map((filePath) => `  - ${filePath}`)
        .join("\n")}`,
    );
  }

  console.log(`[info] Validated ${files.length} packaging files`);
}

module.exports = {
  autodetectPlatformAndArch,
  execCmdSync,
  validateFilesPresent,
};
