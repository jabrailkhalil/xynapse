# Create Your Xynapse Profile

Your Xynapse profile is a local account. No registration on third-party servers required.

## How to Create a Profile

1. Open the command palette: `Ctrl+Shift+P`
2. Type: **Xynapse: Set Up Profile**
3. Enter your name and email

The profile is saved in `~/.xynapse/profile.json` and is used for identification in git commits and assistant logs.

## Encrypted Backup

You can export all your settings and API keys to an encrypted file:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Enter an encryption password
3. Save the `.enc` file

To restore on another computer:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Select the file and enter the password

## Sync via Git

You can push the encrypted config to your own git repository:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

The file is encrypted with AES-256-GCM — safe even in a public repository.
