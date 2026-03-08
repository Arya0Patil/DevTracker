/* ===== DevTracker App ===== */

const STORAGE_KEY = 'devtracker_data';
const ACTIVITY_KEY = 'devtracker_activity';

// ===== Data Store =====
let DB = {
  tasks: [],
  projects: [],
  issues: [],
  timeLogs: [],
  standups: [],
  notes: [],
};

let activity = [];
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;
let timerDesc = '';

// ===== Utilities =====
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < today();
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function priorityOrder(p) {
  return { critical: 0, high: 1, medium: 2, low: 3 }[p] ?? 4;
}

function badgeHtml(cls, label) {
  return `<span class="badge badge-${cls}">${label}</span>`;
}

function tagsHtml(tagStr) {
  if (!tagStr) return '';
  const tags = tagStr.split(',').map(t => t.trim()).filter(Boolean);
  if (!tags.length) return '';
  return `<div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`;
}

function fmtHours(h) {
  if (!h) return '0h';
  const n = parseFloat(h);
  if (n < 1) return `${Math.round(n * 60)}m`;
  return `${n}h`;
}

function statusLabel(s) {
  return { todo: 'To Do', inprogress: 'In Progress', done: 'Done', blocked: 'Blocked',
           open: 'Open', resolved: 'Resolved', closed: 'Closed', wontfix: "Won't Fix",
           active: 'Active', planning: 'Planning', paused: 'Paused', completed: 'Completed', archived: 'Archived' }[s] || s;
}

function typeLabel(t) {
  return { bug: 'Bug', feature: 'Feature', improvement: 'Improvement', task: 'Task', question: 'Question' }[t] || t;
}

function moodEmoji(m) {
  return { great: '😁', good: '🙂', okay: '😐', stressed: '😟', blocked: '😠' }[m] || '🙂';
}

// ===== Metadata Helpers =====

function metaChipsHtml(metadata) {
  if (!metadata || !metadata.length) return '';
  return `<div class="meta-chips">${metadata.map(m =>
    `<span class="meta-chip" title="${m.key}: ${m.value}"><span class="meta-key">${m.key}</span><span class="meta-val">${m.value}</span></span>`
  ).join('')}</div>`;
}

function metaInputRowHtml(m) {
  return `<div class="meta-input-row">
    <input type="text" class="meta-key-input" value="${m?.key || ''}" placeholder="key (e.g. sprint)">
    <span class="meta-sep">=</span>
    <input type="text" class="meta-val-input" value="${m?.value || ''}" placeholder="value">
    <button type="button" class="btn-danger" onclick="this.closest('.meta-input-row').remove()">&#10005;</button>
  </div>`;
}

function collectMeta(listId) {
  const rows = document.querySelectorAll(`#${listId} .meta-input-row`);
  return Array.from(rows).map(row => ({
    key: row.querySelector('.meta-key-input').value.trim(),
    value: row.querySelector('.meta-val-input').value.trim(),
  })).filter(m => m.key && m.value);
}

function getAllIssueMetaKeys() {
  const keys = new Set();
  DB.issues.forEach(i => (i.metadata || []).forEach(m => keys.add(m.key)));
  return [...keys].sort();
}

function getAllReqMetaKeys() {
  const keys = new Set();
  DB.projects.forEach(p => (p.requirements || []).forEach(r => (r.metadata || []).forEach(m => keys.add(m.key))));
  return [...keys].sort();
}

function metaMatchesSearch(metadata, search) {
  if (!search) return true;
  const flat = (metadata || []).map(m => `${m.key}:${m.value} ${m.value}`).join(' ').toLowerCase();
  return flat.includes(search);
}

function populateIssueMetaKeyFilter() {
  const sel = document.getElementById('issueFilterMetaKey');
  if (!sel) return;
  const current = sel.value;
  const keys = getAllIssueMetaKeys();
  sel.innerHTML = '<option value="">Meta Key…</option>' +
    keys.map(k => `<option value="${k}" ${k === current ? 'selected' : ''}>${k}</option>`).join('');
  const valInput = document.getElementById('issueFilterMetaValue');
  if (valInput) valInput.disabled = !sel.value;
}

// ===== Persistence =====
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(DB));
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity.slice(0, 50)));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) DB = JSON.parse(raw);
    const act = localStorage.getItem(ACTIVITY_KEY);
    if (act) activity = JSON.parse(act);
  } catch (e) {
    console.warn('Load error', e);
  }
}

function logActivity(text) {
  activity.unshift({ text, ts: Date.now() });
  if (activity.length > 50) activity.pop();
}

// ===== Toast =====
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ===== Modal =====
let currentModal = null;

