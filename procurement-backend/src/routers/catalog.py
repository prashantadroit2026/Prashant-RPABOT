from typing import Optional

from fastapi import APIRouter, HTTPException, Query

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


@router.get("/item-hint")
def item_hint(
    itemId: int = Query(...),
    machineId: Optional[int] = Query(None),
):
    try:
        hint = svc.item_hint(itemId, machineId)
        if hint is None:
            raise HTTPException(status_code=404, detail="Item not found")
        return hint
    except HTTPException:
        raise
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