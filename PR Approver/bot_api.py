#!/usr/bin/env python3
"""
TCS PR/PO bot API - REST webhooks for PR generation and PO creation.

Endpoints:
  POST /api/pr/create   {itemCode, itemQuantity, site, date, vendorCode}
                        -> runs the PR bot, returns the generated PR number,
                           and hands it to the PO/PR Approval bot
                           (po_jobs queue + Procurement-to-Purchase approval email).
  POST /api/po/create   {prNumber, vendorCode}
                        -> runs the PO bot from that PR, returns PO details.
  GET  /api/health      -> liveness / config summary.

Run:
  python PR_combined.py requires TCS_USERNAME/TCS_PASSWORD (loaded from .env).
  python -m uvicorn bot_api:app --host 127.0.0.1 --port 8000
  (or:  python bot_api.py --host 127.0.0.1 --port 8000)

Security: if BOT_WEBHOOK_KEY / FORM_WEBHOOK_KEY is set, the caller must pass
it in the `X-Webhook-Key` header.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
LOG_DIR = PROJECT_DIR / "logs"
PO_JOBS_FILE = LOG_DIR / "po_jobs.jsonl"
API_LOG = LOG_DIR / "bot_api.log"

for _p in (str(SCRIPT_DIR), str(PROJECT_DIR), str(SCRIPT_DIR.parent.parent)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


def _load_env(path: str = ".env") -> None:
    env_file = Path(path)
    if not env_file.is_absolute():
        for base in (PROJECT_DIR, SCRIPT_DIR):
            candidate = base / env_file
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


# ---------------------------------------------------------------------------
# Bot subprocess contract (same as worker_pr_po.py)
# ---------------------------------------------------------------------------

PR_BOT = os.getenv("PR_BOT_PATH") or str(SCRIPT_DIR / "PR_combined.py")
PO_BOT = os.getenv("PO_BOT_PATH") or str(PROJECT_DIR / "Purchase Order" / "PO_combined.py")
TIMEOUT_MS = int(os.getenv("BOT_TIMEOUT_MS", "420000"))
API_KEY = os.getenv("BOT_WEBHOOK_KEY", os.getenv("FORM_WEBHOOK_KEY", "")).strip()


def _log(msg: str) -> None:
    line = f"[bot_api {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(API_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _run_bot(script: Path, payload: dict) -> dict:
    """Run a bot script (PR_combined/PO_combined) with a JSON payload file and
    parse the last JSON stdout line (the bots' machine-readable contract)."""
    payload_dir = Path(os.getenv("WORKER_TMP_DIR", str(LOG_DIR / "payloads")))
    payload_dir.mkdir(parents=True, exist_ok=True)
    rid = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("requestId") or payload.get("prNumber") or "noop"))
    payload_file = payload_dir / f"{rid}_{script.stem}_{int(time.time())}.json"
    payload_file.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    cmd = [sys.executable, str(script), "--json", str(payload_file)]
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
    for line in reversed([l for l in out.splitlines() if l.strip()]):
        try:
            return json.loads(line)
        except Exception:
            continue
    tail = " | ".join(out.splitlines()[-3:])
    return {
        "ok": False,
        "error": f"bot JSON output not found (exit={proc.returncode}). tail: {tail}",
    }


