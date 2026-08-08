require('dotenv').config();
const path = require('path');
const express = require('express');
const authRoutes = require('./routes/auth');
const habitsRoutes = require('./routes/habits');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/auth', authRoutes);
app.use('/habits', habitsRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Habit Tracker API listening on port ${PORT}`);
});
