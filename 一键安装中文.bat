@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 一键安装中文
set "NODE_EXE="
set "NEED_ADMIN=1"
set "RES_HINT="
set "CODE="

rem ---- locate node ----
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%P"
if defined NODE_EXE goto :have_node
if exist "D:\Node.js\node.exe" set "NODE_EXE=D:\Node.js\node.exe"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if exist "%LOCALAPPDATA%\nvs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\nvs\node.exe"
if exist "%APPDATA%\npm\node.exe" set "NODE_EXE=%APPDATA%\npm\node.exe"
if exist "%USERPROFILE%\scoop\apps\nodejs\current\node.exe" set "NODE_EXE=%USERPROFILE%\scoop\apps\nodejs\current\node.exe"
if exist "%LOCALAPPDATA%\Volta\bin\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Volta\bin\node.exe"
if exist "%USERPROFILE%\.volta\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.volta\bin\node.exe"
if exist "%ProgramFiles%\Microsoft\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\Microsoft\nodejs\node.exe"

rem Hand the discovered path to elevate.ps1: the elevated process is a NEW
rem process and may not inherit the same PATH (nvm-windows, Volta, fnm and
rem similar per-user managers are the usual culprits). Without this the
rem elevated side can report "Node.js not found" right after this side
rem successfully used it.
if defined NODE_EXE set "CLAUDE_ZH_CN_NODE=%NODE_EXE%"

:have_node
if not defined NODE_EXE goto :no_node

rem ---- pick up the resources path discovered by elevate.ps1 (if any) ----
if exist "%TEMP%\claude-zh-cn-resources.txt" set /p RES_HINT=<"%TEMP%\claude-zh-cn-resources.txt"
if defined RES_HINT set "CLAUDE_RESOURCES_HINT=!RES_HINT!"

if "%~1"=="admin" goto :admin
if "%NEED_ADMIN%"=="0" goto :run

rem ---- decide whether we need administrator rights ----
"!NODE_EXE!" "%~dp0scripts\need-admin.mjs" 2>nul
set "NEED=%ERRORLEVEL%"
if "%NEED%"=="0" goto :nothing_to_do
if "%NEED%"=="2" goto :run_elevate
goto :run

:nothing_to_do
echo Everything is already up to date.
echo.
pause
exit /b 0

rem ---- elevate, then run the installer in a window the user can watch ----
rem
rem Why a helper script instead of plain "Start-Process -Verb RunAs":
rem   The UAC prompt is drawn on the secure desktop. When this .bat is started
rem   from a non-interactive context, that prompt can be invisible to the user
rem   and everything just hangs. elevate-run.ps1 first tries a scheduled task
rem   with RunLevel Highest (no UAC at all) and only then falls back to the
rem   normal UAC prompt.
rem
rem Do NOT just re-run elevated and write directly: even elevated,
rem BUILTIN\Administrators only has ReadAndExecute on Claude's folder.
rem elevate.ps1 takes ownership, grants write access, installs, restores ACLs.
:run_elevate
echo.
echo The Claude install folder is protected by Windows.
echo Administrator rights are needed to write the language files.
echo If a UAC prompt appears, please click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%TEMP%\claude-zh-cn-done.txt' -Force -ErrorAction SilentlyContinue; & '%~dp0scripts\elevate-run.ps1' -Script '%~dp0scripts\elevate.ps1'"

rem Wait for the administrator window to finish (it writes the exit code to
rem %TEMP%\claude-zh-cn-done.txt). Poll instead of relying on the exit code,
rem because the elevated process is a separate process.
call :wait_done
if exist "%TEMP%\claude-zh-cn-done.txt" (
    set /p CODE=<"%TEMP%\claude-zh-cn-done.txt"
    if "!CODE!"=="0" goto :done
    goto :failed
)

echo.
echo ============================================================
echo   The administrator window is still open.
echo   Check it for progress and the final result.
echo ============================================================
echo.
pause
exit /b 0

rem ---- wait up to ~5 minutes for the elevated run to finish ----
:wait_done
for /l %%I in (1,1,300) do (
    if exist "%TEMP%\claude-zh-cn-done.txt" exit /b 0
    ping -n 2 127.0.0.1 >nul
)
exit /b 0

rem ---- running elevated: hand over to elevate.ps1 ----
rem Reached only when this .bat was re-run with the "admin" argument, i.e. the
rem user launched it as administrator by hand. In that case just run the
rem installer directly; no second elevation is needed.
:admin
if defined RES_HINT (
    echo Resources: !RES_HINT!
) else (
    echo Resources: (auto-detect)
)
echo.
if "%~2"=="nopause" goto :admin_nopause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\elevate.ps1"
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto :failed
goto :done

:admin_nopause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\elevate.ps1" -NoPause
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto :failed
goto :done

:run
echo Using Node.js: !NODE_EXE!
echo.
"!NODE_EXE!" "%~dp0scripts\install.mjs" %*
set "CODE=%ERRORLEVEL%"
echo.

rem exit code 4 means "check only, nothing was written"
if "%CODE%"=="4" goto :checkonly
if not "%CODE%"=="0" goto :failed
goto :done

:checkonly
echo ============================================================
echo   Check run only - nothing was modified.
echo   Run this .bat without the "check" argument to install.
echo ============================================================
echo.
pause
exit /b 0

:done
echo ============================================================
echo   Done. Please fully quit Claude and start it again.
echo ============================================================
echo.
pause
exit /b 0

:failed
if not defined CODE set "CODE=1"
echo ============================================================
echo   Failed. Exit code: %CODE%
echo ============================================================
echo.
echo   ---- last lines of the install log ----
echo   (full log: %TEMP%\claude-zh-cn-install.log)
echo.
call :tail_log
echo.
echo   Common causes:
echo     1. Not enough permission - right click this .bat
echo        and choose "Run as administrator"
echo     2. Claude Desktop not found (start it once after installing)
echo     3. Antivirus or Controlled Folder Access blocking takeown/icacls
echo     4. Other - please post the lines above here:
echo        https://github.com/Blake1010-bit/Claude-zh-cn-for-Windows/issues
echo ============================================================
echo.
pause
exit /b %CODE%

rem ---- print the last 30 lines of the install log ----
rem The generic "possible reasons" list is useless on its own: the real reason
rem is in the log written by elevate.ps1. Showing its tail here means the user
rem can copy one screen and the cause is usually visible.
:tail_log
if not exist "%TEMP%\claude-zh-cn-install.log" (
    echo   (no log file - the installer probably never started^)
    exit /b 0
)
rem Backquotes = run a command; ^| and ^> inside must be escaped for cmd.
for /f "delims=" %%L in ('powershell -NoProfile -Command "Get-Content -LiteralPath '%TEMP%\claude-zh-cn-install.log' -Tail 30 -ErrorAction SilentlyContinue"') do echo   %%L
exit /b 0

:no_node
echo ============================================================
echo   [ERROR] Node.js not found
echo ============================================================
echo.
echo   This tool needs Node.js to run.
echo.
echo   Download the LTS version here (choose the Windows installer):
echo     https://nodejs.org/
echo.
echo   Install it with the default options, then run this file again.
echo ============================================================
echo.
pause
exit /b 1
