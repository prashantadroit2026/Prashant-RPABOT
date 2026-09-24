from fastapi import APIRouter, HTTPException, Query

from services import sheet_service as svc
from sheets.models import AlertAck, AlertCreate, BotTrigger

router = APIRouter(tags=["bots"])


@router.get("/bots")
def list_bots():
    try:
        return svc.list_bots_api()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/bots/trigger")
def trigger(body: BotTrigger):
    try:
        return svc.run_api(svc.trigger_bot(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs")
def list_runs(limit: int = Query(20, ge=1, le=100)):
    try:
        return svc.list_bot_runs_api(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts")
def list_alerts(limit: int = Query(20, ge=1, le=100)):
    try:
        return svc.list_alerts_api(limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts/acknowledge")
def acknowledge_alert(body: AlertAck):
    try:
        return svc.acknowledge_alert(body.id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/alerts")
def create_alert(body: AlertCreate):
    try:
        return svc.alert_api(svc.create_alert(body))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))