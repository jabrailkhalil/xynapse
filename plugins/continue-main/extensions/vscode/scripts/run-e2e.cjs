// Isolated, cross-platform desktop tests. Test configuration uses local fake LLMs.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const extensionRoot = path.resolve(__dirname, "..");
const version = process.env.XYNAPSE_E2E_CODE_VERSION || "1.108.0";
const storage = path.resolve(process.env.XYNAPSE_E2E_STORAGE || path.join(extensionRoot, "e2e/storage"));
const fixture = path.join(extensionRoot, "e2e", process.env.XYNAPSE_E2E_YAML === "1" || process.argv.includes("--yaml") ? "test-xynapse-yaml" : "test-xynapse");
const run = fs.mkdtempSync(path.join(os.tmpdir(), "xynapse-e2e-"));
const config = path.join(run, "config");
const workspace = path.join(run, "workspace");
const extensions = path.join(run, "extensions");
for (const directory of [storage, config, workspace, extensions]) fs.mkdirSync(directory, { recursive: true });
for (const name of ["config.json", "config.yaml"]) {
  const source = path.join(fixture, name);
  if (!fs.existsSync(source)) continue;
  let content = fs.readFileSync(source, "utf8");
  if (name.endsWith(".json")) {
    const value = JSON.parse(content);
    delete value.analytics;
    value.allowAnonymousTelemetry = false;
    content = JSON.stringify(value, null, 2);
  } else {
    content += "\nallowAnonymousTelemetry: false\n";
  }
  fs.writeFileSync(path.join(config, name), content);
}
const settings = path.join(run, "settings.json");
fs.writeFileSync(settings, JSON.stringify({
  "telemetry.telemetryLevel": "off", "update.mode": "none",
  "extensions.autoUpdate": false, "extensions.autoCheckUpdates": false,
  "extensions.ignoreRecommendations": true, "git.autoRepositoryDetection": false,
  "xynapse.enableNextEdit": false, "xynapse.pauseCodebaseIndexOnStart": true,
  "xynapse.showInlineTip": false, "window.zoomLevel": 0,
  // ExTester's TextEditor API requires Monaco's textarea input implementation.
  "editor.editContext": false,
}));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|FOLDER_ID|VSCODE_PORTABLE|ELECTRON_RUN_AS_NODE/i.test(key)));
Object.assign(env, { NODE_ENV: "e2e", XYNAPSE_GLOBAL_DIR: config, CONTINUE_GLOBAL_DIR: config,
  XYNAPSE_E2E_WORKSPACE: workspace, XYNAPSE_E2E_NON_NEXT_EDIT_TEST: "true", DO_NOT_TRACK: "1",
});
const cli = path.join(extensionRoot, "node_modules/vscode-extension-tester/out/cli.js");
function execute(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: extensionRoot, env, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.argv.includes("--setup") || process.argv.includes("--setup-only")) {
  for (const command of ["get-vscode", "get-chromedriver"]) execute([command, "--storage", storage, "--code_version", version]);
}
if (process.argv.includes("--setup-only")) process.exit(0);
// ExTester overwrites EXTENSION_DEV_PATH; install into the isolated extensions folder.
if (process.env.XYNAPSE_E2E_EXTENSION_PATH) {
  const payload = path.resolve(process.env.XYNAPSE_E2E_EXTENSION_PATH);
  if (payload === extensionRoot) throw new Error("Use an extracted VSIX, not the source tree");
  const manifest = JSON.parse(fs.readFileSync(path.join(payload, "package.json"), "utf8"));
  if (manifest.publisher !== "xynapse" || manifest.name !== "xynapse-assistant") throw new Error("Unexpected extension input");
  fs.cpSync(payload, path.join(extensions, `xynapse.xynapse-assistant-${manifest.version}`), { recursive: true });
} else {
  const currentVersion = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8")).version;
  const vsix = process.env.XYNAPSE_E2E_VSIX || path.join(extensionRoot, "build", `xynapse-assistant-${currentVersion}.vsix`);
  if (!fs.existsSync(vsix)) throw new Error("Build the VSIX first or set XYNAPSE_E2E_VSIX to its path");
  execute(["install-vsix", "--vsix_file", path.resolve(vsix), "--storage", storage, "--extensions_dir", extensions]);
}
const mocha = path.join(run, "mocha.json");
fs.writeFileSync(mocha, JSON.stringify({ forbidOnly: true, reporter: "spec" }));
console.log(`E2E artifacts: ${run}`);
execute(["run-tests", process.env.TEST_FILE || "./e2e/_output/tests/*.test.js",
  "--storage", storage, "--extensions_dir", extensions, "--code_version", version,
  "--code_settings", settings, "--mocha_config", mocha, "--open_resource", workspace]);
