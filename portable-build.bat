@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "SOURCE_DIR=%~1"
if "%SOURCE_DIR%"=="" set "SOURCE_DIR=%~dp0VSCode-win32-x64"

set "OUTPUT_ROOT=%~2"
if "%OUTPUT_ROOT%"=="" set "OUTPUT_ROOT=%~dp0portable-build"

set "PORTABLE_NAME=xynapse-portable"
set "OUTPUT_DIR=%OUTPUT_ROOT%\%PORTABLE_NAME%"
set "PRESERVED_DATA_DIR=%OUTPUT_ROOT%\%PORTABLE_NAME%-data-preserve"
set "HAS_PRESERVED_DATA="
set "PRESERVE_DATA_FLAG=%~3"

set "SOURCE_EXE=%SOURCE_DIR%\Xynapse.exe"
if not exist "%SOURCE_EXE%" (
	echo [ERROR] Source build not found: "%SOURCE_EXE%"
	echo        Build VSCode portable package first:
	echo        cd vscode
	echo        npm run gulp vscode-win32-x64
	exit /b 1
)

node "%~dp0scripts\validate-portable-paths.js" "%SOURCE_DIR%" "%OUTPUT_ROOT%" "%OUTPUT_DIR%" "%PRESERVED_DATA_DIR%"
if errorlevel 1 exit /b 1

if /i "%PRESERVE_DATA_FLAG%"=="--preserve-data" (
	if exist "%OUTPUT_DIR%\data" (
		set "HAS_PRESERVED_DATA=1"
		if exist "%PRESERVED_DATA_DIR%" rmdir /s /q "%PRESERVED_DATA_DIR%"
		echo Preserving existing portable data...
		robocopy "%OUTPUT_DIR%\data" "%PRESERVED_DATA_DIR%" /E /NFL /NDL /NJH /NJS /NP
		if errorlevel 8 (
			echo [ERROR] Failed to preserve existing portable data.
			exit /b 1
		)
	)
) else (
	if exist "%OUTPUT_DIR%\data" (
		echo Existing portable data will not be copied into this build.
		echo Pass --preserve-data as the third argument only for local debugging.
	)
)

if exist "%OUTPUT_DIR%" rmdir /s /q "%OUTPUT_DIR%"
mkdir "%OUTPUT_DIR%\data" >nul

rem Copy runtime files
robocopy "%SOURCE_DIR%" "%OUTPUT_DIR%" /E /NFL /NDL /NJH /NJS /NP
if errorlevel 8 (
	echo [ERROR] Failed while copying runtime files.
	if defined HAS_PRESERVED_DATA if exist "%PRESERVED_DATA_DIR%" echo        Preserved data remains at "%PRESERVED_DATA_DIR%".
	exit /b 1
)

if defined HAS_PRESERVED_DATA (
	rmdir /s /q "%OUTPUT_DIR%\data" >nul 2>nul
	mkdir "%OUTPUT_DIR%\data" >nul
	robocopy "%PRESERVED_DATA_DIR%" "%OUTPUT_DIR%\data" /E /NFL /NDL /NJH /NJS /NP
	if errorlevel 8 (
		echo [ERROR] Failed to restore preserved portable data.
		echo        Preserved data remains at "%PRESERVED_DATA_DIR%".
		exit /b 1
	)
	rmdir /s /q "%PRESERVED_DATA_DIR%"
)

rem Ensure native addons are present in the portable app package
set "SOURCE_NODE_MODULES=%~dp0vscode\node_modules"
if exist "%SOURCE_NODE_MODULES%" (
	echo Syncing native addons from source node_modules...
	node --eval "const fs=require('fs');const path=require('path');const sourceModules=process.argv[1];const targetModules=process.argv[2];const nativeFiles=[];const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()) walk(p); else if(e.isFile()&&p.endsWith('.node')) nativeFiles.push(p);}};if(!fs.existsSync(sourceModules)||!fs.existsSync(targetModules)){process.exit(0);}walk(sourceModules);for(const source of nativeFiles){const rel=path.relative(sourceModules,source);const parts=rel.split(path.sep);if(parts[0] !== '@vscode' || parts.length < 2){continue;}if(parts[1].startsWith('.') && parts[1].includes('-')){const lastDash=parts[1].lastIndexOf('-');if(lastDash > 1){parts[1]=parts[1].slice(1,lastDash);}}const target=path.join(targetModules,...parts);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}process.exit(0);" "%SOURCE_NODE_MODULES%" "%OUTPUT_DIR%\resources\app\node_modules"
) else (
	echo [WARN] Missing source node_modules at "%SOURCE_NODE_MODULES%". Skipping native addon sync.
)

if exist "%~dp0scripts\audit-xynapse-connectors.js" (
	echo Verifying Xynapse connector parity...
	set "XYNAPSE_PORTABLE_EXTENSION_ROOT=%OUTPUT_DIR%\resources\app\extensions\xynapse-assistant"
	node "%~dp0scripts\audit-xynapse-connectors.js"
	if errorlevel 1 (
		echo [ERROR] Xynapse connector parity verification failed.
		exit /b 1
	)
)

echo.
echo Portable package created:
echo   %OUTPUT_DIR%
echo.
echo Run:
echo   "%OUTPUT_DIR%\Xynapse.exe"
echo.
echo It will keep user data in:
echo   %OUTPUT_DIR%\data
echo.
echo Note:
echo   Fresh builds do not copy previous portable user data.
echo   Use --preserve-data only for local debugging builds.

exit /b 0
