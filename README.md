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
