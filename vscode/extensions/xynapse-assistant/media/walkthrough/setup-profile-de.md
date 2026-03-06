# Erstellen Sie Ihr Xynapse-Profil

Ihr Xynapse-Profil ist ein lokales Konto. Keine Registrierung auf Drittanbieter-Servern erforderlich.

## So erstellen Sie ein Profil

1. Offnen Sie die Befehlspalette: `Ctrl+Shift+P`
2. Geben Sie ein: **Xynapse: Set Up Profile**
3. Geben Sie Ihren Namen und Ihre E-Mail ein

Das Profil wird in `~/.xynapse/profile.json` gespeichert und fur die Identifikation in Git-Commits und Assistenten-Logs verwendet.

## Verschlusseltes Backup

Sie konnen alle Einstellungen und API-Schlussel in eine verschlusselte Datei exportieren:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Geben Sie ein Verschlusselungspasswort ein
3. Speichern Sie die `.enc`-Datei

Zum Wiederherstellen auf einem anderen Computer:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Wahlen Sie die Datei und geben Sie das Passwort ein

## Synchronisierung uber Git

Sie konnen die verschlusselte Konfiguration in Ihr Git-Repository pushen:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

Die Datei wird mit AES-256-GCM verschlusselt — sicher auch in einem offentlichen Repository.
