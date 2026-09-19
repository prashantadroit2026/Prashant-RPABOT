"""Procurement → Purchase email approver.

Builds a branded HTML "Procurement To Purchase" email carrying the
requisition ID and a requisition summary, and sends it to the approver(s)
over SMTP (Gmail). Pure template/HTML logic is importable and unit-testable
without touching the network.

Config (from .env via requisition.load_env):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
    FROM_NAME (= Approval Bot)
    APPROVER_EMAIL / PURCHASE_APPROVER_EMAIL  (single fallback recipient)
    APPROVERS_FILE                            (comma/line separated list)
    PURCHASE_APPROVERS                        (comma-separated, preferred)

Usage:
    python scripts/email_approver.py REQ123              # preview only
    python scripts/email_approver.py REQ123 --send       # actually send
    python -c "import sys; sys.path.insert(0,'scripts/PR Approver'); \
        import email_approver; \
        print(email_approver.build_procurement_to_purchase_html('REQ123', {...}))"
"""
import argparse
import os
import re
import smtplib
import sys
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path

SHARED_DIR = Path(__file__).resolve().parent.parent
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SHARED_DIR.parent
for _p in (SCRIPT_DIR, SHARED_DIR):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

LOG_DIR = PROJECT_DIR / "logs"


def load_env() -> None:
    """Reuse requisition's .env loader without importing the browser stack."""
    try:
        import requisition as R
        R.load_env()
    except Exception:
        pass


load_env()


# ---------------------------------------------------------------------------
# Plain helpers
# ---------------------------------------------------------------------------

