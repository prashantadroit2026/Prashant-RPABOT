# Backend Summary - Procurement Hub

## Overview
The Procurement Hub is a Python FastAPI backend that uses Google Sheets as its database. It provides a REST API for managing procurement operations including items, machines, slips (material requests), bots (RPA automation), and alerts.

## Deployment Architecture
- **Frontend**: Vercel (React/TanStack application)
- **Backend**: Cloudflare Workers (Python FastAPI runtime)
- **RPA Bot**: VPS (Playwright automation scripts)
- **Database**: Google Sheets (shared backend storage)
- **Authentication**: Google OAuth2 Service Account

## Technology Stack
- **Framework**: FastAPI 0.115.0
- **Server**: Uvicorn 0.30.6 (ASGI server)
- **Database**: Google Sheets API (via gspread 6.1.2)
- **Authentication**: Google OAuth2 Service Account
- **Data Validation**: Pydantic 2.9.2
- **Configuration**: Pydantic Settings 2.5.2
- **Retry Logic**: Tenacity 9.0.0
- **HTTP Client**: httpx 0.27.2

## Project Structure
```
procurement-backend/
├── src/
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Configuration management
│   ├── worker.py            # Cloudflare Workers entrypoint (ASGI adapter)
│   ├── routers/             # API route handlers
│   │   ├── health.py        # Health check endpoint
│   │   ├── catalog.py       # Items and machines endpoints
│   │   ├── slips.py         # Material slip endpoints
│   │   └── bots.py          # Bot and alert endpoints
│   ├── services/            # Business logic layer
│   │   └── sheet_service.py # Core business logic
│   └── sheets/              # Google Sheets integration
│       ├── client.py        # Sheets API client
│       └── models.py        # Pydantic data models
├── secrets/                 # Service account credentials (gitignored)
├── .env                     # Environment configuration (gitignored)
├── .env.example             # Environment template
├── requirements.txt         # Python dependencies
├── Dockerfile               # Container configuration
├── pyproject.toml          # Python project metadata
└── wrangler.jsonc          # Cloudflare Workers config
```

## Database Schema (Google Sheets)

### Worksheets (Tables)
1. **items** - Item catalog with inventory levels
   - Fields: id, code, name, uom, reorder_level, qty, unit_price, category, created_at

2. **machines** - Machine master data
   - Fields: id, code, name, line, created_at

3. **slips** - Material request slips
   - Fields: id, token, group_token, group_id, item_id, item_code, item_name, machine_id, machine_code, machine_name, qty, issued_qty, uom, department, station, cell, hod_title, hod_confirmed, slip_date, status, note, description, created_at, decided_at

4. **movements** - Inventory movement tracking
   - Fields: id, item_id, machine_id, slip_id, qty, kind, created_at

5. **bots** - RPA bot definitions
   - Fields: id, code, name, description, type, status, cron_expr, config, last_run_at, next_run_at, created_at

6. **bot_runs** - Bot execution history
   - Fields: id, bot_id, bot_code, status, trigger, started_at, finished_at, duration_ms, input, output, error

7. **alerts** - System alerts
   - Fields: id, severity, title, message, bot_id, item_id, acknowledged, created_at

8. **audit_logs** - Audit trail
   - Fields: id, actor, action, entity_type, entity_id, payload, created_at

9. **meta** - Metadata and counters
   - Fields: key, value (used for auto-increment IDs)

## API Endpoints

### Health & System
- `GET /api/health` - Service health check and Google Sheets connection status
- `GET /` - Root endpoint with service info

### Catalog & Inventory
- `GET /api/catalog` - Get complete catalog (items + machines)
- `GET /api/inventory` - Get inventory with consumption analytics
- `GET /api/machines` - List all machines

### Material Slips
- `GET /api/slips` - List slips (optional `?status=pending` filter)
- `POST /api/slips` - Create a single material slip
- `POST /api/slips/group` - Create multiple slips as a group
- `POST /api/slips/decide` - Store decision: stock/split/pr/reject
- `POST /api/slips/receive` - Mark PR received and restock inventory

### Bots & Automation
- `GET /api/bots` - List all configured bots
- `POST /api/bots/trigger` - Manually trigger a bot run
- `GET /api/runs` - List recent bot runs (limit parameter)
- `GET /api/alerts` - List system alerts (limit parameter)
- `POST /api/alerts` - Create a new alert

