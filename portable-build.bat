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

rem Ensure native addons are present in the portable app package
set "SOURCE_NODE_MODULES=%~dp0vscode\node_modules"
if exist "%SOURCE_NODE_MODULES%" (
	echo Syncing native addons from source node_modules...
	node --eval "const fs=require('fs');const path=require('path');const sourceModules=process.argv[1];const targetModules=process.argv[2];const nativeFiles=[];const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()) walk(p); else if(e.isFile()&&p.endsWith('.node')) nativeFiles.push(p);}};if(!fs.existsSync(sourceModules)||!fs.existsSync(targetModules)){process.exit(0);}walk(sourceModules);for(const source of nativeFiles){const rel=path.relative(sourceModules,source);const parts=rel.split(path.sep);if(parts[0] !== '@vscode' || parts.length < 2){continue;}if(parts[1].startsWith('.') && parts[1].includes('-')){const lastDash=parts[1].lastIndexOf('-');if(lastDash > 1){parts[1]=parts[1].slice(1,lastDash);}}const target=path.join(targetModules,...parts);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}process.exit(0);" "%SOURCE_NODE_MODULES%" "%OUTPUT_DIR%\resources\app\node_modules"
) else (
	echo [WARN] Missing source node_modules at "%SOURCE_NODE_MODULES%". Skipping native addon sync.
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
