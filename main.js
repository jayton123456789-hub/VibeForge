const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const os = require('os');
const https = require('https');

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
    setTimeout(() => {
      try {
        let copied = false;
        const start = Date.now();
        const maxMs = 15000;
        while (!copied && (Date.now() - start < maxMs)) {
          try {
            fs.copyFileSync(process.execPath, targetPath);
            copied = true;
          } catch (e) {
            // Old process still holds file lock on Windows; short busy-wait then retry
            const spinUntil = Date.now() + 250;
            while (Date.now() < spinUntil) {}
          }
        }
        if (!copied) {
          try { fs.copyFileSync(process.execPath, targetPath); } catch (e) {}
        }
        const child = spawn(targetPath, [], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch (e) {}
      app.quit();
    }, 900);
  }
}

// Single instance lock - never more than 1 copy (but allow the update-replacer child to proceed)
if (!isUpdateMode && !app.requestSingleInstanceLock()) {
  app.quit();
}

function isNewerVersion(latest, current) {
  const clean = (v) => (v || '').toString().replace(/^v/i, '').replace(/[^0-9.]/g, '');
  const lp = clean(latest).split('.').map(x => parseInt(x, 10) || 0);
  const cp = clean(current).split('.').map(x => parseInt(x, 10) || 0);
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
    req.on('error', (e) => {
      file.close();
      try { fs.unlinkSync(dest); } catch (err) {}
      reject(e);
    });
  });
}

