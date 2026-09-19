import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT_DIR = Path(__file__).resolve().parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
LOG_DIR = PROJECT_DIR / "logs"
DATA_DIR = PROJECT_DIR / "data"

SCREENSHOT_DIR = LOG_DIR / "screenshots"
HOME_URL_MARKER = "TCSiONHome"
LOGIN_FAILURE_URL_MARKER = "loginfailure"


def load_env(path: str = ".env") -> None:
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


load_env()

USERNAME = os.environ.get("TCS_USERNAME")
PASSWORD = os.environ.get("TCS_PASSWORD")

LOGIN_URL = os.environ.get("TCS_Loginpage", "https://training.tcsion.com/Login/Login.html")
HOME_URL = os.environ.get("TCS_Homepages", "https://mfg3.tcsion.com/TCSiONHome/Home")
MANUFACTURING_URL = os.environ.get("TCS_Manufacturingpage")

if not USERNAME or not PASSWORD:
    raise SystemExit("TCS_USERNAME and TCS_PASSWORD environment variables are required")


def do_login(page, max_attempts=4) -> bool:
    for attempt in range(1, max_attempts + 1):
        try:
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            print(f"Login attempt {attempt}/{max_attempts}: page navigation failed, retrying...")
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
            print(f"Login attempt {attempt}/{max_attempts}: fill/click failed, page may be stale")
            continue

        reached_failure = False
        for _ in range(30):
            try:
                url = page.url
            except Exception:
                print(f"Login attempt {attempt}/{max_attempts}: page closed unexpectedly")
                return False
            if HOME_URL_MARKER in url:
                return True
            if LOGIN_FAILURE_URL_MARKER in url:
                reached_failure = True
                break
            try:
                page.wait_for_timeout(1000)
            except Exception:
                break
        else:
            reached_failure = False

        if not reached_failure:
            print(f"Login attempt {attempt}/{max_attempts}: timed out waiting for home page, retrying...")
            try:
                page.wait_for_timeout(2000)
            except Exception:
                pass
            continue

        try:
            page.wait_for_timeout(4000)
        except Exception:
            pass
        try:
            reason = page.evaluate("() => document.body ? document.body.innerText : ''").lower()
        except Exception:
            reason = ""
        if not reason.strip():
            try:
                reason = (page.title() or "").lower()
            except Exception:
                pass
        print(f"Login attempt {attempt}/{max_attempts} failed. Redirecting to login page...")
        try:
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass
        if "already logged" in reason:
            print(f"Login attempt {attempt}/{max_attempts}: another session is active. Waiting 60s...")
            try:
                page.wait_for_timeout(60000)
            except Exception:
                pass
        else:
            print(f"Login attempt {attempt}/{max_attempts} rejected. Server response: {reason[:200]!r}")
            try:
                page.wait_for_timeout(15000)
            except Exception:
                pass
    return False


def _frame_scopes(root):
    scopes = [root]
    try:
        scopes += [f for f in root.frames]
    except Exception:
        pass
    try:
        scopes += [f for f in root.child_frames]
    except Exception:
        pass
    return scopes


def _find_sidebar_item(root, label):
    pattern = re.compile(label, re.IGNORECASE)
    tags = "a,button,li,div,span"
    best = None
    best_area = float("inf")
    for scope in _frame_scopes(root):
        try:
            items = scope.locator(tags).filter(has_text=pattern)
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
    """Use Playwright's accessibility tree (get_by_role) which computes the
    accessible name correctly even when the visible text is split across
    nested icon/span elements - more robust than raw text matching for
    custom-component buttons."""
    for scope in _frame_scopes(root):
        try:
            loc = scope.get_by_role(role, name=name_pattern)
            n = loc.count()
            for i in range(n):
                item = loc.nth(i)
                try:
                    if item.is_visible():
                        return item
                except Exception:
                    continue
        except Exception:
            continue
    return None


