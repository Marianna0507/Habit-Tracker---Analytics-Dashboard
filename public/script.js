const TOKEN_KEY = 'habit_tracker_token';

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const logoutBtn = document.getElementById('logout-btn');
const authError = document.getElementById('auth-error');
const habitsError = document.getElementById('habits-error');
const habitsList = document.getElementById('habits-list');
const calendarError = document.getElementById('calendar-error');
const calendarTable = document.getElementById('calendar-table');
const calendarTitle = document.getElementById('calendar-title');

// Chart.js instances keyed by habit id, so we can destroy the old one
// before drawing a new one on the same <canvas> (Chart.js throws otherwise).
const charts = {};

// Which month the calendar is currently showing - starts on the real
// current month, moved by the prev/next buttons.
const today0 = new Date();
let calendarYear = today0.getFullYear();
let calendarMonth = today0.getMonth() + 1;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Wraps fetch(): attaches the auth header, and if the API says the token
// is invalid/expired, drops back to the login screen instead of failing silently.
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    showAuthView();
    throw new Error('Session expired, please log in again');
  }
  return res;
}

function showAuthView() {
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
  logoutBtn.classList.add('hidden');
}

function showAppView() {
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  loadHabits();
  loadCalendar();
}

function renderHabits(habits) {
  habitsList.innerHTML = '';
  if (habits.length === 0) {
    habitsList.innerHTML = '<li class="empty">No habits yet — add one above.</li>';
    return;
  }
  for (const habit of habits) {
    const li = document.createElement('li');
    li.className = 'habit';

    const row = document.createElement('div');
    row.className = 'habit-row';

    const info = document.createElement('span');
    info.textContent = `${habit.name} `;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = habit.frequency;
    info.appendChild(badge);

    const checkinBtn = document.createElement('button');
    if (habit.checked_in_today) {
      checkinBtn.textContent = 'Checked in ✓';
      checkinBtn.disabled = true;
    } else {
      checkinBtn.textContent = 'Check in';
      checkinBtn.addEventListener('click', () => checkin(habit.id, checkinBtn));
    }

    const statsPanel = document.createElement('div');
    statsPanel.className = 'stats-panel hidden';

    const statsBtn = document.createElement('button');
    statsBtn.textContent = 'Stats';
    statsBtn.className = 'stats-btn';
    statsBtn.addEventListener('click', () => toggleStats(habit, statsPanel, statsBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'delete-btn';
    deleteBtn.addEventListener('click', () => deleteHabit(habit));

    row.appendChild(info);
    row.appendChild(statsBtn);
    row.appendChild(checkinBtn);
    row.appendChild(deleteBtn);
    li.appendChild(row);
    li.appendChild(statsPanel);
    habitsList.appendChild(li);
  }
}

async function toggleStats(habit, panel, button) {
  const isHidden = panel.classList.contains('hidden');
  if (!isHidden) {
    panel.classList.add('hidden');
    button.textContent = 'Stats';
    return;
  }

  panel.classList.remove('hidden');
  button.textContent = 'Hide stats';
  panel.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const res = await apiFetch(`/habits/${habit.id}/stats`);
    if (!res.ok) throw new Error('Could not load stats');
    const stats = await res.json();
    renderStatsPanel(panel, habit, stats);
  } catch (err) {
    panel.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// A history entry's week_start is the Monday of that week's bucket, not
// "today" — labeled as a range (e.g. "Aug 3-9") so a single data point
// doesn't look like a mismatched/wrong date next to today's check-in.
function formatWeekLabel(weekStartStr) {
  const start = new Date(`${weekStartStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)}-${fmt(end)}`;
}

function renderStatsPanel(panel, habit, stats) {
  panel.innerHTML = '';

  const summary = document.createElement('p');
  summary.className = 'stats-summary';
  summary.textContent =
    `Current streak: ${stats.current_streak} day${stats.current_streak === 1 ? '' : 's'} · ` +
    `Completion rate: ${Math.round(stats.completion_rate * 100)}%`;
  panel.appendChild(summary);

  const canvas = document.createElement('canvas');
  canvas.className = 'stats-chart';
  panel.appendChild(canvas);

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export CSV';
  exportBtn.addEventListener('click', () => exportCsv(habit));
  panel.appendChild(exportBtn);

  if (charts[habit.id]) {
    charts[habit.id].destroy();
  }
  charts[habit.id] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: stats.history.map((h) => formatWeekLabel(h.week_start)),
      datasets: [{
        label: 'Completion rate',
        data: stats.history.map((h) => Math.round(h.completion_rate * 100)),
        borderColor: '#333',
        backgroundColor: 'rgba(51, 51, 51, 0.1)',
        tension: 0.2,
        fill: true,
      }],
    },
    options: {
      scales: {
        y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function safeFilename(name, fallback) {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return cleaned || fallback;
}

async function exportCsv(habit) {
  try {
    const res = await apiFetch(`/habits/${habit.id}/export`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeFilename(habit.name, `habit-${habit.id}`)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
}

async function deleteHabit(habit) {
  if (!confirm(`Delete "${habit.name}"? This also deletes all its check-ins.`)) {
    return;
  }
  try {
    const res = await apiFetch(`/habits/${habit.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Could not delete habit');
    if (charts[habit.id]) {
      charts[habit.id].destroy();
      delete charts[habit.id];
    }
    loadHabits();
    loadCalendar();
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
}

async function loadHabits() {
  habitsError.classList.add('hidden');
  try {
    const res = await apiFetch('/habits');
    const habits = await res.json();
    renderHabits(habits);
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
}

async function checkin(habitId, button) {
  try {
    const res = await apiFetch(`/habits/${habitId}/checkin`, { method: 'POST', body: JSON.stringify({}) });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      button.textContent = body.error || 'Already checked in';
      button.disabled = true;
      loadCalendar();
      return;
    }
    if (!res.ok) throw new Error('Check-in failed');
    button.textContent = 'Checked in ✓';
    button.disabled = true;
    loadCalendar();
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

// Key identifying the Mon-Sun ISO week a given day falls into (that week's
// Monday, as YYYY-MM-DD) - computed in UTC to match the backend's
// isoWeekBounds(), so "which week is this day in" agrees on both ends.
function weekKeyForDay(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dow = d.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

function renderCalendar({ month, days_in_month, today, habits }) {
  calendarTitle.textContent = formatMonthLabel(month);

  // today is only non-null when the requested month is the real current
  // month (the backend only fills it in then). For a month entirely in the
  // past, every unchecked day is "missed"; for one entirely in the future,
  // every day is just not-yet-happened - neither should look like the other.
  const [viewYear, viewMonth] = month.split('-').map(Number);
  const now = new Date();
  const isPastMonth =
    viewYear < now.getFullYear() || (viewYear === now.getFullYear() && viewMonth < now.getMonth() + 1);

  const weekKeyOfDay = [];
  for (let day = 1; day <= days_in_month; day++) {
    weekKeyOfDay[day] = weekKeyForDay(viewYear, viewMonth, day);
  }

  calendarTable.innerHTML = '';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const cornerTh = document.createElement('th');
  cornerTh.textContent = 'Habit';
  cornerTh.className = 'cal-habit-col';
  headRow.appendChild(cornerTh);
  for (let day = 1; day <= days_in_month; day++) {
    const th = document.createElement('th');
    th.textContent = day;
    if (day === today) th.classList.add('cal-today-col');
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  calendarTable.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (habits.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'No habits yet — add one above.';
    td.className = 'cal-empty-row';
    td.colSpan = days_in_month + 1;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const habit of habits) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = habit.name;
    nameTd.className = 'cal-habit-col';
    tr.appendChild(nameTd);

    const checkedDays = new Set(habit.checked_days);
    // For weekly habits, one check-in satisfies the whole Mon-Sun week - the
    // backend now rejects a second one, so at most one day per week is ever
    // in checkedDays. Every other day in that same week should read as
    // "not needed" rather than "missed" or a clickable today.
    const checkedWeeks =
      habit.frequency === 'weekly'
        ? new Set([...checkedDays].map((day) => weekKeyOfDay[day]))
        : null;

    for (let day = 1; day <= days_in_month; day++) {
      const td = document.createElement('td');
      td.className = 'cal-cell';
      const weekAlreadyDone = checkedWeeks && checkedWeeks.has(weekKeyOfDay[day]);
      if (checkedDays.has(day)) {
        td.classList.add('cal-checked');
        td.textContent = '✓';
      } else if (weekAlreadyDone) {
        td.classList.add('cal-week-done');
      } else if (day === today) {
        td.classList.add('cal-today');
        const btn = document.createElement('button');
        btn.className = 'cal-checkin-btn';
        btn.setAttribute('aria-label', `Check in "${habit.name}" for today`);
        btn.addEventListener('click', () => checkinFromCalendar(habit.id, btn));
        td.appendChild(btn);
      } else if ((today !== null && day < today) || isPastMonth) {
        td.classList.add('cal-missed');
      } else {
        td.classList.add('cal-future');
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  calendarTable.appendChild(tbody);
}

async function loadCalendar() {
  calendarError.classList.add('hidden');
  try {
    const monthParam = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}`;
    const res = await apiFetch(`/habits/calendar?month=${monthParam}`);
    if (!res.ok) throw new Error('Could not load calendar');
    const data = await res.json();
    renderCalendar(data);
  } catch (err) {
    calendarError.textContent = err.message;
    calendarError.classList.remove('hidden');
  }
}

async function checkinFromCalendar(habitId, button) {
  button.disabled = true;
  try {
    const res = await apiFetch(`/habits/${habitId}/checkin`, { method: 'POST', body: JSON.stringify({}) });
    if (!res.ok && res.status !== 409) throw new Error('Check-in failed');
    loadHabits();
    loadCalendar();
  } catch (err) {
    calendarError.textContent = err.message;
    calendarError.classList.remove('hidden');
    button.disabled = false;
  }
}

document.getElementById('cal-prev').addEventListener('click', () => {
  calendarMonth -= 1;
  if (calendarMonth < 1) {
    calendarMonth = 12;
    calendarYear -= 1;
  }
  loadCalendar();
});

document.getElementById('cal-next').addEventListener('click', () => {
  calendarMonth += 1;
  if (calendarMonth > 12) {
    calendarMonth = 1;
    calendarYear += 1;
  }
  loadCalendar();
});

document.getElementById('add-habit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('habit-name').value.trim();
  const frequency = document.getElementById('habit-frequency').value;
  try {
    const res = await apiFetch('/habits', { method: 'POST', body: JSON.stringify({ name, frequency }) });
    if (!res.ok) throw new Error('Could not add habit');
    document.getElementById('habit-name').value = '';
    loadHabits();
    loadCalendar();
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token);
    showAppView();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.classList.add('hidden');
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  try {
    const res = await fetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setToken(data.token);
    showAppView();
  } catch (err) {
    authError.textContent = err.message;
    authError.classList.remove('hidden');
  }
});

document.getElementById('show-login').addEventListener('click', () => {
  document.getElementById('show-login').classList.add('active');
  document.getElementById('show-register').classList.remove('active');
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
});

document.getElementById('show-register').addEventListener('click', () => {
  document.getElementById('show-register').classList.add('active');
  document.getElementById('show-login').classList.remove('active');
  document.getElementById('register-form').classList.remove('hidden');
  document.getElementById('login-form').classList.add('hidden');
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  showAuthView();
});

if (getToken()) {
  showAppView();
} else {
  showAuthView();
}
