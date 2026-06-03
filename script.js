/* ═══════════════════════════════════════════
   Senior Labelers Tracker — Frontend Logic
   ═══════════════════════════════════════════ */

// ── Configuration ─────────────────────────
const CONFIG = {
  // ⚠️ REPLACE with your actual Apps Script Web App URL after deployment
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbywm07hSM381bmMQcHjVZtSpkooN5tiMIHBcOqmoJ6yyLyqRLgPlZQTr_EdPA3WHEQDYg/exec',
  APP_NAME:   'Senior Labelers Tracker',
  VERSION:    '1.0.0',
  CACHE_TTL:  60 * 1000,          // 1 minute client cache
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION: 30 * 1000,    // 30 seconds
};

// ── Application State ─────────────────────
const STATE = {
  user: null,           // { fullName, loginName }
  dates: [],            // available date strings for user
  currentDate: '',      // selected YYYY-MM-DD
  allTasks: [],         // raw tasks from server for selected date
  filteredTasks: [],    // after client-side filter
  sortConfig: { key: 'timestamp', dir: 'desc' },
  loginAttempts: 0,
  lockoutUntil: 0,
};

// ── Cached DOM References ─────────────────
const DOM = {};
function cacheDom() {
  const ids = [
    'loginScreen','dashboardScreen','loginForm','loginName','loginPass',
    'loginError','loginBtn','logoutBtn','userGreeting','datePicker',
    'cardTotal','cardSupport','cardOwn','cardObjects',
    'supportBody','ownBody','taskTableBody','taskCountBadge',
    'tableEmpty','filterModality','filterPass','filterMode',
    'loadingOverlay','toastContainer','lastSync',
  ];
  ids.forEach(id => DOM[id] = document.getElementById(id));
  DOM.tableWrapper = document.querySelector('.table-wrapper');
}

// ── Utilities ─────────────────────────────

/** Fetch from Apps Script Web App */
async function fetchAPI(params) {
  const url = new URL(CONFIG.SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error('Invalid server response'); }
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  }
}

/** Toast notification */
function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 4000;
  const icons = { error: 'error', success: 'check_circle', warning: 'warning', info: 'info' };
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.innerHTML = '<span class="material-symbols-outlined">' + icons[type] + '</span><span>' + message + '</span>';
  DOM.toastContainer.appendChild(el);
  setTimeout(function() {
    el.classList.add('toast-out');
    el.addEventListener('animationend', function() { el.remove(); });
  }, duration);
}

function setLoading(show) { DOM.loadingOverlay.hidden = !show; }