def _esc(value) -> str:
    """HTML-escape a value for embedding in the template."""
    return str("" if value is None else value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _num(value, default="") -> str:
    """Keep only numeric/formatting chars for currency-ish fields."""
    v = str("" if value is None else value).strip()
    if not v:
        return default
    return v


# ---------------------------------------------------------------------------
# Requisition summary extraction
# ---------------------------------------------------------------------------

def _first(seq, default=""):
    if not seq:
        return default
    return seq[0] if isinstance(seq, list) else seq


def summarize_requisition(requisition_id, data=None) -> dict:
    """Flatten a PR dict (pipeline/form_pr mapping) into a display summary.

    ``data`` may be a dict with header keys (description, site, account_site,
    remarks, sub_type, category, transaction_date) plus an ``items`` list, or a
    flat item dict. Returns a plain dict safe to render."""
    data = dict(data or {})
    items = data.get("items") or []

    def _g(*names, default=""):
        for n in names:
            if n in data and data[n] not in (None, ""):
                return data[n]
        return default

    # Header-level summary
    summary = {
        "requisition_id": _esc(requisition_id),
        "reference": _esc(_g("reference", "po_number", "request_id")),
        "description": _esc(_g("description", "item_desc", "item_name")),
        "sub_type": _esc(_g("sub_type")),
        "category": _esc(_g("category")),
        "site": _esc(_g("site")),
        "account_site": _esc(_g("account_site")),
        "transaction_date": _esc(_g("transaction_date", "req_date")),
        "remarks": _esc(_g("remarks")),
        "indentor": _esc(_g("indentor", "indentor_name", "indenter")),
        "department": _esc(_g("department", "department_name", "dept")),
        "status": _esc(_g("status", default="Submitted")),
        "item_count": len(items),
    }

    # Line-item summary
    lines = []
    if items:
        for idx, it in enumerate(items, start=1):
            it = it or {}
            def _ig(*names, default=""):
                for n in names:
                    if n in it and it[n] not in (None, ""):
                        return it[n]
                return default
            rate = _num(_ig("rate"))
            qty = _num(_ig("qty", "item_quantity"), "1")
            amount = _num(_ig("amount"))
            if not amount and rate and qty:
                try:
                    amount = f"{float(rate) * float(qty):.2f}"
                except Exception:
                    amount = ""
            lines.append({
                "n": idx,
                "item_code": _esc(_ig("item_code")),
                "item_desc": _esc(_ig("item_desc", "item_name", "description")),
                "uom": _esc(_ig("uom")),
                "qty": _esc(qty),
                "rate": _esc(rate),
                "amount": _esc(amount),
                "remarks": _esc(_ig("remarks")),
            })
    summary["lines"] = lines

    # Total amount
    total = 0.0
    for line in lines:
        if line["amount"]:
            try:
                total += float(line["amount"])
            except Exception:
                pass
    summary["total_amount"] = f"{total:.2f}" if lines else ""

    return summary


# ---------------------------------------------------------------------------
# HTML template
# ---------------------------------------------------------------------------

def build_procurement_to_purchase_html(requisition_id, data=None) -> str:
    """Render the full 'Procurement To Purchase' HTML email body.

    ``requisition_id`` is the TCS requisition number (e.g. PCPOL60058).
    ``data`` is a PR dict (as produced by pipeline / form_pr / summarize_requisition).
    """
    s = summarize_requisition(requisition_id, data)
    hl = "#1a5276"

    def _row(k, v):
        return (
            '<tr>'
            '<td style="padding:7px 12px;border-bottom:1px solid #eee;color:#7f8c8d;white-space:nowrap;vertical-align:top">' + k + '</td>'
            '<td style="padding:7px 12px;border-bottom:1px solid #eee;font-weight:600;color:#2c3e50;word-break:break-word">' + v + '</td>'
            '</tr>'
        )

    def _cell(text, bold=False, right=False, color=None):
        style = "padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;" + ("font-weight:600;color:#2c3e50;" if bold else "color:#34495e;")
        if right:
            style += "text-align:right;"
        if color:
            style += "color:" + color + ";"
        return '<td style="' + style + '">' + text + '</td>'

    # Header block
    html = (
        '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:680px;margin:0 auto;'
        'background:#ffffff;border:1px solid #e1e5e9;border-radius:8px;overflow:hidden">'
        '<div style="background:' + hl + ';padding:18px 22px;color:#fff">'
        '<div style="font-size:14px;opacity:.85;letter-spacing:.5px">PROCUREMENT → PURCHASE</div>'
        '<div style="font-size:20px;font-weight:700;margin-top:2px">Requisition ' + s["requisition_id"] + '</div>'
        '<div style="font-size:13px;opacity:.85;margin-top:4px">Conversion pending approval · ' + _esc(datetime.now().strftime("%d %b %Y, %I:%M %p")) + '</div>'
        '</div>'
        '<div style="padding:22px">'
    )

    # Requisition summary table
    html += (
        '<div style="font-size:14px;font-weight:700;color:' + hl + ';margin-bottom:6px">Requisition Summary</div>'
        '<table style="border-collapse:collapse;width:100%;font-size:14px">'
        + _row("Requisition ID", s["requisition_id"]) +
        (('' if not s["reference"] else _row("Reference", s["reference"]))) +
        (('' if not s["transaction_date"] else _row("Date", s["transaction_date"]))) +
        (('' if not s["status"] else _row("Status", s["status"]))) +
        (('' if not s["site"] else _row("Site", s["site"]))) +
        (('' if not s["account_site"] else _row("Account Site", s["account_site"]))) +
        (('' if not s["indentor"] else _row("Indentor", s["indentor"]))) +
        (('' if not s["department"] else _row("Department", s["department"]))) +
        (('' if not s["sub_type"] else _row("Sub Type", s["sub_type"]))) +
        (('' if not s["category"] else _row("Category", s["category"]))) +
        (('' if not s["description"] else _row("Description", s["description"]))) +
        '</table>'
    )

    # Remarks
    if s["remarks"]:
        html += (
            '<div style="margin-top:12px;padding:10px 12px;background:#f4f6f7;border-radius:6px;'
            'font-size:13px;color:#2c3e50"><b style="color:' + hl + '">Remarks:</b> ' +
            s["remarks"] + '</div>'
        )

    # Line items
    if s["lines"]:
        html += (
            '<div style="margin-top:20px;font-size:14px;font-weight:700;color:' + hl + ';margin-bottom:6px">'
            'Requisition Lines (' + str(s["item_count"]) + ')</div>'
            '<table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #eee">'
            '<tr style="background:#eaf2f8;color:' + hl + '">'
            '<td style="padding:8px 12px;font-weight:700">#</td>'
            '<td style="padding:8px 12px;font-weight:700">Item</td>'
            '<td style="padding:8px 12px;font-weight:700">Code</td>'
            '<td style="padding:8px 12px;font-weight:700;text-align:right">Qty</td>'
            '<td style="padding:8px 12px;font-weight:700">UOM</td>'
            '</tr>'
        )
        for line in s["lines"]:
            html += (
                '<tr>'
                + _cell(str(line["n"])) +
                _cell(line["item_desc"], bold=True) +
                _cell(line["item_code"]) +
                _cell(line["qty"], right=True) +
                _cell(line["uom"]) +
                '</tr>'
            )
        html += '</table>'

    # Approve / notify actions
    html += (
        '<div style="margin-top:22px;font-size:14px">'
        '<div style="padding:12px 16px;background:#f4f6f7;border-radius:6px;color:#7f8c8d;font-size:13px">'
        'Approve this requisition to proceed to Purchase. Confirm on the Approval Hub or reply to this email.</div>'
        '</div>'
        '<div style="margin-top:16px;font-size:12px;color:#95a5a6;border-top:1px solid #ecf0f1;padding-top:10px">'
        'This is an automated notification from the Procurement Approval Bot. Requisition ID '
        + s["requisition_id"] + ' is pending purchase conversion.</div>'
        '</div></div>'
    )
    return html


def build_plain_text(requisition_id, data=None) -> str:
    """Plain-text fallback body so non-HTML clients still get the summary."""
    s = summarize_requisition(requisition_id, data)
    lines = [
        "PROCUREMENT TO PURCHASE",
        "Requisition " + s["requisition_id"] + " is pending approval",
        "",
        "--- Requisition Summary ---",
    ]
    fields = [
        ("Requisition ID", s["requisition_id"]),
        ("Reference", s["reference"]),
        ("Date", s["transaction_date"]),
        ("Status", s["status"]),
        ("Site", s["site"]),
        ("Account Site", s["account_site"]),
        ("Indentor", s["indentor"]),
        ("Department", s["department"]),
        ("Sub Type", s["sub_type"]),
        ("Category", s["category"]),
        ("Description", s["description"]),
    ]
    for k, v in fields:
        if v:
            lines.append(f"{k}: {v}")
    if s["remarks"]:
        lines.append(f"Remarks: {s['remarks']}")
    if s["lines"]:
        lines.append("")
        lines.append("Lines:")
        for line in s["lines"]:
            lines.append(
                f"  {line['n']}. {line['item_desc']} "
                f"({line['item_code']}) qty {line['qty']} {line['uom']}"
            )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Recipients
# ---------------------------------------------------------------------------

def resolve_recipients() -> list:
    """Return the approver email addresses to send to."""
    recipients = []

    def _add(emails):
        for e in emails or []:
            e = str(e).strip().lower()
            if e and "@" in e and e not in recipients:
                recipients.append(e)

    # Preferred: explicit purchase approvers.
    _add(os.getenv("PURCHASE_APPROVERS", "").split(","))

    # Fall back to an approvers file (comma / newline separated).
    if not recipients:
        ap_file = os.getenv("APPROVERS_FILE")
        if ap_file:
            p = Path(ap_file)
            if not p.is_absolute():
                p = PROJECT_DIR / p
            if p.is_file():
                _add([line.strip() for line in p.read_text(encoding="utf-8").splitlines()])

    # Single-address fallbacks.
    if not recipients and os.getenv("PURCHASE_APPROVER_EMAIL"):
        _add([os.getenv("PURCHASE_APPROVER_EMAIL")])
    if not recipients and os.getenv("APPROVER_EMAIL"):
        _add([os.getenv("APPROVER_EMAIL")])
    if not recipients and os.getenv("SENIOR_APPROVERS"):
        _add(os.getenv("SENIOR_APPROVERS").split(","))

    return recipients


# ---------------------------------------------------------------------------
# SMTP send
# ---------------------------------------------------------------------------

def send_email(to_emails, subject, html_body, text_body=None) -> dict:
    """Send an HTML email to the given addresses over SMTP. Returns a result
    dict with 'sent' count, 'to', and optional 'error'. Never raises."""
    sender = os.getenv("SMTP_USER", "").strip()
    if not sender:
        return {"sent": 0, "to": to_emails, "error": "SMTP_USER not configured"}
    to_emails = [e for e in (to_emails or []) if e and "@" in e]
    if not to_emails:
        return {"sent": 0, "to": [], "error": "no recipients resolved"}
    try:
        from_name = os.getenv("FROM_NAME", "Approval Bot")
        msg = EmailMessage()
        msg["From"] = formataddr((from_name, sender))
        msg["To"] = ", ".join(to_emails)
        msg["Subject"] = subject
        msg.set_content(text_body or html_body)
        msg.add_alternative(html_body, subtype="html")

        host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        port = int(os.getenv("SMTP_PORT", "587"))
        password = os.getenv("SMTP_PASS", "")
        use_tls = os.getenv("SMTP_USE_TLS", "1").lower() not in ("0", "false", "no")
        use_ssl = os.getenv("SMTP_USE_SSL", "0").lower() in ("1", "true", "yes")

        if use_ssl:
            server = smtplib.SMTP_SSL(host, port, timeout=30)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
        try:
            server.ehlo()
            if use_tls and not use_ssl:
                server.starttls()
                server.ehlo()
            if password:
                server.login(sender, password)
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:
                pass
        _log_email(subject, to_emails, html_body, text_body)
        return {"sent": len(to_emails), "to": to_emails, "error": None}
    except Exception as exc:
        return {"sent": 0, "to": to_emails, "error": str(exc)}


def _log_email(subject, to_emails, html_body, text_body) -> None:
    try:
        record = {
            "timestamp": datetime.now().isoformat(),
            "subject": subject,
            "to": to_emails,
            "html_len": len(html_body or ""),
            "text_len": len(text_body or ""),
        }
        log_path = LOG_DIR / "procurement_to_purchase_email_log.jsonl"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(__import__("json").dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# High-level entry points
# ---------------------------------------------------------------------------

def send_procurement_to_purchase_email(requisition_id, data=None, to_emails=None) -> dict:
    """Send the Procurement → Purchase email for a requisition.

    ``requisition_id``: TCS requisition number.
    ``data``: PR dict (pipeline / form_pr output) used to build the summary.
    ``to_emails``: optional explicit recipients; defaults to resolve_recipients().

    Returns the send_email() result dict.
    """
    summary = summarize_requisition(requisition_id, data)
    subject = f"Procurement to Purchase — Requisition {requisition_id} ({summary['description'] or 'summary'})"
    if len(subject) > 150:
        subject = subject[:147] + "..."
    html = build_procurement_to_purchase_html(requisition_id, data)
    text = build_plain_text(requisition_id, data)
    recipients = to_emails if to_emails else resolve_recipients()
    return send_email(recipients, subject, html, text)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Procurement → Purchase email approver")
    parser.add_argument("requisition_id", help="TCS requisition number (e.g. PCPOL60058)")
    parser.add_argument("--send", action="store_true", help="actually send via SMTP (default: preview only)")
    parser.add_argument("--to", help="override recipient(s), comma-separated")
    parser.add_argument("--description", help="override description/summary text")
    parser.add_argument("--qty", help="override quantity")
    parser.add_argument("--rate", help="override rate")
    args = parser.parse_args(argv)

    data = {}
    if args.description:
        data["description"] = args.description
    if args.qty:
        data["items"] = [{"item_desc": args.description or "", "qty": args.qty, "rate": args.rate or ""}]
    subject = f"Procurement to Purchase — Requisition {args.requisition_id}"
    recipients = resolve_recipients()
    html = build_procurement_to_purchase_html(args.requisition_id, data)
    text = build_plain_text(args.requisition_id, data)

    def _out(s):
        try:
            print(s)
        except UnicodeEncodeError:
            print(s.encode("ascii", "replace").decode("ascii"))

    _out("Subject: " + subject)
    _out("Recipients: " + ", ".join(recipients))
    _out("--- HTML (preview) ---")
    _out(html)
    _out("--- Plain text ---")
    _out(text)

    # Also write a preview file for easy viewing in a browser.
    try:
        preview = LOG_DIR / f"procurement_to_purchase_preview_{args.requisition_id}.html"
        preview.parent.mkdir(parents=True, exist_ok=True)
        preview.write_text(html, encoding="utf-8")
        _out("--- Preview saved to " + str(preview) + " ---")
    except Exception:
        pass

    if args.send:
        to = (args.to.split(",") if args.to else None)
        result = send_procurement_to_purchase_email(args.requisition_id, data, to_emails=to)
        _out("--- Send result ---")
        _out(str(result))
        return 0 if result.get("sent") else 1
    _out("(Preview only — rerun with --send to email the approvers.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
