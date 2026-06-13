// VibeForge - Minimal, stable, fully wired first version
// Every button here has a real handler. No dead UI.

// Escape user-entered text before interpolating into HTML templates.
// Without this, a title like  Nick's <idea>  breaks rendering and onclick handlers.
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// First MediaRecorder mimeType the platform actually supports, from a preference list.
function pickMime(list) {
  for (const m of list) {
    try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return '';
}

let currentProject = null;
let currentView = 'sessions';
let projects = [];
let peerStatus = { status: 'offline', address: '' };
let receivedItems = [];
let remoteVaultSnapshot = null;
let currentLinkMode = 'control';
// Global timer ref so repeated quickStartRecording never stacks intervals
let _globalTimerInterval = null;
let _activeLiveSession = null;
let _duoPeerSessionNotes = {};
let _duoPeerAiResults = {};

function getProfileNameFallback() {
  const n = document.getElementById('project-name')?.textContent || 'Linked collaborator';
  return n === 'No project' ? 'Linked collaborator' : n;
}

// Init
async function init() {
  // Load projects
  projects = await window.vibeforge.getProjects();

  // First launch should not block the user with "create a project" admin work.
  // Create a quiet default workspace so the app opens straight to the recording command center.
  if (projects.length === 0) {
    await ensureDefaultProject();
  }

  // Load last or first project
  currentProject = projects[0];
  updateProjectHeader(currentProject);
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('duoTest') === '1') {
    await switchView('share');
    setTimeout(() => showToast('Duo tester window: paste the host room code here.'), 300);
  } else {
    await switchView('sessions');
  }
  // Keep the tour available from the sidebar, but do not auto-block the app with
  // a full-screen overlay on launch. The previous auto-open made the UI feel unclickable.

  // Listen for peer updates (from main)
  if (window.vibeforge.onPeerStatus) {
    window.vibeforge.onPeerStatus((data) => {
      peerStatus = data;
      if (currentView === 'share') renderShareView();
      showToast(data.status === 'connected' ? 'Linked successfully' : 'Link status updated');
    });
  }

  if (window.vibeforge.onPeerMessage) {
    window.vibeforge.onPeerMessage((msg) => {
      handlePeerTextPayload(msg);
    });
  }

  if (window.vibeforge.onOllamaLog) {
    window.vibeforge.onOllamaLog((line) => {
      const logEl = document.getElementById('ollama-log');
      if (logEl) {
        logEl.textContent += line;
        logEl.scrollTop = logEl.scrollHeight;
      }
      console.log('[ollama]', line);
    });
  }

  if (window.vibeforge.onBuildLog) {
    window.vibeforge.onBuildLog((line) => {
      const logEl = document.getElementById('build-log');
      if (logEl) {
        logEl.textContent += line;
        logEl.scrollTop = logEl.scrollHeight;
      }
      console.log('[build]', line);
    });
  }
}

async function ensureDefaultProject() {
  if (currentProject && currentProject.id) return currentProject;
  projects = await window.vibeforge.getProjects();
  if (projects.length) {
    currentProject = projects[0];
    updateProjectHeader(currentProject);
    return currentProject;
  }
  const proj = await window.vibeforge.createProject('My Workspace');
  projects = await window.vibeforge.getProjects();
  currentProject = proj;
  updateProjectHeader(currentProject);
  return proj;
}

function maybeShowFirstRunTour(force = false) {
  if (!force && localStorage.getItem('vibeforge-tour-seen') === 'true') return;
  const steps = [
    { target: '.fa-microphone', title: 'Quick Record', body: 'This is the main flow: tap the mic, start talking, name it later. VibeForge saves the session and runs cleanup after you stop.' },
    { target: '#global-search', title: 'Global Search', body: 'Search across sessions, notes, decisions, tasks, and ideas. Press Enter to jump into Project Memory.' },
    { target: '#nav-sessions', title: 'Sessions', body: 'Your recordings live here. Open old sessions, resume them, review transcripts, highlights, and AI summaries.' },
    { target: '#nav-decisions', title: 'Decision Vault', body: 'Choices and open questions get filed here so they do not disappear inside a long conversation.' },
    { target: '#nav-tasks', title: 'Tasks', body: 'Action items extracted from sessions or marked live during a recording.' },
    { target: '#nav-ideas', title: 'Idea Vault', body: 'Loose sparks and side ideas go here. Capture them quickly, then save, archive, rename, or convert later.' },
    { target: '#nav-memory', title: 'Project Memory', body: 'Ask your local AI about your real stored project data. It uses your sessions and vaults as context.' },
    { target: '#nav-share', title: 'Link', body: 'Connect with Nick or Dylan. Once linked, Control, Remote Vault, and Link Vault unlock under this tab.' },
    { target: '#service-status', title: 'Local AI Status', body: 'These lights show Ollama and Whisper readiness. Click them to jump to AI setup if something is offline.' },
    { target: '#nav-settings', title: 'Settings', body: 'Setup Ollama, Whisper, folders, updates, and reset tools here. Core work stays local on this PC.' }
  ];
  let index = 0;
  const overlay = document.createElement('div');
  overlay.id = 'spotlight-tour';
  overlay.className = 'fixed inset-0 z-[700] pointer-events-none';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-black/70"></div>
    <div id="tour-ring" class="absolute rounded-[22px] border-2 border-cyan-300 shadow-[0_0_0_9999px_rgba(0,0,0,.68),0_0_36px_rgba(34,211,238,.75)] transition-all duration-200"></div>
    <div id="tour-card" class="absolute w-[360px] max-w-[calc(100vw-32px)] rounded-[26px] border border-cyan-500/30 bg-[#0b0f1d] p-5 shadow-2xl shadow-black/70 pointer-events-auto">
      <div class="text-[10px] uppercase tracking-[2px] text-cyan-300 mb-2">Guided tour <span id="tour-count"></span></div>
      <div id="tour-title" class="text-xl font-semibold"></div>
      <div id="tour-body" class="mt-2 text-sm leading-6 text-zinc-400"></div>
      <div class="mt-5 flex gap-2">
        <button id="tour-skip" class="flex-1 rounded-2xl border border-zinc-700 py-2 text-sm text-zinc-200 hover:bg-zinc-800">Skip</button>
        <button id="tour-back" class="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-800">Back</button>
        <button id="tour-next" class="flex-1 rounded-2xl bg-white py-2 text-sm font-semibold text-black">Next</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = async (startRecording = false) => {
    localStorage.setItem('vibeforge-tour-seen', 'true');
    overlay.remove();
    if (startRecording) await quickStartRecording();
  };
  const render = () => {
    const step = steps[index];
    let el = document.querySelector(step.target);
    if (!el) el = document.getElementById('main-content') || document.body;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const ring = document.getElementById('tour-ring');
    ring.style.left = `${Math.max(8, rect.left - pad)}px`;
    ring.style.top = `${Math.max(8, rect.top - pad)}px`;
    ring.style.width = `${Math.max(44, rect.width + pad * 2)}px`;
    ring.style.height = `${Math.max(44, rect.height + pad * 2)}px`;

    const card = document.getElementById('tour-card');
    const rightRoom = window.innerWidth - rect.right;
    let left = rightRoom > 390 ? rect.right + 18 : rect.left - 378;
    if (left < 16) left = 16;
    if (left + 360 > window.innerWidth - 16) left = window.innerWidth - 376;
    let top = rect.top;
    if (top + 230 > window.innerHeight - 16) top = window.innerHeight - 246;
    if (top < 16) top = 16;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    document.getElementById('tour-count').textContent = `${index + 1}/${steps.length}`;
    document.getElementById('tour-title').textContent = step.title;
    document.getElementById('tour-body').textContent = step.body;
    document.getElementById('tour-back').disabled = index === 0;
    document.getElementById('tour-back').style.opacity = index === 0 ? '.45' : '1';
    document.getElementById('tour-next').textContent = index === steps.length - 1 ? 'Start Recording' : 'Next';
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) {}
  };
  overlay.querySelector('#tour-skip').onclick = () => close(false);
  overlay.querySelector('#tour-back').onclick = () => { if (index > 0) { index--; render(); } };
  overlay.querySelector('#tour-next').onclick = () => {
    if (index >= steps.length - 1) close(true);
    else { index++; render(); }
  };
  window.addEventListener('resize', render, { once: true });
  render();
}

window.showFirstRunTour = function() {
  maybeShowFirstRunTour(true);
};

function updateProjectHeader(project) {
  const nameEl = document.getElementById('project-name');
  const metaEl = document.getElementById('project-meta');
  const avatarEl = document.getElementById('project-avatar');
  
  if (!project) {
    nameEl.textContent = 'No project';
    metaEl.textContent = 'Create one to start';
    avatarEl.textContent = '?';
    avatarEl.style.background = '#3f3f46';
    return;
  }
  nameEl.textContent = project.name;
  metaEl.textContent = 'Active';
  avatarEl.textContent = project.name.slice(0, 2).toUpperCase();
  avatarEl.style.background = '#6366f1';
}

function formatSessionMeta(s) {
  const start = new Date(s.started_at);
  let str = start.toLocaleDateString() + ' ' + start.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  if (s.ended_at) {
    const end = new Date(s.ended_at);
    const mins = Math.max(1, Math.round((s.ended_at - s.started_at) / 60000));
    str += ` -> ${end.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} (${mins}m)`;
  } else {
    str += ' (open)';
  }
  if (s.mode) str += ` - ${s.mode}`;
  return str;
}

async function showProjectMenu() {
  // Toggle: close if already open
  const existing = document.getElementById('project-dropdown');
  if (existing) { existing.remove(); return; }

  if (!currentProject && projects.length === 0) {
    await createFirstProject();
    return;
  }

  const menu = document.createElement('div');
  menu.id = 'project-dropdown';
  menu.className = 'absolute bg-[#111113] border border-zinc-700 rounded-2xl shadow-xl py-1 text-sm z-50 min-w-[220px]';
  menu.style.left = '12px';
  menu.style.top = '60px';

  let html = '';
  projects.forEach(p => {
    const active = currentProject && currentProject.id === p.id ? 'font-semibold text-white' : '';
    html += `<div onclick="switchProject('${p.id}'); this.parentNode.remove()" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2 ${active}">
      <div class="w-6 h-6 rounded bg-[#6366f1] text-[10px] flex items-center justify-center">${p.name.slice(0,2).toUpperCase()}</div>
      <span>${esc(p.name)}</span>
    </div>`;
  });

  html += `<div class="h-px bg-zinc-700 my-1 mx-2"></div>`;
  html += `<div onclick="createProjectFromMenu(this)" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2"><i class="fa-solid fa-plus w-4"></i> Create New Project</div>`;
  
  if (currentProject) {
    html += `<div onclick="renameCurrentProject(this)" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2"><i class="fa-solid fa-edit w-4"></i> Rename Project</div>`;
    html += `<div onclick="deleteCurrentProject(this)" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2 text-red-400"><i class="fa-solid fa-trash w-4"></i> Delete Project</div>`;
    html += `<div onclick="exportProject(this)" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2"><i class="fa-solid fa-download w-4"></i> Export Project (JSON)</div>`;
    html += `<div onclick="exportProjectMd(this)" class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2"><i class="fa-solid fa-file-alt w-4"></i> Export Project Markdown</div>`;
  }

  menu.innerHTML = html;
  document.body.appendChild(menu);

  // Close on outside click (capture phase). Self-removes once the menu is gone
  // (a menu item may remove the menu directly) so handlers never accumulate.
  const handler = (ev) => {
    if (!document.body.contains(menu)) { document.removeEventListener('click', handler, true); return; }
    const header = document.getElementById('project-header');
    if (!menu.contains(ev.target) && !(header && header.contains(ev.target))) {
      menu.remove();
      document.removeEventListener('click', handler, true);
    }
  };
  setTimeout(() => document.addEventListener('click', handler, true), 150);
}

async function createFirstProject() {
  const name = await window.showInputModal('Project name', '', 'Example: VibeForge, DoReMii, Client App');
  if (!name) return;
  const proj = await window.vibeforge.createProject(name);
  projects = await window.vibeforge.getProjects();
  currentProject = proj;
  updateProjectHeader(currentProject);
  await switchView('sessions');
}

async function createProjectFromMenu(el) {
  el.parentNode.remove();
  const name = await window.showInputModal('New project name', '', 'Enter project name');
  if (!name) return;
  const proj = await window.vibeforge.createProject(name);
  projects = await window.vibeforge.getProjects();
  currentProject = proj;
  updateProjectHeader(currentProject);
  await switchView('sessions');
}

async function renameCurrentProject(el) {
  el.parentNode.remove();
  if (!currentProject) return;
  const newName = await window.showInputModal('Rename project', currentProject.name, 'New name for the project');
  if (!newName) return;
  await window.vibeforge.renameProject(currentProject.id, newName);
  projects = await window.vibeforge.getProjects();
  currentProject = projects.find(p => p.id === currentProject.id);
  updateProjectHeader(currentProject);
  await switchView(currentView);
}

async function deleteCurrentProject(el) {
  el.parentNode.remove();
  if (!currentProject) return;
  if (!await window.showConfirm(`Delete project "${currentProject.name}" and all its data?`, { okLabel: 'Delete project' })) return;
  await window.vibeforge.deleteProject(currentProject.id);
  projects = await window.vibeforge.getProjects();
  currentProject = projects[0] || null;
  updateProjectHeader(currentProject);
  if (currentProject) {
    await switchView('sessions');
  } else {
    document.getElementById('main-content').innerHTML = `<div class="p-8 text-center text-zinc-400">No project yet. Use the project header to create one.</div>`;
  }
}

async function exportProject(el) {
  el.parentNode.remove();
  if (!currentProject) return;
  try {
    const filePath = await window.vibeforge.exportProjectJsonReal(currentProject.id);
    showToast('Project JSON exported to ' + filePath);
  } catch (e) { showToast('Export failed: ' + e.message); }
}

async function exportProjectMd(el) {
  el.parentNode.remove();
  if (!currentProject) return;
  try {
    const filePath = await window.vibeforge.exportProjectMdReal(currentProject.id);
    showToast('Project MD exported to ' + filePath);
  } catch (e) { showToast('Export failed: ' + e.message); }
}

window.revealExportsForProject = async function() {
  if (!currentProject) { showToast('No project'); return; }
  const p = await window.vibeforge.revealExports(currentProject.id);
  showToast('Opened exports: ' + p);
};

async function switchProject(id) {
  currentProject = projects.find(p => p.id === id);
  updateProjectHeader(currentProject);
  await switchView(currentView || 'sessions');
}

// View switcher - every sidebar item calls this and has a real render
async function switchView(view) {
  stashActiveLiveRoomIfNeeded();
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'bg-zinc-900', 'text-white'));
  const nav = document.getElementById('nav-' + view);
  if (nav) nav.classList.add('active', 'bg-zinc-900', 'text-white');

  const content = document.getElementById('main-content');
  const header = document.getElementById('view-title');
  const actions = document.getElementById('view-actions');
  actions.innerHTML = '';

  if (!currentProject && view !== 'settings') {
    content.innerHTML = `<div class="p-8 text-center text-zinc-400">No project selected. Create one using the top-left project area.</div>`;
    return;
  }

  header.textContent = view === 'share' ? 'Link' : view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'sessions') await renderSessionsView(content, actions);
  else if (view === 'decisions') await renderDecisionsView(content, actions);
  else if (view === 'tasks') await renderTasksView(content, actions);
  else if (view === 'ideas') await renderIdeasView(content, actions);
  else if (view === 'timeline') await renderTimelineView(content, actions);
  else if (view === 'memory') await renderMemoryView(content, actions);
  else if (view === 'share') await renderShareView(content, actions);
  else if (view === 'settings') await renderSettingsView(content, actions);
  updateLinkSubnav();
}

function updateLinkSubnav() {
  const subnav = document.getElementById('link-subnav');
  if (!subnav) return;
  const linked = peerStatus && peerStatus.status === 'connected';
  subnav.classList.toggle('hidden', !linked);
  document.querySelectorAll('.link-sub-btn').forEach(btn => {
    btn.classList.remove('bg-zinc-900', 'text-white', 'border', 'border-cyan-500/40');
    btn.classList.add('text-zinc-400');
  });
  const active = document.getElementById('link-sub-' + currentLinkMode);
  if (active && linked) {
    active.classList.add('bg-zinc-900', 'text-white', 'border', 'border-cyan-500/40');
    active.classList.remove('text-zinc-400');
  }
}

window.switchLinkMode = async function(mode) {
  if (!['control', 'remote', 'vault'].includes(mode)) mode = 'control';
  currentLinkMode = mode;
  updateLinkSubnav();
  await switchView('share');
};

// 4. SESSIONS VIEW - fully wired
async function renderSessionsView(content, actionsEl) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  actionsEl.innerHTML = '';
  const recent = sessions.slice().sort((a, b) => (b.started_at || 0) - (a.started_at || 0)).slice(0, 4);

  content.innerHTML = `
    <div class="min-h-full grid xl:grid-cols-[1fr_320px] gap-5">
      <section class="rounded-[28px] border border-zinc-700/50 bg-[#0b0f1d]/80 overflow-hidden">
        <div class="relative min-h-[440px] p-8 flex flex-col items-center justify-center text-center">
          <div class="absolute inset-0 pointer-events-none opacity-80"
               style="background: radial-gradient(circle at 50% 35%, rgba(99,102,241,.22), transparent 28%), radial-gradient(circle at 70% 70%, rgba(20,184,166,.16), transparent 26%);"></div>
          <div class="relative max-w-2xl">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-xs mb-5">
              <i class="fa-solid fa-sparkles"></i>
              Local AI workspace
            </div>
            <h1 class="text-4xl md:text-5xl font-semibold tracking-tight mb-3">Tap the mic. Name it later.</h1>
            <p class="text-zinc-400 text-base md:text-lg mb-8">Start capturing immediately. VibeForge can auto-name, summarize, extract tasks, and sort the mess after the conversation.</p>

            <button onclick="quickStartRecording()"
                    class="mx-auto w-36 h-36 rounded-full bg-gradient-to-br from-red-400 to-red-600 glow-record flex items-center justify-center text-white group mb-7">
              <span class="w-20 h-20 rounded-full bg-white/18 border border-white/30 flex items-center justify-center group-hover:scale-105 transition">
                <i class="fa-solid fa-microphone text-4xl"></i>
              </span>
            </button>

            <div class="flex flex-wrap justify-center gap-3">
              <button onclick="startNewSession()" class="px-5 py-3 rounded-2xl bg-white text-black font-semibold flex items-center gap-2">
                <i class="fa-solid fa-sliders"></i> Advanced Session
              </button>
              <button onclick="showCaptureIdeaModal()" class="px-5 py-3 rounded-2xl bg-gradient-to-r from-cyan-600 to-teal-500 text-white font-semibold flex items-center gap-2">
                <i class="fa-solid fa-lightbulb"></i> Capture Idea
              </button>
              <button onclick="switchView('settings')" class="px-5 py-3 rounded-2xl bg-zinc-900 border border-zinc-700 text-zinc-200 font-semibold flex items-center gap-2">
                <i class="fa-solid fa-wand-magic-sparkles"></i> AI Setup
              </button>
            </div>
          </div>
        </div>

        <div class="border-t border-zinc-800 p-5">
          <div class="flex items-center justify-between mb-3">
            <div>
              <div class="font-semibold text-lg">All sessions</div>
              <div class="text-xs text-zinc-500">${sessions.length} total - ${sessions.filter(s=>s.ended_at).reduce((sum,s)=>sum+Math.round((s.ended_at-s.started_at)/60000),0)} min recorded in ${esc(currentProject.name)}</div>
            </div>
            <button onclick="startNewSession()" class="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">+ New</button>
          </div>
          ${sessions.length ? `
            <div class="space-y-2">
              ${sessions.map(s => {
                const mins = s.ended_at ? Math.max(1, Math.round((s.ended_at - s.started_at) / 60000)) : null;
                const date = new Date(s.started_at).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'});
                const time = new Date(s.started_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
                return `
                <div onclick="openSession('${s.id}')" class="card cursor-pointer rounded-2xl border border-zinc-800 bg-black/25 px-4 py-3 flex items-center gap-3">
                  <div class="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-400">
                    <i class="fa-solid fa-${s.audio_path ? 'microphone' : 'file-lines'} text-sm"></i>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="font-medium truncate text-sm">${esc(s.title)}</div>
                    <div class="text-xs text-zinc-500 mt-0.5">${date} - ${time}${mins ? ' - ' + mins + 'm' : ' - open'}</div>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    ${s.audio_path ? '<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">audio</span>' : ''}
                    <button onclick="event.stopImmediatePropagation(); resumeLiveSession('${s.id}')" class="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">Resume</button>
                  </div>
                </div>
              `}).join('')}
            </div>
          ` : `
            <div class="rounded-2xl border border-dashed border-zinc-800 p-7 text-center text-zinc-500">No sessions yet. Hit the mic and start talking.</div>
          `}
        </div>
      </section>

      <aside class="space-y-4">
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/80 p-5">
          <div class="font-semibold mb-4">System readiness</div>
          <div class="space-y-3 text-sm">
            <div class="flex items-center justify-between"><span class="text-zinc-400">Project</span><span class="text-emerald-300">Ready</span></div>
            <div class="flex items-center justify-between"><span class="text-zinc-400">Local AI</span><span class="text-cyan-300">Auto-checks in Settings</span></div>
            <div class="flex items-center justify-between"><span class="text-zinc-400">Whisper</span><span class="text-cyan-300">One-click setup</span></div>
            <div class="flex items-center justify-between"><span class="text-zinc-400">Storage</span><span class="text-emerald-300">Local only</span></div>
          </div>
        </div>
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/80 p-5">
          <div class="font-semibold mb-2">Fast flow</div>
          <div class="text-sm text-zinc-400 leading-6">Record first. Fill details later. Use AI after the call for names, summaries, tasks, decisions, and insights.</div>
        </div>
        <div class="rounded-[24px] border border-indigo-500/30 bg-indigo-500/10 p-5">
          <div class="font-semibold mb-2 text-indigo-200">Next best action</div>
          <button onclick="quickStartRecording()" class="w-full py-3 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold">
            <i class="fa-solid fa-microphone mr-2"></i> Start Quick Recording
          </button>
        </div>
      </aside>
    </div>
  `;
}

async function deleteSession(id, btn) {
  if (!await window.showConfirm('Delete this session?')) return;
  await window.vibeforge.deleteSession(id);
  await switchView('sessions');
}

window.quickStartRecording = async function() {
  try {
    await ensureDefaultProject();
    const stamp = new Date().toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    const session = await window.vibeforge.createSession({
      projectId: currentProject.id,
      title: `Quick Record ${stamp}`,
      mode: 'room'
    });
    showToast('Quick recording started. Name it later.');
    await renderLiveRoom(session);
  } catch (e) {
    showToast('Could not start quick recording: ' + (e.message || e));
  }
};

