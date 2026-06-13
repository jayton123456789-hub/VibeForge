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
- **Live Recording Sessions**: Room (local mic + screen/window picker with system audio + live preview, real waveform/meter, clear in-page recording dock), Duo/Link (room-code PeerJS/WebRTC), or Manual notes. **Live Convo/Transcript** with real-time typewriter speech-to-text. Mark decisions/tasks/ideas live via button menu. **Resume / continue any previous session** anytime (multi-visit support) — new recordings save as timestamped segments, notes + transcript append. Waveform playback in detail. Full date/time tracking (start, end, duration) in lists and detail.
- **Decision Vault, Tasks & Timeline**: Track choices, action items, and full history. Convert ideas ↔ tasks/decisions.
- **Project Memory**: Local search across everything + Ollama-powered chat that only uses your real data (no hallucinations). Save useful answers.
- **Link with collaborators (real P2P)**: Host/Join with room codes for separate PCs. Send linked session invites, peer recording state, AI cleanup summaries, notes, files, and bundles. Received items save locally with reveal.
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

Tech: Electron 30, better-sqlite3, ws (real LAN peer), MediaRecorder for audio, Ollama HTTP API, bundled Tailwind + Font Awesome for offline launch.

All data in `%APPDATA%\VibeForge\data\vibeforge.db`. Exports/recordings in sibling folders.

## Collaboration (Link with Partner)

- Open Link, then Host to generate a room code.
- The other person opens Link, pastes the code, and clicks Join.
- Once connected, both apps can mirror tabs, send a test ping, send latest session notes, and transfer files.
- Use "Open Tester Window" to simulate a second person on one PC before testing with Nick or Dylan.
- Received files land in the local `received\` folder with reveal.

No accounts are required. Link uses PeerJS for signaling and WebRTC for the peer connection.

## Recent Fixes (v0.4.6)

- Recording review now bundles `wavesurfer.js` locally (BSD-3-Clause) for real waveform playback on saved sessions. Native audio controls remain as a fallback.
- Live recording UI replaces fake dashed waveform strips with real canvas waveform motion from the mic analyser.
- Duo/Link recording now has a two-person participant strip ("You" + linked PC) and explicit "Duo Link Session" labeling so it feels connected, not like a solo room.
- Linked apps now send/receive `session-state` while recording. If the peer starts recording and your side is idle, VibeForge shows a Join Session prompt and Link Control gets an active peer recording card.
- Tour spotlight positioning is fixed for the scrollable sidebar: it scrolls the target into view first, then measures the final position, so Quick Record/Capture Idea/Link highlights do not drift onto the wrong button.
- Version bumped to `0.4.6`.

## Recent Fixes (v0.4.5)

- Recovered the useful old-chat work safely on top of the stable v0.4.4 renderer: real spotlight tour, Duo stop sync, linked transcript merge, Duo AI cleanup result sharing, clearer Duo recording banner, and public-facing Settings cleanup.
- Duo / Link sessions now behave like a remote internet workflow: if both PCs are linked and one side starts a Duo session, the other side receives a Join Session popup; accepting creates a local session with the host start time. If one side stops, the other side is asked to stop/save too, then both sides can run local AI cleanup and exchange compact cleanup results.
- Link's "Open Tester Window" remains as a development-only two-window simulator for local testing. It should be hidden or removed before `v1.0.0`; real Nick/Dylan usage is the room-code Link flow across separate PCs/networks.
- Settings > Updates is now user-facing only: current version + Check for Update. GitHub sign-in/dev build/publish UI is no longer shown inside the normal app.

## Recent Fixes (v0.4.4)

- Link workspace: Share is now Link. After connecting, Link unlocks real sidebar child tabs: Control, Remote Vault, and Link Vault. It also supports mirrored tabs, linked-session invites, the active-recording island while browsing other tabs, remote snapshots, ping, latest-notes send, and file transfer.
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
- Current recommended release: v0.4.5 or newer.

## Philosophy

> For creators who build through conversation.

Capture ideas and decisions while talking, then let local AI organize the workspace after the session. VibeForge is local-first, built for you and your collaborators, and designed to avoid making people type while they are trying to think out loud.

---

**VibeForge** - local first, fast to record, smart after the conversation.

If you are the owner: sign in once via gh, build and publish from inside the app after that.
