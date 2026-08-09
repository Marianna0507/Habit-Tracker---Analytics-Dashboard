const express = require('express');
const { Readable } = require('stream');
const pool = require('../db');
const { authMiddleware } = require('../auth');

const PYTHON_ANALYTICS_URL = process.env.PYTHON_ANALYTICS_URL;
const ANALYTICS_TIMEOUT_MS = 5000;

const router = express.Router();
router.use(authMiddleware);

async function findOwnedHabit(id, userId) {
  const result = await pool.query('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
}

// Calls the Python analytics service with a timeout, so a hung/slow service
// fails fast instead of leaving the request (and the client) hanging
// indefinitely. Throws an Error with a `.status` to send back to the client:
// 504 if it timed out, 502 if it's unreachable/refused the connection.
async function fetchAnalytics(path) {
  try {
    return await fetch(`${PYTHON_ANALYTICS_URL}${path}`, {
      signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
    });
  } catch (err) {
    const wrapped = new Error(
      err.name === 'TimeoutError' ? 'Analytics service timed out' : 'Analytics service unreachable'
    );
    wrapped.status = err.name === 'TimeoutError' ? 504 : 502;
    throw wrapped;
  }
}

// GET /habits - list the authenticated user's habits, each flagged with
// whether it's already been checked in today
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT h.*,
              EXISTS (
                SELECT 1 FROM checkins c
                WHERE c.habit_id = h.id AND c.checkin_date = CURRENT_DATE
              ) AS checked_in_today
       FROM habits h
       WHERE h.user_id = $1
       ORDER BY h.id`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch habits' });
  }
});

// GET /habits/calendar?month=YYYY-MM - every habit with which days of that
// month it was checked in, for rendering a monthly grid. Defaults to the
// current month. One query for all habits, to avoid an N+1 fetch per habit.
router.get('/calendar', async (req, res) => {
  const monthParam = req.query.month;
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: 'month must be in YYYY-MM format' });
  }
  const now = new Date();
  const [year, month] = monthParam
    ? monthParam.split('-').map(Number)
    : [now.getFullYear(), now.getMonth() + 1];
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  try {
    const result = await pool.query(
      `SELECT h.id, h.name, h.frequency,
              COALESCE(
                ARRAY_AGG(EXTRACT(DAY FROM c.checkin_date)::int ORDER BY c.checkin_date)
                  FILTER (WHERE c.checkin_date IS NOT NULL),
                '{}'
              ) AS checked_days
       FROM habits h
       LEFT JOIN checkins c
         ON c.habit_id = h.id
         AND c.checkin_date >= $2::date
         AND c.checkin_date < ($2::date + interval '1 month')
       WHERE h.user_id = $1
       GROUP BY h.id, h.name, h.frequency
       ORDER BY h.id`,
      [req.userId, monthStart]
    );
    res.json({
      month: `${year}-${String(month).padStart(2, '0')}`,
      days_in_month: daysInMonth,
      today: isCurrentMonth ? now.getDate() : null,
      habits: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch calendar' });
  }
});

// POST /habits - create a habit owned by the authenticated user
router.post('/', async (req, res) => {
  const { name, frequency } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO habits (user_id, name, frequency) VALUES ($1, $2, COALESCE($3, \'daily\')) RETURNING *',
      [req.userId, name, frequency]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create habit' });
  }
});

// POST /habits/:id/checkin - check in a habit owned by the authenticated user
// for TODAY only. No backfilling missed days, no pre-logging future ones -
// if a caller passes a checkin_date that isn't today, reject it rather than
// silently using today instead, so the client finds out immediately.
router.post('/:id/checkin', async (req, res) => {
  const { id } = req.params;
  const today = new Date().toISOString().slice(0, 10);
  if (req.body.checkin_date && req.body.checkin_date !== today) {
    return res.status(400).json({ error: 'Can only check in for today' });
  }
  const checkinDate = today;
  try {
    const habit = await findOwnedHabit(id, req.userId);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    const result = await pool.query(
      'INSERT INTO checkins (habit_id, checkin_date) VALUES ($1, $2) RETURNING *',
      [id, checkinDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already checked in for that date' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to check in' });
  }
});

// GET /habits/:id/checkins - list checkins for a habit owned by the authenticated user
router.get('/:id/checkins', async (req, res) => {
  const { id } = req.params;
  try {
    const habit = await findOwnedHabit(id, req.userId);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    const result = await pool.query(
      'SELECT * FROM checkins WHERE habit_id = $1 ORDER BY checkin_date DESC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch checkins' });
  }
});

// GET /habits/:id/stats - proxy to the Python analytics service
router.get('/:id/stats', async (req, res) => {
  const { id } = req.params;
  try {
    const habit = await findOwnedHabit(id, req.userId);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    let analyticsRes;
    try {
      analyticsRes = await fetchAnalytics(`/analytics/${id}/stats`);
    } catch (err) {
      return res.status(err.status).json({ error: err.message });
    }
    if (analyticsRes.status === 404) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    if (!analyticsRes.ok) {
      return res.status(502).json({ error: 'Analytics service error' });
    }
    const stats = await analyticsRes.json();
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /habits/:id/export - proxy + stream a CSV of checkins from the Python service
router.get('/:id/export', async (req, res) => {
  const { id } = req.params;
  try {
    const habit = await findOwnedHabit(id, req.userId);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    let analyticsRes;
    try {
      analyticsRes = await fetchAnalytics(`/analytics/${id}/export`);
    } catch (err) {
      return res.status(err.status).json({ error: err.message });
    }
    if (!analyticsRes.ok || !analyticsRes.body) {
      return res.status(502).json({ error: 'Analytics service error' });
    }
    res.set('Content-Type', analyticsRes.headers.get('content-type') || 'text/csv');
    res.set('Content-Disposition', analyticsRes.headers.get('content-disposition') || `attachment; filename=habit-${id}-checkins.csv`);
    Readable.fromWeb(analyticsRes.body).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to export checkins' });
  }
});

// DELETE /habits/:id - delete a habit (and its checkins, via ON DELETE CASCADE)
// owned by the authenticated user
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const habit = await findOwnedHabit(id, req.userId);
    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }
    await pool.query('DELETE FROM habits WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete habit' });
  }
});

module.exports = router;
