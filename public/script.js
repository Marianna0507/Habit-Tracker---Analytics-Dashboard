const TOKEN_KEY = 'habit_tracker_token';

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const logoutBtn = document.getElementById('logout-btn');
const authError = document.getElementById('auth-error');
const habitsError = document.getElementById('habits-error');
const habitsList = document.getElementById('habits-list');

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

    const info = document.createElement('span');
    info.textContent = `${habit.name} `;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = habit.frequency;
    info.appendChild(badge);

    const checkinBtn = document.createElement('button');
    checkinBtn.textContent = 'Check in';
    checkinBtn.addEventListener('click', () => checkin(habit.id, checkinBtn));

    li.appendChild(info);
    li.appendChild(checkinBtn);
    habitsList.appendChild(li);
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
