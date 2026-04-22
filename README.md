<div align="center">

<img src="./Pics/logo.png" alt="Xynapse IDE" width="320"/>

# Xynapse IDE

**AI-Powered Development Environment**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)]()

[Website](https://xynapse.online) | [English](./README.en.md) | [Русский](./README.ru.md)

</div>

---

## Updates via GitHub Releases

Xynapse supports manual in-app updates on Windows through GitHub Releases.

1. The user clicks `Help -> Check for Updates`.
2. Xynapse requests the latest release from the repository configured in `vscode/product.json`.
3. The app compares the current version with the release semver tag.
4. If a newer version exists, Xynapse selects the matching Windows asset.
5. Setup builds download the installer and apply it through the standard restart flow. Portable builds open the release asset for download.

Detailed documentation:
- [English update notes](./README.en.md)
- [Russian update notes](./README.ru.md)

## Profile, Account, and Encrypted Backup

- `profile.json` stores user-readable identity:
  - `name`
  - `email`
  - `isConfigured`
- `account.json` stores the sync payload:
  - `name`
  - `email`
  - `isConfigured`
  - `createdAt`
  - `keys` (full raw content of `config.yaml` and `config.json`)
- `account.json` is the source for sync state. Without it, the profile is treated as local/unconfigured.
- On first start (if `profile.json` is missing), Xynapse creates a local profile and shows a notification about setup for encrypted sync.
- `Export/Import config backup` always includes both `profile.json` and `account.json` and keeps local/remote sync reproducible across machines.
- Git sync is still supported through exported `.enc` files; local import/export also works via `Ctrl+Shift+P` actions.

## Portable Build

A portable package can be assembled in a dedicated folder:

```powershell
.\portable-build.bat
```

What it does:

- uses built `VSCode-win32-x64` output,
- creates `portable-build\xynapse-portable`,
- adds a `run-xynapse-portable.bat` launcher,
- stores user data under `portable-build\xynapse-portable\data`.

How to test:

```powershell
.\portable-build\xynapse-portable\run-xynapse-portable.bat
```

If you want to use a custom source/output path, pass them as arguments:

```powershell
.\portable-build.bat "C:\Path\To\WinBuild" "C:\Path\To\Out"
```
