const TOKEN_KEY = 'habit_tracker_token';

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const logoutBtn = document.getElementById('logout-btn');
const authError = document.getElementById('auth-error');
const habitsError = document.getElementById('habits-error');
const habitsList = document.getElementById('habits-list');

// Chart.js instances keyed by habit id, so we can destroy the old one
// before drawing a new one on the same <canvas> (Chart.js throws otherwise).
const charts = {};

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
    statsBtn.addEventListener('click', () => toggleStats(habit.id, statsPanel, statsBtn));

    row.appendChild(info);
    row.appendChild(statsBtn);
    row.appendChild(checkinBtn);
    li.appendChild(row);
    li.appendChild(statsPanel);
    habitsList.appendChild(li);
  }
}

async function toggleStats(habitId, panel, button) {
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
    const res = await apiFetch(`/habits/${habitId}/stats`);
    if (!res.ok) throw new Error('Could not load stats');
    const stats = await res.json();
    renderStatsPanel(panel, habitId, stats);
  } catch (err) {
    panel.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function renderStatsPanel(panel, habitId, stats) {
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
  exportBtn.addEventListener('click', () => exportCsv(habitId));
  panel.appendChild(exportBtn);

  if (charts[habitId]) {
    charts[habitId].destroy();
  }
  charts[habitId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: stats.history.map((h) => h.week_start),
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

async function exportCsv(habitId) {
  try {
    const res = await apiFetch(`/habits/${habitId}/export`);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `habit-${habitId}-checkins.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      button.textContent = 'Already checked in today';
      button.disabled = true;
      return;
    }
    if (!res.ok) throw new Error('Check-in failed');
    button.textContent = 'Checked in ✓';
    button.disabled = true;
  } catch (err) {
    habitsError.textContent = err.message;
    habitsError.classList.remove('hidden');
  }
}

document.getElementById('add-habit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('habit-name').value.trim();
  const frequency = document.getElementById('habit-frequency').value;
  try {
    const res = await apiFetch('/habits', { method: 'POST', body: JSON.stringify({ name, frequency }) });
    if (!res.ok) throw new Error('Could not add habit');
    document.getElementById('habit-name').value = '';
    loadHabits();
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
