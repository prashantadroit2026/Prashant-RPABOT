#!/usr/bin/env python3
"""
worker_pr_po.py — Item Request (Google Sheet) queue -> PR bot -> PO bot -> write-back.

Expected columns on the "Item Request" tab (exact names; order does not matter):
  RequestID | Item Code | Vendor Code | Item Quantity | UOM | Site |
  TCS Status | TCS Requisition No | TCS PO No | TCS Error | TCS Updated At

Flow per pending row:
  pending -> processing -> pr_done -> po_done      (terminal success)
                             -> failed             (any PR or PO failure, error in TCS Error)

The worker never reads TCS on its own. It spawns the bots as subprocesses and
parses the JSON on the last stdout line of each bot:

  python Requisition/PR_combined.py --json <file>
  python Purchase Order/PO_combined.py --json <file>

Env config (same vars already used by the bots):
  GOOGLE_SHEET_ID          Google Sheet id or URL
  GOOGLE_CREDS_FILE        service account json (default: ./credentials/service_account.json)
  ITEM_REQUEST_TAB         default "Item Request"
  ITEM_DATA_TAB            default "Item data"   (master: Item Code + Party Code for lookup)
  PR_BOT_PATH / PO_BOT_PATH    override bot script paths
  PYTHON_BIN               default: python
  BOT_TIMEOUT_MS           default 420000 (7 min per bot run)
  RETRY_FAILED             "1" to also pick up rows stuck on failed

Usage:
  python worker_pr_po.py            # run once
  python worker_pr_po.py --loop 60  # poll the queue every 60s
  python worker_pr_po.py --dry-run  # only report pending rows, touch nothing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
LOG_DIR = PROJECT_DIR / "logs"
WORKER_LOG = LOG_DIR / "worker_pr_po.log"


def _load_env(path: str = ".env") -> None:
    """Load repo-root .env before reading config (mirrors requisition.py)."""
    env_file = Path(path)
    for base in (PROJECT_DIR, Path.cwd()):
        candidate = (base if base.is_dir() else Path.cwd()) / env_file
        if candidate.exists():
            env_file = candidate
            break
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env()

HDR_REQUEST_ID = "RequestID"
HDR_ITEM_CODE = "Item Code"
HDR_VENDOR_CODE = "Vendor Code"
HDR_QTY = "Item Quantity"
HDR_UOM = "UOM"
HDR_SITE = "Site"
HDR_STATUS = "TCS Status"
HDR_PR = "TCS Requisition No"
HDR_PO = "TCS PO No"
HDR_ERROR = "TCS Error"
HDR_UPDATED = "TCS Updated At"

DESIRED_HEADERS = [
    HDR_REQUEST_ID,
    HDR_ITEM_CODE,
    HDR_VENDOR_CODE,
    HDR_QTY,
    HDR_UOM,
    HDR_SITE,
    HDR_STATUS,
    HDR_PR,
    HDR_PO,
    HDR_ERROR,
    HDR_UPDATED,
]

PENDING_STATUSES = {"", "pending", "queued", "null", "none"}

TIMEOUT_MS = int(os.getenv("BOT_TIMEOUT_MS", "420000"))


def _log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[worker_pr_po {ts}] {msg}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(WORKER_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Sheets helpers (same pattern as PR_combined.py's TCS worker)
# ---------------------------------------------------------------------------

def _sheet_client():
    try:
        from google.oauth2.service_account import Credentials
        import gspread
    except ImportError as e:
        _log(f"missing deps: {e} — pip install gspread google-auth")
        return None, None

    creds_file = os.getenv(
        "GOOGLE_CREDS_FILE",
        str(PROJECT_DIR / "credentials" / "service_account.json"),
    )
    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not sheet_id:
        _log("ERROR: GOOGLE_SHEET_ID empty")
        return None, None
    creds_path = Path(creds_file)
    if not creds_path.is_absolute():
        creds_path = PROJECT_DIR / creds_path
    if not creds_path.is_file():
        _log(f"ERROR: service account {creds_path} missing")
        return None, None
    try:
        creds = Credentials.from_service_account_file(
            str(creds_path),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        client = gspread.authorize(creds)
        sh = client.open_by_url(sheet_id) if sheet_id.startswith("http") else client.open_by_key(sheet_id)
        return client, sh
    except Exception as e:
        _log(f"sheet auth failed: {e}")
        return None, None


def _ensure_columns(ws) -> dict:
    headers = ws.row_values(1)
    existing = {str(h).strip() for h in headers if str(h).strip()}
    missing = [c for c in DESIRED_HEADERS if c not in existing]
    for i, col_name in enumerate(missing):
        ws.update_cell(1, len(headers) + i + 1, col_name)
        time.sleep(0.25)
    headers = ws.row_values(1)
    return {
        str(h).strip().lower(): idx
        for idx, h in enumerate(headers)
        if str(h).strip()
    }


def _write(ws, row_idx: int, cmap: dict, now: str, *, status=None, pr_no=None, po_no=None, error=None, vendor=None) -> None:
    def _set(hdr: str, val) -> None:
        key = hdr.lower()
        if key in cmap:
            ws.update_cell(row_idx, cmap[key] + 1, val)
            time.sleep(0.2)

    if vendor is not None:
        _set(HDR_VENDOR_CODE, vendor)
    if status is not None:
        _set(HDR_STATUS, status)
    if pr_no is not None:
        _set(HDR_PR, pr_no)
    if po_no is not None:
        _set(HDR_PO, po_no)
    if error is not None:
        _set(HDR_ERROR, str(error)[:500] if error else "")
    _set(HDR_UPDATED, now)


def _read_candidates(ws, cmap: dict) -> list[dict]:
    values = ws.get_all_values()
    if len(values) < 2:
        return []

    def _cell(cmap, row, hdr):
        idx = cmap.get(hdr.lower())
        if idx is None or idx >= len(row):
            return ""
        return str(row[idx]).strip()

    retry_failed = os.getenv("RETRY_FAILED", "").strip().lower() in ("1", "true", "yes")
    rows = []
    for idx, row in enumerate(values[1:], start=2):
        rid = _cell(cmap, row, HDR_REQUEST_ID)
        item = _cell(cmap, row, HDR_ITEM_CODE)
        if not rid or not item:
            continue
        st = _cell(cmap, row, HDR_STATUS).lower()
        if st not in PENDING_STATUSES and not (retry_failed and st == "failed"):
            continue
        rows.append({
            "row": idx,
            "request_id": rid,
            "item_code": item,
            "qty": _cell(cmap, row, HDR_QTY) or "1",
            "vendor": _cell(cmap, row, HDR_VENDOR_CODE),
            "uom": _cell(cmap, row, HDR_UOM),
            "site": _cell(cmap, row, HDR_SITE),
        })
    return rows


def _lookup_item(sh, item_code: str) -> dict:
    """Read-only lookup into Item data by Item Code (Party Code for the vendor)."""
    tab = os.getenv("ITEM_DATA_TAB", "Item data")
    try:
        ws = sh.worksheet(tab)
        vals = ws.get_all_values()
    except Exception:
        return {}
    if not vals:
        return {}
    hmap = {
        str(x).strip().lower(): i
        for i, x in enumerate(vals[0])
        if str(x).strip()
    }
    ic = hmap.get("item code")
    if ic is None:
        return {}
    want = str(item_code).strip().upper()
    for row in vals[1:]:
        if ic >= len(row):
            continue
        if str(row[ic]).strip().upper() != want:
            continue
        out = {}
        for key, hdr in (
            ("vendor", "party code"),
            ("uom", "uom"),
            ("uom", "base uom"),
            ("site", "site"),
        ):
            col = hmap.get(hdr)
            if col is not None and col < len(row):
                out[key] = str(row[col]).strip()
        return out
    return {}


# ---------------------------------------------------------------------------
# Bot invocation (JSON in -> last-stdout-line JSON out)
# ---------------------------------------------------------------------------

def _bot_path(env_name: str, default_rel: str, *fallbacks: str) -> Path:
    p = os.getenv(env_name)
    if p:
        path = Path(p)
        return path if path.is_absolute() else PROJECT_DIR / path
    for rel in (default_rel, *fallbacks):
        cand = PROJECT_DIR / rel
        if cand.is_file():
            return cand
    return PROJECT_DIR / default_rel


def _run_bot(script: Path, payload: dict) -> dict:
    payload_dir = Path(os.getenv("WORKER_TMP_DIR", str(LOG_DIR / "worker_payloads")))
    payload_dir.mkdir(parents=True, exist_ok=True)
    rid = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("requestId") or "noop"))
    payload_file = payload_dir / f"{rid}_{script.stem}_{int(time.time())}.json"
    payload_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    python_bin = os.getenv("PYTHON_BIN") or sys.executable
    cmd = [python_bin, str(script), "--json", str(payload_file)]
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}

    _log(f"  running: {' '.join(cmd)}")
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_MS / 1000.0,
            env=env,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"bot timed out after {TIMEOUT_MS}ms"}

    out = (proc.stdout or "") + "\n" + (proc.stderr or "")
    for ln in reversed([l for l in out.splitlines() if l.strip()]):
        try:
            return json.loads(ln)
        except Exception:
            continue
    tail = " | ".join(out.splitlines()[-3:])
    return {
        "ok": False,
        "error": f"bot JSON output not found (exit={proc.returncode}). tail: {tail}",
    }


# ---------------------------------------------------------------------------
# Row processing
# ---------------------------------------------------------------------------

def _process(sh, ws, cmap: dict, rec: dict) -> bool:
    rid = rec["request_id"]
    item = rec["item_code"]
    qty = rec["qty"]
    vendor = rec["vendor"]
    site = rec["site"]
    uom = rec["uom"]
    now = datetime.now().isoformat()
    _log(f"[{rid}] starting {item} qty={qty}")

    # 1. claim + resolve vendor from Item data if missing
    if not vendor:
        look = _lookup_item(sh, item)
        vendor = look.get("vendor") or ""
        site = site or look.get("site") or ""
        uom = uom or look.get("uom") or ""
        if vendor:
            _log(f"[{rid}] vendor {vendor} resolved from Item data")
    if not vendor:
        _write(ws, rec["row"], cmap, now, status="failed", error="Vendor Code missing and Item data lookup returned none")
        return False

    _write(ws, rec["row"], cmap, now, status="processing", error="", vendor=vendor)

    # 2. PR
    pr_payload = {
        "action": "create_pr",
        "itemCode": item,
        "qty": qty,
        "vendorCode": vendor,
        "requestId": rid,
        "site": site,
        "uom": uom,
    }
    pr_res = _run_bot(
        _bot_path("PR_BOT_PATH", "Requisition/PR_combined.py", "PR Approver/PR_combined.py"),
        pr_payload,
    )
    if not pr_res.get("ok"):
        _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="failed", error=pr_res.get("error") or "PR bot failed")
        return False
    pr_no = str(pr_res.get("prNumber") or "").strip()
    if not pr_no:
        _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="failed", error="PR bot ok but no prNumber in output")
        return False
    _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="pr_done", pr_no=pr_no)
    _log(f"[{rid}] PR {pr_no} done")

    # 3. PO
    po_payload = {
        "action": "create_po",
        "prNumber": pr_no,
        "vendorCode": vendor,
        "itemCode": item,
        "qty": qty,
        "requestId": rid,
    }
    po_res = _run_bot(_bot_path("PO_BOT_PATH", "Purchase Order/PO_combined.py"), po_payload)
    if not po_res.get("ok"):
        _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="failed", error=po_res.get("error") or "PO bot failed")
        return False
    po_no = str(po_res.get("poNumber") or "").strip()
    if not po_no:
        _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="failed", error="PO bot ok but no poNumber in output")
        return False
    _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="po_done", po_no=po_no)
    _log(f"[{rid}] PO {po_no} done — finished")
    return True


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run_once(dry_run: bool = False) -> list:
    client, sh = _sheet_client()
    if not sh:
        return []
    try:
        ws = sh.worksheet(os.getenv("ITEM_REQUEST_TAB", "Item Request"))
    except Exception as e:
        _log(f"ERROR: Item Request tab unavailable: {e}")
        return []
    cmap = _ensure_columns(ws)
    candidates = _read_candidates(ws, cmap)
    if not candidates:
        _log("no pending rows")
        return []
    _log(f"pending rows: {[c['request_id'] for c in candidates]}")
    if dry_run:
        for c in candidates:
            _log(f"[dry-run] would process {c['request_id']} item {c['item_code']} qty {c['qty']}")
        return candidates

    results = []
    for rec in candidates:
        try:
            ok = _process(sh, ws, cmap, rec)
            results.append({"request_id": rec["request_id"], "ok": ok})
        except Exception:
            err = traceback.format_exc(limit=3)
            _log(f"[{rec['request_id']}] crashed: {err}")
            _write(ws, rec["row"], cmap, datetime.now().isoformat(), status="failed", error="worker exception")
            results.append({"request_id": rec["request_id"], "ok": False, "error": "worker exception"})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Item Request -> PR -> PO worker")
    parser.add_argument("--loop", type=int, default=0, help="Poll interval in seconds (0 = run once)")
    parser.add_argument("--dry-run", action="store_true", help="Only report pending rows")
    args = parser.parse_args()

    if args.dry_run:
        run_once(dry_run=True)
        return 0
    if args.loop <= 0:
        res = run_once(dry_run=False)
        _log(f"run once done: {res}")
        return 0

    _log(f"polling every {args.loop}s (Ctrl+C to stop)")
    while True:
        try:
            run_once(dry_run=False)
        except KeyboardInterrupt:
            _log("interrupted — exiting")
            break
        except Exception:
            _log("loop error:")
            traceback.print_exc()
        time.sleep(args.loop)
    return 0


if __name__ == "__main__":
    sys.exit(main())