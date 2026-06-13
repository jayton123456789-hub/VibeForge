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

let currentProject = null;
let currentView = 'sessions';
let projects = [];
let peerStatus = { status: 'offline', address: '' };
let receivedItems = [];

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
  await switchView('sessions');
  setTimeout(() => maybeShowFirstRunTour(), 250);

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
      try {
        const data = JSON.parse(msg);
        if (data.type === 'session-notes') {
          receivedItems.push({ type: 'notes', title: data.title, content: data.notes });
          if (currentView === 'share') {
            renderShareView(document.getElementById('main-content'), document.getElementById('view-actions'));
          }
          showToast('Received session notes from peer');
        }
      } catch (e) {
        console.log('Peer message:', msg);
      }
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
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black/75 z-[600] flex items-center justify-center p-6';
  modal.innerHTML = `
    <div class="w-full max-w-4xl rounded-[30px] border border-zinc-600 bg-[#0b0f1d] shadow-2xl shadow-black/60 overflow-hidden">
      <div class="p-7 border-b border-zinc-800">
        <div class="text-xs uppercase tracking-[2px] text-cyan-300 mb-2">First time tour</div>
        <div class="text-3xl font-semibold">Record first. Organize later.</div>
        <div class="text-zinc-400 mt-2">VibeForge is built so you do not have to type while ideas are happening. These are the buttons that matter.</div>
      </div>
      <div class="grid md:grid-cols-2 gap-3 p-6">
        <div class="rounded-2xl border border-red-500/30 bg-red-500/10 p-4"><div class="font-semibold text-red-200 mb-1"><i class="fa-solid fa-microphone mr-2"></i>Quick Record</div><div class="text-sm text-zinc-400">Starts recording immediately. Name, summarize, and sort it later.</div></div>
        <div class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"><div class="font-semibold text-amber-200 mb-1"><i class="fa-solid fa-bolt mr-2"></i>Mark Moment</div><div class="text-sm text-zinc-400">Drops a timestamped task, decision, or idea without typing.</div></div>
        <div class="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-4"><div class="font-semibold text-cyan-200 mb-1"><i class="fa-solid fa-desktop mr-2"></i>Screen / Window</div><div class="text-sm text-zinc-400">Adds video capture only when you need it.</div></div>
        <div class="rounded-2xl border border-violet-500/30 bg-violet-500/10 p-4"><div class="font-semibold text-violet-200 mb-1"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>AI Cleanup</div><div class="text-sm text-zinc-400">After the call, use local AI to summarize, extract tasks, and name sessions.</div></div>
      </div>
      <div class="p-6 pt-0 flex gap-3">
        <button class="tour-start flex-1 py-3 rounded-2xl bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold">Start Recording</button>
        <button class="tour-close flex-1 py-3 rounded-2xl bg-white text-black font-semibold">Got it</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => {
    localStorage.setItem('vibeforge-tour-seen', 'true');
    modal.remove();
  };
  modal.querySelector('.tour-close').onclick = close;
  modal.querySelector('.tour-start').onclick = async () => {
    close();
    await quickStartRecording();
  };
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
    str += ` → ${end.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} (${mins}m)`;
  } else {
    str += ' (open)';
  }
  if (s.mode) str += ` • ${s.mode}`;
  return str;
}

async function showProjectMenu() {
  if (!currentProject && projects.length === 0) {
    await createFirstProject();
    return;
  }

  const menu = document.createElement('div');
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

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', function handler(ev) {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', handler);
      }
    }, { once: true });
  }, 10);
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
  if (!currentProject || !confirm(`Delete project "${currentProject.name}" and all its data?`)) return;
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

  header.textContent = view.charAt(0).toUpperCase() + view.slice(1);

  if (view === 'sessions') await renderSessionsView(content, actions);
  else if (view === 'decisions') await renderDecisionsView(content, actions);
  else if (view === 'tasks') await renderTasksView(content, actions);
  else if (view === 'ideas') await renderIdeasView(content, actions);
  else if (view === 'timeline') await renderTimelineView(content, actions);
  else if (view === 'memory') await renderMemoryView(content, actions);
  else if (view === 'share') await renderShareView(content, actions);
  else if (view === 'settings') await renderSettingsView(content, actions);
}

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
              <div class="font-semibold text-lg">Recent sessions</div>
              <div class="text-xs text-zinc-500">${sessions.length} total in ${esc(currentProject.name)}</div>
            </div>
            <button onclick="startNewSession()" class="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-sm">New</button>
          </div>
          ${recent.length ? `
            <div class="grid md:grid-cols-2 gap-3">
              ${recent.map(s => `
                <div onclick="openSession('${s.id}')" class="card cursor-pointer rounded-2xl border border-zinc-800 bg-black/25 p-4">
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="font-medium truncate">${esc(s.title)}</div>
                      <div class="text-xs text-zinc-500 mt-1">${formatSessionMeta(s)}</div>
                    </div>
                    <button onclick="event.stopImmediatePropagation(); resumeLiveSession('${s.id}')" class="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">Resume</button>
                  </div>
                </div>
              `).join('')}
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

  /*
  // Premium recording workspace. This block was moved into renderLiveRoom below.
  // while keeping the existing recording, transcription, and save logic below.
  content.innerHTML = `
    <div class="min-h-full grid 2xl:grid-cols-[1fr_310px] gap-4">
      <section class="rounded-[28px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-6 overflow-hidden">
        <div class="grid lg:grid-cols-[1fr_390px] gap-5 items-start">
          <div>
            <div class="text-xs uppercase tracking-[1.8px] text-violet-300 mb-2"><i class="fa-solid fa-users mr-2"></i>${modeLabel}</div>
            <div class="flex items-center gap-2 mb-3">
              <h2 class="text-3xl font-semibold tracking-tight">${esc(session.title)}</h2>
              <button onclick="editSessionTitle('${session.id}')" class="w-8 h-8 rounded-xl hover:bg-zinc-800 text-zinc-400"><i class="fa-solid fa-pen"></i></button>
            </div>
            <div class="flex items-center gap-4 text-sm mb-3">
              <span class="text-red-400 font-semibold"><i class="fa-solid fa-circle fa-beat mr-2"></i>RECORDING</span>
              <span class="text-zinc-400"><i class="fa-solid fa-microphone mr-2"></i><span id="capture-label">${captureLabel}</span></span>
            </div>
            <div id="live-timer" class="font-mono text-6xl text-red-400 tracking-tighter mb-2">00:00</div>
            <div id="mic-status" class="hidden"></div>
            <div class="h-7 overflow-hidden mb-5">
              <div class="text-red-400/80 text-xs tracking-[3px] whitespace-nowrap opacity-80">••• ••••• •• ••••••• ••• •••• ••••• •• ••••••• ••• •••• ••••• •••</div>
            </div>
          </div>

          <div class="grid grid-cols-[160px_1fr] gap-4">
            <button id="stop-btn" onclick="stopLiveRoom('${session.id}')"
                    class="mx-auto w-40 h-40 rounded-full bg-red-500/10 border border-red-400/30 flex flex-col items-center justify-center glow-record text-red-100">
              <span class="w-24 h-24 rounded-full bg-gradient-to-br from-red-300 to-red-600 flex items-center justify-center shadow-2xl shadow-red-500/30">
                <i class="fa-solid fa-square text-3xl"></i>
              </span>
              <span class="mt-3 text-xs font-semibold text-red-300">Stop &amp; Save</span>
            </button>

            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <button onclick="pickScreenForLive()" class="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-center text-sm text-red-100">
                  <i class="fa-solid fa-desktop text-xl mb-2"></i><br>Screen
                </button>
                <button onclick="pickScreenForLive()" class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300">
                  <i class="fa-regular fa-window-maximize text-xl mb-2"></i><br>Window
                </button>
              </div>
              <div class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4">
                <div class="flex justify-between text-sm mb-2">
                  <span class="text-zinc-300"><i class="fa-solid fa-microphone mr-2"></i>Mic input</span>
                  <span id="mic-status-text" class="text-emerald-300">Good</span>
                </div>
                <canvas id="mic-meter" width="260" height="24" class="w-full h-6 rounded bg-black/50"></canvas>
              </div>
            </div>
          </div>
        </div>

        <textarea id="live-notes" style="display:none">${esc(notes)}</textarea>

        <div class="mt-5 rounded-2xl border border-zinc-700/70 bg-[#141728]/80 p-2 grid grid-cols-4 gap-2">
          <button onclick="openNotesEditor('${session.id}')" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2">
            <i class="fa-solid fa-sticky-note"></i> Notes <span id="notes-count" class="text-xs px-2 py-0.5 rounded-full bg-zinc-700">${(notes || '').length}</span>
          </button>
          <button onclick="showQuickActionsMenu('${session.id}', this)" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2">
            <i class="fa-solid fa-bolt"></i> Quick Actions
          </button>
          <button class="px-4 py-3 rounded-xl bg-indigo-600/40 border border-indigo-500/40 text-indigo-100 flex items-center justify-center gap-2">
            <i class="fa-solid fa-wand-magic-sparkles"></i> Transcript
          </button>
          <button onclick="showQuickActionsMenu('${session.id}', this)" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2">
            <i class="fa-solid fa-sparkles"></i> Highlights
          </button>
        </div>

        <div class="mt-4 rounded-[24px] border border-zinc-700/70 bg-black/25 p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-lg">Live Transcript <span class="text-xs text-emerald-300 ml-2">• Live</span></div>
              <div class="text-sm text-zinc-500">Local Whisper types as you talk and saves into the session.</div>
            </div>
            <div class="flex items-center gap-2 text-xs text-zinc-400">
              <span>Auto-save</span>
              <span class="w-9 h-5 rounded-full bg-cyan-500/80 relative inline-block"><span class="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white"></span></span>
            </div>
          </div>
          <div id="live-transcript" class="min-h-[210px] max-h-[310px] overflow-auto text-sm leading-7 font-mono whitespace-pre-wrap text-zinc-300"></div>
          <div class="mt-3 h-6 text-cyan-300/80 text-xs tracking-[3px] overflow-hidden">•••• ••••••• •••• ••••• ••• ••••••• •••• ••••• ••• ••••••• ••••</div>
        </div>

        <div class="mt-4 grid md:grid-cols-5 gap-3">
          <button onclick="generateFromSession('${session.id}', 'summary', this)" class="py-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 text-violet-200 font-medium"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>Summarize</button>
          <button onclick="generateFromSession('${session.id}', 'tasks', this)" class="py-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 font-medium"><i class="fa-regular fa-square-check mr-2"></i>Extract Tasks</button>
          <button onclick="generateFromSession('${session.id}', 'decisions', this)" class="py-3 rounded-2xl border border-blue-500/40 bg-blue-500/10 text-blue-200 font-medium"><i class="fa-regular fa-gem mr-2"></i>Decision</button>
          <button onclick="window.quickMark('${session.id}', 'idea')" class="py-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 font-medium"><i class="fa-regular fa-lightbulb mr-2"></i>Insight</button>
          <button onclick="showCaptureIdeaModal()" class="py-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-medium"><i class="fa-solid fa-share-nodes mr-2"></i>Clip</button>
        </div>

        <div class="mt-5 rounded-[26px] border border-red-400/40 bg-[#121522]/95 p-4 grid md:grid-cols-[220px_1fr_150px_130px_160px] gap-4 items-center shadow-2xl shadow-black/30">
          <div class="flex items-center gap-3">
            <button onclick="stopLiveRoom('${session.id}')" class="w-16 h-16 rounded-full bg-red-500 glow-record flex items-center justify-center"><i class="fa-solid fa-square"></i></button>
            <div>
              <div class="text-red-300 font-semibold">RECORDING</div>
              <div class="text-xs text-zinc-400"><i class="fa-solid fa-microphone mr-1"></i><span id="bottom-capture-label">${captureLabel}</span></div>
            </div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-mono text-zinc-100" id="bottom-live-timer">00:00</div>
            <div class="text-xs text-zinc-500">Elapsed time</div>
          </div>
          <div class="text-sm text-zinc-300"><i class="fa-solid fa-desktop mr-2"></i>Screen + Mic</div>
          <div class="text-emerald-300 text-sm"><i class="fa-solid fa-signal mr-2"></i>Good</div>
          <button onclick="stopLiveRoom('${session.id}')" class="py-3 rounded-2xl bg-zinc-900 border border-zinc-700 font-semibold"><i class="fa-solid fa-pause mr-2"></i>Pause</button>
        </div>
      </section>

      <aside class="space-y-4">
        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/82 p-5">
          <div class="font-semibold mb-4">Session Overview</div>
          <div class="space-y-4 text-sm">
            <div class="flex justify-between"><span class="text-zinc-400"><i class="fa-regular fa-clock mr-2"></i>Duration</span><span id="side-live-timer" class="text-red-300 font-mono">00:00</span></div>
            <div class="flex justify-between"><span class="text-zinc-400"><i class="fa-regular fa-calendar mr-2"></i>Started</span><span>${new Date(session.started_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400"><i class="fa-solid fa-tag mr-2"></i>Type</span><span>${modeLabel}</span></div>
            <div class="flex justify-between"><span class="text-zinc-400"><i class="fa-regular fa-circle mr-2"></i>Status</span><span class="text-red-300">Recording</span></div>
          </div>
        </div>

        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/82 p-5">
          <div class="font-semibold mb-3">Capture Source</div>
          <div class="text-cyan-300 text-lg font-semibold"><i class="fa-solid fa-display mr-2"></i><span id="source-card-label">${captureLabel}</span></div>
          <div class="text-xs text-zinc-500 mt-2">Pick a screen or window when you want video.</div>
        </div>

        <div class="rounded-[24px] border border-cyan-500/30 bg-cyan-500/10 p-5">
          <div class="flex items-center justify-between mb-3">
            <div class="font-semibold"><i class="fa-solid fa-sparkles text-violet-300 mr-2"></i>AI Assistant</div>
            <span class="text-xs text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded-full">Active</span>
          </div>
          <div class="text-sm text-zinc-400 mb-4">Transcribing, detecting insights, and preparing summaries.</div>
          <div class="h-1 rounded-full bg-zinc-800 overflow-hidden"><div class="h-full w-2/3 bg-gradient-to-r from-cyan-400 to-emerald-400"></div></div>
        </div>

        <div class="rounded-[24px] border border-zinc-700/50 bg-[#0b0f1d]/82 p-5">
          <div class="font-semibold mb-4">Detected Insights</div>
          <div class="space-y-2 text-sm">
            <div class="rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 text-zinc-400">Insights appear as you mark ideas, tasks, and decisions.</div>
            <button onclick="showQuickActionsMenu('${session.id}', this)" class="w-full py-3 rounded-xl bg-zinc-900 border border-zinc-700">Open Quick Actions <i class="fa-solid fa-arrow-right ml-2"></i></button>
          </div>
        </div>
      </aside>
    </div>
  `;
  */
}

