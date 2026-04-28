# Cree su perfil de Xynapse

Su perfil de Xynapse es una cuenta local. No se requiere registro en servidores de terceros.

## Como crear un perfil

1. Abra la paleta de comandos: `Ctrl+Shift+P`
2. Escriba: **Xynapse: Set Up Profile**
3. Ingrese su nombre y correo electronico

El perfil se guarda en `~/.xynapse/profile.json` y se utiliza para identificacion en commits de git y registros del asistente.

## Copia de seguridad cifrada

Puede exportar todas sus configuraciones y claves API a un archivo cifrado:

1. `Ctrl+Shift+P` в†’ **Xynapse: Export Encrypted Config Backup**
2. Ingrese una contrasena de cifrado
3. Guarde el archivo `.enc`

Para restaurar en otra computadora:
1. `Ctrl+Shift+P` в†’ **Xynapse: Import Encrypted Config Backup**
2. Seleccione el archivo e ingrese la contrasena

## Sincronizacion via Git

Puede enviar la configuracion cifrada a su repositorio git:
- **Push**: `Ctrl+Shift+P` в†’ **Xynapse: Push Encrypted Config to Git**
- **Pull**: `Ctrl+Shift+P` в†’ **Xynapse: Pull Encrypted Config from Git**

El archivo esta cifrado con AES-256-GCM вЂ” seguro incluso en un repositorio publico.