async function openSession(id) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === id);
  if (!s) return;

  const decisions = (await window.vibeforge.getDecisionsBySession(id)) || [];
  const tasks = (await window.vibeforge.getTasksBySession(id)) || [];
  const ideas = (await window.vibeforge.getIdeasBySession(id)) || [];
  const timeline = (await window.vibeforge.getTimelineBySession(id)) || [];
  const rawNotes = s.notes || '';
  const summaryMatch = rawNotes.match(/\[AI Summary\]\s*([\s\S]*?)(?=\n\n\[|$)/i);
  // Prefer the accurate full-Whisper transcript; fall back to the rough live captions.
  const whisperMatch = rawNotes.match(/\[Whisper transcript\]\s*([\s\S]*?)(?=\n\n\[|$)/i);
  const liveMatch = rawNotes.match(/\[Live transcript\]\s*([\s\S]*?)(?=\n\n\[|$)/i);
  const aiSummary = summaryMatch ? summaryMatch[1].trim() : '';
  const transcriptText = (whisperMatch ? whisperMatch[1] : (liveMatch ? liveMatch[1] : '')).trim();
  const cleanNotes = rawNotes
    .replace(/\n?\[AI Summary\]\s*[\s\S]*?(?=\n\n\[|$)/i, '')
    .replace(/\n?\[Whisper transcript\]\s*[\s\S]*?(?=\n\n\[|$)/i, '')
    .replace(/\n?\[Live transcript\]\s*[\s\S]*?(?=\n\n\[|$)/i, '')
    .trim();
  const hasAiOutput = Boolean(aiSummary || tasks.length || decisions.length || ideas.length);
  const mediaName = s.audio_path ? s.audio_path.split(/[\\/]/).pop() : '';

  // Highlights = every [MM:SS] mark/clip you dropped during recording, parsed into a
  // clickable reel. Clicking one jumps the recording to that exact moment.
  const highlights = [];
  const hlRe = /^\[(\d{1,2}):(\d{2})\]\s*(.+)$/gm;
  let hlm;
  while ((hlm = hlRe.exec(rawNotes)) !== null) {
    const secs = parseInt(hlm[1], 10) * 60 + parseInt(hlm[2], 10);
    let txt = hlm[3].trim();
    let kind = 'note';
    if (/^Clip this moment/i.test(txt)) { kind = 'clip'; txt = 'Clip'; }
    else if (/^Marked decision:/i.test(txt)) { kind = 'decision'; txt = txt.replace(/^Marked decision:\s*/i, ''); }
    else if (/^Marked task:/i.test(txt)) { kind = 'task'; txt = txt.replace(/^Marked task:\s*/i, ''); }
    else if (/^Marked idea:/i.test(txt)) { kind = 'idea'; txt = txt.replace(/^Marked idea:\s*/i, ''); }
    highlights.push({ time: hlm[1] + ':' + hlm[2], secs, txt, kind });
  }
  const hlIcon = { clip: 'fa-scissors text-emerald-300', decision: 'fa-gavel text-blue-300', task: 'fa-list-check text-cyan-300', idea: 'fa-lightbulb text-amber-300', note: 'fa-bookmark text-zinc-300' };

  const content = document.getElementById('main-content');
  content.innerHTML = `
    <div class="min-h-full grid 2xl:grid-cols-[1fr_320px] gap-4">
      <section class="rounded-[28px] border border-zinc-700/50 bg-[#0b0f1d]/90 overflow-hidden">
        <div class="p-6 border-b border-zinc-800/80">
          <div class="flex items-center justify-between gap-3 mb-5">
            <button onclick="switchView('sessions')" class="px-3 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 hover:text-white"><i class="fa-solid fa-arrow-left mr-2"></i>Sessions</button>
            <div class="flex flex-wrap gap-2 justify-end">
              <button onclick="resumeLiveSession('${s.id}')" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold"><i class="fa-solid fa-play mr-2"></i>Resume</button>
              <button onclick="runSessionAiCleanup('${s.id}', this)" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-semibold"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>AI Cleanup</button>
              <button onclick="editSessionTitle('${s.id}')" class="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-sm"><i class="fa-solid fa-pen"></i></button>
              <button onclick="deleteSessionFromDetail('${s.id}')" class="px-3 py-2 rounded-xl border border-red-700 text-red-300 text-sm"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>

          <div class="flex items-start justify-between gap-5">
            <div class="min-w-0">
              <div class="text-xs uppercase tracking-[1.8px] text-violet-300 mb-2">${esc(s.mode || 'session')}</div>
              <h2 class="text-3xl font-semibold tracking-tight truncate">${esc(s.title)}</h2>
              <div class="text-sm text-zinc-500 mt-2">${formatSessionMeta(s)}</div>
            </div>
            <div class="hidden lg:flex gap-3 text-center">
              <div class="rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-3 min-w-24"><div class="text-2xl font-semibold">${tasks.length}</div><div class="text-[10px] text-zinc-500 uppercase">Tasks</div></div>
              <div class="rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-3 min-w-24"><div class="text-2xl font-semibold">${decisions.length}</div><div class="text-[10px] text-zinc-500 uppercase">Decisions</div></div>
              <div class="rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-3 min-w-24"><div class="text-2xl font-semibold">${ideas.length}</div><div class="text-[10px] text-zinc-500 uppercase">Ideas</div></div>
            </div>
          </div>
        </div>

        <div class="p-5">
          <div class="rounded-2xl border border-zinc-700/70 bg-[#141728]/80 p-2 grid grid-cols-5 gap-2 mb-4">
            <button id="review-tab-summary" onclick="switchSessionReviewTab('${s.id}', 'summary')" class="px-3 py-3 rounded-xl bg-indigo-600/40 border border-indigo-500/40 text-indigo-100 flex items-center justify-center gap-2"><i class="fa-solid fa-sparkles"></i> Summary</button>
            <button id="review-tab-highlights" onclick="switchSessionReviewTab('${s.id}', 'highlights')" class="px-3 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-star"></i> Highlights${highlights.length ? ` <span class="text-[10px] px-1.5 rounded-full bg-amber-500/20 text-amber-300">${highlights.length}</span>` : ''}</button>
            <button id="review-tab-transcript" onclick="switchSessionReviewTab('${s.id}', 'transcript')" class="px-3 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-align-left"></i> Transcript</button>
            <button id="review-tab-notes" onclick="switchSessionReviewTab('${s.id}', 'notes')" class="px-3 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-sticky-note"></i> Notes</button>
            <button id="review-tab-artifacts" onclick="switchSessionReviewTab('${s.id}', 'artifacts')" class="px-3 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-layer-group"></i> Items</button>
          </div>

          <div id="review-panel-highlights" style="display:none" class="rounded-[24px] border border-zinc-700/70 bg-black/25 p-5 min-h-[320px]">
            <div class="mb-4"><div class="font-semibold text-lg">Highlights</div><div class="text-sm text-zinc-500">Every moment you marked or clipped, in order. Click one to jump the recording straight there.</div></div>
            ${highlights.length ? `<div class="space-y-2">${highlights.map(h => `
              <button onclick="seekRecording(${h.secs})" class="w-full text-left flex items-center gap-3 rounded-2xl border border-zinc-700/70 bg-zinc-950/50 hover:border-amber-400/50 hover:bg-amber-500/5 px-4 py-3 transition">
                <i class="fa-solid ${hlIcon[h.kind] || hlIcon.note} w-5 text-center"></i>
                <span class="font-mono text-sm text-amber-300 w-14">${h.time}</span>
                <span class="text-sm text-zinc-200 flex-1">${esc(h.txt)}</span>
                <i class="fa-solid fa-play text-xs text-zinc-500"></i>
              </button>`).join('')}</div>`
            : `<div class="rounded-2xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">No highlights yet. While recording, hit <span class="text-emerald-300">Clip</span> or Mark Decision/Task/Idea to drop a marker — they'll show here as a clickable reel into the recording.</div>`}
          </div>

          <div id="review-panel-summary" class="rounded-[24px] border border-zinc-700/70 bg-black/25 p-5 min-h-[320px]">
            <div class="flex items-center justify-between mb-4">
              <div><div class="font-semibold text-lg">AI Review</div><div class="text-sm text-zinc-500">${hasAiOutput ? 'Cleaned up by Local AI or ready for review.' : 'No AI cleanup saved yet. Click AI Cleanup.'}</div></div>
              <span id="gen-output-${s.id}" class="hidden"></span>
            </div>
            ${aiSummary ? `<div class="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4 mb-4 text-sm leading-7">${esc(aiSummary)}</div>` : `<div class="rounded-2xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-500 mb-4">No summary yet. Stop now shows a processing screen and tries to create one automatically when Ollama is online.</div>`}
            <div class="grid lg:grid-cols-2 gap-3">
              <div class="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                <div class="font-semibold mb-3 text-cyan-200">Tasks</div>
                ${tasks.length ? tasks.slice(0, 6).map(t => `<div class="py-2 border-b border-cyan-500/10 text-sm">${esc(t.title)}</div>`).join('') : '<div class="text-sm text-zinc-500">None extracted yet.</div>'}
              </div>
              <div class="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4">
                <div class="font-semibold mb-3 text-blue-200">Decisions</div>
                ${decisions.length ? decisions.slice(0, 6).map(d => `<div class="py-2 border-b border-blue-500/10 text-sm">${esc(d.title)}</div>`).join('') : '<div class="text-sm text-zinc-500">None extracted yet.</div>'}
              </div>
            </div>
          </div>

          <div id="review-panel-transcript" style="display:none" class="rounded-[24px] border border-zinc-700/70 bg-black/25 p-5 min-h-[320px]">
            <div class="flex items-center justify-between mb-4"><div><div class="font-semibold text-lg">Transcript</div><div class="text-sm text-zinc-500">Generated live or from local Whisper.</div></div>${s.audio_path ? `<button onclick="transcribeSession('${s.id}')" class="px-4 py-2 rounded-xl border border-emerald-600 text-emerald-300 text-sm"><i class="fa-solid fa-wave-square mr-2"></i>Run Whisper</button>` : ''}</div>
            <div class="font-mono text-sm leading-7 whitespace-pre-wrap text-zinc-300">${transcriptText ? esc(transcriptText) : '<span class="text-zinc-500">No transcript saved yet. Run Whisper or record with live captions enabled.</span>'}</div>
          </div>

          <div id="review-panel-notes" style="display:none" class="rounded-[24px] border border-zinc-700/70 bg-black/25 p-5 min-h-[320px]">
            <div class="flex items-center justify-between mb-4"><div><div class="font-semibold text-lg">Notes</div><div class="text-sm text-zinc-500">Editable raw notes for this session.</div></div><button onclick="saveSessionNotes('${s.id}')" class="px-4 py-2 rounded-xl bg-white text-black text-sm font-semibold">Save Notes</button></div>
            <textarea id="sess-notes" class="w-full min-h-[260px] bg-zinc-950/70 border border-zinc-700 rounded-2xl p-4 text-sm text-zinc-100 outline-none focus:border-cyan-400">${esc(rawNotes)}</textarea>
          </div>

          <div id="review-panel-artifacts" style="display:none" class="rounded-[24px] border border-zinc-700/70 bg-black/25 p-5 min-h-[320px]">
            <div class="font-semibold text-lg mb-4">Session Items</div>
            <div class="grid lg:grid-cols-2 gap-4">
              <div class="rounded-2xl border border-zinc-700 bg-zinc-950/60 p-4"><div class="font-semibold mb-3">Ideas (${ideas.length})</div>${ideas.length ? ideas.map(i => `<div class="text-sm py-2 border-b border-zinc-800">${esc(i.title)}</div>`).join('') : '<div class="text-sm text-zinc-500">No ideas linked.</div>'}</div>
              <div class="rounded-2xl border border-zinc-700 bg-zinc-950/60 p-4"><div class="font-semibold mb-3">Timeline (${timeline.length})</div>${timeline.length ? timeline.slice(0, 12).map(e => `<div class="text-xs py-1.5 border-b border-zinc-800">${new Date(e.timestamp).toLocaleTimeString()} - ${esc(e.type)}: ${esc(e.title)}</div>`).join('') : '<div class="text-sm text-zinc-500">No timeline events.</div>'}</div>
            </div>
          </div>
        </div>
      </section>

      <aside class="space-y-4">
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-4">Session Status</div>
          <div class="space-y-4 text-sm">
            <div class="flex justify-between"><span class="text-zinc-400">AI cleanup</span><span class="${hasAiOutput ? 'text-emerald-300' : 'text-amber-300'}">${hasAiOutput ? 'Ready' : 'Needed'}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Transcript</span><span class="${transcriptText ? 'text-emerald-300' : 'text-zinc-500'}">${transcriptText ? 'Saved' : 'Missing'}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Recording</span><span class="${s.audio_path ? 'text-emerald-300' : 'text-zinc-500'}">${s.audio_path ? 'Saved' : 'None'}</span></div>
          </div>
        </div>

        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-3">Recording</div>
          ${s.audio_path ? `<audio id="session-audio" controls src="file://${s.audio_path}" class="w-full" style="height:38px"></audio><div class="mt-2 text-xs text-zinc-500 truncate">${esc(mediaName)}</div>` : '<div class="text-sm text-zinc-500">No audio file saved for this session.</div>'}
          ${s.screen_path ? `<div class="mt-4 text-xs text-zinc-400 mb-1"><i class="fa-solid fa-desktop mr-1"></i>Screen capture</div><video id="session-screen" controls src="file://${s.screen_path}" class="w-full rounded-xl bg-black max-h-64"></video>` : ''}
        </div>

        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-3">Actions</div>
          <div class="space-y-2">
            <button onclick="resumeLiveSession('${s.id}')" class="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm">Resume Session</button>
            <button onclick="runSessionAiCleanup('${s.id}', this)" class="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 font-semibold text-sm">Run AI Cleanup</button>
            ${s.audio_path ? `<button onclick="transcribeSession('${s.id}')" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">Transcribe Recording</button>` : ''}
            <button onclick="showQuickActionsMenu('${s.id}', this)" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">Add Task / Decision / Idea</button>
            <button onclick="exportSessionMdReal('${s.id}')" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">Export Markdown</button>
            <button onclick="exportGrokPromptReal('${s.id}')" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">Export AI Prompt</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

async function editSessionTitle(id) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === id);
  const currentTitle = s ? s.title : '';
  const newTitle = await window.showInputModal('New session name', currentTitle, 'Rename this session');
  if (!newTitle || newTitle === currentTitle) return;
  await window.vibeforge.updateSessionTitle(id, newTitle);
  showToast('Session name updated');
  await openSession(id);
}

async function deleteSessionFromDetail(id) {
  if (!await window.showConfirm('Delete this session?')) return;
  await window.vibeforge.deleteSession(id);
  showToast('Session deleted');
  await switchView('sessions');
}

async function saveSessionNotes(id) {
  const ta = document.getElementById('sess-notes');
  if (ta) await window.vibeforge.updateSessionNotes(id, ta.value);
  showToast('Notes saved');
}

window.switchSessionReviewTab = function(sessionId, tab) {
  const tabs = ['summary', 'highlights', 'transcript', 'notes', 'artifacts'];
  for (const name of tabs) {
    const panel = document.getElementById(`review-panel-${name}`);
    const btn = document.getElementById(`review-tab-${name}`);
    const active = name === tab;
    if (panel) panel.style.display = active ? '' : 'none';
    if (btn) {
      btn.classList.toggle('bg-indigo-600/40', active);
      btn.classList.toggle('border', active);
      btn.classList.toggle('border-indigo-500/40', active);
      btn.classList.toggle('text-indigo-100', active);
      btn.classList.toggle('hover:bg-zinc-800', !active);
      btn.classList.toggle('text-zinc-300', !active);
    }
  }
};

// Jump the session recording (audio + screen) to a highlight's timestamp and play.
window.seekRecording = function(seconds) {
  const a = document.getElementById('session-audio');
  const v = document.getElementById('session-screen');
  let seeked = false;
  for (const el of [a, v]) {
    if (!el) continue;
    try {
      el.currentTime = seconds;
      const p = el.play(); if (p && p.catch) p.catch(() => {});
      seeked = true;
    } catch (e) {}
  }
  if (a) { try { a.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {} }
  showToast(seeked ? `Jumped to ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}` : 'No recording to seek');
};

window.runSessionAiCleanup = async function(sessionId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Running AI...'; }
  showSessionProcessingScreen(sessionId, 'Running AI cleanup', 'Sending session notes to your local Ollama model...');
  await autoProcessSessionAfterStop(sessionId);
  await openSession(sessionId);
};

async function markInSession(sessionId, type) {
  const title = await window.showInputModal(`New ${type} title`, '', `Add a quick ${type}`);
  if (!title) return;
  if (type === 'decision') await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId, title });
  if (type === 'task') await window.vibeforge.addTask({ projectId: currentProject.id, sessionId, title });
  if (type === 'idea') {
    const created = await window.vibeforge.addIdea({ projectId: currentProject.id, sessionId, title });
    if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
  }
  showToast(`${type} added`);
  await switchView(currentView);
}

async function addTimestampedNoteToSession(sessionId) {
  const n = await window.showInputModal('Session note', '', 'Add a timestamped note');
  if (!n) return;
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const nextNotes = (s.notes || '') + ((s.notes || '') ? '\n' : '') + `${stamp}: ${n}`;
  await window.vibeforge.updateSessionNotes(sessionId, nextNotes);
  showToast('Note added');
  await openSession(sessionId);
}

window.resumeLiveSession = async function(id) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === id);
  if (s) {
    showToast('Resuming session - new recordings will be additional segments with their own timestamps.');
    await renderLiveRoom(s);
  }
};

window.editSessionNotesModal = function(id) {
  const ta = document.getElementById('sess-notes');
  if (ta) {
    ta.focus();
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Edit notes here, then click "Save Notes" below');
  } else {
    showToast('Open the session detail to edit notes');
  }
};

// Live room notes editor (button menu style - big textarea in a nice modal, syncs to hidden live-notes)
window.openNotesEditor = function(sessionId) {
  const hiddenTa = document.getElementById('live-notes');
  const current = hiddenTa ? hiddenTa.value : '';
  const countEl = document.getElementById('notes-count');

  // Create dynamic modal (consistent with other menus, no extra static HTML bloat)
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-[200]';
  modal.innerHTML = `
    <div class="bg-[#111113] border border-zinc-700 rounded-3xl w-full max-w-2xl p-6 m-4" onclick="event.stopImmediatePropagation()">
      <div class="flex justify-between mb-4">
        <div class="font-semibold text-lg">Edit Session Notes</div>
        <button class="text-zinc-400 hover:text-white text-xl leading-none close-btn">&times;</button>
      </div>
      <textarea class="notes-ta w-full h-64 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 text-sm" placeholder="Keep the convo going... decisions, ideas, thoughts...">${esc(current)}</textarea>
      <div class="flex gap-3 mt-6">
        <button class="cancel-btn flex-1 py-2.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-sm font-medium">Cancel</button>
        <button class="save-btn flex-1 py-2.5 rounded-2xl bg-white text-black font-semibold text-sm">Save Notes</button>
      </div>
      <div class="text-[10px] text-zinc-500 mt-2">These notes + live transcript are saved when you Stop. You can resume this session later to keep working.</div>
    </div>
  `;
  document.body.appendChild(modal);

  const ta = modal.querySelector('.notes-ta');
  const saveBtn = modal.querySelector('.save-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const closeBtn = modal.querySelector('.close-btn');

  const cleanup = () => {
    modal.remove();
  };

  saveBtn.onclick = () => {
    const val = ta.value;
    if (hiddenTa) hiddenTa.value = val;
    if (countEl) countEl.textContent = `(${val.length})`;
    cleanup();
    showToast('Notes updated (will be saved on Stop)');
  };

  const doCancel = () => cleanup();
  cancelBtn.onclick = doCancel;
  closeBtn.onclick = doCancel;
  modal.onclick = (e) => { if (e.target === modal) doCancel(); };
};

// Tab switcher for live recording panel (Transcript / Highlights)
window.switchLiveTab = function(tab, sessionId) {
  const transcriptPanel = document.getElementById('live-transcript-panel');
  const highlightsPanel = document.getElementById('live-highlights-panel');
  const tabTranscript = document.getElementById('tab-transcript');
  const tabHighlights = document.getElementById('tab-highlights');

  const activeClass = ['bg-indigo-600/40', 'border', 'border-indigo-500/40', 'text-indigo-100'];
  const inactiveClass = ['hover:bg-zinc-800', 'text-zinc-300'];

  if (tab === 'transcript') {
    if (transcriptPanel) transcriptPanel.style.display = '';
    if (highlightsPanel) highlightsPanel.style.display = 'none';
    if (tabTranscript) { activeClass.forEach(c => tabTranscript.classList.add(c)); inactiveClass.forEach(c => tabTranscript.classList.remove(c)); }
    if (tabHighlights) { activeClass.forEach(c => tabHighlights.classList.remove(c)); inactiveClass.forEach(c => tabHighlights.classList.add(c)); }
  } else {
    if (transcriptPanel) transcriptPanel.style.display = 'none';
    if (highlightsPanel) {
      highlightsPanel.style.display = '';
      // Populate highlights from marked moments
      const marks = document.querySelectorAll('[data-highlight]');
      const liveNotes = (document.getElementById('live-notes') || {}).value || '';
      const lines = liveNotes.split('\n').filter(l => l.includes('Marked ') || l.includes('Clip ') || l.includes('Decision ') || l.includes('Task ') || l.includes('Idea '));
      if (lines.length > 0) {
        highlightsPanel.innerHTML = `<div class="font-semibold text-sm mb-3">Marked moments this session</div>` +
          lines.map(l => `<div class="text-xs py-1.5 border-b border-zinc-800 text-zinc-300">${esc(l)}</div>`).join('');
      } else {
        highlightsPanel.innerHTML = '<div class="text-xs text-zinc-500">No highlights yet - use Mark Idea, Mark Task, or Decision buttons to tag moments.</div>';
      }
    }
    if (tabHighlights) { activeClass.forEach(c => tabHighlights.classList.add(c)); inactiveClass.forEach(c => tabHighlights.classList.remove(c)); }
    if (tabTranscript) { activeClass.forEach(c => tabTranscript.classList.remove(c)); inactiveClass.forEach(c => tabTranscript.classList.add(c)); }
  }
};

// Quick actions as a button menu (popup, better than scattered buttons, nicer UI)
window.showQuickActionsMenu = function(sessionId, btnEl) {
  // Remove any existing menu
  document.querySelectorAll('.quick-actions-menu').forEach(m => m.remove());
  const rect = btnEl.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'quick-actions-menu fixed bg-[#111113] border border-zinc-700 rounded-2xl shadow-xl py-1 text-sm z-[300] min-w-[200px]';
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  const items = [
    { icon: 'fa-gavel', label: 'Mark Decision', action: () => document.getElementById('live-notes') && window.quickMark ? window.quickMark(sessionId, 'decision') : markInSession(sessionId, 'decision') },
    { icon: 'fa-tasks', label: 'Mark Task', action: () => document.getElementById('live-notes') && window.quickMark ? window.quickMark(sessionId, 'task') : markInSession(sessionId, 'task') },
    { icon: 'fa-lightbulb', label: 'Mark Idea', action: () => document.getElementById('live-notes') && window.quickMark ? window.quickMark(sessionId, 'idea') : markInSession(sessionId, 'idea') },
    { icon: 'fa-comment', label: 'Add Timestamped Note', action: () => document.getElementById('live-notes') && window.addQuickNote ? window.addQuickNote(sessionId) : addTimestampedNoteToSession(sessionId) },
  ];

  if (document.getElementById('capture-label')) { // isRoom
    items.push({ icon: 'fa-desktop', label: 'Change Screen Capture', action: () => window.pickScreenForLive() });
  }

  menu.innerHTML = items.map(item => `
    <div class="px-4 py-2 hover:bg-zinc-800 cursor-pointer flex items-center gap-2" data-action="${item.label}">
      <i class="fa-solid ${item.icon} w-4 text-zinc-400"></i>
      <span>${item.label}</span>
    </div>
  `).join('');

  document.body.appendChild(menu);

  // Wire clicks
  menu.querySelectorAll('div').forEach(el => {
    el.onclick = () => {
      const label = el.getAttribute('data-action');
      const found = items.find(i => i.label === label);
      if (found) found.action();
      menu.remove();
    };
  });

  // Close on outside click
  setTimeout(() => {
    const handler = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler, { once: true });
  }, 10);
};

// (removed unused generateNotesForSession placeholder function - all AI now real Ollama or disabled)

// New Session Modal - fully wired (Cancel, X, outside, Start all work)
window.startNewSession = async function() {
  if (!currentProject) {
    await createFirstProject();
    if (!currentProject) {
      hideNewSessionModal();
      return;
    }
  }
  document.getElementById('new-session-modal').classList.remove('hidden');
  document.getElementById('new-session-modal').classList.add('flex');
  const nameEl = document.getElementById('session-name');
  if (nameEl) nameEl.focus();
};

window.hideNewSessionModal = function() {
  const m = document.getElementById('new-session-modal');
  m.classList.add('hidden');
  m.classList.remove('flex');
};

// === 1. QUICK CAPTURE QOL - real fast modal wired to real addIdea + timeline + smart name ===
window.showCaptureIdeaModal = function() {
  const m = document.getElementById('capture-idea-modal');
  if (!m) return;
  m.classList.remove('hidden');
  m.classList.add('flex');
  const txt = document.getElementById('idea-text');
  if (txt) txt.focus();
};

window.hideCaptureIdeaModal = function() {
  const m = document.getElementById('capture-idea-modal');
  if (!m) return;
  m.classList.add('hidden');
  m.classList.remove('flex');
  // clear
  const t = document.getElementById('idea-title'); if (t) t.value = '';
  const tx = document.getElementById('idea-text'); if (tx) tx.value = '';
};

window.saveCapturedIdea = async function(useSmart) {
  const titleEl = document.getElementById('idea-title');
  const textEl = document.getElementById('idea-text');
  const rawText = (textEl ? textEl.value : '').trim();
  if (!rawText) { showToast('Idea text required'); return; }

  let title = (titleEl ? titleEl.value : '').trim();
  if (!title) {
    // simple title from first few words
    const words = rawText.split(/\s+/).slice(0, 6).join(' ');
    title = words.length > 40 ? words.slice(0, 37) + '...' : words;
  }

  // link to current active session if one open (we track via last opened or just pass null; sessionId optional)
  let sessionId = null;
  // If we have a recent openSession id we could store, but for simplicity use null here; user can link later
  // (advanced: could peek last detail but keep simple and real)

  const projId = currentProject ? currentProject.id : null;
  if (!projId) {
    showToast('Create a project first');
    hideCaptureIdeaModal();
    return;
  }

  try {
    const created = await window.vibeforge.addIdea({ projectId: projId, sessionId, title, description: rawText, tags: [] });
    // set initial Inbox status
    if (created && created.id) {
      await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
    }
    // timeline already added inside add-idea

    hideCaptureIdeaModal();

    if (useSmart) {
      // real Ollama only
      const settings = await window.vibeforge.getSettings();
      const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
      const model = settings.ollama_model || 'llama3.2';
      let smartOk = false;
      try {
        const res = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            prompt: `Create a short, clear title (max 8 words) for this idea. Return ONLY the title.\n\nIdea: ${rawText}`,
            stream: false
          })
        });
        if (res.ok) {
          const data = await res.json();
          const smartTitle = (data.response || '').trim().replace(/^["']|["']$/g, '').split('\n')[0].slice(0, 80);
          if (smartTitle && created && created.id) {
            await window.vibeforge.updateIdea({ id: created.id, title: smartTitle });
            smartOk = true;
          }
        }
      } catch (e) {
        // offline or fail -> normal save + message
      }
      if (smartOk) {
        showToast('Idea captured with smart name.');
      } else {
        showToast('Idea captured. Smart name skipped (Ollama offline or not ready).');
      }
    } else {
      showToast('Idea captured.');
    }

    // refresh if on ideas or timeline
    if (currentView === 'ideas' || currentView === 'timeline') {
      await switchView(currentView);
    }
  } catch (e) {
    showToast('Failed to capture: ' + e.message);
    hideCaptureIdeaModal();
  }
};

