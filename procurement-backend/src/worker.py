"""Cloudflare Python Worker entrypoint for the Procurement Hub backend.

The Workers runtime snapshots module-level code at deploy time, so we build
the FastAPI app with `run_startup=False` (no Google-Sheets handshake during
the snapshot) and hand it to the ASGI adapter. Google Sheets calls happen
per-request, lazily.
"""
from workers import asgi

from config import settings
from main import create_app

app = create_app(run_startup=False)

# Cloudflare Workers ASGI entrypoint. `Default` must be exported at top level.
Default = asgi.entrypoint(app)


# Export the settings for introspection/monitoring (deploy-time only).
KEYS = {
    "sheet_id": (settings.google_sheet_id or "")[:8],
    "cors_origins": settings.cors_origins,
}