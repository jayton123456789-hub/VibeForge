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
- **Share with Nick (real P2P)**: Host/Join over local network (no internet). Send notes, files, bundles. Received items saved locally with reveal. Clear instructions + firewall troubleshooting built in.
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
6. Share tab for LAN collab with your partner.
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

## 🤝 Collaboration (Share with Partner)

- Both on same Wi-Fi/LAN.
- One clicks Host in Share tab → tells the other the address.
- Other pastes into Join.
- Send notes, exported bundles, files. Everything lands in local `received\` folder with reveal.
- Windows Firewall note + troubleshooting built into the UI.

No servers, no accounts, no internet required for core use.

## Recent Fixes (v0.2.0)
- Whisper one-click setup fully robust (uses `python -m pip` + upgrade step inside venv; auto-cleans broken venv on failure; no more pip._internal crashes).
- **Continue / resume any session**: "Resume Live" buttons in session list + detail view. Re-opens live room pre-filled with previous notes/transcript. Multiple visits supported ("multi" work on the same session). New audio segments are timestamped files; notes + live transcript append on each Stop.
- Date & time tracking: Sessions list and detail now show full start → end (with duration in minutes) using `ended_at`. Updated automatically on Stop.
- **Live room UI WAY better**: Notes now behind a clean "📝 Notes" button (opens nice editor modal with large textarea). Quick Actions collapsed into a single "⚡ Quick Actions" popup menu (with icons for Mark Decision/Task/Idea, Add Note, Change Screen). Cleaner main area focused on Recording bar, Mic meter, and **Live Convo / Transcript** (typewriter real-time speech). "Resume this session anytime" hint. Floating draggable recording overlay still there.
- No more browser `prompt()` / `confirm()` crashes in sandboxed renderer (all replaced with proper input modals or kept only for destructive confirms).
- Live chat/convo: The real-time transcript is now prominently "Live Convo". Duo peer notes sending/receiving continues to work for cross-PC chat.
- Start Session modal + project creation now use the nice input modal (no crashes when no project selected).
- All previous QOL (exports real + reveal, Ollama wizard, GH persist + publish, Share, etc.) intact.

## 📦 Releases & Updates

- Everyone gets a big **CHECK FOR UPDATE** in Settings.
- Owner uses the same tab for real publishing (see above).
- Test release example: [v0.1.0 (Grok test)](https://github.com/jayton123456789-hub/VibeForge/releases/tag/v0.1.0-grok-test)

## Philosophy

> For creators who build through conversation.

Capture the "shit, that's a good idea" moment instantly. Never lose a decision. Turn talk into shipped product — with your collaborator, locally, with AI that only knows *your* stuff.

---

**VibeForge** — built for speed between you and your partner. Local first. Fancy where it counts. Ready to ship.

If you're the owner: sign in once via gh, build & publish from inside the app forever after. No context switching.

---

*Local AI Creative Session Studio. No cloud. No fuss. Just better building.*