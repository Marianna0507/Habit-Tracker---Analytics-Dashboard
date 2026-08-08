const express = require('express');
const pool = require('../db');
const { authMiddleware } = require('../auth');

const router = express.Router();
router.use(authMiddleware);

// GET /habits - list the authenticated user's habits
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM habits WHERE user_id = $1 ORDER BY id', [req.userId]);
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
    const habit = await pool.query('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, req.userId]);
    if (habit.rows.length === 0) {
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
    const habit = await pool.query('SELECT id FROM habits WHERE id = $1 AND user_id = $2', [id, req.userId]);
    if (habit.rows.length === 0) {
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

module.exports = router;
