const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { validateRuntimeBinary } = require("./build-copy-xynapse-runtime");
const pe = Buffer.alloc(128);
pe.write("MZ");
pe.writeUInt32LE(64, 0x3c);
pe.writeUInt32LE(0x4550, 64);
pe.writeUInt16LE(0x8664, 68);
test("accepts the pinned native target", () => {
  assert.doesNotThrow(() =>
    validateRuntimeBinary(
      pe,
      "win32-x64",
      createHash("sha256").update(pe).digest("hex"),
    ),
  );
});
test("rejects incorrect platform, architecture, truncated headers and changed bytes", () => {
  for (const target of ["win32-arm64", "linux-x64", "darwin-x64", "win32-ia32"])
    assert.throws(() => validateRuntimeBinary(pe, target));
  assert.throws(() => validateRuntimeBinary(pe.subarray(0, 20), "win32-x64"));
  assert.throws(() => validateRuntimeBinary(pe, "win32-x64", "0".repeat(64)));
});
