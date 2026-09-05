#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function fail(message) {
  console.error(`[ERROR] Profile backup aborted: ${message}`);
  process.exit(1);
}

function normalized(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

const home = path.resolve(os.homedir());
if (normalized(home) === normalized(path.parse(home).root)) {
  fail("the user profile resolved to a filesystem root");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupRoot = path.join(home, "Xynapse-Backups", `first-run-${stamp}`);
const profileNames = [".xynapse", ".vscode-oss"];
const existing = profileNames
  .map((name) => ({ name, source: path.join(home, name) }))
  .filter(({ source }) => fs.existsSync(source));

if (existing.length === 0) {
  console.log("[OK] No existing Xynapse profiles need to be backed up.");
  process.exit(0);
}

fs.mkdirSync(backupRoot, { recursive: true });
for (const { name, source } of existing) {
  const destination = path.join(backupRoot, name);
  if (normalized(path.dirname(source)) !== normalized(home)) {
    fail(`source escaped the user profile: ${source}`);
  }
  if (normalized(path.dirname(destination)) !== normalized(backupRoot)) {
    fail(`destination escaped the backup directory: ${destination}`);
  }
  fs.renameSync(source, destination);
  console.log(`[OK] Backed up ${source} to ${destination}`);
}

console.log(`[OK] Existing settings are recoverable from ${backupRoot}`);
