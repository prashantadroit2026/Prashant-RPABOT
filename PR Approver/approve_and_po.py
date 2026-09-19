"""Approve existing PR and create PO - focused script with debugging."""
import sys
import os
import re
import time
from pathlib import Path

SHARED_DIR = Path(__file__).resolve().parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
PO_DIR = SHARED_DIR / "Purchase Order"
PROJECT_DIR = SHARED_DIR.parent
for _p in (SCRIPT_DIR, SHARED_DIR, PO_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import requisition as R
import PO as PO
from playwright.sync_api import sync_playwright

os.makedirs(R.SCREENSHOT_DIR, exist_ok=True)

REQ_NO = "AD/2627/PR/0123"

po_data = {
    "header": {
        "po_type": "Domestic",
        "currency": "INR",
    },
    "items": [{
        "item_code": "PCPWB60132",
        "item_desc": "PCPWB60132",
        "qty": "50",
        "uom": "NOS",
        "base_uom": "NOS",
        "base_qty": "50",
    }],
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, args=["--start-maximized"])
    context = browser.new_context(no_viewport=True)
    page = context.new_page()

    try:
        if not R.do_login(page):
            print("FAIL: login failed")
            sys.exit(1)

        # Step 1: Navigate to Manufacturing > Procurement > Requisition
        print("\n===== Navigating to Requisition list =====")
        mfg_page = R.select_manufacturing(page, enter_requisition=True)
        if mfg_page is None:
            print("FAIL: could not reach requisition")
            sys.exit(1)

        # We should be on the requisition list/create form. 
        # Navigate back to list view if needed.
        time.sleep(2)
        
        # Look for the requisition in the list
        print(f"\n===== Looking for {REQ_NO} in list =====")
        
        # Try clicking a "List" or "Search" or "Back" button to get to the list view
        list_btn = R._find_visible_item(
            mfg_page, re.compile(r"^\s*(List|Back|Search|Results)\s*$", re.IGNORECASE), tags="button,a"
        )
        if list_btn:
            print("Found list/back button, clicking...")
            R._click_robust(list_btn)
            time.sleep(3)
        
        # Search for our requisition
        # Try to find the req number in the page
        found = R._open_requisition_from_list(mfg_page, REQ_NO)
        if found:
            print(f"Opened {REQ_NO} from list")
            time.sleep(2)
            
            # Read status
            status = R._read_status(mfg_page)
            print(f"Status: {status}")
            
            # Dump page text for debugging
            text = R._get_page_text(mfg_page)
            # Find relevant buttons
            for btn_text in ["Edit", "Approve", "Submit", "Save", "Release", "Convert to PO"]:
                matches = re.findall(rf"(?:^|\n)\s*{btn_text}\s*(?:\n|$)", text, re.IGNORECASE)
                if matches:
                    print(f"  Found '{btn_text}' on page")
        else:
            print(f"Could not find {REQ_NO} in list view")
            # Try direct approach - look for Edit/Approve buttons on current page
            print("Checking current page for buttons...")
            text = R._get_page_text(mfg_page)
            for btn_text in ["Edit", "Approve", "Submit", "Save as Draft", "Convert to PO"]:
                loc = R._find_visible_item(
                    mfg_page, re.compile(rf"^\s*{btn_text}\s*$", re.IGNORECASE), tags="button,a"
                )
                if loc:
                    print(f"  Found '{btn_text}' button on current page")
                else:
                    print(f"  '{btn_text}' button NOT found on current page")
        
        # Step 2: Try to approve
        print(f"\n===== Approving {REQ_NO} =====")
        approved = R.approve_if_not_approved(mfg_page, REQ_NO)
        if approved:
            print(f"Approved: {REQ_NO}")
        else:
            print(f"WARNING: Approval may have failed for {REQ_NO}")

        # Step 3: Create PO from PR
        print("\n===== Creating PO from PR =====")
        
        # Navigate to Procurement (without entering requisition)
        R._wait_for_sidebar_frame(mfg_page)
        time.sleep(2)
        
        # Click Purchase Order in sidebar
        print("Looking for Purchase Order in sidebar...")
        # First dump what's visible in sidebar
        for scope in R._frame_scopes(mfg_page):
            try:
                items = scope.locator("a,button,li").filter(has_text=re.compile(r"Purchase|Order|PO|Procure"))
                for i in range(items.count()):
                    item = items.nth(i)
                    try:
                        if item.is_visible():
                            tag = item.evaluate("el => el.tagName")
                            text = item.inner_text()[:60].strip()
                            print(f"  [{tag}] {text!r}")
                    except:
                        pass
            except:
                pass
        
        po_created = PO.create_po_from_pr(mfg_page, po_data)
        if po_created:
            print("\n===== SUCCESS =====")
        else:
            print("\n===== PO creation may have issues =====")

    except KeyboardInterrupt:
        print("Interrupted by user.")
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
    finally:
        R.safe_logout(page)
        try:
            browser.close()
        except:
            pass
