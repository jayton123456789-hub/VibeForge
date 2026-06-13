const { app, BrowserWindow, ipcMain, dialog, shell, Menu, desktopCapturer, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const os = require('os');
const https = require('https');

function writeLaunchLog(message, err) {
  try {
    const dir = app && app.getPath ? app.getPath('userData') : __dirname;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'launch-error.log'), [
      new Date().toISOString(),
      message,
      err && (err.stack || err.message || String(err)),
      ''
    ].filter(Boolean).join('\n'), 'utf8');
  } catch (e) {}
}

process.on('uncaughtException', (err) => {
  writeLaunchLog('Uncaught exception during launch/runtime', err);
});
process.on('unhandledRejection', (err) => {
  writeLaunchLog('Unhandled rejection during launch/runtime', err);
});

// === Portable self-update support (auto download on launch, clean old files, no clutter) ===
const updateDir = path.join(app.getPath('userData'), 'update');
if (fs.existsSync(updateDir)) {
  try {
    fs.readdirSync(updateDir).forEach(f => {
      try { fs.unlinkSync(path.join(updateDir, f)); } catch (e) {}
    });
  } catch (e) {}
}

// Handle update mode early (headless): the downloaded temp exe waits for old exe to release lock,
// copies itself over the target location, launches the fresh updated version, then quits.
// IMPORTANT: skip single-instance quit and window creation so replace can happen reliably.
const argv = process.argv || [];
const updateTargetIdx = argv.indexOf('--update-target');
const isUpdateMode = updateTargetIdx > -1;
if (isUpdateMode) {
  const targetPath = argv[updateTargetIdx + 1];
  if (targetPath) {
    // Async retry: the old exe may hold a file lock for a few seconds while it exits.
    const tryReplace = async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      await sleep(900);
      const deadline = Date.now() + 15000;
      let copied = false;
      while (!copied && Date.now() < deadline) {
        try {
          fs.copyFileSync(process.execPath, targetPath);
          copied = true;
        } catch (e) {
          await sleep(300);
        }
      }
      try {
        const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch (e) {}
      app.quit();
    };
    tryReplace();
  }
}

// Single instance lock - never more than 1 copy (but allow the update-replacer child to proceed)
if (!isUpdateMode && !app.requestSingleInstanceLock()) {
  app.quit();
}

function normalizeVersion(v) {
  const raw = (v || '').toString().replace(/^v/i, '').replace(/[^0-9.]/g, '');
  const parts = raw.split('.').filter(Boolean);
  if (parts.length === 1) {
    // Treat GitHub tags like "v4" as app version "0.4.0", not major version 4.
    return `0.${parseInt(parts[0], 10) || 0}.0`;
  }
  if (parts.length === 2) return `${parseInt(parts[0], 10) || 0}.${parseInt(parts[1], 10) || 0}.0`;
  return `${parseInt(parts[0], 10) || 0}.${parseInt(parts[1], 10) || 0}.${parseInt(parts[2], 10) || 0}`;
}

function isNewerVersion(latest, current) {
  const lp = normalizeVersion(latest).split('.').map(x => parseInt(x, 10) || 0);
  const cp = normalizeVersion(current).split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(lp.length, cp.length);
  for (let i = 0; i < len; i++) {
    const a = lp[i] || 0;
    const b = cp[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return false;
}

// Shared download helper: follows redirects (GitHub/HuggingFace assets redirect to CDNs),
// sends a User-Agent, optional progress callback (0-100).
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    file.on('error', (err) => {
      try { req && req.destroy(); } catch (e) {}
      try { fs.unlinkSync(dest); } catch (e) {}
      reject(err);
    });
    const req = https.get(url, { headers: { 'User-Agent': 'VibeForge' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close();
        try { fs.unlinkSync(dest); } catch (e) {}
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch (e) {}
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      let lastPct = -1;
      res.on('data', (chunk) => {
        got += chunk.length;
        if (onProgress && total > 0) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.setTimeout(60000, () => {
      req.destroy(new Error(`Timed out downloading ${url}`));
    });
    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(dest); } catch (err) {}
      reject(e);
    });
  });
}

function getOllamaExe() {
  const fullPaths = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe'
  ];
  for (const p of fullPaths) {
    if (fs.existsSync(p)) return p;
  }
  return 'ollama';
}

function getSetupMarkerPath() {
  return path.join(app.getPath('userData'), 'setup-complete.json');
}

function isSetupComplete() {
  return fs.existsSync(getSetupMarkerPath());
}

function markSetupComplete(reason = 'setup') {
  try {
    const marker = getSetupMarkerPath();
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, JSON.stringify({ completedAt: new Date().toISOString(), reason }, null, 2), 'utf8');
  } catch (e) {
    writeLaunchLog('Could not write setup marker', e);
  }
}

function checkVcRuntimeInstalled() {
  const needed = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll'];
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  return needed.every(name => fs.existsSync(path.join(sys, name)));
}

async function installVcRuntime(onLog) {
  if (checkVcRuntimeInstalled()) return { ok: true, alreadyInstalled: true };
  const tempDir = path.join(os.tmpdir(), 'VibeForgeSetup');
  fs.mkdirSync(tempDir, { recursive: true });
  const installer = path.join(tempDir, 'vc_redist.x64.exe');
  onLog && onLog('Downloading Microsoft Visual C++ runtime...\n');
  await downloadFile('https://aka.ms/vs/17/release/vc_redist.x64.exe', installer, pct => {
    if (pct % 20 === 0) onLog && onLog(`  VC++ runtime: ${pct}%\n`);
  });
  onLog && onLog('Installing Microsoft Visual C++ runtime...\n');
  const result = await runSetupProcess(installer, ['/install', '/quiet', '/norestart'], onLog, { windowsHide: false });
  return { ...result, installed: checkVcRuntimeInstalled() };
}

function getOllamaCommand() {
  const exe = getOllamaExe();
  return exe.includes(' ') ? `"${exe}"` : exe;
}

function commandExists(command) {
  return new Promise(resolve => {
    exec(`where ${command}`, (err) => resolve(!err));
  });
}

function checkOllamaInstalled() {
  return new Promise(resolve => {
    const exe = getOllamaExe();
    const cmd = exe === 'ollama' ? 'ollama --version' : `"${exe}" --version`;
    exec(cmd, (err, stdout) => {
      resolve({ installed: !err, exe, version: (stdout || '').trim(), error: err ? err.message : null });
    });
  });
}