let mainWindow;
let db;
let peerServer = null;
let peerClient = null;
let currentPeer = null; // { type: 'host' | 'client', address: string, ws: ws }

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
    // Pre-set to Jayton's repo. The Settings UI now always shows a clear CHECK FOR UPDATE + SIGN IN area + publishing tools.
    ['github_owner', 'jayton123456789-hub'],
    ['github_repo', 'VibeForge'],
    ['auto_check_updates', 'true']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  defaults.forEach(([k, v]) => stmt.run(k, v));

  // Migration: add status to ideas for Inbox/Saved/etc (no demo, safe)
  try {
    db.exec(`ALTER TABLE ideas ADD COLUMN status TEXT DEFAULT 'Inbox'`);
  } catch (e) {
    // column exists or other harmless
  }
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// IPC for all real actions - every button will call these
function registerIpc() {
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

  ipcMain.handle('create-session', (e, { projectId, title, mode }) => {
    if (!title || !title.trim()) throw new Error('Session name required');
    const id = uuidv4();
    const now = Date.now();
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

  // For Duo/Share real link (WebSocket)
  ipcMain.handle('duo-host', async () => {
    if (peerServer) {
      try { peerServer.close(); } catch (e) {}
    }
    const port = 48290 + Math.floor(Math.random() * 100);
    const ip = getLocalIP();
    peerServer = new WebSocket.Server({ port });

    peerServer.on('connection', (ws) => {
      currentPeer = { type: 'host', address: `${ip}:${port}`, ws };
      ws.on('message', (msg) => {
        if (Buffer.isBuffer(msg)) {
          const receivedDir = path.join(app.getPath('userData'), 'received');
          if (!fs.existsSync(receivedDir)) fs.mkdirSync(receivedDir, { recursive: true });
          const filePath = path.join(receivedDir, `received-${Date.now()}.bin`);
          fs.writeFileSync(filePath, msg);
          if (mainWindow) mainWindow.webContents.send('peer-file', { path: filePath });
        } else {
          if (mainWindow) mainWindow.webContents.send('peer-message', msg.toString());
        }
      });
      ws.on('close', () => { currentPeer = null; });
      if (mainWindow) mainWindow.webContents.send('peer-status', { status: 'connected', address: `${ip}:${port}` });
    });

    return { address: `${ip}:${port}`, port };
  });

  ipcMain.handle('duo-join', async (e, address) => {
    if (peerClient) {
      try { peerClient.close(); } catch (e) {}
    }
    return new Promise((resolve) => {
      try {
        peerClient = new WebSocket(`ws://${address}`);
        peerClient.on('open', () => {
          currentPeer = { type: 'client', address, ws: peerClient };
          if (mainWindow) mainWindow.webContents.send('peer-status', { status: 'connected', address });
          resolve({ ok: true, address });
        });
        peerClient.on('message', (msg) => {
          if (Buffer.isBuffer(msg)) {
            // file chunk - save to received
            const receivedDir = path.join(app.getPath('userData'), 'received');
            if (!fs.existsSync(receivedDir)) fs.mkdirSync(receivedDir, { recursive: true });
            const filePath = path.join(receivedDir, `received-${Date.now()}.bin`);
            fs.writeFileSync(filePath, msg);
            if (mainWindow) mainWindow.webContents.send('peer-file', { path: filePath });
          } else {
            if (mainWindow) mainWindow.webContents.send('peer-message', msg.toString());
          }
        });
        peerClient.on('close', () => {
          currentPeer = null;
          if (mainWindow) mainWindow.webContents.send('peer-status', { status: 'disconnected' });
        });
        peerClient.on('error', (err) => {
          resolve({ ok: false, error: err.message });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });

  ipcMain.handle('peer-send-file', async (e, filePath) => {
    if (!currentPeer || !currentPeer.ws || currentPeer.ws.readyState !== 1) {
      return { ok: false, error: 'Not connected' };
    }
    try {
      const buf = fs.readFileSync(filePath);
      const name = path.basename(filePath);
      currentPeer.ws.send(JSON.stringify({ type: 'file-start', name, size: buf.length }));
      currentPeer.ws.send(buf); // send binary
      currentPeer.ws.send(JSON.stringify({ type: 'file-end' }));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('peer-send-text', (e, text) => {
    if (!currentPeer || !currentPeer.ws || currentPeer.ws.readyState !== 1) {
      return { ok: false, error: 'Not connected' };
    }
    try {
      currentPeer.ws.send(text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('duo-disconnect', () => {
    if (peerServer) { try { peerServer.close(); } catch (e) {} peerServer = null; }
    if (peerClient) { try { peerClient.close(); } catch (e) {} peerClient = null; }
    currentPeer = null;
    if (mainWindow) mainWindow.webContents.send('peer-status', { status: 'disconnected' });
    return true;
  });

  ipcMain.handle('get-peer-status', () => {
    if (currentPeer) return { status: 'connected', address: currentPeer.address, type: currentPeer.type };
    if (peerServer) return { status: 'hosting' };
    return { status: 'offline' };
  });

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

  function getOllamaCommand() {
    const fullPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe'
    ];
    for (const p of fullPaths) {
      if (fs.existsSync(p)) return `"${p}"`;
    }
    return 'ollama';
  }

  

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
  // Improved GitHub device flow so the app can show the code to the user (as seen on github.com/login/device)
  let ghDeviceProc = null;

  // Pure GitHub device flow (no 'gh' CLI required for sign-in). This shows the code in the app.
  // User enters it on github.com/login/device , we poll and get a token, then detect if it's Jayton's account for DEV/publishing.
  ipcMain.handle('start-github-device-signin', async () => {
    // We return immediately; the renderer does the fetch + polling + showing code.
    // This handler is kept for compatibility but the real flow is now in renderer.
    return { started: true, useRendererFlow: true };
  });

  ipcMain.handle('github-poll-device-token', async (e, { device_code, client_id }) => {
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${client_id}&device_code=${device_code}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
      });
      const data = await res.json();
      return data;
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('github-get-user-with-token', async (e, { token }) => {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });
      if (!res.ok) return { ok: false, status: res.status };
      const user = await res.json();
      return { ok: true, login: user.login, name: user.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('github-publish-with-token', async (e, { token, owner, repo, tag, title, body, assetPath }) => {
    try {
      // 1. Create the release
      const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tag_name: tag,
          name: title || `VibeForge ${tag}`,
          body: body || 'Released from VibeForge app',
          draft: false
        })
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        return { ok: false, error: `Create release failed: ${createRes.status} ${errText}` };
      }
      const release = await createRes.json();

      // 2. Upload the asset if provided
      if (assetPath && fs.existsSync(assetPath)) {
        const fileName = path.basename(assetPath);
        const uploadUrl = release.upload_url.replace('{?name,label}', `?name=${encodeURIComponent(fileName)}`);
        const buf = fs.readFileSync(assetPath);
        const uploadRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': buf.length
          },
          body: buf
        });
        if (!uploadRes.ok) {
          const errText = await uploadRes.text();
          return { ok: false, error: `Release created (${release.html_url}) but asset upload failed: ${uploadRes.status} ${errText}` };
        }
      }

      return { ok: true, url: release.html_url };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // === Ollama serve (open source local AI server) ===
  ipcMain.handle('start-ollama-serve', () => {
    const cmd = getOllamaCommand();
    try {
      const proc = spawn(cmd, ['serve'], { detached: true, stdio: 'ignore' });
      proc.unref();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
      const newExe = path.join(updateDir, 'VibeForge-Portable-new.exe');

      await downloadFile(url, newExe);

      const current = process.execPath;
      let spawnArgs = [];
      if (app.isPackaged) {
        spawnArgs = ['--update-target', current];
      }
      // For dev (source), just launch the new portable as the "updated" version.
      // For packaged, use the target copy logic to replace in place (remove old version).
      const child = spawn(newExe, spawnArgs, { detached: true, stdio: 'ignore' });
      child.unref();
      app.quit();
      return { ok: true };
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
  ipcMain.handle('transcribe-wav', async (e, { wav, sessionId, appendToNotes }) => {
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
    return new Promise((resolve) => {
      const args = ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', '4'];
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

  ipcMain.handle('check-github-user', () => {
    return new Promise((resolve) => {
      exec('gh api user --jq .login', (err, stdout) => {
        if (err) return resolve({ ok: false, login: null });
        const login = (stdout || '').trim();
        resolve({ ok: true, login });
      });
    });
  });

  // Legacy for compatibility
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
      const latestTag = (rel.tag_name || '').replace(/^v/, '');
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

function createWindow() {
  if (isUpdateMode) return;
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'assets/LOGO.png'),
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // DevTools no longer auto-opened (user didn't like the "weird DEV window")

    // Auto check for update on launch - show big green banner if available
    setTimeout(() => {
      performAutoUpdateCheck(mainWindow);
    }, 2500);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (peerServer) { try { peerServer.close(); } catch (e) {} }
    if (peerClient) { try { peerClient.close(); } catch (e) {} }
  });
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
    const latestTag = (rel.tag_name || '').replace(/^v/, '');
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
  initDb();

  // Developer startup log for data debugging (visible when launched from console/bat)
  console.log('=== VibeForge Startup Debug ===');
  console.log('App name:', app.getName());
  console.log('userData path:', app.getPath('userData'));
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
  console.log('================================');

  registerIpc();
  if (!isUpdateMode) {
    createWindow();
  }
  // Note: update mode process is headless replacer (scheduled above), no window.

  app.on('activate', () => {
    if (!isUpdateMode && BrowserWindow.getAllWindows().length === 0) createWindow();
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