def _append_po_job(pr_no: str, ctx: dict) -> None:
    """Queue the PR number for the PO bot (persisted log the worker/PO bot can consume)."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        record = {
            "timestamp": datetime.now().isoformat(),
            "action": "create_po",
            "prNumber": pr_no,
            "vendorCode": ctx.get("vendorCode", ""),
            "itemCode": ctx.get("itemCode", ""),
            "qty": ctx.get("itemQuantity", ""),
            "site": ctx.get("site", ""),
            "uom": ctx.get("uom", ""),
            "requestId": ctx.get("requestId", ""),
            "date": ctx.get("date", ""),
            "status": "pending",
        }
        with open(PO_JOBS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        _log(f"PO bot queued: PR {pr_no} -> {PO_JOBS_FILE}")
    except Exception as exc:
        _log(f"PO job queue write failed: {exc}")


def _resolve_po_job(pr_no: str) -> dict:
    """Find the last queued PO job for a PR number (item/qty/site lookups)."""
    if not PO_JOBS_FILE.is_file():
        return {}
    try:
        for raw in reversed(PO_JOBS_FILE.read_text(encoding="utf-8").splitlines()):
            if not raw.strip():
                continue
            rec = json.loads(raw)
            if str(rec.get("prNumber") or "").strip() == str(pr_no).strip():
                return rec
    except Exception:
        pass
    return {}


def _send_approval_email(pr_no: str, ctx: dict) -> dict:
    """Best-effort 'Procurement to Purchase' approval email for the PR
    (the PR approval bot). Never raises; gated by SMTP config in .env."""
    if os.getenv("SEND_APPROVAL_EMAIL", "1").strip().lower() in ("0", "false", "no"):
        return {"sent": 0, "error": "SEND_APPROVAL_EMAIL disabled"}
    try:
        import email_approver as ea
    except Exception as exc:
        return {"sent": 0, "error": f"email_approver import failed: {exc}"}
    data = {
        "description": ctx.get("itemDescription") or ctx.get("itemCode", ""),
        "transaction_date": ctx.get("date") or datetime.now().strftime("%d/%m/%Y"),
        "site": ctx.get("site", ""),
        "party_code": ctx.get("vendorCode", ""),
        "status": "Approved",
        "items": [{
            "item_code": ctx.get("itemCode", ""),
            "item_desc": ctx.get("itemDescription") or ctx.get("itemCode", ""),
            "qty": ctx.get("itemQuantity", ""),
            "uom": ctx.get("uom", "NOS"),
        }],
    }
    try:
        return ea.send_procurement_to_purchase_email(pr_no, data)
    except Exception as exc:
        _log(f"approval email failed: {exc}")
        return {"sent": 0, "error": str(exc)}


def _norm_qty(value) -> str:
    try:
        f = float(str(value or 1))
        return str(int(f)) if f.is_integer() else str(f)
    except ValueError:
        return str(value or 1)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

try:
    from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
except ImportError:
    raise SystemExit("Missing FastAPI - pip install fastapi uvicorn")

app = FastAPI(title="TCS PR/PO Bot API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _verify_key(x_webhook_key) -> None:
    if not API_KEY:
        return
    if (x_webhook_key or "") != API_KEY:
        raise HTTPException(status_code=401, detail="invalid webhook key")


@app.get("/api/health")
def api_health():
    return {
        "ok": True,
        "pr_bot": str(PR_BOT),
        "po_bot": str(PO_BOT),
        "po_jobs": str(PO_JOBS_FILE),
        "tcs_user": bool(os.getenv("TCS_USERNAME")),
        "webhook_key_set": bool(API_KEY),
    }


@app.post("/api/pr/create")
def api_create_pr(payload: dict, background_tasks: BackgroundTasks,
                  x_webhook_key: str = Header(None)):
    """PR generation endpoint.

    JSON body: itemCode (required), itemQuantity (required), site, date,
    vendorCode, uom, requestId. Returns the PR number and hands it to the
    PO/PR Approval bot (po_jobs queue + best-effort approval email)."""
    _verify_key(x_webhook_key)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")

    item_code = str(payload.get("itemCode") or payload.get("item_code") or "").strip()
    item_qty = _norm_qty(
        payload.get("itemQuantity")
        or payload.get("item_quantity")
        or payload.get("quantity")
        or payload.get("qty")
        or ""
    )
    vendor_code = str(payload.get("vendorCode") or payload.get("vendor_code") or "").strip()
    site = str(payload.get("site") or "").strip()
    date_val = str(
        payload.get("date")
        or payload.get("transactionDate")
        or payload.get("transaction_date")
        or ""
    ).strip()
    uom = str(payload.get("uom") or "").strip()
    request_id = str(payload.get("requestId") or payload.get("request_id") or "").strip()

    if not item_code:
        raise HTTPException(status_code=400, detail="itemCode is required")
    qty_provided = any(
        payload.get(k) is not None and str(payload.get(k, "")).strip() != ""
        for k in ("itemQuantity", "item_quantity", "quantity", "qty")
    )
    if not qty_provided:
        raise HTTPException(status_code=400, detail="itemQuantity is required")

    ctx = {
        "itemCode": item_code,
        "itemQuantity": item_qty,
        "vendorCode": vendor_code,
        "site": site,
        "date": date_val,
        "uom": uom,
        "requestId": request_id,
        "itemDescription": payload.get("itemDescription") or payload.get("itemDesc") or payload.get("description") or "",
    }

    bot_payload = {
        "action": "create_pr",
        "itemCode": item_code,
        "itemQuantity": item_qty,
        "vendorCode": vendor_code,
        "site": site,
        "date": date_val,
        "uom": uom,
        "requestId": request_id,
    }
    res = _run_bot(Path(PR_BOT), bot_payload)
    if not res.get("ok"):
        _log(f"PR bot failed: {res.get('error')}")
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "action": "create_pr",
                "prNumber": None,
                "error": res.get("error"),
            },
        )

    pr_no = str(res.get("prNumber") or "").strip()
    if not pr_no:
        return JSONResponse(
            status_code=502,
            content={"ok": False, "action": "create_pr", "prNumber": None,
                     "error": "PR bot succeeded but returned no prNumber"},
        )

    background_tasks.add_task(_append_po_job, pr_no, ctx)
    background_tasks.add_task(_send_approval_email, pr_no, ctx)

    return {
        "ok": True,
        "action": "create_pr",
        "prNumber": pr_no,
        "status": res.get("status") or "created",
        "itemCode": item_code,
        "itemQuantity": item_qty,
        "vendorCode": vendor_code,
        "site": site,
        "date": res.get("transactionDate") or date_val,
        "requestId": request_id,
        "sentTo": {"po_bot": str(PO_JOBS_FILE), "pr_approval_bot": "email (background)"},
    }


@app.post("/api/pr/notify")
def api_notify_pr(payload: dict, x_webhook_key: str = Header(None)):
    """Send the 'Procurement → Purchase' approval email for a PR.

    JSON body: prNumber/requisitionId (required), plus optional itemCode,
    itemQuantity, vendorCode, site, date, uom, itemDescription.
    Returns the SMTP send result."""
    _verify_key(x_webhook_key)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")

    pr_no = str(
        payload.get("prNumber")
        or payload.get("pr_number")
        or payload.get("requisitionId")
        or payload.get("requisition_id")
        or ""
    ).strip()
    if not pr_no:
        raise HTTPException(status_code=400, detail="prNumber is required")

    ctx = {
        "itemCode": str(payload.get("itemCode") or payload.get("item_code") or "").strip(),
        "itemQuantity": _norm_qty(
            payload.get("itemQuantity")
            or payload.get("qty")
            or payload.get("quantity")
            or ""
        ),
        "vendorCode": str(payload.get("vendorCode") or payload.get("vendor_code") or "").strip(),
        "site": str(payload.get("site") or "").strip(),
        "date": str(payload.get("date") or "").strip(),
        "uom": str(payload.get("uom") or "").strip(),
        "itemDescription": payload.get("itemDescription")
        or payload.get("itemDesc")
        or payload.get("description")
        or "",
    }
    res = _send_approval_email(pr_no, ctx)
    return {
        "ok": bool(res.get("sent")),
        "action": "notify_approver",
        "prNumber": pr_no,
        "sent": res.get("sent", 0),
        "to": res.get("to", []),
        "error": res.get("error"),
    }


@app.post("/api/po/create")
def api_create_po(payload: dict, background_tasks: BackgroundTasks,
                  x_webhook_key: str = Header(None)):
    """PO creation endpoint.

    JSON body: prNumber (required), vendorCode (required), plus optional
    itemCode/qty/site/uom/requestId overrides. Item lookup is resolved from
    the PR job queued by the PR endpoint when not supplied."""
    _verify_key(x_webhook_key)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")

    pr_no = str(payload.get("prNumber") or payload.get("pr_number") or "").strip()
    vendor_code = str(payload.get("vendorCode") or payload.get("vendor_code") or "").strip()
    request_id = str(payload.get("requestId") or payload.get("request_id") or "").strip()

    if not pr_no:
        raise HTTPException(status_code=400, detail="prNumber is required")
    if not vendor_code:
        raise HTTPException(status_code=400, detail="vendorCode is required")

    job = _resolve_po_job(pr_no)
    item_code = str(payload.get("itemCode") or payload.get("item_code") or job.get("itemCode") or "").strip()
    item_qty = _norm_qty(
        payload.get("itemQuantity")
        or payload.get("qty")
        or payload.get("quantity")
        or job.get("itemQuantity")
        or job.get("qty")
        or ""
    )
    site = str(payload.get("site") or job.get("site") or "").strip()
    uom = str(payload.get("uom") or job.get("uom") or "").strip()

    if not item_code:
        raise HTTPException(
            status_code=400,
            detail=(
                "itemCode required for PO creation (and no matching PR job was "
                "found in the queue to resolve it)"
            ),
        )

    bot_payload = {
        "action": "create_po",
        "prNumber": pr_no,
        "vendorCode": vendor_code,
        "itemCode": item_code,
        "qty": item_qty,
        "uom": uom,
        "site": site,
        "requestId": request_id,
    }
    res = _run_bot(Path(PO_BOT), bot_payload)
    if not res.get("ok"):
        _log(f"PO bot failed: {res.get('error')}")
        return JSONResponse(
            status_code=502,
            content={
                "ok": False,
                "action": "create_po",
                "prNumber": pr_no,
                "poNumber": None,
                "error": res.get("error"),
            },
        )

    po_no = str(res.get("poNumber") or "").strip()
    return {
        "ok": True,
        "action": "create_po",
        "poNumber": po_no or None,
        "prNumber": pr_no,
        "vendorCode": vendor_code,
        "itemCode": item_code,
        "itemQuantity": item_qty,
        "site": site,
        "status": res.get("status") or ("created" if po_no else "submitted"),
        "requestId": request_id,
        "details": {
            "prNumber": pr_no,
            "vendorCode": vendor_code,
            "itemCode": item_code,
            "itemQuantity": item_qty,
            "uom": uom,
            "site": site,
        },
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TCS PR/PO Bot API")
    parser.add_argument("--host", default=os.getenv("API_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("API_PORT", "8000")))
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()
    import uvicorn
    uvicorn.run("bot_api:app", host=args.host, port=args.port, reload=args.reload)