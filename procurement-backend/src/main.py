"""
Procurement Hub – Python backend that uses Google Sheets as the database.

Quick start
-----------
1. Create a Google Cloud service account and download the JSON key.
2. Share your Google Spreadsheet with the service-account email (Editor).
3. Copy .env.example → .env and fill GOOGLE_SHEET_ID + path to the JSON.
4. pip install -r requirements.txt
5. uvicorn main:app --reload --port 8080

API docs: http://localhost:8080/docs
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import bots, catalog, health, slips, users
from sheets.client import ensure_worksheets
from services.sheet_service import seed_if_empty


def create_app(run_startup: bool = True) -> FastAPI:
    """Build the application.

    `run_startup=False` skips the Google-Sheets handshake at startup – used by
    the Cloudflare Python Worker, where a deploy-time snapshot must not make
    live network calls.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Startup
        if run_startup:
            try:
                ensure_worksheets()
                if settings.seed_on_start:
                    seed_if_empty()
                print("Sheets ready: Google Sheets connection OK")
            except Exception as e:
                print(f"[warn] Sheets init warning: {e}")
                print("  (API will still start; fix credentials / sheet ID)")
        yield
        # Shutdown – nothing special

    app = FastAPI(
        title="Procurement Hub API",
        description="Python backend using Google Sheets as the database",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount routers under /api to match the frontend expectations
    app.include_router(health.router, prefix="/api")
    app.include_router(catalog.router, prefix="/api")
    app.include_router(slips.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(users.router, prefix="/api")

    @app.get("/")
    def root():
        return {
            "service": "Procurement Hub (Google Sheets backend)",
            "docs": "/docs",
            "health": "/api/health",
        }

    return app


app = create_app(run_startup=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )
