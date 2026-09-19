"""Minimal FastAPI endpoint example — copy this skeleton to add a new route.

Run:
    pip install fastapi uvicorn
    uvicorn quick_example:app --port 8000

Try:
    http://127.0.0.1:8000/api/hello
    http://127.0.0.1:8000/api/hello?name=PR
    http://127.0.0.1:8000/docs            # interactive Swagger UI
    curl -X POST http://127.0.0.1:8000/api/echo -H "Content-Type: application/json" \
         -d '{"n":5}'
"""
from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="Quick Example", version="1.0")


@app.get("/api/hello")
def api_hello(name: str = "world"):
    """GET endpoint — query params come as function args with defaults."""
    return {"message": f"Hello, {name}"}


@app.post("/api/echo")
def api_echo(payload: dict, x_webhook_key: str = Header(None)):
    """POST endpoint — body is `payload: dict`, auth via header.

    Return a dict → it is serialized to JSON automatically."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="JSON object required")
    if x_webhook_key is not None and x_webhook_key != "secret":
        raise HTTPException(status_code=401, detail="invalid webhook key")
    return {"ok": True, "echo": payload}
