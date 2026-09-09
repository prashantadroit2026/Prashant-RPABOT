"""
TCS iON Combined PR + PO Bot
=============================
Single script to create a Purchase Requisition (PR), approve it, then create
a Purchase Order (PO) from the approved PR.

Usage:
    python scripts/create_pr_po.py --item-code PCPWB60132 --qty 50
    python scripts/create_pr_po.py --item-code PCPWB60132 --qty 50 --po-type Import
    python scripts/create_pr_po.py --item-code PCPWB60132 --qty 50 --currency USD
"""

import argparse
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "data"
LOG_DIR = PROJECT_DIR / "logs"
SCREENSHOT_DIR = LOG_DIR / "screenshots"

if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

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

USERNAME = os.environ.get("TCS_USERNAME")
PASSWORD = os.environ.get("TCS_PASSWORD")
LOGIN_URL = os.environ.get("TCS_Loginpage", "https://training.tcsion.com/Login/Login.html")
HOME_URL = os.environ.get("TCS_Homepages", "https://mfg3.tcsion.com/TCSiONHome/Home")
MANUFACTURING_URL = os.environ.get("TCS_Manufacturingpage")
HOME_URL_MARKER = "TCSiONHome"
LOGIN_FAILURE_URL_MARKER = "loginfailure"
LOGOUT_PATHS = ["/Login/logout", "/Login/Logout", "/Logout", "/logout",
                "/Login/Login.html?logout=true"]

if not USERNAME or not PASSWORD:
    raise SystemExit("TCS_USERNAME and TCS_PASSWORD environment variables are required")

SIDEBAR_LABELS = ["Home", "Procurement", "Inventory", "Engineering", "Master",
                  "Import/Export", "Reports"]

# PO header field selectors (fixed to match actual TCS iON form)
PO_FIELDS = {
    "po_type": {"default": "Domestic", "selectors": [
        "select[name='trhtransubtypelviid']",
        "select[name='S_trhpotypeid_trhpotypedcnid']",
    ]},
    "currency": {"default": "INR", "selectors": [
        "select[name='trhcrncode']",
        "select[name='S_trhcurrencyid_trhcurrencydcnid']",
    ]},
    "category": {"selectors": [
        "select[name='trhtrancatid_trhtrancatdcnid']",
    ]},
    "site": {"selectors": [
        "select[name='trhsiteid_trhsitedcnid']",
    ]},
    "account_site": {"selectors": [
        "select[name='trhaccsiteid_trhaccsitedcnid']",
    ]},
    "vendor_code": {"selectors": [
        "input[name='trhpartycode']",
    ]},
    "vendor_desc": {"selectors": [
        "input[name='trhpartydesc']",
    ]},
}

# ============================================================================
# SECTION 1 -- FRAME-SCOPED FORM HELPERS
# ============================================================================

def _scopes(page):
    scopes = [page]
    try:
        scopes += list(page.frames)
    except Exception:
        pass
    try:
        scopes += list(page.child_frames)
    except Exception:
        pass
    return scopes


def _wait_for(page, selector, max_wait=5):
    for _ in range(max_wait * 2):
        for scope in _scopes(page):
            try:
                loc = scope.locator(selector)
                if loc.count() > 0:
                    return loc.first
            except Exception:
                pass
        time.sleep(0.5)
    return None


def _set_value(loc, value):
    if loc is None:
        return
    value = "" if value is None else str(value).strip()
    if not value:
        return
    try:
        loc.fill(value, timeout=3000)
        return
    except Exception:
        pass
    try:
        loc.evaluate(
            "(el, v) => { el.value = v; "
            "el.dispatchEvent(new Event('input', {bubbles: true})); "
            "el.dispatchEvent(new Event('change', {bubbles: true})); }",
            value,
        )
    except Exception:
        pass


def _select_option(page, selector, text):
    if not text:
        return
    text = str(text).strip()
    loc = _wait_for(page, selector, max_wait=3)
    if loc is None:
        return
    try:
        disabled = loc.evaluate("el => !!(el.disabled || el.readOnly)")
    except Exception:
        disabled = False
    if disabled:
        return
    try:
        opts = loc.locator("option")
        texts = [opts.nth(i).inner_text().strip() for i in range(opts.count())]
    except Exception:
        return
    if not texts:
        return
    idx = next((i for i, t in enumerate(texts) if t.lower() == text.lower()), None)
    if idx is None:
        idx = next((i for i, t in enumerate(texts) if text.lower() in t.lower()), None)
    if idx is None:
        print(f"  WARNING: no option '{text}' in {selector}: {texts}")
        return
    try:
        loc.select_option(index=idx, timeout=3000)
        print(f"  Selected '{texts[idx]}' in {selector}")
    except Exception as exc:
        print(f"  WARNING: could not select '{text}': {exc}")


def _scroll_to(page, selector):
    loc = _wait_for(page, selector, max_wait=3)
    if loc is None:
        return
    try:
        loc.scroll_into_view_if_needed()
        time.sleep(0.3)
    except Exception:
        pass


def _scroll_to_items(page):
    _scroll_to(page, "#insertrow")
    _scroll_to(page, "#detailBody")
    _scroll_to(page, "#insertItemRowPR")


