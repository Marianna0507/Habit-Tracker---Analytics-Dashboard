require('dotenv').config();
const express = require('express');
const pool = require('./db');

const app = express();
app.use(express.json());

// GET /habits - list habits (optionally filter by user_id)
app.get('/habits', async (req, res) => {
  const { user_id } = req.query;
  try {
    const result = user_id
      ? await pool.query('SELECT * FROM habits WHERE user_id = $1 ORDER BY id', [user_id])
      : await pool.query('SELECT * FROM habits ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch habits' });
  }
});

// POST /habits - create a habit
app.post('/habits', async (req, res) => {
  const { user_id, name, frequency } = req.body;
  if (!user_id || !name) {
    return res.status(400).json({ error: 'user_id and name are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO habits (user_id, name, frequency) VALUES ($1, $2, COALESCE($3, \'daily\')) RETURNING *',
      [user_id, name, frequency]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create habit' });
  }
});

// POST /habits/:id/checkin - check in for a habit (defaults to today)
app.post('/habits/:id/checkin', async (req, res) => {
  const { id } = req.params;
  const checkinDate = req.body.checkin_date || new Date().toISOString().slice(0, 10);
  try {
    const habit = await pool.query('SELECT id FROM habits WHERE id = $1', [id]);
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

// GET /habits/:id/checkins - list checkins for a habit
app.get('/habits/:id/checkins', async (req, res) => {
  const { id } = req.params;
  try {
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Habit Tracker API listening on port ${PORT}`);
});