function runSetupProcess(command, args, onLog, options = {}) {
  return new Promise(resolve => {
    try {
      const proc = spawn(command, args, {
        shell: !!options.shell,
        windowsHide: !!options.windowsHide
      });
      proc.stdout && proc.stdout.on('data', d => onLog && onLog(d.toString()));
      proc.stderr && proc.stderr.on('data', d => onLog && onLog(d.toString()));
      proc.on('close', code => resolve({ ok: code === 0, code }));
      proc.on('error', err => resolve({ ok: false, error: err.message }));
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

let mainWindow;
let duoTestWindow = null;
let db;
let firstRunPending = false;
let peerServer = null;
let peerClient = null;
let currentPeer = null; // { type: 'host' | 'client', address: string, ws: ws }
let hostAddress = null; // stored when duoHost() starts so get-peer-status can return it immediately
let peerJsHost = null;  // PeerJS Peer instance (host side)
let peerJsConn = null;  // active PeerJS DataConnection
let peerJsId = null;    // our PeerJS peer ID (the room code)
let pendingIncomingFile = null; // tracks incoming file metadata across chunks
let Database = null;

// Config for tray/close later, but minimal now - always quit on close
let appConfig = {};

// Data dir
function getDataDir() {
  const dir = path.join(app.getPath('userData'), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath() {
  return path.join(getDataDir(), 'vibeforge.db');
}

function getExportsDir(projectId) {
  const dir = path.join(app.getPath('userData'), 'exports', projectId || 'general');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getReceivedDir() {
  const dir = path.join(app.getPath('userData'), 'received');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRecordingsDir() {
  const dir = path.join(app.getPath('userData'), 'recordings');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function initDb() {
  const dbPath = getDbPath();
  if (!Database) {
    try {
      Database = require('better-sqlite3');
    } catch (err) {
      writeLaunchLog('Failed to load better-sqlite3. Microsoft Visual C++ Runtime may be missing.', err);
      dialog.showErrorBox(
        'VibeForge needs a Windows runtime',
        'VibeForge could not load its local database engine. Run the setup wizard again, or install Microsoft Visual C++ Redistributable x64, then reopen VibeForge.\n\nA log was written to launch-error.log.'
      );
      app.quit();
      throw err;
    }
  }
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Core tables - clean, no demo seed
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      notes TEXT DEFAULT '',
      audio_path TEXT
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'proposed',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      notes TEXT DEFAULT '',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'open',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT DEFAULT '',
      timestamp INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Default settings
  const defaults = [
    ['profile_name', 'You'],
    ['ollama_url', 'http://127.0.0.1:11434'],
    ['ollama_model', 'llama3.2'],
    // Release feed used by the public Check for Update button.
    ['github_owner', 'jayton123456789-hub'],
    ['github_repo', 'VibeForge'],
    ['auto_check_updates', 'true']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaults.forEach(([k, v]) => stmt.run(k, v));

  // Migration: separate screen recording file per session (mic audio stays in audio_path)
  try { db.exec(`ALTER TABLE sessions ADD COLUMN screen_path TEXT`); } catch (e) { /* exists */ }

  // Migration: add status to ideas for Inbox/Saved/etc (no demo, safe)
  try {
    db.exec(`ALTER TABLE ideas ADD COLUMN status TEXT DEFAULT 'Inbox'`);
  } catch (e) {
    // column exists or other harmless
  }
}

function getSetting(key) {
  if (!db) {
    const defaults = {
      ollama_url: 'http://127.0.0.1:11434',
      ollama_model: 'llama3.2',
      github_owner: 'jayton123456789-hub',
      github_repo: 'VibeForge'
    };
    return defaults[key];
  }
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  if (!db) initDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// IPC for all real actions - every button will call these
function registerIpc() {
  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 360, height: 220 },
      fetchWindowIcons: true
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      display_id: s.display_id,
      thumbnail: s.thumbnail ? s.thumbnail.toDataURL() : null,
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null
    }));
  });

  ipcMain.handle('open-duo-test-window', () => {
    return createDuoTestWindow();
  });

  // Projects
  ipcMain.handle('get-projects', () => {
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  });

  ipcMain.handle('create-project', (e, name) => {
    if (!name || !name.trim()) throw new Error('Project name required');
    const id = uuidv4();
    const now = Date.now();
    db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(id, name.trim(), now);
    addTimeline(id, 'project_created', `Created project "${name.trim()}"`, now);
    return { id, name: name.trim(), created_at: now };
  });

  ipcMain.handle('rename-project', (e, { id, newName }) => {
    if (!newName || !newName.trim()) throw new Error('Name required');
    db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(newName.trim(), id);
    return true;
  });

  ipcMain.handle('delete-project', (e, id) => {
    // Cascade delete related
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM decisions WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM tasks WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM ideas WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM timeline_events WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return true;
  });

  // Sessions
  ipcMain.handle('get-sessions', (e, projectId) => {
    return db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY started_at DESC').all(projectId);
  });

  ipcMain.handle('create-session', (e, { projectId, title, mode, startedAt }) => {
    if (!title || !title.trim()) throw new Error('Session name required');
    const id = uuidv4();
    const now = (typeof startedAt === 'number' && startedAt > 0) ? startedAt : Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, title, mode, started_at) 
      VALUES (?, ?, ?, ?, ?)
    `).run(id, projectId, title.trim(), mode, now);
    addTimeline(projectId, 'session_created', `Session "${title.trim()}" (${mode})`, now);
    return { id, project_id: projectId, title: title.trim(), mode, started_at: now };
  });

  ipcMain.handle('update-session-notes', (e, { id, notes }) => {
    db.prepare('UPDATE sessions SET notes = ? WHERE id = ?').run(notes || '', id);
    return true;
  });

  ipcMain.handle('update-session-title', (e, { id, title }) => {
    db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id);
    return true;
  });

  ipcMain.handle('update-session-audio', (e, { id, audio_path }) => {
    db.prepare('UPDATE sessions SET audio_path = ? WHERE id = ?').run(audio_path, id);
    return true;
  });

  ipcMain.handle('update-session-ended', (e, { id, ended_at }) => {
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(ended_at || Date.now(), id);
    return true;
  });

  ipcMain.handle('save-audio', async (e, { sessionId, buffer }) => {
    const recordingsDir = path.join(app.getPath('userData'), 'recordings', sessionId);
    if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
    const filePath = path.join(recordingsDir, `audio-${Date.now()}.webm`);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    db.prepare('UPDATE sessions SET audio_path = ? WHERE id = ?').run(filePath, sessionId);
    return filePath;
  });

  // Screen recording saved as its own file so it never corrupts the mic audio.
  ipcMain.handle('save-screen', async (e, { sessionId, buffer }) => {
    const recordingsDir = path.join(app.getPath('userData'), 'recordings', sessionId);
    if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });
    const filePath = path.join(recordingsDir, `screen-${Date.now()}.webm`);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    db.prepare('UPDATE sessions SET screen_path = ? WHERE id = ?').run(filePath, sessionId);
    return filePath;
  });

  ipcMain.handle('update-session-screen', (e, { id, screen_path }) => {
    db.prepare('UPDATE sessions SET screen_path = ? WHERE id = ?').run(screen_path, id);
    return true;
  });

  ipcMain.handle('get-decisions-by-session', (e, sessionId) => {
    return db.prepare('SELECT * FROM decisions WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
  });

  ipcMain.handle('get-tasks-by-session', (e, sessionId) => {
    return db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
  });

  ipcMain.handle('get-ideas-by-session', (e, sessionId) => {
    return db.prepare('SELECT * FROM ideas WHERE session_id = ? ORDER BY created_at DESC').all(sessionId);
  });

  ipcMain.handle('get-timeline-by-session', (e, sessionId) => {
    return db.prepare('SELECT * FROM timeline_events WHERE project_id IN (SELECT project_id FROM sessions WHERE id = ?) AND (details LIKE ? OR title LIKE ?) ORDER BY timestamp DESC').all(sessionId, `%${sessionId}%`, `%${sessionId}%`);
  });

  ipcMain.handle('delete-session', (e, id) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return true;
  });

  // All recording segments for a session (resume creates a new timestamped file each visit)
  ipcMain.handle('get-session-recordings', (e, sessionId) => {
    const dir = path.join(app.getPath('userData'), 'recordings', sessionId);
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.webm'))
        .map(f => {
          const fp = path.join(dir, f);
          const st = fs.statSync(fp);
          return { path: fp, name: f, size: st.size, mtime: st.mtimeMs };
        })
        .sort((a, b) => a.mtime - b.mtime);
    } catch (err) {
      return [];
    }
  });

  // Decisions
  ipcMain.handle('get-decisions', (e, projectId) => {
    return db.prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  });

  ipcMain.handle('add-decision', (e, { projectId, sessionId, title, notes, status }) => {
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO decisions (id, project_id, session_id, title, notes, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, sessionId || null, title, notes || '', status || 'proposed', now);
    addTimeline(projectId, 'decision_added', `Decision: ${title}`, now);
    return { id, title, notes: notes || '', status: status || 'proposed', created_at: now };
  });

  ipcMain.handle('update-decision', (e, { id, title, notes, status }) => {
    db.prepare('UPDATE decisions SET title = ?, notes = ?, status = ? WHERE id = ?')
      .run(title, notes || '', status, id);
    return true;
  });

  ipcMain.handle('delete-decision', (e, id) => {
    db.prepare('DELETE FROM decisions WHERE id = ?').run(id);
    return true;
  });

  // Tasks
  ipcMain.handle('get-tasks', (e, projectId) => {
    return db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  });

  ipcMain.handle('add-task', (e, { projectId, sessionId, title, notes, priority }) => {
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO tasks (id, project_id, session_id, title, notes, priority, status, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(id, projectId, sessionId || null, title, notes || '', priority || 'medium', now);
    addTimeline(projectId, 'task_added', `Task: ${title}`, now);
    return { id, title, notes: notes || '', priority: priority || 'medium', status: 'open', created_at: now };
  });

  ipcMain.handle('update-task', (e, { id, title, notes, priority, status }) => {
    db.prepare('UPDATE tasks SET title = ?, notes = ?, priority = ?, status = ? WHERE id = ?')
      .run(title, notes || '', priority, status, id);
    return true;
  });

  ipcMain.handle('delete-task', (e, id) => {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return true;
  });

  // Ideas
  ipcMain.handle('get-ideas', (e, projectId) => {
    return db.prepare('SELECT * FROM ideas WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  });

  ipcMain.handle('add-idea', (e, { projectId, sessionId, title, description, tags }) => {
    const id = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO ideas (id, project_id, session_id, title, description, tags, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, sessionId || null, title, description || '', JSON.stringify(tags || []), now);
    addTimeline(projectId, 'idea_added', `Idea: ${title}`, now);
    return { id, title, description: description || '', tags: tags || [], created_at: now };
  });

  ipcMain.handle('delete-idea', (e, id) => {
    db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
    return true;
  });

  ipcMain.handle('convert-idea-to-task', (e, ideaId) => {
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(ideaId);
    if (!idea) return null;
    const taskId = uuidv4();
    const now = Date.now();
    db.prepare(`
      INSERT INTO tasks (id, project_id, session_id, title, notes, priority, status, created_at) 
      VALUES (?, ?, ?, ?, ?, 'medium', 'open', ?)
    `).run(taskId, idea.project_id, idea.session_id, idea.title, idea.description || '', now);
    addTimeline(idea.project_id, 'task_added', `Task from idea: ${idea.title}`, now);
    return { id: taskId, title: idea.title };
  });

  // Timeline
  ipcMain.handle('get-timeline', (e, projectId) => {
    return db.prepare('SELECT * FROM timeline_events WHERE project_id = ? ORDER BY timestamp DESC LIMIT 100').all(projectId);
  });

  // Project Memory - real local search
  ipcMain.handle('search-memory', (e, { projectId, query }) => {
    if (!query || query.trim().length < 2) return [];
    const q = `%${query.toLowerCase()}%`;
    const results = [];

    // Sessions
    const sessions = db.prepare(`
      SELECT 'session' as type, id, title as text, started_at as ts FROM sessions 
      WHERE project_id = ? AND LOWER(title) LIKE ? 
    `).all(projectId, q);
    results.push(...sessions);

    // Decisions
    const decs = db.prepare(`
      SELECT 'decision' as type, id, title as text, created_at as ts FROM decisions 
      WHERE project_id = ? AND (LOWER(title) LIKE ? OR LOWER(notes) LIKE ?)
    `).all(projectId, q, q);
    results.push(...decs);

    // Tasks
    const tasks = db.prepare(`
      SELECT 'task' as type, id, title as text, created_at as ts FROM tasks 
      WHERE project_id = ? AND (LOWER(title) LIKE ? OR LOWER(notes) LIKE ?)
    `).all(projectId, q, q);
    results.push(...tasks);

    // Ideas
    const ideas = db.prepare(`
      SELECT 'idea' as type, id, title as text, created_at as ts FROM ideas 
      WHERE project_id = ? AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)
    `).all(projectId, q, q);
    results.push(...ideas);

    return results.sort((a, b) => b.ts - a.ts).slice(0, 50);
  });

  // Settings
  ipcMain.handle('get-settings', () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    return obj;
  });

  ipcMain.handle('save-setting', (e, { key, value }) => {
    setSetting(key, value);
    return true;
  });

  ipcMain.handle('reset-all-data', () => {
    console.log('=== Reset All Data triggered ===');
    const userData = app.getPath('userData');
    console.log('userData:', userData);

    // Close peer connections
    if (peerServer) {
      try { peerServer.close(); console.log('Closed peerServer'); } catch (e) { console.error('peerServer close err', e.message); }
      peerServer = null;
    }
    if (peerClient) {
      try { peerClient.close(); console.log('Closed peerClient'); } catch (e) { console.error('peerClient close err', e.message); }
      peerClient = null;
    }
    currentPeer = null;

    // Close DB
    if (db) {
      try { db.close(); console.log('Closed DB'); } catch (e) { console.error('DB close err', e.message); }
      db = null;
    }

    // Clear renderer storage (localStorage, IndexedDB, cache etc.)
    if (mainWindow && mainWindow.webContents && mainWindow.webContents.session) {
      try {
        mainWindow.webContents.session.clearStorageData({
          storages: ['localstorage', 'indexdb', 'cookies', 'cache', 'websql', 'serviceworkers']
        });
        console.log('Cleared session storage data');
      } catch (e) { console.error('clearStorageData err', e.message); }
    }

    // Delete data dir (contains vibeforge.db and any other app data we put there)
    const dataDir = getDataDir();
    const dirsToNuke = [
      dataDir,
      path.join(userData, 'Local Storage'),
      path.join(userData, 'Session Storage'),
      path.join(userData, 'Cache'),
      path.join(userData, 'Code Cache'),
      path.join(userData, 'GPUCache'),
      path.join(userData, 'DawnGraphiteCache'),
      path.join(userData, 'DawnWebGPUCache'),
      path.join(userData, 'recordings'),
      path.join(userData, 'exports'),
      path.join(userData, 'received')
    ];

    for (const d of dirsToNuke) {
      try {
        if (fs.existsSync(d)) {
          fs.rmSync(d, { recursive: true, force: true });
          console.log('Deleted:', d);
        }
      } catch (e) {
        console.error('Failed to delete', d, ':', e.message);
      }
    }

    // Also delete the root userData files like Preferences, Local State if they hold state
    const rootFiles = ['Preferences', 'Local State', 'SharedStorage'];
    for (const f of rootFiles) {
      const fp = path.join(userData, f);
      try {
        if (fs.existsSync(fp)) {
          fs.rmSync(fp, { force: true });
          console.log('Deleted file:', fp);
        }
      } catch (e) {
        console.error('Failed to delete file', fp, ':', e.message);
      }
    }

    console.log('Reset complete. Relaunching into clean state...');
    app.relaunch();
    app.exit(0);
    return true;
  });

  ipcMain.handle('get-storage-status', () => {
    const userData = app.getPath('userData');
    const dbp = getDbPath();
    let counts = { projects: 0, sessions: 0, tasks: 0, ideas: 0, decisions: 0 };
    if (db) {
      try {
        counts.projects = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
        counts.sessions = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
        counts.tasks = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
        counts.ideas = db.prepare('SELECT COUNT(*) as c FROM ideas').get().c;
        counts.decisions = db.prepare('SELECT COUNT(*) as c FROM decisions').get().c;
      } catch (e) { /* empty db ok */ }
    }
    return {
      userData,
      dbPath: dbp,
      dbExists: fs.existsSync(dbp),
      dbSize: fs.existsSync(dbp) ? fs.statSync(dbp).size : 0,
      counts
    };
  });

  ipcMain.handle('reveal-storage', () => {
    shell.openPath(app.getPath('userData'));
    return true;
  });

  // File dialog for future share/assets
  ipcMain.handle('pick-file', async () => {
    const res = await dialog.showOpenDialog({ properties: ['openFile'] });
    return res.filePaths[0] || null;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LINK — PeerJS-based internet P2P
  // WebRTC only works in Chromium (renderer process), not in Node.js.
  // The REAL connection is managed in renderer.js using browser-native PeerJS
  // (loaded via CDN in index.html). These IPC handlers are stubs only.
  // ═══════════════════════════════════════════════════════════════════════

  function pjCleanup() {
    if (peerJsConn) { try { peerJsConn.close(); } catch(e){} peerJsConn = null; }
    if (peerJsHost) { try { peerJsHost.destroy(); } catch(e){} peerJsHost = null; }
    peerJsId = null;
    hostAddress = null;
    currentPeer = null;
  }

  // Stub IPC handlers — the renderer overrides duoHost/duoJoin/etc. with
  // browser-native PeerJS. These are never reached in normal use.
  ipcMain.handle('duo-host', () => ({
    ok: false,
    error: 'PeerJS needs the browser renderer (WebRTC). The renderer.js override should have intercepted this — reload the app.'
  }));

  ipcMain.handle('duo-join', () => ({
    ok: false,
    error: 'PeerJS needs the browser renderer (WebRTC). The renderer.js override should have intercepted this — reload the app.'
  }));

  // Save a file received over Duo Link. Called from renderer (needs Node.js fs).
  ipcMain.handle('save-received-file', async (e, { name, uint8arr }) => {
    try {
      const receivedDir = getReceivedDir();
      const safeName = (name || 'received').replace(/[^a-zA-Z0-9._ -]/g, '_');
      let filePath = path.join(receivedDir, safeName);
      if (fs.existsSync(filePath)) filePath = path.join(receivedDir, `${Date.now()}-${safeName}`);
      fs.writeFileSync(filePath, Buffer.from(uint8arr));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // App version
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('peer-send-file', async (e, filePath) => {
    if (!peerJsConn || !peerJsConn.open) return { ok: false, error: 'Not connected' };
    try {
      const buf = fs.readFileSync(filePath);
      const name = path.basename(filePath);
      peerJsConn.send(JSON.stringify({ type: 'file-start', name, size: buf.length }));
      peerJsConn.send(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      peerJsConn.send(JSON.stringify({ type: 'file-end' }));
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('peer-send-text', (e, text) => {
    if (!peerJsConn || !peerJsConn.open) return { ok: false, error: 'Not connected' };
    try { peerJsConn.send(text); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('duo-disconnect', () => {
    if (peerJsConn) { try { peerJsConn.close(); } catch(e){} peerJsConn = null; }
    if (peerJsHost) { try { peerJsHost.destroy(); } catch(e){} peerJsHost = null; }
    peerJsId = null; hostAddress = null; currentPeer = null;
    if (peerServer) { try { peerServer.close(); } catch(e){} peerServer = null; }
    if (peerClient) { try { peerClient.close(); } catch(e){} peerClient = null; }
    if (mainWindow) mainWindow.webContents.send('peer-status', { status: 'disconnected' });
    return true;
  });

  ipcMain.handle('get-peer-status', () => ({
    status: 'offline' // renderer manages live state; this is a fallback
  }));

  // === Ideas with status support (for Capture Idea Inbox etc) ===
  ipcMain.handle('update-idea', (e, { id, title, description, status }) => {
    const fields = [];
    const vals = [];
    if (title !== undefined) { fields.push('title = ?'); vals.push(title); }
    if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
    if (status !== undefined) { fields.push('status = ?'); vals.push(status); }
    if (fields.length === 0) return true;
    vals.push(id);
    db.prepare(`UPDATE ideas SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return true;
  });

  ipcMain.handle('get-ideas-filtered', (e, { projectId, status }) => {
    if (status && status !== 'all') {
      return db.prepare('SELECT * FROM ideas WHERE project_id = ? AND status = ? ORDER BY created_at DESC').all(projectId, status);
    }
    return db.prepare('SELECT * FROM ideas WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
  });

  // === Real Exports Folder (write actual files under userData/exports/<projectId>/ ) ===
  ipcMain.handle('export-session-md', async (e, { projectId, sessionId }) => {
    const expDir = getExportsDir(projectId);
    const sessions = db.prepare('SELECT * FROM sessions WHERE id = ?').all(sessionId);
    const s = sessions[0]; if (!s) throw new Error('Session not found');
    const decisions = db.prepare('SELECT * FROM decisions WHERE session_id = ?').all(sessionId);
    const tasks = db.prepare('SELECT * FROM tasks WHERE session_id = ?').all(sessionId);
    const ideas = db.prepare('SELECT * FROM ideas WHERE session_id = ?').all(sessionId);
    let md = `# ${s.title}\n\n**Mode:** ${s.mode}\n**Date:** ${new Date(s.started_at).toLocaleString()}\n\n## Notes\n\n${s.notes || '(none)'}\n\n`;
    if (decisions.length) md += '## Decisions\n' + decisions.map(d => `- ${d.title} (${d.status})\n  ${d.notes || ''}`).join('\n') + '\n\n';
    if (tasks.length) md += '## Tasks\n' + tasks.map(t => `- [ ] ${t.title} (${t.priority})\n  ${t.notes || ''}`).join('\n') + '\n\n';
    if (ideas.length) md += '## Ideas\n' + ideas.map(i => `- ${i.title}\n  ${i.description || ''}`).join('\n') + '\n\n';
    const safe = (s.title || 'session').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(expDir, `${safe}.md`);
    fs.writeFileSync(filePath, md, 'utf8');
    addTimeline(projectId, 'export_created', `Exported session markdown: ${path.basename(filePath)}`, Date.now());
    return filePath;
  });

  ipcMain.handle('export-grok-prompt', async (e, { projectId, sessionId }) => {
    const expDir = getExportsDir(projectId);
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!s) throw new Error('Session not found');
    const decisions = db.prepare('SELECT * FROM decisions WHERE session_id = ?').all(sessionId);
    const tasks = db.prepare('SELECT * FROM tasks WHERE session_id = ?').all(sessionId);
    let prompt = `You are helping build features from this session:\nTitle: ${s.title}\nNotes: ${s.notes || ''}\n`;
    if (decisions.length) prompt += 'Decisions: ' + decisions.map(d => d.title).join(', ') + '\n';
    if (tasks.length) prompt += 'Tasks: ' + tasks.map(t => t.title).join(', ') + '\n';
    prompt += 'Please implement the discussed features using best practices.';
    const safe = (s.title || 'session').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(expDir, `${safe}_grok_prompt.txt`);
    fs.writeFileSync(filePath, prompt, 'utf8');
    addTimeline(projectId, 'export_created', `Exported Grok prompt: ${path.basename(filePath)}`, Date.now());
    return filePath;
  });

  ipcMain.handle('export-project-json', async (e, projectId) => {
    const expDir = getExportsDir(projectId);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const sessions = db.prepare('SELECT * FROM sessions WHERE project_id = ?').all(projectId);
    const decisions = db.prepare('SELECT * FROM decisions WHERE project_id = ?').all(projectId);
    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(projectId);
    const ideas = db.prepare('SELECT * FROM ideas WHERE project_id = ?').all(projectId);
    const timeline = db.prepare('SELECT * FROM timeline_events WHERE project_id = ?').all(projectId);
    const data = { project, sessions, decisions, tasks, ideas, timeline, exported_at: new Date().toISOString() };
    const safe = (project?.name || 'project').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(expDir, `${safe}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    addTimeline(projectId, 'export_created', `Exported project JSON: ${path.basename(filePath)}`, Date.now());
    return filePath;
  });

  ipcMain.handle('export-project-md', async (e, projectId) => {
    const expDir = getExportsDir(projectId);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    const sessions = db.prepare('SELECT * FROM sessions WHERE project_id = ?').all(projectId);
    const decisions = db.prepare('SELECT * FROM decisions WHERE project_id = ?').all(projectId);
    const tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(projectId);
    const ideas = db.prepare('SELECT * FROM ideas WHERE project_id = ?').all(projectId);
    let md = `# ${project ? project.name : 'Project'}\n\nExported ${new Date().toLocaleString()}\n\n`;
    md += `## Sessions\n`; sessions.forEach(s => { md += `- ${s.title} (${s.mode})\n  Notes: ${s.notes || ''}\n`; });
    md += `\n## Decisions\n`; decisions.forEach(d => { md += `- ${d.title} (${d.status})\n  ${d.notes || ''}\n`; });
    md += `\n## Tasks\n`; tasks.forEach(t => { md += `- [ ] ${t.title} (${t.priority})\n  ${t.notes || ''}\n`; });
    md += `\n## Ideas\n`; ideas.forEach(i => { md += `- ${i.title} [${i.status || 'Inbox'}]\n  ${i.description || ''}\n`; });
    const safe = (project?.name || 'project').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = path.join(expDir, `${safe}.md`);
    fs.writeFileSync(filePath, md, 'utf8');
    addTimeline(projectId, 'export_created', `Exported project markdown: ${path.basename(filePath)}`, Date.now());
    return filePath;
  });

  ipcMain.handle('reveal-exports', (e, projectId) => {
    const dir = getExportsDir(projectId);
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('reveal-received', () => {
    const dir = getReceivedDir();
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('reveal-recordings', () => {
    const dir = getRecordingsDir();
    shell.openPath(dir);
    return dir;
  });

  // === Ollama setup wizard / local AI (real checks + spawn for install/pull) ===
  ipcMain.handle('ollama-check', async () => {
    return new Promise((resolve) => {
      exec('ollama --version', (err, stdout) => {
        if (err) return resolve({ installed: false, error: err.message });
        resolve({ installed: true, version: (stdout || '').trim() });
      });
    });
  });

  ipcMain.handle('ollama-open-download', () => {
    shell.openExternal('https://ollama.com/download');
    return true;
  });

  let currentOllamaProc = null;
  ipcMain.handle('ollama-install-auto', (e) => {
    // Use winget if available (Windows), else instruct
    return new Promise((resolve) => {
      if (currentOllamaProc) {
        return resolve({ ok: false, error: 'Install already running' });
      }
      const cmd = 'winget';
      const args = ['install', '--id', 'Ollama.Ollama', '-e', '--accept-package-agreements', '--accept-source-agreements'];
      try {
        currentOllamaProc = spawn(cmd, args, { shell: true, windowsHide: false });
        currentOllamaProc.stdout.on('data', (d) => {
          if (mainWindow) mainWindow.webContents.send('ollama-log', d.toString());
        });
        currentOllamaProc.stderr.on('data', (d) => {
          if (mainWindow) mainWindow.webContents.send('ollama-log', d.toString());
        });
        currentOllamaProc.on('close', (code) => {
          currentOllamaProc = null;
          if (mainWindow) mainWindow.webContents.send('ollama-log', `Process exited with code ${code}`);
          resolve({ ok: code === 0, code });
        });
        currentOllamaProc.on('error', (err) => {
          currentOllamaProc = null;
          if (mainWindow) mainWindow.webContents.send('ollama-log', 'Error: ' + err.message);
          resolve({ ok: false, error: err.message });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message + ' (winget may not be available; use manual download)' });
      }
    });
  });

  ipcMain.handle('ollama-pull', (e, model) => {
    return new Promise((resolve) => {
      if (!model || !model.trim()) return resolve({ ok: false, error: 'Model name required' });
      const m = model.trim();
      if (currentOllamaProc) return resolve({ ok: false, error: 'Another Ollama operation running' });
      try {
        currentOllamaProc = spawn('ollama', ['pull', m], { shell: true, windowsHide: false });
        currentOllamaProc.stdout.on('data', (d) => { if (mainWindow) mainWindow.webContents.send('ollama-log', d.toString()); });
        currentOllamaProc.stderr.on('data', (d) => { if (mainWindow) mainWindow.webContents.send('ollama-log', d.toString()); });
        currentOllamaProc.on('close', (code) => {
          currentOllamaProc = null;
          if (mainWindow) mainWindow.webContents.send('ollama-log', `Pull finished (code ${code})`);
          resolve({ ok: code === 0, code, model: m });
        });
        currentOllamaProc.on('error', (err) => {
          currentOllamaProc = null;
          if (mainWindow) mainWindow.webContents.send('ollama-log', 'Error: ' + err.message);
          resolve({ ok: false, error: err.message });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });

  ipcMain.handle('ollama-list-models', async () => {
    return new Promise((resolve) => {
      exec('ollama list', (err, stdout) => {
        if (err) return resolve({ ok: false, error: err.message, models: [] });
        const lines = (stdout || '').trim().split('\n').slice(1);
        const models = lines.map(l => l.split(/\s+/)[0]).filter(Boolean);
        resolve({ ok: true, models });
      });
    });
  });

  ipcMain.handle('ollama-test-model', async (e, model) => {
    const url = getSetting('ollama_url') || 'http://127.0.0.1:11434';
    try {
      const res = await fetch(`${url}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model || getSetting('ollama_model') || 'llama3.2', prompt: 'Say hello in one word.', stream: false })
      });
      const data = await res.json();
      return { ok: res.ok, response: data.response || 'ok' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  function getGhCommand() {
    const fullPath = 'C:\\Program Files\\GitHub CLI\\gh.exe';
    if (fs.existsSync(fullPath)) {
      return `"${fullPath}"`;
    }
    return 'gh';
  }

  // One-call status for the UI green-lights: is Ollama up, and which models are pulled.
  ipcMain.handle('ollama-status', async () => {
    const url = getSetting('ollama_url') || 'http://127.0.0.1:11434';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return { running: false, models: [] };
      const data = await res.json();
      const models = (data.models || []).map(m => m.name).filter(Boolean);
      return { running: true, models, model: getSetting('ollama_model') || '' };
    } catch (e) {
      return { running: false, models: [], error: e.message };
    }
  });

  // Whisper status for the green-lights (engine + model both present)
  ipcMain.handle('whisper-status', () => {
    const cli = findWhisperCli();
    const model = getWhisperModelPath();
    return { ready: !!(cli && fs.existsSync(model)) };
  });

  

  // === GitHub & Updates helpers (real checks, no passwords, publish only if ready) ===
  ipcMain.handle('check-git', () => new Promise(r => exec('git --version', (e, o) => r({ ok: !e, version: (o||'').trim(), error: e ? e.message : null }))));
  ipcMain.handle('check-gh-cli', () => {
    const gh = getGhCommand();
    return new Promise(r => exec(`${gh} --version`, (e, o) => r({ ok: !e, version: (o||'').trim(), error: e ? e.message : null })));
  });
  ipcMain.handle('check-gh-login', () => {
    const gh = getGhCommand();
    return new Promise(r => exec(`${gh} auth status`, (e, o) => r({ ok: !e, output: (o||'').trim(), error: e ? e.message : null })));
  });

  ipcMain.handle('get-github-user', () => {
    const gh = getGhCommand();
    return new Promise(r => exec(`${gh} api user --jq .login`, (e, o) => r({ ok: !e, login: (o||'').trim() })));
  });

  // Helper to run gh with logs streamed for publishing
  ipcMain.handle('gh-run', (e, args) => {
    const gh = getGhCommand();
    return new Promise((resolve) => {
      const proc = spawn(gh, args, { shell: true, windowsHide: false });
      proc.stdout.on('data', d => { if (mainWindow) mainWindow.webContents.send('build-log', d.toString()); });
      proc.stderr.on('data', d => { if (mainWindow) mainWindow.webContents.send('build-log', d.toString()); });
      proc.on('close', (code) => resolve({ code }));
      proc.on('error', err => resolve({ code: -1, error: err.message }));
    });
  });
  // === Ollama serve (open source local AI server) ===
  ipcMain.handle('start-ollama-serve', async () => {
    // If it's already answering, don't spawn a second one.
    const url = getSetting('ollama_url') || 'http://127.0.0.1:11434';
    try {
      const r = await fetch(`${url}/api/tags`).catch(() => null);
      if (r && r.ok) return { ok: true, alreadyRunning: true };
    } catch (e) {}

    const exe = getOllamaExe();
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      try {
        // Raw path + args array + the error handler is what was missing before:
        // spawn() emits ENOENT asynchronously, so without an 'error' listener it
        // surfaced as an uncaught exception in the main process.
        const proc = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
        proc.on('error', (err) => {
          done({ ok: false, error: err.code === 'ENOENT'
            ? 'Ollama is not installed (or not found). Use "Download Ollama" first.'
            : err.message });
        });
        proc.unref();
        // Give it a moment, then verify it actually came up.
        setTimeout(async () => {
          const r = await fetch(`${url}/api/tags`).catch(() => null);
          done({ ok: !!(r && r.ok), started: true });
        }, 1500);
      } catch (err) {
        done({ ok: false, error: err.message });
      }
    });
  });

  ipcMain.handle('open-ollama', () => {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama app.exe'),
      'C:\\Program Files\\Ollama\\ollama app.exe'
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          spawn(p, [], { detached: true, stdio: 'ignore' }).unref();
          return { ok: true };
        } catch (e) {}
      }
    }
    shell.openExternal('https://ollama.com');
    return { ok: false, openedDownload: true };
  });

  // === Download & apply update (auto on launch banner) ===
  ipcMain.handle('download-update', async () => {
    try {
      let owner = 'jayton123456789-hub';
      let repo = 'VibeForge';
      try {
        const oRow = db.prepare('SELECT value FROM settings WHERE key=?').get('github_owner');
        const rRow = db.prepare('SELECT value FROM settings WHERE key=?').get('github_repo');
        if (oRow && oRow.value) owner = oRow.value;
        if (rRow && rRow.value) repo = rRow.value;
      } catch (e) {}
      const relRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'VibeForge' }
      });
      if (!relRes.ok) return { ok: false, error: 'No release info' };
      const rel = await relRes.json();
      const asset = (rel.assets || []).find(a => a.name && (a.name.toLowerCase().includes('portable') || a.name.toLowerCase().endsWith('.exe')));
      if (!asset) return { ok: false, error: 'No portable asset in release' };

      const url = asset.browser_download_url;
      if (!fs.existsSync(updateDir)) fs.mkdirSync(updateDir, { recursive: true });
      // Unique filename so we never collide with (and fail to overwrite) a currently-running
      // exe of the same name — e.g. if a prior update left us running from inside updateDir.
      const newExe = path.join(updateDir, `VibeForge-Portable-${Date.now()}.exe`);

      try {
        await downloadFile(url, newExe);
      } catch (err) {
        return { ok: false, error: 'Download failed: ' + err.message };
      }

      const current = process.execPath;
      let spawnArgs = [];
      if (app.isPackaged) {
        spawnArgs = ['--update-target', current];
      }
      // For dev (source), just launch the new portable as the "updated" version.
      // For packaged, use the target copy logic to replace in place (remove old version).
      return new Promise((resolve) => {
        const child = spawn(newExe, spawnArgs, { detached: true, stdio: 'ignore' });
        child.on('error', (err) => {
          resolve({ ok: false, error: 'Could not launch downloaded update: ' + err.message });
        });
        child.on('spawn', () => {
          child.unref();
          app.quit();
          resolve({ ok: true });
        });
      });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // === Whisper via whisper.cpp prebuilt binary (no Python, no pip, fully offline after setup) ===
  const WHISPER_BIN_URL = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip';
  const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

  function getWhisperDir() {
    return path.join(app.getPath('userData'), 'whisper');
  }

  function findWhisperCli() {
    const dir = getWhisperDir();
    const candidates = [
      path.join(dir, 'Release', 'whisper-cli.exe'),
      path.join(dir, 'whisper-cli.exe'),
      path.join(dir, 'Release', 'main.exe'),
      path.join(dir, 'main.exe')
    ];
    return candidates.find(c => fs.existsSync(c)) || null;
  }

  function getWhisperModelPath() {
    return path.join(getWhisperDir(), 'ggml-base.en.bin');
  }

  // Transcribe a 16kHz mono WAV buffer sent from the renderer.
  // Used both for live caption chunks and full post-session transcription.
  ipcMain.handle('transcribe-wav', async (e, { wav, sessionId, appendToNotes, live }) => {
    const cli = findWhisperCli();
    const model = getWhisperModelPath();
    if (!cli || !fs.existsSync(model)) {
      return { ok: false, error: 'Whisper not set up. One click in Settings > AI Tools installs it (~150 MB, one time).' };
    }
    const tempDir = path.join(app.getPath('userData'), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const wavPath = path.join(tempDir, `chunk-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
    try {
      fs.writeFileSync(wavPath, Buffer.from(wav));
    } catch (err) {
      return { ok: false, error: 'Failed to write temp wav: ' + err.message };
    }
    // Initial prompt biases Whisper toward vocabulary we actually use, so dev terms
    // and tool names get spelled right instead of guessed phonetically. Including a few
    // expletives verbatim stops the model from self-censoring real speech.
    const vocab = getSetting('whisper_prompt') ||
      'Real talk, no censoring — shit, damn, hell, ass, fuck, crap. VibeForge, Codex, Claude, Cursor, Ollama, Whisper, GitHub, Electron, Node.js, npm, API, repo, frontend, backend, SQLite, WebSocket, Nick, Jayton, Dylan.';
    // Live caption passes use FEWER threads so they never peg the CPU and starve the
    // audio recorder. Final/manual transcription gets more threads for speed.
    const threads = live ? '2' : '4';
    return new Promise((resolve) => {
      const args = ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', threads, '--prompt', vocab];
      const proc = spawn(cli, args, { shell: false, windowsHide: true });
      let out = '';
      let errOut = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', (d) => { errOut += d.toString(); });
      proc.on('close', (code) => {
        try { fs.unlinkSync(wavPath); } catch (e) {}
        // Strip whisper's non-speech annotations: [BLANK_AUDIO], [silence], (air whooshing),
        // (music), *applause* etc. Real speech is what remains.
        let transcript = out.trim()
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\([^)]*\)/g, '')
          .replace(/\*[^*]*\*/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (code !== 0 && !transcript) {
          return resolve({ ok: false, error: `whisper exited ${code}: ${errOut.slice(-300)}` });
        }
        if (transcript && appendToNotes && sessionId) {
          try {
            db.prepare("UPDATE sessions SET notes = COALESCE(notes,'') || ? WHERE id = ?")
              .run('\n\n[Whisper transcript]\n' + transcript, sessionId);
          } catch (e) {}
        }
        resolve({ ok: true, transcript });
      });
      proc.on('error', (err) => {
        try { fs.unlinkSync(wavPath); } catch (e) {}
        resolve({ ok: false, error: err.message });
      });
    });
  });

  // Read any local file as bytes (renderer uses this to decode saved recordings for transcription)
  ipcMain.handle('read-file-buffer', (e, filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  });

  // One-click Whisper setup: downloads the prebuilt whisper.cpp engine (~4 MB) and the
  // ggml-base.en model (~142 MB). No Python, no pip, no build tools. Works offline after.
  ipcMain.handle('setup-open-source-whisper', async (e) => {
    const log = (m) => mainWindow && mainWindow.webContents.send('whisper-setup-log', m);
    const whisperDir = getWhisperDir();
    const modelPath = getWhisperModelPath();

    let cli = findWhisperCli();
    if (cli && fs.existsSync(modelPath)) {
      setSetting('whisper_path', cli);
      setSetting('whisper_model', modelPath);
      return { ok: true, whisperPath: cli, modelPath, alreadySetup: true };
    }

    try {
      if (!fs.existsSync(whisperDir)) fs.mkdirSync(whisperDir, { recursive: true });

      if (!cli) {
        log('Downloading whisper.cpp engine (~4 MB)...\n');
        const zipPath = path.join(whisperDir, 'whisper-bin-x64.zip');
        await downloadFile(WHISPER_BIN_URL, zipPath);
        log('Extracting engine...\n');
        await new Promise((res, rej) => {
          const p = spawn('powershell', ['-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${whisperDir}' -Force`],
            { windowsHide: true });
          p.on('close', c => c === 0 ? res() : rej(new Error('zip extract failed')));
          p.on('error', rej);
        });
        try { fs.unlinkSync(zipPath); } catch (e) {}
        cli = findWhisperCli();
        if (!cli) throw new Error('whisper-cli.exe not found after extraction');
        log('Engine ready: ' + cli + '\n');
      }

      if (!fs.existsSync(modelPath)) {
        log('Downloading speech model ggml-base.en (~142 MB, one time)...\n');
        let lastShown = -10;
        await downloadFile(WHISPER_MODEL_URL, modelPath, (pct) => {
          if (pct >= lastShown + 10) { lastShown = pct; log(`  model download: ${pct}%\n`); }
        });
        log('Model ready.\n');
      }

      setSetting('whisper_path', cli);
      setSetting('whisper_model', modelPath);

      // Clean up the old broken Python venv from earlier attempts (frees ~1.5 GB)
      const oldVenv = path.join(app.getPath('userData'), 'whisper-venv');
      if (fs.existsSync(oldVenv)) {
        log('Removing old broken Python venv (frees ~1.5 GB)...\n');
        try { fs.rmSync(oldVenv, { recursive: true, force: true }); } catch (e) {}
      }

      log('\n=== DONE. Whisper is installed — transcription now works fully offline. ===\n');
      return { ok: true, whisperPath: cli, modelPath };
    } catch (err) {
      log('\nERROR: ' + err.message + '\n');
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('gh-signin', () => {
    const gh = getGhCommand();
    return new Promise((resolve) => {
      // Use spawn so we can stream logs to UI
      const proc = spawn(gh, ['auth', 'login', '--web', '--hostname', 'github.com'], { shell: true, windowsHide: false });
      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); if (mainWindow) mainWindow.webContents.send('github-signin-log', d.toString()); });
      proc.stderr.on('data', d => { output += d.toString(); if (mainWindow) mainWindow.webContents.send('github-signin-log', d.toString()); });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true });
        } else {
          shell.openExternal('https://github.com/login/device');
          resolve({ ok: false, fallback: true, message: 'gh auth completed or fell back. Check status.' });
        }
      });
      proc.on('error', err => {
        shell.openExternal('https://github.com/login/device');
        resolve({ ok: false, fallback: true, error: err.message });
      });
    });
  });
  ipcMain.handle('gh-open-repo', (e, { owner, repo }) => {
    if (owner && repo) shell.openExternal(`https://github.com/${owner}/${repo}`);
    else shell.openPath(app.getPath('userData'));
    return true;
  });

  ipcMain.handle('check-app-update', async (e, { owner, repo }) => {
    if (!owner || !repo) return { status: 'error', message: 'Set GitHub owner/repo in Settings first' };
    const currentVer = app.getVersion ? app.getVersion() : '0.1.0';
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers: { 'User-Agent': 'VibeForge' }
      });
      if (!res.ok) return { status: 'error', message: 'No releases or network issue' };
      const rel = await res.json();
      const latestTag = normalizeVersion(rel.tag_name || '');
      const hasUpdate = latestTag && isNewerVersion(latestTag, currentVer);
      return {
        status: hasUpdate ? 'update-available' : 'up-to-date',
        current: currentVer,
        latest: latestTag,
        url: rel.html_url || `https://github.com/${owner}/${repo}/releases`
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  });

  // === Real developer publishing for Jayton's repo only ===
  // Regular users see only "Check for Update". Jayton (when repo matches) gets build + publish buttons.

  ipcMain.handle('find-portable-artifact', async () => {
    // Look in common places for the built portable exe
    const candidates = [
      path.join(__dirname, 'dist', 'VibeForge-Portable.exe'),
      path.join(process.cwd(), 'dist', 'VibeForge-Portable.exe'),
      path.join(app.getPath('userData'), '..', '..', 'dist', 'VibeForge-Portable.exe') // unlikely
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return { found: true, path: c };
    }
    return { found: false, path: null };
  });

  let currentBuildProc = null;
  ipcMain.handle('build-portable', (e) => {
    return new Promise((resolve) => {
      if (currentBuildProc) return resolve({ ok: false, error: 'Build already running' });

      const distDir = path.join(__dirname, 'dist');
      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

      try {
        currentBuildProc = spawn('cmd', ['/c', 'npm run dist'], { cwd: __dirname, shell: true, windowsHide: false });
        currentBuildProc.stdout.on('data', (d) => {
          if (mainWindow) mainWindow.webContents.send('build-log', d.toString());
        });
        currentBuildProc.stderr.on('data', (d) => {
          if (mainWindow) mainWindow.webContents.send('build-log', d.toString());
        });
        currentBuildProc.on('close', (code) => {
          currentBuildProc = null;
          const artifact = path.join(__dirname, 'dist', 'VibeForge-Portable.exe');
          const success = code === 0 && fs.existsSync(artifact);
          if (mainWindow) mainWindow.webContents.send('build-log', success ? 'Build finished successfully.' : `Build exited with code ${code}`);
          resolve({ ok: success, code, artifact: success ? artifact : null });
        });
        currentBuildProc.on('error', (err) => {
          currentBuildProc = null;
          if (mainWindow) mainWindow.webContents.send('build-log', 'Build error: ' + err.message);
          resolve({ ok: false, error: err.message });
        });
      } catch (err) {
        currentBuildProc = null;
        resolve({ ok: false, error: err.message });
      }
    });
  });

  ipcMain.handle('publish-release', async (e, { version, notes, artifactPath, owner, repo }) => {
    if (!owner || !repo) return { ok: false, error: 'Repo not configured' };
    if (!artifactPath || !fs.existsSync(artifactPath)) return { ok: false, error: 'Artifact not found. Build first.' };

    const gh = getGhCommand();

    // Confirm gh is logged in
    const loginCheck = await new Promise(r => exec(`${gh} auth status`, (err, out) => r({ ok: !err })));
    if (!loginCheck.ok) return { ok: false, error: 'Not logged into GitHub CLI. Use the Sign in button first.' };

    const tag = version && version.trim() ? version.trim() : `v${Date.now()}`;

    return new Promise((resolve) => {
      const args = ['release', 'create', tag, '--repo', `${owner}/${repo}`, '--title', `VibeForge ${tag}`, '--notes', notes || 'Automated release from VibeForge'];
      // Append the artifact as the last arg
      const proc = spawn(gh, [...args, artifactPath], { shell: true, windowsHide: false });

      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); if (mainWindow) mainWindow.webContents.send('build-log', d.toString()); });
      proc.stderr.on('data', d => { output += d.toString(); if (mainWindow) mainWindow.webContents.send('build-log', d.toString()); });
      proc.on('close', (code) => {
        if (code === 0) {
          // Try to extract the release URL from output
          const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+/);
          resolve({ ok: true, url: urlMatch ? urlMatch[0] : `https://github.com/${owner}/${repo}/releases/tag/${tag}` });
        } else {
          resolve({ ok: false, error: `gh exited with code ${code}. Output: ${output.slice(-500)}` });
        }
      });
      proc.on('error', err => resolve({ ok: false, error: err.message }));
    });
  });

  ipcMain.handle('reveal-dist', () => {
    const dist = path.join(__dirname, 'dist');
    if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });
    shell.openPath(dist);
    return dist;
  });

  // === Transcription / Whisper status check ===
  ipcMain.handle('whisper-check', async () => {
    const cli = findWhisperCli();
    const model = getWhisperModelPath();
    const modelOk = fs.existsSync(model);
    if (cli && modelOk) return { configured: true, path: cli, model };
    if (cli && !modelOk) return { configured: false, message: 'Engine installed but model missing — run setup again' };
    return { configured: false, message: 'Not installed — run the one-click setup' };
  });

  ipcMain.handle('whisper-open-help', () => {
    shell.openExternal('https://github.com/ggerganov/whisper.cpp');
    return true;
  });

  // Save setting already exists; whisper_path can be saved via save-setting

  // ── First-run setup IPC (used by splash-preload.js) ───────────────────────
  ipcMain.handle('splash-check-first-run', () => {
    return { firstRun: isFirstRun() };
  });

  ipcMain.handle('splash-run-setup', async () => {
    // Run async — the splash window listens for streamed events.
    // We don't await here; the splash drives itself via setup-step / setup-done events.
    runFirstRunSetup().then(() => {
      // After setup finishes (including the brief done-screen pause), open the main window.
      // createWindow may have already been called — if mainWindow exists, just close the splash.
      if (!mainWindow) {
        createWindow();
      } else {
        closeSplash();
      }
    }).catch((err) => {
      console.error('First-run setup error:', err);
      markFirstRunComplete(); // don't loop on error
      if (!mainWindow) createWindow();
      else closeSplash();
    });
    return { ok: true };
  });

  ipcMain.handle('splash-skip-setup', async () => {
    try {
      await installVcRuntime(() => {});
    } catch (err) {
      writeLaunchLog('Required runtime install failed during setup skip', err);
    }
    markFirstRunComplete();
    if (!mainWindow) createWindow();
    else closeSplash();
    return { ok: true };
  });
}

function addTimeline(projectId, type, title, timestamp) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO timeline_events (id, project_id, type, title, timestamp) 
    VALUES (?, ?, ?, ?, ?)
  `).run(id, projectId, type, title, timestamp || Date.now());
}

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

let splashWindow = null;

// ─── First-run setup ──────────────────────────────────────────────────────────
// Sends step events to the splash window during first-run dependency installation.
function splashStep(stepId, state, log) {
  if (splashWindow && splashWindow.webContents) {
    splashWindow.webContents.send('setup-step', { stepId, state, log });
  }
}
function splashDone() {
  if (splashWindow && splashWindow.webContents) {
    splashWindow.webContents.send('setup-done', {});
  }
}

function isFirstRun() {
  if (!isSetupComplete()) return true;
  if (!db) return false;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('first_run_complete');
  return !row || row.value !== '1';
}

function markFirstRunComplete() {
  markSetupComplete('first-run');
  if (!db) initDb();
  if (db) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('first_run_complete', '1');
  firstRunPending = false;
}

// Runs the full first-run setup pipeline asynchronously, streaming progress to the splash.
async function runFirstRunSetup() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  splashStep('runtime', 'active', 'Checking Microsoft Visual C++ runtime...\n');
  try {
    const vcResult = await installVcRuntime(d => splashStep('runtime', 'active', d));
    if (vcResult.ok || vcResult.installed || checkVcRuntimeInstalled()) {
      splashStep('runtime', 'done', vcResult.alreadyInstalled ? 'Windows runtime already installed.\n' : 'Windows runtime ready.\n');
    } else {
      splashStep('runtime', 'error', `Windows runtime install may have failed (code ${vcResult.code || 'unknown'}). The app will still try to continue.\n`);
    }
  } catch (err) {
    splashStep('runtime', 'error', `Windows runtime setup failed: ${err.message}\n`);
  }
  await sleep(200);
  // ── Step 1: check existing dependencies ──────────────────────────────────
  splashStep('deps', 'active', 'Checking existing installation…\n');
  await sleep(400);

  const ollamaUrl = getSetting('ollama_url') || 'http://127.0.0.1:11434';

  // Check if Ollama binary is present. Do not rely only on PATH; fresh installs may
  // not update PATH for this already-running process.
  let ollamaCheck = await checkOllamaInstalled();
  let ollamaInstalled = ollamaCheck.installed;
  // Check if Ollama server is already up
  let ollamaRunning = false;
  try {
    const r = await fetch(`${ollamaUrl}/api/tags`).catch(() => null);
    ollamaRunning = !!(r && r.ok);
  } catch (e) {}
  // Check if preferred model is already pulled
  const preferredModel = getSetting('ollama_model') || 'llama3.2';
  let modelPulled = false;
  if (ollamaRunning) {
    try {
      const r = await fetch(`${ollamaUrl}/api/tags`);
      const data = await r.json();
      modelPulled = (data.models || []).some(m => m.name && m.name.startsWith(preferredModel));
    } catch (e) {}
  }
  // Check Whisper
  const whisperCli = findWhisperCli();
  const whisperModel = getWhisperModelPath();
  const whisperReady = !!(whisperCli && fs.existsSync(whisperModel));

  splashStep('deps', 'done', `Ollama installed: ${ollamaInstalled}${ollamaInstalled ? ` (${ollamaCheck.exe})` : ''}, running: ${ollamaRunning}, model ready: ${modelPulled}, Whisper ready: ${whisperReady}\n`);
  await sleep(300);

  // Step 2: install Ollama if missing
  if (!ollamaInstalled) {
    splashStep('ollama', 'active', 'Ollama not found. Installing it for this Windows user...\n');
    let installResult = { ok: false, error: 'winget not available' };
    if (await commandExists('winget')) {
      splashStep('ollama', 'active', 'Trying winget install: Ollama.Ollama\n');
      installResult = await runSetupProcess('winget', ['install', '--id', 'Ollama.Ollama', '-e',
        '--accept-package-agreements', '--accept-source-agreements'],
        d => splashStep('ollama', 'active', d), { shell: true, windowsHide: false });
    } else {
      splashStep('ollama', 'active', 'winget is not available on this PC.\n');
    }

    ollamaCheck = await checkOllamaInstalled();
    ollamaInstalled = ollamaCheck.installed;

    if (!ollamaInstalled) {
      splashStep('ollama', 'active', 'Trying Ollama official PowerShell installer...\n');
      installResult = await runSetupProcess('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        'irm https://ollama.com/install.ps1 | iex'],
        d => splashStep('ollama', 'active', d), { windowsHide: false });
      ollamaCheck = await checkOllamaInstalled();
      ollamaInstalled = ollamaCheck.installed;
    }

    if (ollamaInstalled) {
      splashStep('ollama', 'done', `Ollama installed successfully: ${ollamaCheck.exe}\n`);
    } else {
      splashStep('ollama', 'error', `Ollama install did not complete (${installResult.error || `code ${installResult.code}`}). Install it later in Settings or from ollama.com/download/windows.\n`);
    }
  } else {
    splashStep('ollama', 'done', `Ollama already installed: ${ollamaCheck.exe}\n`);
  }
  await sleep(200);

  // Step 3: start Ollama serve + pull model
  if (ollamaInstalled && !ollamaRunning) {
    splashStep('model', 'active', 'Starting Ollama server...\n');
    const exe = getOllamaExe();
    try {
      const proc = spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      proc.on('error', () => {});
      proc.unref();
      await sleep(2500);
      const r = await fetch(`${ollamaUrl}/api/tags`).catch(() => null);
      ollamaRunning = !!(r && r.ok);
    } catch (e) {
      splashStep('model', 'active', `Could not start Ollama: ${e.message}\n`);
    }
  }

  if (!ollamaInstalled) {
    splashStep('model', 'error', 'Skipping model pull because Ollama is not installed yet.\n');
  } else if (!modelPulled) {
    splashStep('model', 'active', `Pulling model ${preferredModel} (this may take a while for first pull)...\n`);
    const pullResult = await new Promise((resolve) => {
      const exe = getOllamaExe();
      const proc = spawn(exe, ['pull', preferredModel], { shell: false, windowsHide: true });
      proc.stdout.on('data', d => splashStep('model', 'active', d.toString()));
      proc.stderr.on('data', d => splashStep('model', 'active', d.toString()));
      proc.on('close', code => resolve({ ok: code === 0, code }));
      proc.on('error', err => resolve({ ok: false, error: err.message }));
    });
    splashStep('model', pullResult.ok ? 'done' : 'error',
      pullResult.ok ? `Model ${preferredModel} ready.\n` : `Model pull failed (${pullResult.error || `code ${pullResult.code}`}). You can pull it later in Settings.\n`);
  } else {
    splashStep('model', 'done', `Model ${preferredModel} already present - skipping.\n`);
  }
  await sleep(200);
  // ── Step 4: Whisper setup ────────────────────────────────────────────────
  if (!whisperReady) {
    splashStep('whisper', 'active', 'Installing Whisper speech-to-text engine…\n');
    const whisperDir = getWhisperDir();
    const modelPath = getWhisperModelPath();
    let cli = findWhisperCli();
    let ok = true;
    try {
      if (!fs.existsSync(whisperDir)) fs.mkdirSync(whisperDir, { recursive: true });
      if (!cli) {
        splashStep('whisper', 'active', 'Downloading whisper.cpp engine (~4 MB)…\n');
        const zipPath = path.join(whisperDir, 'whisper-bin-x64.zip');
        await downloadFile(WHISPER_BIN_URL, zipPath, pct => {
          if (pct % 20 === 0) splashStep('whisper', 'active', `  engine: ${pct}%\n`);
        });
        splashStep('whisper', 'active', 'Extracting…\n');
        await new Promise((res, rej) => {
          const p = spawn('powershell', ['-NoProfile', '-Command',
            `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${whisperDir}' -Force`],
            { windowsHide: true });
          p.on('close', c => c === 0 ? res() : rej(new Error('zip extract failed')));
          p.on('error', rej);
        });
        try { fs.unlinkSync(zipPath); } catch (e) {}
        cli = findWhisperCli();
        if (!cli) throw new Error('whisper-cli.exe not found after extraction');
      }
      if (!fs.existsSync(modelPath)) {
        splashStep('whisper', 'active', 'Downloading speech model (~142 MB)…\n');
        await downloadFile(WHISPER_MODEL_URL, modelPath, pct => {
          if (pct % 10 === 0) splashStep('whisper', 'active', `  model: ${pct}%\n`);
        });
      }
      setSetting('whisper_path', cli);
      setSetting('whisper_model', modelPath);
    } catch (err) {
      ok = false;
      splashStep('whisper', 'error', `Whisper setup failed: ${err.message}\n`);
    }
    if (ok) splashStep('whisper', 'done', 'Whisper ready — transcription works offline.\n');
  } else {
    splashStep('whisper', 'done', 'Whisper already installed — skipping.\n');
  }
  await sleep(200);

  // ── Step 5: done ─────────────────────────────────────────────────────────
  splashStep('done', 'done', 'All done!\n');
  markFirstRunComplete();
  await sleep(800);
  splashDone();
  // Give the user a moment to see the ✅ before the main window opens
  await sleep(1800);
}

function createSplash() {
  if (isUpdateMode) return;
  try {
    splashWindow = new BrowserWindow({
      width: 560, height: 640, frame: false, transparent: true, resizable: false,
      center: true, alwaysOnTop: false, skipTaskbar: true, show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'src/splash-preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    splashWindow.loadFile(path.join(__dirname, 'src/splash.html'));
    splashWindow.once('ready-to-show', () => { if (splashWindow) splashWindow.show(); });
    setTimeout(() => { if (splashWindow) splashWindow.show(); }, 1200);
    splashWindow.on('closed', () => { splashWindow = null; });
  } catch (e) { splashWindow = null; }
}
function closeSplash() {
  if (splashWindow) { try { splashWindow.close(); } catch (e) {} splashWindow = null; }
}

function createWindow() {
  if (isUpdateMode) return;
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070812',
      symbolColor: '#cbd5e1',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets/LOGO.png'),
    show: false
  });

  try {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] })
        .then((sources) => {
          const requestedVideo = sources[0];
          if (!requestedVideo) return callback({});
          callback({ video: requestedVideo, audio: 'loopback' });
        })
        .catch(() => callback({}));
    }, { useSystemPicker: true });
  } catch (e) {
    console.warn('Display media handler unavailable:', e.message);
  }

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  let shown = false;
  const showNow = () => {
    if (shown || !mainWindow) return;
    shown = true;
    closeSplash();
    mainWindow.show();
    mainWindow.focus();

    // Auto check for update on launch - show big green banner if available
    setTimeout(() => {
      performAutoUpdateCheck(mainWindow);
    }, 2500);
  };

  mainWindow.once('ready-to-show', showNow);

  // Safety net: if ready-to-show never fires (renderer hang, GPU issue, etc.)
  // force the window to show anyway after a short delay so the app never
  // appears to be permanently "stuck" on the splash.
  setTimeout(showNow, 8000);

  // Safety net: never leave the splash orphaned if the main window errors out.
  mainWindow.webContents.on('did-fail-load', () => closeSplash());
  setTimeout(closeSplash, 15000);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (peerServer) { try { peerServer.close(); } catch (e) {} }
    if (peerClient) { try { peerClient.close(); } catch (e) {} }
  });
}

