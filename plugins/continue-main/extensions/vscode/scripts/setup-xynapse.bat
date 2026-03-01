@echo off
REM Xynapse Assistant - Setup Script
REM This script copies secrets.local.json to the Continue config folder
REM and optionally sets environment variables

echo ========================================
echo Xynapse Assistant - Setup
echo ========================================

set CONTINUE_DIR=%USERPROFILE%\.continue
set SECRETS_SOURCE=%~dp0..\..\..\..\vscode\extensions\yandex-gpt\secrets.local.json

echo.
echo Checking for secrets.local.json...

if exist "%SECRETS_SOURCE%" (
    echo Found secrets.local.json in yandex-gpt extension folder
    
    REM Create .continue directory if it doesn't exist
    if not exist "%CONTINUE_DIR%" (
        mkdir "%CONTINUE_DIR%"
        echo Created %CONTINUE_DIR%
    )
    
    REM Copy secrets file
    copy /Y "%SECRETS_SOURCE%" "%CONTINUE_DIR%\secrets.local.json" >nul
    echo Copied secrets.local.json to %CONTINUE_DIR%
    
    REM Read API key and folder ID from JSON (basic parsing)
    for /f "tokens=2 delims=:," %%a in ('type "%SECRETS_SOURCE%" ^| findstr "apiKey"') do (
        set YANDEX_API_KEY=%%~a
    )
    for /f "tokens=2 delims=:," %%a in ('type "%SECRETS_SOURCE%" ^| findstr "folderId"') do (
        set YANDEX_FOLDER_ID=%%~a
    )
    
    echo.
    echo Environment variables set:
    echo   YANDEX_API_KEY = [set]
    echo   YANDEX_FOLDER_ID = [set]
    
) else (
    echo WARNING: secrets.local.json not found at:
    echo   %SECRETS_SOURCE%
    echo.
    echo Please create secrets.local.json with:
    echo {
    echo   "apiKey": "your-yandex-api-key",
    echo   "folderId": "your-folder-id"
    echo }
)

echo.
echo ========================================
echo Setup complete!
echo.
echo Next steps:
echo 1. Copy xynapse-config.yaml to %CONTINUE_DIR%\config.yaml
echo 2. Restart VS Code / Xynapse IDE
echo ========================================

pause