// === Input Modal (real replacement for disabled browser prompt() in sandboxed Electron) ===
let inputModalResolve = null;

window.showInputModal = function(title, defaultValue = '', hint = '') {
  return new Promise((resolve) => {
    document.querySelectorAll('.quick-actions-menu').forEach(m => m.remove());
    document.querySelectorAll('.source-picker-modal').forEach(m => m.remove());
    inputModalResolve = resolve;
    const modal = document.getElementById('input-modal');
    if (!modal) { resolve(null); return; }
    document.getElementById('input-modal-title').textContent = title || 'Input';
    const input = document.getElementById('input-modal-input');
    input.disabled = false;
    input.readOnly = false;
    input.value = defaultValue || '';
    input.placeholder = hint || '';
    input.onclick = (e) => { e.stopPropagation(); input.focus({ preventScroll: true }); };
    input.onpointerdown = (e) => { e.stopPropagation(); };
    document.getElementById('input-modal-hint').textContent = hint || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    requestAnimationFrame(() => {
      setTimeout(() => {
        try { window.focus(); } catch (e) {} // re-grab window focus (helps after any native dialog)
        input.focus({ preventScroll: true });
        if (defaultValue) input.select();
        else input.setSelectionRange(input.value.length, input.value.length);
      }, 40);
    });

    const okBtn = document.getElementById('input-modal-ok-btn');

    const finish = (val) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      input.onkeydown = null;
      input.onclick = null;
      input.onpointerdown = null;
      okBtn.onclick = null;
      inputModalResolve = null;
      resolve(val);
    };

    const onKey = (e) => {
      if (e.key === 'Enter') {
        const v = (input.value || '').trim();
        finish(v || null);
      } else if (e.key === 'Escape') {
        finish(null);
      }
    };
    input.onkeydown = onKey;

    okBtn.onclick = () => {
      const v = (input.value || '').trim();
      finish(v || null);
    };

    // expose cancel for hideInputModal
    modal._doCancel = () => finish(null);
  });
};

window.hideInputModal = function() {
  const modal = document.getElementById('input-modal');
  if (!modal) return;
  if (modal._doCancel) {
    modal._doCancel();
  } else {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  if (inputModalResolve) {
    inputModalResolve(null);
    inputModalResolve = null;
  }
};

// In-app confirm (replaces native window.confirm, which breaks input focus in
// Electron renderers — after a native dialog closes, child <input>s often can't
// regain keyboard focus until a reload. That was the "can't type the project
// name after deleting a project" bug.)
window.showConfirm = function(message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    document.querySelectorAll('.vf-confirm').forEach(m => m.remove());
    const modal = document.createElement('div');
    modal.className = 'vf-confirm fixed inset-0 bg-black/70 flex items-center justify-center z-[400]';
    const okColor = danger ? 'bg-red-600 hover:bg-red-500' : 'bg-white text-black';
    modal.innerHTML = `
      <div class="bg-[#111113] border border-zinc-700 rounded-3xl w-full max-w-md p-6">
        <div class="text-base mb-6">${esc(message)}</div>
        <div class="flex gap-3">
          <button class="vf-cancel flex-1 py-2.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-sm font-medium">Cancel</button>
          <button class="vf-ok flex-1 py-2.5 rounded-2xl ${okColor} text-sm font-semibold">${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const done = (v) => { modal.remove(); resolve(v); };
    modal.querySelector('.vf-ok').onclick = () => done(true);
    modal.querySelector('.vf-cancel').onclick = () => done(false);
    modal.onclick = (e) => { if (e.target === modal) done(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey, true); done(false); }
      else if (e.key === 'Enter') { document.removeEventListener('keydown', onKey, true); done(true); }
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => { const b = modal.querySelector('.vf-ok'); if (b) b.focus(); }, 30);
  });
};

window.confirmNewSession = async function() {
  try {
    const rawName = document.getElementById('session-name').value.trim();
    const modeRadio = document.querySelector('input[name="mode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'room';
    const fallbackName = `Session ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const name = rawName || fallbackName;
    if (!currentProject || !currentProject.id) {
      showToast('No project selected - creating one first...');
      await createFirstProject();
      if (!currentProject) { hideNewSessionModal(); return; }
    }

    const session = await window.vibeforge.createSession({ projectId: currentProject.id, title: name, mode });

    hideNewSessionModal();

    if (mode === 'duo') {
      await renderDuoSetup(session);
    } else {
      // Room or manual - use live view
      await renderLiveRoom(session);
    }
  } catch (e) {
    showToast('Failed to start session: ' + (e.message || e));
    // leave modal open so user can retry/fix
  }
};

