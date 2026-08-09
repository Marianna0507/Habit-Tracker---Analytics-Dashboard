import csv
import io
import re
from datetime import date, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

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


def compute_history(created_at: date, frequency: str, checkin_dates: set[date], weeks: int = 8) -> list[dict]:
    """Completion rate per ISO week for the last `weeks` weeks, oldest first.
    Weeks before the habit existed are skipped; partial weeks (the habit's
    creation week, and the current in-progress week) divide by elapsed days
    so far rather than a flat 7, so they aren't unfairly penalized."""
    today = date.today()
    current_week_start = today - timedelta(days=today.weekday())

    history = []
    for i in range(weeks - 1, -1, -1):
        week_start = current_week_start - timedelta(weeks=i)
        week_end = week_start + timedelta(days=6)
        if week_end < created_at:
            continue

        effective_start = max(week_start, created_at)
        effective_end = min(week_end, today)
        days_elapsed = (effective_end - effective_start).days + 1
        checkins_in_week = {d for d in checkin_dates if week_start <= d <= week_end}

        if frequency == "weekly":
            rate = 1.0 if checkins_in_week else 0.0
        else:
            rate = round(len(checkins_in_week) / days_elapsed, 4) if days_elapsed > 0 else 0.0

        history.append({"week_start": week_start.isoformat(), "completion_rate": rate})
    return history


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
        "history": compute_history(created_at, frequency, checkin_dates),
    }


def safe_filename(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "-", name).strip()
    return cleaned or fallback


@app.get("/analytics/{habit_id}/export")
def export_checkins(habit_id: int):
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM habits WHERE id = %s", (habit_id,))
            habit = cur.fetchone()
            if habit is None:
                raise HTTPException(status_code=404, detail="Habit not found")
            habit_name = habit[0]

            cur.execute(
                "SELECT checkin_date FROM checkins WHERE habit_id = %s ORDER BY checkin_date",
                (habit_id,),
            )
            rows = cur.fetchall()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["checkin_date"])
    for (checkin_date,) in rows:
        writer.writerow([checkin_date.isoformat()])
    buffer.seek(0)

    filename = safe_filename(habit_name, f"habit-{habit_id}") + ".csv"
    content_disposition = "attachment; filename=" + filename

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": content_disposition},
    )