function createDuoTestWindow() {
  if (isUpdateMode) return { ok: false, error: 'App is updating' };
  if (duoTestWindow && !duoTestWindow.isDestroyed()) {
    duoTestWindow.focus();
    return { ok: true, focused: true };
  }

  duoTestWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#070812',
    autoHideMenuBar: true,
    title: 'VibeForge Duo Tester',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#070812',
      symbolColor: '#cbd5e1',
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets/LOGO.png'),
    show: false
  });

  duoTestWindow.loadFile(path.join(__dirname, 'src/index.html'), {
    search: '?duoTest=1'
  });

  duoTestWindow.once('ready-to-show', () => {
    if (duoTestWindow && !duoTestWindow.isDestroyed()) {
      duoTestWindow.show();
      duoTestWindow.focus();
    }
  });
  setTimeout(() => {
    if (duoTestWindow && !duoTestWindow.isDestroyed()) duoTestWindow.show();
  }, 4000);
  duoTestWindow.on('closed', () => {
    duoTestWindow = null;
  });
  return { ok: true };
}

async function performAutoUpdateCheck(win) {
  try {
    let owner = 'jayton123456789-hub';
    let repo = 'VibeForge';
    try {
      const oRow = db.prepare('SELECT value FROM settings WHERE key=?').get('github_owner');
      const rRow = db.prepare('SELECT value FROM settings WHERE key=?').get('github_repo');
      if (oRow && oRow.value) owner = oRow.value;
      if (rRow && rRow.value) repo = rRow.value;
    } catch (e) {}
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
      headers: { 'User-Agent': 'VibeForge' }
    });
    if (!res.ok) return;
    const rel = await res.json();
    const latestTag = normalizeVersion(rel.tag_name || '');
    const currentVer = app.getVersion ? app.getVersion() : '0.1.0';
    const hasUpdate = latestTag && isNewerVersion(latestTag, currentVer);
    if (hasUpdate && win && win.webContents) {
      win.webContents.send('update-available', {
        latest: latestTag,
        url: rel.html_url || `https://github.com/${owner}/${repo}/releases`
      });
    }
  } catch (e) {
    // silent, don't break launch
  }
}