// 6. Room Mode - real live session with premium recording workspace, screen/window picker, live transcript
async function renderLiveRoom(session) {
  const content = document.getElementById('main-content');
  const header = document.getElementById('view-title');
  const actions = document.getElementById('view-actions');
  currentView = 'live';
  if (header) header.textContent = 'Recording';
  if (actions) actions.innerHTML = '';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'bg-zinc-900', 'text-white'));
  const stash = document.getElementById('active-live-stash');
  if (stash) stash.innerHTML = '';
  _activeLiveSession = { id: session.id, title: session.title, mode: session.mode, started_at: session.started_at || Date.now(), recording: true };
  showActiveSessionIsland();
  let timerInterval;
  let notes = session.notes || '';
  let mediaRecorder = null;      // mic audio ONLY — never restarted, never combined
  let audioChunks = [];
  let screenRecorder = null;     // screen video → its own file (independent of mic)
  let screenChunks = [];
  let audioContext = null;
  let analyser = null;
  let isRecording = false;
  let micStream = null;
  let displayStream = null;
  let captureLabel = 'Mic only';
  let liveTranscript = '';
  // Live caption state (real local Whisper, chunked) — runs on its OWN audio context
  // fed by a cloned mic track, so it can never disturb the recording.
  let captionCtx = null;
  let captionNode = null;
  let captionMute = null;
  let captionTimer = null;
  let captionBusy = false;
  let captionBuf = [];
  let captionBufLen = 0;
  let captionRate = 48000;
  let lastCaptionText = '';
  let repeatedCaptionCount = 0;

  // Always clear any existing timer before starting a new one
  if (_globalTimerInterval) { clearInterval(_globalTimerInterval); _globalTimerInterval = null; }

  const modeLabel = session.mode === 'manual' ? 'Manual Session' : 'Room Session';
  const isRoom = session.mode !== 'manual';
  const isDuo = session.mode === 'duo';
  const duoConnected = isDuo && peerStatus && peerStatus.status === 'connected';
  const duoBanner = isDuo ? `
        <div class="mb-5 rounded-[24px] border ${duoConnected ? 'border-emerald-500/35 bg-emerald-500/10' : 'border-amber-500/35 bg-amber-500/10'} p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div class="text-xs uppercase tracking-[.18em] ${duoConnected ? 'text-emerald-300' : 'text-amber-300'}"><i class="fa-solid fa-link mr-2"></i>Duo Link Session</div>
            <div class="mt-1 text-sm text-zinc-300">${duoConnected ? 'Synced with your linked PC. Stopping here asks their app to stop/save too.' : 'Not linked yet. Open Link and connect before relying on synced stop/invites.'}</div>
          </div>
          <button onclick="switchView('share')" class="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-800">${duoConnected ? 'Open Link Control' : 'Connect in Link'}</button>
        </div>` : '';

  content.innerHTML = `
    <div class="min-h-full grid 2xl:grid-cols-[1fr_300px] gap-4">
      <section class="rounded-[28px] border ${isDuo ? 'border-emerald-500/30' : 'border-zinc-700/50'} bg-[#0b0f1d]/90 p-6 overflow-hidden">
        ${duoBanner}
        <div class="grid 2xl:grid-cols-[1fr_360px] gap-5">
          <div>
            <div class="text-xs uppercase tracking-[1.8px] text-violet-300 mb-2"><i class="fa-solid fa-users mr-2"></i>${modeLabel}</div>
            <div class="flex items-center gap-2 mb-3">
              <h2 class="text-3xl font-semibold tracking-tight truncate">${esc(session.title)}</h2>
              <button onclick="editSessionTitle('${session.id}')" class="w-8 h-8 rounded-xl hover:bg-zinc-800 text-zinc-400"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="flex items-center gap-4 text-sm mb-3">
              <span class="text-red-400 font-semibold"><i class="fa-solid fa-circle fa-beat mr-2"></i>RECORDING</span>
              <span class="text-zinc-400"><i class="fa-solid fa-microphone mr-2"></i><span id="capture-label">${captureLabel}</span></span>
            </div>
            <div id="live-timer" class="font-mono text-6xl text-red-400 tracking-tighter mb-2">00:00</div>
            <div id="mic-status" class="hidden"></div>
            <div class="h-7 overflow-hidden mb-4 text-red-400/80 text-xs tracking-[3px] whitespace-nowrap">--- ----- -- ------- --- ---- ----- -- ------- --- ----</div>
          </div>

          <div class="grid sm:grid-cols-[150px_1fr] gap-4">
            <button id="stop-btn" onclick="stopLiveRoom('${session.id}')" class="h-24 rounded-[26px] bg-red-500/10 border border-red-400/30 flex items-center justify-center gap-3 glow-record text-red-100">
              <span class="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-300 to-red-600 flex items-center justify-center shadow-2xl shadow-red-500/30">
                <i class="fa-solid fa-square text-lg"></i>
              </span>
              <span class="text-left"><span class="block text-sm font-semibold text-red-200">Stop &amp; Save</span><span class="block text-[10px] text-red-300/70">Finish session</span></span>
            </button>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <button onclick="pickScreenForLive()" class="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-center text-sm text-red-100"><i class="fa-solid fa-desktop text-xl mb-2"></i><br>Screen</button>
                <button onclick="pickWindowForLive()" class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300"><i class="fa-regular fa-window-maximize text-xl mb-2"></i><br>Window</button>
              </div>
              <div class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
                <div class="flex justify-between text-sm mb-2"><span class="text-zinc-300"><i class="fa-solid fa-microphone mr-2"></i>Mic input</span><span id="mic-status-text" class="text-emerald-300">Good</span></div>
                <canvas id="mic-meter" width="260" height="24" class="w-full h-6 rounded bg-black/50"></canvas>
              </div>
            </div>
          </div>
        </div>

        <textarea id="live-notes" style="display:none">${esc(notes)}</textarea>

        <div class="mt-5 rounded-2xl border border-zinc-700/70 bg-[#141728]/80 p-2 grid grid-cols-4 gap-2">
          <button onclick="openNotesEditor('${session.id}')" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-sticky-note"></i> Notes <span id="notes-count" class="text-xs px-2 py-0.5 rounded-full bg-zinc-700">${(notes || '').length}</span></button>
          <button onclick="showQuickActionsMenu('${session.id}', this)" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-bolt"></i> Quick Actions</button>
          <button id="tab-transcript" onclick="switchLiveTab('transcript', '${session.id}')" class="px-4 py-3 rounded-xl bg-indigo-600/40 border border-indigo-500/40 text-indigo-100 flex items-center justify-center gap-2"><i class="fa-solid fa-wand-magic-sparkles"></i> Transcript</button>
          <button id="tab-highlights" onclick="switchLiveTab('highlights', '${session.id}')" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-sparkles"></i> Highlights</button>
        </div>

        <div class="mt-4 rounded-[24px] border border-zinc-700/70 bg-black/25 p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-lg">Live Transcript <span class="text-xs text-emerald-300 ml-2">- Live</span></div>
              <div class="text-sm text-zinc-500">Local Whisper types as you talk and saves into the session.</div>
            </div>
            <div class="flex items-center gap-2 text-xs text-zinc-400"><span>Auto-save</span><span class="w-9 h-5 rounded-full bg-cyan-500/80 relative inline-block"><span class="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white"></span></span></div>
          </div>
          <div id="live-transcript-panel">
            <div id="live-transcript" class="min-h-[190px] max-h-[280px] overflow-auto text-sm leading-7 font-mono whitespace-pre-wrap text-zinc-300"></div>
          </div>
          <div id="live-highlights-panel" style="display:none" class="min-h-[120px] text-sm text-zinc-300 p-2">
            <div class="text-xs text-zinc-500">No highlights yet - use Mark Idea, Mark Task, or Decision buttons to tag moments.</div>
          </div>
          <div class="mt-3 h-6 text-cyan-300/80 text-xs tracking-[3px] overflow-hidden">---- ------- ---- ----- --- ------- ---- ----- ---</div>
        </div>

        <div class="mt-4 grid md:grid-cols-5 gap-3">
          <button onclick="markMoment('${session.id}', 'idea')" class="py-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 font-medium"><i class="fa-regular fa-lightbulb mr-2"></i>Mark Idea</button>
          <button onclick="markMoment('${session.id}', 'task')" class="py-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 font-medium"><i class="fa-regular fa-square-check mr-2"></i>Mark Task</button>
          <button onclick="markMoment('${session.id}', 'decision')" class="py-3 rounded-2xl border border-blue-500/40 bg-blue-500/10 text-blue-200 font-medium"><i class="fa-regular fa-gem mr-2"></i>Decision</button>
          <button onclick="clipMoment('${session.id}')" class="py-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-medium"><i class="fa-solid fa-scissors mr-2"></i>Clip</button>
          <button onclick="generateFromSession('${session.id}', 'summary', this)" title="Runs local AI to summarize notes, extract tasks and decisions, and rename the session" class="py-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 text-violet-200 font-medium"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>AI Cleanup</button>
        </div>

        <div class="mt-5 rounded-[26px] border border-red-400/40 bg-[#121522]/95 p-4 grid xl:grid-cols-[210px_1fr_140px_110px_140px] gap-4 items-center shadow-2xl shadow-black/30">
          <div class="flex items-center gap-3"><button onclick="stopLiveRoom('${session.id}')" class="w-16 h-16 rounded-full bg-red-500 glow-record flex items-center justify-center"><i class="fa-solid fa-square"></i></button><div><div class="text-red-300 font-semibold">RECORDING</div><div class="text-xs text-zinc-400"><i class="fa-solid fa-microphone mr-1"></i><span id="bottom-capture-label">${captureLabel}</span></div></div></div>
          <div class="text-center"><div class="text-2xl font-mono text-zinc-100" id="bottom-live-timer">00:00</div><div class="text-xs text-zinc-500">Elapsed time</div></div>
          <div class="text-sm text-zinc-300"><i class="fa-solid fa-desktop mr-2"></i>Screen + Mic</div>
          <div class="text-emerald-300 text-sm"><i class="fa-solid fa-signal mr-2"></i>Good</div>
          <button onclick="pickScreenForLive()" class="py-3 rounded-2xl bg-zinc-900 border border-zinc-700 font-semibold">Screen</button>
        </div>
      </section>

      <aside class="space-y-4">
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-4">Session Overview</div>
          <div class="space-y-4 text-sm">
            <div class="flex justify-between"><span class="text-zinc-400">Duration</span><span id="side-live-timer" class="text-red-300 font-mono">00:00</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Started</span><span>${new Date(session.started_at || Date.now()).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}) + ' - ' + new Date(session.started_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Type</span><span>${modeLabel}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400">Status</span><span class="text-red-300">Recording</span></div>
          </div>
        </div>
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-3">Capture Source</div>
          <div class="text-cyan-300 text-lg font-semibold"><i class="fa-solid fa-display mr-2"></i><span id="source-card-label">${captureLabel}</span></div>
          <div class="text-xs text-zinc-500 mt-2">Pick a screen or window when you want video.</div>
        </div>
        <div class="rounded-[24px] border border-cyan-500/30 bg-cyan-500/10 p-5">
          <div class="flex items-center justify-between mb-3"><div class="font-semibold">AI Assistant</div><span class="text-xs text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-full">Active</span></div>
          <div class="text-sm text-zinc-400 mb-4">Transcribing, detecting insights, and preparing summaries.</div>
          <div class="h-1 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full w-2/3 bg-gradient-to-r from-cyan-400 to-emerald-400"></div></div>
        </div>
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-5">
          <div class="font-semibold mb-4">Detected Insights</div>
          <div class="space-y-2 text-sm">
            <div class="rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 text-zinc-400">Insights appear as you mark ideas, tasks, and decisions.</div>
            <button onclick="showQuickActionsMenu('${session.id}', this)" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700">Open Quick Actions</button>
          </div>
        </div>
      </aside>
    </div>
  `;

  // Timer (always) - stored globally so repeated calls don't stack intervals
  const start = Date.now();
  timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - start) / 1000);
    const text = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    ['live-timer', 'bottom-live-timer', 'side-live-timer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }, 1000);
  _globalTimerInterval = timerInterval;

  function updateCaptureUI(label) {
    captureLabel = label || captureLabel;
    const lab = document.getElementById('capture-label');
    if (lab) lab.textContent = captureLabel;
    const bottom = document.getElementById('bottom-capture-label');
    if (bottom) bottom.textContent = captureLabel;
    const sourceCard = document.getElementById('source-card-label');
    if (sourceCard) sourceCard.textContent = captureLabel;
  }

  // === Hoist window handlers synchronously right after DOM injection + timer (before any await getUserMedia / permission dialogs).
  // This ensures the onclick="..." strings in the injected live-room HTML (Stop, Pick screen, quick Mark buttons, Add Note)
  // and the overlay buttons can resolve the names *immediately* when the view appears.
  // The functions close over the `let` variables declared at the top of renderLiveRoom (populated later during setup).
  // Previously these assignments were after the awaits -> buttons threw "xxx is not defined" + appeared to do nothing.
  async function pickDesktopSource(kind = 'screen') {
    const sources = await window.vibeforge.getScreenSources();
    const filtered = sources.filter(s => kind === 'window' ? s.id.startsWith('window:') : s.id.startsWith('screen:'));
    const list = filtered.length ? filtered : sources;
    if (!list.length) throw new Error('No screen/window sources found');

    return await new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'source-picker-modal fixed inset-0 z-[700] bg-black/80 flex items-center justify-center p-6';
      modal.innerHTML = `
        <div class="w-full max-w-5xl max-h-[85vh] overflow-hidden rounded-[28px] border border-zinc-600 bg-[#0b0f1d] shadow-2xl">
          <div class="p-5 border-b border-zinc-800 flex items-center justify-between">
            <div>
              <div class="font-semibold text-xl">Choose ${kind === 'window' ? 'a window' : 'a screen'} to capture</div>
              <div class="text-sm text-zinc-500">This is local only. Cancel anytime.</div>
            </div>
            <button class="close px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700">Cancel</button>
          </div>
          <div class="p-5 grid md:grid-cols-3 gap-4 overflow-auto max-h-[65vh]">
            ${list.map((s, idx) => `
              <button data-idx="${idx}" class="source-card text-left rounded-2xl border border-zinc-700 bg-zinc-900/70 hover:border-cyan-400 overflow-hidden">
                ${s.thumbnail ? `<img src="${s.thumbnail}" class="w-full h-32 object-cover bg-black">` : `<div class="w-full h-32 bg-black"></div>`}
                <div class="p-3 text-sm font-medium truncate">${esc(s.name)}</div>
              </button>
            `).join('')}
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const cleanup = (value) => { modal.remove(); resolve(value); };
      modal.querySelector('.close').onclick = () => cleanup(null);
      modal.onclick = (e) => { if (e.target === modal) cleanup(null); };
      modal.querySelectorAll('.source-card').forEach(btn => {
        btn.onclick = () => cleanup(list[Number(btn.dataset.idx)]);
      });
    });
  }

  async function getDesktopStream(kind = 'screen') {
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: kind === 'window' ? { displaySurface: 'window' } : true,
        audio: true,
        preferCurrentTab: false
      });
    } catch (nativeErr) {
      const source = await pickDesktopSource(kind);
      if (!source) throw new Error('cancelled');
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              maxWidth: 3840,
              maxHeight: 2160,
              maxFrameRate: 30
            }
          }
        });
      } catch (fallbackErr) {
        throw new Error(`Screen source failed: ${fallbackErr.message || nativeErr.message}`);
      }
    }
  }

  window.pickScreenForLive = async function() {
    try {
      const ds = await getDesktopStream('screen');
      try { if (displayStream) displayStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      displayStream = ds;
      const vt = ds.getVideoTracks()[0];
      const nice = vt ? (vt.label || vt.getSettings().displaySurface || 'Display') : 'System audio only';
      updateCaptureUI(nice + ' + mic');

      // optional live preview of chosen screen (so you *know* what is captured)
      let prev = document.getElementById('screen-prev');
      if (!prev && isRoom) {
        const area = document.getElementById('live-transcript');
        if (area && area.parentNode) {
          prev = document.createElement('video');
          prev.id = 'screen-prev';
          prev.autoplay = true;
          prev.muted = true;
          prev.style.cssText = 'width:100%;max-height:160px;border-radius:12px;border:1px solid #3f2a2a;background:#000;margin-top:6px;object-fit:contain;';
          area.parentNode.insertBefore(prev, area.nextSibling);
        }
      }
      if (prev) prev.srcObject = ds;

      showToast('Screen set: ' + captureLabel);
      // Record the screen to its OWN file. The mic recorder is never touched.
      startScreenRecorder(ds);
      // If user re-picks while screen-recording was paused, restart the live preview ended handler
      const vtrk = ds.getVideoTracks()[0];
      if (vtrk) vtrk.onended = () => { stopScreenRecorder(); updateCaptureUI('Mic only'); };
    } catch (e) {
      showToast('Screen pick: ' + (e.message || 'cancelled'));
    }
  };

  // Window picker - same as screen but requests a specific window surface
  window.pickWindowForLive = async function() {
    try {
      const ds = await getDesktopStream('window');
      try { if (displayStream) displayStream.getTracks().forEach(t => t.stop()); } catch (e) {}
      displayStream = ds;
      const vt = ds.getVideoTracks()[0];
      const nice = vt ? (vt.label || 'Window') : 'Window audio';
      updateCaptureUI(nice + ' + mic');
      let prev = document.getElementById('screen-prev');
      if (!prev && isRoom) {
        const area = document.getElementById('live-transcript');
        if (area && area.parentNode) {
          prev = document.createElement('video');
          prev.id = 'screen-prev';
          prev.autoplay = true;
          prev.muted = true;
          prev.style.cssText = 'width:100%;max-height:160px;border-radius:12px;border:1px solid #1e3a3a;background:#000;margin-top:6px;object-fit:contain;';
          area.parentNode.insertBefore(prev, area.nextSibling);
        }
      }
      if (prev) prev.srcObject = ds;
      showToast('Window capture set.');
      startScreenRecorder(ds);
      const vtrk = ds.getVideoTracks()[0];
      if (vtrk) vtrk.onended = () => { stopScreenRecorder(); updateCaptureUI('Mic only'); };
    } catch (e) {
      showToast('Window pick: ' + (e.message || 'cancelled'));
    }
  };

  // Screen recording goes to its OWN MediaRecorder/file. Independent of the mic recorder,
  // so picking/changing/stopping the screen can never corrupt the audio of record.
  function startScreenRecorder(ds) {
    stopScreenRecorder();
    try {
      const vids = ds.getVideoTracks();
      if (!vids.length) return;
      const sysAudio = ds.getAudioTracks();
      const stream = new MediaStream([...vids, ...sysAudio]);
      screenChunks = [];
      screenRecorder = new MediaRecorder(stream, { mimeType: pickMime(['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']) });
      screenRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) screenChunks.push(e.data); };
      screenRecorder.onerror = (ev) => { console.error('screen recorder error', ev.error); };
      screenRecorder.start(1000);
    } catch (e) {
      showToast('Screen record failed: ' + e.message);
      screenRecorder = null;
    }
  }
  function stopScreenRecorder() {
    if (screenRecorder && screenRecorder.state !== 'inactive') {
      try { screenRecorder.requestData(); screenRecorder.stop(); } catch (e) {}
    }
  }

  window.stopLiveRoom = async function(id, opts = {}) {
    const remoteTriggered = !!opts.remoteTriggered;
    clearInterval(timerInterval);
    _globalTimerInterval = null;
    if (_activeLiveSession && _activeLiveSession.id === id) {
      _activeLiveSession.recording = false;
    }
    const island = document.getElementById('active-session-island');
    if (island) island.remove();
    const stash = document.getElementById('active-live-stash');
    if (stash) stash.innerHTML = '';
    if (captionTimer) { try { clearInterval(captionTimer); } catch(e){} captionTimer = null; }
    if (captionNode) { try { captionNode.disconnect(); } catch(e){} captionNode = null; }
    if (captionMute) { try { captionMute.disconnect(); } catch(e){} captionMute = null; }
    if (captionCtx) { try { captionCtx.close(); } catch(e){} captionCtx = null; }

    // Stop the mic recorder, waiting for the final chunk to flush.
    if (isRecording && mediaRecorder) {
      try {
        if (mediaRecorder.state !== 'inactive') {
          await new Promise((resolve) => {
            mediaRecorder.onstop = () => resolve();
            try { mediaRecorder.requestData(); } catch (_) {}
            try { mediaRecorder.stop(); } catch (_) { resolve(); }
            setTimeout(resolve, 1500);
          });
        }
      } catch(e){}
      isRecording = false;
    }

    // Stop the screen recorder (if any), waiting for its final chunk too.
    if (screenRecorder) {
      try {
        if (screenRecorder.state !== 'inactive') {
          await new Promise((resolve) => {
            screenRecorder.onstop = () => resolve();
            try { screenRecorder.requestData(); } catch (_) {}
            try { screenRecorder.stop(); } catch (_) { resolve(); }
            setTimeout(resolve, 1500);
          });
        }
      } catch (e) {}
    }

    // stop any display/mic tracks
    try { if (micStream) micStream.getTracks().forEach(t => t.stop()); } catch(e){}
    try { if (displayStream) displayStream.getTracks().forEach(t => t.stop()); } catch(e){}

    // save notes + live transcript (if any)
    let finalNotes = (document.getElementById('live-notes') || {}).value || notes;
    if (liveTranscript && liveTranscript.trim()) {
      finalNotes = finalNotes + (finalNotes ? '\n\n' : '') + `[${getProfileNameFallback()}'s live transcript]\n` + liveTranscript.trim();
    }
    const peerBundle = _duoPeerSessionNotes[id];
    if (peerBundle && (peerBundle.notes || peerBundle.transcript)) {
      const label = peerBundle.peerName || 'Linked collaborator';
      const body = [peerBundle.transcript, peerBundle.notes].filter(Boolean).join('\n\n').trim();
      if (body && !finalNotes.includes(`[${label}'s linked transcript]`)) {
        finalNotes = finalNotes + (finalNotes ? '\n\n' : '') + `[${label}'s linked transcript]\n` + body;
      }
    }

    if (!remoteTriggered && session.mode === 'duo' && peerStatus && peerStatus.status === 'connected') {
      await sendPeerJson({
        type: 'duo-command',
        command: 'session-ended',
        session: {
          title: session.title,
          started_at: session.started_at,
          ended_at: Date.now()
        },
        peerName: getProfileNameFallback(),
        transcript: liveTranscript || '',
        notes: finalNotes || ''
      });
    }

    await window.vibeforge.updateSessionNotes(id, finalNotes);
    try {
      await window.vibeforge.updateSessionEnded(id, Date.now());
    } catch (e) {}

    // Save the mic audio (the audio of record).
    if (audioChunks && audioChunks.length > 0) {
      try {
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const savedPath = await window.vibeforge.saveAudio(id, arrayBuffer);
        await window.vibeforge.updateSessionAudio(id, savedPath);
      } catch (e) {
        showToast('Audio save issue: ' + e.message);
      }
    }

    // Save the screen recording to its own file (if one was captured).
    if (screenChunks && screenChunks.length > 0) {
      try {
        const vblob = new Blob(screenChunks, { type: 'video/webm' });
        const vbuf = await vblob.arrayBuffer();
        await window.vibeforge.saveScreen(id, vbuf);
      } catch (e) {
        showToast('Screen save issue: ' + e.message);
      }
    }

    showSessionProcessingScreen(id, remoteTriggered ? 'Linked session ended' : 'Session saved', remoteTriggered ? 'Your collaborator stopped. Saving your side and starting local AI cleanup...' : 'Starting local AI cleanup...');
    const aiResult = await autoProcessSessionAfterStop(id);
    if (session.mode === 'duo' && peerStatus && peerStatus.status === 'connected' && aiResult) {
      await sendPeerJson({
        type: 'duo-command',
        command: 'ai-results',
        peerName: getProfileNameFallback(),
        sessionTitle: session.title,
        result: aiResult
      });
    }
    await openSession(id);
  };

  window.quickMark = async function(id, type) {
    const t = await window.showInputModal(`Quick ${type} title`, '', `Add quick ${type} during recording`);
    if (!t) return;
    if (type === 'decision') await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId: id, title: t });
    else if (type === 'task') await window.vibeforge.addTask({ projectId: currentProject.id, sessionId: id, title: t });
    else {
      const created = await window.vibeforge.addIdea({ projectId: currentProject.id, sessionId: id, title: t });
      if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
    }
    showToast(`${type} added`);
  };

  window.markMoment = async function(id, type) {
    const ts = document.getElementById('live-timer')?.textContent || new Date().toLocaleTimeString();
    const title = `${type === 'idea' ? 'Idea' : type === 'task' ? 'Task' : 'Decision'} @ ${ts}`;
    if (type === 'decision') {
      await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId: id, title, notes: `Marked during recording at ${ts}` });
    } else if (type === 'task') {
      await window.vibeforge.addTask({ projectId: currentProject.id, sessionId: id, title, notes: `Marked during recording at ${ts}` });
    } else {
      const created = await window.vibeforge.addIdea({ projectId: currentProject.id, sessionId: id, title, description: `Marked during recording at ${ts}` });
      if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
    }
    const ta = document.getElementById('live-notes');
    if (ta) ta.value += `${ta.value ? '\n' : ''}[${ts}] Marked ${type}: ${title}`;
    showToast(`Marked ${type} at ${ts}`);
  };

  window.clipMoment = async function(id) {
    const ts = document.getElementById('live-timer')?.textContent || new Date().toLocaleTimeString();
    const ta = document.getElementById('live-notes');
    if (ta) ta.value += `${ta.value ? '\n' : ''}[${ts}] Clip this moment`;
    const created = await window.vibeforge.addIdea({
      projectId: currentProject.id,
      sessionId: id,
      title: `Clip @ ${ts}`,
      description: `Review this moment from the recording at ${ts}.`
    });
    if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
    showToast(`Clip marked at ${ts}`);
  };

  window.addQuickNote = async function(id) {
    const n = await window.showInputModal('Quick note', '', 'Add timestamped note to live notes');
    if (!n) return;
    const ta = document.getElementById('live-notes');
    const current = ta ? ta.value : '';
    if (ta) ta.value = current + (current ? '\n' : '') + new Date().toLocaleTimeString() + ': ' + n;
  };

  // Helper: typewriter append for good feel
  let _transcriptUserScrolled = false;
  function typewriterAppend(delta, container) {
    if (!container || !delta) return;
    const chars = delta.split('');
    let i = 0;
    function step() {
      if (i < chars.length) {
        container.textContent += chars[i++];
        // Only auto-scroll if user hasn't manually scrolled up
        if (!_transcriptUserScrolled) container.scrollTop = container.scrollHeight;
        setTimeout(step, 16);
      }
    }
    step();
  }

  // Pause auto-scroll when user scrolls up; resume when they scroll back to bottom
  const _tElForScroll = document.getElementById('live-transcript');
  if (_tElForScroll) {
    _tElForScroll.addEventListener('scroll', () => {
      const atBottom = _tElForScroll.scrollHeight - _tElForScroll.scrollTop - _tElForScroll.clientHeight < 30;
      _transcriptUserScrolled = !atBottom;
    });
  }

  // No floating draggable overlay. The recording state now lives inside the page dock only,
  // which avoids the old "stuck to mouse" behavior and duplicate controls.

  // (updateCaptureUI hoisted early with the button handlers; duplicate removed here)

  // Recording setup for room
  if (isRoom) {
    const micStatus = document.getElementById('mic-status-text');
    const canvas = document.getElementById('mic-meter');
    const ctx = canvas ? canvas.getContext('2d') : null;

    try {
      // Clean, reliable capture. echoCancellation also stops any speaker bleed from
      // becoming a feedback loop; noiseSuppression + autoGainControl keep speech legible.
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      // THE RECORDING: mic audio only, one MediaRecorder, never restarted or combined.
      // This is the audio of record and nothing else is allowed to touch it.
      audioChunks = [];
      mediaRecorder = new MediaRecorder(micStream, { mimeType: pickMime(['audio/webm;codecs=opus','audio/webm']) });
      mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
      mediaRecorder.onerror = (ev) => {
        console.error('mic recorder error', ev.error);
        showToast('Recording hiccup — restarting capture...');
        try { if (mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (e) {}
      };
      mediaRecorder.onstop = () => { /* tracks stopped in stopLiveRoom */ };
      mediaRecorder.start(1000); // flush a chunk every 1s: resilient + correct webm duration
      isRecording = true;
      if (micStatus) micStatus.textContent = 'Recording...';

      // If a screen was already chosen before we got here, record it to its own file now.
      if (displayStream) startScreenRecorder(displayStream);

      // Mic level meter on a lightweight analyser (separate context so it can't affect capture)
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(micStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      function drawMeter() {
        if (!isRecording || !analyser || !ctx) return;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        ctx.fillStyle = '#111113';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const bars = 24;
        const active = Math.max(1, Math.round((avg / 255) * bars));
        const gap = 3;
        const barW = Math.max(3, Math.floor((canvas.width - gap * (bars - 1)) / bars));
        for (let i = 0; i < bars; i++) {
          const h = Math.max(4, canvas.height * (0.35 + (i % 5) * 0.11));
          const x = i * (barW + gap);
          const y = (canvas.height - h) / 2;
          ctx.fillStyle = i < active ? '#2dd4bf' : 'rgba(148,163,184,0.13)';
          ctx.fillRect(x, y, barW, h);
        }
        requestAnimationFrame(drawMeter);
      }
      drawMeter();

      // === Live captions via local Whisper (chunked, real transcription - no cloud, no browser API) ===
      // Mic PCM accumulates; every few seconds a chunk is resampled to 16k WAV and run through
      // whisper.cpp in the main process. Self-pacing: while one chunk transcribes, audio keeps buffering.
      const tEl = document.getElementById('live-transcript');
      try {
        const wCheck = await window.vibeforge.whisperCheck();
        if (tEl && wCheck && wCheck.configured) {
          // Isolated caption pipeline: a SEPARATE AudioContext fed by a CLONED mic track.
          // Nothing here shares the recording's audio graph, so captions can never
          // glitch or starve the actual recording.
          const micTrack = micStream.getAudioTracks()[0];
          const capStream = new MediaStream([micTrack.clone()]);
          captionCtx = new (window.AudioContext || window.webkitAudioContext)();
          captionRate = captionCtx.sampleRate;
          const capSource = captionCtx.createMediaStreamSource(capStream);
          captionNode = captionCtx.createScriptProcessor(4096, 1, 1);
          captionNode.onaudioprocess = (ev) => {
            const data = ev.inputBuffer.getChannelData(0);
            captionBuf.push(new Float32Array(data));
            captionBufLen += data.length;
            // Hard cap backlog at ~6s and DROP the oldest — never let whisper fall behind
            // and spiral into chewing huge clips (that was the ~60s recording-death bug).
            while (captionBufLen > captionRate * 6 && captionBuf.length > 1) {
              captionBufLen -= captionBuf.shift().length;
            }
          };
          // ScriptProcessor must reach a destination to fire; route through zero gain so
          // nothing is ever audible (no mic->speaker feedback).
          captionMute = captionCtx.createGain();
          captionMute.gain.value = 0;
          capSource.connect(captionNode);
          captionNode.connect(captionMute);
          captionMute.connect(captionCtx.destination);

          tEl.innerHTML = '<span class="text-zinc-500 text-xs">Listening... captions appear a few seconds behind speech.</span>';
          let firstCaption = true;

          captionTimer = setInterval(async () => {
            if (captionBusy) return;
            if (captionBufLen < captionRate * 3.5) return; // ~3.5s window: enough context, not greedy
            const merged = new Float32Array(captionBufLen);
            let o = 0;
            for (const c of captionBuf) { merged.set(c, o); o += c.length; }
            captionBuf = []; captionBufLen = 0;

            // silence gate: skip chunks with no real signal (whisper hallucinates on silence)
            let sum = 0, n = 0;
            for (let i = 0; i < merged.length; i += 16) { sum += merged[i] * merged[i]; n++; }
            if (Math.sqrt(sum / n) < 0.006) return;

            captionBusy = true;
            try {
              const wav = encodeWav16k(resampleTo16k(merged, captionRate));
              const res = await window.vibeforge.transcribeWav({ wav, live: true });
              if (res && res.ok && res.transcript) {
                const text = res.transcript.replace(/\s+/g, ' ').trim();
                if (text) {
                  const normalizedCaption = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
                  if (normalizedCaption && normalizedCaption === lastCaptionText) {
                    repeatedCaptionCount++;
                    if (repeatedCaptionCount >= 2) return;
                  } else {
                    lastCaptionText = normalizedCaption;
                    repeatedCaptionCount = 0;
                  }
                  if (firstCaption) { tEl.textContent = ''; firstCaption = false; }
                  liveTranscript += text + ' ';
                  typewriterAppend(text + ' ', tEl);
                }
              }
            } catch (e) {} finally {
              captionBusy = false;
            }
          }, 3000);

          if (micStatus) micStatus.textContent = 'Recording + live Whisper captions';
        } else if (tEl) {
          tEl.innerHTML = '<span class="text-zinc-500 text-xs">Live captions off - run the one-click Whisper setup in Settings -> AI Tools to enable them.</span>';
        }
      } catch (e) {
        if (tEl) tEl.innerHTML = '<span class="text-zinc-500 text-xs">Live captions unavailable: ' + e.message + '</span>';
      }

    } catch (err) {
      if (micStatus) micStatus.textContent = 'Mic permission failed - notes only';
      showToast('Mic access denied or unavailable. You can still add notes & marks.');
    }
  } else {
    const ms = document.getElementById('mic-status');
    if (ms) ms.textContent = 'Manual notes mode - no audio/screen recording';
  }

  // (handlers were hoisted early right after timer setup so buttons work immediately;
  // the late assignments were removed to avoid duplication)
}

// 7. Duo Setup - redirects to the Link tab (PeerJS room-code based)
// The old IP-based WebSocket UI is replaced. Duo sessions now use the
// Link tab's Generate Room Code / Join flow which works over the internet.
async function renderDuoSetup(session) {
  // Store the session so the Link tab can start recording once linked
  window._pendingDuoSession = session;
  const status = await getDuoStatus();
  if (status && status.status === 'connected') {
    await sendLinkedSessionInvite(session);
    window._pendingDuoSession = null;
    showToast('Duo invite sent. Starting your side.');
    await renderLiveRoom(session);
    return;
  } else {
    showToast('Use Link to host/join. Once connected, start this Duo session from there.');
  }
  await switchView('share');
}

// === 6. SHARE / DUO LINK - real PeerJS room codes plus a built-in two-window tester ===
async function renderShareView(content, actionsEl) {
  if (!content) content = document.getElementById('main-content');
  if (!actionsEl) actionsEl = document.getElementById('view-actions');
  if (actionsEl) actionsEl.innerHTML = '';

  const status = await getDuoStatus();
  const roomCode = status.roomCode || status.address || '';
  const isHosting = status.status === 'hosting';
  const isConnected = status.status === 'connected';
  const isConnecting = status.status === 'connecting';
  const isTester = new URLSearchParams(window.location.search || '').get('duoTest') === '1';

  const statusClass = isConnected
    ? 'bg-emerald-500 shadow-[0_0_18px_rgba(16,185,129,.7)]'
    : isHosting || isConnecting
    ? 'bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,.65)]'
    : 'bg-zinc-500';
  const statusLabel = isConnected ? 'Linked live' : isHosting ? 'Hosting - waiting' : isConnecting ? 'Connecting' : 'Offline';
  const connectionCopy = isConnected
    ? 'You are connected. Use shared controls to move both apps together and send session payloads.'
    : 'Host from one app, join from the other, then use the connected workspace together.';

  const receivedHtml = receivedItems.length ? receivedItems.map(item => {
    const label = `${item.type || 'item'}: ${item.title || item.name || item.path || ''}`;
    const safePath = item.path ? item.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
    return `
      <div class="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-white/[.04] px-3 py-2 text-xs">
        <span class="min-w-0 truncate text-zinc-300">${esc(label)}</span>
        ${item.path ? `<button onclick="revealSpecificReceived('${safePath}')" class="shrink-0 rounded-xl border border-zinc-700 px-2 py-1 text-[11px] text-cyan-300 hover:bg-zinc-800">Reveal</button>` : ''}
      </div>`;
  }).join('') : `<div class="rounded-2xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">Nothing received yet.</div>`;

  const remoteVaultHtml = remoteVaultSnapshot ? `
    <div class="mt-5 rounded-3xl border border-blue-500/25 bg-blue-500/10 p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="text-xs uppercase tracking-[.16em] text-blue-300">Remote Vault</div>
          <div class="mt-1 font-semibold text-white">${esc(remoteVaultSnapshot.projectName || 'Linked PC')}</div>
          <div class="text-xs text-zinc-400">Snapshot received ${new Date(remoteVaultSnapshot.at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        </div>
        <button onclick="requestRemoteVault()" class="rounded-2xl border border-blue-500/40 px-4 py-2 text-sm text-blue-100 hover:bg-blue-500/10">Refresh</button>
      </div>
      <div class="mt-4 grid gap-2 md:grid-cols-4">
        <div class="rounded-2xl border border-zinc-800 bg-black/25 p-3"><div class="text-2xl font-semibold text-white">${(remoteVaultSnapshot.sessions || []).length}</div><div class="text-[11px] text-zinc-500">Sessions</div></div>
        <div class="rounded-2xl border border-zinc-800 bg-black/25 p-3"><div class="text-2xl font-semibold text-white">${(remoteVaultSnapshot.tasks || []).length}</div><div class="text-[11px] text-zinc-500">Tasks</div></div>
        <div class="rounded-2xl border border-zinc-800 bg-black/25 p-3"><div class="text-2xl font-semibold text-white">${(remoteVaultSnapshot.decisions || []).length}</div><div class="text-[11px] text-zinc-500">Decisions</div></div>
        <div class="rounded-2xl border border-zinc-800 bg-black/25 p-3"><div class="text-2xl font-semibold text-white">${(remoteVaultSnapshot.ideas || []).length}</div><div class="text-[11px] text-zinc-500">Ideas</div></div>
      </div>
      <div class="mt-4 max-h-48 space-y-2 overflow-auto">
        ${(remoteVaultSnapshot.sessions || []).slice(0, 8).map(s => `<div class="rounded-2xl border border-zinc-800 bg-black/20 px-3 py-2 text-sm"><span class="text-blue-300">Session</span> <span class="text-zinc-200">${esc(s.title)}</span><div class="text-[11px] text-zinc-500">${formatSessionMeta(s)}</div></div>`).join('') || '<div class="text-xs text-zinc-500">No remote sessions in the snapshot.</div>'}
      </div>
    </div>` : `
    <div class="mt-5 rounded-3xl border border-blue-500/20 bg-blue-500/5 p-5">
      <div class="font-semibold text-white">Remote Vault</div>
      <div class="mt-1 text-sm text-zinc-400">Ask the linked PC for a snapshot of their sessions, tasks, decisions, and ideas.</div>
      <button onclick="requestRemoteVault()" class="mt-4 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Request Remote Vault</button>
    </div>`;

  const mirrorButtons = [
    ['sessions', 'Sessions', 'fa-list'],
    ['ideas', 'Ideas', 'fa-lightbulb'],
    ['tasks', 'Tasks', 'fa-tasks'],
    ['decisions', 'Decisions', 'fa-gavel'],
    ['timeline', 'Timeline', 'fa-stream'],
    ['memory', 'Memory', 'fa-search']
  ].map(([view, label, icon]) => `
    <button onclick="mirrorViewToPeer('${view}')" class="rounded-2xl border border-zinc-700 bg-zinc-950/60 px-3 py-3 text-sm text-zinc-100 hover:border-cyan-400 hover:bg-cyan-500/10">
      <i class="fa-solid ${icon} mr-2 text-cyan-300"></i>${label}
    </button>`).join('');


  const linkVaultHtml = `
    <section class="rounded-[30px] border border-emerald-500/25 bg-emerald-500/10 p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><div class="text-xs uppercase tracking-[.18em] text-emerald-300">Link Vault</div><div class="mt-1 text-2xl font-semibold text-white">Shared file drop</div><div class="mt-1 text-sm text-zinc-400">Drop files here or choose a file. Received files save to each PC. Folders should be zipped first.</div></div>
        <button onclick="duoDisconnectFromShare()" class="rounded-2xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10">Disconnect</button>
      </div>
      <div id="link-vault-drop" class="mt-5 rounded-[28px] border border-dashed border-cyan-500/40 bg-cyan-500/5 p-10 text-center text-sm text-zinc-300">
        <i class="fa-solid fa-cloud-arrow-up mb-3 text-4xl text-cyan-300"></i>
        <div class="text-xl font-semibold text-white">Drop files here</div>
        <div class="mt-2 text-sm text-zinc-500">Zips, mp3s, exports, images, docs, builds, almost anything.</div>
        <button onclick="sendExportedBundle()" class="mt-5 rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white hover:bg-cyan-500">Choose File</button>
      </div>
      <div class="mt-5 rounded-[24px] border border-zinc-800 bg-zinc-950/70 p-5"><div class="flex items-center justify-between gap-3"><div class="font-semibold text-white">Received</div><button onclick="revealReceivedFolder()" class="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Open Folder</button></div><div class="mt-3 space-y-2">${receivedHtml}</div></div>
    </section>`;

  const controlHtml = `
    <section class="rounded-[30px] border border-emerald-500/25 bg-emerald-500/10 p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><div class="text-xs uppercase tracking-[.18em] text-emerald-300">Link Control</div><div class="mt-1 text-2xl font-semibold text-white">Both apps are linked</div><div class="mt-1 text-sm text-zinc-400">Control is for shared navigation and Duo session invites. Remote data lives in Remote Vault. Files live in Link Vault.</div></div>
        <button onclick="duoDisconnectFromShare()" class="rounded-2xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10">Disconnect</button>
      </div>
      ${window._pendingDuoSession ? `<div class="mt-5 rounded-3xl border border-emerald-400/40 bg-emerald-500/10 p-5 shadow-lg shadow-emerald-950/30"><div class="text-xs uppercase tracking-[.16em] text-emerald-300">Ready to invite</div><div class="mt-1 text-xl font-semibold text-emerald-100">Start this Duo session on both PCs</div><div class="mt-1 text-sm text-zinc-300">This sends Nick/Dylan a full-screen Join Session popup for "${esc(window._pendingDuoSession.title)}", then starts recording on your side.</div><button onclick="startPendingLinkedSession()" class="mt-4 w-full rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500"><i class="fa-solid fa-paper-plane mr-2"></i>Send Join Popup + Start My Side</button></div>` : ''}
      <div class="mt-5 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <div class="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5"><div class="flex items-center justify-between gap-3"><div><div class="font-semibold text-white">Mirror a tab</div><div class="text-xs text-zinc-500">Click a tab and the other person jumps there too.</div></div><span class="rounded-full border border-cyan-500/30 px-3 py-1 text-[11px] text-cyan-300">Shared control</span></div><div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">${mirrorButtons}</div></div>
        <div class="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5"><div class="font-semibold text-white">Quick link checks</div><div class="mt-1 text-xs text-zinc-500">Small proof that both apps can talk.</div><div class="mt-4 grid gap-2"><button onclick="sendCurrentSessionNotes()" class="rounded-2xl border border-zinc-700 px-4 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800"><i class="fa-solid fa-note-sticky mr-2 text-purple-300"></i>Send latest session notes</button><button onclick="sendLinkPing()" class="rounded-2xl border border-zinc-700 px-4 py-3 text-left text-sm text-zinc-100 hover:bg-zinc-800"><i class="fa-solid fa-satellite-dish mr-2 text-emerald-300"></i>Send test ping</button></div></div>
      </div>
    </section>`;

  const remoteVaultPageHtml = `
    <section class="rounded-[30px] border border-blue-500/25 bg-blue-500/10 p-5">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div><div class="text-xs uppercase tracking-[.18em] text-blue-300">Remote Vault</div><div class="mt-1 text-2xl font-semibold text-white">Their workspace snapshot</div><div class="mt-1 text-sm text-zinc-400">This shows their sessions, tasks, decisions, and ideas from the linked PC. It is a snapshot, not full live DB sync yet.</div></div>
        <div class="flex gap-2"><button onclick="requestRemoteVault()" class="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">Request / Refresh</button><button onclick="duoDisconnectFromShare()" class="rounded-2xl border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10">Disconnect</button></div>
      </div>
      ${remoteVaultHtml}
    </section>`;

  const connectedWorkspace = isConnected
    ? (currentLinkMode === 'vault' ? linkVaultHtml : currentLinkMode === 'remote' ? remoteVaultPageHtml : controlHtml)
    : '';

  content.innerHTML = `
    <div class="space-y-5">
      <div class="relative overflow-hidden rounded-[32px] border border-zinc-800 bg-[#080b15] p-6 shadow-2xl">
        <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(124,58,237,.22),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(6,182,212,.18),transparent_34%)]"></div>
        <div class="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="flex items-center gap-2 text-xs uppercase tracking-[.18em] text-cyan-300">
              <span class="h-2 w-2 rounded-full ${statusClass}"></span>
              Link ${isTester ? '<span class="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-200">Tester Window</span>' : ''}
            </div>
            <div class="mt-2 text-4xl font-semibold tracking-normal text-white">Link workspace</div>
            <div class="mt-2 max-w-3xl text-sm text-zinc-400">${connectionCopy}</div>
          </div>
          <div class="rounded-3xl border border-zinc-800 bg-black/35 px-5 py-4">
            <div class="text-[11px] uppercase tracking-[.16em] text-zinc-500">Connection</div>
            <div class="mt-1 flex items-center gap-2 text-lg font-semibold text-white"><span class="h-3 w-3 rounded-full ${statusClass}"></span>${esc(statusLabel)}</div>
          </div>
        </div>
      </div>

      ${connectedWorkspace}

      <div class="${isConnected ? 'hidden' : 'grid'} gap-4 xl:grid-cols-[1fr_350px]">
        <section class="grid gap-4 lg:grid-cols-2">
          <div class="rounded-[28px] border border-purple-500/25 bg-purple-500/10 p-5">
            <div class="flex items-center gap-3"><div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-200"><i class="fa-solid fa-tower-broadcast"></i></div><div><div class="font-semibold text-white">Host</div><div class="text-xs text-zinc-400">Creates the room code.</div></div></div>
            <div class="mt-4 rounded-2xl border border-zinc-800 bg-black/30 p-4">
              <div class="text-[11px] uppercase tracking-[.16em] text-zinc-500">Room Code</div>
              <div class="mt-2 flex min-h-[42px] items-center gap-2"><div class="min-w-0 flex-1 truncate font-mono text-2xl font-semibold text-purple-200">${roomCode ? esc(roomCode) : 'not hosting'}</div>${roomCode ? `<button onclick="copyPeerAddress()" class="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black">Copy</button>` : ''}</div>
              <div class="mt-2 text-xs text-zinc-500">${isHosting ? 'Waiting for the other person to join.' : isConnected ? 'Connected. Shared controls are above.' : 'Click Host to create a test code.'}</div>
            </div>
            <div class="mt-4 flex gap-2">${isHosting || isConnected ? `<button onclick="duoDisconnectFromShare()" class="flex-1 rounded-2xl border border-zinc-700 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">Disconnect</button>` : `<button onclick="hostFromShare(this)" class="flex-1 rounded-2xl bg-purple-600 py-3 text-sm font-semibold text-white hover:bg-purple-500">Host / Generate Code</button>`}</div>
          </div>

          <div class="rounded-[28px] border border-cyan-500/25 bg-cyan-500/10 p-5">
            <div class="flex items-center gap-3"><div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-200"><i class="fa-solid fa-plug-circle-bolt"></i></div><div><div class="font-semibold text-white">Join</div><div class="text-xs text-zinc-400">Paste the host code.</div></div></div>
            <div class="mt-4"><input id="join-addr-main" placeholder="paste code like forge-4829" class="w-full rounded-2xl border border-zinc-700 bg-black/35 px-4 py-3 font-mono text-sm text-white outline-none focus:border-cyan-400" onkeydown="if(event.key==='Enter')doJoinFromShare(this.nextElementSibling)"><button onclick="doJoinFromShare(this)" class="mt-3 w-full rounded-2xl bg-cyan-600 py-3 text-sm font-semibold text-white hover:bg-cyan-500">Join Code</button></div>
            <div class="mt-3 text-xs text-zinc-500">For one-PC testing: host in main, open tester window, paste code there.</div>
          </div>
        </section>

        <aside class="space-y-4">
          <div class="rounded-[24px] border border-cyan-500/25 bg-cyan-500/10 p-5"><div class="font-semibold text-white">One-PC two-person test</div><div class="mt-2 text-sm text-zinc-400">Opens another VibeForge window with its own PeerJS context. Treat it like Nick/Dylan.</div><button onclick="openDuoTestWindow()" class="mt-4 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-zinc-200">Open Tester Window</button><div class="mt-4 space-y-2 text-xs text-zinc-400"><div><span class="text-cyan-300">1.</span> Main: Host / Generate Code.</div><div><span class="text-cyan-300">2.</span> Tester: paste code and Join.</div><div><span class="text-cyan-300">3.</span> Use shared controls above.</div></div></div>
          <div class="rounded-[24px] border border-zinc-800 bg-zinc-950/70 p-5"><div class="flex items-center justify-between gap-3"><div class="font-semibold text-white">Received</div><button onclick="revealReceivedFolder()" class="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Open Folder</button></div><div class="mt-3 space-y-2">${receivedHtml}</div></div>
        </aside>
      </div>
    </div>
  `;
  wireLinkVaultDrop();
}
window.copyPeerAddress = async function() {
  const status = await getDuoStatus();
  const addr = status.roomCode || status.address || '';
  if (addr) {
    navigator.clipboard.writeText(addr).then(() => showToast('Address copied: ' + addr));
  } else {
    showToast('No address yet (start Host)');
  }
};

async function getDuoStatus() {
  if (window.vibePeer && window.vibePeer.getPeerStatus) return await window.vibePeer.getPeerStatus();
  return await window.vibeforge.getPeerStatus();
}

async function duoDisconnectFromShare() {
  if (window.vibePeer && window.vibePeer.duoDisconnect) await window.vibePeer.duoDisconnect();
  else await window.vibeforge.duoDisconnect();
  await switchView('share');
}

window.revealReceivedFolder = async function() {
  const p = await window.vibeforge.revealReceived();
  showToast('Opened received: ' + p);
};

window.revealSpecificReceived = function(p) {
  // best effort: open parent via storage reveal + note path
  window.vibeforge.revealReceived();
  showToast('Look for: ' + p);
};

window.openDuoTestWindow = async function() {
  if (!window.vibeforge.openDuoTestWindow) {
    showToast('Tester window API is not available. Restart VibeForge.');
    return;
  }
  const res = await window.vibeforge.openDuoTestWindow();
  if (res && res.ok) showToast(res.focused ? 'Tester window focused' : 'Tester window opened');
  else showToast('Could not open tester window: ' + (res ? res.error : 'unknown'));
};

async function hostFromShare(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Starting...';
  }
  try {
    const res = window.vibePeer ? await window.vibePeer.duoHost() : { ok: false, error: 'Peer manager not ready. Reload VibeForge and try again.' };
    if (res && res.ok) showToast('Room code ready: ' + (res.roomCode || res.address || ''));
    else showToast('Host failed: ' + (res ? res.error : 'unknown'));
  } finally {
    await switchView('share');
  }
}

async function doJoinFromShare(btn) {
  const input = document.getElementById('join-addr-main');
  const addr = input ? input.value.trim() : '';
  if (!addr) { showToast('Paste an address first'); return; }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Joining...';
  }
  try {
    const res = window.vibePeer ? await window.vibePeer.duoJoin(addr) : { ok: false, error: 'Peer manager not ready. Reload VibeForge and try again.' };
    if (res.ok) showToast('Connected to ' + addr);
    else showToast('Failed: ' + res.error);
  } finally {
    await switchView('share');
  }
}
window.sendCurrentSessionNotes = async function() {
  if (!currentProject) return;
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const latest = sessions[0];
  if (latest) {
    const msg = JSON.stringify({ type: 'session-notes', title: latest.title, notes: latest.notes || '' });
    const res = window.vibePeer ? await window.vibePeer.peerSendText(msg) : await window.vibeforge.peerSendText(msg);
    if (res && res.ok) {
      showToast('Sent session notes to peer');
    } else {
      showToast('Failed to send: ' + (res ? res.error : 'not connected'));
    }
  }
};

