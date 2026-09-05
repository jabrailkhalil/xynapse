# Xynapse native runtime

This directory contains the complete Rust workspace used to build the assistant's native runtime, including its local crate dependencies, test sources, and lockfile. It replaces the previously incomplete `.external/claw-code/rust` build input.

The source is a local Xynapse-modified snapshot of [Claw Code](https://github.com/ultraworkers/claw-code). `SOURCE-MANIFEST.json` records the imported file hashes; it does not claim identity with an upstream commit. Subsequent Xynapse changes are reviewed in Git. The upstream MIT license is retained in `LICENSE`.

`UPSTREAM-IMPORTS.json` records the selective September 2026 port from pinned upstream commit `08106b0c3771ef5b4a5aa176acccd460e88b7325`, including hashes before and after adaptation. Public Assistant 1.0.1 incorporates reasoning parsing, session/history replay, structured command hooks, configuration diagnostics, and the Linux sandbox launcher probe. Earlier audit documents use unpublished local iteration labels 1.0.2 and 1.0.3. This is a selective port, not a replacement with upstream HEAD; Xynapse routing and privacy behavior are retained. The optional `claw-analog` and `claw-rag-service` crates are not included.

From a clean checkout, with Rust and the platform linker installed:

```sh
cargo build --locked --release --manifest-path runtime/Cargo.toml --bin xynapse
cargo test --locked --manifest-path runtime/Cargo.toml -p rusty-xynapse-cli --test cli_flags_and_config_defaults
```

The extension's build helper uses this directory and Cargo's lockfile. Dependencies are fetched from the registries described by `Cargo.lock`; no private local checkout is required. Build native artifacts on their target OS/architecture. Supplying a prebuilt runtime requires a matching SHA-256 and platform binary header; the helper fails before packaging if either check fails.

Windows x64 is the qualified distribution target. A source build on another platform is not a claim that the full extension's native dependencies or UI have been qualified there.