def _debug_dump_candidates(page, label, max_items=8):
    """Diagnostic aid for when nothing matches: report concrete info (tag,
    visibility, bounding box, text) for elements whose text loosely contains
    the label, so a genuine 'not on the page' case can be told apart from a
    matching/visibility quirk."""
    pattern = re.compile(label, re.IGNORECASE)
    print(f"--- Debug dump: elements matching /{label}/i ---")
    total = 0
    for scope in _frame_scopes(page):
        try:
            items = scope.locator("a,button,li,div,span,i").filter(has_text=pattern)
            n = items.count()
        except Exception as e:
            print(f"  (scope error: {e})")
            continue
        for i in range(min(n, max_items)):
            total += 1
            item = items.nth(i)
            try:
                tag = item.evaluate("el => el.tagName")
            except Exception:
                tag = "?"
            try:
                visible = item.is_visible()
            except Exception:
                visible = "?"
            try:
                box = item.bounding_box()
            except Exception:
                box = None
            try:
                text = item.inner_text()[:60].replace("\n", " ")
            except Exception:
                text = "?"
            print(f"  [{tag}] visible={visible} box={box} text={text!r}")
    if total == 0:
        print("  (no elements found containing this text in any frame)")
    print("--- end debug dump ---")


def _find_visible_item(root, pattern, tags="a,button", container=None):
    for scope in _frame_scopes(root):
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


SIDEBAR_LABELS = ["Home", "Procurement", "Inventory", "Engineering", "Master", "Import/Export", "Reports"]


def _sidebar_loaded_count(page):
    found = []
    for label in SIDEBAR_LABELS:
        pattern = re.compile(rf"^\s*{re.escape(label)}\s*$", re.IGNORECASE)
        if _find_visible_item(page, pattern, tags="a,button,li,div,span") is not None:
            found.append(label)
    return found


def _wait_for_sidebar(page, min_items=2, max_wait=20, interval=1000):
    """Wait until the left nav looks fully rendered rather than just checking
    for one item - a partially-loaded sidebar (e.g. only Home/Sales visible)
    should be treated as 'not ready' and reloaded, not silently searched.
    Patched 2026-08-26: lowered from 4 to 2 for the current tenant's
    truncated new-UI sidebar (Procurement/Inventory only) so retry can proceed
    to popup sidebutton test; original 4 was too strict for today's slow SPA."""
    found = []
    for _ in range(max_wait):
        found = _sidebar_loaded_count(page)
        if len(found) >= min_items:
            return True, found
        try:
            page.wait_for_timeout(interval)
        except Exception:
            break
    return False, found


def _wait_for_sidebar_frame(page, max_wait=25, interval=1000):
    """Wait for the Angular sidebar frame to be attached. The new-UI sidebar
    lives in a frame named 'angularSideNavBar' that loads asynchronously
    after the Manufacturing tile is clicked; reloading the page before it
    appears makes the SPA fail to re-render the sidebar."""
    for _ in range(max_wait):
        try:
            names = [f.name for f in page.frames]
        except Exception:
            names = []
        if "angularSideNavBar" in names:
            return True
        try:
            page.wait_for_timeout(interval)
        except Exception:
            break
    return False


def _click_robust(element, max_wait=5):
    """Find the actual clickable element matching text and click it, falling
    back to a force click and the JS click() when needed."""
    try:
        element.scroll_into_view_if_needed()
    except Exception:
        pass
    for attempt in range(max_wait):
        try:
            element.click()
            return True
        except Exception:
            page = element.page
            try:
                page.wait_for_timeout(500)
            except Exception:
                pass
            continue
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