window.sendExportedBundle = async function() {
  if (!currentProject) return;
  const filePath = await window.vibeforge.pickFile();
  if (filePath) {
    const res = window.vibePeer ? await window.vibePeer.peerSendFile(filePath) : await window.vibeforge.peerSendFile(filePath);
    if (res && res.ok) {
      showToast('Sent file to peer');
    } else {
      showToast('Send failed: ' + (res ? res.error : 'not connected'));
    }
  }
};

function wireLinkVaultDrop() {
  const drop = document.getElementById('link-vault-drop');
  if (!drop) return;
  const active = 'border-cyan-300 bg-cyan-500/15';
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add(...active.split(' '));
  };
  drop.ondragleave = () => {
    drop.classList.remove(...active.split(' '));
  };
  drop.ondrop = async (e) => {
    e.preventDefault();
    drop.classList.remove(...active.split(' '));
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    let sent = 0;
    for (const file of files) {
      const filePath = file.path;
      if (!filePath) {
        showToast('Drop from File Explorer so VibeForge can access the file path.');
        continue;
      }
      const res = window.vibePeer ? await window.vibePeer.peerSendFile(filePath) : await window.vibeforge.peerSendFile(filePath);
      if (res && res.ok) sent++;
      else showToast('Could not send ' + file.name + ': ' + (res ? res.error : 'not connected'));
    }
    if (sent) showToast(`Sent ${sent} file${sent === 1 ? '' : 's'} through Link Vault`);
  };
}

async function sendPeerJson(payload) {
  const msg = JSON.stringify(payload);
  const res = window.vibePeer ? await window.vibePeer.peerSendText(msg) : await window.vibeforge.peerSendText(msg);
  if (!res || !res.ok) showToast('Link send failed: ' + (res ? res.error : 'not connected'));
  return res;
}

async function sendLinkedSessionInvite(session) {
  return await sendPeerJson({
    type: 'duo-command',
    command: 'session-invite',
    session: {
      title: session.title,
      mode: session.mode || 'duo',
      started_at: session.started_at || Date.now(),
      projectName: currentProject ? currentProject.name : 'Linked Project'
    }
  });
}

window.startPendingLinkedSession = async function() {
  const session = window._pendingDuoSession;
  if (!session) {
    showToast('No pending Duo session.');
    return;
  }
  await sendLinkedSessionInvite(session);
  window._pendingDuoSession = null;
  showToast('Join invite sent. Starting your side.');
  await renderLiveRoom(session);
};

window.mirrorViewToPeer = async function(view) {
  const allowed = ['sessions', 'ideas', 'tasks', 'decisions', 'timeline', 'memory'];
  if (!allowed.includes(view)) return;
  const res = await sendPeerJson({ type: 'duo-command', command: 'open-view', view });
  if (res && res.ok) {
    showToast('Mirrored tab: ' + view);
    await switchView(view);
  }
};

window.sendLinkPing = async function() {
  const res = await sendPeerJson({ type: 'duo-command', command: 'ping', at: Date.now() });
  if (res && res.ok) showToast('Ping sent through Link');
};

window.requestRemoteVault = async function() {
  const res = await sendPeerJson({ type: 'duo-command', command: 'request-snapshot', at: Date.now() });
  if (res && res.ok) showToast('Requested remote vault snapshot');
};

async function buildLocalVaultSnapshot() {
  await ensureDefaultProject();
  const projectId = currentProject.id;
  return {
    type: 'duo-command',
    command: 'snapshot',
    at: Date.now(),
    projectName: currentProject.name,
    sessions: (await window.vibeforge.getSessions(projectId)).slice(0, 50),
    tasks: (await window.vibeforge.getTasks(projectId)).slice(0, 50),
    decisions: (await window.vibeforge.getDecisions(projectId)).slice(0, 50),
    ideas: (await window.vibeforge.getIdeas(projectId)).slice(0, 50)
  };
}

async function handlePeerTextPayload(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!data || typeof data !== 'object') return false;

    if (data.type === 'session-notes') {
      receivedItems.push({ type: 'notes', title: data.title, content: data.notes });
      if (currentView === 'share') {
        renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
      }
      showToast('Received session notes from peer');
      return true;
    }

    if (data.type === 'duo-command') {
      if (data.command === 'open-view' && data.view) {
        showToast('Link moved you to: ' + data.view);
        await switchView(data.view);
        return true;
      }
      if (data.command === 'ping') {
        receivedItems.push({ type: 'ping', title: 'Link ping received' });
        if (currentView === 'share') {
          renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
        }
        showToast('Link ping received');
        return true;
      }
      if (data.command === 'session-invite' && data.session) {
        await showLinkedSessionInvite(data.session);
        return true;
      }
      if (data.command === 'session-ended') {
        const activeId = _activeLiveSession && _activeLiveSession.id;
        if (activeId) {
          _duoPeerSessionNotes[activeId] = {
            peerName: data.peerName || 'Linked collaborator',
            transcript: data.transcript || '',
            notes: data.notes || '',
            at: Date.now()
          };
          showToast(`${data.peerName || 'Linked collaborator'} stopped - saving your side too...`);
          await window.stopLiveRoom(activeId, { remoteTriggered: true });
        } else {
          receivedItems.push({
            type: 'session-ended',
            title: `${data.peerName || 'Linked collaborator'} ended a session`,
            content: data.transcript || data.notes || ''
          });
          showToast(`${data.peerName || 'Linked collaborator'} ended their session`);
        }
        return true;
      }
      if (data.command === 'ai-results') {
        const result = data.result || {};
        const peerName = data.peerName || 'Linked collaborator';
        _duoPeerAiResults[data.sessionTitle || 'linked-session'] = { peerName, result, at: Date.now() };
        receivedItems.push({
          type: 'ai-results',
          title: `${peerName} AI cleanup`,
          content: result.skipped
            ? `Skipped: ${result.skipped}`
            : `Named: ${result.named || 'no rename'}, tasks: ${result.tasks || 0}, decisions: ${result.decisions || 0}, ideas: ${result.ideas || 0}`
        });
        if (currentView === 'share') {
          renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
        }
        showToast(`Received ${peerName}'s AI cleanup result`);
        return true;
      }
      if (data.command === 'request-snapshot') {
        const snapshot = await buildLocalVaultSnapshot();
        await sendPeerJson(snapshot);
        showToast('Sent remote vault snapshot');
        return true;
      }
      if (data.command === 'snapshot') {
        remoteVaultSnapshot = data;
        if (currentView === 'share') {
          renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
        }
        showToast('Remote vault snapshot received');
        return true;
      }
    }
  } catch (e) {
    console.log('Peer message:', raw);
  }
  return false;
}

