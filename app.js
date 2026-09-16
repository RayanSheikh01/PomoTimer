const TODOIST_API = 'https://api.todoist.com/api/v1';

const el = {
  settingsToggle: document.getElementById('settingsToggle'),
  settingsPanel: document.getElementById('settingsPanel'),
  apiToken: document.getElementById('apiToken'),
  workMin: document.getElementById('workMin'),
  breakMin: document.getElementById('breakMin'),
  saveSettings: document.getElementById('saveSettings'),
  phaseLabel: document.getElementById('phaseLabel'),
  timeDisplay: document.getElementById('timeDisplay'),
  cycleCount: document.getElementById('cycleCount'),
  focusToday: document.getElementById('focusToday'),
  startBtn: document.getElementById('startBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  resetBtn: document.getElementById('resetBtn'),
  switchBtn: document.getElementById('switchBtn'),
  clock: document.querySelector('.clock'),
  progress: document.getElementById('progress'),
  refreshTasks: document.getElementById('refreshTasks'),
  eta: document.getElementById('eta'),
  listP1: document.getElementById('listP1'),
  listP2: document.getElementById('listP2'),
  listP34: document.getElementById('listP34'),
  totalP1: document.getElementById('totalP1'),
  totalP2: document.getElementById('totalP2'),
  totalP34: document.getElementById('totalP34'),
};

const settings = loadSettings();
el.apiToken.value = settings.token;
el.workMin.value = settings.workMin;
el.breakMin.value = settings.breakMin;

function loadSettings() {
  const raw = localStorage.getItem('pomo.settings');
  const defaults = { token: '', workMin: 25, breakMin: 5 };
  const s = raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  s.token = sanitizeToken(s.token);
  return s;
}

// Paste often drags in a "Bearer " prefix, quotes, or a stray newline; all break the auth header.
function sanitizeToken(raw) {
  return String(raw || '').replace(/^\s*(bearer\s+)?/i, '').replace(/[\s"']/g, '');
}

function saveSettings() {
  settings.token = sanitizeToken(el.apiToken.value);
  settings.workMin = Number(el.workMin.value) || 25;
  settings.breakMin = Number(el.breakMin.value) || 5;
  localStorage.setItem('pomo.settings', JSON.stringify(settings));
}

el.settingsToggle.addEventListener('click', () => el.settingsPanel.classList.toggle('hidden'));
el.saveSettings.addEventListener('click', () => {
  saveSettings();
  el.settingsPanel.classList.add('hidden');
  if (!timer.running) resetTimerDisplay();
  updateEta();
  fetchTasks();
});

// ---------- Timer ----------
const PHASES = { WORK: 'work', BREAK: 'break' };

const timer = {
  running: false,
  phase: PHASES.WORK,
  cycle: 1,
  secondsLeft: settings.workMin * 60,
  intervalId: null,
};

function phaseDurationSeconds(phase) {
  return (phase === PHASES.WORK ? settings.workMin : settings.breakMin) * 60;
}

function phaseLabelText(phase) {
  return phase === PHASES.WORK ? 'Work' : 'Break';
}

function updateDisplay() {
  const m = Math.floor(timer.secondsLeft / 60).toString().padStart(2, '0');
  const s = (timer.secondsLeft % 60).toString().padStart(2, '0');
  el.timeDisplay.textContent = `${m}:${s}`;
  el.phaseLabel.textContent = phaseLabelText(timer.phase);
  el.switchBtn.textContent = timer.phase === PHASES.WORK ? 'Skip to break' : 'Skip to work';
  el.cycleCount.textContent = `Cycle ${timer.cycle}`;
  // Includes the unbanked current work segment so the stat ticks live.
  const secs = focusSecondsToday() + (workStartedAt ? Math.round((Date.now() - workStartedAt) / 1000) : 0);
  el.focusToday.textContent = fmtDuration(Math.floor(secs / 60));
  const total = phaseDurationSeconds(timer.phase);
  el.progress.style.transform = `scaleX(${total ? timer.secondsLeft / total : 0})`;
}

function resetTimerDisplay() {
  timer.secondsLeft = phaseDurationSeconds(timer.phase);
  updateDisplay();
}

function tick() {
  timer.secondsLeft--;
  if (timer.secondsLeft <= 0) {
    advancePhase();
  }
  updateDisplay();
}

// Only work phases count, and the tally is stamped with the day so it starts fresh each morning.
const focus = JSON.parse(localStorage.getItem('pomo.focus') || '{}');
let workStartedAt = null;

function focusSecondsToday() {
  return focus.date === localDateString(new Date()) ? focus.seconds || 0 : 0;
}

function startWorkSegment() {
  if (timer.running && timer.phase === PHASES.WORK) workStartedAt = Date.now();
}

// Banked from the wall clock rather than a tick count, which drifts when the tab is backgrounded.
function bankWorkSegment() {
  if (!workStartedAt) return;
  const secs = Math.round((Date.now() - workStartedAt) / 1000);
  workStartedAt = null;
  if (secs <= 0) return;
  const base = focusSecondsToday();
  focus.date = localDateString(new Date());
  focus.seconds = base + secs;
  localStorage.setItem('pomo.focus', JSON.stringify(focus));
}

window.addEventListener('beforeunload', bankWorkSegment);

function advancePhase() {
  notifyPhaseEnd();
  switchPhase();
}

function switchPhase() {
  if (timer.phase === PHASES.WORK) {
    bankWorkSegment();
    timer.phase = PHASES.BREAK;
  } else {
    timer.cycle++;
    timer.phase = PHASES.WORK;
    startWorkSegment();
  }
  timer.secondsLeft = phaseDurationSeconds(timer.phase);
}

function notifyPhaseEnd() {
  beep();
  if (Notification.permission === 'granted') {
    new Notification('Pomo Timer', { body: `${phaseLabelText(timer.phase)} finished` });
  }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) { /* audio unsupported, ignore */ }
}

el.startBtn.addEventListener('click', () => {
  if (timer.running) return;
  if (Notification.permission === 'default') Notification.requestPermission();
  timer.running = true;
  el.clock.classList.add('running');
  el.startBtn.disabled = true;
  el.pauseBtn.disabled = false;
  startWorkSegment();
  updateDisplay();
  timer.intervalId = setInterval(tick, 1000);
});

el.pauseBtn.addEventListener('click', () => {
  timer.running = false;
  el.clock.classList.remove('running');
  clearInterval(timer.intervalId);
  bankWorkSegment();
  updateDisplay();
  el.startBtn.disabled = false;
  el.pauseBtn.disabled = true;
});

el.resetBtn.addEventListener('click', () => {
  timer.running = false;
  el.clock.classList.remove('running');
  clearInterval(timer.intervalId);
  bankWorkSegment();
  timer.phase = PHASES.WORK;
  timer.cycle = 1;
  resetTimerDisplay();
  el.startBtn.disabled = false;
  el.pauseBtn.disabled = true;
});

el.switchBtn.addEventListener('click', () => {
  switchPhase();
  updateDisplay();
});

updateDisplay();

// Document Picture-in-Picture keeps the clock on top of other windows. Chromium only; button stays hidden elsewhere.
const popOutBtn = document.getElementById('popOutBtn');
if ('documentPictureInPicture' in window) {
  popOutBtn.hidden = false;
  popOutBtn.addEventListener('click', async () => {
    if (documentPictureInPicture.window) return documentPictureInPicture.window.close();
    const pip = await documentPictureInPicture.requestWindow({ width: 380, height: 300 });
    document.querySelectorAll('link[rel="stylesheet"]').forEach((l) => pip.document.head.append(l.cloneNode()));
    pip.document.body.classList.add('pip');
    pip.document.body.append(el.clock);
    popOutBtn.textContent = 'Pop in';
    pip.addEventListener('pagehide', () => {
      el.settingsPanel.after(el.clock);
      popOutBtn.textContent = 'Pop out';
    });
  });
}

// ---------- Pomo estimates ----------
const pomoCounts = JSON.parse(localStorage.getItem('pomo.counts') || '{}');
let currentTasks = [];

function getPomos(id) {
  return pomoCounts[id] ?? 1;
}

function setPomos(id, n) {
  const clamped = Math.max(0, Math.min(99, Number(n) || 0));
  pomoCounts[id] = Math.round(clamped * 2) / 2; // snap to halves
  localStorage.setItem('pomo.counts', JSON.stringify(pomoCounts));
  updateEta();
}

// A run of N pomos is N work blocks with a break between each, so the trailing break is dropped.
function minutesFor(pomos) {
  if (!pomos) return 0;
  return Math.max(0, Math.round(pomos * (settings.workMin + settings.breakMin) - settings.breakMin));
}

function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function sumPomos(tasks) {
  return tasks.reduce((sum, t) => sum + getPomos(t.id), 0);
}

function readout(value, label, accent) {
  const wrap = document.createElement('div');
  wrap.className = accent ? 'readout accent' : 'readout';
  const v = document.createElement('div');
  v.className = 'readout-value';
  v.textContent = value;
  const l = document.createElement('div');
  l.className = 'readout-label';
  l.textContent = label;
  wrap.append(v, l);
  return wrap;
}

function updateEta() {
  for (const col of COLUMNS) {
    const tasks = currentTasks.filter((t) => col.priorities.includes(t.priority || 1));
    const pomos = sumPomos(tasks);
    const unit = pomos === 1 ? 'pomo' : 'pomos';
    el[col.total].textContent = tasks.length ? `${pomos} ${unit}, ${fmtDuration(minutesFor(pomos))}` : '';
  }

  el.eta.innerHTML = '';
  if (!currentTasks.length) return;

  const pomos = sumPomos(currentTasks);
  const mins = minutesFor(pomos);
  const finish = new Date(Date.now() + mins * 60000);
  const clock = `${String(finish.getHours()).padStart(2, '0')}:${String(finish.getMinutes()).padStart(2, '0')}`;
  el.eta.append(
    readout(currentTasks.length, currentTasks.length === 1 ? 'task' : 'tasks'),
    readout(pomos, pomos === 1 ? 'pomo' : 'pomos'),
    readout(fmtDuration(mins), 'focus time'),
    readout(clock, 'if you start now', true),
  );
}

// ---------- Todoist ----------

function setAllLists(html) {
  for (const col of COLUMNS) el[col.list].innerHTML = html;
}

async function fetchTasks() {
  if (!settings.token) {
    setAllLists('<li class="empty-state">Add your Todoist token in settings to load tasks.</li>');
    return;
  }
  setAllLists('<li class="empty-state">Loading…</li>');
  try {
    const all = [];
    let cursor = null;
    do {
      const url = `${TODOIST_API}/tasks?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${settings.token}` } });
      if (!res.ok) throw new Error(`Todoist error ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      all.push(...(Array.isArray(data) ? data : data.results));
      cursor = Array.isArray(data) ? null : data.next_cursor;
    } while (cursor);

    const today = localDateString(new Date());
    const due = all
      .filter((t) => t.due && t.due.date.slice(0, 10) <= today)
      .sort((a, b) => dueSortKey(a.due) - dueSortKey(b.due));
    renderTasks(due);
  } catch (err) {
    setAllLists(`<li class="error-state">Could not load tasks. ${escapeHtml(err.message)}</li>`);
  }
}

// Todoist priority is inverted: 4 = p1 (highest) ... 1 = p4 (none).
const COLUMNS = [
  { list: 'listP1', total: 'totalP1', priorities: [4] },
  { list: 'listP2', total: 'totalP2', priorities: [3] },
  { list: 'listP34', total: 'totalP34', priorities: [2, 1] },
];

function renderTasks(tasks) {
  currentTasks = tasks;
  // Drop stored counts for tasks that are gone, so the store can't grow without bound.
  const live = new Set(tasks.map((t) => t.id));
  for (const id of Object.keys(pomoCounts)) if (!live.has(id)) delete pomoCounts[id];
  localStorage.setItem('pomo.counts', JSON.stringify(pomoCounts));
  updateEta();

  const today = localDateString(new Date());
  for (const col of COLUMNS) {
    const ul = el[col.list];
    ul.innerHTML = '';
    let count = 0;
    for (const p of col.priorities) {
      const group = tasks.filter((t) => (t.priority || 1) === p);
      if (!group.length) continue;
      if (col.priorities.length > 1) {
        const header = document.createElement('li');
        header.className = `group-header p${5 - p}`;
        header.textContent = `P${5 - p}`;
        ul.appendChild(header);
      }
      for (const task of group) ul.appendChild(taskItem(task, today));
      count += group.length;
    }
    if (!count) ul.innerHTML = '<li class="empty-state">Nothing at this priority.</li>';
  }
}

function taskItem(task, today) {
  const li = document.createElement('li');
  li.className = 'task-item';
  li.dataset.id = task.id;

  const content = document.createElement('div');
  content.className = 'task-content';
  content.textContent = task.content;

  const due = document.createElement('div');
  const dueDate = task.due ? task.due.date.slice(0, 10) : null;
  const overdue = dueDate && dueDate < today;
  due.className = 'task-due' + (overdue ? ' overdue' : '');
  due.textContent = dueDate ? (overdue ? `Overdue ${shortDate(dueDate)}` : 'Today') : '';
  const time = task.due && dueTime(task.due);
  if (time) due.textContent += ` · ${time}`;
  content.appendChild(due);

  const pomos = document.createElement('input');
  pomos.type = 'number';
  pomos.className = 'task-pomos';
  pomos.min = '0';
  pomos.max = '99';
  pomos.step = '0.5';
  pomos.title = 'Pomodoros to complete';
  pomos.value = getPomos(task.id);
  pomos.addEventListener('click', (e) => e.stopPropagation());
  pomos.addEventListener('change', () => {
    setPomos(task.id, Number(pomos.value));
    pomos.value = getPomos(task.id);
  });

  const doneBtn = document.createElement('button');
  doneBtn.className = 'task-done';
  doneBtn.title = 'Mark done';
  doneBtn.textContent = '✓';
  doneBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    completeTask(task.id, li);
  });

  li.appendChild(content);
  li.appendChild(pomos);
  li.appendChild(doneBtn);
  return li;
}

async function completeTask(id, li) {
  try {
    const res = await fetch(`${TODOIST_API}/tasks/${id}/close`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}` },
    });
    if (!res.ok) throw new Error(`Todoist error ${res.status}`);
    const ul = li.parentElement;
    li.remove();
    currentTasks = currentTasks.filter((t) => t.id !== id);
    delete pomoCounts[id];
    localStorage.setItem('pomo.counts', JSON.stringify(pomoCounts));
    updateEta();
    ul.querySelectorAll('.group-header').forEach((h) => {
      if (!h.nextElementSibling || h.nextElementSibling.classList.contains('group-header')) h.remove();
    });
    if (!ul.children.length) ul.innerHTML = '<li class="empty-state">Nothing at this priority.</li>';
  } catch (err) {
    alert(`Failed to complete task: ${err.message}`);
  }
}