## Core Components

### 1. Configuration Management (`config.py`)
- **Settings Class**: Pydantic-based configuration
- **Environment Variables**:
  - `GOOGLE_SERVICE_ACCOUNT_JSON` - Path to service account JSON file
  - `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT` - Inline JSON (for cloud deployments)
  - `GOOGLE_SHEET_ID` - Google Spreadsheet ID
  - `HOST` - Server host (default: 0.0.0.0)
  - `PORT` - Server port (default: 8080)
  - `DEBUG` - Debug mode (default: True)
  - `SEED_ON_START` - Auto-seed demo data (default: True)
  - `CORS_ORIGINS` - Allowed CORS origins (include Vercel domains in production)
  - `CORS_ALLOW_CREDENTIALS` - Allow credentials (default: False)

### 2. Google Sheets Client (`sheets/client.py`)
- **Authentication**: OAuth2 Service Account with retry logic
- **Worksheet Management**: Auto-creation of missing worksheets with headers
- **CRUD Operations**:
  - `get_all_records()` - Read all rows from a worksheet
  - `append_row()` - Add a new row
  - `update_row()` - Update an existing row by index
  - `find_row_by_id()` - Locate a record by ID
  - `next_id()` - Auto-increment ID generation
- **Retry Strategy**: 3 attempts with exponential backoff
- **Caching**: LRU cache for client and spreadsheet connections

### 3. Data Models (`sheets/models.py`)
- **Pydantic Models**: Type-safe data structures matching frontend
- **Key Models**:
  - `Item`, `Machine`, `Catalog` - Catalog entities
  - `Slip`, `SlipCreate`, `SlipGroupCreate`, `SlipDecide`, `SlipReceive` - Slip operations
  - `InventoryRow` - Inventory with analytics
  - `Bot`, `BotTrigger`, `BotRun` - Bot automation
  - `Alert`, `AlertCreate` - System alerts
- **Status Enums**: SlipStatus, Alert severity levels

### 4. Business Logic (`services/sheet_service.py`)
- **Catalog Operations**:
  - Item/machine CRUD operations
  - Stock quantity updates with delta tracking
  - Item lookup by code or ID

- **Slip Operations**:
  - Single and group slip creation
  - Decision logic (stock issue, partial split, PR creation, rejection)
  - Inventory movement tracking
  - Receipt processing for PR fulfillment

- **Inventory Analytics**:
  - 30-day consumption calculation
  - Stock status determination (in/low/out)
  - Days of stock coverage calculation

- **Bot Operations**:
  - Bot listing and triggering
  - Simulated run recording (placeholder for real RPA integration)
  - Bot run history tracking

- **Alert Management**:
  - Alert creation and listing
  - Severity-based categorization

- **Data Seeding**:
  - Demo data initialization (5 items, 3 machines, 1 bot)
  - Conditional seeding (only if sheets are empty)

### 5. API Routers
- **Health Router**: Basic health check
- **Catalog Router**: Items, machines, inventory endpoints
- **Slips Router**: Material request workflow
- **Bots Router**: Automation and alert management
- **Error Handling**: Consistent HTTP exception handling with 400/500 status codes

## Application Lifecycle (`main.py`)

### Startup Process
1. Load configuration from environment
2. Initialize FastAPI application with CORS middleware
3. Mount routers under `/api` prefix
4. Execute startup lifecycle:
   - Ensure all worksheets exist with proper headers
   - Seed demo data if enabled and sheets are empty
   - Verify Google Sheets connection

### Deployment Modes
- **Standard Mode**: Full startup with Google Sheets initialization
- **Worker Mode**: Skips startup (for Cloudflare Workers snapshot)

## Deployment Architecture

### Production Setup
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Vercel        │     │  Cloudflare     │     │     VPS         │
│   Frontend      │────▶│  Workers        │────▶│   RPA Bot       │
│   (React)       │     │  (Python API)   │     │  (Playwright)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Google Sheets  │
                        │   (Database)    │
                        └─────────────────┘
