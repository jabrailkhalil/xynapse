@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title Xynapse IDE
set "ELECTRON_RUN_AS_NODE="

set "LOGDIR=%~dp0logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOGFILE=%LOGDIR%\xynapse.log"

goto :skip_functions

:log
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set "timestamp=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2% %datetime:~8,2%:%datetime:~10,2%:%datetime:~12,2%"
echo [%timestamp%] %~1 >> "%LOGFILE%"
goto :eof

:skip_functions

:menu
cls
echo.
echo   XYNAPSE IDE
echo.
echo   Разработка
echo   1  Запустить IDE
echo   2  Скомпилировать + запустить
echo   3  Режим разработки (Компиляция + Watch + IDE)
echo   4  Watch mode (подменю)
echo   5  Только компиляция
echo   6  Сборка релиза (Win64)
echo.
echo   Git
echo   7  Git меню
echo.
echo   Тесты
echo   8  Тесты Node
echo   9  Тесты Browser
echo.
echo   Утилиты
echo   10 Показать версии
echo   11 Очистить кэш сборки
echo   12 npm install
echo   13 Первый запуск (сброс)
echo   14 Открыть лог
echo   15 Запуск VANILLA (без настроек)
echo.
echo   0  Выход
echo.
set /p choice="  > "

if "%choice%"=="1" goto run_ide
if "%choice%"=="2" goto compile_and_run
if "%choice%"=="3" goto dev_mode
if "%choice%"=="4" goto watch_mode
if "%choice%"=="5" goto compile_only
if "%choice%"=="6" goto build_release
if "%choice%"=="7" goto git_menu
if "%choice%"=="8" goto test_node
if "%choice%"=="9" goto test_browser
if "%choice%"=="10" goto show_versions
if "%choice%"=="11" goto clean_build
if "%choice%"=="12" goto npm_install
if "%choice%"=="13" goto first_run
if "%choice%"=="14" goto open_log
if "%choice%"=="15" goto vanilla_run
if "%choice%"=="0" goto exit_script

echo   Неверный выбор
timeout /t 1 >nul
goto menu

:: ============================================================================
:run_ide
cls
echo   Запуск Xynapse IDE...
cd /d "%~dp0vscode"
set "VSCODE_SKIP_PRELAUNCH=1"
call .\scripts\code.bat
set "VSCODE_SKIP_PRELAUNCH="
pause
goto menu

:: ============================================================================
:compile_and_run
cls
echo   Компиляция + Запуск
echo.
call :log "Compile and Run"
cd /d "%~dp0vscode"

set "TEMPLOG=%LOGDIR%\compile_temp.log"
echo   Компиляция (16GB)...
call node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js compile > "%TEMPLOG%" 2>&1
set EXITCODE=%errorlevel%

type "%TEMPLOG%"
type "%TEMPLOG%" >> "%LOGFILE%"
del "%TEMPLOG%" 2>nul

if %EXITCODE% neq 0 (
    echo.
    echo   ОШИБКА!
    pause
    goto menu
)

echo.
echo   Запуск IDE...
set "VSCODE_SKIP_PRELAUNCH=1"
call .\scripts\code.bat
set "VSCODE_SKIP_PRELAUNCH="
pause
goto menu

:: ============================================================================
:dev_mode
cls
echo   Режим разработки
echo.
echo   ВАЖНО: После изменений в плагине нажми Ctrl+Shift+P
echo   и выбери "Developer: Restart Extension Host"
echo.
cd /d "%~dp0vscode"

:: Убиваем старые процессы watch если есть
taskkill /FI "WINDOWTITLE eq Xynapse Watch*" /F >nul 2>&1

