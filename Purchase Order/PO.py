"""PO module - re-exports the shared Purchase Order helpers from PO_combined.

kept for backwards compatibility (approve_and_po.py, tests/test_po.py).
"""
from PO_combined import (
    create_po_from_pr,
    load_po_source,
    fill_po_header,
    fill_po_items,
    _detect_flat_headers,
    _flat_rows_to_po,
    _pick,
    PO_FIELDS,
    PO_ITEM_FIELDS,
)