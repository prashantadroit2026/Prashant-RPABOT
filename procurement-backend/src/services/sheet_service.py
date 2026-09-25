"""Business logic on top of Google Sheets."""
from __future__ import annotations

import hashlib
import json
import re
import time
import zlib
from datetime import datetime, timezone
from typing import Any, Optional

from sheets import client as sc
from sheets.models import (
    Alert,
    AlertAck,
    AlertCreate,
    AppUser,
    Bot,
    BotCreate,
    BotRun,
    BotTrigger,
    BotUpdate,
    Catalog,
    InventoryRow,
    Item,
    Machine,
    NewItemRequest,
    Slip,
    SlipCreate,
    SlipDecide,
    SlipGroupCreate,
    SlipReceive,
    UserCreate,
    UserLogin,
    UserUpdate,
)
from services import serializers as ser


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# ------------------------------------------------------------------
# Catalog
# ------------------------------------------------------------------
# Item master reference lives in the "Item data" tab (Item Code +
# Item Description). The lightweight "items" tab holds operational rows
# (stock qty / reorder) for the demo set and NEW-* requests. Its name is
# the display name when present; master fields fill missing values.
_ITEM_DATA_TAB = "Item data"
_ITEM_DATA_TTL_S = 60.0
_item_data_cache: dict[str, Any] = {"at": 0.0, "rows": []}


def _stable_item_id(code: str) -> int:
    """Deterministic id for master items that have no row in the items tab."""
    return (zlib.crc32(code.encode("utf-8")) & 0x7FFFFFFF) or 1


