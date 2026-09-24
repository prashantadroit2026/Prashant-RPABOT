# Start the Procurement Hub backend from the backend root so .env and the
# service-account path resolve correctly, independent of the calling directory.
Set-Location -LiteralPath $PSScriptRoot
python -m uvicorn main:app --app-dir src --host 0.0.0.0 --port 8090