:: Проверяем, скомпилирован ли VS Code client (out/)
if not exist "out\vs\code\electron-main\main.js" (
    echo   out/ не найден — полная компиляция VS Code...
    echo   (client ~2 мин + extensions ~30 сек)
    echo.
    call node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js compile-client
    if errorlevel 1 (
        echo.
        echo   ОШИБКА компиляции client!
        pause
        goto menu
    )
    echo   Client скомпилирован.
    echo   Компиляция встроенных расширений...
    call node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js compile-extensions
    if errorlevel 1 (
        echo.
        echo   ОШИБКА компиляции extensions!
        pause
        goto menu
    )
    echo.
    echo   Компиляция завершена.
) else (
    echo   VS Code client уже скомпилирован (out/ OK)
    :: Проверяем встроенные расширения
    if not exist "extensions\git\out\extension.js" (
        echo   Встроенные расширения не собраны — компиляция...
        call node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js compile-extensions
    )
)

echo.
echo   Запуск watch для Xynapse Assistant (лёгкий esbuild)...
start "Xynapse Watch" cmd /k "title Xynapse Watch - Extension && cd /d %~dp0plugins\continue-main\extensions\vscode && npm run esbuild-watch"

echo.
echo   Запуск IDE...
set "VSCODE_SKIP_PRELAUNCH=1"
call .\scripts\code.bat
set "VSCODE_SKIP_PRELAUNCH="

echo.
echo   IDE закрыт.
echo   Закрыть окно Watch? (Y/N)
set /p kw="  > "
if /i "%kw%"=="Y" taskkill /FI "WINDOWTITLE eq Xynapse Watch*" /F >nul 2>&1
goto menu

:: ============================================================================
:watch_mode
cls
echo   Watch Mode
echo.
echo   1  Watch VS Code client (16GB, тяжёлый)
echo   2  Watch Xynapse Assistant (лёгкий esbuild)
echo   3  Watch оба
echo   0  Назад
echo.
set /p wc="  > "

if "%wc%"=="1" (
    cd /d "%~dp0vscode"
    echo   Запуск watch-client с 16GB...
    node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js watch-client
    pause
    goto menu
)
if "%wc%"=="2" (
    cd /d "%~dp0plugins\continue-main\extensions\vscode"
    echo   Запуск esbuild-watch...
    npm run esbuild-watch
    pause
    goto menu
)
if "%wc%"=="3" (
    cd /d "%~dp0vscode"
    echo   Запуск watch-client (16GB)...
    start "Xynapse Watch - Client" cmd /k "title Xynapse Watch - Client && cd /d %~dp0vscode && node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js watch-client"
    echo   Запуск esbuild-watch для плагина...
    start "Xynapse Watch - Extension" cmd /k "title Xynapse Watch - Extension && cd /d %~dp0plugins\continue-main\extensions\vscode && npm run esbuild-watch"
    echo.
    echo   Watch запущены в отдельных окнах.
    echo   Нажми Enter чтобы вернуться в меню.
    pause >nul
    goto menu
)
if "%wc%"=="0" goto menu
goto watch_mode

:: ============================================================================
:compile_only
cls
echo   Компиляция
echo.
call :log "Compile"
cd /d "%~dp0vscode"

set "TEMPLOG=%LOGDIR%\compile_temp.log"
call node --max-old-space-size=16384 node_modules\gulp\bin\gulp.js compile > "%TEMPLOG%" 2>&1
set EXITCODE=%errorlevel%

type "%TEMPLOG%"
type "%TEMPLOG%" >> "%LOGFILE%"
del "%TEMPLOG%" 2>nul

if %EXITCODE% neq 0 (
    echo.
    echo   ОШИБКА!
) else (
    echo.
    echo   Готово!
)
pause
goto menu

:: ============================================================================
:build_release
cls
echo   Сборка релиза (15-30 мин)
echo.
cd /d "%~dp0vscode"
node --version

set /p confirm="   Начать? (Y/N): "
if /i not "%confirm%"=="Y" goto menu

echo.
echo   1/2 Компиляция...
npm run compile
if errorlevel 1 (
    echo   ОШИБКА!
    pause
    goto menu
)

echo.
echo   2/2 Сборка Win64...
npm run gulp vscode-win32-x64

echo.
echo   Готово: vscode\.build\win32-x64\
pause
goto menu

:: ============================================================================
:git_menu
cls
cd /d "%~dp0"

:: Проверяем есть ли .git
if not exist ".git" goto git_init

