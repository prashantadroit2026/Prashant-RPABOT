# Procurement Hub Bot — Project Status & Overview

**Date:** 19 Sep 2026 · **Stage:** Integration / Stabilization · **Overall Health:** 🟡 Blocked on TCS login (end-to-end), otherwise green

| Area | Status |
|---|---|
| Frontend app (TanStack Start UI) | 🟢 Live on `:8080` ("Procurement Hub"), 200 + renders |
| Backend API (FastAPI + Google Sheets) | 🟢 Live on `:8090`, `/api/health` OK |
| Master data import (`Item data` tab) | 🟢 3,468 real rows (vendor/PM/UOM/site) loaded |
| PR automation | 🟢 Creates authenticated TCS requisitions |
| PO automation | 🔴 Blocked — TCS single-session login lock |
| Repo hygiene | 🟢 Git init, `.gitignore`, `README`, `docs/`, `data/` |

---

## How It Works

- **Source of truth = Google Sheets.** Users write requests to the `Item Request` tab (RequestID, Item Code, Qty). `worker_pr_po.py` polls the sheet, enriches rows against a real 3,468-row `Item data` catalog (SUP00606, UOM, site).
- **Worker → PR bot → PO bot.** A JSON payload is handed to `PR_combined.py` (creates the requisition on TCS, writes PR no.) then `PO_combined.py` (converts approved PR → PO, writes PO no.). Status/errors land back in the sheet.
- **Frontend = independent UI.** TanStack Start app (its own PGLite DB + REST routes: catalog, indents, refill, machines, runs, bots, slips, alerts) with a bot-trigger route that spawns the Playwright scripts.
- **Backend = Sheets-backed mirror.** FastAPI + gspread exposing the same REST surface directly over the workbook (items, machines, slips, bots, runs, alerts).
- **User journey:** request spare part → auto-vendor lookup → PR approved → PO generated on TCS → status visible in sheet + UI.

## Current Situation

- **Working:** Frontend and backend both boot and serve; real catalog imported; PR bot end-to-end on TCS (`ADPL/2627/PR/0682`); repo organized + committed (`4439a02`).
- **In progress:** Frontend bootstrap (needs Grok platform chrome `scripts/`, `server/`, `public/` restored — local stubs boot it); backend seed + API-shape parity (camelCase aliases, `/api/indents`, `/api/refill`, `/api/alerts/acknowledge`, enriched machines/alerts/runs).
- **Blockers:** ① TCS single-session lock → PO reports `login failed` ("another session is active"); ② frontend served tree (`src/src/`) is a partial duplicate missing `api/` routes + `plant-server.ts`/`bot-server.ts`; ③ nested `src/src` vs top-level `src` confusion.

## Project Stages

| # | Stage | Effort | Status |
|---|---|---|---|
| 1 | Discovery & requirements | Small | ✅ Done |
| 2 | TCS portal analysis + creds/env | Medium | ✅ Done |
| 3 | Master data extraction & import | Medium | ✅ Done |
| 4 | PR bot automation | Medium | ✅ Done |
| 5 | PO bot automation | Medium | 🔴 Blocked (login lock) |
| 6 | Sheet queue worker + status sync | Medium | ✅ Done |
| 7 | Backend API (Sheets mirror) | Medium | 🟡 Partial (seed + parity) |
| 8 | Frontend UI (Procurement Hub) | Large | 🟡 Primed, chrome missing |
| 9 | Frontend↔bot wiring (RPA trigger) | Medium | ⏳ Pending |
| 10 | Integration, QA, deployment | Medium | ⏳ Pending |

**Current position:** Stage 9 — components 1–6 done, 7/8 stabilize now, 9–10 remain.

## Development Time

- **Spent:** ~3 days of focused sessions (import + worker plumbing + PR runs + backend vac + frontend audit/org). Estimate ≈ **18–22 hrs**.
- **Remaining to 1.0:** PO unlock (~2–4h R&D), backend parity (~4–6h), frontend chrome/repair (~3–5h), wiring + QA (~3–4h). Estimate ≈ **12–19 hrs**.
- **ETA to launch:** roughly **3–5 more working days**, assuming the TCS session problem yields to a logout/retry design.