function openModal(id) {
  currentModal = id;
  document.getElementById('modalOverlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}

const App = {};

App.addIssueMeta = function () {
  const el = document.getElementById('issueMetaList');
  el.insertAdjacentHTML('beforeend', metaInputRowHtml(null));
  el.querySelector('.meta-input-row:last-child .meta-key-input').focus();
};

App.toggleReqMeta = function (btn) {
  const section = btn.closest('.req-block').querySelector('.req-meta-section');
  const isOpen = section.style.display !== 'none';
  section.style.display = isOpen ? 'none' : 'block';
  btn.classList.toggle('active', !isOpen);
};

App.addReqMeta = function (btn) {
  const list = btn.previousElementSibling;
  list.insertAdjacentHTML('beforeend', metaInputRowHtml(null));
  list.querySelector('.meta-input-row:last-child .meta-key-input').focus();
};

App.closeModal = function () {
  if (currentModal) {
    document.getElementById(currentModal).classList.remove('open');
    currentModal = null;
  }
  document.getElementById('modalOverlay').classList.remove('open');
};

// ===== View Navigation =====
App.showView = function (view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(`view-${view}`);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (nav) nav.classList.add('active');
  renderView(view);
};

function renderView(view) {
  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'tasks': renderTasks(); break;
    case 'projects': renderProjects(); break;
    case 'issues': renderIssues(); break;
    case 'timelog': renderTimelog(); break;
    case 'standup': renderStandup(); break;
    case 'notes': renderNotes(); break;
  }
}

// ===== Dashboard =====
function renderDashboard() {
  const todayStr = today();
  document.getElementById('dashDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const openTasks = DB.tasks.filter(t => t.status !== 'done');
  const doneTodayTasks = DB.tasks.filter(t => t.status === 'done' && t.updatedAt?.slice(0, 10) === todayStr);
  const openIssues = DB.issues.filter(i => i.status === 'open' || i.status === 'inprogress');
  const todayHours = DB.timeLogs.filter(l => l.date === todayStr).reduce((a, l) => a + (parseFloat(l.hours) || 0), 0);
  const activeProjects = DB.projects.filter(p => p.status === 'active');

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card accent"><div class="stat-label">Open Tasks</div><div class="stat-value">${openTasks.length}</div><div class="stat-sub">${doneTodayTasks.length} done today</div></div>
    <div class="stat-card danger"><div class="stat-label">Open Issues</div><div class="stat-value">${openIssues.length}</div><div class="stat-sub">${DB.issues.filter(i=>i.priority==='critical'&&i.status==='open').length} critical</div></div>
    <div class="stat-card success"><div class="stat-label">Active Projects</div><div class="stat-value">${activeProjects.length}</div><div class="stat-sub">of ${DB.projects.length} total</div></div>
    <div class="stat-card warning"><div class="stat-label">Hours Today</div><div class="stat-value">${todayHours.toFixed(1)}h</div><div class="stat-sub">${DB.timeLogs.filter(l=>l.date===todayStr).length} entries</div></div>
  `;

  const todayEl = document.getElementById('todayTasks');
  const todayTasks = DB.tasks.filter(t => t.status !== 'done' && (t.dueDate === todayStr || t.status === 'inprogress'))
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority)).slice(0, 8);
  if (todayTasks.length === 0) {
    todayEl.innerHTML = `<div class="no-data">No tasks for today</div>`;
  } else {
    todayEl.innerHTML = todayTasks.map(t => `
      <div class="task-mini-item ${t.status}" onclick="App.openTaskModal('${t.id}')">
        <input type="checkbox" ${t.status==='done'?'checked':''} onclick="event.stopPropagation();App.toggleTask('${t.id}',this)" title="Mark done">
        <span class="task-mini-title">${t.title}</span>
        ${badgeHtml(t.priority, t.priority)}
      </div>
    `).join('');
  }

  const issueEl = document.getElementById('openIssues');
  const criticalIssues = DB.issues.filter(i => i.status === 'open' || i.status === 'inprogress')
    .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority)).slice(0, 8);
  if (criticalIssues.length === 0) {
    issueEl.innerHTML = `<div class="no-data">No open issues</div>`;
  } else {
    issueEl.innerHTML = criticalIssues.map(i => `
      <div class="task-mini-item" onclick="App.openIssueModal('${i.id}')">
        ${badgeHtml(i.type, typeLabel(i.type))}
        <span class="task-mini-title">${i.title}</span>
        ${badgeHtml(i.priority, i.priority)}
      </div>
    `).join('');
  }

  const actEl = document.getElementById('recentActivity');
  if (activity.length === 0) {
    actEl.innerHTML = `<div class="no-data">No activity yet</div>`;
  } else {
    actEl.innerHTML = activity.slice(0, 10).map(a => `
      <div class="activity-item">
        <div class="activity-dot"></div>
        <span class="activity-text">${a.text}</span>
        <span class="activity-time">${timeAgo(a.ts)}</span>
      </div>
    `).join('');
  }

  const todayStandup = DB.standups.find(s => s.date === todayStr);
  const spEl = document.getElementById('todayStandup');
  if (todayStandup) {
    spEl.innerHTML = `
      <div class="sp-label">Yesterday</div><div class="sp-content">${todayStandup.yesterday || '—'}</div>
      <div class="sp-label">Today</div><div class="sp-content">${todayStandup.today || '—'}</div>
      ${todayStandup.blockers ? `<div class="sp-label">Blockers</div><div class="sp-content">${todayStandup.blockers}</div>` : ''}
    `;
  } else {
    spEl.innerHTML = `<div class="no-data">No standup for today. <a href="#" onclick="App.openStandupModal();return false" style="color:var(--accent)">Add one</a></div>`;
  }
}

// ===== Tasks =====
function renderTasks() {
  populateProjectFilter('taskFilterProject');
  const search = document.getElementById('taskSearch').value.toLowerCase();
  const statusF = document.getElementById('taskFilterStatus').value;
  const priorityF = document.getElementById('taskFilterPriority').value;
  const projectF = document.getElementById('taskFilterProject').value;

  let tasks = DB.tasks.filter(t => {
    if (search && !t.title.toLowerCase().includes(search) && !(t.description || '').toLowerCase().includes(search)) return false;
    if (statusF && t.status !== statusF) return false;
    if (priorityF && t.priority !== priorityF) return false;
    if (projectF && t.project !== projectF) return false;
    return true;
  });

  const columns = [
    { id: 'todo', label: 'To Do', color: '#94a3b8' },
    { id: 'inprogress', label: 'In Progress', color: '#22d3ee' },
    { id: 'blocked', label: 'Blocked', color: '#ef4444' },
    { id: 'done', label: 'Done', color: '#22c55e' },
  ];

  const board = document.getElementById('kanbanBoard');
  board.innerHTML = columns.map(col => {
    const colTasks = tasks.filter(t => t.status === col.id)
      .sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          <span style="color:${col.color}">${col.label}</span>
          <span class="col-count">${colTasks.length}</span>
        </div>
        <div class="kanban-cards">
          ${colTasks.length === 0 ? '<div class="no-data" style="padding:16px">Empty</div>' : colTasks.map(t => taskCardHtml(t)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function taskCardHtml(t) {
  const proj = DB.projects.find(p => p.id === t.project);
  const overdue = isOverdue(t.dueDate) && t.status !== 'done';
  return `
    <div class="task-card" onclick="App.openTaskModal('${t.id}')">
      <div class="task-card-actions">
        <button class="btn-edit" onclick="event.stopPropagation();App.openTaskModal('${t.id}')" title="Edit">&#9998;</button>
        <button class="btn-danger" onclick="event.stopPropagation();App.deleteTask('${t.id}')" title="Delete">&#10005;</button>
      </div>
      <div class="task-card-title">${t.title}</div>
      <div class="task-card-meta">
        ${badgeHtml(t.priority, t.priority)}
        ${proj ? `<span class="task-card-project">${proj.name}</span>` : ''}
        ${t.dueDate ? `<span class="task-card-due ${overdue ? 'overdue' : ''}">${overdue ? '&#9888; ' : ''}${formatDate(t.dueDate)}</span>` : ''}
      </div>
      ${tagsHtml(t.tags)}
    </div>
  `;
}

App.openTaskModal = function (id) {
  const task = id ? DB.tasks.find(t => t.id === id) : null;
  document.getElementById('taskModalTitle').textContent = task ? 'Edit Task' : 'New Task';
  document.getElementById('taskId').value = task?.id || '';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskDesc').value = task?.description || '';
  document.getElementById('taskPriority').value = task?.priority || 'medium';
  document.getElementById('taskStatus').value = task?.status || 'todo';
  document.getElementById('taskDueDate').value = task?.dueDate || '';
  document.getElementById('taskEstHours').value = task?.estHours || '';
  document.getElementById('taskTags').value = task?.tags || '';
  populateProjectSelect('taskProject', task?.project);
  openModal('taskModal');
};

App.saveTask = function () {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }
  const id = document.getElementById('taskId').value;
  const isNew = !id;
  const task = {
    id: id || uid(),
    title,
    description: document.getElementById('taskDesc').value.trim(),
    project: document.getElementById('taskProject').value,
    priority: document.getElementById('taskPriority').value,
    status: document.getElementById('taskStatus').value,
    dueDate: document.getElementById('taskDueDate').value,
    estHours: document.getElementById('taskEstHours').value,
    tags: document.getElementById('taskTags').value.trim(),
    createdAt: isNew ? new Date().toISOString() : DB.tasks.find(t=>t.id===id)?.createdAt,
    updatedAt: new Date().toISOString(),
  };
  if (isNew) {
    DB.tasks.push(task);
    logActivity(`Created task: ${title}`);
    toast('Task created', 'success');
  } else {
    const idx = DB.tasks.findIndex(t => t.id === id);
    DB.tasks[idx] = task;
    logActivity(`Updated task: ${title}`);
    toast('Task updated', 'success');
  }
  save();
  App.closeModal();
  renderTasks();
};

App.deleteTask = function (id) {
  const task = DB.tasks.find(t => t.id === id);
  if (!confirm(`Delete task "${task?.title}"?`)) return;
  DB.tasks = DB.tasks.filter(t => t.id !== id);
  logActivity(`Deleted task: ${task?.title}`);
  save();
  renderTasks();
  toast('Task deleted');
};

App.toggleTask = function (id, cb) {
  const task = DB.tasks.find(t => t.id === id);
  if (!task) return;
  task.status = cb.checked ? 'done' : 'todo';
  task.updatedAt = new Date().toISOString();
  logActivity(`${cb.checked ? 'Completed' : 'Reopened'} task: ${task.title}`);
  save();
  renderTasks();
  renderDashboard();
};

// ===== Projects =====
function renderProjects() {
  const search = document.getElementById('projectSearch').value.toLowerCase();
  const reqMeta = document.getElementById('reqMetaSearch').value.toLowerCase().trim();

  let projects = DB.projects.filter(p => {
    if (search && !p.name.toLowerCase().includes(search) && !(p.description || '').toLowerCase().includes(search)) return false;
    if (reqMeta) {
      // Support "key:value" syntax or plain text matching against req title + metadata
      const [rk, rv] = reqMeta.includes(':') ? reqMeta.split(':').map(s => s.trim()) : [null, reqMeta];
      const hasMatch = (p.requirements || []).some(r => {
        if (rk) {
          return (r.metadata || []).some(m =>
            m.key.toLowerCase().includes(rk) && (!rv || m.value.toLowerCase().includes(rv))
          );
        }
        const metaStr = (r.metadata || []).map(m => `${m.key}:${m.value} ${m.value}`).join(' ').toLowerCase();
        return r.title.toLowerCase().includes(reqMeta) || metaStr.includes(reqMeta);
      });
      if (!hasMatch) return false;
    }
    return true;
  });

  const grid = document.getElementById('projectsGrid');
  if (projects.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">&#9632;</div><p>No projects yet. Create your first one!</p></div>`;
    return;
  }
  grid.innerHTML = projects.map(p => projectCardHtml(p)).join('');
}

function projectCardHtml(p) {
  const tasks = DB.tasks.filter(t => t.project === p.id);
  const issues = DB.issues.filter(i => i.project === p.id && i.status === 'open');
  const reqs = p.requirements || [];
  const doneReqs = reqs.filter(r => r.status === 'done').length;
  const pct = reqs.length ? Math.round(doneReqs / reqs.length * 100) : 0;
  const stack = (p.stack || '').split(',').map(s => s.trim()).filter(Boolean);

  return `
    <div class="project-card">
      <div class="project-card-header">
        <div class="project-card-title">
          <span>${p.name}</span>
          <div style="display:flex;gap:6px;align-items:center">
            ${badgeHtml(p.status, statusLabel(p.status))}
            <button class="btn-edit" onclick="App.openProjectModal('${p.id}')" title="Edit">&#9998;</button>
            <button class="btn-danger" onclick="App.deleteProject('${p.id}')" title="Delete">&#10005;</button>
          </div>
        </div>
        ${p.description ? `<div class="project-card-desc">${p.description}</div>` : ''}
        ${stack.length ? `<div class="project-stack">${stack.map(s=>`<span class="stack-tag">${s}</span>`).join('')}</div>` : ''}
        ${p.repo ? `<div style="margin-top:8px;font-size:11px;color:var(--text3)">&#9741; <a href="${p.repo}" target="_blank" style="color:var(--accent)">${p.repo}</a></div>` : ''}
        ${p.dueDate ? `<div style="margin-top:6px;font-size:11px;color:${isOverdue(p.dueDate)?'var(--danger)':'var(--text3)'}">Due: ${formatDate(p.dueDate)}</div>` : ''}
      </div>
      ${reqs.length ? `
        <div class="project-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:12px;font-weight:600;color:var(--text2)">Requirements (${doneReqs}/${reqs.length})</span>
            <span style="font-size:11px;color:var(--text3)">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <ul class="req-list" style="margin-top:10px">
            ${reqs.slice(0, 5).map(r => `
              <li class="req-item ${r.status==='done'?'done-req':''}">
                <input type="checkbox" ${r.status==='done'?'checked':''}
                  onchange="App.toggleReq('${p.id}','${r.id}',this)">
                <span class="req-item-title">${r.title}</span>
                ${badgeHtml(r.priority||'medium', r.priority||'medium')}
                ${metaChipsHtml(r.metadata)}
              </li>
            `).join('')}
            ${reqs.length > 5 ? `<li class="req-item" style="color:var(--text3);justify-content:center">+${reqs.length-5} more</li>` : ''}
          </ul>
        </div>
      ` : ''}
      <div class="project-card-footer">
        <div class="project-stats">
          <span>&#9744; ${tasks.length} tasks</span>
          <span>&#9651; ${issues} open issues</span>
        </div>
        <button class="btn-sm" onclick="App.openProjectModal('${p.id}')">Edit</button>
      </div>
    </div>
  `;
}

App.openProjectModal = function (id) {
  const proj = id ? DB.projects.find(p => p.id === id) : null;
  document.getElementById('projectModalTitle').textContent = proj ? 'Edit Project' : 'New Project';
  document.getElementById('projectId').value = proj?.id || '';
  document.getElementById('projectName').value = proj?.name || '';
  document.getElementById('projectDesc').value = proj?.description || '';
  document.getElementById('projectStatus').value = proj?.status || 'active';
  document.getElementById('projectDueDate').value = proj?.dueDate || '';
  document.getElementById('projectRepo').value = proj?.repo || '';
  document.getElementById('projectStack').value = proj?.stack || '';
  renderRequirementsList(proj?.requirements || []);
  openModal('projectModal');
};

function renderRequirementsList(reqs) {
  const el = document.getElementById('requirementsList');
  el.innerHTML = reqs.map(r => reqBlockHtml(r)).join('');
}

function reqBlockHtml(r) {
  const hasMeta = r?.metadata?.length > 0;
  return `
    <div class="req-block" data-req-id="${r?.id || uid()}">
      <div class="req-input-row">
        <input type="text" value="${r?.title || ''}" placeholder="Requirement..." data-req-title>
        <select data-req-priority>
          <option value="low" ${r?.priority==='low'?'selected':''}>Low</option>
          <option value="medium" ${r?.priority==='medium'||!r?.priority?'selected':''}>Med</option>
          <option value="high" ${r?.priority==='high'?'selected':''}>High</option>
          <option value="critical" ${r?.priority==='critical'?'selected':''}>Crit</option>
        </select>
        <select data-req-status>
          <option value="todo" ${r?.status==='todo'||!r?.status?'selected':''}>Todo</option>
          <option value="inprogress" ${r?.status==='inprogress'?'selected':''}>In Prog</option>
          <option value="done" ${r?.status==='done'?'selected':''}>Done</option>
        </select>
        <button type="button" class="btn-sm req-meta-btn ${hasMeta ? 'active' : ''}"
          onclick="App.toggleReqMeta(this)" title="Toggle metadata fields">&#9670; Meta${hasMeta ? ` (${r.metadata.length})` : ''}</button>
        <button type="button" class="btn-danger" onclick="this.closest('.req-block').remove()">&#10005;</button>
      </div>
      <div class="req-meta-section" style="display:${hasMeta ? 'block' : 'none'}">
        <div class="req-meta-list">${(r?.metadata || []).map(m => metaInputRowHtml(m)).join('')}</div>
        <button type="button" class="btn-sm" onclick="App.addReqMeta(this)" style="margin-top:6px">+ Add Meta Field</button>
      </div>
    </div>
  `;
}

App.addRequirement = function () {
  const el = document.getElementById('requirementsList');
  el.insertAdjacentHTML('beforeend', reqBlockHtml(null));
  el.querySelector('.req-block:last-child [data-req-title]').focus();
};

App.saveProject = function () {
  const name = document.getElementById('projectName').value.trim();
  if (!name) { toast('Project name is required', 'error'); return; }
  const id = document.getElementById('projectId').value;
  const isNew = !id;

  const reqBlocks = document.querySelectorAll('#requirementsList .req-block');
  const requirements = Array.from(reqBlocks).map(block => {
    const metaRows = block.querySelectorAll('.req-meta-list .meta-input-row');
    const metadata = Array.from(metaRows).map(row => ({
      key: row.querySelector('.meta-key-input').value.trim(),
      value: row.querySelector('.meta-val-input').value.trim(),
    })).filter(m => m.key && m.value);
    return {
      id: block.dataset.reqId || uid(),
      title: block.querySelector('[data-req-title]').value.trim(),
      priority: block.querySelector('[data-req-priority]').value,
      status: block.querySelector('[data-req-status]').value,
      metadata,
    };
  }).filter(r => r.title);

  const proj = {
    id: id || uid(),
    name,
    description: document.getElementById('projectDesc').value.trim(),
    status: document.getElementById('projectStatus').value,
    dueDate: document.getElementById('projectDueDate').value,
    repo: document.getElementById('projectRepo').value.trim(),
    stack: document.getElementById('projectStack').value.trim(),
    requirements,
    createdAt: isNew ? new Date().toISOString() : DB.projects.find(p=>p.id===id)?.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (isNew) {
    DB.projects.push(proj);
    logActivity(`Created project: ${name}`);
    toast('Project created', 'success');
  } else {
    const idx = DB.projects.findIndex(p => p.id === id);
    DB.projects[idx] = proj;
    logActivity(`Updated project: ${name}`);
    toast('Project updated', 'success');
  }
  save();
  App.closeModal();
  renderProjects();
  updateProjectDropdowns();
};

App.deleteProject = function (id) {
  const proj = DB.projects.find(p => p.id === id);
  if (!confirm(`Delete project "${proj?.name}"? This won't delete associated tasks or issues.`)) return;
  DB.projects = DB.projects.filter(p => p.id !== id);
  logActivity(`Deleted project: ${proj?.name}`);
  save();
  renderProjects();
  updateProjectDropdowns();
  toast('Project deleted');
};

App.toggleReq = function (projId, reqId, cb) {
  const proj = DB.projects.find(p => p.id === projId);
  if (!proj) return;
  const req = (proj.requirements || []).find(r => r.id === reqId);
  if (req) {
    req.status = cb.checked ? 'done' : 'todo';
    save();
    renderProjects();
  }
};

// ===== Issues =====
function renderIssues() {
  populateProjectFilter('issueFilterProject');
  populateIssueMetaKeyFilter();

  const search = document.getElementById('issueSearch').value.toLowerCase();
  const statusF = document.getElementById('issueFilterStatus').value;
  const typeF = document.getElementById('issueFilterType').value;
  const projectF = document.getElementById('issueFilterProject').value;
  const metaKeyF = document.getElementById('issueFilterMetaKey').value;
  const metaValF = document.getElementById('issueFilterMetaValue').value.toLowerCase();

  let issues = DB.issues.filter(i => {
    if (search) {
      const metaStr = (i.metadata || []).map(m => `${m.key}:${m.value} ${m.value}`).join(' ').toLowerCase();
      const hits = i.title.toLowerCase().includes(search)
        || (i.description || '').toLowerCase().includes(search)
        || (i.assignee || '').toLowerCase().includes(search)
        || (i.tags || '').toLowerCase().includes(search)
        || metaStr.includes(search);
      if (!hits) return false;
    }
    if (statusF && i.status !== statusF) return false;
    if (typeF && i.type !== typeF) return false;
    if (projectF && i.project !== projectF) return false;
    if (metaKeyF) {
      const match = (i.metadata || []).find(m =>
        m.key === metaKeyF && (!metaValF || m.value.toLowerCase().includes(metaValF))
      );
      if (!match) return false;
    }
    return true;
  }).sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));

  const tbody = document.getElementById('issuesTableBody');
  if (issues.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">&#9651;</div><p>No issues found</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = issues.map((i, idx) => {
    const proj = DB.projects.find(p => p.id === i.project);
    return `
      <tr>
        <td><span class="issue-id">#${String(idx + 1).padStart(3, '0')}</span></td>
        <td>
          <div style="font-weight:500">${i.title}</div>
          ${tagsHtml(i.tags)}
        </td>
        <td>${badgeHtml(i.type, typeLabel(i.type))}</td>
        <td>${proj ? proj.name : '—'}</td>
        <td>${badgeHtml(i.priority, i.priority)}</td>
        <td>${badgeHtml(i.status, statusLabel(i.status))}</td>
        <td>${metaChipsHtml(i.metadata)}</td>
        <td style="color:var(--text3);font-size:12px">${formatDate(i.createdAt?.slice(0,10))}</td>
        <td>
          <button class="btn-edit" onclick="App.openIssueModal('${i.id}')" title="Edit">&#9998;</button>
          <button class="btn-danger" onclick="App.deleteIssue('${i.id}')" title="Delete">&#10005;</button>
        </td>
      </tr>
    `;
  }).join('');
}

