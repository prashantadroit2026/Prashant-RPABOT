# TCS-ERP Bot — Procurement Automation

End-to-end purchasing automation: a Google-Sheets-backed FastAPI backend, Playwright bots that drive the real TCS ERP portal (PR -> PO), and a worker that orchestrates them from an "Item Request" queue tab.

## Layout

| Path | Purpose |
| ---- | ------- |
| `worker_pr_po.py` | Queue worker: reads pending rows from the Google Sheet `Item Request` tab, spawns the PR bot then the PO bot, writes outcomes back. |
| `PR Approver/` | PR bot `PR_combined.py` (+ `bot_api.py`, `email_approver.py`, `approve_and_po.py`, `examples/`). |
| `Purchase Order/` | PO bot `PO_combined.py` (wrapper `PO.py`). |
| `requisition.py`, `fill_requisition.py` | Shared modules imported by both bots (keep at root). |
| `setup_worker_test.py` | Creates the worker tabs (`Item Request`, `Item data`) in the spreadsheet. |
| `import_item_data.py` | Imports the real master file into the `Item data` tab (vendor/UOM/site lookup). |
| `data/` | Master data files (e.g. `PROCUREMENT BOT (1).xlsx`). |
| `procurement-backend/` | FastAPI backend using Google Sheets as the database (own venv / secrets). |
| `src/` | Frontend web app (TanStack; self-contained DB). |
| `docs/` | Day-by-day implementation logs. |
| `logs/` | Bot run logs, screenshots, worker payloads. |

## Quick links
- Every-day log: `docs\2026-09-19-implementation.md`
- Backend readme: `procurement-backend\README.md`
- Architecture notes: `DATA-INLETS-OUTLETS.txt`

## Environment
Copy or edit `.env` (gitignored) with TCS credentials, `GOOGLE_SHEET_ID`, and `GOOGLE_CREDS_FILE`.
Service-account key lives in `procurement-backend\secrets\` (gitignored).