const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const extensionRoot = path.resolve(__dirname, "..");
const continueRoot = path.resolve(extensionRoot, "..", "..");
const workspaceRoot = path.resolve(continueRoot, "..", "..");
const rustRoot = path.join(workspaceRoot, ".external", "claw-code", "rust");
const manifestPath = path.join(rustRoot, "Cargo.toml");

function isHostTarget(os, arch) {
  const normalizedArch = arch === "x64" || arch === "arm64" ? arch : "";
  return os === process.platform && normalizedArch === process.arch;
}

function copyRuntimeBinary(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Xynapse runtime binary was not found at ${sourcePath}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
  if (process.platform !== "win32") {
    fs.chmodSync(destinationPath, 0o755);
  }
}

function removeLegacyRuntime(exe) {
  for (const fileName of new Set([`claw${exe}`, "claw"])) {
    fs.rmSync(path.join(extensionRoot, "bin", fileName), { force: true });
  }
}

function buildAndCopyXynapseRuntime({ target, os, arch, exe }) {
  const destinationPath = path.join(extensionRoot, "bin", `xynapse${exe}`);
  const explicitRuntime = process.env.XYNAPSE_RUNTIME_BINARY;

  removeLegacyRuntime(exe);

  if (explicitRuntime) {
    copyRuntimeBinary(explicitRuntime, destinationPath);
    console.log(`[info] Copied Xynapse runtime from ${explicitRuntime}`);
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Xynapse runtime Cargo manifest was not found at ${manifestPath}`);
  }

  if (!isHostTarget(os, arch)) {
    throw new Error(
      `Cannot build Xynapse runtime for ${target} from host ${process.platform}-${process.arch}. ` +
        "Set XYNAPSE_RUNTIME_BINARY to a prebuilt target runtime.",
    );
  }

  console.log(`[info] Building Xynapse runtime for ${target}`);
  execFileSync(
    "cargo",
    ["build", "--release", "--manifest-path", manifestPath, "--bin", "xynapse"],
    {
      cwd: rustRoot,
      stdio: "inherit",
    },
  );

  const builtBinaryPath = path.join(rustRoot, "target", "release", `xynapse${exe}`);
  copyRuntimeBinary(builtBinaryPath, destinationPath);
  console.log(`[info] Copied Xynapse runtime to ${destinationPath}`);
}

module.exports = { buildAndCopyXynapseRuntime };