async function deleteSession(id, btn) {
  if (!confirm('Delete this session?')) return;
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

  const content = document.getElementById('main-content');
  content.innerHTML = `
    <div class="max-w-4xl">
      <div class="flex justify-between items-center mb-4">
        <button onclick="switchView('sessions')" class="text-xs text-zinc-400 hover:text-zinc-200">← Back to Sessions</button>
        <div class="flex gap-2">
          <button onclick="editSessionTitle('${s.id}')" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl hover:bg-zinc-800">Edit Name</button>
          <button onclick="deleteSessionFromDetail('${s.id}')" class="px-3 py-1 text-xs border border-red-700 text-red-400 rounded-2xl hover:bg-red-950">Delete Session</button>
        </div>
      </div>

      <div class="text-2xl font-semibold">${esc(s.title)}</div>
      <div class="text-xs text-zinc-500 mb-2">${formatSessionMeta(s)}</div>

      <div class="mb-4 p-3 bg-emerald-900/30 border border-emerald-700/60 rounded-2xl">
        <div class="text-sm font-medium mb-1.5 text-emerald-300">Continue working on this session (multi-visit / keep the convo going)</div>
        <div class="flex flex-wrap gap-2">
          <button onclick="resumeLiveSession('${s.id}')" class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-2xl text-sm font-semibold flex items-center gap-2">
            <i class="fa-solid fa-play"></i> Resume Live (recording + notes + live transcript)
          </button>
          <button onclick="editSessionNotesModal('${s.id}')" class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-sm flex items-center gap-2">
            <i class="fa-solid fa-edit"></i> Just Edit Notes
          </button>
        </div>
        <div class="text-[10px] text-emerald-400/80 mt-1">New audio segments save alongside previous. Notes &amp; transcript append. Date/time tracked automatically.</div>
      </div>

      <div class="mb-6">
        <div class="font-medium mb-1.5">Session Notes</div>
        <textarea id="sess-notes" class="w-full h-28 bg-[#111113] border border-zinc-800 rounded-2xl p-4 text-sm">${esc(s.notes || '')}</textarea>
        <button onclick="saveSessionNotes('${s.id}')" class="mt-2 px-4 py-1 text-xs bg-white text-black rounded-2xl">Save Notes</button>
      </div>

      ${s.audio_path ? `
      <div class="mb-6">
        <div class="font-medium mb-1.5">Recorded Audio / Screen</div>
        <video controls src="file://${s.audio_path}" class="w-full max-h-[420px] rounded-2xl bg-black"></video>
        <div class="mt-2">
          <button onclick="transcribeSession('${s.id}')" class="px-3 py-1 text-xs border border-emerald-700 text-emerald-400 rounded-2xl">Transcribe (local Whisper)</button>
        </div>
      </div>
      ` : ''}

      <div class="mb-6">
        <div class="font-medium mb-2">Quick Actions</div>
        <div class="flex flex-wrap gap-2">
          <button onclick="markInSession('${s.id}', 'decision')" class="px-4 py-2 bg-[#111113] border border-zinc-700 rounded-2xl text-sm">Add Decision</button>
          <button onclick="markInSession('${s.id}', 'task')" class="px-4 py-2 bg-[#111113] border border-zinc-700 rounded-2xl text-sm">Add Task</button>
          <button onclick="markInSession('${s.id}', 'idea')" class="px-4 py-2 bg-[#111113] border border-zinc-700 rounded-2xl text-sm">Add Idea</button>
          <button onclick="showCaptureIdeaModal()" class="px-4 py-2 bg-emerald-600 text-white rounded-2xl text-sm">Capture Idea</button>
        </div>
      </div>

      <div class="mb-6">
        <div class="font-medium mb-2">AI Generate (Ollama)</div>
        <div class="flex flex-wrap gap-2">
          <button onclick="generateFromSession('${s.id}', 'summary', this)" class="px-3 py-1 text-xs bg-white text-black rounded-2xl">Generate Summary</button>
          <button onclick="generateFromSession('${s.id}', 'tasks', this)" class="px-3 py-1 text-xs bg-white text-black rounded-2xl">Generate Tasks</button>
          <button onclick="generateFromSession('${s.id}', 'decisions', this)" class="px-3 py-1 text-xs bg-white text-black rounded-2xl">Generate Decisions</button>
          <button onclick="generateFromSession('${s.id}', 'grok', this)" class="px-3 py-1 text-xs bg-white text-black rounded-2xl">Generate Grok Prompt</button>
        </div>
        <div class="text-[10px] text-zinc-500 mt-1">AI buttons use Local AI (Ollama). If offline, they will show error — go to Settings &gt; Local AI to set up.</div>
        <div id="gen-output-${s.id}" class="mt-2 text-xs bg-zinc-900 p-2 rounded hidden"></div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button onclick="exportSessionMdReal('${s.id}')" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl">Export Session Markdown</button>
        <button onclick="exportGrokPromptReal('${s.id}')" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl">Export Grok Prompt TXT</button>
        <button onclick="revealExportsForProject()" class="px-3 py-1 text-xs border border-zinc-700 rounded-2xl">Reveal Export Folder</button>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <div class="font-medium mb-2">Linked Decisions (${decisions.length})</div>
          ${decisions.length ? decisions.map(d => `<div class="text-sm py-1 border-b border-zinc-800">${esc(d.title)} <span class="text-xs text-zinc-500">[${esc(d.status)}]</span></div>`).join('') : '<div class="text-xs text-zinc-500">None</div>'}
        </div>
        <div>
          <div class="font-medium mb-2">Linked Tasks (${tasks.length})</div>
          ${tasks.length ? tasks.map(t => `<div class="text-sm py-1 border-b border-zinc-800">${esc(t.title)} <span class="text-xs text-zinc-500">[${esc(t.status)}]</span></div>`).join('') : '<div class="text-xs text-zinc-500">None</div>'}
        </div>
        <div>
          <div class="font-medium mb-2">Linked Ideas (${ideas.length})</div>
          ${ideas.length ? ideas.map(i => `<div class="text-sm py-1 border-b border-zinc-800">${esc(i.title)}</div>`).join('') : '<div class="text-xs text-zinc-500">None</div>'}
        </div>
        <div>
          <div class="font-medium mb-2">Timeline Events (${timeline.length})</div>
          ${timeline.length ? timeline.map(e => `<div class="text-xs py-0.5">${new Date(e.timestamp).toLocaleTimeString()} - ${esc(e.type)}: ${esc(e.title)}</div>`).join('') : '<div class="text-xs text-zinc-500">None</div>'}
        </div>
      </div>
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
  if (!confirm('Delete this session?')) return;
  await window.vibeforge.deleteSession(id);
  showToast('Session deleted');
  await switchView('sessions');
}

async function saveSessionNotes(id) {
  const ta = document.getElementById('sess-notes');
  if (ta) await window.vibeforge.updateSessionNotes(id, ta.value);
  showToast('Notes saved');
}

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

window.resumeLiveSession = async function(id) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === id);
  if (s) {
    showToast('Resuming session — new recordings will be additional segments with their own timestamps.');
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
    { icon: 'fa-gavel', label: 'Mark Decision', action: () => window.quickMark(sessionId, 'decision') },
    { icon: 'fa-tasks', label: 'Mark Task', action: () => window.quickMark(sessionId, 'task') },
    { icon: 'fa-lightbulb', label: 'Mark Idea', action: () => window.quickMark(sessionId, 'idea') },
    { icon: 'fa-comment', label: 'Add Timestamped Note', action: () => window.addQuickNote(sessionId) },
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
    inputModalResolve = resolve;
    const modal = document.getElementById('input-modal');
    if (!modal) { resolve(null); return; }
    document.getElementById('input-modal-title').textContent = title || 'Input';
    const input = document.getElementById('input-modal-input');
    input.value = defaultValue || '';
    input.placeholder = hint || '';
    document.getElementById('input-modal-hint').textContent = hint || '';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    requestAnimationFrame(() => {
      setTimeout(() => {
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

window.confirmNewSession = async function() {
  try {
    const rawName = document.getElementById('session-name').value.trim();
    const modeRadio = document.querySelector('input[name="mode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'room';
    const fallbackName = `Session ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    const name = rawName || fallbackName;
    if (!currentProject || !currentProject.id) {
      showToast('No project selected — creating one first...');
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
  let timerInterval;
  let notes = session.notes || '';
  let mediaRecorder = null;
  let audioChunks = [];
  let audioContext = null;
  let analyser = null;
  let isRecording = false;
  let micStream = null;
  let displayStream = null;
  let captureLabel = 'Mic only';
  let liveTranscript = '';
  // Live caption state (real local Whisper, chunked)
  let captionNode = null;
  let captionTimer = null;
  let captionBusy = false;
  let captionBuf = [];
  let captionBufLen = 0;
  let captionRate = 48000;

  const modeLabel = session.mode === 'manual' ? 'Manual Session' : 'Room Session';
  const isRoom = session.mode !== 'manual';

  content.innerHTML = `
    <div class="max-w-3xl">
      <div class="flex justify-between mb-3">
        <div>
          <div class="font-semibold text-lg">${esc(session.title)} <span class="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">${modeLabel}</span></div>
          <div id="live-timer" class="font-mono text-4xl text-red-500 tracking-tighter">00:00</div>
          <div id="mic-status" class="text-xs text-zinc-500 mt-0.5"></div>
        </div>
        <div class="text-right">
          <button id="stop-btn" onclick="stopLiveRoom('${session.id}')" class="px-6 py-2.5 bg-red-600 hover:bg-red-500 rounded-2xl text-sm font-semibold shadow">Stop &amp; Save Session</button>
        </div>
      </div>

      ${isRoom ? `
      <div class="mb-3 p-3 bg-red-950/60 border border-red-500/40 rounded-3xl flex items-center gap-3 text-sm">
        <div class="flex items-center gap-2 text-red-400">
          <i class="fa-solid fa-circle fa-beat"></i>
          <span class="font-bold tracking-wide">RECORDING</span>
        </div>
        <div class="text-red-300/90">•</div>
        <div id="capture-label" class="font-medium text-red-100 flex-1 truncate">${captureLabel}</div>
        <button onclick="pickScreenForLive()" class="px-3 py-1 text-xs rounded-2xl bg-red-900 hover:bg-red-800 border border-red-600/60">Pick screen / window</button>
        <div class="text-[10px] text-red-400/70">overlay</div>
      </div>
      ` : ''}

      <!-- Hidden live-notes for compatibility with stop/save logic -->
      <textarea id="live-notes" style="display:none">${esc(notes)}</textarea>

      <div class="mb-3 flex gap-2">
        <button onclick="openNotesEditor('${session.id}')" class="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-sm flex items-center justify-center gap-2">
          <i class="fa-solid fa-sticky-note"></i> 
          <span>Notes <span id="notes-count" class="text-xs text-zinc-400">(${ (notes||'').length })</span></span>
        </button>
        <button onclick="showQuickActionsMenu('${session.id}', this)" class="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-2xl text-sm flex items-center justify-center gap-2">
          <i class="fa-solid fa-bolt"></i> Quick Actions
        </button>
      </div>

      ${isRoom ? `
      <div class="mb-4">
        <div class="flex items-center justify-between mb-1">
          <div class="font-medium">Mic Level</div>
          <div id="mic-status-text" class="text-xs text-emerald-400">Listening…</div>
        </div>
        <canvas id="mic-meter" width="420" height="18" class="bg-zinc-950 border border-zinc-800 rounded"></canvas>
      </div>

      <div class="mb-4">
        <div class="font-medium mb-1 flex items-center gap-2">
          Live Transcript <span class="text-[10px] text-zinc-500">(local Whisper • a few seconds behind speech)</span>
        </div>
        <div id="live-transcript" class="bg-black/60 border border-zinc-800 rounded-2xl p-3 text-sm h-24 overflow-auto font-mono whitespace-pre-wrap leading-snug"></div>
        <div class="text-[10px] text-zinc-500 mt-1">Real on-device transcription — types in as you talk. Saved into session notes on Stop.</div>
      </div>
      ` : ''}

      <div class="text-xs text-zinc-500">Use the buttons above for notes &amp; quick actions. Recording continues until Stop. Resume this session anytime from the list or detail view.</div>
    </div>
  `;

  content.innerHTML = `
    <div class="min-h-full grid 2xl:grid-cols-[1fr_300px] gap-4">
      <section class="rounded-[28px] border border-zinc-700/50 bg-[#0b0f1d]/90 p-6 overflow-hidden">
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
            <div class="h-7 overflow-hidden mb-4 text-red-400/80 text-xs tracking-[3px] whitespace-nowrap">••• ••••• •• ••••••• ••• •••• ••••• •• ••••••• ••• ••••</div>
          </div>

          <div class="grid sm:grid-cols-[128px_1fr] gap-4">
            <button id="stop-btn" onclick="stopLiveRoom('${session.id}')" class="w-32 h-32 rounded-full bg-red-500/10 border border-red-400/30 flex flex-col items-center justify-center glow-record text-red-100">
              <span class="w-20 h-20 rounded-full bg-gradient-to-br from-red-300 to-red-600 flex items-center justify-center shadow-2xl shadow-red-500/30">
                <i class="fa-solid fa-square text-2xl"></i>
              </span>
              <span class="mt-2 text-[11px] font-semibold text-red-300">Stop &amp; Save</span>
            </button>
            <div class="space-y-3">
              <div class="grid grid-cols-2 gap-2">
                <button onclick="pickScreenForLive()" class="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-center text-sm text-red-100"><i class="fa-solid fa-desktop text-xl mb-2"></i><br>Screen</button>
                <button onclick="pickScreenForLive()" class="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-4 text-center text-sm text-zinc-300"><i class="fa-regular fa-window-maximize text-xl mb-2"></i><br>Window</button>
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
          <button class="px-4 py-3 rounded-xl bg-indigo-600/40 border border-indigo-500/40 text-indigo-100 flex items-center justify-center gap-2"><i class="fa-solid fa-wand-magic-sparkles"></i> Transcript</button>
          <button onclick="showQuickActionsMenu('${session.id}', this)" class="px-4 py-3 rounded-xl hover:bg-zinc-800 text-zinc-300 flex items-center justify-center gap-2"><i class="fa-solid fa-sparkles"></i> Highlights</button>
        </div>

        <div class="mt-4 rounded-[24px] border border-zinc-700/70 bg-black/25 p-5">
          <div class="flex items-center justify-between mb-4">
            <div>
              <div class="font-semibold text-lg">Live Transcript <span class="text-xs text-emerald-300 ml-2">• Live</span></div>
              <div class="text-sm text-zinc-500">Local Whisper types as you talk and saves into the session.</div>
            </div>
            <div class="flex items-center gap-2 text-xs text-zinc-400"><span>Auto-save</span><span class="w-9 h-5 rounded-full bg-cyan-500/80 relative inline-block"><span class="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white"></span></span></div>
          </div>
          <div id="live-transcript" class="min-h-[190px] max-h-[280px] overflow-auto text-sm leading-7 font-mono whitespace-pre-wrap text-zinc-300"></div>
          <div class="mt-3 h-6 text-cyan-300/80 text-xs tracking-[3px] overflow-hidden">•••• ••••••• •••• ••••• ••• ••••••• •••• ••••• •••</div>
        </div>

        <div class="mt-4 grid md:grid-cols-5 gap-3">
          <button onclick="markMoment('${session.id}', 'idea')" class="py-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 text-amber-200 font-medium"><i class="fa-regular fa-lightbulb mr-2"></i>Mark Idea</button>
          <button onclick="markMoment('${session.id}', 'task')" class="py-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 font-medium"><i class="fa-regular fa-square-check mr-2"></i>Mark Task</button>
          <button onclick="markMoment('${session.id}', 'decision')" class="py-3 rounded-2xl border border-blue-500/40 bg-blue-500/10 text-blue-200 font-medium"><i class="fa-regular fa-gem mr-2"></i>Decision</button>
          <button onclick="clipMoment('${session.id}')" class="py-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-medium"><i class="fa-solid fa-scissors mr-2"></i>Clip</button>
          <button onclick="generateFromSession('${session.id}', 'summary', this)" class="py-3 rounded-2xl border border-violet-500/40 bg-violet-500/10 text-violet-200 font-medium"><i class="fa-solid fa-wand-magic-sparkles mr-2"></i>AI Cleanup</button>
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
            <div class="flex justify-between"><span class="text-zinc-400">Started</span><span>${new Date(session.started_at || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
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

  // Timer (always)
  const start = Date.now();
  timerInterval = setInterval(() => {
    const sec = Math.floor((Date.now() - start) / 1000);
    const text = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    ['live-timer', 'bottom-live-timer', 'side-live-timer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }, 1000);

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
  // Previously these assignments were after the awaits → buttons threw "xxx is not defined" + appeared to do nothing.
  window.pickScreenForLive = async function() {
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
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

      showToast('Screen set: ' + captureLabel + '. ' + (isRecording ? 'Switching source…' : ''));

      if (isRecording && mediaRecorder && micStream) {
        // mid-session switch: flush, stop current recorder (chunks kept), restart with combined
        try {
          mediaRecorder.requestData();
          mediaRecorder.stop();
        } catch(e){}
        const auds = [...micStream.getAudioTracks(), ...ds.getAudioTracks()];
        const vids = ds.getVideoTracks();
        const combined = new MediaStream([...auds, ...vids]);
        mediaRecorder = new MediaRecorder(combined);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
          try { combined.getTracks().forEach(t => t.stop()); } catch(e){}
        };
        mediaRecorder.start();
        showToast('Now capturing: ' + captureLabel);
      }
    } catch (e) {
      showToast('Screen pick: ' + (e.message || 'cancelled'));
    }
  };

  window.stopLiveRoom = async function(id) {
    clearInterval(timerInterval);
    if (captionTimer) { try { clearInterval(captionTimer); } catch(e){} captionTimer = null; }
    if (captionNode) { try { captionNode.disconnect(); } catch(e){} captionNode = null; }
    if (isRecording && mediaRecorder) {
      try { mediaRecorder.stop(); } catch(e){}
      isRecording = false;
    }

    // stop any display/mic tracks
    try { if (micStream) micStream.getTracks().forEach(t => t.stop()); } catch(e){}
    try { if (displayStream) displayStream.getTracks().forEach(t => t.stop()); } catch(e){}

    // save notes + live transcript (if any)
    let finalNotes = (document.getElementById('live-notes') || {}).value || notes;
    if (liveTranscript && liveTranscript.trim()) {
      finalNotes = finalNotes + (finalNotes ? '\n\n' : '') + '[Live transcript]\n' + liveTranscript.trim();
    }

    await window.vibeforge.updateSessionNotes(id, finalNotes);
    try {
      await window.vibeforge.updateSessionEnded(id, Date.now());
    } catch (e) {}

    // final save of accumulated recording (supports mid-session screen changes)
    if (audioChunks && audioChunks.length > 0) {
      try {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const arrayBuffer = await audioBlob.arrayBuffer();
        const savedPath = await window.vibeforge.saveAudio(id, arrayBuffer);
        await window.vibeforge.updateSessionAudio(id, savedPath);
        showToast('Session + recording saved');
      } catch (e) {
        showToast('Session saved (audio save issue: ' + e.message + ')');
      }
    } else {
      showToast('Session saved');
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
  function typewriterAppend(delta, container) {
    if (!container || !delta) return;
    const chars = delta.split('');
    let i = 0;
    function step() {
      if (i < chars.length) {
        container.textContent += chars[i++];
        container.scrollTop = container.scrollHeight;
        setTimeout(step, 16); // nice fast typewriter cadence
      }
    }
    step();
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
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let recStream = micStream;

      // if a screen was picked *before* we got here, combine now
      if (displayStream) {
        const auds = [...micStream.getAudioTracks(), ...displayStream.getAudioTracks()];
        const vids = displayStream.getVideoTracks();
        recStream = new MediaStream([...auds, ...vids]);
        const vt = displayStream.getVideoTracks()[0];
        if (vt) updateCaptureUI((vt.label || 'Display') + ' + mic');
      }

      mediaRecorder = new MediaRecorder(recStream);
      audioChunks = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        // only cleanup here; full save happens in stopLiveRoom so mid-switch works
        try { recStream.getTracks().forEach(t => t.stop()); } catch(e){}
      };

      mediaRecorder.start();
      isRecording = true;
      if (micStatus) micStatus.textContent = 'Recording… (screen/mic)';

      // Mic level (always on the mic source)
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
        const width = (avg / 255) * canvas.width;
        ctx.fillStyle = '#111113';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, width, canvas.height);
        requestAnimationFrame(drawMeter);
      }
      drawMeter();

      // === Live captions via local Whisper (chunked, real transcription — no cloud, no browser API) ===
      // Mic PCM accumulates; every few seconds a chunk is resampled to 16k WAV and run through
      // whisper.cpp in the main process. Self-pacing: while one chunk transcribes, audio keeps buffering.
      const tEl = document.getElementById('live-transcript');
      try {
        const wCheck = await window.vibeforge.whisperCheck();
        if (tEl && wCheck && wCheck.configured) {
          captionRate = audioContext.sampleRate;
          captionNode = audioContext.createScriptProcessor(4096, 1, 1);
          captionNode.onaudioprocess = (ev) => {
            const data = ev.inputBuffer.getChannelData(0);
            captionBuf.push(new Float32Array(data));
            captionBufLen += data.length;
            // cap backlog at ~30s so a slow machine can't spiral
            while (captionBufLen > captionRate * 30 && captionBuf.length > 1) {
              captionBufLen -= captionBuf.shift().length;
            }
          };
          source.connect(captionNode);
          captionNode.connect(audioContext.destination);

          tEl.innerHTML = '<span class="text-zinc-500 text-xs">Listening… captions appear a few seconds behind speech.</span>';
          let firstCaption = true;

          captionTimer = setInterval(async () => {
            if (captionBusy) return;
            if (captionBufLen < captionRate * 4) return; // wait for ~4s of audio
            const merged = new Float32Array(captionBufLen);
            let o = 0;
            for (const c of captionBuf) { merged.set(c, o); o += c.length; }
            captionBuf = []; captionBufLen = 0;

            // silence gate: skip chunks with no real signal (whisper hallucinates on silence)
            let sum = 0, n = 0;
            for (let i = 0; i < merged.length; i += 16) { sum += merged[i] * merged[i]; n++; }
            if (Math.sqrt(sum / n) < 0.008) return;

            captionBusy = true;
            try {
              const wav = encodeWav16k(resampleTo16k(merged, captionRate));
              const res = await window.vibeforge.transcribeWav({ wav });
              if (res && res.ok && res.transcript) {
                const text = res.transcript.replace(/\s+/g, ' ').trim();
                if (text) {
                  if (firstCaption) { tEl.textContent = ''; firstCaption = false; }
                  liveTranscript += text + ' ';
                  typewriterAppend(text + ' ', tEl);
                }
              }
            } catch (e) {} finally {
              captionBusy = false;
            }
          }, 2000);

          if (micStatus) micStatus.textContent = 'Recording + live Whisper captions';
        } else if (tEl) {
          tEl.innerHTML = '<span class="text-zinc-500 text-xs">Live captions off — run the one-click Whisper setup in Settings → AI Tools to enable them.</span>';
        }
      } catch (e) {
        if (tEl) tEl.innerHTML = '<span class="text-zinc-500 text-xs">Live captions unavailable: ' + e.message + '</span>';
      }

    } catch (err) {
      if (micStatus) micStatus.textContent = 'Mic permission failed — notes only';
      showToast('Mic access denied or unavailable. You can still add notes & marks.');
    }
  } else {
    const ms = document.getElementById('mic-status');
    if (ms) ms.textContent = 'Manual notes mode — no audio/screen recording';
  }

  // (handlers were hoisted early right after timer setup so buttons work immediately;
  // the late assignments were removed to avoid duplication)
}

// 7. Duo Setup - real host/join with WebSocket
async function renderDuoSetup(session) {
  const content = document.getElementById('main-content');
  content.innerHTML = `
    <div class="max-w-lg">
      <div class="mb-4">Duo / Link Mode — ${esc(session.title)}</div>
      
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-[#111113] border border-zinc-700 rounded-3xl p-5">
          <div class="font-medium mb-3">Host Session</div>
          <button onclick="hostDuo('${session.id}', this)" class="w-full py-2 bg-white text-black rounded-2xl text-sm font-semibold">Start Hosting</button>
          <div id="host-info" class="mt-3 text-xs text-emerald-400 hidden"></div>
        </div>

        <div class="bg-[#111113] border border-zinc-700 rounded-3xl p-5">
          <div class="font-medium mb-3">Join Session</div>
          <input id="join-addr" placeholder="192.168.x.x:48291" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-2 text-sm mb-2">
          <button onclick="joinDuo('${session.id}', this)" class="w-full py-2 border border-zinc-600 rounded-2xl text-sm">Join</button>
          <div id="join-info" class="mt-2 text-xs"></div>
        </div>
      </div>

      <div class="mt-4 text-xs text-zinc-500">Use your local network IP. Both machines must be on the same network.</div>
      <button onclick="switchView('sessions')" class="mt-4 text-xs text-zinc-400">Cancel &amp; go back</button>
    </div>
  `;
}

async function hostDuo(sessionId, btn) {
  btn.disabled = true; btn.textContent = 'Starting host...';
  try {
    const res = await window.vibeforge.duoHost();
    document.getElementById('host-info').classList.remove('hidden');
    document.getElementById('host-info').innerHTML = `Hosting at <strong>${res.address}</strong><br>Waiting for connection... <button onclick="window.vibeforge.duoDisconnect(); switchView('share')" class="underline ml-1">Cancel</button>`;
    showToast('Hosting started. Tell Nick the address.');
  } catch (e) {
    showToast('Host failed: ' + e.message);
    btn.disabled = false; btn.textContent = 'Start Hosting';
  }
}

async function joinDuo(sessionId, btn) {
  const addr = document.getElementById('join-addr').value.trim();
  if (!addr) { showToast('Enter address'); return; }
  btn.disabled = true; btn.textContent = 'Joining...';
  const res = await window.vibeforge.duoJoin(addr);
  if (res.ok) {
    document.getElementById('join-info').innerHTML = `Connected to ${addr}. <button onclick="startRecordingAfterLink('${sessionId}')" class="underline">Start session</button>`;
    showToast('Joined successfully');
  } else {
    document.getElementById('join-info').textContent = 'Failed: ' + res.error;
    btn.disabled = false; btn.textContent = 'Join';
  }
}

async function startRecordingAfterLink(sessionId) {
  // Simple room-like for now once linked
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  await renderLiveRoom(s);
}

// === 6. SHARE WITH NICK QOL - clear instructions, copy, status, firewall note, troubleshooting, reveal received, send only when linked ===
async function renderShareView(content, actionsEl) {
  actionsEl.innerHTML = '';
  const status = await window.vibeforge.getPeerStatus();
  let html = `<div class="font-semibold text-xl mb-3">Share</div>`;

  html += `<div class="mb-3 p-3 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs">Jayton clicks Host. Nick opens VibeForge &gt; Share &gt; Join and pastes the address shown here. Both PCs must be on the same local network (WiFi/LAN). Real WebSocket transfer — no cloud.</div>`;

  if (status.status === 'hosting') {
    html += `<div class="p-3 bg-emerald-950 border border-emerald-700 rounded-3xl mb-3">HOSTING at <span class="font-mono">${status.address || 'local network'}</span>. Tell Nick the address and have him Join.</div>`;
  } else if (status.status === 'connected') {
    html += `<div class="p-3 bg-emerald-950 border border-emerald-700 rounded-3xl mb-3">CONNECTED to ${status.address}. Ready to send/receive.</div>`;
  } else {
    html += `<div class="text-zinc-400 mb-3">Offline. Host or Join to link.</div>`;
  }

  html += `
    <div class="flex gap-2 mb-3">
      <button onclick="hostFromShare(this)" class="px-5 py-2 bg-white text-black rounded-2xl text-sm font-semibold">Host</button>
      <button onclick="showJoinInput(this)" class="px-5 py-2 border border-zinc-700 rounded-2xl text-sm">Join</button>
      ${status.status !== 'offline' ? `<button onclick="window.vibeforge.duoDisconnect(); switchView('share')" class="px-5 py-2 border border-red-700 text-red-400 rounded-2xl text-sm">Disconnect</button>` : ''}
    </div>
    <div id="share-extra" class="mb-3"></div>
  `;

  if (status.status === 'hosting' || status.status === 'connected') {
    html += `<button onclick="copyPeerAddress()" class="mb-3 px-3 py-1 text-xs border border-zinc-700 rounded-xl">Copy Address</button>`;
  }

  if (status.status === 'connected') {
    html += `
      <div class="mt-2">
        <div class="font-medium mb-1 text-sm">Send to Nick</div>
        <button onclick="sendCurrentSessionNotes()" class="px-4 py-2 text-xs border border-zinc-700 rounded-2xl">Send Current Session Notes</button>
        <button onclick="sendExportedBundle()" class="ml-2 px-4 py-2 text-xs border border-zinc-700 rounded-2xl">Send Exported Project Bundle / File</button>
      </div>
    `;
  }

  html += `
    <div class="mt-4">
      <div class="font-medium mb-1 text-sm">Received Items</div>
      <button onclick="revealReceivedFolder()" class="mb-2 px-3 py-1 text-xs border border-zinc-700 rounded-xl">Reveal Received Folder</button>
      <div id="received-list" class="text-xs text-zinc-400 bg-zinc-950 p-2 rounded">
        ${receivedItems.length ? receivedItems.map(item => `
          <div class="py-0.5">${item.type || 'item'}: ${item.title || item.path || ''} ${item.path ? `<button onclick="revealSpecificReceived('${item.path.replace(/\\/g,'\\\\')}')" class="underline ml-1">reveal</button>` : ''}</div>
        `).join('') : 'Nothing received yet.'}
      </div>
    </div>

    <div class="mt-4 text-xs text-zinc-500 border-t border-zinc-800 pt-3">
      <div class="font-medium mb-1">Windows Firewall / Troubleshooting</div>
      • If Join fails: allow VibeForge (or node/electron) through Windows Firewall for Private networks.<br>
      • Use LAN IPs (192.168.x.x or 10.x), not localhost.<br>
      • Restart both apps after firewall change.<br>
      • Test with a simple ping first if network is blocked.
    </div>
  `;

  content.innerHTML = html;
}

window.copyPeerAddress = async function() {
  const status = await window.vibeforge.getPeerStatus();
  const addr = status.address || '';
  if (addr) {
    navigator.clipboard.writeText(addr).then(() => showToast('Address copied: ' + addr));
  } else {
    showToast('No address yet (start Host)');
  }
};

window.revealReceivedFolder = async function() {
  const p = await window.vibeforge.revealReceived();
  showToast('Opened received: ' + p);
};

window.revealSpecificReceived = function(p) {
  // best effort: open parent via storage reveal + note path
  window.vibeforge.revealReceived();
  showToast('Look for: ' + p);
};

async function hostFromShare(btn) {
  btn.disabled = true;
  const res = await window.vibeforge.duoHost();
  showToast('Hosting on ' + res.address);
  await switchView('share');
}

function showJoinInput(btn) {
  const extra = document.getElementById('share-extra');
  extra.innerHTML = `
    <div class="flex gap-2 mt-2">
      <input id="join-addr2" placeholder="192.168.x.x:48291" class="flex-1 bg-zinc-900 border border-zinc-700 rounded-2xl px-3 py-2 text-sm">
      <button onclick="doJoinFromShare(this)" class="px-4 border border-zinc-700 rounded-2xl">Join</button>
    </div>
  `;
}

async function doJoinFromShare(btn) {
  const addr = document.getElementById('join-addr2').value.trim();
  if (!addr) return;
  btn.disabled = true;
  const res = await window.vibeforge.duoJoin(addr);
  if (res.ok) showToast('Connected'); else showToast('Failed: ' + res.error);
  await switchView('share');
}

window.sendCurrentSessionNotes = async function() {
  if (!currentProject) return;
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const latest = sessions[0];
  if (latest) {
    const msg = JSON.stringify({ type: 'session-notes', title: latest.title, notes: latest.notes || '' });
    const res = await window.vibeforge.peerSendText(msg);
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
    const res = await window.vibeforge.peerSendFile(filePath);
    if (res && res.ok) {
      showToast('Sent file to peer');
    } else {
      showToast('Send failed: ' + (res ? res.error : 'not connected'));
    }
  }
};

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
  if (!confirm('Delete decision?')) return;
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
window.deleteTask = async function(id) { if (confirm('Delete?')) { await window.vibeforge.deleteTask(id); await switchView('tasks'); } };

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
    html += `<div class="empty">No ideas in this filter. Capture fast when you and Nick say “that’s a good idea.”</div>`;
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
  if (!confirm('Delete this idea?')) return;
  await window.vibeforge.deleteIdea(id);
  await switchView('ideas');
};

// Timeline
async function renderTimelineView(content) {
  const events = await window.vibeforge.getTimeline(currentProject.id);
  let html = `<div class="font-semibold text-xl mb-4">Timeline</div>`;
  if (!events.length) html += `<div class="empty">No events yet. Create sessions, decisions, tasks or ideas.</div>`;
  else html += events.map(e => `<div class="py-2 border-b border-zinc-800 text-sm">${new Date(e.timestamp).toLocaleString()} — <span class="text-zinc-400">${esc(e.type)}</span> ${esc(e.title)}</div>`).join('');
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
    statusHtml = `userData: ${st.userData}<br>DB: ${st.dbExists ? Math.round(st.dbSize/1024)+'KB' : 'no'} • ${st.counts.projects} projects`;
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
          <div class="text-xs text-zinc-400 mb-3">Powered by whisper.cpp — no Python, no dependencies. One-click setup downloads the engine + speech model (~150 MB, one time). After that: live captions during recording + full transcription of any saved session, all offline.</div>

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
    // This is the one the user cares about most: big CHECK FOR UPDATE + clear SIGN IN
    paneHtml = `
      <div class="space-y-4">
        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Check for Updates</div>
          <div class="text-xs text-zinc-400 mb-3">Looks at your GitHub repo for new versions.</div>

          <div class="grid grid-cols-2 gap-2 mb-3">
            <div>
              <div class="text-xs text-zinc-400 mb-1">GitHub Owner</div>
              <input id="set-gh-owner" value="${settings.github_owner || 'jayton123456789-hub'}" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base">
            </div>
            <div>
              <div class="text-xs text-zinc-400 mb-1">Repo Name</div>
              <input id="set-gh-repo" value="${settings.github_repo || 'VibeForge'}" class="w-full bg-zinc-900 border border-zinc-700 rounded-2xl px-4 py-3 text-base">
            </div>
          </div>

          <button onclick="checkForAppUpdates()" class="w-full py-4 bg-white text-black rounded-2xl font-semibold text-lg mb-2">CHECK FOR UPDATE</button>
          <div id="update-status" class="text-center text-sm"></div>
        </div>

        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Sign In to GitHub</div>
          <div class="text-xs text-zinc-400 mb-3">GitHub login (via gh CLI) is persisted on your system — tokens survive app restarts. The app never signs you out; it just queries the current gh status. Once logged in as owner, future builds can publish without re-auth.</div>

          <div class="flex flex-col gap-2">
            <button onclick="doGhSignin(this)" class="w-full py-3 bg-emerald-600 rounded-2xl font-semibold">SIGN IN TO GITHUB</button>
            <div class="flex gap-2">
              <button onclick="checkGhCliStatus(this)" class="flex-1 py-2.5 bg-zinc-800 rounded-2xl text-sm">Check GitHub CLI</button>
              <button onclick="checkAndEnableDevMode()" class="flex-1 py-2.5 bg-emerald-700 rounded-2xl text-sm font-medium">Check / Enable DEV (owner) status</button>
            </div>
          </div>
          <div id="gh-status" class="mt-2 text-xs text-center"></div>
          <div id="github-signin-log" class="mt-2 h-16 overflow-auto bg-black/40 text-[10px] p-2 rounded font-mono"></div>
        </div>

        <div class="bg-[#111113] border border-zinc-800 rounded-3xl p-5">
          <div class="text-lg font-semibold mb-1">Build &amp; Publish (your repo)</div>
          <div class="text-xs text-zinc-400 mb-3">Build the portable version and upload a real release to https://github.com/jayton123456789-hub/VibeForge.git</div>

          <div class="flex gap-2 mb-2">
            <button onclick="buildPortableRelease(this)" class="flex-1 py-3 bg-white text-black rounded-2xl font-semibold">Build Portable</button>
            <button onclick="publishToGitHub(this)" class="flex-1 py-3 bg-emerald-600 rounded-2xl font-semibold">Publish Release</button>
          </div>
          <button onclick="window.vibeforge.revealDist()" class="w-full py-2.5 bg-zinc-800 rounded-2xl text-sm mb-2">Open dist folder</button>
          <div id="build-log" class="h-20 overflow-auto bg-black/40 text-[10px] p-2 rounded font-mono"></div>
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

  // Auto-detect GitHub / DEV status when viewing the Updates tab.
  // gh CLI auth (your login) is persisted by the gh tool itself across app launches and builds.
  // The app never signs you out - it just checks the current gh status.
  // Once signed in as jayton123456789-hub, future builds can publish without re-auth.
  if (currentSettingsTab === 'updates') {
    setTimeout(() => {
      checkAndEnableDevMode();
    }, 100);
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
let lastDeviceCode = null;

window.startOllamaServe = async function(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Starting serve...'; }
  const res = await window.vibeforge.startOllamaServe();
  showToast(res && res.ok ? 'ollama serve started (background)' : ('Failed: ' + (res ? res.error : '')));
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

// === Audio → 16kHz mono WAV conversion (whisper.cpp reads wav natively; webm needs decoding) ===
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

window.transcribeSession = async function(sessionId) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  if (!s || !s.audio_path) return;
  const check = await window.vibeforge.whisperCheck();
  if (!check || !check.configured) {
    showToast('Whisper not set up yet — one click in Settings > AI Tools (about 150 MB, one time).');
    switchView('settings');
    return;
  }
  showToast('Transcribing locally with Whisper... this can take a bit for long recordings.');
  try {
    const bytes = await window.vibeforge.readFileBuffer(s.audio_path);
    if (!bytes) { showToast('Recording file not found on disk.'); return; }
    const wav = await audioBytesToWav16k(bytes);
    const res = await window.vibeforge.transcribeWav({ wav, sessionId, appendToNotes: true });
    if (res && res.ok) {
      showToast(res.transcript ? 'Transcript added to session notes' : 'Done — no speech detected in the recording');
      await openSession(sessionId);
    } else {
      showToast('Transcription failed: ' + (res ? res.error : 'unknown'));
    }
  } catch (e) {
    showToast('Transcription failed: ' + e.message);
  }
};

window.setupOpenSourceWhisper = async function(btn) {
  const logEl = document.getElementById('whisper-setup-log');
  if (btn) btn.disabled = true;
  if (logEl) logEl.textContent = 'Setting up Whisper (whisper.cpp engine + speech model, ~150 MB one-time download)...\nNo Python, no dependencies — works offline after this.\n';

  const res = await window.vibeforge.setupOpenSourceWhisper();
  if (res && res.ok) {
    if (logEl) logEl.textContent += res.alreadySetup ? '\nAlready installed and ready.\n' : '\nSetup complete. Transcription + live captions are ready.\n';
    showToast('Whisper ready — transcription works fully offline now.');
    setTimeout(() => switchView('settings'), 500);
  } else {
    if (logEl) logEl.textContent += '\nSetup failed: ' + (res ? res.error : 'unknown') + '\nCheck your internet connection and retry.\n';
    showToast('Whisper setup failed — see the log in AI Tools.');
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
      showToast('Tip: enable transcription + live captions with one click in Settings → AI Tools');
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

        if (statusEl) statusEl.innerHTML += ` <span class="text-emerald-400 font-semibold">— DEV MODE ENABLED (your repo)</span>`;
        if (logEl) logEl.textContent += '\nDEV account detected. Publishing tools active. You can build and release to your GitHub.\n';

        // Auto-save the correct repo
        await window.vibeforge.saveSetting('github_owner', 'jayton123456789-hub');
        await window.vibeforge.saveSetting('github_repo', 'VibeForge');

        showToast('DEV mode active — ready to publish builds to your repo.');
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

// Sign in via gh CLI (the one supported flow — token persists in gh's keyring across launches)
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
  if (!confirm('Hard reset will wipe the entire VibeForge userData folder (including caches). Continue?')) return;
  const confirmText = await window.showInputModal('Type HARDRESET to confirm', '', 'Safety check: type HARDRESET exactly');
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
  showToast('Install started — visible process or logs below.');
  const r = await window.vibeforge.ollamaInstallAuto();
  if (logEl) logEl.textContent += (r.ok ? 'Install command completed.\n' : ('Install issue: ' + (r.error || r.code) + '\n'));
  if (!r.ok) {
    showToast('Auto install may need manual step — opened help or use Download button.');
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
  if (logEl) logEl.textContent = `Pulling ${model} (this downloads files — may take time + disk space)...\n`;
  showToast('Pull started — watch log. Do not close app.');
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
  showToast(r.configured ? 'Whisper is ready (engine + model installed)' : 'Whisper not set up yet — use the one-click setup');
}

async function checkForAppUpdates() {
  const owner = document.getElementById('set-gh-owner').value.trim();
  const repo = document.getElementById('set-gh-repo').value.trim();
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
  if (el) el.textContent = r.ok ? ('Git: ' + r.version) : ('Git not found: ' + r.error);
  if (btn) btn.textContent = 'Check Git Installed';
}

async function checkGhCliStatus(btn) {
  if (btn) btn.textContent = 'Checking...';
  const r = await window.vibeforge.checkGhCli();
  const el = document.getElementById('gh-status');
  if (el) el.textContent = r.ok ? ('GH CLI: ' + r.version) : ('GH CLI missing — install from https://cli.github.com');
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
  if (el) el.textContent = r.fallback ? 'Browser login flow started — complete then re-check' : (r.ok ? 'Login started' : 'See console');
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
    showToast('Build problem — check the log box.');
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
    showToast('Publish failed — see log.');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Publish Release to GitHub'; }
};

window.saveAllSettings = async function() {
  const name = document.getElementById('set-name') ? document.getElementById('set-name').value.trim() : '';
  const ollama = document.getElementById('set-ollama') ? document.getElementById('set-ollama').value.trim() : '';
  const model = document.getElementById('set-ollama-model') ? document.getElementById('set-ollama-model').value : '';
  const whisper = document.getElementById('set-whisper') ? document.getElementById('set-whisper').value.trim() : '';
  const ghOwner = document.getElementById('set-gh-owner') ? document.getElementById('set-gh-owner').value.trim() : '';
  const ghRepo = document.getElementById('set-gh-repo') ? document.getElementById('set-gh-repo').value.trim() : '';
  const auto = document.getElementById('set-auto-update') ? (document.getElementById('set-auto-update').checked ? 'true' : 'false') : 'true';

  if (name) await window.vibeforge.saveSetting('profile_name', name);
  if (ollama) await window.vibeforge.saveSetting('ollama_url', ollama);
  if (model) await window.vibeforge.saveSetting('ollama_model', model);
  if (whisper) await window.vibeforge.saveSetting('whisper_path', whisper);
  if (ghOwner) await window.vibeforge.saveSetting('github_owner', ghOwner);
  if (ghRepo) await window.vibeforge.saveSetting('github_repo', ghRepo);
  await window.vibeforge.saveSetting('auto_check_updates', auto);
  showToast('Settings saved');
};

async function generateFromSession(sessionId, type, btn) {
  const settings = await window.vibeforge.getSettings();
  const ollamaUrl = settings.ollama_url || 'http://127.0.0.1:11434';
  const model = settings.ollama_model || 'llama3.2';
  const outputEl = document.getElementById(`gen-output-${sessionId}`);
  if (outputEl) {
    outputEl.classList.remove('hidden');
    outputEl.innerHTML = 'Generating with Ollama...';
  }
  btn.disabled = true;

  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  const decisions = await window.vibeforge.getDecisionsBySession(sessionId);
  const tasks = await window.vibeforge.getTasksBySession(sessionId);
  const ideas = await window.vibeforge.getIdeasBySession(sessionId);

  let prompt = `Session: ${s.title}\nNotes: ${s.notes || ''}\n`;
  if (decisions.length) prompt += 'Decisions: ' + decisions.map(d => d.title).join(', ') + '\n';
  if (tasks.length) prompt += 'Tasks: ' + tasks.map(t => t.title).join(', ') + '\n';
  if (ideas.length) prompt += 'Ideas: ' + ideas.map(i => i.title).join(', ') + '\n';

  let system = 'You are a helpful assistant for creative sessions.';
  if (type === 'summary') system = 'Provide a concise summary of the session.';
  else if (type === 'tasks') system = 'Extract and list actionable tasks as bullet points. Return as markdown list.';
  else if (type === 'decisions') system = 'Extract key decisions made.';
  else if (type === 'grok') system = 'Create a detailed prompt for Grok to implement features discussed.';

  try {
    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        prompt: prompt,
        system: system,
        stream: false
      })
    });
    const data = await res.json();
    const output = data.response || 'No output';
    if (outputEl) outputEl.innerHTML = `<pre class="whitespace-pre-wrap">${output}</pre> <button onclick="copyToClipboard(\`${output.replace(/`/g, '\\`')}\`)" class="text-xs underline">Copy</button>`;

    // Save to notes or create items
    if (type === 'tasks') {
      // simple parse lines starting with - 
      const lines = output.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^- /, '').trim());
      for (const line of lines.slice(0, 5)) {
        await window.vibeforge.addTask({ projectId: currentProject.id, sessionId, title: line });
      }
      showToast('Tasks created from generation');
    } else if (type === 'decisions') {
      await window.vibeforge.addDecision({ projectId: currentProject.id, sessionId, title: output.slice(0, 100) });
      showToast('Decision created');
    } else {
      await window.vibeforge.updateSessionNotes(sessionId, (s.notes || '') + '\n\n[Generated ' + type + ']\n' + output);
      showToast('Added to notes');
    }
  } catch (e) {
    if (outputEl) outputEl.innerHTML = 'Ollama error: ' + e.message + '. Check Settings.';
    showToast('Ollama error');
  } finally {
    btn.disabled = false;
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

async function exportGrokPrompt(sessionId) {
  const sessions = await window.vibeforge.getSessions(currentProject.id);
  const s = sessions.find(x => x.id === sessionId);
  if (!s) return;
  const decisions = await window.vibeforge.getDecisionsBySession(sessionId);
  const tasks = await window.vibeforge.getTasksBySession(sessionId);

  let prompt = `You are helping build features from this session:\nTitle: ${s.title}\nNotes: ${s.notes || ''}\n`;
  if (decisions.length) prompt += 'Decisions: ' + decisions.map(d => d.title).join(', ') + '\n';
  if (tasks.length) prompt += 'Tasks: ' + tasks.map(t => t.title).join(', ') + '\n';
  prompt += 'Please implement the discussed features using best practices.';

  const blob = new Blob([prompt], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${s.title.replace(/\s+/g, '_')}_grok_prompt.txt`;
  a.click();
  showToast('Exported Grok Prompt');
}

window.saveSettings = window.saveAllSettings; // compat for any old refs

window.resetAllData = async function() {
  if (!confirm('Really reset everything?')) return;
  const confirmText = await window.showInputModal('Type RESET to confirm', '', 'Safety check: type RESET exactly');
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

async function updateActiveNav() {
  // Already handled in switchView
}

// Boot
window.onload = init;

// Show + wire the big green update banner (used by both auto-on-launch and manual CHECK FOR UPDATE).
// Replaces content so the button always gets a real working onclick (fixes "click does nothing").
function showUpdateBanner(latest) {
  const updateBanner = document.getElementById('update-banner');
  if (!updateBanner) return;
  updateBanner.classList.remove('hidden');
  updateBanner.classList.add('flex');
  updateBanner.innerHTML = `<div><span class="font-semibold">UPDATE AVAILABLE: ${latest || ''}</span> — WANNA RELOAD?</div>
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
