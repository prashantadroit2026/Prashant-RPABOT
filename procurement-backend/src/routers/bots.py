from fastapi import APIRouter, HTTPException, Query

from services import sheet_service as svc
from sheets.models import Alert, AlertCreate, Bot, BotRun, BotTrigger

router = APIRouter(tags=["bots"])


@router.get("/bots", response_model=list[Bot])
def list_bots():
    try:
        return svc.list_bots()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bots/trigger", response_model=BotRun)
def trigger(body: BotTrigger):
    try:
        return svc.trigger_bot(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs", response_model=list[BotRun])
def list_runs(limit: int = Query(20, ge=1, le=100)):
    try:
        return svc.list_bot_runs(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts", response_model=list[Alert])
def list_alerts(limit: int = Query(20, ge=1, le=100)):
    try:
        return svc.list_alerts(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts", response_model=Alert)
def create_alert(body: AlertCreate):
    try:
        return svc.create_alert(body)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
