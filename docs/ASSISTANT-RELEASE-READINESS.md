# Assistant 1.0.2 release qualification

The subsequent local build is documented in [Assistant 1.0.3: selective Claw Code update](UPSTREAM-IMPORT-20260905.md). This report preserves the 1.0.2 audit/remediation baseline.

Date: 2026-09-05. Assistant: **1.0.2**. Portable BVC SDK: **0.1.1**.

The five actionable defects from the 1.0.1 audit have been corrected. This is a Windows x64 partner-preview build, validated in Microsoft VS Code 1.110.0 and Xynapse IDE 1.108.0. It is not a qualification of every IDE, platform, provider, or autonomous editing operation.

## Corrections

| Audit finding | Resulting behavior | Evidence |
| --- | --- | --- |
| Credential-bearing requests logged on error | The webview error boundary logs the registered operation name and returns an allowlisted public message. It never serializes the failed request. Shared verbose HTTP logs omit headers, bodies and URL paths/queries; SSE parser errors omit provider payloads. | Five protocol tests; fourteen fetch/stream tests; synthetic credentials absent from host events and logs. |
| GigaChat completion metadata lost | GigaChat yields incremental UTF-8 SSE, forwards terminal reasons and usage, propagates failures, and cancels both OAuth and completion requests. OAuth expiration uses milliseconds; configured request timeouts use seconds. The extension requires confirmed normal completion before saving a final BVC plan. | Sixteen GigaChat tests, including the real provider-to-BVC truncation regression; thirteen slash integration tests; forty-four SDK tests. |
| Native route bypasses resolved configuration | Native execution waits for configuration initialization and derives model identity, endpoint and credentials from the same resolved model. Unresolved references, provider-changing overrides and mismatched folders fail before spawning. Local `.env` fallback also works with an empty or failed control-plane response. | Twelve route-selection tests; twelve resolver tests; both real extension hosts resolve synthetic `${{ secrets.* }}` references and send the correct model/key through the packaged native runtime to a loopback provider. |
| Required native source dependencies absent | The complete Rust workspace is available in `runtime/`, with all local crates, a lockfile, upstream MIT license and imported-source hashes. The build helper uses this workspace, `--locked`, and verifies the architecture and hash of explicit prebuilt inputs. | Successful release build from a separately extracted 102-file source archive; eighteen CLI tests; four targeted permission tests; two binary-input tests. |
| YAML schemas overwritten | Registration merges global schema mappings and removes only obsolete Xynapse-owned associations. Workspace overrides and unrelated global mappings are preserved. | Two coexistence/idempotence tests. |

The declared minimum VS Code API is now 1.108. Restricted/untrusted and virtual workspaces are explicitly unsupported. The Yandex Cloud connection form and provider-specific icons from 1.0.1 remain included.

## Validation

- Assistant and GUI TypeScript checks, GUI production build and extension bundle build pass.
- Focused assistant/core tests: **117 passed**. Portable BVC: **44 passed**. Fetch/stream: **14 passed**. Yandex connection form: **2 passed**.
- Native CLI: **18 passed**. Selected permission checks: **4 passed**. Native input validation: **2 passed**. IDE packer: **3 passed**.
- Both real desktop hosts activate the extracted final VSIX and execute a native model request with synthetic credentials. The tests assert resolved model identity, matching authorization, the expected response and exit code zero. No paid provider requests are involved.
- The IDE packaging stream preserves **all 361 extension payload files byte for byte** at `resources/app/extensions/xynapse-assistant`. It rejects a changed or missing pinned archive instead of falling back to an older copy.
- Changed/new source, decompressed SDK, native source archive and decompressed VSIX pass the local secret scanner. Known local credentials are compared in memory; reports contain no secret values. This is a targeted scan, not a proof that every possible secret format is detectable.

Host fixtures are prepared before automatic activation and use isolated profiles, extension directories and configuration directories. Xynapse additionally requires an isolated `VSCODE_PORTABLE` directory. An initial invocation collided with the user's open portable instance; a reused test profile also raced an intentionally empty startup fixture. The final harness uses fresh directories and prepares the model configuration before launching the host. These preliminary runs are not counted as passes.

## Artifacts and source builds

Local artifacts and machine-readable evidence are in `artifacts/readiness-fixes-20260905/`:

- `xynapse-assistant-1.0.2-win32-x64.vsix`
- `xynapse-bvc-0.1.1.tgz`
- `xynapse-runtime-source-1.0.2.zip`
- `PACKAGE-VERIFICATION.json`, `INPUT-VERIFICATION.json`, `VSIX-SECRET-SCAN.json`, and per-host `HOST-RESULTS.json`

The VSIX rebuild replaces the extension bundle, GUI, manifest, README and native binary on a checksum-verified support archive. Its unchanged third-party/native support dependencies are inherited from that archive. A completely clean npm/native-dependency acquisition for the whole extension was not exercised by this remediation. The Rust workspace itself was rebuilt from the separately extracted source archive; bit-identical binaries across build paths are not claimed.

See [runtime build instructions](../runtime/README.md) and the [BVC integration contract](../plugins/continue-main/packages/bvc/README.md). The IDE source pin is [xynapse-assistant.json](../vscode/build/xynapse-assistant.json). Public release downloads remain unchanged until a new release is published.

## Qualification limits

Other VS Code-derived editors, macOS, Linux, ARM, remote hosts and web extensions require their own qualification. JetBrains requires a separate host plugin; this VSIX cannot be installed there. The portable BVC SDK is the integration deliverable for other host architectures.

Literal keys and local `.env` references remain supported local credential storage. This update prevents the reproduced unintended logging copies; it does not migrate stored credentials to encrypted SecretStorage or claim a complete native sandbox audit.

BVC produces a plan with `verification: "not_run"`; model agreement is not a correctness proof. The SDK exposes `requireConfirmedSynthesis` for integrations and the assistant enables it. The SDK default remains compatible with adapters that report unknown completion metadata; partners wanting strict final-plan acceptance should enable the option.

Historical benchmark results do not establish consistent superiority over single-model planning. No new paid benchmark or statistically supported quality claim is part of this remediation. Partner materials should describe bounded planning and the tested behavior, and retain preview status until broader reliability, permissions and platform testing is completed.
