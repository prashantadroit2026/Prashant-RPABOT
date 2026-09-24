"""Google Sheets client – thin wrapper around gspread."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import gspread
from gspread.utils import rowcol_to_a1
from google.oauth2.service_account import Credentials
from tenacity import retry, stop_after_attempt, wait_exponential

from config import settings

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Worksheet names = table names
WORKSHEETS = [
    "items",
    "machines",
    "slips",
    "movements",
    "bots",
    "bot_runs",
    "alerts",
    "audit_logs",
    "meta",  # for counters / last_id
]


@lru_cache(maxsize=1)
def get_client() -> gspread.Client:
    # Prefer inline JSON (Render / secret-manager friendly) over a local file.
    if settings.google_service_account_json_content:
        creds = Credentials.from_service_account_info(
            json.loads(settings.google_service_account_json_content), scopes=SCOPES
        )
        return gspread.authorize(creds)

    path = settings.credentials_path
    if not path.exists():
        raise FileNotFoundError(
            "Service account not found. Set GOOGLE_SERVICE_ACCOUNT_JSON to a file "
            "path OR GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT to the full JSON key. "
            "Download it from Google Cloud Console → IAM → Service Accounts."
        )
    creds = Credentials.from_service_account_file(str(path), scopes=SCOPES)
    return gspread.authorize(creds)


@lru_cache(maxsize=1)
def get_spreadsheet() -> gspread.Spreadsheet:
    if not settings.google_sheet_id:
        raise ValueError("GOOGLE_SHEET_ID is not set in .env")
    return get_client().open_by_key(settings.google_sheet_id)


def ensure_worksheets() -> None:
    """Create missing worksheets with header rows."""
    ss = get_spreadsheet()
    existing = {ws.title for ws in ss.worksheets()}

    headers: dict[str, list[str]] = {
        "items": [
            "id", "code", "name", "uom", "reorder_level", "qty",
            "unit_price", "category", "created_at",
        ],
        "machines": ["id", "code", "name", "line", "created_at"],
        "slips": [
            "id", "token", "group_token", "group_id", "item_id", "item_code",
            "item_name", "machine_id", "machine_code", "machine_name",
            "qty", "issued_qty", "uom", "department", "station", "cell",
            "hod_title", "hod_confirmed", "slip_date", "status", "note",
            "description", "created_at", "decided_at",
        ],
        "movements": [
            "id", "item_id", "machine_id", "slip_id", "qty", "kind", "created_at",
        ],
        "bots": [
            "id", "code", "name", "description", "type", "status",
            "cron_expr", "config", "last_run_at", "next_run_at", "created_at",
        ],
        "bot_runs": [
            "id", "bot_id", "bot_code", "status", "trigger",
            "started_at", "finished_at", "duration_ms", "input", "output", "error",
        ],
        "alerts": [
            "id", "severity", "title", "message", "bot_id", "item_id",
            "acknowledged", "created_at",
        ],
        "audit_logs": [
            "id", "actor", "action", "entity_type", "entity_id", "payload", "created_at",
        ],
        "meta": ["key", "value"],
    }

    for name in WORKSHEETS:
        if name not in existing:
            ws = ss.add_worksheet(title=name, rows=2000, cols=30)
            ws.append_row(headers[name])
            print(f"Created worksheet: {name}")
        else:
            # Ensure header exists
            ws = ss.worksheet(name)
            if not ws.row_values(1):
                ws.append_row(headers[name])


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, min=0.5, max=4))
def get_all_records(sheet_name: str) -> list[dict[str, Any]]:
    ws = get_spreadsheet().worksheet(sheet_name)
    return ws.get_all_records()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, min=0.5, max=4))
def append_row(sheet_name: str, values: list[Any]) -> None:
    ws = get_spreadsheet().worksheet(sheet_name)
    ws.append_row(values, value_input_option="USER_ENTERED")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, min=0.5, max=4))
def update_row(sheet_name: str, row_number: int, values: list[Any]) -> None:
    """row_number is 1-based (header is row 1)."""
    ws = get_spreadsheet().worksheet(sheet_name)
    end_cell = rowcol_to_a1(row_number, len(values))
    ws.update(f"A{row_number}:{end_cell}", [values], value_input_option="USER_ENTERED")


def find_row_by_id(sheet_name: str, record_id: int) -> tuple[int, dict[str, Any]] | None:
    """Return (1-based row index, record dict) or None."""
    records = get_all_records(sheet_name)
    for idx, rec in enumerate(records, start=2):  # data starts at row 2
        if str(rec.get("id")) == str(record_id):
            return idx, rec
    return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, min=0.5, max=4))
def delete_row(sheet_name: str, row_number: int) -> None:
    """row_number is 1-based (header is row 1)."""
    ws = get_spreadsheet().worksheet(sheet_name)
    ws.delete_rows(row_number)


def next_id(sheet_name: str) -> int:
    """Simple auto-increment using the meta sheet."""
    records = get_all_records("meta")
    key = f"last_id_{sheet_name}"
    current = 0
    row_idx = None
    for i, rec in enumerate(records, start=2):
        if rec.get("key") == key:
            current = int(rec.get("value") or 0)
            row_idx = i
            break

    new_id = current + 1
    if row_idx:
        update_row("meta", row_idx, [key, new_id])
    else:
        append_row("meta", [key, new_id])
    return new_id
