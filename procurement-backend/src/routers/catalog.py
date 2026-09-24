from fastapi import APIRouter, HTTPException

from services import sheet_service as svc
from sheets.models import Catalog

router = APIRouter(tags=["catalog"])


@router.get("/catalog", response_model=Catalog)
def catalog():
    try:
        return svc.get_catalog()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory")
def inventory():
    try:
        return svc.get_inventory()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/machines")
def machines():
    try:
        return [m.model_dump() for m in svc.list_machines()]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
