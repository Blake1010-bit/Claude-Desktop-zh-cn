@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 一键还原
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

rem Hand the discovered path to elevate.ps1 (see 一键安装中文.bat for why).
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
echo Nothing to restore - the Chinese language files are not installed.
echo.
pause
exit /b 0

rem ---- elevate, then run the restore in a window the user can watch ----
rem Restoring also has to write into Claude's protected folder, so it needs the
rem same ownership grant as installing. elevate-run.ps1 first tries a scheduled
rem task with RunLevel Highest (no UAC) and falls back to the normal UAC prompt.
:run_elevate
echo.
echo The Claude install folder is protected by Windows.
echo Administrator rights are needed to restore the original files.
echo If a UAC prompt appears, please click Yes.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%TEMP%\claude-zh-cn-done.txt' -Force -ErrorAction SilentlyContinue; & '%~dp0scripts\elevate-run.ps1' -Script '%~dp0scripts\elevate.ps1' -ScriptArgs '-Mode','restore'"

rem Wait for the administrator window to finish (it writes the exit code to
rem %TEMP%\claude-zh-cn-done.txt).
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

rem ---- running elevated by hand: hand over to elevate.ps1 ----
:admin
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\elevate.ps1" -Mode restore
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" goto :failed
goto :done

:run
echo Using Node.js: !NODE_EXE!
echo.
"!NODE_EXE!" "%~dp0scripts\restore.mjs" %*
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
echo   Restore finished. Please fully quit Claude and start it again.
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
echo   Possible reasons:
echo     1. Not enough permission - right click this .bat
echo        and choose "Run as administrator"
echo     2. Claude Desktop not found
echo     3. Other - please screenshot the output above and report:
echo        https://github.com/Blake1010-bit/Claude-zh-cn-for-Windows/issues
echo ============================================================
echo.
pause
exit /b %CODE%

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
