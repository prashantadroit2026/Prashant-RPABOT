"""Business logic on top of Google Sheets."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sheets import client as sc
from sheets.models import (
    Alert,
    AlertCreate,
    Bot,
    BotRun,
    BotTrigger,
    Catalog,
    InventoryRow,
    Item,
    Machine,
    Slip,
    SlipCreate,
    SlipDecide,
    SlipGroupCreate,
    SlipReceive,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# ------------------------------------------------------------------
# Catalog
# ------------------------------------------------------------------
def list_items() -> list[Item]:
    rows = sc.get_all_records("items")
    return [Item(**_clean(r)) for r in rows]


def list_machines() -> list[Machine]:
    rows = sc.get_all_records("machines")
    return [Machine(**_clean(r)) for r in rows]


def get_catalog() -> Catalog:
    return Catalog(items=list_items(), machines=list_machines())


def get_item_by_code(code: str) -> Optional[Item]:
    for i in list_items():
        if i.code == code:
            return i
    return None


def get_item(id_: int) -> Optional[Item]:
    found = sc.find_row_by_id("items", id_)
    if not found:
        return None
    return Item(**_clean(found[1]))


def update_item_qty(item_id: int, delta: int) -> Item:
    found = sc.find_row_by_id("items", item_id)
    if not found:
        raise ValueError(f"Item {item_id} not found")
    row_idx, rec = found
    new_qty = max(0, int(rec.get("qty") or 0) + delta)
    rec["qty"] = new_qty
    values = _item_to_row(rec)
    sc.update_row("items", row_idx, values)
    return Item(**_clean(rec))


# ------------------------------------------------------------------
# Slips
# ------------------------------------------------------------------
def list_slips(status: Optional[str] = None) -> list[Slip]:
    rows = sc.get_all_records("slips")
    items = {i.id: i for i in list_items()}
    result = []
    for r in rows:
        s = Slip(**_clean(r))
        item = items.get(s.item_id)
        if item:
            s.on_hand = item.qty
            s.reorder_level = item.reorder_level
        if status is None or s.status == status:
            result.append(s)
    # newest first
    result.sort(key=lambda x: x.id, reverse=True)
    return result


def create_slip(payload: SlipCreate) -> Slip:
    items = list_items()
    machines = list_machines()

    item: Optional[Item] = None
    if payload.item_id:
        item = next((i for i in items if i.id == payload.item_id), None)
    elif payload.item_code:
        item = next((i for i in items if i.code == payload.item_code), None)
    if not item:
        raise ValueError("Item not found")

    machine: Optional[Machine] = None
    if payload.machine_id:
        machine = next((m for m in machines if m.id == payload.machine_id), None)
    elif payload.machine:
        machine = next((m for m in machines if m.code == payload.machine), None)

    new_id = sc.next_id("slips")
    token = f"SLIP-{_today()[2:7].replace('-', '')}-{new_id:04d}"
    slip_date = payload.slip_date or _today()

    row = {
        "id": new_id,
        "token": token,
        "group_token": "",
        "group_id": "",
        "item_id": item.id,
        "item_code": item.code,
        "item_name": item.name,
        "machine_id": machine.id if machine else "",
        "machine_code": machine.code if machine else (payload.machine or ""),
        "machine_name": machine.name if machine else "",
        "qty": payload.qty,
        "issued_qty": 0,
        "uom": item.uom,
        "department": payload.department,
        "station": payload.station,
        "cell": payload.cell,
        "hod_title": payload.hod_title or f"{payload.department} HOD",
        "hod_confirmed": str(payload.hod_confirmed).lower(),
        "slip_date": slip_date,
        "status": "pending",
        "note": payload.note or "",
        "description": payload.description or "",
        "created_at": _now(),
        "decided_at": "",
    }
    sc.append_row("slips", _slip_to_row(row))
    s = Slip(**_clean(row))
    s.on_hand = item.qty
    s.reorder_level = item.reorder_level
    return s


def _resolve_item(ref: Any) -> Optional[Item]:
    """Look up an item by id or by code (group payloads may send either)."""
    if ref is None:
        return None
    key = str(ref).strip()
    if not key:
        return None
    for i in list_items():
        if i.code == key or str(i.id) == key:
            return i
    return None


def create_slip_group(payload: SlipGroupCreate) -> dict[str, Any]:
    """Create multiple slips under one group token."""
    group_id = sc.next_id("slips")  # reuse counter for simplicity
    group_token = f"GRP-{_today()[2:7].replace('-', '')}-{group_id:04d}"
    created = []
    for it in payload.items:
        ref = it.get("itemId") or it.get("item_id") or it.get("item_code")
        item = _resolve_item(ref)
        if not item:
            raise ValueError(f"Item not found for group line: {ref}")
        slip = create_slip(
            SlipCreate(
                item_id=item.id,
                qty=int(it.get("quantity") or it.get("qty") or 1),
                department=payload.department,
                machine=payload.machine,
                cell=payload.cell,
                hod_confirmed=payload.hod_signature_confirmed,
                slip_date=payload.date,
                description=it.get("description"),
            )
        )
        # patch group info
        found = sc.find_row_by_id("slips", slip.id)
        if found:
            row_idx, rec = found
            rec["group_token"] = group_token
            rec["group_id"] = group_id
            sc.update_row("slips", row_idx, _slip_to_row(rec))
            slip.group_token = group_token
            slip.group_id = group_id
        created.append(slip)
    return {"groupToken": group_token, "groupId": group_id, "slips": created}


def decide_slip(payload: SlipDecide) -> Slip:
    found = sc.find_row_by_id("slips", payload.id)
    if not found:
        raise ValueError(f"Slip {payload.id} not found")
    row_idx, rec = found
    if rec.get("status") != "pending":
        raise ValueError("Slip is not pending")

    item_id = int(rec["item_id"])
    qty = int(rec["qty"])
    item = get_item(item_id)
    if not item:
        raise ValueError("Item missing")

    on_hand = item.qty
    issued = 0
    status = "pending"

    if payload.mode == "reject":
        status = "rejected"
    elif payload.mode == "stock":
        if on_hand < qty:
            raise ValueError("Not enough stock for full issue")
        issued = qty
        status = "issued"
        update_item_qty(item_id, -qty)
        _add_movement(item_id, int(rec.get("machine_id") or 0) or None, payload.id, -qty, "issue")
    elif payload.mode == "split":
        can = min(on_hand, qty)
        if can <= 0:
            status = "pr_open"
        else:
            issued = can
            status = "partial" if can < qty else "issued"
            update_item_qty(item_id, -can)
            _add_movement(item_id, int(rec.get("machine_id") or 0) or None, payload.id, -can, "issue")
    elif payload.mode == "pr":
        status = "pr_open"

    rec["issued_qty"] = issued
    rec["status"] = status
    rec["decided_at"] = _now()
    sc.update_row("slips", row_idx, _slip_to_row(rec))

    s = Slip(**_clean(rec))
    s.on_hand = get_item(item_id).qty if get_item(item_id) else on_hand
    s.reorder_level = item.reorder_level
    return s


def receive_slip(payload: SlipReceive) -> Slip:
    found = sc.find_row_by_id("slips", payload.id)
    if not found:
        raise ValueError(f"Slip {payload.id} not found")
    row_idx, rec = found
    if rec.get("status") not in ("pr_open", "partial"):
        raise ValueError("Slip is not awaiting receipt")

    remaining = int(rec["qty"]) - int(rec.get("issued_qty") or 0)
    item_id = int(rec["item_id"])
    update_item_qty(item_id, remaining)
    _add_movement(item_id, int(rec.get("machine_id") or 0) or None, payload.id, remaining, "receive")

    rec["issued_qty"] = int(rec["qty"])
    rec["status"] = "received"
    rec["decided_at"] = _now()
    sc.update_row("slips", row_idx, _slip_to_row(rec))

    s = Slip(**_clean(rec))
    item = get_item(item_id)
    s.on_hand = item.qty if item else 0
    s.reorder_level = item.reorder_level if item else 0
    return s


# ------------------------------------------------------------------
# Inventory helpers
# ------------------------------------------------------------------
def get_inventory() -> list[InventoryRow]:
    items = list_items()
    movements = sc.get_all_records("movements")
    now = datetime.now(timezone.utc)
    result = []
    for it in items:
        consumed30 = 0
        for m in movements:
            if str(m.get("item_id")) != str(it.id):
                continue
            if m.get("kind") != "issue":
                continue
            try:
                created = datetime.fromisoformat(str(m.get("created_at")).replace("Z", "+00:00"))
                if (now - created).days <= 30:
                    consumed30 += abs(int(m.get("qty") or 0))
            except Exception:
                pass

        status: str = "in"
        if it.qty <= 0:
            status = "out"
        elif it.qty <= it.reorder_level:
            status = "low"

        days_cover = None
        if consumed30 > 0:
            days_cover = int(it.qty / (consumed30 / 30))

        result.append(
            InventoryRow(
                id=it.id,
                code=it.code,
                name=it.name,
                uom=it.uom,
                qty=it.qty,
                reorder_level=it.reorder_level,
                status=status,  # type: ignore
                consumed30=consumed30,
                days_cover=days_cover,
                weekly=[0] * 8,  # placeholder – can be enhanced
            )
        )
    return result


# ------------------------------------------------------------------
# Bots
# ------------------------------------------------------------------
def list_bots() -> list[Bot]:
    rows = sc.get_all_records("bots")
    return [Bot(**_clean(r, json_fields=["config"])) for r in rows]


def list_bot_runs(limit: int = 20) -> list[BotRun]:
    rows = sc.get_all_records("bot_runs")
    runs = [BotRun(**_clean(r, json_fields=["input", "output"])) for r in rows]
    runs.sort(key=lambda x: x.id, reverse=True)
    return runs[:limit]


def trigger_bot(payload: BotTrigger) -> BotRun:
    bots = list_bots()
    bot = next((b for b in bots if b.id == payload.id), None)
    if not bot:
        raise ValueError(f"Bot {payload.id} not found")

    started = _now()
    new_id = sc.next_id("bot_runs")
    # In a real deployment you would spawn the RPA process here.
    # For the Google-Sheets backend we just record a successful simulated run.
    output = {
        "message": "Simulated run (replace with real RPA call)",
        "input": payload.input,
        "prNumber": f"AD/2627/PR/{new_id:04d}",
    }
    finished = _now()
    duration = 1200  # ms placeholder

    row = {
        "id": new_id,
        "bot_id": bot.id,
        "bot_code": bot.code,
        "status": "success",
        "trigger": "manual",
        "started_at": started,
        "finished_at": finished,
        "duration_ms": duration,
        "input": json.dumps(payload.input),
        "output": json.dumps(output),
        "error": "",
    }
    sc.append_row("bot_runs", _bot_run_to_row(row))

    # update last_run_at on bot
    found = sc.find_row_by_id("bots", bot.id)
    if found:
        ridx, brec = found
        brec["last_run_at"] = finished
        sc.update_row("bots", ridx, _bot_to_row(brec))

    return BotRun(**_clean(row, json_fields=["input", "output"]))


# ------------------------------------------------------------------
# Alerts
# ------------------------------------------------------------------
def list_alerts(limit: int = 20) -> list[Alert]:
    rows = sc.get_all_records("alerts")
    alerts = [Alert(**_clean(r)) for r in rows]
    alerts.sort(key=lambda x: x.id, reverse=True)
    return alerts[:limit]


def create_alert(payload: AlertCreate) -> Alert:
    new_id = sc.next_id("alerts")
    row = {
        "id": new_id,
        "severity": payload.severity,
        "title": payload.title,
        "message": payload.message,
        "bot_id": payload.bot_id or "",
        "item_id": payload.item_id or "",
        "acknowledged": "false",
        "created_at": _now(),
    }
    sc.append_row("alerts", _alert_to_row(row))
    return Alert(**_clean(row))


# ------------------------------------------------------------------
# Seed data
# ------------------------------------------------------------------
def seed_if_empty() -> None:
    if sc.get_all_records("items"):
        return  # already seeded

    print("Seeding Google Sheet with demo data…")

    # items
    demo_items = [
        (1, "PCPWB60132", "PCPWB60132 Bearing", "NOS", 20, 50, 450.0, "Mechanical"),
        (2, "HYD-040", "Hydraulic Oil ISO 68", "Ltr", 30, 120, 280.0, "Consumable"),
        (3, "SEAL-12", "Hydraulic seal kit 12 mm", "Pcs", 10, 8, 95.0, "Mechanical"),
        (4, "FILTER-A", "Oil filter type A", "Pcs", 15, 25, 320.0, "Consumable"),
        (5, "BELT-V", "V-belt B-section", "Pcs", 5, 12, 180.0, "Mechanical"),
    ]
    for it in demo_items:
        sc.append_row(
            "items",
            list(it) + [_now()],
        )
        sc.next_id("items")  # keep counter in sync

    # machines
    demo_machines = [
        (1, "CNC-01", "CNC Lathe 01", "Machine shop"),
        (2, "PRESS-02", "Hydraulic Press 02", "Press bay"),
        (3, "MILL-03", "Vertical Mill 03", "Machine shop"),
    ]
    for m in demo_machines:
        sc.append_row("machines", list(m) + [_now()])
        sc.next_id("machines")

    # bots
    sc.append_row(
        "bots",
        [
            1,
            "BOT-TCS-PRPO",
            "TCS PR → PO Bot",
            "Creates Purchase Requisition and converts to PO in TCS",
            "generic",
            "active",
            "0 8 * * *",
            json.dumps({"script": "create_pr_po.py"}),
            "",
            "",
            _now(),
        ],
    )
    sc.next_id("bots")

    print("Seed complete.")


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------
def _clean(rec: dict, json_fields: list[str] | None = None) -> dict:
    """Convert empty strings / spreadsheet quirks to proper types."""
    out = {}
    for k, v in rec.items():
        if v == "" or v is None:
            out[k] = None
            continue
        if json_fields and k in json_fields:
            if isinstance(v, str):
                try:
                    out[k] = json.loads(v)
                except Exception:
                    out[k] = {}
            else:
                out[k] = v
            continue
        # bool
        if str(v).lower() in ("true", "false"):
            out[k] = str(v).lower() == "true"
            continue
        # int / float
        try:
            if "." in str(v):
                out[k] = float(v)
            else:
                out[k] = int(v)
            continue
        except (ValueError, TypeError):
            pass
        out[k] = v
    return out


def _item_to_row(rec: dict) -> list:
    return [
        rec.get("id"),
        rec.get("code"),
        rec.get("name"),
        rec.get("uom"),
        rec.get("reorder_level"),
        rec.get("qty"),
        rec.get("unit_price"),
        rec.get("category"),
        rec.get("created_at"),
    ]


def _slip_to_row(rec: dict) -> list:
    return [
        rec.get("id"),
        rec.get("token"),
        rec.get("group_token") or "",
        rec.get("group_id") or "",
        rec.get("item_id"),
        rec.get("item_code"),
        rec.get("item_name"),
        rec.get("machine_id") or "",
        rec.get("machine_code") or "",
        rec.get("machine_name") or "",
        rec.get("qty"),
        rec.get("issued_qty") or 0,
        rec.get("uom"),
        rec.get("department"),
        rec.get("station") or "",
        rec.get("cell") or "",
        rec.get("hod_title") or "",
        str(rec.get("hod_confirmed", False)).lower(),
        rec.get("slip_date"),
        rec.get("status"),
        rec.get("note") or "",
        rec.get("description") or "",
        rec.get("created_at") or "",
        rec.get("decided_at") or "",
    ]


def _add_movement(
    item_id: int,
    machine_id: Optional[int],
    slip_id: int,
    qty: int,
    kind: str,
) -> None:
    mid = sc.next_id("movements")
    sc.append_row(
        "movements",
        [mid, item_id, machine_id or "", slip_id, qty, kind, _now()],
    )


def _bot_to_row(rec: dict) -> list:
    cfg = rec.get("config")
    if isinstance(cfg, dict):
        cfg = json.dumps(cfg)
    return [
        rec.get("id"),
        rec.get("code"),
        rec.get("name"),
        rec.get("description") or "",
        rec.get("type"),
        rec.get("status"),
        rec.get("cron_expr") or "",
        cfg or "{}",
        rec.get("last_run_at") or "",
        rec.get("next_run_at") or "",
        rec.get("created_at") or "",
    ]


def _bot_run_to_row(rec: dict) -> list:
    return [
        rec.get("id"),
        rec.get("bot_id"),
        rec.get("bot_code"),
        rec.get("status"),
        rec.get("trigger"),
        rec.get("started_at"),
        rec.get("finished_at") or "",
        rec.get("duration_ms") or "",
        rec.get("input") if isinstance(rec.get("input"), str) else json.dumps(rec.get("input") or {}),
        rec.get("output") if isinstance(rec.get("output"), str) else json.dumps(rec.get("output") or {}),
        rec.get("error") or "",
    ]


def _alert_to_row(rec: dict) -> list:
    return [
        rec.get("id"),
        rec.get("severity"),
        rec.get("title"),
        rec.get("message") or "",
        rec.get("bot_id") or "",
        rec.get("item_id") or "",
        str(rec.get("acknowledged", False)).lower(),
        rec.get("created_at") or "",
    ]
