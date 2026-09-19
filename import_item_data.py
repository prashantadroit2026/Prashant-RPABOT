"""Import the real 'Item data' master from PROCUREMENT BOT (1).xlsx into the
Google Sheet 'Item data' tab (used by worker_pr_po.py for vendor/UOM/site lookup).

Usage:  python import_item_data.py [path-to-xlsx] [tab-name]
Env read from root .env: GOOGLE_SHEET_ID, GOOGLE_CREDS_FILE
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent


def load_env() -> None:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k = k.strip()
        v = v.strip().strip("\"'")
        if k and k not in os.environ:
            os.environ[k] = v


def main() -> int:
    load_env()
    xlsx = sys.argv[1] if len(sys.argv) > 1 else r"data\PROCUREMENT BOT (1).xlsx"
    tab = os.getenv("ITEM_DATA_TAB", "Item data")
    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    creds_file = os.getenv("GOOGLE_CREDS_FILE", "").strip()
    if not sheet_id or not creds_file:
        print("ERROR: GOOGLE_SHEET_ID and GOOGLE_CREDS_FILE must be set in .env")
        return 1
    creds_path = Path(creds_file)
    if not creds_path.is_absolute():
        creds_path = ROOT / creds_path
    if not creds_path.is_file():
        print(f"ERROR: creds file not found: {creds_path}")
        return 1

    wb = openpyxl.load_workbook(xlsx, data_only=True)
    if "Item data" not in wb.sheetnames:
        print(f"ERROR: 'Item data' tab not found in {xlsx} ({wb.sheetnames})")
        return 1
    ws = wb["Item data"]
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print("ERROR: Item data tab is empty")
        return 1
    matrix = [[("" if c is None else c) for c in r] for r in rows]
    print(f"Read {len(matrix) - 1} item rows x {len(matrix[0])} cols from {xlsx}")

    import gspread
    from google.oauth2.service_account import Credentials

    creds = Credentials.from_service_account_file(
        str(creds_path), scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    client = gspread.authorize(creds)
    sh = client.open_by_key(sheet_id) if not sheet_id.startswith("http") else client.open_by_url(sheet_id)

    ws2 = sh.worksheet(tab)
    ws2.clear()
    ws2.update(values=matrix, range_name="A1", value_input_option="USER_ENTERED")
    print(f"Wrote {len(matrix)} rows to Google Sheet tab '{tab}' ({sh.url})")
    return 0


if __name__ == "__main__":
    sys.exit(main())