# TCS-ERP Bot — Implementation Log (2026-09-19)

Date: Saturday, 19 September 2026
Scope: backend (procurement-backend), worker/orchestration scripts, Google Sheet data, run outcomes, frontend/backend audit, and approved next steps.

---

## 1. Objective

Make the procurement automation work end-to-end:

- A FastAPI backend that uses **Google Sheets as the database** (catalog, inventory, machines, slips, bots, runs, alerts).
- A Playwright **worker** (`worker_pr_po.py`) that creates a **PR** in the real TCS ERP portal and then converts it to a **PO**.
- A frontend app (`src/`) whose REST contract the backend mirrors.
- Master data aligned with the real file `PROCUREMENT BOT (1).xlsx`.

---

## 2. Backend fixes (procurement-backend)

| File | Change |
| ---- | ------ |
| `services/sheet_service.py` | `_resolve_item()` now resolves a slip-group line by item **code** OR **id** (originally id-only), fixing group-slip creation. |
| `sheets/client.py` | `update_row()` column math fixed via `rowcol_to_a1(row_number, len(values))` — previously computed the end cell incorrectly, corrupting row rewrites. |
| `config.py` / `main.py` | CORS is now configurable (`cors_origins`, `cors_allow_credentials`) instead of the invalid `"*"` + credentials combination. |
| `.env` / `.env.example` | Created with the real `GOOGLE_SHEET_ID` and service-account JSON path. |
| `main.py` | Fixed startup **unicode crash** (`⚠`/`✓` on Windows cp1252 console) by switching log/seed messages to ASCII. Server now starts cleanly. |
| `create_sheet.py` | Helper written (later made unnecessary after manual sheet setup). |

---

## 3. Worker / bot-adjacent fixes (scripts, not the TCS flow itself)

| File | Change |
| ---- | ------ |
| `worker_pr_po.py` | Added `_load_env()` — the worker was never loading `.env`, so `GOOGLE_SHEET_ID` was empty at runtime. |
| `worker_pr_po.py` | Item lookup (`_lookup_item`) now also maps a **`Base UOM`** header as `uom` (real master file uses `Base UOM`). |
| `PR Approver/PR_combined.py` | `build_pr_from_json` now derives `account_site` from the slip site (e.g. `ADROIT DRIVESHAFT…` -> `ADROIT DRIVESHAFT`) so the form account matches the selected site. |
| `Purchase Order/PO_combined.py` | Added diagnostic **RESULT ROW dump** (prints up to 20 search-result rows) + `po_search_no_match.png` in the "no approved PR found" branch, to debug the failed search. |

---

## 4. Google Sheet data (worker tabs)

- `setup_worker_test.py` created the worker tabs **`Item Request`** and **`Item data`** in the shared spreadsheet and added a first test row `TEST-001` (item `PCPWB60132`, qty 2).
- `import_item_data.py` imports the real master file `PROCUREMENT BOT (1).xlsx` -> Google Sheet tab **`Item data`**:
  - **3,467 real item rows** imported (28 columns after header: Site, Party Code, Party Description, Item Code, Item Description, Item Category, Item Group, Item A/C Code, Item A/C Description, Base Quantity, Rate, Base UOM, Delivery Term, ...).
  - After import, `PCPWB60132` resolves to the **real vendor `SUP00606` (NISHIT MARKETING)**, UOM `PCS`, site `ADROIT DRIVESHAFT-Adroit Driveshafts Pvt Ltd` — replacing the earlier fabricated `VENDOR001`.
  - Verified: `worker_pr_po._lookup_item("PCPWB60132")` -> `{'vendor': 'SUP00606', 'uom': 'PCS', 'site': 'ADROIT DRIVESHAFT-Adroit Driveshafts Pvt Ltd'}`.

Spreadsheet id: `1duAuEMFUInuCJSzhTwRMZjqhGZm_KcZl_gxCndHZ_jE` (values kept in `GOOGLE_SHEET_ID`).
Service account: `procurement-backend\secrets\genuine-amulet-502604-d2-af52f3e09138.json`.

---

## 5. Run outcomes

### Run 1 (fabricated vendor `VENDOR001`)
- PR created: **`AD/2627/PR/0136`** (approved). OK.
- PO failed: **`PO creation failed in TCS portal`** — the "Create from PR" search showed no approved PR for `PCPWB60132` within `01/09/2026..19/09/2026`.
- Root cause not yet confirmed; diagnostic dump was added to the PO bot for the next run.

### Run 2 (real vendor `SUP00606`, real UOM PCS)
- Worker resolved vendor `SUP00606` from `Item data`. OK.
- PR created: **`ADPL/2627/PR/0682`**. OK.
- PO failed: **`login failed`** (error cell) — direct re-run confirmed the cause:
  - `Login attempt 1/4: another session is active. Waiting 60s...`
  - `Login attempt 2/4..4/4: page navigation failed, retrying...`
  - -> TCS **single-session lock** persists after the PR run; the PO process cannot log in until the stale server-side session clears. Not yet resolved.

