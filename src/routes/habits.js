const express = require('express');
const { Readable } = require('stream');
const pool = require('../db');
const { authMiddleware } = require('../auth');

const PYTHON_ANALYTICS_URL = process.env.PYTHON_ANALYTICS_URL;

const router = express.Router();
router.use(authMiddleware);

async function findOwnedHabit(id, userId) {
  const result = await pool.query('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, userId]);
  return result.rows[0] || null;
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

// POST /habits/:id/checkin - check in for a habit owned by the authenticated user
router.post('/:id/checkin', async (req, res) => {
  const { id } = req.params;
  const checkinDate = req.body.checkin_date || new Date().toISOString().slice(0, 10);
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
    const analyticsRes = await fetch(`${PYTHON_ANALYTICS_URL}/analytics/${id}/stats`);
    if (!analyticsRes.ok) {
      return res.status(502).json({ error: 'Analytics service error' });
    }
    const stats = await analyticsRes.json();
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Analytics service unreachable' });
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
    const analyticsRes = await fetch(`${PYTHON_ANALYTICS_URL}/analytics/${id}/export`);
    if (!analyticsRes.ok || !analyticsRes.body) {
      return res.status(502).json({ error: 'Analytics service error' });
    }
    res.set('Content-Type', analyticsRes.headers.get('content-type') || 'text/csv');
    res.set('Content-Disposition', analyticsRes.headers.get('content-disposition') || `attachment; filename=habit-${id}-checkins.csv`);
    Readable.fromWeb(analyticsRes.body).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Analytics service unreachable' });
  }
});

module.exports = router;
