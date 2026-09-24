from fastapi import APIRouter

from config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {
        "status": "ok",
        "database": "google_sheets",
        "sheet_id": settings.google_sheet_id[:8] + "…" if settings.google_sheet_id else None,
        "driver": "gspread",
    }
