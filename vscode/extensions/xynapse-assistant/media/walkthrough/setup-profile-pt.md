# Crie seu perfil Xynapse

Seu perfil Xynapse e uma conta local. Nao e necessario registro em servidores de terceiros.

## Como criar um perfil

1. Abra a paleta de comandos: `Ctrl+Shift+P`
2. Digite: **Xynapse: Set Up Profile**
3. Insira seu nome e email

O perfil e salvo em `~/.xynapse/profile.json` e usado para identificacao em commits git e logs do assistente.

## Backup criptografado

Voce pode exportar todas as configuracoes e chaves API para um arquivo criptografado:

1. `Ctrl+Shift+P` → **Xynapse: Export Encrypted Config Backup**
2. Insira uma senha de criptografia
3. Salve o arquivo `.enc`

Para restaurar em outro computador:
1. `Ctrl+Shift+P` → **Xynapse: Import Encrypted Config Backup**
2. Selecione o arquivo e insira a senha

## Sincronizacao via Git

Voce pode enviar a configuracao criptografada para seu repositorio git:
- **Push**: `Ctrl+Shift+P` → **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` → **Xynapse: Pull Encrypted Config from Git**

O arquivo e criptografado com AES-256-GCM — seguro mesmo em um repositorio publico.
