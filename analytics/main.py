from datetime import date, timedelta

from fastapi import FastAPI, HTTPException

from db import get_connection

app = FastAPI(title="Habit Tracker Analytics")


def compute_current_streak(checkin_dates: set[date]) -> int:
    """Consecutive days of check-ins ending today (or yesterday, if today's
    check-in just hasn't happened yet — a missed *yesterday* still breaks it)."""
    today = date.today()
    if today in checkin_dates:
        cursor = today
    elif (today - timedelta(days=1)) in checkin_dates:
        cursor = today - timedelta(days=1)
    else:
        return 0

    streak = 0
    while cursor in checkin_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


@app.get("/analytics/{habit_id}/stats")
def habit_stats(habit_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM habits WHERE id = %s", (habit_id,))
            if cur.fetchone() is None:
                raise HTTPException(status_code=404, detail="Habit not found")

            cur.execute(
                "SELECT checkin_date FROM checkins WHERE habit_id = %s",
                (habit_id,),
            )
            checkin_dates = {row[0] for row in cur.fetchall()}

    return {
        "habit_id": habit_id,
        "current_streak": compute_current_streak(checkin_dates),
    }
