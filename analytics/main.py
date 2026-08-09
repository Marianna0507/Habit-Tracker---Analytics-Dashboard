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


def compute_completion_rate(created_at: date, frequency: str, checkin_dates: set[date]) -> float:
    """Fraction of elapsed periods (days, or ISO weeks for weekly habits)
    since the habit was created that have at least one check-in."""
    today = date.today()
    if frequency == "weekly":
        total_periods = ((today - created_at).days // 7) + 1
        completed_periods = len({d.isocalendar()[:2] for d in checkin_dates})
    else:
        total_periods = (today - created_at).days + 1
        completed_periods = len(checkin_dates)

    return round(completed_periods / total_periods, 4)


@app.get("/analytics/{habit_id}/stats")
def habit_stats(habit_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT frequency, created_at FROM habits WHERE id = %s",
                (habit_id,),
            )
            habit = cur.fetchone()
            if habit is None:
                raise HTTPException(status_code=404, detail="Habit not found")
            frequency, created_at = habit[0], habit[1].date()

            cur.execute(
                "SELECT checkin_date FROM checkins WHERE habit_id = %s",
                (habit_id,),
            )
            checkin_dates = {row[0] for row in cur.fetchall()}

    return {
        "habit_id": habit_id,
        "current_streak": compute_current_streak(checkin_dates),
        "completion_rate": compute_completion_rate(created_at, frequency, checkin_dates),
    }
