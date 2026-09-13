@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 检查状态
set "NODE_EXE="
set "NEED_ADMIN=0"

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

:have_node
if not defined NODE_EXE goto :no_node

rem ---- pick up the resources path discovered by elevate.ps1 (if any) ----
if exist "%TEMP%\claude-zh-cn-resources.txt" set /p RES_HINT=<"%TEMP%\claude-zh-cn-resources.txt"
if defined RES_HINT set "CLAUDE_RESOURCES_HINT=!RES_HINT!"

rem This script only READS. It must never ask for administrator rights:
rem the check is exactly the thing a user runs when they are unsure whether
rem anything needs fixing. Elevation belongs to the install script alone.
goto :run

:nothing_to_do
echo Everything is already up to date.
echo.
pause
exit /b 0

:elevate
echo.
echo Claude's install folder is protected by Windows.
echo Administrator rights are required to write the language files.
echo A UAC prompt will appear - please click Yes.
echo.
rem Do NOT re-launch this .bat: even elevated, the Administrators group only has
rem ReadAndExecute on that folder. elevate.ps1 backs up the ACL, takes ownership,
rem grants write access, runs the installer, then restores the ACL.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0scripts\elevate.ps1' -Verb RunAs"
exit /b 0

:run
echo Using Node.js: !NODE_EXE!
echo.
"!NODE_EXE!" "%~dp0scripts\detect.mjs" %*
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
echo   That is the current status. Nothing was modified.
echo ============================================================
echo.
pause
exit /b 0

:failed
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
