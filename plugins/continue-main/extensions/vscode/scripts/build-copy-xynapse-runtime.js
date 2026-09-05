const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

const extensionRoot = path.resolve(__dirname, "..");
const continueRoot = path.resolve(extensionRoot, "..", "..");
const workspaceRoot = path.resolve(continueRoot, "..", "..");
const rustRoot = path.join(workspaceRoot, "runtime");
const manifestPath = path.join(rustRoot, "Cargo.toml");

function isHostTarget(os, arch) {
  const normalizedArch = arch === "x64" || arch === "arm64" ? arch : "";
  return os === process.platform && normalizedArch === process.arch;
}

function validateRuntimeBinary(data, target, expectedHash) {
  if (
    expectedHash &&
    createHash("sha256").update(data).digest("hex") !==
      expectedHash.toLowerCase()
  ) {
    throw new Error("Xynapse runtime SHA-256 does not match the pinned input");
  }
  const [os, arch] = target.split("-");
  let matches = false;
  if (
    os === "win32" &&
    data.length > 64 &&
    data.toString("ascii", 0, 2) === "MZ"
  ) {
    const pe = data.readUInt32LE(0x3c);
    matches =
      pe + 6 <= data.length &&
      data.readUInt32LE(pe) === 0x4550 &&
      data.readUInt16LE(pe + 4) === (arch === "x64" ? 0x8664 : 0xaa64);
  } else if (
    ["linux", "alpine"].includes(os) &&
    data.length > 20 &&
    data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  ) {
    matches =
      data[4] === 2 &&
      data[5] === 1 &&
      data.readUInt16LE(18) === (arch === "x64" ? 62 : 183);
  } else if (
    os === "darwin" &&
    data.length > 8 &&
    data.readUInt32LE(0) === 0xfeedfacf
  ) {
    matches =
      data.readUInt32LE(4) === (arch === "x64" ? 0x01000007 : 0x0100000c);
  }
  if (!["x64", "arm64"].includes(arch) || !matches)
    throw new Error(`Xynapse runtime binary does not match ${target}`);
}

function copyRuntimeBinary(sourcePath, destinationPath, target, expectedHash) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Xynapse runtime binary was not found at ${sourcePath}`);
  }

  validateRuntimeBinary(fs.readFileSync(sourcePath), target, expectedHash);
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
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(
    path.join(rustRoot, "LICENSE"),
    path.join(extensionRoot, "bin", "LICENSE.claw-code.txt"),
  );

  if (explicitRuntime) {
    const expectedHash = process.env.XYNAPSE_RUNTIME_SHA256;
    if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash))
      throw new Error(
        "Set XYNAPSE_RUNTIME_SHA256 for the prebuilt runtime input",
      );
    copyRuntimeBinary(explicitRuntime, destinationPath, target, expectedHash);
    console.log(`[info] Copied Xynapse runtime from ${explicitRuntime}`);
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `Xynapse runtime Cargo manifest was not found at ${manifestPath}`,
    );
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
    [
      "build",
      "--locked",
      "--release",
      "--manifest-path",
      manifestPath,
      "--bin",
      "xynapse",
    ],
    {
      cwd: rustRoot,
      stdio: "inherit",
    },
  );

  const cargoTargetDir = process.env.CARGO_TARGET_DIR
    ? path.resolve(rustRoot, process.env.CARGO_TARGET_DIR)
    : path.join(rustRoot, "target");
  const builtBinaryPath = path.join(cargoTargetDir, "release", `xynapse${exe}`);
  copyRuntimeBinary(builtBinaryPath, destinationPath, target);
  console.log(`[info] Copied Xynapse runtime to ${destinationPath}`);
}

module.exports = { buildAndCopyXynapseRuntime, validateRuntimeBinary };