:: Git настроен - показываем полное меню
:git_full_menu
cls
echo.
echo   ┌─────────────────────────────────────────┐
echo   │              GIT MENU                   │
echo   └─────────────────────────────────────────┘
echo.

:: Текущая ветка
for /f "tokens=*" %%i in ('git branch --show-current 2^>nul') do set "current_branch=%%i"
echo   Ветка: %current_branch%

:: Remote
for /f "tokens=*" %%i in ('git remote get-url origin 2^>nul') do set "remote_url=%%i"
if defined remote_url (
    echo   Remote: %remote_url%
) else (
    echo   Remote: [не настроен]
)

:: Статус синхронизации
git fetch origin %current_branch% >nul 2>&1
for /f %%i in ('git rev-list --count HEAD..origin/%current_branch% 2^>nul') do set "behind=%%i"
for /f %%i in ('git rev-list --count origin/%current_branch%..HEAD 2^>nul') do set "ahead=%%i"
if defined ahead if defined behind (
    if "%ahead%"=="0" if "%behind%"=="0" (
        echo   Sync: актуально
    ) else (
        echo   Sync: +%ahead% / -%behind%
    )
)
echo.

:: Показываем краткий статус
echo   Изменения:
git status -s
if errorlevel 0 (
    git status -s | findstr "." >nul 2>&1
    if errorlevel 1 echo   [нет изменений]
)
echo.

echo   ─── Основное ───────────────────────────
echo   1  Статус (подробно)
echo   2  Добавить + Закоммитить
echo   3  Push
echo   4  Pull
echo.
echo   ─── Ветки ──────────────────────────────
echo   5  Список веток
echo   6  Переключить ветку
echo   7  Создать ветку
echo   8  Удалить ветку
echo.
echo   ─── История ────────────────────────────
echo   9  Лог (последние 10)
echo   10 Diff (изменения)
echo.
echo   ─── Stash ──────────────────────────────
echo   11 Stash save
echo   12 Stash pop
echo   13 Stash list
echo.
echo   ─── Отмена ─────────────────────────────
echo   14 Отменить изменения файла
echo   15 Reset --soft HEAD~1
echo   16 Reset --hard HEAD
echo.
echo   ─── Настройки ─────────────────────────
echo   17 Изменить remote
echo   18 Fetch all
echo.
echo   0  Назад
echo.
set /p gc="  > "

if "%gc%"=="1" goto git_status
if "%gc%"=="2" goto git_commit
if "%gc%"=="3" goto git_push
if "%gc%"=="4" goto git_pull
if "%gc%"=="5" goto git_branches
if "%gc%"=="6" goto git_checkout
if "%gc%"=="7" goto git_new_branch
if "%gc%"=="8" goto git_delete_branch
if "%gc%"=="9" goto git_log
if "%gc%"=="10" goto git_diff
if "%gc%"=="11" goto git_stash_save
if "%gc%"=="12" goto git_stash_pop
if "%gc%"=="13" goto git_stash_list
if "%gc%"=="14" goto git_restore
if "%gc%"=="15" goto git_soft_reset
if "%gc%"=="16" goto git_hard_reset
if "%gc%"=="17" goto git_add_remote
if "%gc%"=="18" goto git_fetch_all
if "%gc%"=="0" goto menu
goto git_full_menu

:: --- Git Status ---
:git_status
cls
echo   git status
echo   ─────────────────────────────────────────
git status
echo.
pause
goto git_full_menu

:: --- Git Commit ---
:git_commit
cls
echo   git add + commit
echo   ─────────────────────────────────────────
echo.
git status -s
echo.
git status -s | findstr "." >nul 2>&1
if errorlevel 1 (
    echo   Нет изменений для коммита
    pause
    goto git_full_menu
)
echo   Введи сообщение коммита:
set /p msg="  > "
if "!msg!"=="" goto git_full_menu
echo.
git add .
git commit -m "!msg!"
echo.
echo   Сделать push? (Y/N)
set /p dopush="  > "
if /i "%dopush%"=="Y" git push
pause
goto git_full_menu