def open_create_form(page) -> bool:
    print("Clicking + Create button...")
    btn = None
    for _ in range(30):
        btn = _find_by_role(page, "button", re.compile(r"Create", re.IGNORECASE))
        if btn is None:
            btn = _find_sidebar_item(page, r"\+?\s*\bCreate\b")
        if btn is not None:
            break
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    if btn is None:
        print("WARNING: Create button not found")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/create_button_not_found.png", full_page=True)
        except Exception:
            pass
        _debug_dump_candidates(page, r"Create")
        return False

    try:
        print(f"Found Create button: tag={btn.evaluate('el=>el.tagName')} "
              f"text={btn.inner_text()!r} box={btn.bounding_box()}")
    except Exception:
        pass

    before_url = page.url
    clicked = _click_robust(btn)
    print("Create button clicked" if clicked else "WARNING: click reported failure")
    page.wait_for_timeout(2000)

    print("Checking for a Create dropdown option...")
    opt = None
    for container in [".dropdown-menu", ".dropdown", ".menu", ".popover"]:
        opt = _find_visible_item(
            page, re.compile(r"^\s*Create\s*$", re.IGNORECASE), tags="li,a,button", container=container
        )
        if opt is not None:
            break
    if opt is None:
        opt = _find_visible_item(page, re.compile(r"^\s*Create\s*$", re.IGNORECASE), tags="li,a,button")

    if opt is not None:
        _click_robust(opt)
        print("Selected Create from dropdown")
        page.wait_for_timeout(1000)
    else:
        # Some UI variants open the form directly from the "+ Create" button
        # itself, with no separate dropdown item - that's not necessarily a
        # failure, so fall through to verifying the form actually opened.
        print("No separate dropdown item found - checking whether the form opened directly...")

    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(3000)

    # Verify success rather than assuming the click worked: look for a form
    # control (Save/Submit) or a URL change away from the results list.
    form_marker = _wait_for_visible(
        page, re.compile(r"^\s*(Save|Submit|Save as Draft)\s*$", re.IGNORECASE), tags="button,a", max_wait=5
    )
    url_changed = page.url != before_url

    page.screenshot(path=f"{SCREENSHOT_DIR}/create_form.png", full_page=True)

    if opt is None and form_marker is None and not url_changed:
        print("WARNING: Create form does not appear to have opened")
        return False

    print("Create form opened")
    return True


def _reenter_manufacturing(page):
    try:
        tile = page.locator("a:visible").filter(has_text=re.compile(r"^\s*Manufacturing\s*$")).first
        if tile.count() > 0:
            card = tile.locator("xpath=..")
            card.click()
            page.wait_for_timeout(8000)
            print("Re-entered Manufacturing after refresh")
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


def select_procurement(page, enter_requisition=True) -> bool:
    # Wait for the Angular sidebar frame to attach (reloading the SPA would
    # prevent the sidebar from re-rendering), then for the sidebar to become
    # visible. The new-UI sidebar exposes exactly: Home, Procurement,
    # Inventory, Engineering, Master, Import/Export, Reports.
    _wait_for_sidebar_frame(page)
    ready, found = _wait_for_sidebar(page, max_wait=30)
    if not ready:
        print(f"Sidebar never became ready: found {found} out of {SIDEBAR_LABELS}")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/sidebar_incomplete.png", full_page=True)
        except Exception:
            pass
        return False

    print(f"Selecting Procurement (sidebar: {found})...")
    proc = _wait_for_item(page, r"Procurement")
    if proc is None:
        print("Procurement not found in sidebar")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/procurement_not_found.png", full_page=True)
        except Exception:
            pass
        return False
    try:
        proc.click()
    except Exception:
        print("WARNING: could not click Procurement")
        return False
    print("Selected Procurement")

    if not enter_requisition:
        # Caller only needs the Procurement sidebar (e.g. PO bot, which locates
        # "Purchase Order" itself). Stop here so we don't open a PR create form.
        return True

    req = _wait_for_item(page, r"Requisition", max_wait=30)
    if req is None:
        print("Requisition not found")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/requisition_not_found.png", full_page=True)
        except Exception:
            pass
        return False
    try:
        req.click()
    except Exception:
        print("WARNING: could not click Requisition")
        return False
    print("Selected Requisition")
    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(3000)
    page.screenshot(path=f"{SCREENSHOT_DIR}/procurement.png", full_page=True)

    if not open_create_form(page):
        print("WARNING: could not open Create form")
        return False
    return True


