"""Pydantic models that match the frontend types."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ---------- Items / Catalog ----------
class Item(BaseModel):
    id: int
    code: str
    name: str
    uom: str = "Pcs"
    reorder_level: int = 0
    qty: int = 0
    unit_price: float = 0.0
    category: str = "General"
    created_at: Optional[str] = None


class Machine(BaseModel):
    id: int
    code: str
    name: str
    line: str = ""
    created_at: Optional[str] = None


class Catalog(BaseModel):
    items: list[Item]
    machines: list[Machine]


# ---------- Slips ----------
SlipStatus = Literal[
    "pending", "issued", "partial", "pr_open", "received", "rejected"
]


class SlipCreate(BaseModel):
    item_id: Optional[int] = None
    item_code: Optional[str] = None          # alternative to item_id
    machine_id: Optional[int] = None
    machine: Optional[str] = None            # machine code
    qty: int = Field(..., ge=1)
    department: str = "Production"
    station: str = ""
    cell: str = ""
    hod_title: str = ""
    hod_confirmed: bool = False
    slip_date: Optional[str] = None
    description: Optional[str] = None
    note: Optional[str] = None


class SlipGroupCreate(BaseModel):
    date: str
    department: str
    machine: str
    cell: str = ""
    hod_signature_confirmed: bool
    items: list[dict[str, Any]]              # [{itemId, quantity, description?}]


class SlipDecide(BaseModel):
    id: int
    mode: Literal["stock", "split", "pr", "reject"]


class SlipReceive(BaseModel):
    id: int


class Slip(BaseModel):
    id: int
    token: str
    group_token: Optional[str] = None
    group_id: Optional[int] = None
    item_id: int
    item_code: str
    item_name: str
    machine_id: Optional[int] = None
    machine_code: Optional[str] = None
    machine_name: Optional[str] = None
    qty: int
    issued_qty: int = 0
    uom: str = "Pcs"
    department: str
    station: str = ""
    cell: str = ""
    hod_title: str = ""
    hod_confirmed: bool = False
    slip_date: str
    status: SlipStatus
    note: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    decided_at: Optional[str] = None
    on_hand: Optional[int] = None            # enriched
    reorder_level: Optional[int] = None


# ---------- Inventory ----------
class InventoryRow(BaseModel):
    id: int
    code: str
    name: str
    uom: str
    qty: int
    reorder_level: int
    status: Literal["in", "low", "out"]
    consumed30: int = 0
    days_cover: Optional[int] = None
    weekly: list[int] = Field(default_factory=list)


# ---------- Bots ----------
class Bot(BaseModel):
    id: int
    code: str
    name: str
    description: str = ""
    type: str = "generic"
    status: str = "active"
    cron_expr: Optional[str] = None
    config: dict[str, Any] = Field(default_factory=dict)
    last_run_at: Optional[str] = None
    next_run_at: Optional[str] = None
    created_at: Optional[str] = None


class BotTrigger(BaseModel):
    id: int
    input: dict[str, Any] = Field(default_factory=dict)


class BotRun(BaseModel):
    id: int
    bot_id: int
    bot_code: str
    status: str
    trigger: str
    started_at: str
    finished_at: Optional[str] = None
    duration_ms: Optional[int] = None
    input: dict[str, Any] = Field(default_factory=dict)
    output: Optional[dict[str, Any]] = None
    error: Optional[str] = None


# ---------- Alerts ----------
class Alert(BaseModel):
    id: int
    severity: Literal["info", "warn", "critical"]
    title: str
    message: str = ""
    bot_id: Optional[int] = None
    item_id: Optional[int] = None
    acknowledged: bool = False
    created_at: Optional[str] = None


class AlertCreate(BaseModel):
    severity: Literal["info", "warn", "critical"] = "info"
    title: str
    message: str = ""
    bot_id: Optional[int] = None
    item_id: Optional[int] = None