:: --- Git Push ---
:git_push
cls
echo   git push
echo   ─────────────────────────────────────────
echo.
git push
if errorlevel 1 (
    echo.
    echo   Попробовать push -u origin %current_branch%? (Y/N)
    set /p forcepush="  > "
    if /i "!forcepush!"=="Y" git push -u origin %current_branch%
)
pause
goto git_full_menu

:: --- Git Pull ---
:git_pull
cls
echo   git pull
echo   ─────────────────────────────────────────
echo.
git pull
pause
goto git_full_menu

:: --- Git Branches ---
:git_branches
cls
echo   Ветки
echo   ─────────────────────────────────────────
echo.
echo   Локальные:
git branch
echo.
echo   Удалённые:
git branch -r
echo.
pause
goto git_full_menu

:: --- Git Checkout ---
:git_checkout
cls
echo   Переключить ветку
echo   ─────────────────────────────────────────
echo.
echo   Доступные ветки:
git branch -a
echo.
set /p branch_name="  Имя ветки: "
if "!branch_name!"=="" goto git_full_menu
git checkout !branch_name!
pause
goto git_full_menu

:: --- Git New Branch ---
:git_new_branch
cls
echo   Создать ветку
echo   ─────────────────────────────────────────
echo.
set /p new_branch="  Имя новой ветки: "
if "!new_branch!"=="" goto git_full_menu
git checkout -b !new_branch!
echo.
echo   Запушить новую ветку? (Y/N)
set /p pushbranch="  > "
if /i "!pushbranch!"=="Y" git push -u origin !new_branch!
pause
goto git_full_menu

:: --- Git Delete Branch ---
:git_delete_branch
cls
echo   Удалить ветку
echo   ─────────────────────────────────────────
echo.
echo   Локальные ветки:
git branch
echo.
set /p del_branch="  Имя ветки для удаления: "
if "!del_branch!"=="" goto git_full_menu
echo.
echo   1 Удалить локально
echo   2 Удалить локально + remote
echo   0 Отмена
set /p del_type="  > "
if "!del_type!"=="1" git branch -d !del_branch!
if "!del_type!"=="2" (
    git branch -d !del_branch!
    git push origin --delete !del_branch!
)
pause
goto git_full_menu

:: --- Git Log ---
:git_log
cls
echo   git log (последние 10)
echo   ─────────────────────────────────────────
echo.
git log --oneline -10 --graph --decorate
echo.
pause
goto git_full_menu

:: --- Git Diff ---
:git_diff
cls
echo   git diff
echo   ─────────────────────────────────────────
echo.
echo   1 Unstaged (рабочая директория)
echo   2 Staged (добавленные)
echo   3 Последний коммит
echo   0 Назад
set /p diff_type="  > "
if "%diff_type%"=="1" (
    cls
    git diff
)
if "%diff_type%"=="2" (
    cls
    git diff --staged
)
if "%diff_type%"=="3" (
    cls
    git diff HEAD~1
)
if "%diff_type%"=="0" goto git_full_menu
pause
goto git_full_menu

:: --- Git Stash Save ---
:git_stash_save
cls
echo   git stash save
echo   ─────────────────────────────────────────
echo.
set /p stash_msg="  Сообщение (опционально): "
if "!stash_msg!"=="" (
    git stash
) else (
    git stash save "!stash_msg!"
)
pause
goto git_full_menu

:: --- Git Stash Pop ---
:git_stash_pop
cls
echo   git stash pop
echo   ─────────────────────────────────────────
echo.
git stash list
echo.
git stash list | findstr "." >nul 2>&1
if errorlevel 1 (
    echo   Stash пуст
    pause
    goto git_full_menu
)
set /p stash_idx="  Индекс (Enter = 0): "
if "!stash_idx!"=="" set stash_idx=0
git stash pop stash@{!stash_idx!}
pause
goto git_full_menu

:: --- Git Stash List ---
:git_stash_list
cls
echo   git stash list
echo   ─────────────────────────────────────────
echo.
git stash list
git stash list | findstr "." >nul 2>&1
if errorlevel 1 echo   Stash пуст
echo.
pause
goto git_full_menu