def _click_edit_icon(page, row_index):
    row_selector = f"#detailBody tr[id*='{row_index}']"
    row = _wait_for(page, row_selector, max_wait=3)
    if row is None:
        row = _wait_for(page, "#detailBody tr", max_wait=3)
    if row is None:
        return False
    candidates = [
        "a[title*='Edit' i]", "a[class*='edit' i]", "button[title*='Edit' i]",
        "button[class*='edit' i]", "img[title*='Edit' i]", "img[alt*='Edit' i]",
        "span[class*='edit' i]", "[class*='edit-icon' i]", "[class*='pencil' i]",
        "a[onclick*='edit' i]",
    ]
    for sel in candidates:
        try:
            loc = row.locator(sel).first
            if loc.count() > 0 and loc.is_visible():
                loc.click(timeout=2000)
                time.sleep(0.5)
                return True
        except Exception:
            continue
    return False


def _click_itembox_sidebutton(page, row_index):
    angular_candidates = [
        "#itemcodeid ~ button.btnpopup", "button.btnpopup",
        "button:has(mat-icon:has-text('open_in_new'))",
        "input#itemcodeid + button", "input#itemcodeid ~ button",
    ]
    suf = str(row_index)
    legacy_candidates = [
        f"#trditemcode{suf} >> xpath=following::span[@id='popup_item'][1]",
        f"#trditemcode{suf} + span#popup_item",
        f"#trditemcode{suf} ~ span#popup_item",
        f"span#popup_item[onclick*='popupmfgitems']",
        f"#trditemcode{suf} + div.lookup",
        "div.lookup[id*='item' i]", "span.lookupImg1",
    ]

    def _try_candidates(candidates, label):
        for sel in candidates:
            try:
                found = None
                for scope in _scopes(page):
                    try:
                        if ">> xpath=" in sel:
                            base_sel, xpath = sel.split(">> xpath=", 1)
                            base = scope.locator(base_sel.strip()).first
                            if base.count() == 0:
                                continue
                            loc = base.locator(f"xpath={xpath.strip()}").first
                        else:
                            loc = scope.locator(sel).first
                        if loc.count() == 0:
                            continue
                        if loc.is_visible():
                            found = loc
                            try:
                                found.scroll_into_view_if_needed()
                            except Exception:
                                pass
                            clicked = False
                            for _ in range(3):
                                try:
                                    found.click(timeout=2000)
                                    clicked = True
                                    break
                                except Exception:
                                    try:
                                        found.click(force=True, timeout=2000)
                                        clicked = True
                                        break
                                    except Exception:
                                        time.sleep(0.3)
                            if not clicked:
                                try:
                                    found.evaluate("el => el.click()")
                                    clicked = True
                                except Exception:
                                    pass
                            if clicked:
                                time.sleep(0.8)
                                _handle_item_popup(page, row_index)
                                return True
                    except Exception:
                        continue
            except Exception:
                continue
        return False

    has_angular = _wait_for(page, "#itemcodeid", max_wait=1) is not None
    has_legacy = _wait_for(page, f"#trditemcode{suf}", max_wait=1) is not None
    if has_angular and _try_candidates(angular_candidates, "angular"):
        return True
    if has_legacy and _try_candidates(legacy_candidates, "legacy"):
        return True
    if not has_angular and not has_legacy:
        if _try_candidates(angular_candidates, "angular-fallback"):
            return True
        if _try_candidates(legacy_candidates, "legacy-fallback"):
            return True
    return False


def _handle_item_popup(page, row_index):
    popup_selectors = [
        "iframe[src*='popupmfgitems']", "iframe[src*='popup.jsp']",
        ".mat-autocomplete-panel", "[class*='autocomplete']",
        "[class*='popup']", "[role='listbox']", "[role='dialog']",
    ]
    try:
        popup = None
        for _ in range(8):
            for scope in _scopes(page):
                for sel in popup_selectors:
                    try:
                        loc = scope.locator(sel).first
                        if loc.count() == 0 or not loc.is_visible():
                            continue
                        try:
                            txt = loc.inner_text(timeout=500)[:800]
                            if "CRM" in txt and "Finance" in txt:
                                continue
                        except Exception:
                            pass
                        popup = loc
                        break
                    except Exception:
                        continue
                if popup is not None:
                    break
            if popup is not None:
                break
            time.sleep(0.5)
        if popup is None:
            return
        time.sleep(0.5)
        for sel in (".mat-option", "[role='option']", "tr[class*='row']",
                    "td[onclick*='select']"):
            try:
                for scope in _scopes(page):
                    candidates = scope.locator(sel)
                    for i in range(min(candidates.count(), 5)):
                        cand = candidates.nth(i)
                        try:
                            if cand.is_visible():
                                cand.click(timeout=2000)
                                time.sleep(0.6)
                                return
                        except Exception:
                            continue
            except Exception:
                continue
    except Exception:
        pass


def _verify_item(page, index, expected):
    suf = str(index)
    ok = True
    code_loc = _wait_for(page, f"#trditemcode{suf}", max_wait=3)
    actual_code = (code_loc.input_value() if code_loc else "").strip()
    expected_code = str(expected.get("item_code") or "").strip()
    if expected_code and actual_code != expected_code:
        print(f"  VERIFY FAIL row {index}: item code expected {expected_code!r} got {actual_code!r}")
        ok = False
    qty_loc = _wait_for(page, f"#trdqty{suf}", max_wait=3)
    actual_qty = (qty_loc.input_value() if qty_loc else "").strip()
    expected_qty = str(expected.get("qty") or "").strip()
    if expected_qty and actual_qty != expected_qty:
        print(f"  VERIFY FAIL row {index}: qty expected {expected_qty!r} got {actual_qty!r}")
        ok = False
    return ok


