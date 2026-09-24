# Bot Directory — TCS iON PR + PO

> **Location:** `Bot/` inside **Bot Dashboard** (`/home/prashant/Projects/RPA BOT/Bot Dashboard`)
> One bot today — designed to scale to many.

## What’s here

| File | Purpose | Lines |
|------|---------|-------|
| `create_pr_po.py` | **Combined PR + PO bot** — logs into TCS iON, creates a Purchase Requisition, approves it, then creates a Purchase Order from the PR. Headless via Playwright. | 1490 |
| `requirements.txt` | `playwright==1.62.0`, `python-dotenv==1.1.1` | 2 |
| `.env.example` | Template for `TCS_USERNAME`, `TCS_PASSWORD`, `HEADLESS`, etc. | 9 |
| `data/.gitkeep` | Placeholder for input CSVs (if you add batch mode) | — |
| `logs/screenshots/.gitkeep` | `filled_form.png`, `requisition_saved.png`, `po_filled.png` land here | — |

**Dashboard integration:** The 4 bots in `migrations/0003_bot_dashboard.sql` (`BOT-INV-SYNC`, `BOT-SLIP-PROC`, `BOT-REORDER`, `BOT-REPORT`) are the *dashboard’s* RPA. This TCS bot is a **5th, external bot** — it drives the real TCS iON portal. Register it below to see it alongside the others.

## Quick check — current state

```
Bot/
├── create_pr_po.py        50 KB, 41 funcs, 0 classes
├── requirements.txt
├── .env.example
├── data/.gitkeep
└── logs/screenshots/.gitkeep
```

- **Python:** 3.12.3 — `py_compile: OK` (0 errors), `playwright 1.62.0` installed
- **Structure:** `__pycache__/` ignored, `data/` & `logs/` now exist (previously missing)
- **Config:** `.env` not found → bot correctly requires `TCS_USERNAME`/`TCS_PASSWORD` env or fails fast
- **Headless:** now `HEADLESS=true` by default (was hard-coded `False` — fixed)
- **Paths:** `DATA_DIR = PROJECT_DIR / "data"` → `Bot Dashboard/data` (parent). Kept as-is for backward compat; `Bot/data` is for local per-bot inputs.

## How it runs

```bash
# 1. Install deps (once)
pip install -r Bot/requirements.txt
playwright install chromium   # already done for dashboard

# 2. Configure
cp Bot/.env.example .env
# edit .env → add TCS_USERNAME, TCS_PASSWORD

# 3. Dry run (headless, default)
python Bot/create_pr_po.py --item-code PCPWB60132 --qty 50

# 4. Headed for debugging
HEADLESS=false python Bot/create_pr_po.py --item-code PCPWB60132 --qty 50 --po-type Import --currency USD
```

**CLI**

```
usage: create_pr_po.py --item-code CODE --qty QTY [--po-type Domestic] [--currency INR]
```

**What it does (4 steps, with retries)**

1. **Login** — `do_login()` → waits for `TCSiONHome` marker, handles “already logged in”
2. **Create PR** — `select_manufacturing() → fill_requisition() → fill_requisition_items() → fill_and_save_draft()` → captures PR number via regex, retries up to `PR_MAX_ATTEMPTS=3`
3. **Approve** — `approve_if_not_approved()` → Edit → Approve → checks `Status: Approved` or `Convert to PO` visible
4. **Create PO** — `create_po_from_pr()` → Purchase Order → Create from PR → search Approved PRs → select row → Create PO → fill header → Submit

Screenshots saved to `Bot/logs/screenshots/` on every run for audit.

## Bot Dashboard linkage

The dashboard’s `bots` table (see `migrations/0003_bot_dashboard.sql` & `/system`) tracks bots generically:

```sql
select code, name, status, cron_expr from bots;
-- BOT-INV-SYNC  | Inventory Sync Bot | active | */10 * * * *
-- BOT-SLIP-PROC | Slip Processor     | active | */5  * * * *
-- BOT-REORDER   | Reorder Watcher    | active | 0 */6 * * *
-- BOT-REPORT    | Nightly Report     | paused | 0 2  * * *
```

**To register the TCS bot in the dashboard:**

```bash
curl -X POST http://localhost:8080/api/bots \
  -H 'content-type: application/json' \
  -d '{
    "code":"BOT-TCS-PRPO",
    "name":"TCS iON PR+PO Bot",
    "description":"Creates PR, approves, then creates PO from PR via Playwright. See Bot/create_pr_po.py",
    "type":"generic",
    "status":"active",
    "cronExpr":"0 9 * * 1",
    "config":{"script":"Bot/create_pr_po.py","item_code":"PCPWB60132","po_type":"Domestic"}
  }' | jq
```

Then trigger/runs appear at `/api/runs?botId=5` and on `/system` → Live Data.

## Known fixes applied (2026-09-09)

- **HEADLESS** — `headless=False` → `headless=os.environ.get("HEADLESS","true").lower() not in ("false","0","no")` + `args` only when headed. Prevents crash on server.
- **Missing dirs** — created `Bot/data`, `Bot/logs/screenshots` with `.gitkeep` (script expected `PROJECT_DIR/logs/screenshots`).
- **Deps** — added `requirements.txt` + `.env.example` (was undocumented, required `playwright`).
- **Env loading** — `_load_env()` correctly prefers `PROJECT_DIR/.env` then `SCRIPT_DIR/.env`; now documented.

## Remaining notes (not blockers)

- **Broad `except Exception`** (110 occurrences) — intentional for resilient RPA, but consider `logging.exception` instead of silent `pass` for 3–4 critical paths.
- **Hard-coded selectors** in `PO_FIELDS` & `_wait_for` — tied to TCS iON DOM; will need update if TCS upgrades Angular. Covered by `_select_option` fuzzy match.
- **`time.sleep` (16)** — could be `page.wait_for_timeout` or `wait_for_selector`; kept for stability on slow TCS pages.
- **No tests** — add `Bot/tests/test_create_pr_po.py` with mocked Playwright page for `fill_requisition()` if you want CI.
- **Secrets** — `TCS_USERNAME/PASSWORD` never logged; ensure `.env` is in `.gitignore` (it is not yet — add it).

## .gitignore addition (recommended)

```gitignore
# Bot
Bot/.env
Bot/logs/
Bot/data/*.csv
__pycache__/
```

## Next steps

- `python -m py_compile Bot/create_pr_po.py && echo OK` — already passes
- `playwright install chromium` — done
- Try a dry run with dummy creds to see the bot fail fast on login (expected), or register it in the dashboard via the curl above.
