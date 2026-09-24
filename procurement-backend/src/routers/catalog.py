from fastapi import APIRouter, HTTPException

from services import sheet_service as svc

router = APIRouter(tags=["catalog"])


@router.get("/catalog")
def catalog():
    try:
        return svc.get_catalog_api()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/inventory")
def inventory():
    try:
        return svc.get_inventory_v2()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/machines")
def machines():
    try:
        return svc.list_machine_stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/refill")
def refill():
    try:
        return svc.get_refill_dashboard()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))