# ============================================================================
# SECTION 2 -- BROWSER ENGINE (login, logout, navigation)
# ============================================================================

def _find_sidebar_item(root, label):
    pattern = re.compile(label, re.IGNORECASE)
    best = None
    best_area = float("inf")
    for scope in _scopes(root):
        try:
            items = scope.locator("a,button,li,div,span").filter(has_text=pattern)
            for i in range(items.count()):
                item = items.nth(i)
                try:
                    if not item.is_visible():
                        continue
                    box = item.bounding_box()
                    if not box:
                        continue
                    area = box["width"] * box["height"]
                    if area < best_area:
                        best, best_area = item, area
                except Exception:
                    continue
        except Exception:
            continue
    return best


def _find_by_role(root, role, name_pattern):
    for scope in _scopes(root):
        try:
            loc = scope.get_by_role(role, name=name_pattern)
            for i in range(loc.count()):
                item = loc.nth(i)
                try:
                    if item.is_visible():
                        return item
                except Exception:
                    continue
        except Exception:
            continue
    return None


def _find_visible_item(root, pattern, tags="a,button", container=None):
    for scope in _scopes(root):
        try:
            base = scope.locator(container) if container else scope
            items = base.locator(tags).filter(has_text=pattern)
            for i in range(items.count()):
                item = items.nth(i)
                if item.is_visible():
                    return item
        except Exception:
            continue
    return None


def _wait_for_item(page, label, max_wait=30, interval=1000):
    for _ in range(max_wait):
        item = _find_sidebar_item(page, label)
        if item is not None:
            return item
        try:
            page.wait_for_timeout(interval)
        except Exception:
            break
    return None


def _wait_for_visible(page, pattern, tags="a,button", max_wait=30, interval=1000):
    for _ in range(max_wait):
        item = _find_visible_item(page, pattern, tags=tags)
        if item is not None:
            return item
        try:
            page.wait_for_timeout(interval)
        except Exception:
            break
    return None


def _click_robust(element, max_wait=5):
    try:
        element.scroll_into_view_if_needed()
    except Exception:
        pass
    for attempt in range(max_wait):
        try:
            element.click()
            return True
        except Exception:
            try:
                element.page.wait_for_timeout(500)
            except Exception:
                pass
    try:
        element.click(force=True)
        return True
    except Exception:
        pass
    try:
        element.evaluate("el => el.click()")
        return True
    except Exception:
        pass
    return False


def do_login(page, max_attempts=4):
    for attempt in range(1, max_attempts + 1):
        try:
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            print(f"  Login attempt {attempt}/{max_attempts}: navigation failed")
            try:
                page.wait_for_timeout(5000)
            except Exception:
                pass
            continue
        try:
            page.wait_for_load_state("networkidle")
        except Exception:
            pass
        try:
            page.fill("#floatingInput", USERNAME)
            page.fill("#floatingPassword", PASSWORD)
            page.click("#submitlogin")
        except Exception:
            print(f"  Login attempt {attempt}/{max_attempts}: fill/click failed")
            continue
        for _ in range(30):
            try:
                url = page.url
            except Exception:
                return False
            if HOME_URL_MARKER in url:
                return True
            if LOGIN_FAILURE_URL_MARKER in url:
                break
            try:
                page.wait_for_timeout(1000)
            except Exception:
                break
        try:
            page.wait_for_timeout(4000)
        except Exception:
            pass
        try:
            reason = page.evaluate("() => document.body ? document.body.innerText : ''").lower()
        except Exception:
            reason = ""
        print(f"  Login attempt {attempt}/{max_attempts} failed: {reason[:150]!r}")
        try:
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass
        if "already logged" in reason:
            print("  Another session active. Waiting 60s...")
            try:
                page.wait_for_timeout(60000)
            except Exception:
                pass
        else:
            try:
                page.wait_for_timeout(15000)
            except Exception:
                pass
    return False


def do_logout(page):
    base = LOGIN_URL.rsplit("/Login", 1)[0]
    for path in LOGOUT_PATHS:
        try:
            page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
            if LOGIN_URL in page.url or "loginfailure" in page.url or "Login" in page.url:
                print("  Logged out successfully")
                return
        except Exception:
            continue
    print("  WARNING: could not confirm logout")


def _sidebar_loaded_count(page):
    found = []
    for label in SIDEBAR_LABELS:
        pattern = re.compile(rf"^\s*{re.escape(label)}\s*$", re.IGNORECASE)
        if _find_visible_item(page, pattern, tags="a,button,li,div,span") is not None:
            found.append(label)
    return found


def _wait_for_sidebar_frame(page, max_wait=25):
    for _ in range(max_wait):
        try:
            names = [f.name for f in page.frames]
        except Exception:
            names = []
        if "angularSideNavBar" in names:
            return True
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    return False


def _wait_for_sidebar(page, min_items=2, max_wait=20):
    for _ in range(max_wait):
        found = _sidebar_loaded_count(page)
        if len(found) >= min_items:
            return True, found
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    return False, []


