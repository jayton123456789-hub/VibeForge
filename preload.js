const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Projects
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (name) => ipcRenderer.invoke('create-project', name),
  renameProject: (id, newName) => ipcRenderer.invoke('rename-project', { id, newName }),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

  // Sessions
  getSessions: (projectId) => ipcRenderer.invoke('get-sessions', projectId),
  createSession: (data) => ipcRenderer.invoke('create-session', data),
  updateSessionNotes: (id, notes) => ipcRenderer.invoke('update-session-notes', { id, notes }),
  updateSessionTitle: (id, title) => ipcRenderer.invoke('update-session-title', { id, title }),
  updateSessionAudio: (id, audio_path) => ipcRenderer.invoke('update-session-audio', { id, audio_path }),
  updateSessionEnded: (id, ended_at) => ipcRenderer.invoke('update-session-ended', { id, ended_at }),
  saveAudio: (sessionId, buffer) => ipcRenderer.invoke('save-audio', { sessionId, buffer }),
  saveScreen: (sessionId, buffer) => ipcRenderer.invoke('save-screen', { sessionId, buffer }),
  updateSessionScreen: (id, screen_path) => ipcRenderer.invoke('update-session-screen', { id, screen_path }),
  deleteSession: (id) => ipcRenderer.invoke('delete-session', id),
  getDecisionsBySession: (sessionId) => ipcRenderer.invoke('get-decisions-by-session', sessionId),
  getTasksBySession: (sessionId) => ipcRenderer.invoke('get-tasks-by-session', sessionId),
  getIdeasBySession: (sessionId) => ipcRenderer.invoke('get-ideas-by-session', sessionId),
  getTimelineBySession: (sessionId) => ipcRenderer.invoke('get-timeline-by-session', sessionId),

  // Decisions
  getDecisions: (projectId) => ipcRenderer.invoke('get-decisions', projectId),
  addDecision: (data) => ipcRenderer.invoke('add-decision', data),
  updateDecision: (data) => ipcRenderer.invoke('update-decision', data),
  deleteDecision: (id) => ipcRenderer.invoke('delete-decision', id),

  // Tasks
  getTasks: (projectId) => ipcRenderer.invoke('get-tasks', projectId),
  addTask: (data) => ipcRenderer.invoke('add-task', data),
  updateTask: (data) => ipcRenderer.invoke('update-task', data),
  deleteTask: (id) => ipcRenderer.invoke('delete-task', id),

  // Ideas
  getIdeas: (projectId) => ipcRenderer.invoke('get-ideas', projectId),
  addIdea: (data) => ipcRenderer.invoke('add-idea', data),
  deleteIdea: (id) => ipcRenderer.invoke('delete-idea', id),
  convertIdeaToTask: (ideaId) => ipcRenderer.invoke('convert-idea-to-task', ideaId),

  // Timeline
  getTimeline: (projectId) => ipcRenderer.invoke('get-timeline', projectId),

  // Memory search (real local search)
  searchMemory: (projectId, query) => ipcRenderer.invoke('search-memory', { projectId, query }),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', { key, value }),
  resetAllData: () => ipcRenderer.invoke('reset-all-data'),
  getStorageStatus: () => ipcRenderer.invoke('get-storage-status'),
  revealStorage: () => ipcRenderer.invoke('reveal-storage'),

  // File pick (for future link/assets)
  pickFile: () => ipcRenderer.invoke('pick-file'),

  // Duo / Link (IPC stubs — real PeerJS connection is managed in renderer.js
  // where WebRTC is available; these just satisfy any legacy call sites)
  duoHost: () => ipcRenderer.invoke('duo-host'),
  duoJoin: (address) => ipcRenderer.invoke('duo-join', address),
  duoDisconnect: () => ipcRenderer.invoke('duo-disconnect'),
  getPeerStatus: () => ipcRenderer.invoke('get-peer-status'),
  openDuoTestWindow: () => ipcRenderer.invoke('open-duo-test-window'),
  peerSendFile: (filePath) => ipcRenderer.invoke('peer-send-file', filePath),
  peerSendText: (text) => ipcRenderer.invoke('peer-send-text', text),
  onPeerFile: (cb) => { ipcRenderer.removeAllListeners('peer-file'); ipcRenderer.on('peer-file', (_e, data) => cb(data)); },

  // Listen for peer updates from main
  onPeerStatus: (cb) => { ipcRenderer.removeAllListeners('peer-status'); ipcRenderer.on('peer-status', (e, data) => cb(data)); },
  onPeerMessage: (cb) => { ipcRenderer.removeAllListeners('peer-message'); ipcRenderer.on('peer-message', (e, data) => cb(data)); },

  // New real QOL APIs
  updateIdea: (data) => ipcRenderer.invoke('update-idea', data),
  getIdeasFiltered: (args) => ipcRenderer.invoke('get-ideas-filtered', args),
  exportSessionMdReal: (args) => ipcRenderer.invoke('export-session-md', args),
  exportGrokPromptReal: (args) => ipcRenderer.invoke('export-grok-prompt', args),
  exportProjectJsonReal: (args) => ipcRenderer.invoke('export-project-json', args),
  exportProjectMdReal: (args) => ipcRenderer.invoke('export-project-md', args),
  revealExports: (projectId) => ipcRenderer.invoke('reveal-exports', projectId),
  revealReceived: () => ipcRenderer.invoke('reveal-received'),
  revealRecordings: () => ipcRenderer.invoke('reveal-recordings'),

  ollamaCheck: () => ipcRenderer.invoke('ollama-check'),
  ollamaStatus: () => ipcRenderer.invoke('ollama-status'),
  whisperStatus: () => ipcRenderer.invoke('whisper-status'),
  ollamaOpenDownload: () => ipcRenderer.invoke('ollama-open-download'),
  ollamaInstallAuto: () => ipcRenderer.invoke('ollama-install-auto'),
  ollamaPull: (model) => ipcRenderer.invoke('ollama-pull', model),
  ollamaListModels: () => ipcRenderer.invoke('ollama-list-models'),
  ollamaTestModel: (model) => ipcRenderer.invoke('ollama-test-model', model),
  getSessionRecordings: (sessionId) => ipcRenderer.invoke('get-session-recordings', sessionId),

  checkGit: () => ipcRenderer.invoke('check-git'),
  checkGhCli: () => ipcRenderer.invoke('check-gh-cli'),
  checkGhLogin: () => ipcRenderer.invoke('check-gh-login'),
  getGithubUser: () => ipcRenderer.invoke('get-github-user'),
  ghSignin: () => ipcRenderer.invoke('gh-signin'),
  ghRun: (args) => ipcRenderer.invoke('gh-run', args),
  ghOpenRepo: (data) => ipcRenderer.invoke('gh-open-repo', data),
  checkAppUpdate: (data) => ipcRenderer.invoke('check-app-update', data),

  whisperCheck: (p) => ipcRenderer.invoke('whisper-check', p),
  whisperRepairModel: () => ipcRenderer.invoke('whisper-repair-model'),
  whisperOpenHelp: () => ipcRenderer.invoke('whisper-open-help'),

  onOllamaLog: (cb) => ipcRenderer.on('ollama-log', (_e, line) => cb(line)),

  // Dev publishing (only meaningful for Jayton's repo)
  findPortableArtifact: () => ipcRenderer.invoke('find-portable-artifact'),
  buildPortable: () => ipcRenderer.invoke('build-portable'),
  publishRelease: (data) => ipcRenderer.invoke('publish-release', data),
  revealDist: () => ipcRenderer.invoke('reveal-dist'),
  onBuildLog: (cb) => ipcRenderer.on('build-log', (_e, line) => cb(line)),
  onGithubSigninLog: (cb) => ipcRenderer.on('github-signin-log', (_e, line) => cb(line)),
  onGithubSigninDone: (cb) => ipcRenderer.on('github-signin-done', (_e, data) => cb(data)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  startOllamaServe: () => ipcRenderer.invoke('start-ollama-serve'),
  openOllama: () => ipcRenderer.invoke('open-ollama'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  transcribeWav: (data) => ipcRenderer.invoke('transcribe-wav', data),
  readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
  setupOpenSourceWhisper: () => ipcRenderer.invoke('setup-open-source-whisper'),
  onWhisperSetupLog: (cb) => ipcRenderer.on('whisper-setup-log', (_e, line) => cb(line)),
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

  // Renderer-side PeerJS: call main only to persist received files (needs Node.js fs)
  saveReceivedFile: (name, uint8arr) => ipcRenderer.invoke('save-received-file', { name, uint8arr }),

  // App version for display
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
};

contextBridge.exposeInMainWorld('vibeforge', api);