/** Count-up animation */
function animateCount(el, target, dur) {
  dur = dur || 800;
  var start = performance.now();
  function tick(now) {
    var p = Math.min((now - start) / dur, 1);
    var eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString();
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/** Extract HH:MM AM/PM from full timestamp */
function formatTime(ts) {
  if (!ts) return '—';
  var m = ts.match(/(\d{1,2}:\d{2}):\d{2}\s*(AM|PM)/i);
  return m ? (m[1] + ' ' + m[2]) : ts;
}

function debounce(fn, ms) {
  var t; return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}

function escapeHtml(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Authentication ────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  var now = Date.now();

  // Lockout check
  if (STATE.lockoutUntil > now) {
    var sec = Math.ceil((STATE.lockoutUntil - now) / 1000);
    DOM.loginError.textContent = 'Too many attempts. Try again in ' + sec + 's.';
    return;
  }

  var name = DOM.loginName.value.trim();
  var pass = DOM.loginPass.value;
  if (!name || !pass) { DOM.loginError.textContent = 'Please enter both name and password.'; return; }

  // Loading state
  DOM.loginBtn.disabled = true;
  DOM.loginBtn.querySelector('.btn-text').hidden = true;
  DOM.loginBtn.querySelector('.btn-loader').hidden = false;
  DOM.loginError.textContent = '';

  try {
    var res = await fetchAPI({ action: 'auth', name: name, pass: pass });
    if (res.success) {
      STATE.user = { fullName: res.fullName, loginName: name };
      sessionStorage.setItem('slt_user', JSON.stringify(STATE.user));
      showToast('Welcome, ' + res.fullName, 'success');
      showDashboard();
    } else {
      STATE.loginAttempts++;
      DOM.loginError.textContent = res.message || 'Invalid credentials.';
      if (STATE.loginAttempts >= CONFIG.MAX_LOGIN_ATTEMPTS) {
        STATE.lockoutUntil = Date.now() + CONFIG.LOCKOUT_DURATION;
        STATE.loginAttempts = 0;
        showToast('Locked for 30 seconds — too many failed attempts.', 'warning');
      }
    }
  } catch (err) {
    DOM.loginError.textContent = 'Connection error. Please check your network.';
    showToast('Failed to connect to server', 'error');
  } finally {
    DOM.loginBtn.disabled = false;
    DOM.loginBtn.querySelector('.btn-text').hidden = false;
    DOM.loginBtn.querySelector('.btn-loader').hidden = true;
  }
}

function handleLogout() {
  STATE.user = null;
  STATE.dates = [];
  STATE.allTasks = [];
  STATE.filteredTasks = [];
  sessionStorage.removeItem('slt_user');
  // Clear data cache
  Object.keys(sessionStorage).forEach(function(k) {
    if (k.indexOf('slt_data_') === 0) sessionStorage.removeItem(k);
  });
  DOM.loginName.value = '';
  DOM.loginPass.value = '';
  DOM.loginError.textContent = '';
  DOM.dashboardScreen.classList.remove('active');
  DOM.loginScreen.classList.add('active');
}

function checkSession() {
  try {
    var stored = sessionStorage.getItem('slt_user');
    if (stored) { STATE.user = JSON.parse(stored); showDashboard(); }
  } catch (e) { sessionStorage.removeItem('slt_user'); }
}

// ── Dashboard ─────────────────────────────

async function showDashboard() {
  DOM.loginScreen.classList.remove('active');
  DOM.dashboardScreen.classList.add('active');
  DOM.userGreeting.innerHTML = 'Signed in as <strong>' + escapeHtml(STATE.user.fullName) + '</strong>';
  STATE.loginAttempts = 0;
  STATE.lockoutUntil = 0;
  await loadAvailableDates();
}

async function loadAvailableDates() {
  try {
    var res = await fetchAPI({ action: 'availableDates', name: STATE.user.loginName });
    if (res.dates && res.dates.length > 0) {
      STATE.dates = res.dates;
      populateDatePicker();
      STATE.currentDate = STATE.dates[0];
      DOM.datePicker.value = STATE.currentDate;
      await loadDayData(STATE.currentDate);
    } else {
      STATE.dates = [];
      DOM.datePicker.innerHTML = '<option value="">No data available</option>';
      renderEmptyDashboard();
      showToast('No task data found for your account.', 'info');
    }
  } catch (err) {
    showToast('Failed to load available dates', 'error');
  }
}

function populateDatePicker() {
  DOM.datePicker.innerHTML = '';
  STATE.dates.forEach(function(date) {
    var opt = document.createElement('option');
    opt.value = date;
    try {
      var d = new Date(date + 'T00:00:00');
      opt.textContent = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
    } catch (e) { opt.textContent = date; }
    DOM.datePicker.appendChild(opt);
  });
}

async function loadDayData(date) {
  // Session cache check
  var ck = 'slt_data_' + date;
  var ct = 'slt_data_' + date + '_t';
  var cached = sessionStorage.getItem(ck);
  var cacheTime = sessionStorage.getItem(ct);
  if (cached && cacheTime && (Date.now() - parseInt(cacheTime)) < CONFIG.CACHE_TTL) {
    try { STATE.allTasks = JSON.parse(cached); renderDashboard(); return; }
    catch (e) { /* ignore */ }
  }

  setLoading(true);
  try {
    var res = await fetchAPI({ action: 'userData', name: STATE.user.loginName, date: date });
    if (res.error) {
      showToast(res.error, 'error');
      STATE.allTasks = [];
    } else {
      var support = res.supportTasks || [];
      var own = res.ownTasks || [];
      STATE.allTasks = support.concat(own);
      sessionStorage.setItem(ck, JSON.stringify(STATE.allTasks));
      sessionStorage.setItem(ct, String(Date.now()));
    }
    renderDashboard();
  } catch (err) {
    showToast('Failed to load task data', 'error');
    STATE.allTasks = [];
    renderEmptyDashboard();
  } finally { setLoading(false); }
}

function renderDashboard() {
  var tasks = STATE.allTasks;
  var supportTasks = tasks.filter(function(t) { return t.mode === 'SUPPORT'; });
  var ownTasks = tasks.filter(function(t) { return t.mode === 'OWN'; });
  var totalObj = tasks.reduce(function(s, t) { return s + (parseInt(t.objects) || 0); }, 0);

  animateCount(DOM.cardTotal, tasks.length);
  animateCount(DOM.cardSupport, supportTasks.length);
  animateCount(DOM.cardOwn, ownTasks.length);
  animateCount(DOM.cardObjects, totalObj);

  renderSupportPanel(supportTasks);
  renderOwnPanel(ownTasks, totalObj);

  STATE.filteredTasks = tasks.slice();
  applyFiltersAndRender();
  DOM.lastSync.textContent = 'Last sync: ' + new Date().toLocaleTimeString();
}

function renderEmptyDashboard() {
  animateCount(DOM.cardTotal, 0);
  animateCount(DOM.cardSupport, 0);
  animateCount(DOM.cardOwn, 0);
  animateCount(DOM.cardObjects, 0);
  DOM.supportBody.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">handshake</span><p>No support tasks for this date</p></div>';
  DOM.ownBody.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">person</span><p>No own tasks for this date</p></div>';
  DOM.taskTableBody.innerHTML = '';
  DOM.taskCountBadge.textContent = '0';
  DOM.tableEmpty.hidden = false;
}

// ── Support Panel ─────────────────────────

function renderSupportPanel(supportTasks) {
  if (!supportTasks.length) {
    DOM.supportBody.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">handshake</span><p>No support tasks for this date</p></div>';
    return;
  }

  // Group by teamCode
  var teams = {};
  supportTasks.forEach(function(t) {
    var key = t.teamCode || t.teamLead || 'Unknown';
    if (!teams[key]) teams[key] = { teamLead: t.teamLead || 'Unknown', teamCode: t.teamCode || '—', unit: t.teamUnit || '—', shift: t.teamShift || '—', tasks: [] };
    teams[key].tasks.push(t);
  });

  var html = '';
  Object.values(teams).forEach(function(team) {
    var bd = getBreakdown(team.tasks);
    var queues = getQueueList(team.tasks);
    var total = team.tasks.length;
    var fpTotal = bd.laneLine.fp + bd.lidar.fp;
    var qaTotal = bd.laneLine.qa + bd.lidar.qa;
    var fpPct = total > 0 ? (fpTotal / total * 100) : 0;
    var qaPct = total > 0 ? (qaTotal / total * 100) : 0;

    html += '<div class="team-card">'
      + '<div class="team-card-header"><span class="team-card-name">' + escapeHtml(team.teamLead) + '</span><span class="chip chip-support">Support</span></div>'
      + '<div class="team-card-meta">'
      + '<span><span class="material-symbols-outlined">group</span>' + escapeHtml(team.teamCode) + '</span>'
      + '<span><span class="material-symbols-outlined">location_on</span>' + escapeHtml(team.unit) + '</span>'
      + '<span><span class="material-symbols-outlined">schedule</span>Shift ' + escapeHtml(team.shift) + '</span>'
      + '</div>'
      + '<div class="breakdown-grid">'
      + '<span class="breakdown-label">Lane Line</span><span class="breakdown-fp">FP: ' + bd.laneLine.fp + '</span><span class="breakdown-qa">QA: ' + bd.laneLine.qa + '</span>'
      + '<span class="breakdown-label">LIDAR</span><span class="breakdown-fp">FP: ' + bd.lidar.fp + '</span><span class="breakdown-qa">QA: ' + bd.lidar.qa + '</span>'
      + '</div>'
      + '<div class="mini-bar-wrap"><div class="mini-bar-label">FP ' + Math.round(fpPct) + '% — QA ' + Math.round(qaPct) + '%</div>'
      + '<div class="mini-bar"><div class="mini-bar-fp" style="width:' + fpPct + '%"></div><div class="mini-bar-qa" style="width:' + qaPct + '%"></div></div></div>'
      + buildQueueHtml(queues)
      + '<div class="team-total"><span>Total Tasks</span><span style="color:var(--color-support)">' + total + '</span></div>'
      + '</div>';
  });
  DOM.supportBody.innerHTML = html;
}

// ── Own Panel ─────────────────────────────

function renderOwnPanel(ownTasks, totalObjects) {
  if (!ownTasks.length) {
    DOM.ownBody.innerHTML = '<div class="empty-state"><span class="material-symbols-outlined">person</span><p>No own tasks for this date</p></div>';
    return;
  }

  var bd = getBreakdown(ownTasks);
  var queues = getQueueList(ownTasks);
  var total = ownTasks.length;
  var fpTotal = bd.laneLine.fp + bd.lidar.fp;
  var qaTotal = bd.laneLine.qa + bd.lidar.qa;
  var fpPct = total > 0 ? (fpTotal / total * 100) : 0;
  var qaPct = total > 0 ? (qaTotal / total * 100) : 0;
  var ownObj = ownTasks.reduce(function(s, t) { return s + (parseInt(t.objects) || 0); }, 0);

  var html = '<div class="team-card" style="margin-bottom:16px">'
    + '<div class="team-card-header"><span class="team-card-name">' + escapeHtml(STATE.user.fullName) + '</span><span class="chip chip-own">Own</span></div>'
    + '<div class="breakdown-grid" style="margin-bottom:12px">'
    + '<span class="breakdown-label">Lane Line</span><span class="breakdown-fp">FP: ' + bd.laneLine.fp + '</span><span class="breakdown-qa">QA: ' + bd.laneLine.qa + '</span>'
    + '<span class="breakdown-label">LIDAR</span><span class="breakdown-fp">FP: ' + bd.lidar.fp + '</span><span class="breakdown-qa">QA: ' + bd.lidar.qa + '</span>'
    + '</div>'
    + '<div class="mini-bar-wrap"><div class="mini-bar-label">FP ' + Math.round(fpPct) + '% — QA ' + Math.round(qaPct) + '%</div>'
    + '<div class="mini-bar"><div class="mini-bar-fp" style="width:' + fpPct + '%"></div><div class="mini-bar-qa" style="width:' + qaPct + '%"></div></div></div>'
    + buildQueueHtml(queues)
    + '<div class="team-total"><span>Total Tasks</span><span style="color:var(--md-sys-color-secondary)">' + total + '</span></div>'
    + '</div>'
    + '<div class="own-stat-row"><span style="color:var(--md-sys-color-on-surface-low)">Objects Annotated</span><span class="own-stat-value" style="color:var(--color-objects)">' + ownObj.toLocaleString() + '</span></div>';

  DOM.ownBody.innerHTML = html;
}

// ── Helpers: Breakdown & Queues ───────────

function getBreakdown(tasks) {
  var bd = { laneLine: { fp: 0, qa: 0 }, lidar: { fp: 0, qa: 0 } };
  tasks.forEach(function(t) {
    var mod = (t.modality || '').toLowerCase();
    var pass = (t.pass || '').toUpperCase();
    if (mod.indexOf('lane') !== -1) { if (pass === 'FP') bd.laneLine.fp++; else if (pass === 'QA') bd.laneLine.qa++; }
    else if (mod.indexOf('lidar') !== -1) { if (pass === 'FP') bd.lidar.fp++; else if (pass === 'QA') bd.lidar.qa++; }
  });
  return bd;
}

function getQueueList(tasks) {
  var map = {};
  tasks.forEach(function(t) { var q = t.queueName || 'Unknown'; map[q] = (map[q] || 0) + 1; });
  return Object.entries(map).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return { name: e[0], count: e[1] }; });
}