App.openIssueModal = function (id) {
  const issue = id ? DB.issues.find(i => i.id === id) : null;
  document.getElementById('issueModalTitle').textContent = issue ? 'Edit Issue' : 'New Issue';
  document.getElementById('issueId').value = issue?.id || '';
  document.getElementById('issueTitle').value = issue?.title || '';
  document.getElementById('issueDesc').value = issue?.description || '';
  document.getElementById('issueType').value = issue?.type || 'bug';
  document.getElementById('issuePriority').value = issue?.priority || 'medium';
  document.getElementById('issueStatus').value = issue?.status || 'open';
  document.getElementById('issueAssignee').value = issue?.assignee || '';
  document.getElementById('issueTags').value = issue?.tags || '';
  document.getElementById('issueSteps').value = issue?.steps || '';
  populateProjectSelect('issueProject', issue?.project);
  // Populate metadata editor
  const metaList = document.getElementById('issueMetaList');
  metaList.innerHTML = (issue?.metadata || []).map(m => metaInputRowHtml(m)).join('');
  openModal('issueModal');
};

App.saveIssue = function () {
  const title = document.getElementById('issueTitle').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }
  const id = document.getElementById('issueId').value;
  const isNew = !id;
  const issue = {
    id: id || uid(),
    title,
    description: document.getElementById('issueDesc').value.trim(),
    project: document.getElementById('issueProject').value,
    type: document.getElementById('issueType').value,
    priority: document.getElementById('issuePriority').value,
    status: document.getElementById('issueStatus').value,
    assignee: document.getElementById('issueAssignee').value.trim(),
    tags: document.getElementById('issueTags').value.trim(),
    steps: document.getElementById('issueSteps').value.trim(),
    metadata: collectMeta('issueMetaList'),
    createdAt: isNew ? new Date().toISOString() : DB.issues.find(i=>i.id===id)?.createdAt,
    updatedAt: new Date().toISOString(),
  };
  if (isNew) {
    DB.issues.push(issue);
    logActivity(`Created issue: ${title}`);
    toast('Issue created', 'success');
  } else {
    const idx = DB.issues.findIndex(i => i.id === id);
    DB.issues[idx] = issue;
    logActivity(`Updated issue: ${title}`);
    toast('Issue updated', 'success');
  }
  save();
  App.closeModal();
  renderIssues();
};