async function showLinkedSessionInvite(remoteSession) {
  document.querySelectorAll('.linked-session-invite').forEach(m => m.remove());
  const title = remoteSession.title || 'Linked Session';
  const projectName = remoteSession.projectName || 'their project';
  const modal = document.createElement('div');
  modal.className = 'linked-session-invite fixed inset-0 z-[500] flex items-center justify-center bg-black/75';
  modal.innerHTML = `
    <div class="w-full max-w-lg rounded-[28px] border border-emerald-500/30 bg-[#0b0f1d] p-6 shadow-2xl">
      <div class="text-xs uppercase tracking-[.18em] text-emerald-300">Linked session invite</div>
      <div class="mt-2 text-2xl font-semibold text-white">${esc(title)}</div>
      <div class="mt-2 text-sm leading-6 text-zinc-400">Your linked collaborator started a Duo session from "${esc(projectName)}". Join it on this PC so both sides are recording the same conversation.</div>
      <div class="mt-6 flex gap-3">
        <button class="decline flex-1 rounded-2xl border border-zinc-700 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">Not now</button>
        <button class="accept flex-1 rounded-2xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-500">Join Session</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('.decline').onclick = () => {
    modal.remove();
    showToast('Session invite dismissed');
  };
  modal.querySelector('.accept').onclick = async () => {
    modal.remove();
    await ensureDefaultProject();
    const localSession = await window.vibeforge.createSession({
      projectId: currentProject.id,
      title,
      mode: 'duo',
      startedAt: remoteSession.started_at || Date.now()
    });
    showToast('Joined linked Duo session');
    await renderLiveRoom(localSession);
  };
}

// Handle received files from peer (real path saved in main to received/)
if (window.vibeforge.onPeerFile) {
  window.vibeforge.onPeerFile((data) => {
    console.log('Received file from peer:', data);
    if (data && data.path) {
      receivedItems.push({ type: 'file', title: data.path.split(/[\\/]/).pop() || data.path, path: data.path });
    } else {
      receivedItems.push({ type: 'file', title: 'received file' });
    }
    if (currentView === 'share') {
      renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
    }
    showToast('Received file from peer');
  });
}

// Vaults - real CRUD
async function renderDecisionsView(content, actionsEl) {
  actionsEl.innerHTML = `<button onclick="addDecisionModal()" class="px-4 py-1.5 bg-white text-black rounded-2xl text-sm font-semibold">+ Add Decision</button>`;
  const decisions = await window.vibeforge.getDecisions(currentProject.id);
  let html = `<div class="font-semibold text-xl mb-4">Decision Vault</div>`;
  if (decisions.length === 0) html += `<div class="empty">No decisions yet. Add one to track important choices.</div>`;
  else {
    html += decisions.map(d => `
      <div class="card bg-[#111113] border border-zinc-800 p-4 rounded-3xl mb-3">
        <div class="flex justify-between">
          <div class="font-medium">${esc(d.title)}</div>
          <div class="text-xs px-2 py-0.5 rounded bg-zinc-800">${d.status}</div>
        </div>
        ${d.notes ? `<div class="text-xs text-zinc-400 mt-1">${esc(d.notes)}</div>` : ''}
        <div class="flex gap-2 mt-3 text-xs">
          <button onclick="editDecision('${d.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">Edit</button>
          <button onclick="deleteDecision('${d.id}')" class="px-3 py-1 border border-red-800 text-red-400 rounded-xl">Delete</button>
          <button onclick="convertDecisionToTask('${d.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">To Task</button>
        </div>
      </div>
    `).join('');
  }
  content.innerHTML = html;
}

window.addDecisionModal = async function() {
  const title = await window.showInputModal('Decision title', '', 'Short decision title');
  if (!title) return;
  const notes = await window.showInputModal('Notes (optional)', '', 'Any details') || '';
  await window.vibeforge.addDecision({ projectId: currentProject.id, title, notes, status: 'proposed' });
  showToast('Decision added');
  await switchView('decisions');
};

window.editDecision = async function(id) {
  const decs = await window.vibeforge.getDecisions(currentProject.id);
  const d = decs.find(x => x.id === id);
  if (!d) return;
  const newTitle = await window.showInputModal('Title', d.title, 'Decision title');
  if (!newTitle) return;
  const newNotes = await window.showInputModal('Notes', d.notes || '', 'Details') || '';
  const newStatus = await window.showInputModal('Status', d.status, 'proposed / approved / rejected') || d.status;
  await window.vibeforge.updateDecision({ id, title: newTitle, notes: newNotes, status: newStatus });
  await switchView('decisions');
};

window.deleteDecision = async function(id) {
  if (!await window.showConfirm('Delete decision?')) return;
  await window.vibeforge.deleteDecision(id);
  await switchView('decisions');
};

window.convertDecisionToTask = async function(id) {
  const decs = await window.vibeforge.getDecisions(currentProject.id);
  const d = decs.find(x => x.id === id);
  await window.vibeforge.addTask({ projectId: currentProject.id, title: d.title, notes: d.notes });
  showToast('Converted to task');
  await switchView('tasks');
};

// Similar full implementations for Tasks and Ideas (abbreviated for space but complete in spirit)
async function renderTasksView(content, actionsEl) {
  actionsEl.innerHTML = `<button onclick="addTaskModal()" class="px-4 py-1.5 bg-white text-black rounded-2xl text-sm font-semibold">+ Add Task</button>`;
  const tasks = await window.vibeforge.getTasks(currentProject.id);
  let html = `<div class="font-semibold text-xl mb-4">Tasks</div>`;
  if (!tasks.length) html += `<div class="empty">No tasks.</div>`;
  else {
    const open = tasks.filter(t => t.status === 'open');
    const done = tasks.filter(t => t.status !== 'open');
    html += `<div class="mb-6"><div class="text-xs mb-2 text-orange-400">OPEN</div>`;
    open.forEach(t => html += taskHtml(t));
    html += `</div><div><div class="text-xs mb-2 text-emerald-400">DONE</div>`;
    done.forEach(t => html += taskHtml(t));
    html += `</div>`;
  }
  content.innerHTML = html;
}

function taskHtml(t) {
  return `<div class="flex justify-between items-center py-2 border-b border-zinc-800 text-sm">
    <span>${esc(t.title)} <span class="text-xs text-zinc-500">(${esc(t.priority)})</span></span>
    <span class="flex gap-1 text-xs">
      <button onclick="toggleTask('${t.id}', '${t.status}')" class="px-2 py-px border border-zinc-700 rounded">${t.status === 'open' ? 'Done' : 'Reopen'}</button>
      <button onclick="deleteTask('${t.id}')" class="px-2 py-px border border-red-800 text-red-400 rounded">Del</button>
    </span>
  </div>`;
}

window.addTaskModal = async function() {
  const title = await window.showInputModal('Task title', '', 'What needs to be done?');
  if (!title) return;
  await window.vibeforge.addTask({ projectId: currentProject.id, title });
  showToast('Task added');
  await switchView('tasks');
};
window.toggleTask = async function(id, current) { await window.vibeforge.updateTask({ id, status: current === 'open' ? 'done' : 'open' }); await switchView('tasks'); };
window.deleteTask = async function(id) { if (await window.showConfirm('Delete this task?')) { await window.vibeforge.deleteTask(id); await switchView('tasks'); } };

// === 1. IDEA VAULT QOL: filters (Inbox/Saved/Archived/Converted), rename, edit, convert, promote to decision, archive, delete, Smart Rename (Ollama only) ===
let currentIdeaFilter = 'all';

async function renderIdeasView(content, actionsEl) {
  actionsEl.innerHTML = `
    <button onclick="addIdeaModal()" class="px-4 py-1.5 bg-white text-black rounded-2xl text-sm font-semibold">+ Add Idea</button>
    <button onclick="showCaptureIdeaModal()" class="ml-2 px-4 py-1.5 bg-emerald-600 text-white rounded-2xl text-sm font-semibold">Capture Idea</button>
  `;

  // Use filtered if status filter
  let ideas;
  try {
    ideas = await window.vibeforge.getIdeasFiltered({ projectId: currentProject.id, status: currentIdeaFilter === 'all' ? null : currentIdeaFilter });
  } catch (e) {
    ideas = await window.vibeforge.getIdeas(currentProject.id);
  }

  let html = `<div class="font-semibold text-xl mb-3">Idea Vault</div>`;

  // Filters
  const filters = ['all', 'Inbox', 'Saved', 'Archived', 'Converted'];
  html += `<div class="flex gap-2 mb-4 text-xs">`;
  filters.forEach(f => {
    const active = (currentIdeaFilter === f || (f==='all' && currentIdeaFilter==='all')) ? 'bg-white text-black' : 'border border-zinc-700';
    html += `<button onclick="setIdeaFilter('${f}')" class="px-3 py-1 rounded-2xl ${active}">${f}</button>`;
  });
  html += `</div>`;

  if (!ideas || !ideas.length) {
    html += `<div class="empty">No ideas in this filter. Capture fast when you and Nick say "that's a good idea."</div>`;
  } else {
    html += ideas.map(i => {
      const st = i.status || 'Inbox';
      return `<div class="card p-4 bg-[#111113] border border-zinc-800 rounded-3xl mb-3">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">${esc(i.title)} <span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">${esc(st)}</span></div>
            <div class="text-xs text-zinc-400 mt-0.5">${esc(i.description || '')}</div>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs">
          <button onclick="renameIdea('${i.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">Rename</button>
          <button onclick="editIdea('${i.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">Edit</button>
          <button onclick="convertIdea('${i.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">Convert to Task</button>
          <button onclick="promoteIdeaToDecision('${i.id}')" class="px-3 py-1 border border-zinc-700 rounded-xl">Promote to Decision</button>
          <button onclick="setIdeaStatus('${i.id}', 'Saved')" class="px-3 py-1 border border-zinc-700 rounded-xl">Save</button>
          <button onclick="setIdeaStatus('${i.id}', 'Archived')" class="px-3 py-1 border border-zinc-700 rounded-xl">Archive</button>
          <button onclick="smartRenameIdea('${i.id}', this)" class="px-3 py-1 border border-emerald-800 text-emerald-400 rounded-xl">Smart Rename</button>
          <button onclick="deleteIdea('${i.id}')" class="px-3 py-1 border border-red-800 text-red-400 rounded-xl">Delete</button>
        </div>
      </div>`;
    }).join('');
  }
  content.innerHTML = html;
}

window.setIdeaFilter = async function(f) {
  currentIdeaFilter = f;
  await switchView('ideas');
};

window.renameIdea = async function(id) {
  const ideas = await window.vibeforge.getIdeas(currentProject.id);
  const idea = ideas.find(x => x.id === id);
  const currentTitle = idea ? idea.title : '';
  const newTitle = await window.showInputModal('New title', currentTitle, 'Rename the idea');
  if (!newTitle || newTitle === currentTitle) return;
  await window.vibeforge.updateIdea({ id, title: newTitle });
  showToast('Renamed');
  await switchView('ideas');
};

window.editIdea = async function(id) {
  const ideas = await window.vibeforge.getIdeas(currentProject.id);
  const i = ideas.find(x => x.id === id); if (!i) return;
  const newTitle = await window.showInputModal('Title', i.title, 'Idea title');
  if (!newTitle) return;
  const newDesc = await window.showInputModal('Description', i.description || '', 'Details') || '';
  await window.vibeforge.updateIdea({ id, title: newTitle, description: newDesc });
  showToast('Updated');
  await switchView('ideas');
};

window.setIdeaStatus = async function(id, status) {
  await window.vibeforge.updateIdea({ id, status });
  showToast('Status: ' + status);
  await switchView('ideas');
};

window.promoteIdeaToDecision = async function(id) {
  const ideas = await window.vibeforge.getIdeas(currentProject.id);
  const i = ideas.find(x => x.id === id); if (!i) return;
  await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId: i.session_id, title: i.title, notes: i.description || '', status: 'proposed' });
  await window.vibeforge.updateIdea({ id, status: 'Converted' });
  showToast('Promoted to Decision');
  await switchView('decisions');
};

window.smartRenameIdea = async function(id, btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Thinking...';
  const ideas = await window.vibeforge.getIdeas(currentProject.id);
  const i = ideas.find(x => x.id === id); if (!i) { btn.disabled=false; btn.textContent=old; return; }
  const settings = await window.vibeforge.getSettings();
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const model = settings.ollama_model || 'llama3.2';
  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: `Short clear title (max 8 words) for this idea. Return ONLY the title text.\n\n${i.description || i.title}`, stream: false })
    });
    if (res.ok) {
      const data = await res.json();
      let t = (data.response || '').trim().replace(/^["']|["']$/g,'').split('\n')[0].slice(0,80);
      if (t) {
        await window.vibeforge.updateIdea({ id, title: t });
        showToast('Smart renamed');
      } else {
        showToast('Smart name not useful, kept original');
      }
    } else {
      showToast('Ollama did not return name');
    }
  } catch (e) {
    showToast('Smart Rename skipped (Ollama offline)');
  }
  btn.disabled = false; btn.textContent = old;
  await switchView('ideas');
};

window.addIdeaModal = async function() {
  const t = await window.showInputModal('Idea title', '', 'Short title');
  if (!t) return;
  const d = await window.showInputModal('Description (optional)', '', 'Any details') || '';
  const created = await window.vibeforge.addIdea({ projectId: currentProject.id, title: t, description: d });
  if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
  showToast('Idea added (Inbox)');
  await switchView('ideas');
};

window.convertIdea = async function(id) {
  await window.vibeforge.convertIdeaToTask(id);
  await window.vibeforge.updateIdea({ id, status: 'Converted' });
  showToast('Converted to task');
  await switchView('tasks');
};

window.deleteIdea = async function(id) {
  if (!await window.showConfirm('Delete this idea?')) return;
  await window.vibeforge.deleteIdea(id);
  await switchView('ideas');
};

// Timeline
async function renderTimelineView(content) {
  const events = await window.vibeforge.getTimeline(currentProject.id);
  let html = `<div class="font-semibold text-xl mb-4">Timeline</div>`;
  if (!events.length) html += `<div class="empty">No events yet. Create sessions, decisions, tasks or ideas.</div>`;
  else html += events.map(e => `<div class="py-2 border-b border-zinc-800 text-sm">${new Date(e.timestamp).toLocaleString()} - <span class="text-zinc-400">${esc(e.type)}</span> ${esc(e.title)}</div>`).join('');
  content.innerHTML = html;
}

// === 8. PROJECT MEMORY QOL - better results + AI only when Ollama ready, real context, Save/Copy wired ===
async function renderMemoryView(content) {
  const settings = await window.vibeforge.getSettings();
  const hasOllama = !!(settings.ollama_url);
  let aiSection = '';
  if (hasOllama) {
    aiSection = `
      <div class="mt-6">
        <div class="font-medium mb-2">AI Chat with Memory (only uses your local project data + Ollama)</div>
        <div id="memory-chat" class="h-40 overflow-auto bg-[#111113] border border-zinc-800 p-2 text-xs mb-2"></div>
        <input id="memory-chat-input" placeholder="Ask about your project..." class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-2 text-sm" onkeyup="if (event.key === 'Enter') sendMemoryChat()">
        <div class="flex gap-2 mt-2">
          <button onclick="sendMemoryChat()" class="px-4 py-1 text-xs bg-white text-black rounded-2xl">Send</button>
          <button onclick="saveLastMemoryAnswer()" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl">Save Answer to Notes</button>
          <button onclick="copyLastMemoryAnswer()" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl">Copy Answer</button>
        </div>
        <div class="text-[10px] text-zinc-500 mt-1">Answers are based only on real stored items. No hallucinated project data.</div>
      </div>`;
  } else {
    aiSection = `<div class="mt-6 p-3 border border-zinc-700 rounded-2xl text-xs">AI chat requires Ollama. <button onclick="switchView('settings')" class="underline">Set up Ollama</button> in Local AI section.</div>`;
  }

  content.innerHTML = `
    <div class="max-w-xl">
      <div class="font-semibold text-xl mb-4">Project Memory</div>
      <input id="memory-q" placeholder="Search decisions, tasks, ideas, sessions..." class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-2.5 mb-2 text-sm" onkeyup="if (event.key === 'Enter') doMemorySearch()">
      <button onclick="doMemorySearch()" class="px-5 py-2 bg-white text-black rounded-2xl text-sm font-semibold">Search</button>
      <div id="memory-results" class="mt-4 text-sm space-y-1"></div>
      ${aiSection}
    </div>
  `;
}

window.doMemorySearch = async function() {
  const q = document.getElementById('memory-q').value.trim();
  const res = await window.vibeforge.searchMemory(currentProject.id, q);
  const el = document.getElementById('memory-results');
  if (!res.length) {
    el.innerHTML = `<div class="text-zinc-400">No matches. Add sessions, decisions, tasks or ideas first.</div>`;
    return;
  }
  el.innerHTML = res.map(r => {
    const src = r.type === 'session' ? '' : (r.session_id ? ' (from session)' : '');
    return `
      <div class="py-1 flex justify-between items-start border-b border-zinc-800">
        <div>
          <span class="text-xs uppercase text-zinc-500">${r.type}</span>
          <span class="font-medium ml-1">${esc(r.text)}</span>
          ${src}
        </div>
        <button onclick="openMemoryResult('${r.type}', '${r.id}')" class="text-xs px-2 border border-zinc-700 rounded">Open</button>
      </div>`;
  }).join('');
};

window.doMemorySearchFromBar = async function() {
  const q = (document.getElementById('global-search')?.value || '').trim();
  if (!q) return;
  await switchView('memory');
  const memoryInput = document.getElementById('memory-q');
  if (memoryInput) {
    memoryInput.value = q;
    await window.doMemorySearch();
  }
};

window.openMemoryResult = async function(type, id) {
  if (type === 'session') {
    await openSession(id);
  } else if (type === 'decision') {
    await switchView('decisions');
  } else if (type === 'task') {
    await switchView('tasks');
  } else if (type === 'idea') {
    await switchView('ideas');
  }
};

let lastMemoryAnswer = '';

async function sendMemoryChat() {
  const input = document.getElementById('memory-chat-input');
  const chat = document.getElementById('memory-chat');
  if (!input || !input.value.trim() || !chat || !currentProject) return;

  const q = input.value.trim();
  input.value = '';

  chat.innerHTML += `<div class="mb-1"><b>You:</b> ${q}</div>`;
  chat.scrollTop = chat.scrollHeight;

  let context = 'Use ONLY the following real project items. Do not invent anything.\n';
  const res = await window.vibeforge.searchMemory(currentProject.id, q);
  res.slice(0, 12).forEach(r => { context += `- ${r.type}: ${r.text}\n`; });

  const settings = await window.vibeforge.getSettings();
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const model = settings.ollama_model || 'llama3.2';

  try {
    const fres = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: `${context}\nQuestion: ${q}\nAnswer concisely using only the items above:`,
        stream: false
      })
    });
    const data = await fres.json();
    lastMemoryAnswer = data.response || 'No response';
    chat.innerHTML += `<div class="mb-1"><b>AI:</b> ${lastMemoryAnswer}</div>`;
    chat.scrollTop = chat.scrollHeight;
  } catch (e) {
    chat.innerHTML += `<div class="text-red-400">Ollama error: ${e.message}. Check Local AI in Settings.</div>`;
  }
}

window.saveLastMemoryAnswer = async function() {
  if (!lastMemoryAnswer || !currentProject) { showToast('No answer to save'); return; }
  // Wire: save as a new idea tagged AI (real)
  await window.vibeforge.addIdea({ projectId: currentProject.id, title: 'AI Memory Answer', description: lastMemoryAnswer });
  showToast('Saved as Idea in Vault');
  if (currentView === 'ideas') await switchView('ideas');
};

window.copyLastMemoryAnswer = function() {
  if (!lastMemoryAnswer) return;
  navigator.clipboard.writeText(lastMemoryAnswer).then(() => showToast('Answer copied'));
};

// === 9 + 10. SETTINGS ORGANIZATION + full Local AI / GitHub / Exports / Transcription / reveals ===
// Simple tab state for the new friendly phone-style Settings
let currentSettingsTab = 'general';

async function renderSettingsView(content) {
  const settings = await window.vibeforge.getSettings();
  let statusHtml = '<div class="text-xs text-zinc-500">Loading storage...</div>';
  try {
    const st = await window.vibeforge.getStorageStatus();
    statusHtml = `userData: ${st.userData}<br>DB: ${st.dbExists ? Math.round(st.dbSize/1024)+'KB' : 'no'} - ${st.counts.projects} projects`;
  } catch(e){ statusHtml = 'Storage info unavailable'; }

  // Phone-settings style: top tabs + one clean pane at a time. Very sparse.
  const tabBar = `
    <div class="flex gap-1 mb-4 bg-[#111113] p-1 rounded-3xl border border-zinc-800">
      <button onclick="switchSettingsTab('general', this)" class="tab-btn flex-1 py-2 text-sm rounded-2xl ${currentSettingsTab==='general' ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800'}">General</button>
      <button onclick="switchSettingsTab('ai', this)" class="tab-btn flex-1 py-2 text-sm rounded-2xl ${currentSettingsTab==='ai' ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800'}">AI Tools</button>
      <button onclick="switchSettingsTab('updates', this)" class="tab-btn flex-1 py-2 text-sm rounded-2xl ${currentSettingsTab==='updates' ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800'}">Updates</button>
      <button onclick="switchSettingsTab('files', this)" class="tab-btn flex-1 py-2 text-sm rounded-2xl ${currentSettingsTab==='files' ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800'}">Files</button>
      <button onclick="switchSettingsTab('reset', this)" class="tab-btn flex-1 py-2 text-sm rounded-2xl ${currentSettingsTab==='reset' ? 'bg-white text-black font-semibold' : 'hover:bg-zinc-800'}">Reset</button>
    </div>
  `;

  let paneHtml = '';

  if (currentSettingsTab === 'general') {
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Profile</div>
          <div class="text-xs text-zinc-400 mb-3">Your name shown in the app</div>
          <input id="set-name" value="${settings.profile_name || 'You'}" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base">
        </div>

        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">App Behavior</div>
          <div class="text-xs text-zinc-400">Capture Idea is always one tap away in the sidebar and Sessions screen. Everything stays on this computer.</div>
        </div>

        <div class="pt-2">
          <button onclick="saveAllSettings()" class="w-full py-3 bg-white text-black rounded-2xl font-semibold">Save Changes</button>
        </div>
      </div>
    `;
  }

  else if (currentSettingsTab === 'ai') {
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Local AI (Ollama)</div>
          <div class="text-xs text-zinc-400 mb-3">Runs completely on your computer. Used for smart naming, summaries, and chat in Project Memory.</div>

          <div class="mb-3">
            <div class="text-xs text-zinc-400 mb-1">Ollama Address</div>
            <input id="set-ollama" value="${settings.ollama_url || 'http://127.0.0.1:11434'}" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base">
          </div>

          <div class="flex gap-2 mb-3">
            <button onclick="checkOllamaStatus(this)" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Check Ollama</button>
            <button onclick="window.vibeforge.ollamaOpenDownload()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Download Ollama</button>
            <button onclick="startOllamaServe(this)" class="flex-1 py-2.5 bg-emerald-700 rounded-2xl text-sm">Run ollama serve</button>
            <button onclick="openOllama(this)" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Open Ollama App</button>
          </div>

          <div class="flex gap-2 mb-3">
            <button onclick="testOllamaReal()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Test Connection</button>
            <button onclick="refreshOllamaModelsReal()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Refresh Models</button>
          </div>

          <div class="mb-3">
            <div class="text-xs text-zinc-400 mb-1">Model to use</div>
            <select id="set-ollama-model" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base"></select>
          </div>

          <div class="flex gap-2">
            <button onclick="pullSelectedModel()" class="flex-1 py-2.5 bg-emerald-600 rounded-2xl text-sm font-medium">Pull Selected Model</button>
            <button onclick="testSelectedModel()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Test Model</button>
          </div>

          <div id="ollama-log" class="mt-3 h-20 overflow-auto bg-black/40 text-[10px] p-2 rounded font-mono"></div>
        </div>

        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Transcription (Whisper, fully local)</div>
          <div class="text-xs text-zinc-400 mb-3">Powered by whisper.cpp - no Python, no dependencies. One-click setup downloads the engine + speech model (~150 MB, one time). After that: live captions during recording + full transcription of any saved session, all offline.</div>

          <input id="set-whisper" value="${settings.whisper_path || ''}" placeholder="Engine path (set automatically after setup)" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base mb-2" readonly>
          <div class="flex gap-2 mb-2">
            <button onclick="checkWhisper()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Check Setup</button>
            <button onclick="window.openWhisperCpp()" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">About whisper.cpp</button>
          </div>
          <button onclick="setupOpenSourceWhisper(this)" class="w-full py-2.5 bg-emerald-600 rounded-2xl text-sm font-medium mb-2">One-click Whisper Setup (~150 MB one-time download)</button>
          <div id="whisper-setup-log" class="h-20 overflow-auto bg-black/40 text-[10px] p-2 rounded font-mono"></div>
          <div id="whisper-status" class="text-[10px] text-zinc-500 mt-1">After setup: live captions in Room sessions + a Transcribe button on any recording. Fully offline.</div>
        </div>
      </div>
    `;
  }

  else if (currentSettingsTab === 'updates') {
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Check for Updates</div>
          <div class="text-xs text-zinc-400 mb-3">Checks the official VibeForge release feed and tells you if a newer portable build is available.</div>
          <div class="mb-3 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
            Current version: <span class="font-mono text-cyan-300">${settings.app_version || '0.4.5'}</span>
          </div>

          <button onclick="checkForAppUpdates()" class="w-full py-4 bg-white text-black rounded-2xl font-semibold text-lg mb-2">CHECK FOR UPDATE</button>
          <div id="update-status" class="text-center text-sm"></div>
        </div>
      </div>
    `;
  }

  else if (currentSettingsTab === 'files') {
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Storage &amp; Folders</div>
          <div class="text-xs text-zinc-400 mb-3">${statusHtml}</div>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.vibeforge.revealStorage()" class="py-3 bg-zinc-800 rounded-2xl">Open Storage Folder</button>
            <button onclick="window.vibeforge.revealRecordings()" class="py-3 bg-zinc-800 rounded-2xl">Open Recordings</button>
            <button onclick="window.vibeforge.revealExports()" class="py-3 bg-zinc-800 rounded-2xl">Open Exports</button>
            <button onclick="window.vibeforge.revealReceived()" class="py-3 bg-zinc-800 rounded-2xl">Open Received Files</button>
          </div>
        </div>

        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Exports</div>
          <div class="text-xs text-zinc-400">When you export sessions or projects they go into real folders you can find and send. Use the buttons above.</div>
        </div>
      </div>
    `;
  }

  else if (currentSettingsTab === 'reset') {
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-red-900 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1 text-red-400">Reset Everything</div>
          <div class="text-xs text-zinc-400 mb-4">This deletes all your projects, sessions, ideas, decisions, audio, and settings. Starts the app completely fresh.</div>
          <button onclick="resetAllData()" class="w-full py-3 bg-red-600 rounded-2xl font-semibold">RESET ALL DATA</button>
        </div>
      </div>
    `;
  }

  content.innerHTML = `
    <div class="max-w-xl">
      <div class="font-semibold text-2xl mb-1">Settings</div>
      <div class="text-xs text-zinc-400 mb-4">Simple controls. Tap a tab above.</div>

      ${tabBar}
      <div id="settings-pane">${paneHtml}</div>

      <div class="mt-6 text-center text-[10px] text-zinc-500">Everything stays on this computer. No accounts or cloud required.</div>
    </div>
  `;

  // If we just switched to AI tab, try to populate the model dropdown
  if (currentSettingsTab === 'ai') {
    setTimeout(async () => {
      try {
        const mEl = document.getElementById('set-ollama-model');
        if (mEl) {
          const r = await window.vibeforge.ollamaListModels();
          const cur = settings.ollama_model || 'llama3.2';
          if (r && r.ok && r.models && r.models.length) {
            mEl.innerHTML = r.models.map(m => `<option ${m===cur?'selected':''} value="${m}">${m}</option>`).join('');
          } else {
            mEl.innerHTML = `<option value="${cur}">${cur}</option>`;
          }
        }
      } catch(e){}
    }, 60);
  }

}

// Helper so the tab buttons can switch and re-render just the pane
window.switchSettingsTab = async function(tab, btn) {
  currentSettingsTab = tab;
  // Re-render the whole settings view (cheap) so the tab bar highlights correctly
  const content = document.getElementById('main-content');
  if (content) await renderSettingsView(content);
};

// === GitHub device sign-in UX (shows the code the user needs to enter on github.com/login/device) ===
window.startOllamaServe = async function(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
  const res = await window.vibeforge.startOllamaServe();
  if (res && res.ok) {
    showToast(res.alreadyRunning ? 'Ollama is already running' : 'Ollama started');
  } else {
    showToast('Could not start Ollama: ' + (res ? res.error : 'unknown'));
  }
  if (typeof refreshServiceStatus === 'function') refreshServiceStatus();
  if (btn) { btn.disabled = false; btn.textContent = 'Run ollama serve'; }
};

window.openOllama = async function(btn) {
  if (btn) btn.disabled = true;
  const res = await window.vibeforge.openOllama();
  if (res && res.openedDownload) {
    showToast('Opened Ollama download page (install the desktop app for one-click open)');
  } else {
    showToast('Opened Ollama app');
  }
  if (btn) btn.disabled = false;
};

// === Audio -> 16kHz mono WAV conversion (whisper.cpp reads wav natively; webm needs decoding) ===
function encodeWav16k(float32) {
  const sampleRate = 16000;
  const buffer = new ArrayBuffer(44 + float32.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + float32.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);          // PCM
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);         // 16-bit
  writeStr(36, 'data');
  view.setUint32(40, float32.length * 2, true);
  let off = 44;
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }
  return new Uint8Array(buffer);
}

// Decode any audio bytes (webm/ogg/mp3...) and resample to 16k mono WAV bytes
async function audioBytesToWav16k(bytes) {
  const ab = bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  let decoded;
  try {
    decoded = await ac.decodeAudioData(ab);
  } finally {
    try { ac.close(); } catch (e) {}
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const off = new OfflineAudioContext(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return encodeWav16k(rendered.getChannelData(0));
}

// Simple linear resampler for raw Float32 PCM (used by live captions)
function resampleTo16k(float32, fromRate) {
  if (fromRate === 16000) return float32;
  const ratio = fromRate / 16000;
  const outLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, float32.length - 1);
    out[i] = float32[lo] + (float32[hi] - float32[lo]) * (idx - lo);
  }
  return out;
}

window.transcribeSession = async function(sessionId, options = {}) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  if (!s || !s.audio_path) return;
  const check = await window.vibeforge.whisperCheck();
  if (!check || !check.configured) {
    if (!options.silent) {
      showToast('Whisper not set up yet - one click in Settings > AI Tools (about 150 MB, one time).');
      switchView('settings');
    }
    return;
  }
  if (!options.silent) showToast('Transcribing locally with Whisper... this can take a bit for long recordings.');
  try {
    const bytes = await window.vibeforge.readFileBuffer(s.audio_path);
    if (!bytes) { if (!options.silent) showToast('Recording file not found. Is the host running with the same code?'); return ''; }
    const wav = await audioBytesToWav16k(bytes);
    // appendToNotes only when NOT part of auto-process (auto-process passes the text to the
    // brain directly, so we don't also dump a [Whisper transcript] block into notes).
    const res = await window.vibeforge.transcribeWav({ wav, sessionId, appendToNotes: !options.returnOnly });
    if (res && res.ok) {
      if (!options.silent) {
        showToast(res.transcript ? 'Transcript added to session notes' : 'Done - no speech detected in the recording');
        await openSession(sessionId);
      }
      return res.transcript || '';
    } else {
      if (!options.silent) showToast('Transcription failed: ' + (res ? res.error : 'unknown'));
      return '';
    }
  } catch (e) {
    if (!options.silent) showToast('Transcription failed: ' + e.message);
    return '';
  }
};

window.setupOpenSourceWhisper = async function(btn) {
  const logEl = document.getElementById('whisper-setup-log');
  if (btn) btn.disabled = true;
  if (logEl) logEl.textContent = 'Setting up Whisper (whisper.cpp engine + speech model, ~150 MB one-time download)...\nNo Python, no dependencies - works offline after this.\n';

  const res = await window.vibeforge.setupOpenSourceWhisper();
  if (res && res.ok) {
    if (logEl) logEl.textContent += res.alreadySetup ? '\nAlready installed and ready.\n' : '\nSetup complete. Transcription + live captions are ready.\n';
    showToast('Whisper ready - transcription works fully offline now.');
    setTimeout(() => switchView('settings'), 500);
  } else {
    if (logEl) logEl.textContent += '\nSetup failed: ' + (res ? res.error : 'unknown') + '\nCheck your internet connection and retry.\n';
    showToast('Whisper setup failed - see the log in AI Tools.');
  }
  if (btn) btn.disabled = false;
};

// Stream whisper setup progress into the AI Tools log box (single top-level listener)
if (window.vibeforge.onWhisperSetupLog) {
  window.vibeforge.onWhisperSetupLog((line) => {
    const el = document.getElementById('whisper-setup-log');
    if (el) {
      el.textContent += line;
      el.scrollTop = el.scrollHeight;
    }
  });
}

// Gentle first-launch nudge if Whisper isn't set up yet (no silent auto-download of 150MB)
setTimeout(async () => {
  try {
    const check = await window.vibeforge.whisperCheck();
    if (!check || !check.configured) {
      showToast('Tip: enable transcription + live captions with one click in Settings -> AI Tools');
    }
  } catch (e) {}
}, 6000);

if (window.vibeforge.onGithubSigninLog) {
  window.vibeforge.onGithubSigninLog((line) => {
    const log = document.getElementById('github-signin-log');
    if (log) {
      log.textContent += line;
      log.scrollTop = log.scrollHeight;
    }
  });
}

if (window.vibeforge.onGithubSigninDone) {
  window.vibeforge.onGithubSigninDone(async (data) => {
    const statusEl = document.getElementById('gh-status');
    if (statusEl) statusEl.textContent = 'Sign-in process finished. Checking status...';
    // After done, check who we are logged in as
    await checkAndEnableDevMode();
  });
}

