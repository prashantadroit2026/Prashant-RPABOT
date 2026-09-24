"""Helpers to shape backend records exactly like the frontend expects (camelCase)."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


def to_camel(key: str) -> str:
    """snake_case -> camelCase, leave already-camel / single-word keys untouched."""
    if "_" not in key:
        return key
    head, *rest = key.split("_")
    return head + "".join(p[:1].upper() + p[1:] for p in rest)


def camelize(rec: dict[str, Any]) -> dict[str, Any]:
    """Shallow key rename; suitable for flat records."""
    return {to_camel(k): v for k, v in rec.items()}


def stock_status(qty: Any, reorder: Any) -> str:
    try:
        q = int(qty or 0)
        r = int(reorder or 0)
    except (TypeError, ValueError):
        q, r = 0, 0
    if q <= 0:
        return "out"
    if q <= r:
        return "low"
    return "in"


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def week_mondays(n: int) -> list[str]:
    """Last n ISO(ish) week-Mondays as 'YYYY-MM-DD', oldest first — mirrors
    lastNWeeks(n) in the frontend."""
    today = datetime.now()
    monday = today - timedelta(days=today.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    weeks: list[str] = []
    for i in range(n - 1, -1, -1):
        d = monday - timedelta(days=i * 7)
        weeks.append(f"{d.year}-{d.month:02d}-{d.day:02d}")
    return weeks


def week_of(value: Any) -> str | None:
    dt = _parse_dt(value)
    if not dt:
        return None
    monday = dt - timedelta(days=dt.weekday())
    return f"{monday.year}-{monday.month:02d}-{monday.day:02d}"