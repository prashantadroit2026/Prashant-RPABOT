# Procurement Hub – Python Backend (Google Sheets as DB)

A complete FastAPI backend that stores all plant data (items, machines, slips, movements, bots, runs, alerts) in a single **Google Spreadsheet**.

It implements the same REST surface the React frontend already talks to:

| Method | Path                    | Description                        |
|--------|-------------------------|------------------------------------|
| GET    | `/api/health`           | Service + driver status            |
| GET    | `/api/catalog`          | Items + machines                   |
| GET    | `/api/inventory`        | On-hand + 30-day consumption       |
| GET    | `/api/machines`         | Machine master                     |
| GET    | `/api/slips`            | List slips (`?status=pending`)     |
| POST   | `/api/slips`            | Raise a single slip                |
| POST   | `/api/slips/group`      | Raise multi-item group             |
| POST   | `/api/slips/decide`     | Store decision: stock / split / pr |
| POST   | `/api/slips/receive`    | Mark PR received → restock         |
| GET    | `/api/bots`             | List bots                          |
| POST   | `/api/bots/trigger`     | Manual bot run                     |
| GET    | `/api/runs`             | Recent bot runs                    |
| GET    | `/api/alerts`           | Alerts                             |
| POST   | `/api/alerts`           | Create alert                       |

---

## 1. One-time Google setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project (or pick an existing one).
2. Enable **Google Sheets API** and **Google Drive API**.
3. Create a **Service Account** → download the JSON key file.
4. Create a new Google Spreadsheet (or use an existing one).
5. Share the spreadsheet with the service-account email address (the one ending in `@….iam.gserviceaccount.com`) and give it **Editor** permission.
6. Copy the Spreadsheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   ```

---

## 2. Local setup

```bash
cd procurement-backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# edit .env:
#   GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json
#   GOOGLE_SHEET_ID=your_spreadsheet_id
```

Place the downloaded JSON key next to the project (or update the path).

---

## 3. Run

```bash
uvicorn main:app --reload --port 8080
# or simply
python main.py
```

Open http://localhost:8080/docs for interactive Swagger UI.

On first start the backend will:

- create the worksheets (`items`, `machines`, `slips`, …) if they do not exist
- seed demo data (5 items, 3 machines, 1 TCS bot) when the sheets are empty

---

## 4. Example calls

```bash
# health
curl http://localhost:8080/api/health

# catalog
curl http://localhost:8080/api/catalog | jq

# raise a slip
curl -X POST http://localhost:8080/api/slips \
  -H 'content-type: application/json' \
  -d '{
    "item_code": "PCPWB60132",
    "qty": 10,
    "department": "Production",
    "machine": "CNC-01",
    "hod_confirmed": true
  }'

# store decides to issue from stock
curl -X POST http://localhost:8080/api/slips/decide \
  -H 'content-type: application/json' \
  -d '{"id": 1, "mode": "stock"}'

# trigger the TCS bot
curl -X POST http://localhost:8080/api/bots/trigger \
  -H 'content-type: application/json' \
  -d '{"id": 1, "input": {"itemCode": "PCPWB60132", "qty": 50}}'
```

---

## 5. How the “database” works

Each worksheet is a table.  
The first row is the header; every subsequent row is a record.

- Auto-increment IDs are stored in a special `meta` worksheet.
- Updates are done by locating the row by `id` and rewriting the whole row.
- JSON fields (`config`, `input`, `output`) are stored as stringified JSON.

This is intentionally simple and works well for low-to-medium volume plant-floor systems. For high concurrency you would add a thin Postgres layer or use a proper queue in front of the Sheets writes.

---

## 6. Connecting the existing React frontend

Point the frontend’s API base URL (or the Nitro routes) to this backend:

```
VITE_API_BASE=http://localhost:8080
```

All paths already match the ones used in `src/lib/plant-server.ts` and `src/lib/bot-server.ts`.

---

## 7. Production notes

- Restrict CORS origins.
- Keep the service-account JSON outside the repo and inject it via environment / secret manager.
- Consider a small write-queue (Redis / Cloud Tasks) if many operators raise slips simultaneously – Google Sheets has rate limits (~100 requests / 100 s per user).
- The bot trigger currently records a simulated run; replace the body of `trigger_bot()` with a real call to your Playwright RPA script (`Bot/create_pr_po.py`).
