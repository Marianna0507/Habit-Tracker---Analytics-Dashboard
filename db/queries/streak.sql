-- Current streak: count consecutive days ending on the most recent checkin
-- Usage: replace $1 with a habit id, e.g. via a parameterized query in the app
WITH ranked AS (
  SELECT checkin_date,
         checkin_date - (ROW_NUMBER() OVER (ORDER BY checkin_date))::int AS grp
  FROM checkins
  WHERE habit_id = $1
)
SELECT COUNT(*) AS streak
FROM ranked
WHERE grp = (SELECT grp FROM ranked ORDER BY checkin_date DESC LIMIT 1);