```

### Data Flow
1. **User → Vercel Frontend**: User interacts with React UI
2. **Vercel → Cloudflare Workers**: Frontend calls API endpoints
3. **Cloudflare Workers → Google Sheets**: Read/write operations
4. **Cloudflare Workers → VPS**: Bot trigger requests (via polling or webhooks)
5. **VPS → TCS ERP**: Playwright automation for PR/PO creation
6. **VPS → Google Sheets**: Update bot run status and results
7. **Google Sheets → Cloudflare Workers**: Data sync for frontend updates

### 1. Frontend - Vercel Deployment
- **Platform**: Vercel
- **Framework**: React/TanStack
- **Configuration**: Environment variable `VITE_API_BASE` pointing to Cloudflare Workers URL
- **Build Process**: Automatic on push to main branch
- **Features**: CDN edge caching, automatic HTTPS, preview deployments

### 2. Backend - Cloudflare Workers (Primary Production)
- **Platform**: Cloudflare Workers with Python runtime
- **Configuration**: `wrangler.jsonc`
- **Key Features**:
  - Global edge deployment
  - Automatic scaling
  - Snapshot mode for deployment (skips live network calls)
  - Environment variables via Cloudflare secrets
- **Required Environment Variables**:
  - `GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT` - Full service account JSON
  - `GOOGLE_SHEET_ID` - Spreadsheet ID
  - `DEBUG` - false
  - `SEED_ON_START` - false
  - `CORS_ORIGINS` - Vercel frontend domain(s) (e.g., `["https://your-app.vercel.app"]`)
- **Deployment Command**:
  ```bash
  npx wrangler deploy
  ```

### 3. RPA Bot - VPS Deployment
- **Platform**: VPS (DigitalOcean, AWS EC2, etc.)
- **Technology**: Playwright automation scripts
- **Connection**: Polls Cloudflare Workers API for bot triggers
- **Authentication**: API tokens or shared secrets
- **Bot Scripts**:
  - `PR Approver/PR_combined.py` - Purchase Requisition bot
  - `Purchase Order/PO_combined.py` - Purchase Order bot
  - `worker_pr_po.py` - Queue worker orchestrator
- **Monitoring**: Logs stored in `logs/` directory, bot runs recorded in Google Sheets
- **Required Environment Variables**:
  - `CLOUDFLARE_WORKERS_URL` - Cloudflare Workers API endpoint
  - `API_TOKEN` - Authentication token for Cloudflare Workers
  - `TCS_CREDENTIALS` - TCS ERP portal credentials
  - `GOOGLE_SHEET_ID` - Same spreadsheet ID as Workers

### 4. Database - Google Sheets
- **Shared Storage**: Used by both Cloudflare Workers and VPS RPA bot
- **Permissions**: Service account shared with Editor access
- **Backup**: Automatic versioning via Google Sheets
- **Access Control**: Google IAM for service account management

## Deployment Options

### Local Development
```bash
cd procurement-backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with credentials
uvicorn main:app --reload --port 8080
```

### Docker Deployment (Alternative)
```bash
docker compose up --build -d
```
- Uses Python 3.12-slim base image
- Non-root user for security
- Excludes secrets, logs, venv from image
- Health check at `/api/health`
- Useful for testing or alternative deployment scenarios

### Cloudflare Workers Setup Steps
1. Install Wrangler CLI: `npm install -g wrangler`
2. Authenticate: `wrangler login`
3. Configure `wrangler.jsonc` with your Worker details
4. Set secrets:
   ```bash
   wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT
   wrangler secret put GOOGLE_SHEET_ID
   wrangler secret put CORS_ORIGINS
   ```
5. Deploy: `wrangler deploy`

### VPS Setup Steps
1. Provision VPS with Python 3.12+ and Playwright dependencies
2. Clone repository and install dependencies
3. Configure environment variables for VPS communication
4. Set up systemd service or cron job for bot worker
5. Test connectivity to Cloudflare Workers API
6. Monitor logs in `logs/` directory

## Key Features

### 1. Google Sheets as Database
- Zero-infrastructure database solution
- Human-readable data storage
- Built-in collaboration features
- Automatic backup and versioning

### 2. Auto-Increment IDs
- Meta worksheet tracks last used IDs per table
- Thread-safe ID generation
- Consistent across all entities

### 3. Retry Logic
- Automatic retry on Google Sheets API failures
- Exponential backoff strategy
- Configurable attempt limits

### 4. Type Safety
- Pydantic models for all data structures
- Automatic validation and serialization
- Frontend-backend type consistency

### 5. CORS Configuration
- Configurable origin whitelist
- Credentials support
- Development-friendly defaults

### 6. Flexible Authentication
- File-based service account (local development)
- Inline JSON (cloud deployments)
- Environment-based configuration

## Integration Points

### Frontend Integration (Vercel)
- **API Connection**: Frontend configured with `VITE_API_BASE` pointing to Cloudflare Workers URL
- **CORS Configuration**: Cloudflare Workers CORS origins must include Vercel domain
- **Authentication**: Currently open; consider adding API keys or JWT tokens
- **Real-time Updates**: Polling-based; consider WebSocket implementation
- **Compatibility**: All endpoints match TanStack React frontend expectations

### RPA Bot Integration (VPS)
- **Communication Pattern**: VPS polls Cloudflare Workers API for bot triggers
- **Bot Trigger Flow**:
  1. Frontend creates slip and triggers bot via Cloudflare Workers API
  2. Bot run recorded in Google Sheets `bot_runs` table with status "pending"
  3. VPS worker (`worker_pr_po.py`) polls for pending bot runs
  4. VPS executes Playwright automation scripts
  5. VPS updates bot run status and results in Google Sheets
- **Authentication**: Use API tokens or shared secrets between VPS and Cloudflare Workers
- **Error Handling**: Bot failures recorded in `bot_runs.error` field
- **File Structure**: RPA scripts in root directory (`PR Approver/`, `Purchase Order/`, `worker_pr_po.py`)

### Google Sheets Integration
- **Shared Database**: Both Cloudflare Workers and VPS RPA bot access same Google Sheets
- **Consistency**: Single source of truth for all data
- **Permissions**: Service account shared with Editor access for both deployments
- **Rate Limiting**: Consider implementing queue if both Workers and VPS write frequently

### External Systems
- Google Sheets API for data persistence
- Google Drive API for spreadsheet access
- TCS ERP Portal (via Playwright on VPS)
- Extensible to add queue systems (Redis/Cloud Tasks) for high-volume scenarios

## Security Considerations

### Current Implementation
- Service account authentication
- CORS origin restrictions
- Non-root Docker user
- Secrets excluded from version control

### Production Recommendations
- Restrict CORS origins to specific Vercel domains
- Use Cloudflare Workers secrets for credentials
- Implement rate limiting at Cloudflare level
- Add request authentication middleware (API tokens/JWT)
- Enable HTTPS only (automatic on Cloudflare Workers)
- Implement audit logging (already in audit_logs table)
- Add input sanitization and validation
- Monitor VPS bot execution and Cloudflare Workers metrics

### Architecture-Specific Security
- **Vercel-Cloudflare Communication**: HTTPS with proper CORS configuration
- **VPS-Cloudflare Communication**: API token authentication, IP whitelisting if possible
- **Google Sheets Access**: Service account with minimal required permissions
- **Secret Management**: Use Cloudflare Workers secrets, never commit credentials
- **Network Security**: Consider VPN or private networking for VPS-Cloudflare communication

## Performance Characteristics

### Strengths
- Simple architecture with minimal dependencies
- Fast read operations for small-to-medium datasets
- Zero database maintenance overhead
- Built-in caching via Google Sheets

### Limitations
- Google Sheets rate limits (~100 requests/100s per user)
- Not suitable for high-concurrency scenarios
- Write operations can be slower than traditional databases
- Limited transaction support

### Scaling Options
- Add Redis cache layer
- Implement write queue for batch operations
- Migrate to PostgreSQL for high-volume scenarios
- Use Cloud Tasks for async operations

## Monitoring & Observability

### Current Capabilities
- Health check endpoint (`/api/health`)
- Bot run history with timing (`/api/runs`)
- Error tracking in bot_runs table
- Audit logs table for compliance
- Google Sheets change history

### Recommended Additions
- Structured logging (Cloudflare Workers logs)
- Metrics collection (Cloudflare Analytics)
- Distributed tracing across Vercel-Cloudflare-VPS
- Alert notifications (Cloudflare email/webhooks)
- Performance monitoring (VPS resource usage)
- Uptime monitoring for all components

### Component-Specific Monitoring
- **Vercel**: Built-in analytics, error tracking, deployment logs
- **Cloudflare Workers**: Analytics dashboard, real-time logs, error tracking
- **VPS**: System monitoring (CPU, memory, disk), bot execution logs
- **Google Sheets**: Activity dashboard, change notifications

## Development Workflow

### Adding New Endpoints
1. Define Pydantic model in `sheets/models.py`
2. Implement business logic in `services/sheet_service.py`
3. Create router in `routers/` directory
4. Mount router in `main.py`
5. Update API documentation

### Database Schema Changes
1. Add worksheet name to `WORKSHEETS` list
2. Define headers in `ensure_worksheets()`
3. Add row conversion functions
4. Update seed data if needed
5. Test worksheet auto-creation

### Testing Recommendations
- Unit tests for business logic
- Integration tests with test spreadsheet
- API endpoint tests
- Error scenario testing
- Load testing for rate limits
- End-to-end testing across Vercel-Cloudflare-VPS architecture
- Network latency testing between components

## Troubleshooting

### Common Issues

#### 1. Google Sheets Connection Failed
- Verify service account JSON in Cloudflare Workers secrets
- Check spreadsheet sharing permissions with service account email
- Validate sheet ID in environment variables
- Check Cloudflare Workers logs for authentication errors

#### 2. CORS Errors (Vercel to Cloudflare)
- Ensure Vercel domain is in Cloudflare Workers CORS origins
- Check CORS credentials setting (should be false for cross-origin)
- Verify API base URL in Vercel environment variables
- Test with curl to isolate CORS vs. network issues

#### 3. VPS Bot Not Responding
- Check VPS connectivity to Cloudflare Workers URL
- Verify API token authentication between VPS and Workers
- Review VPS bot execution logs in `logs/` directory
- Check bot run status in Google Sheets `bot_runs` table

#### 4. Rate Limit Errors
- Google Sheets rate limits (~100 requests/100s per user)
- Implement request queue if VPS and Workers both write frequently
- Add exponential backoff (already implemented)
- Consider cache layer for read-heavy operations

#### 5. Authentication Failures
- Verify service account scopes (Sheets + Drive APIs)
- Check JSON key validity in Cloudflare Workers secrets
- Ensure sheet is shared with service account email
- Test service account access independently

#### 6. Data Inconsistency Between Components
- Ensure both Cloudflare Workers and VPS use same Google Sheet ID
- Check for concurrent write conflicts
- Implement locking mechanism if needed
- Review audit logs for concurrent operations

## Future Enhancements

### Planned Features
- Real RPA bot integration
- Advanced inventory forecasting
- Multi-plant support
- User authentication
- Role-based access control
- Advanced reporting
- Email notifications
- Mobile API support

### Technical Improvements
- Database abstraction layer
- Async operations
- WebSocket support for real-time updates
- GraphQL API option
- OpenAPI schema enhancements
- Automated testing pipeline

## Documentation References
- Main README: `procurement-backend/README.md`
- Project README: `README.md`
- Architecture notes: `DATA-INLETS-OUTLETS.txt`
- Implementation logs: `docs/` directory

## Support & Maintenance

### Version Control
- Python version: 3.12+
- Dependencies: Pin to specific versions in production
- Regular dependency updates recommended
- Monitor Google Sheets API changes
- Keep service account keys secure
- Regular backup of spreadsheet data

### Multi-Component Maintenance
- **Deployment Coordination**: Consider CI/CD pipeline for coordinated deployments
- **Environment Parity**: Maintain separate staging environments for testing
- **Configuration Management**: Use environment-specific configurations
- **Rollback Strategy**: Have rollback procedures for each component
- **Monitoring Integration**: Centralized monitoring across all components

### Best Practices for This Architecture
- **API Versioning**: Implement versioning to avoid breaking changes
- **Error Handling**: Consistent error responses across Workers and VPS
- **Logging Standards**: Unified logging format for easier debugging
- **Documentation**: Keep deployment docs updated with current architecture
- **Testing**: Regular integration testing across component boundaries
- **Security Audits**: Regular security reviews of inter-component communication