def _reenter_manufacturing(page):
    try:
        tile = page.locator("a:visible").filter(
            has_text=re.compile(r"^\s*Manufacturing\s*$")).first
        if tile.count() > 0:
            tile.locator("xpath=..").click()
            page.wait_for_timeout(8000)
    except Exception:
        pass


def _refresh_and_reenter(page):
    try:
        page.reload(wait_until="domcontentloaded", timeout=60000)
    except Exception:
        pass
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    try:
        page.wait_for_timeout(3000)
    except Exception:
        pass
    _reenter_manufacturing(page)


def select_manufacturing(page, enter_requisition=True):
    context = page.context
    before_pages = set(context.pages)
    before_url = page.url
    tile = None
    for attempt in range(3):
        try:
            tile = page.locator("a:visible").filter(
                has_text=re.compile(r"^\s*Manufacturing\s*$")).first
            if tile.count() == 0:
                raise RuntimeError("Manufacturing tile not present")
            tile.locator("xpath=..").click(timeout=8000)
            break
        except Exception:
            if attempt >= 2:
                tile = None
                break
            try:
                page.reload(wait_until="domcontentloaded", timeout=60000)
                page.wait_for_load_state("networkidle")
                page.wait_for_timeout(3000)
            except Exception:
                pass
    if tile is None:
        print("  FAIL: Manufacturing tile not found on landing page")
        return None

    mfg_page = page
    for _ in range(30):
        new_pages = [p for p in context.pages if p not in before_pages and not p.is_closed()]
        if new_pages:
            mfg_page = new_pages[0]
            break
        if page.url != before_url and HOME_URL_MARKER not in page.url:
            break
        page.wait_for_timeout(500)
    if MANUFACTURING_URL and mfg_page.url != MANUFACTURING_URL and not mfg_page.url.startswith(MANUFACTURING_URL):
        mfg_page.goto(MANUFACTURING_URL, wait_until="domcontentloaded", timeout=60000)
    try:
        mfg_page.wait_for_load_state("networkidle")
    except Exception:
        pass
    print(f"  On Manufacturing page: {mfg_page.url}")

    ready = False
    found = []
    for attempt in range(1, 4):
        if _wait_for_sidebar_frame(mfg_page):
            ready, found = _wait_for_sidebar(mfg_page, max_wait=20)
        if ready:
            break
        print(f"  Sidebar not ready (attempt {attempt}/3)")
        if attempt < 3:
            _refresh_and_reenter(mfg_page)
    if not ready:
        print(f"  FAIL: sidebar never ready: {found}")
        return None

    # Click Procurement
    _wait_for_sidebar_frame(mfg_page)
    proc = _wait_for_item(mfg_page, r"Procurement", max_wait=10)
    if proc is None:
        print("  FAIL: Procurement not found in sidebar")
        return None
    try:
        proc.click()
    except Exception:
        print("  FAIL: could not click Procurement")
        return None
    print("  Selected Procurement")

    if not enter_requisition:
        return mfg_page

    # Click Requisition
    req = _wait_for_item(mfg_page, r"Requisition", max_wait=30)
    if req is None:
        print("  FAIL: Requisition not found")
        return None
    try:
        req.click()
    except Exception:
        print("  FAIL: could not click Requisition")
        return None
    print("  Selected Requisition")
    try:
        mfg_page.wait_for_load_state("networkidle")
    except Exception:
        pass
    mfg_page.wait_for_timeout(3000)

    # Click + Create
    print("  Clicking + Create button...")
    btn = None
    for _ in range(30):
        btn = _find_by_role(mfg_page, "button", re.compile(r"Create", re.IGNORECASE))
        if btn is None:
            btn = _find_sidebar_item(mfg_page, r"\+?\s*\bCreate\b")
        if btn is not None:
            break
        try:
            mfg_page.wait_for_timeout(1000)
        except Exception:
            break
    if btn is None:
        print("  FAIL: Create button not found")
        return None
    _click_robust(btn)
    mfg_page.wait_for_timeout(2000)

    # Select Create from dropdown
    opt = _find_visible_item(
        mfg_page, re.compile(r"^\s*Create\s*$", re.IGNORECASE),
        tags="li,a,button")
    if opt is not None:
        _click_robust(opt)
        mfg_page.wait_for_timeout(1000)
    try:
        mfg_page.wait_for_load_state("networkidle")
    except Exception:
        pass
    mfg_page.wait_for_timeout(3000)
    print("  Create form opened")
    return mfg_page


# ============================================================================
# SECTION 3 -- PR FORM FILLING
# ============================================================================

def fill_requisition(page, data):
    data = data or {}
    _set_value(_wait_for(page, "#TransactionDate"), data.get("transaction_date"))
    _set_value(_wait_for(page, "[name='trhdesc']"), data.get("description"))
    _select_option(page, "#trhtransubtypelviid", data.get("sub_type"))
    _select_option(page, "#trhtrancatid", data.get("category"))
    _select_option(page, "#trhsiteid", data.get("site"))
    _select_option(page, "#trhaccsiteid", data.get("account_site"))
    _set_value(_wait_for(page, "#partyCode"), data.get("party_code"))
    _set_value(_wait_for(page, "#partyDesc"), data.get("party_desc"))
    _select_option(page, "#trhpartyaddress", data.get("party_address"))
    _set_value(_wait_for(page, "[name='trhremarks']"), data.get("remarks"))
    _set_value(_wait_for(page, "#trhcomments"), data.get("comments"))
    return True