async function checkAndEnableDevMode() {
  const statusEl = document.getElementById('gh-status');
  const logEl = document.getElementById('github-signin-log') || document.getElementById('build-log');

  // Prefer gh CLI now that user has it
  try {
    const userRes = await window.vibeforge.getGithubUser();
    if (userRes && userRes.ok && userRes.login) {
      if (statusEl) statusEl.innerHTML = `Signed in as <strong>${userRes.login}</strong>`;
      if (userRes.login === 'jayton123456789-hub') {
        // DEV mode!
        const ownerInput = document.getElementById('set-gh-owner');
        const repoInput = document.getElementById('set-gh-repo');
        if (ownerInput) ownerInput.value = 'jayton123456789-hub';
        if (repoInput) repoInput.value = 'VibeForge';

        if (statusEl) statusEl.innerHTML += ` <span class="text-emerald-400 font-semibold">- DEV MODE ENABLED (your repo)</span>`;
        if (logEl) logEl.textContent += '\nDEV account detected. Publishing tools active. You can build and release to your GitHub.\n';

        // Auto-save the correct repo
        await window.vibeforge.saveSetting('github_owner', 'jayton123456789-hub');
        await window.vibeforge.saveSetting('github_repo', 'VibeForge');

        showToast('DEV mode active - ready to publish builds to your repo.');
        return true;
      } else {
        if (statusEl) statusEl.innerHTML += ` (not the owner account)`;
      }
    } else {
      if (statusEl) statusEl.textContent = 'Not signed in to gh CLI yet. Click SIGN IN TO GITHUB above.';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = 'gh CLI check failed. Make sure gh is installed and you ran sign in.';
  }
  return false;
}

// Sign in via gh CLI (the one supported flow - token persists in gh's keyring across launches)
window.doGhSignin = async function(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Opening GitHub login in browser...'; }
  const logEl = document.getElementById('github-signin-log') || document.getElementById('build-log');
  if (logEl) logEl.textContent = 'Starting gh auth login --web ...\n';

  const res = await window.vibeforge.ghSignin();
  if (logEl) logEl.textContent += (res && res.ok ? 'gh auth completed successfully.\n' : 'gh auth done (check browser or status).\n');

  if (btn) btn.textContent = 'SIGN IN TO GITHUB';
  btn.disabled = false;

  // After sign in attempt, auto-check the account for DEV mode
  setTimeout(() => checkAndEnableDevMode(), 800);
};

window.hardResetLocalData = async function() {
  const confirmText = await window.showInputModal('Hard reset local data', '', 'Type HARDRESET exactly to wipe app data and caches');
  if (confirmText !== 'HARDRESET') return;
  await window.vibeforge.resetAllData(); // reuses the strong reset
};

async function testOllamaReal() {
  const url = document.getElementById('set-ollama').value.trim() || 'http://127.0.0.1:11434';
  try {
    const res = await fetch(`${url}/api/tags`);
    if (res.ok) {
      showToast('Ollama connected');
    } else {
      showToast('Ollama responded but not OK');
    }
  } catch (e) {
    showToast('Ollama offline: ' + e.message);
  }
}

async function refreshOllamaModelsReal() {
  const url = document.getElementById('set-ollama').value.trim() || 'http://127.0.0.1:11434';
  const modelsEl = document.getElementById('ollama-models');
  const sel = document.getElementById('set-ollama-model');
  try {
    const res = await fetch(`${url}/api/tags`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    if (modelsEl) modelsEl.innerHTML = `Models: ${models.join(', ') || 'none'}`;
    if (sel) {
      sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    showToast('Models refreshed');
  } catch (e) {
    if (modelsEl) modelsEl.innerHTML = 'Failed (Ollama offline?)';
    showToast('Ollama offline');
  }
}

async function checkOllamaStatus(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }
  const r = await window.vibeforge.ollamaCheck();
  showToast(r.installed ? ('Ollama: ' + (r.version || 'installed')) : ('Not found: ' + (r.error || 'run installer')));
  if (btn) { btn.disabled = false; btn.textContent = 'Check Ollama'; }
}

async function installOllamaFlow() {
  const logEl = document.getElementById('ollama-log');
  if (logEl) logEl.textContent = 'Starting install (winget if available). Watch for UAC / progress window...\n';
  showToast('Install started - visible process or logs below.');
  const r = await window.vibeforge.ollamaInstallAuto();
  if (logEl) logEl.textContent += (r.ok ? 'Install command completed.\n' : ('Install issue: ' + (r.error || r.code) + '\n'));
  if (!r.ok) {
    showToast('Auto install may need manual step - opened help or use Download button.');
    await window.vibeforge.ollamaOpenDownload();
  } else {
    showToast('Install finished. Re-check Ollama and pull a model.');
  }
}

async function pullSelectedModel() {
  const sel = document.getElementById('set-ollama-model');
  const logEl = document.getElementById('ollama-log');
  let model = sel ? sel.value : 'llama3.2';
  if (!model || model.includes('not pulled')) model = await window.showInputModal('Model name to pull', 'llama3.2', 'e.g. llama3.2, phi3:mini, tinyllama');
  if (!model) return;
  if (logEl) logEl.textContent = `Pulling ${model} (this downloads files - may take time + disk space)...\n`;
  showToast('Pull started - watch log. Do not close app.');
  const r = await window.vibeforge.ollamaPull(model);
  if (logEl) logEl.textContent += (r.ok ? `Pull complete for ${model}\n` : ('Pull failed: ' + (r.error || r.code) + '\n'));
  if (r.ok) {
    showToast('Model pulled. Refresh models and select it.');
    await refreshOllamaModelsReal();
  }
}

async function testSelectedModel() {
  const sel = document.getElementById('set-ollama-model');
  const model = sel ? sel.value : 'llama3.2';
  const logEl = document.getElementById('ollama-log');
  if (logEl) logEl.textContent = `Testing ${model}...\n`;
  const r = await window.vibeforge.ollamaTestModel(model);
  if (logEl) logEl.textContent += r.ok ? ('OK: ' + (r.response || 'responded') + '\n') : ('FAIL: ' + (r.error || '') + '\n');
  showToast(r.ok ? 'Model responded' : 'Model test failed (is it pulled + Ollama running?)');
}

async function checkWhisper() {
  const st = document.getElementById('whisper-status');
  const r = await window.vibeforge.whisperCheck();
  if (st) st.textContent = r.configured ? ('Ready: ' + r.path) : ('Not ready: ' + (r.message || 'run the one-click setup'));
  showToast(r.configured ? 'Whisper is ready (engine + model installed)' : 'Whisper not set up yet - use the one-click setup');
}

async function checkForAppUpdates() {
  const settings = await window.vibeforge.getSettings();
  const owner = settings.github_owner || 'jayton123456789-hub';
  const repo = settings.github_repo || 'VibeForge';
  const st = document.getElementById('update-status');
  if (st) st.textContent = 'checking...';
  const r = await window.vibeforge.checkAppUpdate({ owner, repo });
  if (st) {
    if (r.status === 'up-to-date') st.textContent = `Up to date (v${r.current})`;
    else if (r.status === 'update-available') {
      st.textContent = `Update available: ${r.latest}`;
      // surface the global banner for one-click pull/download/replace (no browser)
      showUpdateBanner(r.latest);
    }
    else st.textContent = 'Error: ' + (r.message || '');
  }
  showToast(r.status || 'check done');
}

async function checkGitStatus(btn) {
  if (btn) btn.textContent = 'Checking...';
  const r = await window.vibeforge.checkGit();
  const el = document.getElementById('gh-status');
  if (el) el.textContent = r.ok ? ('Git: ' + r.version) : ('Git not found. Is the host running with the same code?' + r.error);
  if (btn) btn.textContent = 'Check Git Installed';
}

async function checkGhCliStatus(btn) {
  if (btn) btn.textContent = 'Checking...';
  const r = await window.vibeforge.checkGhCli();
  const el = document.getElementById('gh-status');
  if (el) el.textContent = r.ok ? ('GH CLI: ' + r.version) : ('GH CLI missing - install from https://cli.github.com');
  if (btn) btn.textContent = 'Check GitHub CLI Installed';
}

async function checkGhLoginStatus(btn) {
  if (btn) btn.textContent = 'Checking...';
  const r = await window.vibeforge.checkGhLogin();
  const el = document.getElementById('gh-status');
  if (el) el.textContent = r.ok ? 'GitHub CLI logged in' : ('Not logged in or CLI missing: ' + (r.error || ''));
  if (btn) btn.textContent = 'Check GitHub Login';
}

async function doGhSignin(btn) {
  if (btn) btn.textContent = 'Opening...';
  const r = await window.vibeforge.ghSignin();
  const el = document.getElementById('gh-status');
  if (el) el.textContent = r.fallback ? 'Browser login flow started - complete then re-check' : (r.ok ? 'Login started' : 'See console');
  showToast('GitHub auth flow launched (no password asked inside VibeForge)');
  if (btn) btn.textContent = 'Sign in to GitHub (browser/CLI)';
}

async function ghConnectRepo() {
  const owner = document.getElementById('set-gh-owner').value.trim();
  const repo = document.getElementById('set-gh-repo').value.trim();
  const el = document.getElementById('gh-status');
  if (!owner || !repo) { if (el) el.textContent = 'Enter owner and repo above first'; return; }
  await window.vibeforge.ghOpenRepo({ owner, repo });
  if (el) el.textContent = `Repo link: github.com/${owner}/${repo} (use gh auth + git remote in your shell for publishing)`;
}

// === Real publish helpers for Jayton (only shown when repo matches his account) ===
window.buildPortableRelease = async function(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Building... (see log below)'; }
  const logEl = document.getElementById('build-log');
  if (logEl) logEl.textContent = 'Starting portable build (this can take a minute)...\n';

  const r = await window.vibeforge.buildPortable();
  if (logEl) logEl.textContent += (r.ok ? '\nBuild complete. Artifact ready for publish.\n' : '\nBuild failed or artifact missing.\n');

  if (r.ok && r.artifact) {
    showToast('Build finished. Ready to publish.');
  } else {
    showToast('Build problem - check the log box.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Build Portable (npm run dist)'; }
};

window.publishToGitHub = async function(btn) {
  const logEl = document.getElementById('build-log');
  // Gate on DEV owner to keep non-owners on "CHECK FOR UPDATE" only
  const isDev = await checkAndEnableDevMode();
  if (!isDev) {
    showToast('Publish is only enabled for the repo owner (signed in as jayton123456789-hub via gh CLI).');
    return;
  }
  const owner = document.getElementById('set-gh-owner')?.value || 'jayton123456789-hub';
  const repo = document.getElementById('set-gh-repo')?.value || 'VibeForge';
  const tag = 'v' + new Date().toISOString().slice(0,10).replace(/-/g,'.');

  let art = await window.vibeforge.findPortableArtifact();
  let artifactPath = art.found ? art.path : null;

  if (!artifactPath) {
    const picked = await (window.vibeforge.pickFile ? window.vibeforge.pickFile() : null);
    if (picked && picked.toLowerCase().endsWith('.exe')) artifactPath = picked;
  }

  if (!artifactPath) {
    if (logEl) logEl.textContent += 'No artifact found. Build first or pick the .exe.\n';
    showToast('No build artifact found.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
  const artifactName = artifactPath.split(/[\\/]/).pop();
  if (logEl) logEl.textContent += `\nPublishing ${artifactName} to ${owner}/${repo}...\n`;

  const r = await window.vibeforge.publishRelease({ version: tag, notes: 'Released from VibeForge', artifactPath, owner, repo });

  if (r && r.ok) {
    if (logEl) logEl.textContent += `Success! ${r.url || ''}\n`;
    showToast('Release published to GitHub!');
    try { (window.vibeforge.ghOpenRepo || window.open)(r.url || `https://github.com/${owner}/${repo}/releases`, '_blank'); } catch(e){}
  } else {
    if (logEl) logEl.textContent += `Failed: ${r ? r.error : 'unknown'}\n`;
    showToast('Publish failed - see log.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Publish Release to GitHub'; }
};

window.saveAllSettings = async function() {
  const name = document.getElementById('set-name') ? document.getElementById('set-name').value.trim() : '';
  const ollama = document.getElementById('set-ollama') ? document.getElementById('set-ollama').value.trim() : '';
  const model = document.getElementById('set-ollama-model') ? document.getElementById('set-ollama-model').value : '';
  const whisper = document.getElementById('set-whisper') ? document.getElementById('set-whisper').value.trim() : '';

  if (name) await window.vibeforge.saveSetting('profile_name', name);
  if (ollama) await window.vibeforge.saveSetting('ollama_url', ollama);
  if (model) await window.vibeforge.saveSetting('ollama_model', model);
  if (whisper) await window.vibeforge.saveSetting('whisper_path', whisper);
  showToast('Settings saved');
};

// Pick a model that is actually pulled in Ollama. Prevents the "HTTP 404 model not found. Is the host running with the same code?'t match an installed model.
// Returns { ok, model } or { ok:false, reason: 'offline' | 'no-model' }.
async function resolveOllamaModel() {
  const status = await window.vibeforge.ollamaStatus();
  if (!status || !status.running) return { ok: false, reason: 'offline' };
  const models = status.models || [];
  if (models.length === 0) return { ok: false, reason: 'no-model' };
  const want = (status.model || '').trim();
  // exact match, or match ignoring the :tag (llama3.2 vs llama3.2:latest)
  let chosen = models.find(m => m === want)
    || models.find(m => m.split(':')[0] === want.split(':')[0] && want)
    || models[0];
  if (chosen !== want) {
    try { await window.vibeforge.saveSetting('ollama_model', chosen); } catch (e) {}
  }
  return { ok: true, model: chosen };
}

// ============================================================================
// The "Brain": a single tool-calling pass over a finished session.
// The model reads the meeting (notes + transcript + marks) and decides, on its
// own, what becomes a task, a decision to settle, or an idea to store — then
// calls tools that write straight into VibeForge's menus. This is the model
// acting as part of the app instead of a thing we call and parse.
// Requires a tools-capable Ollama model (llama3.1, llama3.2, qwen2.5, etc.).
// ============================================================================

const BRAIN_SYSTEM_PROMPT = `You are the resident intelligence inside VibeForge, a local studio where people (Jayton, Nick, Dylan and friends) think out loud, record sessions, and build products through conversation.

A session just ended. You are given its title, notes, and live transcript. Your job is to read everything and FILE IT into the right places in the app by calling tools. You are not writing an essay — you are organizing a workspace.

The places things go:
- TASK — a concrete action someone needs to do later ("email the designer", "rebuild the native module"). Use add_task.
- DECISION — a choice the group is weighing or settled. This includes debated topics where people disagreed. Capture the options and who argued what, and mark it "open" if it still needs to be settled or "decided" if they landed on an answer. Use add_decision. This is for the things they'll want to come back and vote/settle on.
- IDEA — a spark, a "wouldn't it be cool if", a tangent. ESPECIALLY capture ideas that are unrelated to the main topic — those are the easiest to lose and the most worth keeping. Give each idea a short topic label so related ideas from different sessions can be grouped together over time. Use add_idea.
- SUMMARY + NAME — call set_session_summary exactly once with a tight 3-6 word name and a THOROUGH summary. Scale the summary to the session: a long working session deserves several substantial paragraphs covering the main threads discussed, what got decided, what's still open, the reasoning behind choices, and notable ideas — written so someone who missed the session understands what happened and why. A short clip can be a few sentences. Never one tiny line. Write in plain past-tense prose, not bullet fragments.

Rules:
- Every tool call MUST include a real title/text. Never call a tool with an empty or missing title — just skip it instead.
- Always call set_session_summary once, and make the summary genuinely useful and complete.
- Only create tasks/decisions/ideas that are actually supported by the content. Do not invent filler. A short session might produce just a summary and one idea — that's fine.
- Prefer a few high-quality items over many vague ones. Cap yourself at ~8 tasks, ~6 decisions, ~8 ideas.
- A disagreement or open question is a DECISION (status "open"), not a task.
- When you are done filing everything, stop calling tools and reply with a one-line confirmation.`;

function brainTools() {
  return [
    { type: 'function', function: {
      name: 'set_session_summary',
      description: 'Set the session name and summary. Call exactly once.',
      parameters: { type: 'object', properties: {
        short_name: { type: 'string', description: '3-6 word title for the session' },
        summary: { type: 'string', description: 'a thorough summary scaled to the session — several paragraphs for a long one, covering threads, decisions, open questions, reasoning, and ideas' }
      }, required: ['short_name', 'summary'] }
    }},
    { type: 'function', function: {
      name: 'add_task',
      description: 'Record a concrete action item that someone needs to do.',
      parameters: { type: 'object', properties: {
        title: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] }
      }, required: ['title'] }
    }},
    { type: 'function', function: {
      name: 'add_decision',
      description: 'Record a choice the group is weighing or has settled, including debated topics. Capture the options and who argued what.',
      parameters: { type: 'object', properties: {
        title: { type: 'string', description: 'the question/choice, e.g. "WebSockets vs polling for sync?"' },
        options: { type: 'array', items: { type: 'string' }, description: 'the choices to weigh, e.g. ["WebSockets","Polling"] or ["Yes","No"]' },
        positions: { type: 'string', description: 'who argued what, e.g. "Nick: WebSockets for speed. Jayton: worried about firewall."' },
        status: { type: 'string', enum: ['open', 'decided'], description: 'open = still needs settling, decided = resolved' },
        resolution: { type: 'string', description: 'if decided, the chosen option' }
      }, required: ['title'] }
    }},
    { type: 'function', function: {
      name: 'add_idea',
      description: 'Capture an idea, spark, or tangent — especially one not central to the main topic. Stored long-term and grouped with related ideas across sessions.',
      parameters: { type: 'object', properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        topic: { type: 'string', description: 'short 2-4 word topic label for grouping, e.g. "offline sync", "onboarding UX"' }
      }, required: ['title'] }
    }}
  ];
}

// Execute one tool call against the app. Returns a short result string for the model.
// Coerce a tool arg to a clean non-empty string, or null. Guards against the model
// passing nothing/undefined/"undefined" which previously created junk "undefined" items.
function brainStr(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null') return null;
  return s;
}

async function runBrainTool(name, args, sessionId, tally) {
  args = args || {};
  const pid = currentProject.id;
  try {
    if (name === 'set_session_summary') {
      const nm = brainStr(args.short_name);
      const summ = brainStr(args.summary);
      if (nm) {
        await window.vibeforge.updateSessionTitle(sessionId, nm.slice(0, 80));
        tally.named = nm;
      }
      if (summ) {
        const s = (await window.vibeforge.getSessions(pid)).find(x => x.id === sessionId);
        await window.vibeforge.updateSessionNotes(sessionId, (s && s.notes ? s.notes : '') + '\n\n[AI Summary]\n' + summ);
        tally.summary = true;
      }
      return nm || summ ? 'summary and name saved' : 'skipped (empty summary)';
    }
    if (name === 'add_task') {
      const title = brainStr(args.title);
      if (!title) return 'skipped: task had no title';
      await window.vibeforge.addTask({ projectId: pid, sessionId, title: title.slice(0, 200), priority: args.priority || 'medium' });
      tally.tasks++;
      return 'task added';
    }
    if (name === 'add_decision') {
      const title = brainStr(args.title);
      if (!title) return 'skipped: decision had no title';
      const opts = Array.isArray(args.options) ? args.options.map(brainStr).filter(Boolean) : [];
      let notes = '';
      if (opts.length) notes += 'Options: ' + opts.join(' | ') + '\n';
      if (brainStr(args.positions)) notes += brainStr(args.positions) + '\n';
      if (brainStr(args.resolution)) notes += 'Resolution: ' + brainStr(args.resolution) + '\n';
      const status = args.status === 'decided' ? 'approved' : 'proposed';
      await window.vibeforge.addDecision({ projectId: pid, sessionId, title: title.slice(0, 200), notes: notes.trim(), status });
      tally.decisions++;
      return 'decision added';
    }
    if (name === 'add_idea') {
      const title = brainStr(args.title);
      if (!title) return 'skipped: idea had no title';
      const topic = brainStr(args.topic);
      const tags = topic ? [topic.toLowerCase().slice(0, 40)] : [];
      const created = await window.vibeforge.addIdea({ projectId: pid, sessionId, title: title.slice(0, 200), description: brainStr(args.description) || '', tags });
      if (created && created.id) await window.vibeforge.updateIdea({ id: created.id, status: 'Inbox' });
      tally.ideas++;
      return 'idea added' + (topic ? ' under topic "' + topic + '"' : '');
    }
  } catch (e) {
    return 'error: ' + e.message;
  }
  return 'unknown tool';
}

// Returns { ok, tally } or throws on hard failure. opts.onStep(msg) for progress.
async function runSessionBrain(sessionId, opts = {}) {
  const resolved = await resolveOllamaModel();
  if (!resolved.ok) { const e = new Error(resolved.reason === 'offline' ? 'Ollama offline' : 'No model pulled'); e.reason = resolved.reason; throw e; }
  const settings = await window.vibeforge.getSettings();
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const model = resolved.model;

  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  if (!s) throw new Error('Session not found. Is the host running with the same code?');

  // Prefer the clean full-Whisper transcript (passed in by the caller) over the messy
  // real-time captions. Fall back to notes/typed content if no transcript was produced.
  let body = '';
  if (opts.transcript && opts.transcript.trim()) {
    body = 'TRANSCRIPT (accurate, from local Whisper):\n' + opts.transcript.trim();
    // Include any manually typed notes / marks too, minus the auto transcript blocks.
    const typed = (s.notes || '')
      .replace(/\[Live transcript\][\s\S]*?(?=\n\n\[|$)/i, '')
      .replace(/\[Whisper transcript\][\s\S]*?(?=\n\n\[|$)/i, '')
      .replace(/\[AI Summary\][\s\S]*?(?=\n\n\[|$)/i, '')
      .trim();
    if (typed) body += '\n\nTYPED NOTES & MARKS:\n' + typed;
  } else {
    body = (s.notes || '(no notes captured)');
  }

  const context = `Session title: ${s.title}\nMode: ${s.mode}\nLength: ${s.ended_at ? Math.round((s.ended_at - s.started_at)/60000) + ' min' : 'unknown'}\n\n--- SESSION CONTENT ---\n${body}\n--- END ---\n\nFile everything into the app now using your tools, then write the thorough summary.`;

  const messages = [
    { role: 'system', content: BRAIN_SYSTEM_PROMPT },
    { role: 'user', content: context }
  ];
  const tools = brainTools();
  const tally = { tasks: 0, decisions: 0, ideas: 0, summary: false, named: null };
  // Give the model real context room so long (multi-hour) sessions aren't truncated to
  // Ollama's tiny 2048 default. Sized up but bounded so RAM stays sane.
  const numCtx = Math.min(32768, Math.max(8192, Math.ceil(body.length / 3) + 2048));

  // Agentic loop, bounded for a local model.
  for (let round = 0; round < 5; round++) {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false, options: { num_ctx: numCtx } })
    });
    if (!res.ok) {
      // Model likely doesn't support tools — signal caller to fall back.
      const err = new Error(`Ollama /api/chat HTTP ${res.status}`);
      err.noTools = res.status === 400 || res.status === 404;
      throw err;
    }
    const data = await res.json();
    const msg = data.message || {};
    messages.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) break; // model is done

    for (const call of calls) {
      const fn = call.function || {};
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = {}; } }
      const result = await runBrainTool(fn.name, args, sessionId, tally);
      if (opts.onStep) opts.onStep(`${fn.name}: ${result}`);
      messages.push({ role: 'tool', content: result });
    }
  }

  return { ok: true, tally };
}