:: --- Git Restore ---
:git_restore
cls
echo   Отменить изменения файла
echo   ─────────────────────────────────────────
echo.
echo   Изменённые файлы:
git status -s
echo.
echo   Введи путь к файлу (или . для всех):
set /p restore_file="  > "
if "!restore_file!"=="" goto git_full_menu
echo.
echo   ВНИМАНИЕ: Изменения будут потеряны!
echo   Продолжить? (Y/N)
set /p confirm_restore="  > "
if /i "!confirm_restore!"=="Y" git checkout -- !restore_file!
pause
goto git_full_menu

:: --- Git Soft Reset ---
:git_soft_reset
cls
echo   git reset --soft HEAD~1
echo   ─────────────────────────────────────────
echo.
echo   Последний коммит:
git log --oneline -1
echo.
echo   Коммит будет отменён, изменения останутся staged.
echo   Продолжить? (Y/N)
set /p confirm_soft="  > "
if /i "!confirm_soft!"=="Y" (
    git reset --soft HEAD~1
    echo   Готово!
)
pause
goto git_full_menu

:: --- Git Hard Reset ---
:git_hard_reset
cls
echo   git reset --hard HEAD
echo   ─────────────────────────────────────────
echo.
echo   ╔═══════════════════════════════════════╗
echo   ║  ВНИМАНИЕ! ВСЕ ИЗМЕНЕНИЯ БУДУТ        ║
echo   ║  БЕЗВОЗВРАТНО УДАЛЕНЫ!                ║
echo   ╚═══════════════════════════════════════╝
echo.
git status -s
echo.
echo   Введи YES для подтверждения:
set /p confirm_hard="  > "
if "!confirm_hard!"=="YES" (
    git reset --hard HEAD
    git clean -fd
    echo   Сброшено!
)
pause
goto git_full_menu

:: --- Git Fetch All ---
:git_fetch_all
cls
echo   git fetch --all
echo   ─────────────────────────────────────────
echo.
git fetch --all --prune
pause
goto git_full_menu

:: ============================================================================
:git_init
cls
echo   Git не инициализирован
echo   ─────────────────────────────────────────
echo.
echo   1  Инициализировать git
echo   0  Назад
echo.
set /p gi="  > "

if "%gi%"=="1" (
    git init
    git branch -M main
    echo.
    echo   Git инициализирован (ветка main)
    pause
    goto git_add_remote
)
goto menu

:: ============================================================================
:git_add_remote
cls
echo   Настройка remote
echo   ─────────────────────────────────────────
echo.

:: Показываем текущий remote если есть
for /f "tokens=*" %%i in ('git remote get-url origin 2^>nul') do (
    echo   Текущий: %%i
    echo.
)