def fill_requisition_items(page, items):
    items = items or []
    if not items:
        return True
    n = len(items)
    _scroll_to_items(page)

    rows_control = _wait_for(page, "#insertItemRowPR")
    if rows_control is not None:
        try:
            rows_control.fill(str(n))
        except Exception:
            pass

    btn = _wait_for(page, "#insertrow")
    if btn is None:
        print("  WARNING: Insert Row button not found")
        return False
    try:
        btn.scroll_into_view_if_needed()
    except Exception:
        pass
    try:
        btn.click()
    except Exception:
        try:
            btn.click(force=True)
        except Exception:
            pass
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    time.sleep(2)

    verified = True
    for i, it in enumerate(items):
        _click_edit_icon(page, i)
        _set_value(_wait_for(page, f"#trditemcode{i}"), it.get("item_code"))
        if i == 0:
            ang = _wait_for(page, "#itemcodeid", max_wait=1)
            if ang is not None:
                _set_value(ang, it.get("item_code"))
        _click_itembox_sidebutton(page, i)
        _set_value(_wait_for(page, f"#trditemdesc{i}"), it.get("item_desc"))
        _set_value(_wait_for(page, f"#trdacccode{i}"), it.get("ac_code"))
        _set_value(_wait_for(page, f"#trdreqdate{i}"), it.get("req_date"))
        _select_option(page, f"#trduomcode{i}", it.get("uom"))
        _set_value(_wait_for(page, f"#trdpacksize{i}"), it.get("pack_size"))
        _set_value(_wait_for(page, f"#trdpackquantity{i}"), it.get("pack_qty"))
        _set_value(_wait_for(page, f"#trdqty{i}"), it.get("qty"))
        _set_value(_wait_for(page, f"#trdbaseuomcode{i}"), it.get("base_uom"))
        _set_value(_wait_for(page, f"#trdbaseqty{i}"), it.get("base_qty"))
        _set_value(_wait_for(page, f"#trditemrate{i}"), it.get("rate"))
        _set_value(_wait_for(page, f"#trdamount{i}"), it.get("amount"))
        _set_value(_wait_for(page, f"#trdwtqty{i}"), it.get("weight_qty"))
        _set_value(_wait_for(page, f"#trdponumber{i}"), it.get("po_number"))
        _set_value(_wait_for(page, f"#trdcostcentercode{i}"), it.get("cost_center"))
        _set_value(_wait_for(page, f"#trdremarks{i}"), it.get("remarks"))
        _select_option(page, f"#trdweightuomcode{i}", it.get("weight_uom"))
        _select_option(page, f"#trdlocationtypelviid{i}", it.get("loc_type"))
        _select_option(page, f"#trdlocid{i}", it.get("loc_id"))
        if not _verify_item(page, i, it):
            verified = False
    return verified


# ============================================================================
# SECTION 4 -- PR SAVE / APPROVE
# ============================================================================

def _reload_for_retry(page):
    """Reset browser state before a PR retry attempt."""
    try:
        page.reload(wait_until="domcontentloaded", timeout=60000)
    except Exception:
        pass
    try:
        page.wait_for_timeout(3000)
    except Exception:
        pass


def capture_generated_number(page, extra_text=""):
    parts = []
    if extra_text:
        parts.append(extra_text)
    for f in page.frames:
        try:
            t = f.inner_text("body", timeout=3000)
        except Exception:
            continue
        if t:
            parts.append(t)
    text = "\n".join(parts)
    patterns = (
        r"(?:requisition|req|pr)\s*(?:no|number|id)\.?[:\s-]+([A-Za-z0-9][A-Za-z0-9\-\/]*)",
        r"(?<![A-Za-z0-9])([A-Z]{2,6}\s*/\s*\d{2,4}\s*/\s*[A-Z]{1,5}\s*/\s*\d{3,})(?![A-Za-z0-9])",
        r"(?<![A-Za-z0-9])([A-Z]{2,5}\s*[-\s]\s*\d{5,})(?![A-Za-z0-9])",
        r"(?<![A-Za-z0-9])(\d{6,})(?![A-Za-z0-9])",
    )
    for pattern in patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            value = m.group(1).strip()
            if re.search(r"\d", value):
                return value
    return None


def _get_page_text(page):
    parts = []
    for f in page.frames:
        try:
            t = f.inner_text("body", timeout=3000)
        except Exception:
            continue
        if t:
            parts.append(t)
    return "\n".join(parts)


