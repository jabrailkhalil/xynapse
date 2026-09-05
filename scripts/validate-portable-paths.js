#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function fail(message) {
  console.error(`[ERROR] Unsafe portable build paths: ${message}`);
  process.exit(1);
}

function normalized(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

const [sourceArg, outputRootArg, outputDirArg, preserveDirArg] = process.argv.slice(2);
if (!sourceArg || !outputRootArg || !outputDirArg || !preserveDirArg) {
  fail("expected source, output root, output directory, and preservation directory");
}

const source = path.resolve(sourceArg);
const outputRoot = path.resolve(outputRootArg);
const outputDir = path.resolve(outputDirArg);
const preserveDir = path.resolve(preserveDirArg);
const repoRoot = path.resolve(__dirname, "..");
const home = path.resolve(os.homedir());
const root = path.parse(outputRoot).root;

if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
  fail(`source directory does not exist: ${source}`);
}
if (normalized(outputRoot) === normalized(root)) {
  fail("the output root cannot be a filesystem root");
}
if (normalized(outputRoot) === normalized(repoRoot)) {
  fail("the output root cannot be the repository root");
}
if (normalized(outputRoot) === normalized(home)) {
  fail("the output root cannot be the user profile directory");
}

const expectedOutput = path.join(outputRoot, "xynapse-portable");
const expectedPreserve = path.join(outputRoot, "xynapse-portable-data-preserve");
if (normalized(outputDir) !== normalized(expectedOutput)) {
  fail(`unexpected output directory: ${outputDir}`);
}
if (normalized(preserveDir) !== normalized(expectedPreserve)) {
  fail(`unexpected preservation directory: ${preserveDir}`);
}
if (!isInside(outputRoot, outputDir) || !isInside(outputRoot, preserveDir)) {
  fail("build targets must stay inside the output root");
}
if (normalized(source) === normalized(outputDir) || isInside(source, outputDir)) {
  fail("the output directory cannot be the source or a child of the source");
}
for (const target of [outputDir, preserveDir]) {
  if (
    normalized(target) === normalized(repoRoot) ||
    normalized(target) === normalized(home) ||
    normalized(target) === normalized(path.parse(target).root)
  ) {
    fail(`refusing broad target: ${target}`);
  }
}

console.log(`[OK] Portable output paths validated under ${outputRoot}`);

