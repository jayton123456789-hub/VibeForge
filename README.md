<p align="center">
  <img src="https://raw.githubusercontent.com/jayton123456789-hub/VibeForge/main/assets/LOGO.png" width="220" alt="VibeForge Logo" />
</p>

# VibeForge 🚀

**Local AI Creative Session Studio**

> Turn conversations into products. Capture every idea. Remember every decision. Build faster together.

VibeForge is a desktop app (Electron + local SQLite) for creators who build through conversation. Record sessions, capture ideas on the fly, track decisions and tasks, search your project memory with local AI (Ollama), collaborate with your partner over the local network, and publish releases directly from the app.

Built for real workflows between you and your collaborator (e.g. Jayton + Nick). Everything stays local. No cloud accounts required.

## ✨ Features

- **Quick Capture & Idea Vault**: Hit "Capture Idea" from sidebar or sessions (even mid-conversation). Big text box + optional title. Auto-titles from first words. Smart rename with Ollama if available. Filters (Inbox / Saved / Archived / Converted), edit, convert to task/decision, archive, delete. All persist with timeline.
- **Live Recording Sessions**: Room (local mic + screen/window picker with system audio + live preview, level meter, big "RECORDING" overlay + draggable pill), Duo/Link (WebSocket peer over LAN), or Manual notes. **Live Convo/Transcript** with real-time typewriter speech-to-text. Mark decisions/tasks/ideas live via button menu. **Resume / continue any previous session** anytime (multi-visit support) — new recordings save as timestamped segments, notes + transcript append. Audio/video playback in detail. Full date/time tracking (start, end, duration) in lists and detail.
- **Decision Vault, Tasks & Timeline**: Track choices, action items, and full history. Convert ideas ↔ tasks/decisions.
- **Project Memory**: Local search across everything + Ollama-powered chat that only uses your real data (no hallucinations). Save useful answers.
- **Link with collaborators (real P2P)**: Host/Join over local network (no internet). Send notes, files, bundles. Received items saved locally with reveal. Clear instructions + firewall troubleshooting built in.
- **In-App Publishing (for repo owner)**: In Settings > Updates, sign in with gh CLI (persists), auto-detects DEV/owner account, one-click build portable + publish real GitHub release with the .exe attached. "CHECK FOR UPDATE" for everyone else.
- **Ollama AI Integration**: Local-only. Smart naming, summaries, task/decision extraction, memory chat, model pull/install helpers, warnings for disk/RAM. Works offline.
- **Exports & Folders**: Real files in `%APPDATA%\VibeForge\exports\...` (not just browser downloads). Reveal buttons everywhere. Markdown, JSON, Grok prompts.
- **Clean, Friendly UI**: Tabbed phone-style Settings (General / AI Tools / Updates / Files / Reset). No overwhelming walls of cards. Big obvious "CHECK FOR UPDATE". Capture Idea always one tap away.
- **Persistent & Private**: Single SQLite DB (WAL). gh CLI auth persists for publishing. Reset All Data nukes everything cleanly. No demo data ever.

## 🖥️ Quick Start

1. Download the latest **VibeForge-Portable.exe** from [Releases](https://github.com/jayton123456789-hub/VibeForge/releases).
2. Run it. (Or for dev: double-click `launch.bat` in the source folder.)
3. Create a project → New Session (Room / Duo / Manual).
4. Capture ideas fast with the green **Capture Idea** button (sidebar + sessions header).
5. Use Project Memory for search + AI chat.
6. Link tab for room-code collaboration with your partner.
7. (Owner) Settings → Updates tab → sign in with gh → Build & Publish releases directly.

**For collaborators**: Just use the portable. The "CHECK FOR UPDATE" button in Settings > Updates keeps you in sync with releases from the owner.

## 🔧 For the Repo Owner (DEV Mode)

The app auto-detects when you're signed in via `gh` CLI as the repo owner (`jayton123456789-hub`).

- Go to **Settings → Updates**.
- Big **CHECK FOR UPDATE** is always front-and-center.
- Sign in (uses your local gh auth — persists across launches and builds; the app never stores passwords or tokens itself).
- Once detected as owner: DEV banner appears, your repo is pre-filled, Build Portable + Publish Release buttons activate.
- Publish does a real `gh release create` with the portable .exe attached — exactly like a pro release.

This keeps your workflow fast: build in the app → publish → your partner pulls the new portable.

## 🛠️ Development

```bash
# Run
launch.bat   # or: npx --yes electron@30.5.1 .

# Rebuild native (after changes)
npm run rebuild

# Full portable build (what the in-app publish uses)
npm run dist
```

Tech: Electron 30, better-sqlite3, ws (real LAN peer), MediaRecorder for audio, Ollama HTTP API, Tailwind + Font Awesome (CDN for zero deps).

All data in `%APPDATA%\VibeForge\data\vibeforge.db`. Exports/recordings in sibling folders.

## Collaboration (Link with Partner)

- Open Link, then Host to generate a room code.
- The other person opens Link, pastes the code, and clicks Join.
- Once connected, both apps can mirror tabs, send a test ping, send latest session notes, and transfer files.
- Use "Open Tester Window" to simulate a second person on one PC before testing with Nick or Dylan.
- Received files land in the local `received\` folder with reveal.

No accounts are required. Link uses PeerJS for signaling and WebRTC for the peer connection.

## Recent Fixes (v0.4.2)

- Link workspace: Share is now Link. It has Host/Join, a one-PC tester window, connected-state controls, mirrored tabs, ping, latest-notes send, file send, and a clearer flow for Duo sessions.
- Launch is hardened: launch.bat no longer force-rebuilds better-sqlite3 every run, preventing the EPERM native-module crash when Electron still has the .node file locked.
- Update checks normalize tags like v4 to 0.4.0 so accidental GitHub release names do not confuse the app.
- Continue/resume sessions: Resume Live buttons reopen the same session with previous notes/transcript and save new timestamped recording segments.
- Date/time tracking: sessions show start, end, duration, and mode in lists and detail.
- Live room polish: notes are behind a button, quick actions are in a menu, recording status is prominent, and transcript/AI cleanup stays focused on the goal of not typing.
- Whisper setup is more robust: it uses python -m pip inside the venv, upgrades pip/setuptools/wheel, and cleans broken venvs on retry.
- Browser prompt crashes were replaced with real app modals for input flows.

## Releases & Updates

- Everyone gets a big CHECK FOR UPDATE in Settings.
- Owner uses the same tab for real publishing.
- Current recommended release: v0.4.2 or newer.

## Philosophy

> For creators who build through conversation.

Capture ideas and decisions while talking, then let local AI organize the workspace after the session. VibeForge is local-first, built for you and your collaborators, and designed to avoid making people type while they are trying to think out loud.

---

**VibeForge** - local first, fast to record, smart after the conversation.

If you are the owner: sign in once via gh, build and publish from inside the app after that.