function buildQueueHtml(queues) {
  if (!queues.length) return '';
  var maxShow = 3;
  var needToggle = queues.length > maxShow;
  var html = '<div class="queue-list">';
  if (needToggle) {
    html += '<button class="queue-toggle" onclick="this.classList.toggle(\'expanded\');this.nextElementSibling.classList.toggle(\'show\')">'
      + '<span class="material-symbols-outlined">expand_more</span>' + queues.length + ' queues</button><div class="queue-items">';
  }
  queues.forEach(function(q) {
    html += '<div class="queue-item"><span class="queue-item-count">' + q.count + '</span>' + escapeHtml(q.name) + '</div>';
  });
  if (needToggle) html += '</div>';
  html += '</div>';
  return html;
}

// ── Table: Filter, Sort, Render ───────────

function applyFiltersAndRender() {
  var mf = DOM.filterModality.value;
  var pf = DOM.filterPass.value;
  var modf = DOM.filterMode.value;

  STATE.filteredTasks = STATE.allTasks.filter(function(t) {
    if (mf !== 'all' && t.modality !== mf) return false;
    if (pf !== 'all' && t.pass !== pf) return false;
    if (modf !== 'all' && t.mode !== modf) return false;
    return true;
  });

  sortTasks();
  renderTable();
}

