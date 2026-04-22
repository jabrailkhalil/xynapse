@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "SOURCE_DIR=%~1"
if "%SOURCE_DIR%"=="" set "SOURCE_DIR=%~dp0VSCode-win32-x64"

set "OUTPUT_ROOT=%~2"
if "%OUTPUT_ROOT%"=="" set "OUTPUT_ROOT=%~dp0portable-build"

set "PORTABLE_NAME=xynapse-portable"
set "OUTPUT_DIR=%OUTPUT_ROOT%\%PORTABLE_NAME%"
set "RUNNER=%OUTPUT_DIR%\run-xynapse-portable.bat"

set "SOURCE_EXE=%SOURCE_DIR%\Xynapse.exe"
if not exist "%SOURCE_EXE%" (
	echo [ERROR] Source build not found: "%SOURCE_EXE%"
	echo        Build VSCode portable package first:
	echo        cd vscode
	echo        npm run gulp vscode-win32-x64
	exit /b 1
)

if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\data" >nul

rem Copy runtime files
robocopy "%SOURCE_DIR%" "%OUTPUT_DIR%" /E /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
	echo [ERROR] Failed while copying runtime files.
	exit /b 1
)

rem Stable launch script for portable user profile
(
	echo @echo off
	echo setlocal
	echo set "PORTABLE_DIR=%%~dp0"
	echo set "VSCODE_PORTABLE=%%PORTABLE_DIR%%data"
	echo set "VSCODE_SKIP_PRELAUNCH=1"
	echo cd /d "%%PORTABLE_DIR%%"
	echo start "" "Xynapse.exe"
) > "%RUNNER%"

echo.
echo Portable package created:
echo   %OUTPUT_DIR%
echo.
echo Run:
echo   "%RUNNER%"
echo.
echo It will keep user data in:
echo   %OUTPUT_DIR%\data

exit /b 0
