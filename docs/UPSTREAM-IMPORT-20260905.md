# Assistant 1.0.3: selective Claw Code update

Xynapse Assistant 1.0.3 preserves provider reasoning across native tool calls, including DeepSeek V4 models routed through Yandex Cloud. It also accepts structured command hooks with tool matchers and includes the upstream Linux sandbox launcher probe. BVC remains at 0.1.1.

Source: [ultraworkers/claw-code at 08106b0](https://github.com/ultraworkers/claw-code/tree/08106b0c3771ef5b4a5aa176acccd460e88b7325). This is an independent Rust project. Xynapse's original upstream base is unknown; this import does not assert full parity with upstream HEAD.

## Imported behavior

- OpenAI-compatible responses normalize `reasoning_content`, Ollama `reasoning`, and streaming `thinking.content` into reasoning blocks. CLI and subagent execution retain those blocks in session history. DeepSeek V4 receives `reasoning_content` when replaying assistant turns after tools. Yandex model URIs retain their complete `gpt://folder/model/revision` form.
- Reasoning and signatures contribute to the compaction estimate. Human-readable exports, terminal output and compacted summaries omit raw reasoning. Session persistence retains it for model protocol compatibility.
- Runtime settings accept legacy hook strings and object-style command hooks with optional tool matchers. Hook execution honors the matcher. Unlike upstream's partial-loading behavior, malformed supported hooks remain configuration errors. Unknown setting keys emit warnings with location and spelling guidance.
- `rulesImport` accepts the upstream string/array schema for compatibility. This port does not add cross-editor rule-file loading.
- Linux sandbox detection probes the complete default `unshare` launcher shape and selects the `--map-auto` fallback when needed. Optional network namespace creation is outside the default probe, as upstream specifies.

The import preserves resolved credential routing, error redaction, the Yandex Cloud connection form and BVC behavior from 1.0.2. It does not force reasoning mode on, add the optional `claw-analog`/`claw-rag-service` crates, replace the entire runtime with upstream HEAD, or publish a GitHub release.

## Validation

| Check | Result |
| --- | --- |
| API unit and OpenAI-compatible HTTP integration tests | 142 passed |
| Runtime tests, including config, hooks, sessions, compaction and sandbox arguments | 520 passed |
| CLI response conversion | 3 passed |
| Subagent reasoning history | 1 passed |
| CLI defaults and structured output contracts | 18 passed |
| Extension TypeScript and production bundle | Passed |
| Native Windows x64 release build with locked dependencies | Passed |
| Final VSIX in Microsoft VS Code 1.110.0 and Xynapse 1.108.0 | Passed in both hosts |
| IDE packaging payload | All 361 extension files match the VSIX byte for byte |
| Packer rejection and payload tests | 3 passed |
| Secret scans | No findings in 165 source files, decompressed native source/SDK and final VSIX |

Each final-host test uses an isolated profile, synthetic secret references and a loopback model server. The actual packaged binary receives reasoning, reads a fixture through a native tool, replays the reasoning and tool result in the next request, and returns the expected answer with exit code zero. The test also checks model identity, authorization and the absence of credentials/raw reasoning in visible runtime events. No paid model request is used.

Linux namespace execution, other operating systems, remote hosts, JetBrains integration and a full autonomous-operation security audit remain unqualified. Support/native dependencies and the unchanged GUI are inherited from the checksum-verified 1.0.2 archive. No claim of a clean npm dependency acquisition or bit-identical builds across machines is made.

## Artifacts and provenance

Local artifacts are in `artifacts/upstream-import-20260905/`:

- `xynapse-assistant-1.0.3-win32-x64.vsix`
- `xynapse-runtime-source-1.0.3.zip`
- `PACKAGE-VERIFICATION.json`, `SOURCE-PACKAGE-VERIFICATION.json`, `INPUT-VERIFICATION.json`, `VSIX-SECRET-SCAN.json`
- `host-vscode/HOST-RESULTS.json` and `host-xynapse/HOST-RESULTS.json`

`runtime/UPSTREAM-IMPORTS.json` records the pinned source, selected changes, adaptations, and file hashes before and after import. The complete source archive contains 103 files. The original 98-file source manifest is verified against the pre-import backup; the Cargo lockfile is unchanged.

`vscode/build/xynapse-assistant.json` pins the exact 1.0.3 archive and SHA-256. The IDE packer imports its `extension/` payload into `resources/app/extensions/xynapse-assistant` and rejects mismatched inputs.

The final VSIX is installed in the local portable Xynapse. All 360 non-manifest installed files match the archive; the host-added package metadata leaves all original manifest fields intact. The extension registry selects 1.0.3, and the user window has been reloaded with the restart indicator cleared. The separate IDE installer/portable release archive has not been rebuilt or published in this import.
