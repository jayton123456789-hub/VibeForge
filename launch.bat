@echo off
cd /d %~dp0
title VibeForge

REM Install dependencies only on first run (when node_modules is missing).
if not exist node_modules (
  echo First run - installing dependencies. This happens once...
  call npm install
)

REM Rebuild the native module (better-sqlite3) only when it is actually missing.
REM Do NOT rebuild every launch: Windows locks better_sqlite3.node while Electron is open,
REM which causes EPERM unlink crashes. If the native file exists, launch immediately.
if not exist node_modules\.vibeforge-rebuilt (
  if exist node_modules\better-sqlite3\build\Release\better_sqlite3.node (
    echo Native modules already present. Skipping rebuild.
    echo done > node_modules\.vibeforge-rebuilt
  ) else (
    echo Preparing native modules one time...
    taskkill /IM electron.exe /F >nul 2>nul
    call npm run rebuild
    if errorlevel 1 (
      echo Rebuild failed. Close all VibeForge/Electron windows and run launch.bat again.
      pause
      exit /b 1
    )
    echo done > node_modules\.vibeforge-rebuilt
  )
)

REM Launch using the local Electron binary directly - no network, no npx overhead.
if exist node_modules\.bin\electron.cmd (
  call node_modules\.bin\electron.cmd .
) else (
  npx --yes electron@30.5.1 .
)