def select_manufacturing(page, enter_requisition=True):
    context = page.context
    before_pages = set(context.pages)
    before_url = page.url
    # The Manufacturing tile only exists on the portal landing page. After a
    # previous row's flow we may still be inside the Manufacturing SPA (same
    # URL), so if the tile cannot be found, reload to return to the landing
    # page and retry.
    tile = None
    for attempt in range(3):
        try:
            tile = page.locator("a:visible").filter(has_text=re.compile(r"^\s*Manufacturing\s*$")).first
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
        print("WARNING: Manufacturing tile not found on landing page")
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
    print(f"On Manufacturing page: {mfg_page.url}")
    mfg_page.screenshot(path=f"{SCREENSHOT_DIR}/manufacturing.png", full_page=True)

    # The new-UI sidebar loads in the 'angularSideNavBar' frame. Wait for the
    # frame and enough visible labels; if the SPA fails to render the sidebar,
    # reload and re-click the Manufacturing tile (no more than 3 attempts).
    ready = False
    found = []
    for attempt in range(1, 4):
        if _wait_for_sidebar_frame(mfg_page):
            ready, found = _wait_for_sidebar(mfg_page, max_wait=20)
        if ready:
            break
        print(f"Sidebar not ready (attempt {attempt}/3): found {found}. "
              "Reloading and re-entering Manufacturing...")
        if attempt < 3:
            _refresh_and_reenter(mfg_page)
            try:
                mfg_page.wait_for_load_state("networkidle")
            except Exception:
                pass
    if not ready:
        print(f"WARNING: sidebar never became ready: found {found} out of {SIDEBAR_LABELS}")
        mfg_page.screenshot(path=f"{SCREENSHOT_DIR}/sidebar_not_ready.png", full_page=True)
        return None

    if not select_procurement(mfg_page, enter_requisition=enter_requisition):
        print("WARNING: Procurement/Requisition flow failed")
        return None
    try:
        mfg_page.wait_for_load_state("networkidle")
    except Exception:
        pass
    print(f"After selecting Procurement: {mfg_page.url}")

    return mfg_page