function sortTasks() {
  var key = STATE.sortConfig.key;
  var dir = STATE.sortConfig.dir;
  STATE.filteredTasks.sort(function(a, b) {
    var va, vb;
    if (key === 'objects') {
      va = parseInt(a.objects) || 0;
      vb = parseInt(b.objects) || 0;
      return dir === 'asc' ? va - vb : vb - va;
    }
    va = a[key] || '';
    vb = b[key] || '';
    var c = va.localeCompare(vb);
    return dir === 'asc' ? c : -c;
  });
}

function renderTable() {
  var tasks = STATE.filteredTasks;
  DOM.taskCountBadge.textContent = tasks.length;

  if (!tasks.length) {
    DOM.taskTableBody.innerHTML = '';
    DOM.tableEmpty.hidden = false;
    return;
  }
  DOM.tableEmpty.hidden = true;

  var frag = document.createDocumentFragment();
  tasks.forEach(function(t, i) {
    var tr = document.createElement('tr');
    var modChip = t.modality === 'Lane Line' ? 'chip-lane' : t.modality === 'LIDAR' ? 'chip-lidar' : '';
    var passChip = t.pass === 'FP' ? 'chip-fp' : t.pass === 'QA' ? 'chip-qa' : '';
    var modeChip = t.mode === 'SUPPORT' ? 'chip-support' : 'chip-own';
    var link = t.taskLink ? '<a href="' + escapeHtml(t.taskLink) + '" target="_blank" rel="noopener" class="task-link" aria-label="Open task"><span class="material-symbols-outlined">open_in_new</span></a>' : '—';

    tr.innerHTML = '<td style="color:var(--md-sys-color-on-surface-lower);font-family:Roboto Mono,monospace;font-size:0.75rem">' + (i + 1) + '</td>'
      + '<td style="font-family:Roboto Mono,monospace;font-size:0.8125rem">' + escapeHtml(formatTime(t.timestamp)) + '</td>'
      + '<td><span class="chip ' + modeChip + '">' + escapeHtml(t.mode || '—') + '</span></td>'
      + '<td><span class="chip ' + modChip + '">' + escapeHtml(t.modality || '—') + '</span></td>'
      + '<td><span class="queue-text" title="' + escapeHtml(t.queueName || '') + '">' + escapeHtml(t.queueName || '—') + '</span></td>'
      + '<td><span class="chip ' + passChip + '">' + escapeHtml(t.pass || '—') + '</span></td>'
      + '<td style="font-family:Roboto Mono,monospace;font-weight:500;text-align:right">' + (parseInt(t.objects) || 0) + '</td>'
      + '<td style="text-align:center">' + link + '</td>';
    frag.appendChild(tr);
  });

  requestAnimationFrame(function() {
    DOM.taskTableBody.innerHTML = '';
    DOM.taskTableBody.appendChild(frag);
  });
}

