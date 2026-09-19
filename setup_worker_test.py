"""Set up the Google Sheet tabs the PR -> PO worker (worker_pr_po.py) needs
and add one pending test row.

Creates (if missing):
  * "Item Request" tab with worker headers (RequestID | Item Code | ... )
  * "Item data"  tab with Item Code | Party Code | UOM | Site

Adds a pending row TEST-001 for the seeded item PCPWB60132.

Usage:  python setup_worker_test.py
Env read from root .env: GOOGLE_SHEET_ID, GOOGLE_CREDS_FILE
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

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


REQUEST_HEADERS = [
    "RequestID", "Item Code", "Vendor Code", "Item Quantity", "UOM", "Site",
    "TCS Status", "TCS Requisition No", "TCS PO No", "TCS Error", "TCS Updated At",
]

ITEM_DATA_HEADERS = ["Item Code", "Party Code", "UOM", "Site"]


def main() -> int:
    load_env()
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

    import gspread
    from google.oauth2.service_account import Credentials

    creds = Credentials.from_service_account_file(
        str(creds_path), scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    client = gspread.authorize(creds)
    sh = client.open_by_key(sheet_id) if not sheet_id.startswith("http") else client.open_by_url(sheet_id)

    tab = os.getenv("ITEM_REQUEST_TAB", "Item Request")
    try:
        ws = sh.worksheet(tab)
    except gspread.WorksheetNotFound:
        ws = sh.add_worksheet(title=tab, rows=500, cols=15)
        print(f"Created tab: {tab}")

    if not ws.row_values(1):
        ws.append_row(REQUEST_HEADERS)

    tab2 = os.getenv("ITEM_DATA_TAB", "Item data")
    try:
        ws2 = sh.worksheet(tab2)
    except gspread.WorksheetNotFound:
        ws2 = sh.add_worksheet(title=tab2, rows=500, cols=10)
        print(f"Created tab: {tab2}")
    if not ws2.row_values(1):
        ws2.append_row(ITEM_DATA_HEADERS)

    # Item data lookup rows (item code -> party code)
    data = ws2.get_all_values()
    existing = {str(r[0]).strip().lower() for r in data[1:] if r and str(r[0]).strip()}
    lookup = [("PCPWB60132", "VENDOR001", "NOS", "ADROIT DEWAS-Adroit Industries India Ltd")]
    for code, party, uom, site in lookup:
        if code.lower() not in existing:
            ws2.append_row([code, party, uom, site])
            print(f"Item data row added: {code} -> {party}")

    # Pending request row (only if TEST-001 absent)
    rows = ws.get_all_values()
    ids = {str(r[0]).strip().lower() for r in rows[1:] if r and str(r[0]).strip()}
    if "test-001" not in ids:
        ws.append_row(["TEST-001", "PCPWB60132", "", "2", "NOS", "", "", "", "", "", ""])
        print("Pending test row added: TEST-001 PCPWB60132 qty=2 (vendor will be looked up)")
    else:
        print("TEST-001 already present")

    print(f"\nSheet ready: {sh.url}")
    print("Next:  python worker_pr_po.py --dry-run")
    return 0


if __name__ == "__main__":
    sys.exit(main())