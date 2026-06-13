VibeForge - Local AI Creative Session Studio (Minimal Working Skeleton)

This is a clean, local-first Electron app for recording creative/coding sessions with you and Nick.

HOW TO LAUNCH (dev):
- Double-click launch.bat
- Or: npm start

FIRST LAUNCH (after nuke or clean):
- You will see "No project yet" + big "Create First Project" button.
- NO DoReMii, NO fake sessions, NO demo data ever.
- Create a project (e.g. "DoReMii").
- Then use + New Session (top right or sidebar quick).
- Choose Room (local mic/notes), Duo/Link (for Nick over LAN), or Manual Notes Only.
- All data is in ONE SQLite DB at:
  %APPDATA%\VibeForge\data\vibeforge.db

CORE WORKING FEATURES (all buttons wired and tested):
- Project header dropdown: Create/Rename/Delete/Switch projects.
- Sessions list + cards: Open (to detail), Delete.
- New Session modal: name + 3 modes + Start/Cancel/X/Escape/outside-close all work.
- Session detail (for manual/room): notes, Mark Decision/Task/Idea, Stop (saves).
- Decision Vault: Add/Edit/Delete/Convert to Task (persists).
- Tasks: Add/Mark Done/Delete (persists).
- Idea Vault: Add/Delete/Convert to Task (persists).
- Timeline: real events only.
- Project Memory: real local search across your data (no fake AI yet).
- Share: Host/Join over local LAN (IP:PORT shown), status, disconnect. (File sync is stub for now.)
- Settings: profile, storage debug (paths + counts + Reveal + Hard Reset), Reset All Data (double confirm + type RESET).

DATA RULES:
- Only one source of truth: the SQLite DB in userData/data.
- No demo seeding. App starts completely empty.
- Reset All Data (in Settings) fully wipes the data dir + storage + relaunch to clean state.

COMMANDS:
- npm start
- npm run build (for builder)
- npm run dist:portable (produces portable exe)
- npm run nuke:data (nuclear wipe of %APPDATA%\VibeForge)
- npm run verify:clean (prints counts - should be 0 after nuke/reset)

To share with Nick:
- See HOW-TO-LINK-WITH-NICK.txt
- Both on same LAN/WiFi.
- Build a portable (npm run dist:portable) or zip the folder + node_modules.
- Nick runs the portable or npm start after npm install.
- Use Share tab to link (Host shows address, Nick joins).

This version is intentionally minimal and stable. Advanced audio/Whisper/Ollama generation/file transfer are not yet implemented - buttons for them are not shown.

If you Reset or nuke, always verify with "npm run verify:clean" or the Storage Status in Settings.

Enjoy building through conversation. Everything stays on this machine.