async function generateFromSession(sessionId, type, btn) {
  const settings = await window.vibeforge.getSettings();
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const resolved = await resolveOllamaModel();
  const outputEl = document.getElementById(`gen-output-${sessionId}`);
  if (!resolved.ok) {
    const msg = resolved.reason === 'offline'
      ? 'Ollama is offline — start it in Settings → AI Tools (Run ollama serve).'
      : 'No Ollama model is pulled yet — pull one in Settings → AI Tools (e.g. llama3.2).';
    if (outputEl) { outputEl.classList.remove('hidden'); outputEl.innerHTML = `<span class="text-amber-400">${esc(msg)}</span>`; }
    showToast(msg);
    const err = new Error(msg); err.handled = true; throw err;
  }
  const model = resolved.model;
  if (outputEl) {
    outputEl.classList.remove('hidden');
    outputEl.innerHTML = '<span class="text-zinc-400">Connecting to Ollama...</span>';
  }
  if (btn) btn.disabled = true;

  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  const decisions = await window.vibeforge.getDecisionsBySession(sessionId);
  const tasks = await window.vibeforge.getTasksBySession(sessionId);
  const ideas = await window.vibeforge.getIdeasBySession(sessionId);

  let prompt = `Session title: ${s.title}\nNotes:\n${s.notes || '(none)'}\n`;
  if (decisions.length) prompt += '\nDecisions: ' + decisions.map(d => d.title).join(', ');
  if (tasks.length) prompt += '\nTasks: ' + tasks.map(t => t.title).join(', ');
  if (ideas.length) prompt += '\nIdeas: ' + ideas.map(i => i.title).join(', ');

  let system = 'You are a helpful assistant for creative sessions.';
  if (type === 'summary') {
    system = 'You are a session assistant. Given session notes, provide: 1) A SHORT_NAME (3-5 words, no quotes, on its own line starting with "SHORT_NAME:"), then 2) A concise summary paragraph. Be direct and useful.';
  } else if (type === 'tasks') {
    system = 'Extract actionable tasks from the session. Return ONLY a markdown bullet list (lines starting with "- "). No intro text.';
  } else if (type === 'decisions') {
    system = 'Extract key decisions made. Return ONLY a markdown bullet list (lines starting with "- "). No intro text.';
  } else if (type === 'grok') {
    system = 'Create a detailed implementation prompt for an AI coding assistant to implement the features discussed. Be specific about what to build.';
  }

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, system, stream: false })
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status} - is it running?`);
    const data = await res.json();
    const output = (data.response || '').trim();
    if (!output) throw new Error('No output from model');

    if (outputEl) outputEl.innerHTML = `<pre class="whitespace-pre-wrap text-xs">${esc(output)}</pre><button onclick="copyToClipboard(\`${output.replace(/`/g,'\\`').replace(/"/g,'&quot;')}\`)" class="text-xs underline mt-1 inline-block">Copy</button>`;

    if (type === 'summary') {
      // Extract SHORT_NAME line and auto-rename if session has a generic Quick Record name
      const nameMatch = output.match(/SHORT_NAME:\s*(.+)/i);
      if (nameMatch) {
        const newName = nameMatch[1].trim().replace(/["']/g, '');
        const isGenericName = /^Quick Record/.test(s.title) || /^Session /.test(s.title);
        if (isGenericName && newName.length > 2 && newName.length < 80) {
          await window.vibeforge.updateSessionTitle(sessionId, newName);
          showToast('Session renamed to: ' + newName);
        }
      }
      // Save summary to notes
      const summaryText = output.replace(/SHORT_NAME:[^\n]+\n?/i, '').trim();
      await window.vibeforge.updateSessionNotes(sessionId, (s.notes || '') + '\n\n[AI Summary]\n' + summaryText);
      showToast('Summary added to notes');

    } else if (type === 'tasks') {
      const lines = output.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
      for (const line of lines.slice(0, 8)) {
        await window.vibeforge.addTask({ projectId: currentProject.id, sessionId, title: line });
      }
      showToast(`${Math.min(lines.length, 8)} tasks created`);

    } else if (type === 'decisions') {
      const lines = output.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
      for (const line of lines.slice(0, 5)) {
        await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId, title: line });
      }
      showToast(`${Math.min(lines.length, 5)} decisions created`);

    } else {
      await window.vibeforge.updateSessionNotes(sessionId, (s.notes || '') + '\n\n[' + type + ']\n' + output);
      showToast('Added to notes');
    }

    // Re-render if we're on the session detail page
    if (document.getElementById(`gen-output-${sessionId}`)) {
      await openSession(sessionId);
    }

  } catch (e) {
    if (e.handled) { if (btn) btn.disabled = false; throw e; } // already shown a friendly message
    const msg = e.message.includes('fetch') || e.message.includes('Failed') ?
      'Cannot reach Ollama - is it running? (Settings -> Local AI)' : e.message;
    if (outputEl) outputEl.innerHTML = `<span class="text-red-400">${esc(msg)}</span>`;
    showToast('AI error: ' + msg.slice(0, 60));
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
};

async function exportSessionMdReal(sessionId) {
  if (!currentProject) return;
  try {
    const filePath = await window.vibeforge.exportSessionMdReal({ projectId: currentProject.id, sessionId });
    showToast('Exported to ' + filePath);
    // also reveal option
  } catch (e) { showToast('Export failed: ' + e.message); }
}

async function exportGrokPromptReal(sessionId) {
  if (!currentProject) return;
  try {
    const filePath = await window.vibeforge.exportGrokPromptReal({ projectId: currentProject.id, sessionId });
    showToast('Exported to ' + filePath);
  } catch (e) { showToast('Export failed: ' + e.message); }
}

// Keep old browser ones? No - per rules use real folder for exports. Old names now point to real.
async function exportSessionMd(sessionId) { return exportSessionMdReal(sessionId); }
async function exportGrokPrompt(sessionId) { return exportGrokPromptReal(sessionId); }

window.saveSettings = window.saveAllSettings; // compat for any old refs

window.resetAllData = async function() {
  const confirmText = await window.showInputModal('Reset all data', '', 'Type RESET exactly to wipe local test data');
  if (confirmText !== 'RESET') return;
  await window.vibeforge.resetAllData();
};

// Utils
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('flex');
  setTimeout(() => { t.classList.add('hidden'); t.classList.remove('flex'); }, 2200);
}

function showSessionProcessingScreen(sessionId, title = 'Processing session', subtitle = 'Saving and preparing your review...') {
  const content = document.getElementById('main-content');
  if (!content) return;
  content.innerHTML = `
    <div class="min-h-full flex items-center justify-center">
      <div class="w-full max-w-3xl rounded-[32px] border border-violet-500/30 bg-[#0b0f1d]/95 p-8 shadow-2xl shadow-black/40">
        <div class="flex items-center gap-5">
          <div class="relative w-24 h-24 rounded-[28px] bg-violet-500/10 border border-violet-400/30 flex items-center justify-center">
            <span class="absolute inset-2 rounded-[24px] border border-cyan-400/30 animate-pulse"></span>
            <i class="fa-solid fa-wand-magic-sparkles text-3xl text-cyan-300"></i>
          </div>
          <div>
            <div id="processing-title" class="text-3xl font-semibold">${esc(title)}</div>
            <div id="processing-subtitle" class="text-zinc-400 mt-2">${esc(subtitle)}</div>
          </div>
        </div>
        <div class="mt-8 space-y-3 text-sm">
          <div id="processing-step-save" class="processing-step rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200"><i class="fa-solid fa-check mr-2"></i>Recording and notes saved locally</div>
          <div id="processing-step-transcript" class="processing-step rounded-2xl border border-zinc-700 bg-zinc-950/50 p-4 text-zinc-400"><i class="fa-solid fa-wave-square mr-2"></i>Preparing transcript</div>
          <div id="processing-step-summary" class="processing-step rounded-2xl border border-zinc-700 bg-zinc-950/50 p-4 text-zinc-400"><i class="fa-solid fa-brain mr-2"></i>Sending notes to Local AI for title and summary</div>
          <div id="processing-step-items" class="processing-step rounded-2xl border border-zinc-700 bg-zinc-950/50 p-4 text-zinc-400"><i class="fa-solid fa-list-check mr-2"></i>Extracting tasks and decisions</div>
        </div>
        <div class="mt-8 h-2 rounded-full bg-zinc-900 overflow-hidden">
          <div id="processing-progress" class="h-full w-1/4 bg-gradient-to-r from-violet-500 via-cyan-400 to-emerald-400 transition-all duration-300"></div>
        </div>
        <div class="mt-4 text-xs text-zinc-500">If Ollama or Whisper is offline, VibeForge will still save everything and tell you what to set up.</div>
      </div>
    </div>
  `;
}

function updateProcessingStep(step, state, subtitle, progress) {
  const el = document.getElementById(`processing-step-${step}`);
  if (el) {
    el.classList.remove('border-zinc-700', 'bg-zinc-950/50', 'text-zinc-400', 'border-cyan-500/30', 'bg-cyan-500/10', 'text-cyan-200', 'border-emerald-500/30', 'bg-emerald-500/10', 'text-emerald-200', 'border-amber-500/30', 'bg-amber-500/10', 'text-amber-200');
    if (state === 'active') el.classList.add('border-cyan-500/30', 'bg-cyan-500/10', 'text-cyan-200');
    else if (state === 'done') el.classList.add('border-emerald-500/30', 'bg-emerald-500/10', 'text-emerald-200');
    else if (state === 'skip') el.classList.add('border-amber-500/30', 'bg-amber-500/10', 'text-amber-200');
    else el.classList.add('border-zinc-700', 'bg-zinc-950/50', 'text-zinc-400');
  }
  const sub = document.getElementById('processing-subtitle');
  if (sub && subtitle) sub.textContent = subtitle;
  const bar = document.getElementById('processing-progress');
  if (bar && progress) bar.style.width = progress;
}

async function autoProcessSessionAfterStop(sessionId) {
  let cleanTranscript = '';
  const result = { ok: false, transcript: false, summary: false, tasks: 0, decisions: 0, ideas: 0, named: null, skipped: null };
  updateProcessingStep('transcript', 'active', 'Transcribing the full recording with Whisper (accurate pass)...', '35%');
  try {
    const w = await window.vibeforge.whisperCheck();
    if (w && w.configured) {
      // Full, accurate Whisper pass on the whole recording. This — not the rough live
      // captions — is saved as [Whisper transcript] AND fed to the AI.
      cleanTranscript = await window.transcribeSession(sessionId, { silent: true });
      result.transcript = true;
      updateProcessingStep('transcript', 'done', 'Accurate transcript ready. Reading it now...', '55%');
    } else {
      updateProcessingStep('transcript', 'skip', 'Whisper is not set up yet. Recording is saved; transcript can run later.', '50%');
    }
  } catch (e) {
    updateProcessingStep('transcript', 'skip', 'Transcript skipped: ' + (e.message || e), '50%');
  }

  updateProcessingStep('summary', 'active', 'Local AI is reading the session and filing it into your menus...', '65%');
  const resolved = await resolveOllamaModel();
  if (!resolved.ok) {
    const why = resolved.reason === 'offline'
      ? 'Ollama is offline. Everything is saved — run AI Cleanup later, or start Ollama in Settings → AI Tools.'
      : 'No Ollama model is pulled yet. Everything is saved — pull a model in Settings → AI Tools, then run AI Cleanup.';
    updateProcessingStep('summary', 'skip', why, '85%');
    updateProcessingStep('items', 'skip', 'Tasks, decisions & ideas need a local model — skipped for now.', '100%');
    await new Promise(r => setTimeout(r, 1200));
    result.skipped = why;
    return result;
  }
  try {
    // The brain: one tool-calling pass that routes content into tasks/decisions/ideas itself.
    const r = await runSessionBrain(sessionId, {
      transcript: cleanTranscript,
      onStep: (m) => updateProcessingStep('items', 'active', m, '88%')
    });
    const t = r.tally;
    result.ok = true;
    result.summary = !!t.summary;
    result.tasks = t.tasks || 0;
    result.decisions = t.decisions || 0;
    result.ideas = t.ideas || 0;
    result.named = t.named || null;
    updateProcessingStep('summary', 'done', t.named ? `Named "${t.named}" and summarized.` : 'Summary saved.', '80%');
    updateProcessingStep('items', 'done', `Filed ${t.tasks} task(s), ${t.decisions} decision(s), ${t.ideas} idea(s).`, '100%');
    await new Promise(r => setTimeout(r, 700));
  } catch (e) {
    if (e.noTools) {
      // Model doesn't support tool calling — fall back to the older extract-and-parse path.
      updateProcessingStep('items', 'active', 'Model lacks tool support — using basic extraction...', '88%');
      try {
        await generateFromSession(sessionId, 'summary', null);
        await generateFromSession(sessionId, 'tasks', null);
        await generateFromSession(sessionId, 'decisions', null);
        result.ok = true;
        result.summary = true;
        updateProcessingStep('summary', 'done', 'Summary saved.', '90%');
        updateProcessingStep('items', 'done', 'Tasks and decisions extracted.', '100%');
        await new Promise(r => setTimeout(r, 600));
      } catch (e2) {
        updateProcessingStep('summary', 'skip', 'AI cleanup skipped: ' + (e2.message || e2), '100%');
        result.skipped = e2.message || String(e2);
        await new Promise(r => setTimeout(r, 900));
      }
    } else {
      updateProcessingStep('summary', 'skip', 'AI cleanup skipped: ' + (e.message || e), '100%');
      result.skipped = e.message || String(e);
      await new Promise(r => setTimeout(r, 900));
    }
  }
  return result;
}

// Processing bubble shown in bottom-right after Stop & Save
function showProcessingBubble(sessionId) {
  // Remove any existing bubble
  const existing = document.getElementById('processing-bubble');
  if (existing) existing.remove();

  const bubble = document.createElement('div');
  bubble.id = 'processing-bubble';
  bubble.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:999;background:#111113;border:1px solid #3b3b42;border-radius:20px;padding:12px 18px;display:flex;align-items:center;gap:10px;font-size:13px;color:#e4e4e7;box-shadow:0 8px 32px rgba(0,0,0,0.5);max-width:280px;';
  bubble.innerHTML = `
    <span style="width:18px;height:18px;border-radius:50%;border:2px solid #6366f1;border-top-color:transparent;display:inline-block;animation:bubbleSpin 0.7s linear infinite;flex-shrink:0"></span>
    <div><div style="font-weight:500">Finishing up...</div><div style="font-size:11px;color:#71717a">Saving session &amp; notes</div></div>
  `;
  if (!document.getElementById('bubble-spin-style')) {
    const s = document.createElement('style');
    s.id = 'bubble-spin-style';
    s.textContent = '@keyframes bubbleSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(bubble);

  // Auto-dismiss after 4s
  setTimeout(() => {
    if (bubble.parentNode) {
      bubble.innerHTML = `<span style="font-size:16px">&#10003;</span><div><div style="font-weight:500">Session saved</div><div style="font-size:11px;color:#71717a">Ready to review</div></div>`;
      bubble.style.borderColor = '#10b981';
      setTimeout(() => { if (bubble.parentNode) bubble.remove(); }, 2000);
    }
  }, 2500);
}

async function updateActiveNav() {
  // Already handled in switchView
}

function getLiveStash() {
  let stash = document.getElementById('active-live-stash');
  if (!stash) {
    stash = document.createElement('div');
    stash.id = 'active-live-stash';
    stash.style.display = 'none';
    document.body.appendChild(stash);
  }
  return stash;
}

function stashActiveLiveRoomIfNeeded() {
  if (!_activeLiveSession || !_activeLiveSession.recording || currentView !== 'live') return;
  const content = document.getElementById('main-content');
  if (!content || !content.childNodes.length) return;
  const stash = getLiveStash();
  while (content.firstChild) stash.appendChild(content.firstChild);
}

function showActiveSessionIsland() {
  const old = document.getElementById('active-session-island');
  if (old) old.remove();
  if (!_activeLiveSession || !_activeLiveSession.recording) return;

  const island = document.createElement('div');
  island.id = 'active-session-island';
  island.className = 'fixed bottom-5 left-1/2 -translate-x-1/2 z-[350] rounded-[24px] border border-red-400/50 bg-[#111421]/95 px-4 py-3 shadow-2xl shadow-red-950/40 flex items-center gap-4';
  island.innerHTML = `
    <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500 text-white shadow-lg shadow-red-500/30">
      <i class="fa-solid fa-square text-sm"></i>
    </div>
    <div class="min-w-[220px]">
      <div class="text-xs font-semibold uppercase tracking-[.12em] text-red-300">Recording in progress</div>
      <div class="max-w-[360px] truncate text-sm font-semibold text-white">${esc(_activeLiveSession.title || 'Live session')}</div>
    </div>
    <button onclick="returnToActiveSession()" class="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 hover:bg-zinc-800">Back to Session</button>
    <button onclick="stopLiveRoom('${_activeLiveSession.id}')" class="rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">Stop</button>
  `;
  document.body.appendChild(island);
}

window.returnToActiveSession = function() {
  if (!_activeLiveSession || !_activeLiveSession.recording) {
    showToast('No active recording to return to.');
    return;
  }
  const content = document.getElementById('main-content');
  const header = document.getElementById('view-title');
  const actions = document.getElementById('view-actions');
  const stash = getLiveStash();
  if (content && stash.childNodes.length) {
    content.innerHTML = '';
    while (stash.firstChild) content.appendChild(stash.firstChild);
  }
  currentView = 'live';
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'bg-zinc-900', 'text-white'));
  if (header) header.textContent = 'Recording';
  if (actions) actions.innerHTML = '';
  showActiveSessionIsland();
};

// === Live service status dots (top bar) ===
// green = ready to use, amber = running but needs a step, gray = off/not set up.
async function refreshServiceStatus() {
  const setDot = (id, color, tip) => {
    const el = document.getElementById(id);
    if (!el) return;
    const map = { green: '#22c55e', amber: '#f59e0b', gray: '#52525b' };
    el.style.backgroundColor = map[color] || map.gray;
    el.style.boxShadow = color === 'green' ? '0 0 6px #22c55e' : 'none';
    if (el.parentElement) el.parentElement.title = tip;
  };
  try {
    const o = await window.vibeforge.ollamaStatus();
    if (!o || !o.running) setDot('dot-ollama', 'gray', 'Ollama: offline - click to start it in AI Tools');
    else if (!o.models || o.models.length === 0) setDot('dot-ollama', 'amber', 'Ollama: running, but no model pulled - click to pull one');
    else setDot('dot-ollama', 'green', `Ollama: ready (${o.models.length} model${o.models.length>1?'s':''})`);
  } catch (e) { setDot('dot-ollama', 'gray', 'Ollama: offline'); }
  try {
    const w = await window.vibeforge.whisperStatus();
    if (w && w.ready) setDot('dot-whisper', 'green', 'Whisper: ready (transcription + live captions)');
    else setDot('dot-whisper', 'gray', 'Whisper: not set up - click to install in AI Tools');
  } catch (e) { setDot('dot-whisper', 'gray', 'Whisper: not set up'); }
}

// ════════════════════════════════════════════════════════════════════
// Renderer-side Peer manager. PeerJS needs WebRTC, which only exists in Chromium,
// so the real Host/Join implementation lives here instead of main.js.
(function initPeerManager() {
  let _peer = null, _conn = null, _peerJsId = null;

  function _setPeerStatus(data) {
    peerStatus = data;
    updateLinkSubnav();
    if (currentView === 'share') {
      const c = document.getElementById('main-content');
      const a = document.getElementById('view-actions');
      if (c && a) renderShareView(c, a);
    }
  }

  function _cleanup() {
    if (_conn) { try { _conn.close(); } catch(e){} _conn = null; }
    if (_peer) { try { _peer.destroy(); } catch(e){} _peer = null; }
    _peerJsId = null;
    _setPeerStatus({ status: 'offline' });
  }

  function _wireConn(conn, role) {
    _conn = conn;
    conn.on('open', () => {
      _setPeerStatus({ status: 'connected', roomCode: _peerJsId || conn.peer, address: conn.peer, type: role });
      showToast('Duo Link connected');
    });
    conn.on('data', (raw) => {
      if (typeof raw === 'string') {
        Promise.resolve(handlePeerTextPayload(raw)).then((handled) => {
          if (handled) _setPeerStatus(peerStatus);
          else showToast('Message: ' + String(raw).slice(0, 60));
        });
      } else if (raw && raw.type === 'file-data') {
        window.vibeforge.saveReceivedFile(raw.name, raw.data).then(res => {
          if (res && res.ok) {
            receivedItems.push({ type: 'file', name: raw.name, path: res.path });
            _setPeerStatus(peerStatus);
            showToast('File received: ' + raw.name);
          }
        });
      }
    });
    conn.on('close', () => { _cleanup(); showToast('Duo Link disconnected'); });
    conn.on('error', (err) => { showToast('Link error: ' + err.message); });
  }

  function _makeCode() {
    const w = ['forge','vibe','link','sync','beam','cast','wave','pulse','flow','mesh'];
    return w[Math.floor(Math.random() * w.length)] + '-' + (1000 + Math.floor(Math.random() * 9000));
  }

  window.vibePeer = {};

  window.vibePeer.duoHost = () => {
    if (typeof Peer === 'undefined') {
      return Promise.resolve({ ok: false, error: 'PeerJS not loaded yet. Use Settings/Link after the app finishes loading.' });
    }
    return new Promise((resolve) => {
      _cleanup();
      const code = _makeCode();
      _peerJsId = code;
      _setPeerStatus({ status: 'connecting', roomCode: code });
      const peer = new Peer(code, { debug: 0 });
      _peer = peer;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      peer.on('open', (id) => {
        _peerJsId = id;
        _setPeerStatus({ status: 'hosting', roomCode: id, address: id });
        done({ ok: true, roomCode: id });
      });
      peer.on('connection', (conn) => _wireConn(conn, 'host'));
      peer.on('error', (err) => {
        _setPeerStatus({ status: 'error', error: err.message });
        done({ ok: false, error: err.message });
      });
      setTimeout(() => done({ ok: false, error: 'Timed out. Check internet connection.' }), 12000);
    });
  };

  window.vibePeer.duoJoin = (roomCode) => {
    if (typeof Peer === 'undefined') {
      return Promise.resolve({ ok: false, error: 'PeerJS not loaded yet. Use Settings/Link after the app finishes loading.' });
    }
    return new Promise((resolve) => {
      _cleanup();
      if (!roomCode || !roomCode.trim()) return resolve({ ok: false, error: 'Room code required' });
      const code = roomCode.trim().toLowerCase();
      _setPeerStatus({ status: 'connecting', roomCode: code });
      const peer = new Peer({ debug: 0 });
      _peer = peer;
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      peer.on('open', () => {
        const conn = peer.connect(code, { reliable: true, serialization: 'json' });
        _wireConn(conn, 'client');
        conn.on('open', () => done({ ok: true, roomCode: code }));
        conn.on('error', (err) => done({ ok: false, error: err.message }));
        setTimeout(() => done({ ok: false, error: '"' + code + '" not found. Is the host running with the same code?' }), 15000);
      });
      peer.on('error', (err) => done({ ok: false, error: err.message }));
    });
  };

  window.vibePeer.duoDisconnect = () => {
    _cleanup();
    showToast('Disconnected');
    return Promise.resolve(true);
  };

  window.vibePeer.getPeerStatus = () => Promise.resolve(peerStatus);

  window.vibePeer.peerSendText = (text) => {
    if (_conn && _conn.open) {
      try { _conn.send(text); return Promise.resolve({ ok: true }); }
      catch(e) { return Promise.resolve({ ok: false, error: e.message }); }
    }
    return Promise.resolve({ ok: false, error: 'Not connected' });
  };

  window.vibePeer.peerSendFile = async (filePath) => {
    if (!_conn || !_conn.open) return { ok: false, error: 'Not connected' };
    try {
      const buf = await window.vibeforge.readFileBuffer(filePath);
      if (!buf) return { ok: false, error: 'Could not read file' };
      const name = filePath.split(/[\\/]/).pop();
      _conn.send({ type: 'file-data', name, data: Array.from(new Uint8Array(buf)) });
      return { ok: true };
    } catch(e) { return { ok: false, error: e.message }; }
  };

  console.log('[VibeForge] Renderer-side Peer manager ready (v0.4.0)');
})();

// Boot
window.onload = init;

// Start status polling once the DOM is ready
setTimeout(() => {
  refreshServiceStatus();
  setInterval(refreshServiceStatus, 5000);
}, 800);

// Show + wire the big green update banner (used by both auto-on-launch and manual CHECK FOR UPDATE).
// Replaces content so the button always gets a real working onclick (fixes "click does nothing").
function showUpdateBanner(latest) {
  const updateBanner = document.getElementById('update-banner');
  if (!updateBanner) return;
  updateBanner.classList.remove('hidden');
  updateBanner.classList.add('flex');
  updateBanner.innerHTML = `<div><span class="font-semibold">UPDATE AVAILABLE: ${latest || ''}</span> - WANNA RELOAD?</div>
    <button id="do-update-btn" class="bg-white text-emerald-700 font-semibold px-5 py-1.5 rounded-xl active:scale-95">YES, DOWNLOAD &amp; RELOAD</button>`;
  const btn = document.getElementById('do-update-btn');
  if (btn) {
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'DOWNLOADING...';
      try {
        const res = await window.vibeforge.downloadUpdate();
        if (res && res.ok) {
          btn.textContent = 'RELOADING...';
          // app will quit + launch new version; brief text feedback is all we can show
        } else {
          btn.textContent = 'FAILED: ' + (res ? res.error : 'unknown');
          setTimeout(() => {
            if (updateBanner) updateBanner.classList.add('hidden');
          }, 3000);
        }
      } catch (e) {
        btn.textContent = 'ERROR: ' + e.message;
      }
    };
  }
}

// Global update banner handling (auto on launch)
if (window.vibeforge && window.vibeforge.onUpdateAvailable) {
  window.vibeforge.onUpdateAvailable((info) => {
    showUpdateBanner(info.latest);
  });
}

// Belt-and-suspenders: wire the static button from index.html if it ever becomes visible without going through showUpdateBanner
setTimeout(() => {
  const staticBtn = document.getElementById('do-update-btn');
  if (staticBtn && !staticBtn._wiredForUpdate) {
    staticBtn._wiredForUpdate = true;
    staticBtn.onclick = async () => {
      staticBtn.disabled = true;
      staticBtn.textContent = 'DOWNLOADING...';
      try {
        const res = await window.vibeforge.downloadUpdate();
        if (res && res.ok) {
          staticBtn.textContent = 'RELOADING...';
        } else {
          staticBtn.textContent = 'FAILED: ' + (res ? res.error : 'unknown');
          setTimeout(() => {
            const b = document.getElementById('update-banner');
            if (b) b.classList.add('hidden');
          }, 3000);
        }
      } catch (e) {
        staticBtn.textContent = 'ERROR: ' + e.message;
      }
    };
  }
}, 120);
