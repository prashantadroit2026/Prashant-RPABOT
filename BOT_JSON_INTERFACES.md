# Playwright Bot JSON Interfaces

This document describes the simplified JSON interfaces for the Playwright RPA bots used in the TCS-ERP Bot system.

## Overview

The bots now support simplified JSON input formats while maintaining backward compatibility with legacy formats. This makes integration with the Cloudflare Workers backend and VPS deployment much cleaner.

## PR Bot (Purchase Requisition)

### Location
`PR Approver/PR_combined.py`

### Simplified JSON Input Format

```json
{
  "item_code": "PCPWB60132",
  "item_description": "PCPWB60132 Bearing", 
  "item_quantity": 50,
  "request_code": "REQ-001"
}
```

### Fields

- **item_code** (required): The item code for the material
- **item_description** (optional): Description of the item (defaults to item_code if not provided)
- **item_quantity** (required): Quantity to order
- **request_code** (optional): Request identifier for tracking

### JSON Output Format

```json
{
  "ok": true,
  "action": "create_pr",
  "pr_number": "AD/2627/PR/0001",
  "status": "approved",
  "item_code": "PCPWB60132",
  "item_description": "PCPWB60132 Bearing",
  "item_quantity": 50,
  "request_code": "REQ-001",
  "vendor_code": "",
  "transactionDate": "21/09/2026",
  "durationMs": 15234,
  "error": null
}
```

### Usage Example

```bash
cd "PR Approver"
python PR_combined.py --json examples/pr_input_simple.json
```

### Legacy Format (Still Supported)

The bot still supports the legacy format for backward compatibility:

```json
{
  "itemCode": "PCPWB60132",
  "itemQuantity": 50,
  "vendorCode": "VENDOR001",
  "requestId": "REQ-001"
}
```

## Approve & PO Bot (Purchase Order)

### Location
`Purchase Order/PO_combined.py`

### Simplified JSON Input Format

```json
{
  "pr_number": "AD/2627/PR/0001",
  "vendor_code": "VENDOR001"
}
```

### Fields

- **pr_number** (required): The PR number to convert to PO
- **vendor_code** (required): The vendor code for the PO

### JSON Output Format

```json
{
  "ok": true,
  "action": "create_po",
  "po_number": "AD/2627/PO/0001",
  "pr_number": "AD/2627/PR/0001",
  "vendor_code": "VENDOR001",
  "item_code": "",
  "item_count": 0,
  "status": "created",
  "request_id": "",
  "durationMs": 18234,
  "error": null
}
```

### Usage Example

```bash
cd "Purchase Order"
python PO_combined.py --json examples/po_input_simple.json
```

### Legacy Format (Still Supported)

The bot still supports the legacy format for backward compatibility:

```json
{
  "prNumber": "AD/2627/PR/0001",
  "vendorCode": "VENDOR001",
  "itemCode": "PCPWB60132",
  "qty": 50
}
```

## Integration with Cloudflare Workers Backend

### Backend Trigger Flow

1. **Frontend → Cloudflare Workers**: User triggers bot via API
2. **Cloudflare Workers → Google Sheets**: Record bot run with status "pending"
3. **VPS Worker**: Polls for pending bot runs
4. **VPS → Playwright Bot**: Executes bot with JSON input
5. **VPS → Google Sheets**: Updates bot run status and results

### Example Cloudflare Workers Integration

The backend's `trigger_bot()` function in `services/sheet_service.py` can be extended to call the VPS bots:

```python
def trigger_bot(payload: BotTrigger) -> BotRun:
    # Record bot run
    new_id = sc.next_id("bot_runs")
    started = _now()
    
    # Create bot-specific payload
    if bot.code == "BOT-TCS-PRPO":
        bot_payload = {
            "item_code": payload.input.get("itemCode"),
            "item_description": payload.input.get("itemDescription"),
            "item_quantity": payload.input.get("quantity"),
            "request_code": payload.input.get("requestId")
        }
        # VPS will pick this up and execute PR bot
```

### VPS Worker Integration

The VPS worker (`worker_pr_po.py`) can poll for pending bot runs and execute the appropriate bot:

```python
def execute_pr_bot(item_code, item_description, item_quantity, request_code):
    payload = {
        "item_code": item_code,
        "item_description": item_description,
        "item_quantity": item_quantity,
        "request_code": request_code
    }
    
    # Write to temp file
    with open("temp_pr_input.json", "w") as f:
        json.dump(payload, f)
    
    # Execute PR bot
    result = subprocess.run([
        "python", "PR Approver/PR_combined.py", 
        "--json", "temp_pr_input.json"
    ], capture_output=True, text=True)
    
    return json.loads(result.stdout)
```

## Error Handling

Both bots return structured error responses:

```json
{
  "ok": false,
  "action": "create_pr",
  "pr_number": null,
  "status": "failed",
  "error": "itemCode is required",
  "durationMs": 123
}
```

## Testing

### Test PR Bot

```bash
cd "PR Approver"
python PR_combined.py --json examples/pr_input_simple.json
```

### Test PO Bot

```bash
cd "Purchase Order" 
python PO_combined.py --json examples/po_input_simple.json
```

## Field Name Aliases

The bots support multiple field name variations for flexibility:

### PR Bot
- `item_code` / `itemCode`
- `item_description` / `itemDescription` / `itemDesc` / `description`
- `item_quantity` / `itemQuantity` / `quantity` / `qty`
- `request_code` / `requestCode` / `requestId`

### PO Bot
- `pr_number` / `prNumber`
- `vendor_code` / `vendorCode`

## Deployment Considerations

### VPS Environment Variables

Set these environment variables on your VPS:

```bash
# TCS ERP Credentials
TCS_USERNAME=your_username
TCS_PASSWORD=your_password

# Google Sheets Integration
GOOGLE_SHEET_ID=your_sheet_id
GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json

# Cloudflare Workers Integration
CLOUDFLARE_WORKERS_URL=https://your-worker.workers.dev
API_TOKEN=your_api_token
```

### Systemd Service Example

Create a systemd service for the VPS worker:

```ini
[Unit]
Description=TCS ERP Bot Worker
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/TCS-ERP Bot
Environment="PATH=/usr/bin:/usr/local/bin"
ExecStart=/usr/bin/python3 worker_pr_po.py --worker --interval 60
Restart=always

[Install]
WantedBy=multi-user.target
```

## Monitoring

### Bot Run Logs

All bot runs are recorded in Google Sheets `bot_runs` table with:
- Status (pending, running, success, failed)
- Input/output JSON
- Duration
- Error messages
- Timestamps

### VPS Logs

Check VPS logs in the `logs/` directory:
- `server.err.log` - Error logs
- `server.out.log` - Output logs
- Screenshots in `logs/screenshots/`

## Troubleshooting

### Common Issues

1. **"itemCode is required"**: Ensure required fields are present in JSON
2. **"login failed"**: Check TCS credentials in environment variables
3. **"save failed"**: Check TCS ERP portal connectivity and field mappings
4. **"vendor not found"**: Verify vendor code exists in TCS system

### Debug Mode

Run bots with visible browser for debugging:

```bash
# PR Bot
python PR_combined.py --json examples/pr_input_simple.json

# PO Bot  
python PO_combined.py --json examples/po_input_simple.json
```

The bots run with `headless=False` by default, so you can see the browser automation.

## Future Enhancements

- Add batch processing for multiple items
- Implement webhook callbacks instead of polling
- Add real-time status updates via WebSocket
- Support for additional TCS ERP modules
- Enhanced error recovery and retry logic