// Built from parts, not Date parsing: "2026-09-01" parses as UTC and can slip a day westward.
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Timed dues carry "THH:MM:SS" in date (API v1) or datetime (older shape). "Z" = UTC; no suffix = floating local time.
function dueTime(due) {
  const dt = due.datetime || (due.date.length > 10 ? due.date : null);
  return dt ? new Date(dt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
}

// Timed tasks sort by their moment; untimed ones go at the end of their day.
function dueSortKey(due) {
  const dt = due.datetime || (due.date.length > 10 ? due.date : null);
  if (dt) return new Date(dt).getTime();
  const [y, m, d] = due.date.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime() - 1;
}

function localDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

el.refreshTasks.addEventListener('click', fetchTasks);

// ---------- Add task ----------

const addDialog = document.getElementById('addTaskDialog');
const addForm = document.getElementById('addTaskForm');

document.getElementById('addTaskBtn').addEventListener('click', () => {
  if (!settings.token) return el.settingsPanel.classList.remove('hidden');
  addForm.reset();
  document.getElementById('newTaskDate').value = localDateString(new Date());
  addDialog.showModal();
});
document.getElementById('cancelAddTask').addEventListener('click', () => addDialog.close());

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    content: document.getElementById('newTaskContent').value.trim(),
    priority: Number(document.getElementById('newTaskPriority').value),
  };
  const date = document.getElementById('newTaskDate').value;
  const time = document.getElementById('newTaskTime').value;
  if (time) {
    // Built from parts so the date is read as local, not UTC.
    const [y, mo, d] = date.split('-').map(Number);
    const [h, m] = time.split(':').map(Number);
    body.due_datetime = new Date(y, mo - 1, d, h, m).toISOString();
  } else {
    body.due_date = date;
  }
  try {
    const res = await fetch(`${TODOIST_API}/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Todoist error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    addDialog.close();
    fetchTasks();
  } catch (err) {
    alert(`Failed to add task: ${err.message}`);
  }
});

if (!settings.token) el.settingsPanel.classList.remove('hidden');
fetchTasks();
