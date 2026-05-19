#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const childProcess = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

const extensionRoots = [
  {
    name: "source",
    root: path.join(repoRoot, "vscode", "extensions", "xynapse-assistant"),
    required: true,
  },
  {
    name: "app",
    root: path.join(
      repoRoot,
      "VSCode-win32-x64",
      "resources",
      "app",
      "extensions",
      "xynapse-assistant",
    ),
    required: false,
  },
  {
    name: "portable",
    root: path.join(
      repoRoot,
      "portable-build",
      "xynapse-portable",
      "resources",
      "app",
      "extensions",
      "xynapse-assistant",
    ),
    required: false,
  },
];

const parityFiles = [
  "xynapse-config.yaml",
  "config_schema.json",
  "xynapse_rc_schema.json",
  path.join("out", "extension.js"),
  path.join("gui", "assets", "index.js"),
];

const connectorProviders = new Set(["yandex_gpt", "gigachat"]);

function fail(message) {
  failures.push(message);
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseModelsFromConfig(configPath) {
  const lines = readText(configPath).split(/\r?\n/);
  const models = [];
  let inModels = false;
  let inRoles = false;
  let current = null;

  const flush = () => {
    if (current) {
      current.roles = Array.from(new Set(current.roles));
      models.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    if (/^\s*models:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels && /^\S/.test(line) && !/^\s*-\s/.test(line)) {
      flush();
      break;
    }
    if (!inModels) {
      continue;
    }

    const modelStart = line.match(/^\s{2}-\s+name:\s*(.+?)\s*$/);
    if (modelStart) {
      flush();
      current = {
        name: parseScalar(modelStart[1]),
        provider: "",
        model: "",
        folderId: "",
        roles: [],
      };
      inRoles = false;
      continue;
    }
    if (!current) {
      continue;
    }

    const keyValue = line.match(/^\s{4}([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (keyValue) {
      const [, key, value] = keyValue;
      inRoles = key === "roles";
      if (key === "provider" || key === "model" || key === "folderId") {
        current[key] = parseScalar(value);
      }
      continue;
    }

    if (inRoles) {
      const role = line.match(/^\s{6}-\s*(.+?)\s*$/);
      if (role) {
        current.roles.push(parseScalar(role[1]));
      }
    }
  }
  flush();
  return models;
}

function normalizeModels(models) {
  return models
    .map((model) =>
      [
        model.name,
        model.provider,
        model.model,
        model.folderId ? "<folderId>" : "",
        model.roles.slice().sort().join(","),
      ].join("|"),
    )
    .sort();
}

function providerCounts(models) {
  const counts = new Map();
  for (const model of models) {
    counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, count]) => `${provider}:${count}`)
    .join(", ");
}

function roleCounts(models) {
  const counts = new Map();
  for (const model of models) {
    for (const role of model.roles) {
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role}:${count}`)
    .join(", ");
}

function runtimeSupported(model) {
  const provider = model.provider.toLowerCase();
  const modelName = model.model.toLowerCase();
  if (provider.includes("yandex") || model.folderId || modelName.startsWith("gpt://")) {
    return true;
  }
  if (provider.includes("anthropic")) {
    return true;
  }
  if (
    provider.includes("openai") ||
    provider.includes("deepseek") ||
    modelName.includes("deepseek")
  ) {
    return true;
  }
  if (provider.includes("xai") || provider.includes("grok") || modelName.includes("grok")) {
    return true;
  }
  if (provider.includes("dashscope") || provider === "qwen" || provider === "kimi") {
    return true;
  }
  return false;
}

function packageConnectorKeys(packagePath) {
  const data = JSON.parse(readText(packagePath));
  return {
    name: data.name,
    publisher: data.publisher,
  };
}

function runHelp(binaryPath) {
  try {
    return childProcess.execFileSync(binaryPath, ["--help"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    });
  } catch (error) {
    return String(error.stdout || error.stderr || error.message || error);
  }
}

function nodeCheck(jsPath) {
  try {
    childProcess.execFileSync(process.execPath, ["--check", jsPath], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
    });
    return "";
  } catch (error) {
    return String(error.stdout || error.stderr || error.message || error);
  }
}

const failures = [];
const presentRoots = extensionRoots.filter((entry) => exists(entry.root));

for (const entry of extensionRoots) {
  if (entry.required && !exists(entry.root)) {
    fail(`${entry.name}: missing extension root ${entry.root}`);
  }
}

const source = presentRoots.find((entry) => entry.name === "source");
if (!source) {
  console.error("Missing source extension root.");
  process.exit(1);
}

const sourceConfigPath = path.join(source.root, "xynapse-config.yaml");
const sourceModels = parseModelsFromConfig(sourceConfigPath);
const sourceSignature = normalizeModels(sourceModels);

console.log("Xynapse connector audit");
console.log(`- source models: ${sourceModels.length} (${providerCounts(sourceModels)})`);
console.log(`- source roles: ${roleCounts(sourceModels)}`);

for (const provider of new Set(sourceModels.map((model) => model.provider))) {
  if (!connectorProviders.has(provider)) {
    fail(`source: unknown configured provider "${provider}"`);
  }
}

for (const entry of presentRoots) {
  console.log(`\n[${entry.name}] ${entry.root}`);

  for (const file of [
    "package.json",
    "xynapse-config.yaml",
    "config_schema.json",
    "xynapse_rc_schema.json",
    path.join("out", "extension.js"),
    path.join("gui", "assets", "index.js"),
    path.join("bin", process.platform === "win32" ? "xynapse.exe" : "xynapse"),
  ]) {
    const fullPath = path.join(entry.root, file);
    if (!exists(fullPath)) {
      fail(`${entry.name}: missing ${file}`);
      continue;
    }
    console.log(`  ok ${file}`);
  }

  const legacyRuntime = path.join(entry.root, "bin", process.platform === "win32" ? "claw.exe" : "claw");
  if (exists(legacyRuntime)) {
    fail(`${entry.name}: legacy runtime still present at ${path.relative(repoRoot, legacyRuntime)}`);
  }

  const packagePath = path.join(entry.root, "package.json");
  if (exists(packagePath)) {
    const keys = packageConnectorKeys(packagePath);
    if (keys.name !== "xynapse-assistant" || keys.publisher !== "xynapse") {
      fail(`${entry.name}: package identity is ${keys.publisher}.${keys.name}, expected xynapse.xynapse-assistant`);
    }
  }

  const configPath = path.join(entry.root, "xynapse-config.yaml");
  if (exists(configPath)) {
    const models = parseModelsFromConfig(configPath);
    const signature = normalizeModels(models);
    console.log(`  models ${models.length} (${providerCounts(models)})`);
    if (JSON.stringify(signature) !== JSON.stringify(sourceSignature)) {
      fail(`${entry.name}: xynapse-config.yaml model list differs from source`);
    }
  }

  const extensionJs = path.join(entry.root, "out", "extension.js");
  if (exists(extensionJs)) {
    const syntaxError = nodeCheck(extensionJs);
    if (syntaxError) {
      fail(`${entry.name}: out/extension.js syntax check failed: ${syntaxError.split(/\r?\n/)[0]}`);
    }
    const bundled = readText(extensionJs);
    for (const provider of connectorProviders) {
      if (!bundled.includes(`"${provider}"`) && !bundled.includes(`'${provider}'`)) {
        fail(`${entry.name}: bundled extension does not contain provider ${provider}`);
      }
    }
  }

  const guiJs = path.join(entry.root, "gui", "assets", "index.js");
  if (exists(guiJs)) {
    const syntaxError = nodeCheck(guiJs);
    if (syntaxError) {
      fail(`${entry.name}: gui/assets/index.js syntax check failed: ${syntaxError.split(/\r?\n/)[0]}`);
    }
    const bundled = readText(guiJs);
    for (const marker of ["XynapseFindCoreRuntimeModel", "XynapseCollectCoreRuntimeModels"]) {
      if (!bundled.includes(marker)) {
        fail(`${entry.name}: bundled GUI is missing ${marker}`);
      }
    }
  }

  const runtimePath = path.join(entry.root, "bin", process.platform === "win32" ? "xynapse.exe" : "xynapse");
  if (exists(runtimePath)) {
    const help = runHelp(runtimePath);
    if (!help.includes("Xynapse runtime") || !help.includes("Usage:")) {
      fail(`${entry.name}: runtime help does not look like Xynapse runtime`);
    }
  }
}

for (const file of parityFiles) {
  const sourceFile = path.join(source.root, file);
  if (!exists(sourceFile)) {
    continue;
  }
  const sourceHash = sha256(sourceFile);
  for (const entry of presentRoots.filter((item) => item.name !== "source")) {
    const candidate = path.join(entry.root, file);
    if (exists(candidate) && sha256(candidate) !== sourceHash) {
      fail(`${entry.name}: ${file} differs from source`);
    }
  }
}

const runtimeModels = sourceModels.filter(runtimeSupported);
const chatRuntimeModels = runtimeModels.filter((model) => model.roles.includes("chat"));
const unsupportedRuntimeModels = sourceModels.filter((model) => !runtimeSupported(model));
if (chatRuntimeModels.length === 0) {
  fail("source: no chat-capable model is supported by Xynapse Core runtime");
}

console.log("\nConnector matrix:");
console.log("- IDE chat providers: yandex_gpt OK, gigachat OK");
console.log(`- Core runtime models: ${runtimeModels.length} supported`);
console.log(
  `- Core runtime unsupported by design: ${
    unsupportedRuntimeModels.length
      ? unsupportedRuntimeModels.map((model) => `${model.name} (${model.provider})`).join(", ")
      : "none"
  }`,
);

if (failures.length > 0) {
  console.error("\nFAILED");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("\nOK: source, app, and portable connector bundles are in sync.");