def ensure_home(page) -> bool:
    if page.url != HOME_URL and not page.url.startswith(HOME_URL):
        page.goto(HOME_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_load_state("networkidle")
    while LOGIN_URL in page.url or LOGIN_FAILURE_URL_MARKER in page.url:
        print("Session expired; logging in again.")
        if not do_login(page):
            return False
        page.goto(HOME_URL, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_load_state("networkidle")
    return True


LOGOUT_PATHS = [
    "/Login/logout",
    "/Login/Logout",
    "/Logout",
    "/logout",
    "/Login/Login.html?logout=true",
]


def do_logout(page) -> None:
    base = LOGIN_URL.rsplit("/Login", 1)[0]
    for path in LOGOUT_PATHS:
        try:
            page.goto(base + path, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(1500)
            if LOGIN_URL in page.url or "loginfailure" in page.url or "Login" in page.url:
                print(f"Logged out via {path} -> {page.url}")
                return
        except Exception:
            continue
    print("WARNING: could not confirm logout")


def run_once(page) -> bool:
    extra = [p for p in page.context.pages if p != page]
    for p in extra:
        if not p.is_closed():
            p.close()

    if not ensure_home(page):
        return False

    page.screenshot(path=f"{SCREENSHOT_DIR}/postlogin.png", full_page=True)

    mfg_page = select_manufacturing(page)
    if mfg_page is None:
        print("Workflow did not reach the Create form")
        return False
    for p in page.context.pages:
        if p is not mfg_page and not p.is_closed():
            p.close()
    return True


def navigate_to_requisition_form(page) -> bool:
    """Ensure we are on the requisition Create form, re-entering through the
    portal if the session was lost. Returns True when the form is open."""
    if not ensure_home(page):
        return False
    mfg_page = select_manufacturing(page)
    if mfg_page is None:
        return False
    for p in page.context.pages:
        if p is not mfg_page and not p.is_closed():
            p.close()
    return True


def fill_and_save_draft(page, data) -> str:
    """Fill the opened requisition form from ``data`` and save a draft.
    Returns the generated requisition number, or None on failure."""
    from fill_requisition import fill_requisition, fill_requisition_items

    ok = fill_requisition(page, data)
    items_ok = fill_requisition_items(page, data.get("items", []))
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/filled_form.png", full_page=True)
    except Exception:
        pass

    save = _wait_for_visible(page, re.compile(r"^\s*(Save\b|Save\s*as\s*Draft)\s*$", re.IGNORECASE), tags="button,a", max_wait=10)
    if save is None:
        print("WARNING: Save Draft button not found")
        return None

    # Capture any JS alert/confirm shown during save (TCS iON reports the
    # generated requisition number in a dialog).
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
        print("WARNING: could not click Save Draft")
        return None

    # The portal occasionally closes the tab right after a successful save.
    # Wrap post-save waits so a closed page does not crash the pipeline.
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

    # If the original page closed during save, fall back to any live page.
    try:
        if page.is_closed():
            live = [p for p in page.context.pages if not p.is_closed()]
            if live:
                page = live[0]
                print("  Post-save page closed; continuing on:", page.url)
    except Exception:
        pass

    req_no = capture_generated_number(page, extra_text="\n".join(dialog_msg))
    if not req_no:
        # Diagnostic dump so the post-save page state can be inspected.
        try:
            parts = []
            for f in page.frames:
                try:
                    t = f.inner_text("body", timeout=3000)
                except Exception:
                    continue
                if t:
                    parts.append(f"[{f.name}] {t}")
            text = "\n".join(parts)
            (LOG_DIR / "save_after_body.txt").write_text(text, encoding="utf-8")
            print(f"[debug] post-save page text written to logs/save_after_body.txt "
                  f"({len(text)} chars); dialogs={dialog_msg!r}; URL={page.url}")
        except Exception as exc:
            print(f"[debug] could not dump post-save body: {exc}")
    return req_no


def capture_generated_number(page, extra_text="") -> str:
    """Try to read a generated Requisition No off the page after saving,
    including any JS dialog/alert message text captured during the save.
    Scans every frame because the form lives inside an iframe (layout.jsp)."""
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



def _get_page_text(page) -> str:
    """Collect visible body text from the main page and all frames."""
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
    """Read the current Requisition Status value from the detail/view/edit form.
    Matches labels like 'Status' followed by Released / Approved / etc."""
    text = _get_page_text(page)
    # Prefer explicit "Status <value>" patterns seen in the UI screenshots.
    m = re.search(
        r"Status\s*(?:[:\s]|\n)+\s*(Released|Approved|Draft|Rejected|Submitted|Pending|Cancelled|Canceled)\b",
        text,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip()
    # Fallback: look near common status dropdown / label text.
    for status in ("Approved", "Released", "Draft", "Rejected", "Submitted", "Pending"):
        if re.search(rf"\b{status}\b", text, re.IGNORECASE):
            return status
    return None


def _open_requisition_from_list(page, requisition_no: str) -> bool:
    """From the Requisition results list (or any page showing the number),
    click the Requisition Number link/row to open the detail view."""
    # Prefer an exact link/anchor match for the requisition number (as in the
    # Results table: ADPL/2627/PR/0622 is a clickable link).
    link = None
    for _ in range(25):
        link = _find_visible_item(
            page,
            re.compile(re.escape(requisition_no), re.IGNORECASE),
            tags="a,td,span,div,tr",
        )
        if link is not None:
            break
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    if link is None:
        print(f"WARNING: requisition {requisition_no} not found in list/view")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/req_not_found_in_list.png", full_page=True)
        except Exception:
            pass
        return False

    if not _click_robust(link):
        print(f"WARNING: could not click requisition row/link for {requisition_no}")
        return False

    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(2500)
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/req_detail_opened.png", full_page=True)
    except Exception:
        pass
    return True


def approve_if_not_approved(page, requisition_no: str) -> bool:
    """If the requisition status is not already Approved, follow the UI flow
    from the screenshots:

      1. Open the requisition from the Results list (click Requisition Number).
      2. On the detail view (Status e.g. Released) click **Edit**.
      3. On the editable form click **Approve**.
      4. Confirm status becomes **Approved** (Convert to PO / Convert to PQ
         buttons appear).

    Returns True when status is (or becomes) Approved.
    """
    print(f"Checking / approving requisition {requisition_no}...")

    # Ensure we are looking at the target requisition detail.
    status = _read_status(page)
    if status and re.search(re.escape(requisition_no), _get_page_text(page), re.IGNORECASE):
        print(f"  Already on detail view; Status={status!r}")
    else:
        if not _open_requisition_from_list(page, requisition_no):
            return False
        status = _read_status(page)
        print(f"  Opened detail; Status={status!r}")

    if status and status.lower() == "approved":
        print("  Status is already Approved — nothing to do")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/req_already_approved.png", full_page=True)
        except Exception:
            pass
        return True

    # --- Status is not Approved (typically "Released") ---
    # Click Edit to enter the editable Purchase Requisition form.
    edit_btn = _wait_for_visible(
        page, re.compile(r"^\s*Edit\s*$", re.IGNORECASE), tags="button,a", max_wait=10
    )
    if edit_btn is None:
        # Maybe already in edit mode (Approve / Save as Draft visible).
        approve_btn = _find_visible_item(
            page, re.compile(r"^\s*Approve\s*$", re.IGNORECASE), tags="button,a"
        )
        if approve_btn is None:
            print("WARNING: neither Edit nor Approve button found")
            try:
                page.screenshot(path=f"{SCREENSHOT_DIR}/req_edit_not_found.png", full_page=True)
            except Exception:
                pass
            _debug_dump_candidates(page, r"Edit|Approve")
            return False
        print("  Already in edit mode (Approve visible)")
    else:
        print("  Clicking Edit...")
        if not _click_robust(edit_btn):
            print("WARNING: could not click Edit")
            return False
        try:
            page.wait_for_load_state("networkidle")
        except Exception:
            pass
        page.wait_for_timeout(2000)
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/req_edit_form.png", full_page=True)
        except Exception:
            pass

    # Click Approve (buttons: Save as Draft | Approve | Reject | Cancel).
    approve_btn = _wait_for_visible(
        page, re.compile(r"^\s*Approve\s*$", re.IGNORECASE), tags="button,a", max_wait=10
    )
    if approve_btn is None:
        print("WARNING: Approve button not found after Edit")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/req_approve_not_found.png", full_page=True)
        except Exception:
            pass
        _debug_dump_candidates(page, r"Approve")
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
            try:
                dlg.dismiss()
            except Exception:
                pass

    try:
        page.once("dialog", _on_dialog)
    except Exception:
        pass

    print("  Clicking Approve...")
    if not _click_robust(approve_btn):
        print("WARNING: could not click Approve")
        return False

    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(3000)
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/req_after_approve.png", full_page=True)
    except Exception:
        pass

    # Verify Status is now Approved (and Convert to PO / Convert to PQ appear).
    new_status = _read_status(page)
    body = _get_page_text(page)
    if dialog_msg:
        body = "\n".join(dialog_msg) + "\n" + body

    approved_ok = False
    if new_status and new_status.lower() == "approved":
        approved_ok = True
        print(f"  Approval verified (Status={new_status!r})")
    elif re.search(r"\bApproved\b", body, re.IGNORECASE):
        approved_ok = True
        print("  Approval verified (Approved marker on page)")
    else:
        # Convert to PO / Convert to PQ only appear after approval.
        convert = _find_visible_item(
            page, re.compile(r"Convert\s+to\s+P[OQ]", re.IGNORECASE), tags="button,a"
        )
        if convert is not None:
            approved_ok = True
            print("  Approval verified (Convert to PO/PQ button visible)")

    if not approved_ok:
        print(f"WARNING: could not confirm approval; Status={new_status!r}")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/req_approve_unconfirmed.png", full_page=True)
        except Exception:
            pass
    return approved_ok


def submit_draft(page, requisition_no: str) -> bool:
    """Open the saved requisition and advance it toward approval.

    Preferred path (matches current TCS iON UI screenshots):
      - If status is not Approved → Edit → Approve (see approve_if_not_approved).

    Legacy fallback: look for a plain Submit button (older UI variants).
    """
    # Primary path: approve when status is not already Approved.
    if approve_if_not_approved(page, requisition_no):
        return True

    print("  Falling back to legacy Submit button flow...")
    # 1. Try to open the saved requisition's row if we're on a list view.
    opened = False
    for _ in range(20):
        row = _find_visible_item(page, re.compile(re.escape(requisition_no)), tags="tr,td,div,span,a")
        if row is not None:
            try:
                if _click_robust(row):
                    opened = True
                    break
            except Exception:
                pass
        try:
            page.wait_for_timeout(1000)
        except Exception:
            break
    if not opened:
        print("WARNING: could not open saved requisition row for", requisition_no)

    # 2. Scroll to / locate Submit on the opened detail/form view.
    btn = _wait_for_visible(page, re.compile(r"^\s*Submit\s*$", re.IGNORECASE), tags="button,a", max_wait=10)
    if btn is None:
        print("WARNING: Submit button not found")
        try:
            page.screenshot(path=f"{SCREENSHOT_DIR}/submit_not_found.png", full_page=True)
        except Exception:
            pass
        return False
    try:
        btn.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
    except Exception:
        pass

    # Capture any confirmation dialog text; an alert/confirm with "submit"
    # text is itself evidence the submission went through. Register BEFORE
    # clicking so the dialog (fired during the click) is caught.
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

    if not _click_robust(btn):
        print("WARNING: could not click Submit")
        return False

    try:
        page.wait_for_load_state("networkidle")
    except Exception:
        pass
    page.wait_for_timeout(3000)
    try:
        page.screenshot(path=f"{SCREENSHOT_DIR}/requisition_submitted.png", full_page=True)
    except Exception:
        pass

    # 3. Verify submission: look for a success/confirmation marker on the page,
    #    or confirm the edit form has closed (Submit button no longer visible).
    parts = []
    if dialog_msg:
        parts.append("\n".join(dialog_msg))
    for f in page.frames:
        try:
            t = f.inner_text("body", timeout=3000)
        except Exception:
            continue
        if t:
            parts.append(t)
    body = "\n".join(parts)
    submitted_ok = False
    for marker in (r"success", r"submitted", r"released", r"approved", r"saved\s+successfully"):
        if re.search(marker, body, re.IGNORECASE):
            submitted_ok = True
            print(f"  Submission verified (marker: {marker!r})")
            break
    if not submitted_ok:
        gone = _find_visible_item(page, re.compile(r"^\s*Submit\s*$", re.IGNORECASE), tags="button,a")
        if gone is None:
            submitted_ok = True
            print("  Submission verified (Submit button no longer visible)")
    if not submitted_ok:
        print("WARNING: could not confirm submission on the page")
    return submitted_ok


def safe_logout(page) -> None:
    """Best-effort logout that never raises, so cleanup can't crash or hang."""
    try:
        print("Logging out before exit...")
        do_logout(page)
    except KeyboardInterrupt:
        print("Logout interrupted; closing browser anyway.")
    except Exception as e:
        print(f"Logout attempt failed: {e}")


def run() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="TCS iON requisition automation")
    parser.add_argument("--source", default=None, help="data source: xlsx | gsheet | <path>")
    parser.add_argument("--row", type=int, default=None, help="sheet row (informational)")
    parser.add_argument("--debug", action="store_true", help="enable debug dumps")
    args = parser.parse_args()

    if args.debug:
        os.environ.setdefault("TCS_DEBUG", "1")

    if args.source:
        from pipeline import run_pipeline

        result = run_pipeline(source=args.source, row=args.row)
        print(f"Pipeline result: {result}")
        return

    os.makedirs(SCREENSHOT_DIR, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, args=["--start-maximized"])
        context = browser.new_context(no_viewport=True)
        page = context.new_page()

        try:
            while True:
                ok = do_login(page)
                if ok:
                    break
                page.screenshot(path=f"{SCREENSHOT_DIR}/login_failed.png", full_page=True)
                print("Login failed. Retrying in 60s...")
                try:
                    time.sleep(60)
                except KeyboardInterrupt:
                    print("Stopped by user.")
                    return

            start = time.time()
            ok = False
            try:
                ok = run_once(page)
            except Exception as e:
                print(f"Cycle failed: {e}")
            elapsed = time.time() - start
            print(f"Cycle done in {elapsed:.0f}s. Success={ok}")
        except KeyboardInterrupt:
            print("Stopped by user.")
        finally:
            # Always try to log out, regardless of how we got here (success,
            # failure, or Ctrl+C) - a leftover session on the server is what
            # causes the next run to get stuck on "another session is active".
            safe_logout(page)
            try:
                browser.close()
            except KeyboardInterrupt:
                pass
            except Exception:
                pass


if __name__ == "__main__":
    run()