### Diagnostics
- Logs/screenshots land in `C:\Users\Admin\Desktop\logs\screenshots\` (e.g. `req_already_approved.png`, `po_search_no_match.png`).
- Worker payloads saved under `logs\worker_payloads\TEST-001_*_combined_*.json` for safe bot re-runs.

---

## 6. Frontend / backend audit (read-only, same day)

### Architecture reality
- The frontend (`src/`, TanStack Start app) is **fully self-contained**: its own SQL DB (**PGLite** fallback, **Neon** when `DATABASE_URL` is set), its own `/api/*` REST handlers, auth, seeds, and its own RPA spawner (`src/lib/rpa-runner.ts`).
- The FastAPI backend (`procurement-backend/`) is a **parallel implementation** of the same REST surface backed by Google Sheets. **Nothing in the frontend calls it** (no `VITE_API_BASE`, no proxy). `README.md`'s "point VITE_API_BASE=http://localhost:8080" is aspirational, not implemented.

### Frontend status
- Coherent; all `/api/*` handlers query `getSql()` directly.
- Gap: UI bot trigger (`src/routes/api/bots/trigger.ts`) spawns `Bot/create_pr_po.py --item-code --qty ...`, which **does not exist** in this repo (real bots: `worker_pr_po.py` + `PR Approver/PR_combined.py` + `Purchase Order/PO_combined.py`, `--json` contract). Every UI RPA trigger returns "Bot script not found".
- RPA timeout hardcoded 150 s (real runs ~5 min); defaults to a **headed** browser; TCS creds visible only if the frontend process loads root `.env`.

### Backend status
- Running: PID `9240`, `0.0.0.0:8080`, startup OK after the unicode fix.
- **Seed half-completed**: `items` (5) and `machines` (3) seeded; `bots`, `slips`, `movements`, `bot_runs`, `alerts`, `audit_logs` **empty**; `meta` counters only for items/machines. `/api/bots` returns `[]`.
- `trigger_bot()` is a **simulation** (writes a fake run); it does not call the real bots.
- Same spreadsheet also carries the worker tabs (`Item data`, `Item Request`) — separate from the backend demo `items` tab.

### Contract mismatches (frontend REST vs backend REST)
1. **Key casing**: backend Pydantic models serialize snake_case (`item_id`, `cron_expr`, `reorder_level`, `days_cover`); frontend handlers expect camelCase (`itemId`, `cronExpr`, `reorderLevel`, `daysCover`).
2. **Missing backend endpoints** the frontend uses: `/api/indents`, `/api/refill`, `/api/alerts/acknowledge`.
3. **Extra backend endpoint** not in frontend: `/api/slips/group`.
4. `/api/bots` empty (seed gap) -> trigger impossible; the frontend `BOT-TCS-PR*` trigger path is stale.

---

## 7. Approved plan — backend-only fixes (pending execution)

Scope guard: `procurement-backend/**` only. No `src/**`, no worker/bot scripts, no worker sheet tabs.

1. **Seed fixup** — restructure `seed_if_empty()` so each table seeds independently; fill empty `bots` + missing `meta` counters.
2. **CamelCase API contract** — add Pydantic v2 base with camelCase aliasing (`populate_by_name=True`), route responses serialized `by_alias=True`.
3. **Enrich existing endpoints** — `/api/machines` (30-day stats + item breakdown), `/api/alerts` (enriched, `?severity=&acknowledged=&limit=` filters, POST accepts `{title, severity, message, botId, itemId}`), `/api/runs` (`?botId=`, `botCode`/`botName`).
4. **Add missing endpoints** — `GET/POST /api/indents`, `GET /api/refill`, `POST /api/alerts/acknowledge`, matching the frontend response shapes in `src/routes/api/*`.
5. **Verify** — `python -m compileall`, restart uvicorn (PID `9240`), confirm seed completes, smoke-test `/api/*` and `/docs`, assert camelCase + non-empty `/api/bots`.

---

## 8. Environment / notes

- Root `.env` holds TCS creds (user/password, login/home/manufacturing page URLs), `GOOGLE_SHEET_ID`, `GOOGLE_CREDS_FILE`, worker tab names. Values not copied here.
- `procurement-backend/.env`: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID`, `HOST`, `PORT=8080`, `DEBUG`, `SEED_ON_START`.
- Python 3.14.6; Playwright 1.61.0 (Chromium launches headless OK); gspread 6.2.1.
- Logs: `C:\Users\Admin\Desktop\logs\` (noon `worker_pr_po.log`), screenshots `logs\screenshots\`, payloads `logs\worker_payloads\`.
- Backend log files: `procurement-backend\server.out.log`, `server.err.log`.

## 9. Outstanding issues / next steps

1. **PO bot cannot log in** — TCS single-session lock persists after the PR run ("another session is active"). Fix the logout/session handling or add retry/serialization so PR and PO runs do not collide.
2. **Backend seed + camelCase + missing endpoints** — execute the approved backend-only plan (section 7).
3. **Frontend↔backend wiring** — decide later whether the app should read/write via the Google Sheets backend.
4. **Real RPA trigger from UI** — the frontend's `BOT-TCS-PR*` trigger points at a non-existent script; requires updating `rpa-runner.ts` to call the real worker contract (out of scope for the current backend-only phase).