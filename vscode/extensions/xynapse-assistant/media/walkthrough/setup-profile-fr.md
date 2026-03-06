# Creez votre profil Xynapse

Votre profil Xynapse est un compte local. Aucune inscription sur des serveurs tiers n'est requise.

## Comment creer un profil

1. Ouvrez la palette de commandes : `Ctrl+Shift+P`
2. Tapez : **Xynapse: Set Up Profile**
3. Entrez votre nom et votre email

Le profil est sauvegarde dans `~/.xynapse/profile.json` et est utilise pour l'identification dans les commits git et les logs de l'assistant.

## Sauvegarde chiffree

Vous pouvez exporter tous vos parametres et cles API dans un fichier chiffre :

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Entrez un mot de passe de chiffrement
3. Sauvegardez le fichier `.enc`

Pour restaurer sur un autre ordinateur :
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Selectionnez le fichier et entrez le mot de passe

## Synchronisation via Git

Vous pouvez pousser la configuration chiffree vers votre depot git :
- **Push** : `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull** : `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

Le fichier est chiffre avec AES-256-GCM — sur meme dans un depot public.
