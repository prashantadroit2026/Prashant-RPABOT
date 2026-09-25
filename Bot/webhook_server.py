#!/usr/bin/env python3
"""
Tiny FastAPI webhook that receives triggers from Google Apps Script
and starts the PR → PO bot.
"""

import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
import uvicorn

# ---------- config ----------
SCRIPT = Path(__file__).parent / "scripts" / "create_pr_po.py"   # adjust path
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")           # optional
HOST = "0.0.0.0"
PORT = int(os.environ.get("WEBHOOK_PORT", "8787"))

app = FastAPI(title="TCS PR-PO Webhook")

class TriggerPayload(BaseModel):
    request_id: str
    item_code: str
    qty: float
    uom: str = "NOS"
    site: str = ""
    vendor_code: str = ""
    transaction_date: Optional[str] = None
    sheet_row: Optional[int] = None
    source: str = "gas"

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/trigger-pr-po")
def trigger(payload: TriggerPayload, x_webhook_secret: Optional[str] = Header(None)):
    if WEBHOOK_SECRET and x_webhook_secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="invalid secret")

    if not payload.item_code or payload.qty <= 0:
        raise HTTPException(status_code=400, detail="item_code and qty required")

    cmd = [
        sys.executable,
        str(SCRIPT),
        "--item-code", payload.item_code,
        "--qty", str(int(payload.qty)),
    ]

    # Optional: pass more flags if you extend create_pr_po.py
    # if payload.vendor_code:
    #     cmd += ["--vendor", payload.vendor_code]
    # if payload.site:
    #     cmd += ["--site", payload.site]

    print(f"[webhook] starting bot for {payload.request_id} → {payload.item_code} x{payload.qty}")

    # Fire-and-forget (non-blocking). Use a real queue (RQ/Celery) later if needed.
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(SCRIPT.parent.parent),
    )

    return {
        "status": "accepted",
        "request_id": payload.request_id,
        "pid": proc.pid,
        "message": "bot started"
    }

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)