from fastapi import APIRouter, HTTPException

from services import sheet_service as svc
from sheets.models import UserCreate, UserLogin, UserUpdate

router = APIRouter(tags=["users"])


@router.get("/users")
def list_users():
    try:
        return svc.list_users_api()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users")
def create_user(body: UserCreate):
    try:
        return svc._user_api(svc.create_user(body))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/users/login")
def login(body: UserLogin):
    try:
        u = svc.find_user(body.user_id, body.password)
        if not u:
            raise HTTPException(status_code=401, detail="Invalid User ID or password")
        return svc._user_api(u)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}")
def get_user(user_id: int):
    try:
        u = svc.get_user(user_id)
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        return svc._user_api(u)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate):
    try:
        return svc._user_api(svc.update_user(user_id, body))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/users/{user_id}")
def delete_user(user_id: int):
    try:
        return svc.delete_user(user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))