app.whenReady().then(() => {
  // Show the splash IMMEDIATELY so launch feels instant, before the (slower) DB init.
  createSplash();
  const needsFirstRunSetup = !isSetupComplete();
  if (!needsFirstRunSetup) initDb();

  // Developer startup log for data debugging (visible when launched from console/bat)
  console.log('=== VibeForge Startup Debug ===');
  console.log('App name:', app.getName());
  console.log('userData path:', app.getPath('userData'));
  if (db) {
    const dbp = getDbPath();
    console.log('DB path:', dbp);
    console.log('DB file exists:', fs.existsSync(dbp));
    try {
      const pc = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
      const sc = db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
      const tc = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
      const ic = db.prepare('SELECT COUNT(*) as c FROM ideas').get().c;
      const dc = db.prepare('SELECT COUNT(*) as c FROM decisions').get().c;
      console.log('Counts - projects:', pc, 'sessions:', sc, 'tasks:', tc, 'ideas:', ic, 'decisions:', dc);
    } catch (e) {
      console.log('Counts query failed (empty DB?):', e.message);
    }
  } else {
    console.log('DB not loaded yet; first-run dependency setup pending.');
  }
  console.log('================================');

  registerIpc();
  if (!isUpdateMode) {
    // First-run shows the dependency setup wizard first. Normal launch opens immediately.
    firstRunPending = needsFirstRunSetup;
    if (!firstRunPending) createWindow();
  }
  // Note: update mode process is headless replacer (scheduled above), no window.

  app.on('activate', () => {
    if (!isUpdateMode && !firstRunPending && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
