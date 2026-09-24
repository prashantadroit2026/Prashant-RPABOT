"""Create a new Google Spreadsheet for the backend and write its ID to .env.

Usage:
    python create_sheet.py [path/to/service-account.json] [sheet title]

Defaults to ./service-account.json and title "Procurement Hub".
Requires the Google Sheets API and Drive API to be enabled for the
service account's project.
"""
from __future__ import annotations

import sys
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials

from config import settings

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def main() -> int:
    json_path = settings.credentials_path
    if len(sys.argv) > 1:
        json_path = Path(sys.argv[1]).expanduser().resolve()
    title = sys.argv[2] if len(sys.argv) > 2 else "Procurement Hub"

    if not json_path.exists():
        print(f"No service-account JSON found at {json_path}")
        return 1

    creds = Credentials.from_service_account_file(str(json_path), scopes=SCOPES)
    client = gspread.authorize(creds)

    ss = client.create(title)
    print(f"Created spreadsheet: {title}")
    print(f"Spreadsheet ID: {ss.id}")
    print(f"URL: {ss.url}")

    env_lines: list[str] = []
    env_file = Path(".env")
    if env_file.exists():
        env_lines = env_file.read_text(encoding="utf-8").splitlines()
    had_sheet_id = any(l.startswith("GOOGLE_SHEET_ID=") for l in env_lines)
    had_json = any(l.startswith("GOOGLE_SERVICE_ACCOUNT_JSON=") for l in env_lines)

    if not had_sheet_id:
        env_lines.append(f"GOOGLE_SHEET_ID={ss.id}")
    if not had_json:
        env_lines.append(f"GOOGLE_SERVICE_ACCOUNT_JSON={json_path.as_posix()}")
    env_file.write_text("\n".join(env_lines) + "\n", encoding="utf-8")

    print("Updated .env (created it if missing).")
    print("Next: start the backend — it will create worksheets and seed demo data.")
    return 0


if __name__ == "__main__":
    sys.exit(main())