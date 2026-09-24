from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from services import sheet_service as svc
from sheets.models import (
    NewItemRequest,
    Slip,
    SlipCreate,
    SlipDecide,
    SlipGroupCreate,
    SlipReceive,
)

router = APIRouter(tags=["slips"])


@router.get("/slips")
def list_slips(status: Optional[str] = Query(None)):
    try:
        return [svc.slip_api(s) for s in svc.list_slips(status=status)]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slips", response_model=Slip)
def create_slip(body: SlipCreate):
    try:
        return svc.create_slip(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slips/group")
def create_slip_group(body: SlipGroupCreate):
    try:
        return svc.create_slip_group(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slips/decide")
def decide(body: SlipDecide):
    try:
        return svc.slip_api(svc.decide_slip(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/slips/receive")
def receive(body: SlipReceive):
    try:
        return svc.slip_api(svc.receive_slip(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---- Indents (multi-item slip groups) ----

@router.get("/indents")
def list_indents():
    try:
        return svc.list_slip_groups()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/indents")
def create_indent(body: SlipGroupCreate):
    try:
        return svc.create_indent(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/requests")
def list_requests():
    try:
        return svc.list_requests()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/new-item-request")
def new_item_request(body: NewItemRequest):
    try:
        return svc.request_new_item(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))