echo   Введи URL репозитория:
echo   (https://github.com/user/repo.git)
echo.
set /p remote_url="  > "

if "%remote_url%"=="" goto git_full_menu

:: Проверяем есть ли уже origin
git remote | findstr "origin" >nul 2>&1
if errorlevel 1 (
    git remote add origin "%remote_url%"
    echo.
    echo   Remote добавлен!
) else (
    git remote set-url origin "%remote_url%"
    echo.
    echo   Remote обновлён!
)

echo.
echo   Сделать первый push? (Y/N)
set /p fp="  > "
if /i "%fp%"=="Y" (
    git push -u origin main
)
pause
goto git_full_menu

:: ============================================================================
:test_node
cls
echo   Node тесты
echo.
call :log "Node Tests"
cd /d "%~dp0vscode"

set "TEMPLOG=%LOGDIR%\test_temp.log"
call npm run test-node > "%TEMPLOG%" 2>&1
set EXITCODE=%errorlevel%

type "%TEMPLOG%"
type "%TEMPLOG%" >> "%LOGFILE%"
del "%TEMPLOG%" 2>nul

if %EXITCODE% neq 0 (
    echo.
    echo   ОШИБКА!
)
pause
goto menu

:: ============================================================================
:test_browser
cls
echo   Browser тесты
echo.
call :log "Browser Tests"
cd /d "%~dp0vscode"

set "TEMPLOG=%LOGDIR%\test_temp.log"
call npm run test-browser > "%TEMPLOG%" 2>&1
set EXITCODE=%errorlevel%

type "%TEMPLOG%"
type "%TEMPLOG%" >> "%LOGFILE%"
del "%TEMPLOG%" 2>nul

if %EXITCODE% neq 0 (
    echo.
    echo   ОШИБКА!
)
pause
goto menu

:: ============================================================================
:show_versions
cls
echo   Версии
echo.
echo   Node.js:
node --version
echo.
echo   npm:
npm --version
echo.
echo   Путь: %~dp0vscode
pause
goto menu

:: ============================================================================
:clean_build
cls
echo   Очистка кэша
echo.
set /p confirm="   Удалить .build и out? (Y/N): "
if /i not "%confirm%"=="Y" goto menu

cd /d "%~dp0vscode"
if exist ".build" rmdir /s /q ".build" && echo   .build удален
if exist "out" rmdir /s /q "out" && echo   out удален
echo.
echo   Готово! Нужна перекомпиляция.
pause
goto menu

:: ============================================================================
:npm_install
cls
echo   npm install
echo.
cd /d "%~dp0vscode"
npm install
echo.
echo   Готово.
pause
goto menu

:: ============================================================================
:first_run
cls
echo   Первый запуск (сброс настроек)
echo.
set /p confirm="   Удалить настройки? (Y/N): "
if /i not "%confirm%"=="Y" goto menu

cd /d "%~dp0vscode"
if exist "%USERPROFILE%\.xynapse" rmdir /s /q "%USERPROFILE%\.xynapse"
if exist "%USERPROFILE%\.vscode-oss" rmdir /s /q "%USERPROFILE%\.vscode-oss"

echo   Запуск с мастером...
set "VSCODE_SKIP_PRELAUNCH=1"
call .\scripts\code.bat
set "VSCODE_SKIP_PRELAUNCH="
pause
goto menu

:: ============================================================================
:open_log
cls
echo   Лог: %LOGFILE%
echo.
if exist "%LOGFILE%" (
    powershell -Command "Get-Content '%LOGFILE%' -Tail 30"
    echo.
    echo   1 Открыть в Notepad
    echo   2 Очистить
    echo   0 Назад
    set /p lc="  > "
    if "!lc!"=="1" start notepad "%LOGFILE%"
    if "!lc!"=="2" del "%LOGFILE%" 2>nul && echo   Очищено
) else (
    echo   Лог пуст
)
pause
goto menu

:: ============================================================================
:vanilla_run
cls
echo   Запуск VANILLA (без настроек)
echo.
echo   IDE запустится с временным профилем:
echo   - Без расширений
echo   - Без пользовательских настроек
echo   - Дефолтная тема
echo   - Настройки НЕ сохранятся
echo.

cd /d "%~dp0vscode"

:: Создаём временные директории
set "VANILLA_DATA=%TEMP%\xynapse-vanilla-%RANDOM%"
set "VANILLA_EXT=%TEMP%\xynapse-vanilla-ext-%RANDOM%"
mkdir "%VANILLA_DATA%" 2>nul
mkdir "%VANILLA_EXT%" 2>nul

echo   Временный профиль: %VANILLA_DATA%
echo.

:: Запускаем с изолированным профилем
set "VSCODE_SKIP_PRELAUNCH=1"
call .\scripts\code.bat --user-data-dir "%VANILLA_DATA%" --extensions-dir "%VANILLA_EXT%"
set "VSCODE_SKIP_PRELAUNCH="

:: Очистка после закрытия
echo.
echo   Очистить временные файлы? (Y/N)
set /p clean_vanilla="  > "
if /i "%clean_vanilla%"=="Y" (
    rmdir /s /q "%VANILLA_DATA%" 2>nul
    rmdir /s /q "%VANILLA_EXT%" 2>nul
    echo   Очищено
)
pause
goto menu

:: ============================================================================
:exit_script
exit /b 0