def _to_num(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _to_int(v: Any) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def _first(*vals: Any, fallback: Any = "") -> Any:
    """First non-empty value among candidates (sheet rows often spell the same
    field differently), else the fallback."""
    for v in vals:
        if v is not None and str(v).strip():
            return v
    return fallback


def _load_item_data() -> list[dict[str, Any]]:
    """Master rows from the 'Item data' tab, deduped by Item Code.

    Returns [] when the tab is absent or unreadable, so the catalog falls back
    to the operational 'items' tab instead of failing. The worksheet check plus
    the TTL keep a missing master tab from retrying the Sheets API on every
    request (which would exhaust the 300 reads/min quota and 500 every page).
    """
    now = time.monotonic()
    cached = _item_data_cache
    if now - cached["at"] < _ITEM_DATA_TTL_S:
        return cached["rows"]
    rows: list[dict[str, Any]] = []
    try:
        if sc.has_worksheet(_ITEM_DATA_TAB):
            rows = sc.get_all_records(_ITEM_DATA_TAB)
        else:
            print(
                f"[warn] '{_ITEM_DATA_TAB}' worksheet not found in the spreadsheet - "
                "serving catalog from the 'items' tab only. Run "
                "python import_item_data.py to populate the master tab."
            )
    except Exception:  # noqa: BLE001 - one optional tab must never take the API down
        rows = []
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for r in rows:
        code = str(r.get("Item Code") or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(r)
    cached["at"] = now
    cached["rows"] = out
    return out


def _item_from_row(stock: dict, master: dict | None = None) -> Optional[Item]:
    """Tolerantly build an Item from a sheet row.

    Returns None instead of raising when the row lacks a usable id/code, so a
    single partially-filled row in the spreadsheet can't 500 the whole catalog.
    Operational ('items') fields take precedence for the display name; master fields fill missing values.
    """
    code = str(stock.get("code") or "").strip()
    if not code:
        return None
    try:
        item_id = int(stock.get("id") or 0)
    except (TypeError, ValueError):
        return None
    if item_id <= 0:
        return None
    m = master or {}
    return Item(
        id=item_id,
        code=code,
        name=str(_first(stock.get("name"), m.get("Item Description"), m.get("Item Name"), fallback=code)).strip() or code,
        uom=str(_first(m.get("Base UOM"), stock.get("uom"), fallback="Pcs")),
        reorder_level=_to_int(_first(m.get("Reorder Level"), stock.get("reorder_level"))),
        qty=_to_int(_first(m.get("Qty"), m.get("Quantity"), stock.get("qty"))),
        unit_price=_to_num(_first(m.get("Rate"), m.get("Unit Price"), stock.get("unit_price"))),
        category=str(_first(m.get("Item Category"), stock.get("category"), fallback="General")),
        created_at=stock.get("created_at"),
    )


def list_items() -> list[Item]:
    """Merge master 'Item data' with operational 'items' rows by code."""
    stock = sc.get_all_records("items")
    stock_by_code: dict[str, dict[str, Any]] = {}
    for r in stock:
        code = str(r.get("code") or "").strip()
        if code and code not in stock_by_code:
            stock_by_code[code] = r

    items: list[Item] = []
    covered: set[str] = set()
    for r in _load_item_data():
        code = str(r.get("Item Code") or "").strip()
        if not code:
            continue
        s = stock_by_code.get(code)
        if s:
            item = _item_from_row(s, r)
        else:
            item = _item_from_row({"id": _stable_item_id(code), "code": code}, r)
        if item:
            items.append(item)
        covered.add(code)

    # Operational rows (demo set / NEW-* requests) not present in master data.
    for code, s in stock_by_code.items():
        if code not in covered:
            item = _item_from_row(s)
            if item:
                items.append(item)
            covered.add(code)

    items.sort(key=lambda i: (i.id, i.code))
    return items


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
    for i in list_items():
        if i.id == id_:
            return i
    return None


def update_item_qty(item_id: int, delta: int) -> Item:
    found = sc.find_row_by_id("items", item_id)
    item = get_item(item_id)
    if not item:
        raise ValueError(f"Item {item_id} not found")
    if found:
        row_idx, rec = found
        new_qty = max(0, int(rec.get("qty") or 0) + delta)
        rec["qty"] = new_qty
        values = _item_to_row(rec)
        sc.update_row("items", row_idx, values)
        return Item(**_clean(rec))
    # Master item without an operational row yet - materialize one.
    row = {
        "id": item_id,
        "code": item.code,
        "name": item.name,
        "uom": item.uom,
        "reorder_level": int(item.reorder_level),
        "qty": max(0, int(item.qty) + delta),
        "unit_price": float(item.unit_price),
        "category": item.category,
        "created_at": _now(),
    }
    sc.append_row("items", _item_to_row(row))
    return Item(**{k: v for k, v in row.items() if k != "created_at"})


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
        "station": payload.station or payload.cell or "",
        "cell": payload.cell or "",
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
                weekly=[0] * 8,  # placeholder â€“ can be enhanced
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
# API view models â€” camelCase, exactly the frontend contract
# ------------------------------------------------------------------
def item_api(i: Item) -> dict[str, Any]:
    return ser.camelize(i.model_dump())


def machine_api(m: Machine) -> dict[str, Any]:
    return ser.camelize(m.model_dump())


def slip_api(s: Slip) -> dict[str, Any]:
    return ser.camelize(s.model_dump())


def get_catalog_api() -> dict[str, Any]:
    return {
        "items": [item_api(i) for i in list_items()],
        "machines": [machine_api(m) for m in list_machines()],
    }


def _movements() -> list[dict[str, Any]]:
    return sc.get_all_records("movements")


def _movement_stats(
    movs: list[dict[str, Any]], days: Optional[int] = None
) -> dict[int, dict[str, Any]]:
    """Per-item {consumed, received, receipts} in an optional trailing window."""
    now = datetime.now(timezone.utc)
    stats: dict[int, dict[str, Any]] = {}
    for m in movs:
        try:
            item_id = int(m.get("item_id") or 0)
        except (TypeError, ValueError):
            continue
        if item_id <= 0:
            continue
        if days is not None:
            created = ser._parse_dt(m.get("created_at"))
            if created is None or (now - created).days > days:
                continue
        try:
            qty = int(m.get("qty") or 0)
        except (TypeError, ValueError):
            continue
        kind = str(m.get("kind") or "")
        s = stats.setdefault(item_id, {"consumed": 0, "received": 0, "receipts": 0})
        if kind == "issue":
            s["consumed"] += abs(qty)
        elif kind == "receive":
            s["received"] += abs(qty)
            s["receipts"] += 1
    return stats


def _weekly_by_item(
    movs: list[dict[str, Any]], weeks: list[str]
) -> dict[int, list[int]]:
    out: dict[int, list[int]] = {}
    for m in movs:
        if str(m.get("kind") or "") != "issue":
            continue
        try:
            item_id = int(m.get("item_id") or 0)
        except (TypeError, ValueError):
            continue
        if item_id <= 0:
            continue
        week = ser.week_of(m.get("created_at"))
        if week is None or week not in weeks:
            continue
        try:
            qty = abs(int(m.get("qty") or 0))
        except (TypeError, ValueError):
            continue
        arr = out.setdefault(item_id, [0] * len(weeks))
        arr[weeks.index(week)] += qty
    return out


def _weekly_series(movs: list[dict[str, Any]], weeks: list[str]) -> list[dict[str, Any]]:
    consumed = {w: 0 for w in weeks}
    received = {w: 0 for w in weeks}
    for m in movs:
        kind = str(m.get("kind") or "")
        week = ser.week_of(m.get("created_at"))
        if week is None or week not in weeks:
            continue
        try:
            qty = abs(int(m.get("qty") or 0))
        except (TypeError, ValueError):
            continue
        if kind == "issue":
            consumed[week] += qty
        elif kind == "receive":
            received[week] += qty
    return [{"week": w, "consumed": consumed[w], "received": received[w]} for w in weeks]


def get_inventory_v2() -> list[dict[str, Any]]:
    items = list_items()
    movs = _movements()
    stats = _movement_stats(movs, days=30)
    weeks = ser.week_mondays(8)
    weekly = _weekly_by_item(movs, weeks)
    rows = []
    for it in items:
        st = stats.get(it.id, {})
        consumed30 = st.get("consumed", 0)
        daily = consumed30 / 30
        rows.append(
            {
                "id": it.id,
                "code": it.code,
                "name": it.name,
                "uom": it.uom,
                "reorderLevel": it.reorder_level,
                "qty": it.qty,
                "status": ser.stock_status(it.qty, it.reorder_level),
                "category": it.category,
                "unitPrice": it.unit_price,
                "consumed30": consumed30,
                "received30": st.get("received", 0),
                "daysCover": round(it.qty / daily, 1) if daily > 0 else None,
                "weekly": weekly.get(it.id, [0] * len(weeks)),
            }
        )
    rows.sort(key=lambda r: r["name"].lower())
    return rows


def get_refill_dashboard() -> dict[str, Any]:
    items = list_items()
    movs = _movements()
    stats = _movement_stats(movs, days=30)
    weeks = ser.week_mondays(8)
    weekly = _weekly_by_item(movs, weeks)
    rows = []
    for it in items:
        st = stats.get(it.id, {})
        consumed30 = st.get("consumed", 0)
        daily = consumed30 / 30
        rows.append(
            {
                "itemId": it.id,
                "name": it.name,
                "code": it.code,
                "uom": it.uom,
                "qty": it.qty,
                "reorderLevel": it.reorder_level,
                "consumed30": consumed30,
                "received30": st.get("received", 0),
                "receipts": st.get("receipts", 0),
                "daysCover": round(it.qty / daily, 1) if daily > 0 else None,
                "weekly": weekly.get(it.id, [0] * len(weeks)),
                "status": ser.stock_status(it.qty, it.reorder_level),
            }
        )
    rows.sort(key=lambda r: r["name"].lower())
    return {"rows": rows, "series": _weekly_series(movs, weeks)}


def list_machine_stats() -> list[dict[str, Any]]:
    machines = list_machines()
    movs = _movements()
    items = {i.id: i for i in list_items()}
    now = datetime.now(timezone.utc)
    totals: dict[int, dict[str, Any]] = {}
    breakdown: dict[int, dict[int, int]] = {}
    for m in movs:
        if str(m.get("kind") or "") != "issue":
            continue
        mid = m.get("machine_id")
        if mid in (None, ""):
            continue
        try:
            machine_id = int(mid)
            item_id = int(m.get("item_id") or 0)
            qty = int(m.get("qty") or 0)
        except (TypeError, ValueError):
            continue
        if item_id <= 0:
            continue
        created = ser._parse_dt(m.get("created_at"))
        t = totals.setdefault(machine_id, {"consumed30": 0, "items": set()})
        if created is not None and (now - created).days <= 30:
            t["consumed30"] += abs(qty)
            t["items"].add(item_id)
        b = breakdown.setdefault(machine_id, {})
        b[item_id] = b.get(item_id, 0) + abs(qty)

    out = []
    for mc in machines:
        t = totals.get(mc.id, {"consumed30": 0, "items": set()})
        detail = []
        for item_id, qty in sorted(breakdown.get(mc.id, {}).items(), key=lambda kv: -kv[1]):
            it = items.get(item_id)
            if not it or qty <= 0:
                continue
            detail.append({"itemName": it.name, "itemCode": it.code, "qty": qty, "uom": it.uom})
        out.append(
            {
                "id": mc.id,
                "code": mc.code,
                "name": mc.name,
                "line": mc.line or "",
                "consumed30": t["consumed30"],
                "distinctItems": len(t["items"]),
                "topItem": detail[0]["itemName"] if detail else None,
                "rows": detail,
            }
        )
    out.sort(key=lambda r: r["code"].lower())
    return out


def list_slip_groups() -> list[dict[str, Any]]:
    slips = list_slips()
    groups: dict[str, dict[str, Any]] = {}
    for s in slips:
        g = s.model_dump()
        gt = g.get("group_token")
        if not gt:
            continue
        group = groups.get(gt)
        if group is None:
            group = {
                "id": g.get("group_id"),
                "groupToken": gt,
                "department": g.get("department"),
                "machineCode": g.get("machine_code") or g.get("machine_name"),
                "station": g.get("station") or "",
                "hodConfirmed": bool(g.get("hod_confirmed")),
                "slipDate": str(g.get("slip_date") or ""),
                "createdAt": g.get("created_at"),
                "slips": [],
            }
            groups[gt] = group
        group["slips"].append(slip_api(s))
    sorted_groups = sorted(groups.values(), key=lambda g: g["createdAt"] or "", reverse=True)
    return sorted_groups


def create_indent(payload: SlipGroupCreate) -> dict[str, Any]:
    result = create_slip_group(payload)  # {groupToken, groupId, slips}
    for g in list_slip_groups():
        if g["groupToken"] == result["groupToken"]:
            return g
    raise ValueError("Indent was created but could not be read back from the sheet")


def acknowledge_alert(alert_id: int) -> dict[str, Any]:
    found = sc.find_row_by_id("alerts", alert_id)
    if not found:
        raise ValueError(f"Alert {alert_id} not found")
    ridx, rec = found
    rec["acknowledged"] = "true"
    sc.update_row("alerts", ridx, _alert_to_row(rec))
    items = {i.id: i for i in list_items()}
    bots = {b.id: b for b in list_bots()}
    return _alert_api(rec, items, bots)


def _alert_api(a: dict[str, Any], items: dict[int, Item], bots: dict[int, Bot]) -> dict[str, Any]:
    d = ser.camelize(a)
    bot = bots.get(d.get("botId"))
    it = items.get(d.get("itemId"))
    d["botCode"] = bot.code if bot else None
    d["itemName"] = it.name if it else None
    d["itemCode"] = it.code if it else None
    if d.get("acknowledged") in (None, ""):
        d["acknowledged"] = False
    return d


def alert_api(a: Alert) -> dict[str, Any]:
    items = {i.id: i for i in list_items()}
    bots = {b.id: b for b in list_bots()}
    return _alert_api(a.model_dump(), items, bots)


def list_bots_api() -> list[dict[str, Any]]:
    out = []
    for b in list_bots():
        d = ser.camelize(b.model_dump())
        d["updatedAt"] = d.get("createdAt")
        if not d.get("cronExpr"):
            d["cronExpr"] = None
        out.append(d)
    return out


def run_api(r: BotRun) -> dict[str, Any]:
    bots = {b.code: b for b in list_bots()}
    d = ser.camelize(r.model_dump())
    b = bots.get(d.get("botCode"))
    d["botName"] = b.name if b else None
    if not d.get("finishedAt"):
        d["finishedAt"] = d.get("startedAt")
    d.setdefault("createdAt", d.get("startedAt"))
    return d


def list_bot_runs_api(limit: int = 20) -> list[dict[str, Any]]:
    return [run_api(r) for r in list_bot_runs(limit=limit)]


def list_alerts_api(limit: int = 20) -> list[dict[str, Any]]:
    items = {i.id: i for i in list_items()}
    bots = {b.id: b for b in list_bots()}
    rows = sc.get_all_records("alerts")
    alerts = [Alert(**_clean(r)) for r in rows]
    alerts.sort(key=lambda x: x.id, reverse=True)
    return [_alert_api(a.model_dump(), items, bots) for a in alerts[:limit]]


# ------------------------------------------------------------------
# Item hint / requests / new-item request
# ------------------------------------------------------------------
def item_hint(
    item_id: int, machine_id: Optional[int] = None
) -> Optional[dict[str, Any]]:
    item = get_item(item_id)
    if not item:
        return None
    machines = {m.id: m for m in list_machines()}
    movs = sc.get_all_records("movements")
    issues: list[dict[str, Any]] = []
    last_on_machine: Optional[dict[str, Any]] = None
    for m in sorted(movs, key=lambda r: str(r.get("created_at") or ""), reverse=True):
        if str(m.get("kind") or "") != "issue":
            continue
        try:
            if int(m.get("item_id") or 0) != item_id:
                continue
        except (TypeError, ValueError):
            continue
        if len(issues) < 3:
            mid = m.get("machine_id")
            mc = None
            if mid not in (None, ""):
                try:
                    mc = machines.get(int(mid))
                except (TypeError, ValueError):
                    mc = None
            issues.append(
                {
                    "qty": abs(int(m.get("qty") or 0)),
                    "at": m.get("created_at"),
                    "machineName": mc.name if mc else None,
                }
            )
        if machine_id and last_on_machine is None:
            try:
                if int(m.get("machine_id") or 0) == machine_id:
                    last_on_machine = {
                        "qty": abs(int(m.get("qty") or 0)),
                        "at": m.get("created_at"),
                    }
            except (TypeError, ValueError):
                pass
    return {
        "item": item_api(item),
        "lastIssues": issues,
        "lastOnThisMachine": last_on_machine,
    }


def list_requests() -> list[dict[str, Any]]:
    items = {i.id: i for i in list_items()}
    now = datetime.now(timezone.utc)
    movs = sc.get_all_records("movements")
    consumed: dict[int, int] = {}
    last_recv: dict[int, dict[str, Any]] = {}
    for m in sorted(movs, key=lambda r: str(r.get("created_at") or "")):
        try:
            iid = int(m.get("item_id") or 0)
            qty = abs(int(m.get("qty") or 0))
        except (TypeError, ValueError):
            continue
        if iid <= 0:
            continue
        kind = str(m.get("kind") or "")
        created = ser._parse_dt(m.get("created_at"))
        if kind == "issue" and created is not None and (now - created).days <= 30:
            consumed[iid] = consumed.get(iid, 0) + qty
        elif kind == "receive":
            last_recv[iid] = {"qty": qty, "at": m.get("created_at")}

    out = []
    for s in list_slips():
        it = items.get(s.item_id)
        if not it:
            continue
        unit = it.unit_price
        last = last_recv.get(s.item_id)
        out.append(
            {
                "id": s.id,
                "token": s.token,
                "groupId": s.group_id,
                "groupToken": s.group_token,
                "status": s.status,
                "slipDate": s.slip_date,
                "department": s.department,
                "cellStation": s.station,
                "machineCode": s.machine_code,
                "machineName": s.machine_name,
                "hodConfirmed": s.hod_confirmed,
                "hodTitle": s.hod_title,
                "decidedAt": s.decided_at,
                "note": s.note or "",
                "description": s.description or "",
                "itemId": s.item_id,
                "itemCode": s.item_code,
                "itemName": s.item_name,
                "category": it.category,
                "uom": s.uom,
                "currentStock": s.on_hand or it.qty,
                "requestedQty": s.qty,
                "issuedQty": s.issued_qty,
                "consumptionRate": consumed.get(s.item_id, 0),
                "unitPrice": unit,
                "totalCost": round(unit * s.qty, 2),
                "lastOrderedDate": last["at"] if last else None,
                "lastOrderedQty": last["qty"] if last else None,
                "reorderLevel": it.reorder_level,
            }
        )
    return out


def request_new_item(payload: NewItemRequest) -> dict[str, Any]:
    existing = None
    for it in list_items():
        if it.name.strip().lower() == payload.name.strip().lower():
            existing = it
            break
    created = existing is None
    item = existing
    if created:
        new_id = sc.next_id("items")
        code = f"NEW-{new_id:04d}"
        row = {
            "id": new_id,
            "code": code,
            "name": payload.name,
            "uom": payload.uom,
            "reorder_level": 1,
            "qty": 0,
            "unit_price": 0,
            "category": payload.category,
            "created_at": _now(),
        }
        sc.append_row("items", _item_to_row(row))
        item = Item(**{k: v for k, v in row.items() if k != "created_at"})
        item.created_at = row["created_at"]
    grp = create_slip_group(
        SlipGroupCreate(
            date=payload.date,
            department=payload.department,
            machine=payload.machine,
            cell=payload.cell,
            hod_signature_confirmed=payload.hod_signature_confirmed,
            items=[
                {
                    "itemId": item.code,
                    "quantity": payload.quantity,
                    "description": payload.description,
                }
            ],
        )
    )
    return {
        "groupToken": grp["groupToken"],
        "created": created,
        "slip": slip_api(grp["slips"][0]),
    }


# ------------------------------------------------------------------
# Bot management / stats / audit
# ------------------------------------------------------------------
def bot_api(b: Bot) -> dict[str, Any]:
    d = ser.camelize(b.model_dump())
    d["updatedAt"] = d.get("createdAt")
    if not d.get("cronExpr"):
        d["cronExpr"] = None
    return d


def get_bot(bot_id: int) -> Optional[Bot]:
    for b in list_bots():
        if b.id == bot_id:
            return b
    return None


def create_bot(payload: BotCreate) -> Bot:
    bots = list_bots()
    if any(b.code == payload.code for b in bots):
        raise ValueError(f"Bot code {payload.code} already exists")
    new_id = sc.next_id("bots")
    rec = {
        "id": new_id,
        "code": payload.code,
        "name": payload.name,
        "description": payload.description,
        "type": payload.type,
        "status": payload.status,
        "cron_expr": payload.cron_expr or "",
        "config": payload.config,
        "last_run_at": "",
        "next_run_at": "",
        "created_at": _now(),
    }
    sc.append_row("bots", _bot_to_row(rec))
    _audit("system", "bot.create", "bot", str(new_id), payload.model_dump())
    return Bot(**_clean(rec, json_fields=["config"]))


def update_bot(bot_id: int, payload: BotUpdate) -> Bot:
    found = sc.find_row_by_id("bots", bot_id)
    if not found:
        raise ValueError("Bot not found")
    ridx, rec = found
    rec["name"] = payload.name if payload.name not in (None, "") else rec.get("name")
    rec["description"] = (
        payload.description if payload.description is not None else rec.get("description")
    )
    rec["type"] = payload.type if payload.type not in (None, "") else rec.get("type")
    rec["status"] = payload.status if payload.status not in (None, "") else rec.get("status")
    if payload.cron_expr is not None:
        rec["cron_expr"] = payload.cron_expr
    if payload.config is not None:
        rec["config"] = payload.config
    sc.update_row("bots", ridx, _bot_to_row(rec))
    _audit("system", "bot.update", "bot", str(bot_id), payload.model_dump(exclude_none=True))
    return Bot(**_clean(rec, json_fields=["config"]))


def delete_bot(bot_id: int) -> dict[str, Any]:
    found = sc.find_row_by_id("bots", bot_id)
    if not found:
        raise ValueError("Bot not found")
    sc.delete_row("bots", found[0])
    _audit("system", "bot.delete", "bot", str(bot_id), {})
    return {"ok": True}


def bot_stats() -> dict[str, Any]:
    bots = list_bots()
    runs_records = sc.get_all_records("bot_runs")
    alert_records = sc.get_all_records("alerts")
    now = datetime.now(timezone.utc)

    def rd(rows, name):
        return sum(1 for r in rows if str(r.get(name) or "") == "true")

    bots_by_status = {s: 0 for s in ("active", "paused", "error")}
    for b in bots:
        bots_by_status[b.status] = bots_by_status.get(b.status, 0) + 1

    runs_total = runs_success = runs_failed = runs_running = 0
    for r in runs_records:
        runs_total += 1
        status = str(r.get("status") or "")
        if status == "success":
            runs_success += 1
        elif status == "failed":
            runs_failed += 1
        elif status in ("running", "queued"):
            runs_running += 1

    alerts_total = len(alert_records)
    alerts_unack = sum(1 for a in alert_records if str(a.get("acknowledged") or "").lower() != "true")
    alerts_critical = sum(
        1
        for a in alert_records
        if str(a.get("severity") or "").lower() == "critical"
        and str(a.get("acknowledged") or "").lower() != "true"
    )
    return {
        "bots": {
            "total": len(bots),
            "active": bots_by_status.get("active", 0),
            "paused": bots_by_status.get("paused", 0),
            "error": bots_by_status.get("error", 0),
        },
        "runs": {
            "total": runs_total,
            "success": runs_success,
            "failed": runs_failed,
            "running": runs_running,
        },
        "alerts": {
            "total": alerts_total,
            "unack": alerts_unack,
            "critical": alerts_critical,
        },
    }


def _audit(
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    new_id = sc.next_id("audit_logs")
    sc.append_row(
        "audit_logs",
        [new_id, actor, action, entity_type, entity_id, json.dumps(payload or {}), _now()],
    )


def list_audit(limit: int = 20) -> list[dict[str, Any]]:
    rows = sc.get_all_records("audit_logs")
    out = []
    for r in reversed(rows):
        d = ser.camelize(r)
        raw = d.get("payload")
        if isinstance(raw, str):
            try:
                d["payload"] = json.loads(raw)
            except Exception:
                d["payload"] = {}
        out.append(d)
        if len(out) >= limit:
            break
    return out


# ------------------------------------------------------------------
# Users (sheet-backed login & user management)
# ------------------------------------------------------------------
_USER_ID_RE = re.compile(r"^[a-z0-9._-]+$")


def _password_digest(user_id: str, password: str) -> str:
    return hashlib.sha256(f"{user_id.strip().lower()}:{password}".encode("utf-8")).hexdigest()


def list_users() -> list[AppUser]:
    rows = sc.get_all_records("users")
    return [AppUser(**_clean(r)) for r in rows]


def get_user(user_id: int) -> Optional[AppUser]:
    for u in list_users():
        if u.id == user_id:
            return u
    return None


def find_user(user_id: str, password: str) -> Optional[AppUser]:
    """Return the matching user or None. Compares against the stored digest."""
    uid = user_id.strip().lower()
    digest = _password_digest(uid, password)
    for u in list_users():
        if u.user_id.lower() == uid and u.password == digest:
            return u
    return None


def _user_api(user: AppUser) -> dict[str, Any]:
    """Serialize a user for the API â€” the password must never leave the server."""
    d = ser.camelize(user.model_dump())
    d.pop("password", None)
    return d


def list_users_api() -> list[dict[str, Any]]:
    return [_user_api(u) for u in list_users()]


def create_user(payload: UserCreate) -> AppUser:
    uid = payload.user_id.strip().lower()
    if not _USER_ID_RE.match(uid):
        raise ValueError(
            "User ID must be lowercase letters, digits and . _ - only"
        )
    if any(u.user_id.lower() == uid for u in list_users()):
        raise ValueError(f"User ID {uid} already exists")
    new_id = sc.next_id("users")
    rec = {
        "id": new_id,
        "user_id": uid,
        "name": payload.name.strip(),
        "role": payload.role,
        "department": payload.department.strip(),
        "password": _password_digest(uid, payload.password),
        "created_at": _now(),
    }
    sc.append_row("users", _user_to_row(rec))
    _audit("system", "user.create", "user", str(new_id), {"userId": uid, "role": payload.role})
    return AppUser(**_clean(rec))


def update_user(user_id: int, payload: UserUpdate) -> AppUser:
    found = sc.find_row_by_id("users", user_id)
    if not found:
        raise ValueError("User not found")
    ridx, rec = found
    if payload.name not in (None, ""):
        rec["name"] = payload.name.strip()
    if payload.role is not None:
        rec["role"] = payload.role
    if payload.department is not None:
        rec["department"] = payload.department.strip()
    if payload.password not in (None, ""):
        rec["password"] = _password_digest(
            str(rec.get("user_id") or ""), payload.password
        )
    sc.update_row("users", ridx, _user_to_row(rec))
    _audit("system", "user.update", "user", str(user_id), payload.model_dump(exclude_none=True))
    return AppUser(**_clean(rec))


def delete_user(user_id: int) -> dict[str, Any]:
    found = sc.find_row_by_id("users", user_id)
    if not found:
        raise ValueError("User not found")
    sc.delete_row("users", found[0])
    _audit("system", "user.delete", "user", str(user_id), {})
    return {"ok": True}


def _user_to_row(rec: dict) -> list:
    return [
        rec.get("id"),
        rec.get("user_id"),
        rec.get("name"),
        rec.get("role"),
        rec.get("department"),
        rec.get("password"),
        rec.get("created_at"),
    ]


# ------------------------------------------------------------------
# Seed data
# ------------------------------------------------------------------
def seed_if_empty() -> None:
    """Seed each table independently (per-table, not all-or-nothing)."""
    print("Seeding Google Sheet: checking for empty tables...")

    if not sc.get_all_records("items"):
        print("  - items: seeding demo catalog")
        demo_items = [
            (1, "PCPWB60132", "PCPWB60132 Bearing", "NOS", 20, 50, 450.0, "Mechanical"),
            (2, "HYD-040", "Hydraulic Oil ISO 68", "Ltr", 30, 120, 280.0, "Consumable"),
            (3, "SEAL-12", "Hydraulic seal kit 12 mm", "Pcs", 10, 8, 95.0, "Mechanical"),
            (4, "FILTER-A", "Oil filter type A", "Pcs", 15, 25, 320.0, "Consumable"),
            (5, "BELT-V", "V-belt B-section", "Pcs", 5, 12, 180.0, "Mechanical"),
        ]
        for it in demo_items:
            sc.append_row("items", list(it) + [_now()])
            sc.next_id("items")  # keep counter in sync
    else:
        print("  - items: already seeded")

    if not sc.get_all_records("machines"):
        print("  - machines: seeding demo machines")
        demo_machines = [
            (1, "CNC-01", "CNC Lathe 01", "Machine shop"),
            (2, "PRESS-02", "Hydraulic Press 02", "Press bay"),
            (3, "MILL-03", "Vertical Mill 03", "Machine shop"),
        ]
        for m in demo_machines:
            sc.append_row("machines", list(m) + [_now()])
            sc.next_id("machines")
    else:
        print("  - machines: already seeded")

    if not sc.get_all_records("bots"):
        print("  - bots: seeding demo bot")
        sc.append_row(
            "bots",
            [
                1,
                "BOT-TCS-PRPO",
                "TCS PR - PO Bot",
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
    else:
        print("  - bots: already seeded")

    if not sc.get_all_records("users"):
        print("  - users: seeding demo users")
        demo_users = [
            (1, "sf.sharma", "A. Sharma", "shopfloor", "Production", "shop@123"),
            (2, "st.khan", "R. Khan", "store", "Warehouse", "store@123"),
            (3, "mg.rao", "V. Rao", "management", "Tool Room", "mgmt@123"),
        ]
        for uid, user_id, name, role, department, pw in demo_users:
            rec = {
                "id": uid,
                "user_id": user_id,
                "name": name,
                "role": role,
                "department": department,
                "password": _password_digest(user_id, pw),
                "created_at": _now(),
            }
            sc.append_row("users", _user_to_row(rec))
            sc.next_id("users")
    else:
        print("  - users: already seeded")

    print("Seed check complete.")


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
