# Fresh Windows dependency checklist

VibeForge is shipped as a portable Electron app. A brand-new Windows 10/11 PC should be able to download `VibeForge-Portable.exe`, run it, and use the first-run setup wizard.

## Bundled in the EXE

- Electron runtime
- SQLite native module (`better-sqlite3`)
- App JavaScript, preload scripts, HTML/CSS
- Local vendor assets: Tailwind, Font Awesome, PeerJS, WaveSurfer
- App logo/assets

## Installed or downloaded by first-run setup

- Ollama for Windows
  - First tries `winget install Ollama.Ollama`.
  - If `winget` is missing or fails, tries Ollama's official PowerShell installer: `irm https://ollama.com/install.ps1 | iex`.
  - Re-checks known install paths instead of relying only on PATH.
- Default Ollama model
  - Pulls the configured model, default `llama3.2`.
  - Skips cleanly if Ollama is still not installed.
- Whisper transcription
  - Downloads `whisper.cpp` Windows binary zip.
  - Downloads `ggml-base.en.bin`.
  - Extracts with built-in Windows PowerShell `Expand-Archive`.

## Failure behavior

- The wizard must remain visible and skippable.
- Installer windows/UAC prompts are allowed to come to the front.
- Missing Ollama must not crash the app.
- Failed model or Whisper downloads are shown in the wizard log and can be completed later in Settings.
- Fatal launch/runtime exceptions are appended to `%APPDATA%\VibeForge\launch-error.log`.
