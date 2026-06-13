@echo off
cd /d %~dp0
title VibeForge

REM Install dependencies only on first run (when node_modules is missing).
if not exist node_modules (
  echo First run - installing dependencies. This happens once...
  call npm install
)

REM Rebuild the native module (better-sqlite3) only when needed, not every launch.
REM A marker file records that the rebuild succeeded, so later launches skip it.
if not exist node_modules\.vibeforge-rebuilt (
  echo Preparing native modules one time...
  call npm run rebuild
  if errorlevel 1 (
    echo Rebuild failed. See messages above.
    pause
    exit /b 1
  )
  echo done > node_modules\.vibeforge-rebuilt
)

REM Launch using the local Electron binary directly - no network, no npx overhead.
if exist node_modules\.bin\electron.cmd (
  call node_modules\.bin\electron.cmd .
) else (
  npx --yes electron@30.5.1 .
)
