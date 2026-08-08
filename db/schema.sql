CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE habits (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    frequency VARCHAR(20) DEFAULT 'daily', -- daily, weekly
    created_at TIMESTAMP DEFAULT NOW(),
    archived BOOLEAN DEFAULT FALSE
);

CREATE TABLE checkins (
    id SERIAL PRIMARY KEY,
    habit_id INTEGER REFERENCES habits(id) ON DELETE CASCADE,
    checkin_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(habit_id, checkin_date) -- prevents double check-ins same day
);

CREATE INDEX idx_checkins_habit_date ON checkins(habit_id, checkin_date);

-- Current streak: count consecutive days ending today with a checkin
WITH ranked AS (
  SELECT checkin_date,
         checkin_date - (ROW_NUMBER() OVER (ORDER BY checkin_date))::int AS grp
  FROM checkins
  WHERE habit_id = $1
)
SELECT COUNT(*) AS streak
FROM ranked
WHERE grp = (SELECT grp FROM ranked ORDER BY checkin_date DESC LIMIT 1);