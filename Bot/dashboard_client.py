"""
Bot ↔ Dashboard bridge — tiny helper the RPA bot can import to talk to the frontend.

Usage in create_pr_po.py (or any bot):

    from dashboard_client import DashboardClient
    dash = DashboardClient("http://localhost:8080")
    slips = dash.get_pending_slips()           # GET /api/slips?status=pending
    dash.create_alert("warn", "PR created", f"PR {pr_no} for {item_code}", item_id=3)
    dash.report_run("BOT-TCS-PRPO", "success", {"pr_number": pr_no})

No auth (VITE_AUTH_ENABLED=false) — free to POST. When auth is on, set
DASHBOARD_TOKEN env and the client will send Authorization: Bearer.
"""

from __future__ import annotations

import json
import os
from typing import Any
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode


class DashboardClient:
    def __init__(self, base_url: str | None = None):
        env_url = os.environ.get("DASHBOARD_URL", "").strip()
        self.base_url = (base_url or env_url or "http://localhost:8080").rstrip("/")
        token = os.environ.get("DASHBOARD_TOKEN", "").strip() or os.environ.get("TCS_PASSWORD", "").strip()
        # Only use token if it looks like a bearer (not the TCS password)
        self.token = token if token.startswith("ey") or token.startswith("Bearer") else ""

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self.token:
            tok = self.token
            if not tok.lower().startswith("bearer "):
                tok = f"Bearer {tok}"
            h["Authorization"] = tok
        return h

    def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urlencode({k: str(v) for k, v in params.items() if v is not None})
        req = urlrequest.Request(url, headers=self._headers(), method="GET")
        try:
            with urlrequest.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else None
        except (HTTPError, URLError) as e:
            print(f"  [dashboard] GET {path} failed: {e}")
            return None

    def _post(self, path: str, data: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        payload = json.dumps(data).encode("utf-8")
        req = urlrequest.Request(url, data=payload, headers=self._headers(), method="POST")
        try:
            with urlrequest.urlopen(req, timeout=15) as resp:
                body = resp.read().decode("utf-8")
                return json.loads(body) if body else None
        except HTTPError as e:
            try:
                body = e.read().decode("utf-8")
                print(f"  [dashboard] POST {path} {e.code}: {body[:500]}")
            except Exception:
                print(f"  [dashboard] POST {path} failed: {e}")
            return None
        except URLError as e:
            print(f"  [dashboard] POST {path} failed: {e}")
            return None

    # -- Convenience wrappers -----------------------------------------------

    def get_pending_slips(self):
        """GET /api/slips?status=pending — returns list[slip] or None."""
        return self._get("/api/slips", {"status": "pending"})

    def get_catalog(self):
        """GET /api/catalog — {items:[], machines:[]}."""
        return self._get("/api/catalog")

    def get_slip_groups(self):
        """GET /api/indents — returns list of slip groups (each with .slips[])."""
        return self._get("/api/indents")

    def get_pending_groups(self):
        """Return only groups that still have at least one pending slip."""
        groups = self.get_slip_groups() or []
        return [
            g for g in groups
            if any(s.get("status") == "pending" for s in g.get("slips", []))
        ]

    def submit_indent(
        self,
        date: str,
        department: str,
        machine: str,
        cell: str,
        items: list[dict[str, Any]],
        hod_signature_confirmed: bool = True,
    ) -> Any:
        """POST /api/indents — submit a multi-item requisition indent.

        Args:
            date: Slip date as "DD-MM-YYYY" or "YYYY-MM-DD".
            department: e.g. "Maintenance"
            machine: Machine code or name, e.g. "CNC-01" or "Machine_01"
            cell: Cell / station name, e.g. "Lathe cell"
            items: List of dicts with keys "itemId" (item code str) and
                   "quantity" (int).
                   Example: [{"itemId": "CUT-118", "quantity": 6}]
            hod_signature_confirmed: Must be True (HOD authorisation gate).

        Returns:
            The created SlipGroup dict, or None on failure.

        Example::

            dash.submit_indent(
                date="10-09-2026",
                department="Maintenance",
                machine="CNC-01",
                cell="Lathe cell",
                items=[
                    {"itemId": "HYD-040", "quantity": 10},
                    {"itemId": "BRG-6205", "quantity": 4},
                ],
            )
        """
        payload: dict[str, Any] = {
            "date": date,
            "department": department,
            "machine": machine,
            "cell": cell,
            "hodSignatureConfirmed": hod_signature_confirmed,
            "items": items,
        }
        result = self._post("/api/indents", payload)
        if result and "groupToken" in result:
            n = len(result.get("slips", []))
            print(f"  [dashboard] Indent submitted: {result['groupToken']} · {n} slip(s)")
        return result

    def create_alert(self, severity: str, title: str, message: str = "", bot_code: str | None = None, item_id: int | None = None):
        """POST /api/alerts — create a dashboard alert visible on /system."""
        # Resolve bot_id from code if given
        bot_id = None
        if bot_code:
            bots = self._get("/api/bots")
            if isinstance(bots, list):
                for b in bots:
                    if b.get("code") == bot_code:
                        bot_id = b.get("id")
                        break
        return self._post("/api/alerts", {"severity": severity, "title": title, "message": message, "botId": bot_id, "itemId": item_id})

    def report_run(self, bot_code: str, status: str, output: dict[str, Any] | None = None, error: str | None = None):
        """Best-effort: create an alert summarising a run (since bot_runs is written by the dashboard)."""
        title = f"{bot_code} {status}"
        msg = json.dumps(output)[:400] if output else (error or "")
        sev = "critical" if status == "failed" else "info"
        return self.create_alert(sev, title, msg, bot_code=bot_code)

    def health(self):
        return self._get("/api/health")


if __name__ == "__main__":
    c = DashboardClient()
    print("health:", c.health())
    catalog = c.get_catalog() or {}
    print("catalog items:", len(catalog.get("items", [])))
    print("pending slips:", len(c.get_pending_slips() or []))
    groups = c.get_slip_groups() or []
    print("slip groups:", len(groups))
    # Example indent submission (commented out — uncomment to test):
    # result = c.submit_indent(
    #     date="10-09-2026",
    #     department="Maintenance",
    #     machine="CNC-01",
    #     cell="Lathe cell",
    #     items=[{"itemId": "HYD-040", "quantity": 10}],
    # )
    # print("submitted:", result)