App.deleteIssue = function (id) {
  const issue = DB.issues.find(i => i.id === id);
  if (!confirm(`Delete issue "${issue?.title}"?`)) return;
  DB.issues = DB.issues.filter(i => i.id !== id);
  logActivity(`Deleted issue: ${issue?.title}`);
  save();
  renderIssues();
  toast('Issue deleted');
};

// ===== Time Log =====
function renderTimelog() {
  populateProjectFilter('timelogFilterProject');
  document.getElementById('timelogDate').max = today();

  const dateF = document.getElementById('timelogDate').value;
  const projectF = document.getElementById('timelogFilterProject').value;

  let logs = DB.timeLogs.filter(l => {
    if (dateF && l.date !== dateF) return false;
    if (projectF && l.project !== projectF) return false;
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  // Summary
  const totalHours = logs.reduce((a, l) => a + (parseFloat(l.hours) || 0), 0);
  const byCategory = {};
  logs.forEach(l => {
    byCategory[l.category] = (byCategory[l.category] || 0) + (parseFloat(l.hours) || 0);
  });
  const summaryEl = document.getElementById('timelogSummary');
  summaryEl.innerHTML = `
    <div class="stat-card accent"><div class="stat-label">Total Hours</div><div class="stat-value">${totalHours.toFixed(1)}h</div></div>
    ${Object.entries(byCategory).map(([cat, h]) => `
      <div class="stat-card"><div class="stat-label">${cat}</div><div class="stat-value">${h.toFixed(1)}h</div></div>
    `).join('')}
  `;

  const tbody = document.getElementById('timelogTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">&#9711;</div><p>No time logs found</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = logs.map(l => {
    const proj = DB.projects.find(p => p.id === l.project);
    return `
      <tr>
        <td style="color:var(--text2);font-size:12px">${formatDate(l.date)}</td>
        <td>
          <div style="font-weight:500">${l.description}</div>
          <span class="badge badge-medium" style="margin-top:4px">${l.category || 'other'}</span>
        </td>
        <td>${proj ? proj.name : '—'}</td>
        <td><strong>${fmtHours(l.hours)}</strong></td>
        <td style="color:var(--text3);font-size:12px">${l.notes || '—'}</td>
        <td>
          <button class="btn-edit" onclick="App.openTimeLogModal('${l.id}')" title="Edit">&#9998;</button>
          <button class="btn-danger" onclick="App.deleteTimeLog('${l.id}')" title="Delete">&#10005;</button>
        </td>
      </tr>
    `;
  }).join('');
}

App.openTimeLogModal = function (id) {
  const log = id ? DB.timeLogs.find(l => l.id === id) : null;
  document.getElementById('timelogModalTitle').textContent = log ? 'Edit Time Log' : 'Log Time';
  document.getElementById('timelogId').value = log?.id || '';
  document.getElementById('timelogDesc').value = log?.description || '';
  document.getElementById('timelogEntryDate').value = log?.date || today();
  document.getElementById('timelogHours').value = log?.hours || '';
  document.getElementById('timelogCategory').value = log?.category || 'development';
  document.getElementById('timelogNotes').value = log?.notes || '';
  populateProjectSelect('timelogProject', log?.project);
  openModal('timelogModal');
};

App.saveTimeLog = function () {
  const desc = document.getElementById('timelogDesc').value.trim();
  const hours = document.getElementById('timelogHours').value;
  if (!desc || !hours) { toast('Description and hours are required', 'error'); return; }
  const id = document.getElementById('timelogId').value;
  const isNew = !id;
  const log = {
    id: id || uid(),
    description: desc,
    project: document.getElementById('timelogProject').value,
    date: document.getElementById('timelogEntryDate').value || today(),
    hours: parseFloat(hours),
    category: document.getElementById('timelogCategory').value,
    notes: document.getElementById('timelogNotes').value.trim(),
    createdAt: isNew ? new Date().toISOString() : DB.timeLogs.find(l=>l.id===id)?.createdAt,
  };
  if (isNew) {
    DB.timeLogs.push(log);
    logActivity(`Logged ${fmtHours(hours)} for: ${desc}`);
    toast('Time logged', 'success');
  } else {
    const idx = DB.timeLogs.findIndex(l => l.id === id);
    DB.timeLogs[idx] = log;
    toast('Time log updated', 'success');
  }
  save();
  App.closeModal();
  renderTimelog();
};

App.deleteTimeLog = function (id) {
  if (!confirm('Delete this time log entry?')) return;
  DB.timeLogs = DB.timeLogs.filter(l => l.id !== id);
  save();
  renderTimelog();
  toast('Entry deleted');
};

// ===== Standup =====
function renderStandup() {
  const dateF = document.getElementById('standupDate').value;
  let standups = DB.standups.filter(s => !dateF || s.date === dateF)
    .sort((a, b) => b.date.localeCompare(a.date));

  const el = document.getElementById('standupList');
  if (standups.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">&#9670;</div><p>No standup notes yet</p></div>`;
    return;
  }
  el.innerHTML = standups.map(s => `
    <div class="standup-card">
      <div class="standup-card-header">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="standup-mood">${moodEmoji(s.mood)}</span>
          <span class="standup-date">${formatDate(s.date)}</span>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn-edit" onclick="App.openStandupModal('${s.id}')" title="Edit">&#9998;</button>
          <button class="btn-danger" onclick="App.deleteStandup('${s.id}')" title="Delete">&#10005;</button>
        </div>
      </div>
      <div class="standup-card-body">
        <div class="standup-section">
          <h4>Yesterday</h4>
          <p>${s.yesterday || '—'}</p>
        </div>
        <div class="standup-section">
          <h4>Today</h4>
          <p>${s.today || '—'}</p>
        </div>
        <div class="standup-section">
          <h4>Blockers</h4>
          <p>${s.blockers || 'None'}</p>
          ${s.goals ? `<h4 style="margin-top:12px">Weekly Goals</h4><p>${s.goals}</p>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

App.openStandupModal = function (id) {
  const s = id ? DB.standups.find(s => s.id === id) : null;
  document.getElementById('standupModalTitle').textContent = s ? 'Edit Standup' : 'Daily Standup';
  document.getElementById('standupId').value = s?.id || '';
  document.getElementById('standupEntryDate').value = s?.date || today();
  document.getElementById('standupMood').value = s?.mood || 'good';
  document.getElementById('standupYesterday').value = s?.yesterday || '';
  document.getElementById('standupToday').value = s?.today || '';
  document.getElementById('standupBlockers').value = s?.blockers || '';
  document.getElementById('standupGoals').value = s?.goals || '';
  openModal('standupModal');
};

App.saveStandup = function () {
  const id = document.getElementById('standupId').value;
  const isNew = !id;
  const s = {
    id: id || uid(),
    date: document.getElementById('standupEntryDate').value || today(),
    mood: document.getElementById('standupMood').value,
    yesterday: document.getElementById('standupYesterday').value.trim(),
    today: document.getElementById('standupToday').value.trim(),
    blockers: document.getElementById('standupBlockers').value.trim(),
    goals: document.getElementById('standupGoals').value.trim(),
    createdAt: isNew ? new Date().toISOString() : DB.standups.find(s=>s.id===id)?.createdAt,
  };
  if (isNew) {
    DB.standups.push(s);
    logActivity(`Added standup for ${formatDate(s.date)}`);
    toast('Standup saved', 'success');
  } else {
    const idx = DB.standups.findIndex(s => s.id === id);
    DB.standups[idx] = s;
    toast('Standup updated', 'success');
  }
  save();
  App.closeModal();
  renderStandup();
};

App.deleteStandup = function (id) {
  if (!confirm('Delete this standup?')) return;
  DB.standups = DB.standups.filter(s => s.id !== id);
  save();
  renderStandup();
  toast('Standup deleted');
};

// ===== Notes =====
function renderNotes() {
  const search = document.getElementById('noteSearch').value.toLowerCase();
  let notes = DB.notes.filter(n =>
    !search || n.title.toLowerCase().includes(search) || (n.content || '').toLowerCase().includes(search)
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const grid = document.getElementById('notesGrid');
  if (notes.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">&#9741;</div><p>No notes yet</p></div>`;
    return;
  }
  grid.innerHTML = notes.map(n => {
    const proj = DB.projects.find(p => p.id === n.project);
    return `
      <div class="note-card" onclick="App.openNoteModal('${n.id}')">
        <div class="note-card-header">
          <span class="note-title">${n.title}</span>
          <div style="display:flex;gap:4px" onclick="event.stopPropagation()">
            <button class="btn-danger" onclick="App.deleteNote('${n.id}')" title="Delete">&#10005;</button>
          </div>
        </div>
        <div class="note-card-body">${n.content || ''}</div>
        <div class="note-card-footer">
          <span>${badgeHtml(n.category || 'general', n.category || 'general')}</span>
          ${proj ? `<span style="color:var(--accent)">${proj.name}</span>` : ''}
          <span>${formatDate(n.createdAt?.slice(0,10))}</span>
        </div>
        ${tagsHtml(n.tags)}
      </div>
    `;
  }).join('');
}

App.openNoteModal = function (id) {
  const note = id ? DB.notes.find(n => n.id === id) : null;
  document.getElementById('noteModalTitle').textContent = note ? 'Edit Note' : 'New Note';
  document.getElementById('noteId').value = note?.id || '';
  document.getElementById('noteTitle').value = note?.title || '';
  document.getElementById('noteCategory').value = note?.category || 'general';
  document.getElementById('noteContent').value = note?.content || '';
  document.getElementById('noteTags').value = note?.tags || '';
  populateProjectSelect('noteProject', note?.project);
  openModal('noteModal');
};

App.saveNote = function () {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  if (!title || !content) { toast('Title and content are required', 'error'); return; }
  const id = document.getElementById('noteId').value;
  const isNew = !id;
  const note = {
    id: id || uid(),
    title,
    category: document.getElementById('noteCategory').value,
    content,
    tags: document.getElementById('noteTags').value.trim(),
    project: document.getElementById('noteProject').value,
    createdAt: isNew ? new Date().toISOString() : DB.notes.find(n=>n.id===id)?.createdAt,
    updatedAt: new Date().toISOString(),
  };
  if (isNew) {
    DB.notes.push(note);
    logActivity(`Created note: ${title}`);
    toast('Note saved', 'success');
  } else {
    const idx = DB.notes.findIndex(n => n.id === id);
    DB.notes[idx] = note;
    toast('Note updated', 'success');
  }
  save();
  App.closeModal();
  renderNotes();
};

App.deleteNote = function (id) {
  const note = DB.notes.find(n => n.id === id);
  if (!confirm(`Delete note "${note?.title}"?`)) return;
  DB.notes = DB.notes.filter(n => n.id !== id);
  save();
  renderNotes();
  toast('Note deleted');
};

// ===== Helpers =====
function populateProjectSelect(selectId, selectedId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  sel.innerHTML = '<option value="">No Project</option>' +
    DB.projects.map(p => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`).join('');
}

function populateProjectFilter(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Projects</option>' +
    DB.projects.map(p => `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${p.name}</option>`).join('');
}

function updateProjectDropdowns() {
  ['taskFilterProject', 'issueFilterProject', 'timelogFilterProject'].forEach(id => {
    const el = document.getElementById(id);
    if (el) populateProjectFilter(id);
  });
}

// ===== Export to Excel =====
App.exportAll = function () {
  if (typeof XLSX === 'undefined') {
    toast('Excel library not loaded. Check your internet connection.', 'error');
    return;
  }
  const wb = XLSX.utils.book_new();

  // Tasks sheet
  const tasksData = DB.tasks.map(t => ({
    ID: t.id, Title: t.title, Description: t.description,
    Project: DB.projects.find(p=>p.id===t.project)?.name || '',
    Priority: t.priority, Status: t.status,
    'Due Date': t.dueDate, 'Est Hours': t.estHours, Tags: t.tags,
    'Created At': t.createdAt, 'Updated At': t.updatedAt
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tasksData.length ? tasksData : [{}]), 'Tasks');

  // Projects sheet
  const projData = DB.projects.map(p => ({
    ID: p.id, Name: p.name, Description: p.description,
    Status: p.status, 'Due Date': p.dueDate, Repo: p.repo,
    'Tech Stack': p.stack, 'Total Requirements': (p.requirements||[]).length,
    'Done Requirements': (p.requirements||[]).filter(r=>r.status==='done').length,
    'Created At': p.createdAt
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projData.length ? projData : [{}]), 'Projects');

  // Requirements sheet
  const reqData = [];
  DB.projects.forEach(p => {
    (p.requirements || []).forEach(r => {
      reqData.push({
        'Req ID': r.id, Project: p.name, Requirement: r.title,
        Priority: r.priority, Status: r.status,
        Metadata: (r.metadata || []).map(m => `${m.key}=${m.value}`).join('; '),
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reqData.length ? reqData : [{}]), 'Requirements');

  // Req Metadata sheet (one row per metadata field per requirement, for easy editing)
  const reqMetaData = [];
  DB.projects.forEach(p => {
    (p.requirements || []).forEach(r => {
      (r.metadata || []).forEach(m => {
        reqMetaData.push({ 'Req ID': r.id, Project: p.name, Requirement: r.title, Key: m.key, Value: m.value });
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(reqMetaData.length ? reqMetaData : [{}]), 'Req Metadata');

  // Issues sheet
  const issuesData = DB.issues.map((i, idx) => ({
    'Issue #': `#${String(idx+1).padStart(3,'0')}`,
    ID: i.id, Title: i.title, Description: i.description,
    Project: DB.projects.find(p=>p.id===i.project)?.name || '',
    Type: i.type, Priority: i.priority, Status: i.status,
    Assignee: i.assignee, Tags: i.tags, Steps: i.steps,
    Metadata: (i.metadata || []).map(m => `${m.key}=${m.value}`).join('; '),
    'Created At': i.createdAt, 'Updated At': i.updatedAt
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issuesData.length ? issuesData : [{}]), 'Issues');

  // Issue Metadata sheet (one row per metadata field per issue, for easy editing)
  const issueMetaData = [];
  DB.issues.forEach((i, idx) => {
    (i.metadata || []).forEach(m => {
      issueMetaData.push({
        'Issue #': `#${String(idx+1).padStart(3,'0')}`,
        'Issue ID': i.id, 'Issue Title': i.title, Key: m.key, Value: m.value
      });
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(issueMetaData.length ? issueMetaData : [{}]), 'Issue Metadata');

  // Time Logs sheet
  const timeData = DB.timeLogs.map(l => ({
    ID: l.id, Date: l.date, Description: l.description,
    Project: DB.projects.find(p=>p.id===l.project)?.name || '',
    Hours: l.hours, Category: l.category, Notes: l.notes
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(timeData.length ? timeData : [{}]), 'Time Logs');

  // Standups sheet
  const standupData = DB.standups.map(s => ({
    ID: s.id, Date: s.date, Mood: s.mood,
    Yesterday: s.yesterday, Today: s.today,
    Blockers: s.blockers, 'Weekly Goals': s.goals
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(standupData.length ? standupData : [{}]), 'Standups');

  // Notes sheet
  const noteData = DB.notes.map(n => ({
    ID: n.id, Title: n.title, Category: n.category,
    Project: DB.projects.find(p=>p.id===n.project)?.name || '',
    Content: n.content, Tags: n.tags, 'Created At': n.createdAt
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noteData.length ? noteData : [{}]), 'Notes');

  const filename = `devtracker-${today()}.xlsx`;
  XLSX.writeFile(wb, filename);
  logActivity(`Exported all data to ${filename}`);
  toast(`Exported to ${filename}`, 'success');
};

// ===== Import from Excel =====
App.importExcel = function (file) {
  if (!file) return;
  if (typeof XLSX === 'undefined') {
    toast('Excel library not loaded.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      let imported = { tasks: 0, projects: 0, issues: 0, timeLogs: 0, standups: 0, notes: 0 };

      // Import Tasks
      if (wb.SheetNames.includes('Tasks')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Tasks']);
        rows.forEach(row => {
          if (!row.Title) return;
          const exists = row.ID && DB.tasks.find(t => t.id === row.ID);
          const proj = DB.projects.find(p => p.name === row.Project);
          const task = {
            id: (row.ID && !exists) ? row.ID : uid(),
            title: row.Title || '', description: row.Description || '',
            project: proj?.id || '', priority: row.Priority || 'medium',
            status: row.Status || 'todo', dueDate: row['Due Date'] || '',
            estHours: row['Est Hours'] || '', tags: row.Tags || '',
            createdAt: row['Created At'] || new Date().toISOString(),
            updatedAt: row['Updated At'] || new Date().toISOString(),
          };
          if (exists) { const idx = DB.tasks.findIndex(t=>t.id===row.ID); DB.tasks[idx] = task; }
          else { DB.tasks.push(task); imported.tasks++; }
        });
      }

      // Import Projects
      if (wb.SheetNames.includes('Projects')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Projects']);
        rows.forEach(row => {
          if (!row.Name) return;
          const exists = row.ID && DB.projects.find(p => p.id === row.ID);
          const proj = {
            id: (row.ID && !exists) ? row.ID : uid(),
            name: row.Name || '', description: row.Description || '',
            status: row.Status || 'active', dueDate: row['Due Date'] || '',
            repo: row.Repo || '', stack: row['Tech Stack'] || '',
            requirements: DB.projects.find(p=>p.id===row.ID)?.requirements || [],
            createdAt: row['Created At'] || new Date().toISOString(),
          };
          if (exists) { const idx = DB.projects.findIndex(p=>p.id===row.ID); DB.projects[idx] = proj; }
          else { DB.projects.push(proj); imported.projects++; }
        });
      }

      // Import Requirements (with metadata)
      if (wb.SheetNames.includes('Requirements')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Requirements']);
        rows.forEach(row => {
          if (!row.Requirement || !row.Project) return;
          const proj = DB.projects.find(p => p.name === row.Project);
          if (!proj) return;
          if (!proj.requirements) proj.requirements = [];
          const reqId = row['Req ID'];
          const existingReq = reqId && proj.requirements.find(r => r.id === reqId);
          const metadata = row.Metadata
            ? String(row.Metadata).split(';').map(s => {
                const [k, ...rest] = s.trim().split('=');
                return k ? { key: k.trim(), value: rest.join('=').trim() } : null;
              }).filter(Boolean)
            : (existingReq?.metadata || []);
          if (existingReq) {
            existingReq.title = row.Requirement;
            existingReq.priority = row.Priority || existingReq.priority;
            existingReq.status = row.Status || existingReq.status;
            if (row.Metadata) existingReq.metadata = metadata;
          } else {
            proj.requirements.push({
              id: reqId || uid(), title: row.Requirement,
              priority: row.Priority || 'medium', status: row.Status || 'todo', metadata,
            });
          }
        });
      }

      // Import Issues
      if (wb.SheetNames.includes('Issues')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Issues']);
        rows.forEach(row => {
          if (!row.Title) return;
          const exists = row.ID && DB.issues.find(i => i.id === row.ID);
          const proj = DB.projects.find(p => p.name === row.Project);
          // Parse inline metadata "key=value; key2=value2"
          const metadata = row.Metadata
            ? String(row.Metadata).split(';').map(s => {
                const [k, ...rest] = s.trim().split('=');
                return k ? { key: k.trim(), value: rest.join('=').trim() } : null;
              }).filter(Boolean)
            : (exists ? DB.issues.find(i=>i.id===row.ID)?.metadata || [] : []);
          const issue = {
            id: (row.ID && !exists) ? row.ID : uid(),
            title: row.Title || '', description: row.Description || '',
            project: proj?.id || '', type: row.Type || 'bug',
            priority: row.Priority || 'medium', status: row.Status || 'open',
            assignee: row.Assignee || '', tags: row.Tags || '', steps: row.Steps || '',
            metadata,
            createdAt: row['Created At'] || new Date().toISOString(),
            updatedAt: row['Updated At'] || new Date().toISOString(),
          };
          if (exists) { const idx = DB.issues.findIndex(i=>i.id===row.ID); DB.issues[idx] = issue; }
          else { DB.issues.push(issue); imported.issues++; }
        });
      }

      // Import Issue Metadata sheet (upserts metadata fields into existing issues)
      if (wb.SheetNames.includes('Issue Metadata')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Issue Metadata']);
        rows.forEach(row => {
          if (!row['Issue ID'] || !row.Key || !row.Value) return;
          const issue = DB.issues.find(i => i.id === row['Issue ID']);
          if (!issue) return;
          if (!issue.metadata) issue.metadata = [];
          const existing = issue.metadata.find(m => m.key === row.Key);
          if (existing) existing.value = String(row.Value);
          else issue.metadata.push({ key: String(row.Key), value: String(row.Value) });
        });
      }

      // Import Req Metadata sheet (upserts metadata into existing requirements)
      if (wb.SheetNames.includes('Req Metadata')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Req Metadata']);
        rows.forEach(row => {
          if (!row['Req ID'] || !row.Key || !row.Value) return;
          DB.projects.forEach(p => {
            const req = (p.requirements || []).find(r => r.id === row['Req ID']);
            if (!req) return;
            if (!req.metadata) req.metadata = [];
            const existing = req.metadata.find(m => m.key === row.Key);
            if (existing) existing.value = String(row.Value);
            else req.metadata.push({ key: String(row.Key), value: String(row.Value) });
          });
        });
      }

      // Import Time Logs
      if (wb.SheetNames.includes('Time Logs')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Time Logs']);
        rows.forEach(row => {
          if (!row.Description || !row.Hours) return;
          const exists = row.ID && DB.timeLogs.find(l => l.id === row.ID);
          if (exists) return;
          const proj = DB.projects.find(p => p.name === row.Project);
          DB.timeLogs.push({
            id: row.ID || uid(), description: row.Description,
            project: proj?.id || '', date: row.Date || today(),
            hours: parseFloat(row.Hours) || 0, category: row.Category || 'other',
            notes: row.Notes || '', createdAt: new Date().toISOString(),
          });
          imported.timeLogs++;
        });
      }

      // Import Standups
      if (wb.SheetNames.includes('Standups')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Standups']);
        rows.forEach(row => {
          if (!row.Date) return;
          const exists = row.ID && DB.standups.find(s => s.id === row.ID);
          if (exists) return;
          DB.standups.push({
            id: row.ID || uid(), date: row.Date, mood: row.Mood || 'good',
            yesterday: row.Yesterday || '', today: row.Today || '',
            blockers: row.Blockers || '', goals: row['Weekly Goals'] || '',
            createdAt: new Date().toISOString(),
          });
          imported.standups++;
        });
      }

      // Import Notes
      if (wb.SheetNames.includes('Notes')) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Notes']);
        rows.forEach(row => {
          if (!row.Title || !row.Content) return;
          const exists = row.ID && DB.notes.find(n => n.id === row.ID);
          if (exists) return;
          const proj = DB.projects.find(p => p.name === row.Project);
          DB.notes.push({
            id: row.ID || uid(), title: row.Title, category: row.Category || 'general',
            project: proj?.id || '', content: row.Content, tags: row.Tags || '',
            createdAt: row['Created At'] || new Date().toISOString(),
          });
          imported.notes++;
        });
      }

      save();
      updateProjectDropdowns();
      const total = Object.values(imported).reduce((a,b)=>a+b,0);
      logActivity(`Imported ${total} records from Excel`);
      toast(`Imported: ${Object.entries(imported).filter(([,v])=>v>0).map(([k,v])=>`${v} ${k}`).join(', ') || 'no new records'}`, 'success');
      renderView(document.querySelector('.view.active')?.id.replace('view-','') || 'dashboard');
    } catch (err) {
      console.error('Import error:', err);
      toast('Import failed: ' + err.message, 'error');
    }
  };
  reader.readAsBinaryString(file);
};

// ===== Event Listeners =====
function initEventListeners() {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      App.showView(item.dataset.view);
    });
  });

  // Sidebar toggle
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', () => {
    const body = document.body;
    if (body.classList.contains('theme-dark')) {
      body.classList.replace('theme-dark', 'theme-light');
      document.getElementById('themeToggle').textContent = '🌙';
    } else {
      body.classList.replace('theme-light', 'theme-dark');
      document.getElementById('themeToggle').textContent = '☀';
    }
  });

  // Export
  document.getElementById('exportAllBtn').addEventListener('click', App.exportAll);

  // Import
  document.getElementById('importFile').addEventListener('change', e => {
    App.importExcel(e.target.files[0]);
    e.target.value = '';
  });

  // Search & filter live update
  document.getElementById('taskSearch').addEventListener('input', () => renderTasks());
  document.getElementById('taskFilterStatus').addEventListener('change', () => renderTasks());
  document.getElementById('taskFilterPriority').addEventListener('change', () => renderTasks());
  document.getElementById('taskFilterProject').addEventListener('change', () => renderTasks());

  document.getElementById('projectSearch').addEventListener('input', () => renderProjects());
  document.getElementById('reqMetaSearch').addEventListener('input', () => renderProjects());

  document.getElementById('issueSearch').addEventListener('input', () => renderIssues());
  document.getElementById('issueFilterStatus').addEventListener('change', () => renderIssues());
  document.getElementById('issueFilterType').addEventListener('change', () => renderIssues());
  document.getElementById('issueFilterProject').addEventListener('change', () => renderIssues());
  document.getElementById('issueFilterMetaKey').addEventListener('change', function () {
    const valInput = document.getElementById('issueFilterMetaValue');
    valInput.disabled = !this.value;
    if (!this.value) valInput.value = '';
    renderIssues();
  });
  document.getElementById('issueFilterMetaValue').addEventListener('input', () => renderIssues());

  document.getElementById('timelogDate').addEventListener('change', () => renderTimelog());
  document.getElementById('timelogFilterProject').addEventListener('change', () => renderTimelog());

  document.getElementById('standupDate').addEventListener('change', () => renderStandup());

  document.getElementById('noteSearch').addEventListener('input', () => renderNotes());

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') App.closeModal();
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const view = document.querySelector('.view.active')?.id.replace('view-', '');
      if (view === 'tasks') App.openTaskModal();
      else if (view === 'projects') App.openProjectModal();
      else if (view === 'issues') App.openIssueModal();
      else if (view === 'timelog') App.openTimeLogModal();
      else if (view === 'standup') App.openStandupModal();
      else if (view === 'notes') App.openNoteModal();
    }
  });
}

// ===== Init =====
function init() {
  load();
  initEventListeners();
  App.showView('dashboard');
  updateProjectDropdowns();

  // Seed sample data if empty
  if (DB.tasks.length === 0 && DB.projects.length === 0) {
    const projId = uid();
    DB.projects.push({
      id: projId, name: 'DevTracker', description: 'The developer tracker app itself',
      status: 'active', dueDate: '', repo: '', stack: 'HTML, CSS, JavaScript',
      requirements: [
        { id: uid(), title: 'Task management with Kanban', priority: 'high', status: 'done' },
        { id: uid(), title: 'Issue tracker', priority: 'high', status: 'done' },
        { id: uid(), title: 'Time logging', priority: 'medium', status: 'done' },
        { id: uid(), title: 'Excel export/import', priority: 'high', status: 'done' },
        { id: uid(), title: 'Standup notes', priority: 'medium', status: 'done' },
      ],
      createdAt: new Date().toISOString(),
    });
    DB.tasks.push(
      { id: uid(), title: 'Review pull requests', project: projId, priority: 'high', status: 'inprogress', dueDate: today(), tags: 'review', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: uid(), title: 'Write unit tests for auth module', project: projId, priority: 'medium', status: 'todo', dueDate: '', tags: 'testing', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: uid(), title: 'Fix navigation bug on mobile', project: projId, priority: 'high', status: 'todo', dueDate: today(), tags: 'bug,mobile', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: uid(), title: 'Set up CI/CD pipeline', project: projId, priority: 'low', status: 'done', dueDate: '', tags: 'devops', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    );
    DB.issues.push(
      { id: uid(), title: 'Login form throws 500 on empty password', project: projId, type: 'bug', priority: 'critical', status: 'open', assignee: '', tags: 'auth,backend', description: 'Submitting login form with empty password field causes a 500 error.', steps: '1. Go to /login\n2. Leave password empty\n3. Click Submit', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: uid(), title: 'Add dark mode support', project: projId, type: 'feature', priority: 'medium', status: 'open', assignee: '', tags: 'ui', description: 'Users have requested a dark mode toggle.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    );
    DB.timeLogs.push(
      { id: uid(), description: 'Implemented dashboard layout', project: projId, date: today(), hours: 2.5, category: 'development', notes: '', createdAt: new Date().toISOString() },
      { id: uid(), description: 'Team standup meeting', project: projId, date: today(), hours: 0.5, category: 'meeting', notes: '', createdAt: new Date().toISOString() },
    );
    DB.standups.push({
      id: uid(), date: today(), mood: 'good',
      yesterday: '- Set up project structure\n- Implemented task management\n- Fixed CSS issues',
      today: '- Work on issue tracker\n- Add Excel export/import\n- Write standup feature',
      blockers: 'None',
      goals: 'Complete MVP of DevTracker by end of week',
      createdAt: new Date().toISOString(),
    });
    logActivity('DevTracker initialized with sample data');
    save();
    App.showView('dashboard');
  }
}

document.addEventListener('DOMContentLoaded', init);