def _read_status(page):
    text = _get_page_text(page)
    m = re.search(
        r"Status\s*(?:[:\s]|\n)+\s*(Released|Approved|Draft|Rejected|Submitted|Pending|Cancelled)\b",
        text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    for status in ("Approved", "Released", "Draft", "Rejected", "Submitted", "Pending"):
        if re.search(rf"\b{status}\b", text, re.IGNORECASE):
            return status
    return None


def fill_and_save_draft(page, data):
    fill_requisition(page, data)
    fill_requisition_items(page, data.get("items", []))
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/filled_form.png", full_page=True)
    except Exception:
        pass

    save = _wait_for_visible(page, re.compile(r"^\s*(Save\b|Save\s*as\s*Draft)\s*$", re.IGNORECASE),
                             tags="button,a", max_wait=10)
    if save is None:
        print("  FAIL: Save Draft button not found")
        return None

    dialog_msg = []
    def _on_dialog(dlg):
        try:
            dialog_msg.append(dlg.message)
        except Exception:
            pass
        try:
            dlg.accept()
        except Exception:
            try:
                dlg.dismiss()
            except Exception:
                pass
    try:
        page.once("dialog", _on_dialog)
    except Exception:
        pass

    if not _click_robust(save):
        print("  FAIL: could not click Save Draft")
        return None
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    try:
        page.wait_for_timeout(3000)
    except Exception:
        pass
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/requisition_saved.png", full_page=True)
    except Exception:
        pass

    try:
        if page.is_closed():
            live = [p for p in page.context.pages if not p.is_closed()]
            if live:
                page = live[0]
    except Exception:
        pass

    req_no = capture_generated_number(page, extra_text="\n".join(dialog_msg))
    return req_no


def approve_if_not_approved(page, requisition_no):
    print(f"  Checking / approving requisition {requisition_no}...")

    status = _read_status(page)
    if status and status.lower() == "approved":
        print("  Status is already Approved")
        return True

    # Click Edit
    edit_btn = _wait_for_visible(page, re.compile(r"^\s*Edit\s*$", re.IGNORECASE),
                                 tags="button,a", max_wait=10)
    if edit_btn is not None:
        _click_robust(edit_btn)
        try:
            page.wait_for_load_state("networkidle")
        except Exception:
            pass
        page.wait_for_timeout(2000)

    # Click Approve
    approve_btn = _wait_for_visible(page, re.compile(r"^\s*Approve\s*$", re.IGNORECASE),
                                    tags="button,a", max_wait=10)
    if approve_btn is None:
        print("  WARNING: Approve button not found")
        return False

    dialog_msg = []
    def _on_dialog(dlg):
        try:
            dialog_msg.append(dlg.message)
        except Exception:
            pass
        try:
            dlg.accept()
        except Exception:
            pass
    try:
        page.once("dialog", _on_dialog)
    except Exception:
        pass

    _click_robust(approve_btn)
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(3000)

    new_status = _read_status(page)
    body = _get_page_text(page)
    if dialog_msg:
        body = "\n".join(dialog_msg) + "\n" + body

    if new_status and new_status.lower() == "approved":
        print(f"  Approved (Status={new_status!r})")
        return True
    if re.search(r"\bApproved\b", body, re.IGNORECASE):
        print("  Approved (marker on page)")
        return True
    convert = _find_visible_item(page, re.compile(r"Convert\s+to\s+P[OQ]", re.IGNORECASE),
                                 tags="button,a")
    if convert is not None:
        print("  Approved (Convert to PO/PQ visible)")
        return True
    print(f"  WARNING: could not confirm approval; Status={new_status!r}")
    return False


# ============================================================================
# SECTION 5 -- PO CREATION FROM PR
# ============================================================================

def _pick(locators, page):
    for selector in locators:
        loc = _wait_for(page, selector, max_wait=3)
        if loc is not None:
            try:
                if loc.is_visible():
                    return loc
            except Exception:
                return loc
    return None


def fill_po_header(page, header):
    header = header or {}
    for key, spec in PO_FIELDS.items():
        value = (header.get(key) or "").strip() or spec.get("default")
        if not value:
            continue
        loc = _pick(spec["selectors"], page)
        if loc is None:
            print(f"  SKIP PO header '{key}': no matching field found")
            continue
        tag = ""
        try:
            tag = loc.evaluate("el => el.tagName.toLowerCase()")
        except Exception:
            pass
        if tag == "select":
            _select_option(page, spec["selectors"][0], value)
        else:
            _set_value(loc, value)
        print(f"  PO header '{key}' = {value!r}")
    return True


def create_po_from_pr(page, po_data, pr_from="01/01/2026", pr_to="31/12/2026", requisition_no=None):
    """Navigate to Purchase Order > Create from PR, search for approved PRs,
    select the first one, and submit the generated PO."""
    header = po_data.get("header") or {}
    items = po_data.get("items") or []

    # Click Purchase Order in sidebar
    po = _wait_for_item(page, r"Purchase Order", max_wait=15)
    if po is None:
        print("  FAIL: Purchase Order not found in sidebar")
        return False
    po.click()
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass

    # Click + Create
    create_btn = None
    for _ in range(20):
        create_btn = _find_by_role(page, "button", re.compile(r"Create", re.IGNORECASE))
        if create_btn is None:
            create_btn = _find_sidebar_item(page, r"\+?\s*\bCreate\b")
        if create_btn is not None:
            break
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    if create_btn is None:
        print("  FAIL: + Create button not found")
        return False
    if not _click_robust(create_btn):
        print("  FAIL: could not click + Create")
        return False
    page.wait_for_timeout(1500)

    # Click "Create from PR"
    from_pr = _wait_for_visible(page, re.compile(r"Create from PR", re.IGNORECASE),
                                tags="li,a,button,span", max_wait=10)
    if from_pr is None:
        print("  FAIL: 'Create from PR' option not found")
        return False
    if not _click_robust(from_pr):
        print("  FAIL: could not click 'Create from PR'")
        return False
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(1500)

    # Set Status = Approved
    for sel in ("select[name='trhstatuslviid']", "select[name*='status']"):
        loc = _wait_for(page, sel, max_wait=5)
        if loc is not None:
            try:
                loc.select_option(label="Approved")
                print("  Status set to Approved")
                break
            except Exception:
                try:
                    loc.select_option(index=0)
                    break
                except Exception:
                    pass

    # Set date range
    for name, val in [("s_FromDate", pr_from), ("s_ToDate", pr_to)]:
        loc = _wait_for(page, f"input[name='{name}']", max_wait=3)
        if loc is not None:
            _set_value(loc, val)
            print(f"  Set {name} = {val}")

    # Click Search
    search_btn = _wait_for(page, "button:has-text('Search')", max_wait=5)
    if search_btn is None:
        for scope in _scopes(page):
            try:
                for b in scope.locator("button").all():
                    if b.is_visible() and "search" in (b.inner_text() or "").lower():
                        search_btn = b
                        break
                if search_btn:
                    break
            except Exception:
                continue
    if search_btn is None:
        print("  FAIL: Search button not found")
        return False
    try:
        search_btn.click()
    except Exception:
        search_btn.click(force=True)
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    time.sleep(3)

    # Select the PR row matching requisition_no (fall back to first row)
    checkbox = None
    if requisition_no:
        target = str(requisition_no).strip()
        for scope in _scopes(page):
            try:
                rows = scope.locator("table tbody tr")
                for i in range(rows.count()):
                    row = rows.nth(i)
                    try:
                        if not row.is_visible():
                            continue
                        txt = (row.inner_text(timeout=1500) or "")
                        if target in txt:
                            cb = row.locator("input[type='checkbox']")
                            if cb.count() > 0:
                                checkbox = cb.first
                                break
                    except Exception:
                        continue
                if checkbox is not None:
                    break
            except Exception:
                continue
        if checkbox is not None:
            print(f"  Found PR row containing {target}")
    if checkbox is None:
        print(f"  NOTE: could not locate row for PR {requisition_no}, selecting first row")
        for sel in ("table tbody tr:first-child input[type='checkbox']",
                    "table tbody tr:first-child td input[type='checkbox']"):
            checkbox = _wait_for(page, sel, max_wait=3)
            if checkbox is not None:
                break
        if checkbox is None:
            for scope in _scopes(page):
                try:
                    cbs = scope.locator("table input[type='checkbox']")
                    if cbs.count() > 0:
                        checkbox = cbs.first
                        break
                except Exception:
                    continue
    if checkbox is None:
        print("  FAIL: Could not find checkbox to select PR row")
        return False
    try:
        checkbox.click()
    except Exception:
        checkbox.click(force=True)
    print("  Selected PR row")

    # Click Create PO
    create_po_btn = None
    for sel in ("button:has-text('Create PO')", "button:text-is('Create PO')"):
        create_po_btn = _wait_for(page, sel, max_wait=5)
        if create_po_btn is not None:
            break
    if create_po_btn is None:
        for scope in _scopes(page):
            try:
                for b in scope.locator("button").all():
                    if b.is_visible() and "create po" in (b.inner_text() or "").lower():
                        create_po_btn = b
                        break
                if create_po_btn:
                    break
            except Exception:
                continue
    if create_po_btn is None:
        print("  FAIL: Create PO button not found")
        return False
    try:
        create_po_btn.click()
    except Exception:
        create_po_btn.click(force=True)
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    time.sleep(5)
    print("  Clicked Create PO")

    # Fill PO header + items
    fill_po_header(page, header)
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/po_filled.png", full_page=True)
    except Exception:
        pass

    # Submit - scroll into view + robust click
    submit_btn = _wait_for(page, "button:has-text('Submit')", max_wait=10)
    if submit_btn is None:
        for scope in _scopes(page):
            try:
                for b in scope.locator("button").all():
                    if b.is_visible() and "submit" in (b.inner_text() or "").lower():
                        submit_btn = b
                        break
                if submit_btn:
                    break
            except Exception:
                continue
    if submit_btn is None:
        print("  FAIL: Submit button not found")
        return False
    try:
        submit_btn.scroll_into_view_if_needed()
    except Exception:
        pass
    time.sleep(1)
    try:
        submit_btn.click()
    except Exception:
        try:
            submit_btn.click(force=True)
        except Exception:
            try:
                submit_btn.evaluate("el => el.click()")
            except Exception:
                print("  FAIL: could not click Submit")
                return False
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    time.sleep(5)

    print("  SUCCESS: Purchase Order created from PR")
    return True


# ============================================================================
# SECTION 6 -- MAIN PIPELINE
# ============================================================================

# Max attempts to create+approve the PR before giving up. On a PR failure we
# retry ONLY the requisition; we never redo the PO (a PR that already passed
# is not re-run).
MAX_PR_ATTEMPTS = int(os.environ.get("PR_MAX_ATTEMPTS", "3"))
PR_RETRY_DELAY = int(os.environ.get("PR_RETRY_DELAY", "60"))


def run(item_code, qty, po_type="Domestic", currency="INR"):
    """End-to-end: create PR -> approve -> create PO.

    If PR creation/approval fails it is retried up to MAX_PR_ATTEMPTS.
    Only after the PR succeeds is the PO created (never re-run on PR retries).
    """
    today = datetime.now().strftime("%d/%m/%Y")
    qty_str = str(qty)

    pr_data = {
        "description": f"PR for {item_code}",
        "transaction_date": today,
        "sub_type": "Direct",
        "category": "2627-PR-2627-PR",
        "site": "ADROIT DEWAS-Adroit Industries India Ltd",
        "account_site": "ADROIT DEWAS",
        "party_code": "", "party_desc": "", "party_address": "",
        "remarks": f"Auto PR for {item_code} qty {qty_str}",
        "comments": "",
        "items": [{
            "item_code": item_code,
            "item_desc": item_code,
            "ac_code": "",
            "req_date": today,
            "uom": "NOS",
            "pack_size": "", "pack_qty": "",
            "qty": qty_str,
            "base_uom": "NOS",
            "base_qty": qty_str,
            "rate": "", "amount": "",
        }],
    }

    po_data = {
        "header": {"po_type": po_type, "currency": currency},
        "items": [{
            "item_code": item_code,
            "item_desc": item_code,
            "qty": qty_str,
            "uom": "NOS", "base_uom": "NOS", "base_qty": qty_str,
        }],
    }

    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    from playwright.sync_api import sync_playwright

    headless = os.environ.get("HEADLESS", "true").lower() not in ("false", "0", "no")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, args=["--start-maximized"] if not headless else [])
        context = browser.new_context(no_viewport=True)
        page = context.new_page()

        try:
            # 1. Login
            print("\n[1/4] Logging in...")
            if not do_login(page):
                print("FAIL: login failed")
                return False

            # 2. Create + approve PR, retrying on failure (PR only).
            req_no = None
            last_pr_err = ""
            for attempt in range(1, MAX_PR_ATTEMPTS + 1):
                print(f"\n[2/4] Creating Requisition for {item_code} "
                      f"(qty {qty_str}) [attempt {attempt}/{MAX_PR_ATTEMPTS}]...")
                mfg_page = select_manufacturing(page, enter_requisition=True)
                if mfg_page is None:
                    last_pr_err = "could not reach requisition form"
                    print(f"  FAIL: {last_pr_err}")
                    if attempt < MAX_PR_ATTEMPTS:
                        _reload_for_retry(page)
                        time.sleep(PR_RETRY_DELAY)
                    continue

                req_no = fill_and_save_draft(mfg_page, pr_data)
                if not req_no:
                    last_pr_err = "could not save requisition draft"
                    print(f"  FAIL: {last_pr_err}")
                    if attempt < MAX_PR_ATTEMPTS:
                        _reload_for_retry(page)
                        time.sleep(PR_RETRY_DELAY)
                    continue
                print(f"  Requisition saved: {req_no}")

                # 3. Approve PR
                print(f"\n[3/4] Approving Requisition {req_no}...")
                approved = approve_if_not_approved(mfg_page, req_no)
                if not approved:
                    last_pr_err = "approval could not be confirmed"
                    print(f"  WARNING: {last_pr_err}, retrying requisition...")
                    if attempt < MAX_PR_ATTEMPTS:
                        _reload_for_retry(page)
                        time.sleep(PR_RETRY_DELAY)
                    continue
                print(f"  Requisition {req_no} approved")
                break

            if not req_no or not approved:
                print(f"  FAIL: requisition not created/approved after "
                      f"{MAX_PR_ATTEMPTS} attempts ({last_pr_err})")
                print("\n" + "=" * 50)
                print(f"  Requisition: FAILED ({last_pr_err})")
                print("  Purchase Order: NOT attempted")
                print("  RESULT: FAILED")
                print("=" * 50)
                return False

            # 4. Create PO (only after the PR succeeded; never re-run on retries).
            print(f"\n[4/4] Creating Purchase Order from PR {req_no}...")
            mfg_page2 = select_manufacturing(page, enter_requisition=False)
            if mfg_page2 is None:
                print("FAIL: could not reach Manufacturing for PO")
                print("\n" + "=" * 50)
                print(f"  Requisition: {req_no} (Approved)")
                print("  Purchase Order: FAILED (could not reach PO form)")
                print("  RESULT: PARTIAL (PR created, PO failed)")
                print("=" * 50)
                return False

            po_ok = create_po_from_pr(mfg_page2, po_data, requisition_no=req_no)

            print("\n" + "=" * 50)
            if po_ok:
                print(f"  Requisition: {req_no} (Approved)")
                print(f"  Purchase Order: Created")
                print(f"  Item: {item_code}, Qty: {qty_str}")
                print("  RESULT: SUCCESS")
            else:
                print(f"  Requisition: {req_no}")
                print("  Purchase Order: FAILED")
                print("  RESULT: PARTIAL (PR created, PO failed)")
            print("=" * 50)
            return po_ok

        except KeyboardInterrupt:
            print("\nInterrupted by user.")
            return False
        except Exception as e:
            print(f"\nERROR: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            print("\nLogging out...")
            try:
                do_logout(page)
            except Exception:
                pass
            try:
                browser.close()
            except Exception:
                pass


def main():
    parser = argparse.ArgumentParser(
        description="TCS iON Combined PR + PO Bot")
    parser.add_argument("--item-code", required=True,
                        help="Item code (e.g. PCPWB60132)")
    parser.add_argument("--qty", required=True, type=int,
                        help="Quantity (e.g. 50)")
    parser.add_argument("--po-type", default="Domestic",
                        help="PO Type (default: Domestic)")
    parser.add_argument("--currency", default="INR",
                        help="Currency (default: INR)")
    args = parser.parse_args()
    ok = run(args.item_code, args.qty, args.po_type, args.currency)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