function handleSort(th) {
  var key = th.dataset.sort;
  if (!key) return;
  if (STATE.sortConfig.key === key) {
    STATE.sortConfig.dir = STATE.sortConfig.dir === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortConfig.key = key;
    STATE.sortConfig.dir = 'asc';
  }
  // Update visual arrows
  document.querySelectorAll('.sort-arrow').forEach(function(a) { a.className = 'sort-arrow'; });
  var arrow = th.querySelector('.sort-arrow');
  if (arrow) arrow.classList.add(STATE.sortConfig.dir);
  sortTasks();
  renderTable();
}

// ── Event Binding ─────────────────────────

function initEvents() {
  DOM.loginForm.addEventListener('submit', handleLogin);

  // Toggle password
  document.querySelector('.toggle-pass').addEventListener('click', function() {
    var inp = DOM.loginPass;
    var ico = this.querySelector('.material-symbols-outlined');
    if (inp.type === 'password') { inp.type = 'text'; ico.textContent = 'visibility'; }
    else { inp.type = 'password'; ico.textContent = 'visibility_off'; }
  });

  DOM.logoutBtn.addEventListener('click', handleLogout);

  // Date change → clear cache & reload
  DOM.datePicker.addEventListener('change', function() {
    STATE.currentDate = this.value;
    if (this.value) {
      sessionStorage.removeItem('slt_data_' + this.value);
      sessionStorage.removeItem('slt_data_' + this.value + '_t');
      loadDayData(this.value);
    }
  });

  // Filters (debounced)
  var debouncedFilter = debounce(applyFiltersAndRender, 250);
  DOM.filterModality.addEventListener('change', debouncedFilter);
  DOM.filterPass.addEventListener('change', debouncedFilter);
  DOM.filterMode.addEventListener('change', debouncedFilter);

  // Sortable headers
  document.querySelectorAll('.sortable').forEach(function(th) {
    th.addEventListener('click', function() { handleSort(th); });
  });

  // Enter on name → focus password
  DOM.loginName.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); DOM.loginPass.focus(); }
  });
}

// ── Init ──────────────────────────────────

function init() {
  cacheDom();

  // Warn if SCRIPT_URL not configured
  if (CONFIG.SCRIPT_URL.indexOf('YOUR_DEPLOYMENT_ID') !== -1) {
    DOM.loginError.textContent = 'Setup required: Configure SCRIPT_URL in script.js';
    DOM.loginBtn.disabled = true;
    console.warn(
      '%c[Senior Labelers Tracker] CONFIG.SCRIPT_URL is not configured.\nOpen script.js and replace YOUR_DEPLOYMENT_ID with your Apps Script deployment ID.',
      'color: #FFB74D; font-size: 14px;'
    );
  }

  initEvents();
  checkSession();
}

document.addEventListener('DOMContentLoaded', init);
