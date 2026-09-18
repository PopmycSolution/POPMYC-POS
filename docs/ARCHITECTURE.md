# POPMYC Retail POS - System Architecture

## Document Overview
- **Document ID**: POPMYC-ARCH-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04

---

## 1. Architectural Vision

POPMYC is a **modular monolith** — a single deployable Django backend + single React SPA frontend — with deliberately clean vertical-slice module boundaries so that future extraction into microservices (Stage 03 SaaS) is tractable without a rewrite.

The architecture prioritizes:
1. **Offline-capable POS terminals** (frontend as peer, not thin-client)
2. **An immutable inventory ledger** (StockMovement as the source of truth, Inventory as a projection)
3. **Strict Business data isolation** (row-level scoping at every layer, no cross-business joins)
4. **Ghana-payment-method flexibility** (PaymentMethod rows, not enums; gateway adapters behind a protocol)
5. **Auditability & financial correctness** (ACID transactions for all money + stock operations)

---

## 2. Tech Stack (Stage 01)

### 2.1 Backend — Application Layer
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | Python 3.12 | Mature, Django-compatible, type-hinted (PEP 695 generics), large Ghana dev talent pool |
| Web Framework | Django 5.2 LTS | Admin for back-office CRUD, ORM with migrations, auth primitives, CSRF, middleware ecosystem |
| REST Framework | Django REST Framework 3.15 | Serializers, ViewSets, permissions, throttling, pagination, test client; standard for Django APIs |
| Authentication | djangorestframework-simplejwt 5.3 | Short-lived JWT access tokens + long-lived refresh tokens (HTTPOnly cookie), sliding refresh |
| Background Tasks | Django Q 2 (Redis ORM queue backend) OR Dramatiq + Redis | Scheduled jobs (nightly backup, expiry scan, low-stock scan), retryable sync workers, PDF receipt rendering (future) |
| Validation | Django ORM clean() + DRF serializers + pydantic 2 (services layer) | Defense in depth: form-validation → ORM model → database constraint |
| Structured Logging | structlog (JSON) + rotating file handler | Ship-ready log correlation, request-id, user-id, business_id on every log line |
| Environment | python-decouple + .env (never committed) | 12-factor config; local dev, LAN deploy, staging, prod all same code |

### 2.2 Backend — Data Layer
| Component | Choice | Rationale |
|-----------|--------|-----------|
| RDBMS | PostgreSQL 16 LTS | ACID, JSONB, window functions, full-text search (Ghanaian accents in Twi/English names), CHECK constraints, pg_dump standard format, indexed foreign keys |
| Encryption at rest (optional) | pgcrypto extension + LUKS/BitLocker volume | Column-level encryption: customer.phone, user.password_hash handled by Django; full-disk via OS |
| ORM | Django ORM + Raw SQL (reporting queries only) | Avoid N+1 with `select_related` / `prefetch_related`; windowed report queries use raw parameterised SQL via `cursor()` |
| Migrations | Django Migrations | Idempotent, squashed per minor release; additive-only between patches |

### 2.3 Frontend — Web Application
| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript 5.4 | Strict mode + strictNullChecks: no undefined-crashes in POS cart; interfaces for all API DTOs |
| Framework | React 18 + Vite 5 | Concurrent rendering, hooks API, fast HMR dev experience, Vite build < 15s |
| Styling | Tailwind CSS 3.4 + shadcn/ui components | Fast iteration, accessibility-focused primitives, touch-friendly button sizing, tree-shaken CSS |
| State Management | Zustand 4 (stores by slice) + React Query v5 (server state) | Zustand for POS cart/offline state (IndexDB persisted), React Query for back-office CRUD lists with cached pagination |
| Offline DB | IndexedDB via Dexie.js 4 | Schema-versioned local store, primary indexes on (business_id, id), compound indexes for barcode/SKU lookups |
| Router | React Router v6 (data routers) | Protected routes, loaders for data, actions for mutations, error boundaries per-route |
| Forms | react-hook-form 7 + zod 3 resolvers | Form-level typed validation matching backend; API error binding to fields |
| Thermal Printing | ESC/POS builder (custom, or `node-thermal-printer`-inspired TS) over WebUSB / Network TCP socket via companion service | Stage 01: companion bridge app (Electron or small Python service) for USB because browser WebUSB driver support for cheap Chinese thermal printers is inconsistent on Windows |
| Dates/Times | date-fns 3 + Intl API (locale en-GH) | No massive moment.js; local timezone rendering; formatting for GH₵ and dates |

### 2.4 Infrastructure (Stage 01 — Single PC / LAN)
| Component | Choice | Rationale |
|-----------|--------|-----------|
| OS | Windows 11 Pro (x64) on server PC | 90%+ of Ghana retail shops run Windows; easy driver support for printers/scales/scanners |
| Reverse Proxy | nginx 1.26 (Windows build) or IIS 10 | Static frontend hosting; proxy `/api` → Django; TLS for LAN self-signed cert |
| Django Runner | Gunicorn (WSL2 Ubuntu) OR waitress (native Windows) behind NSSM Windows service | Waitress is pure-Python, no cygwin, stable for 10–20 concurrency on single LAN |
| Container Option (alternative) | Docker Desktop + docker-compose (Django + PostgreSQL + Redis + Nginx) | For deployments with a part-time IT admin; easier upgrade path |
| Backup Store | Local SSD folder + network share (SMB/NAS) + optional USB drive rotation | GRA 7-year retention; 3-2-1 rule: 3 copies, 2 media, 1 offsite (admin takes USB home weekly) |

---

## 3. Module Decomposition (Vertical Slices)

The Django backend is organized as `apps/*` with strict dependency direction. No circular imports between modules. Public API surface per module is exposed via a `services.py` package; other modules MUST call services, not ORM models of another module directly.

```
backend/
  apps/
    tenancy/          # Business, BusinessSettings, Branch, Warehouse, Register, SystemSetting, License
    identity/         # User, Role, Permission, Employee, LoginSession, AuditLog
    catalog/          # Product, Category, Brand, Unit, ProductVariant, Barcode, ProductPrice,
                      # ProductTax, ProductSupplier, ProductImage, Medicine, MedicineBatch,
                      # Device, IMEI, DeviceWarranty
    inventory/        # Inventory, StockMovement, StockAdjustment, StockAdjustmentItem,
                      # StockTransfer, StockTransferItem, StockCount, StockCountItem
    sales/            # Sale, SaleItem, SaleDiscount, SaleTax, HeldSale,
                      # SaleReturn, SaleReturnItem, Refund
    payments/         # Payment, PaymentMethod, split payment service, MoMo adapter interface
    purchases/        # Supplier, PurchaseOrder, PurchaseOrderItem, GoodsReceipt, GoodsReceiptItem,
                      # PurchaseInvoice, PurchaseInvoiceItem, PurchaseReturn, PurchaseReturnItem, SupplierPayment
    customers/        # Customer, CustomerGroup, CustomerCredit, CustomerCreditPayment,
                      # LoyaltyAccount, LoyaltyTransaction
    accounting/       # Account, Expense, ExpenseCategory, Income, CashAccount, BankAccount,
                      # FinancialTransaction, JournalEntry, JournalEntryLine, Shift, CashDrawer
    repairs/          # Repair, RepairItem, RepairStatus, Technician
    notifications/    # Notification + delivery channels (in-app now, SMS/Email later)
    backups/          # Backup model + pg_dump orchestration + encrypt/decrypt + restore
    sync/             # SyncQueue, SyncConflict models, idempotency store, sync service (shared with front)
```

Frontend mirrors:
```
frontend/src/
  modules/
    auth/
    dashboard/
    catalog/
    inventory/
    pos/              # <-- heavy; own Zustand store + Dexie schema
    sales/
    purchases/
    customers/
    accounting/
    repairs/
    settings/
    backups/
  shared/
    components/
    hooks/
    services/         # api-client (axios + interceptors for JWT refresh + offline queue)
    types/
    utils/
    offline/          # Dexie wrapper + sync engine
    hardware/         # printer, scanner, drawer abstractions
```

### Module Dependency Graph (Allowed Edges Only)
```
tenancy ← identity ← catalog ← inventory ← sales ← payments
                                          ↖                     ↖
                                           purchases             customers ← loyalty (inside customers)
                                                                         ↘
                                                                          accounting ← backups
                                                                                       ↘
                                                                                        notifications
                                                                                     ↗
                                                                               repairs
```
Rule: `sales` may call `inventory.services.transact_stock_out()` but `inventory` never calls `sales`. Cross-module reads allowed via services; cross-module writes must go through service that publishes a domain event (in-process Django signal for Stage 01).

---

## 4. Layered Architecture (Within a Vertical Slice)

Within each Django app (module):

```
┌──────────────────────────────────────────────────────────────┐
│  Presentation  (DRF viewsets / views)                        │
│  • Auth/perm checks, input deserialization, status codes     │
│  • Uses cases: call services layer; never ORM directly       │
└────────────────────────────────┬─────────────────────────────┘
                                 │ calls
┌────────────────────────────────▼─────────────────────────────┐
│  Application / Use Cases  (services.py  +  use_cases/)       │
│  • Business rules, orchestration, DTOs, transaction scopes   │
│  • e.g. sales.services.complete_sale(cart, payments, ...)    │
│  • Emits domain signals for side effects (audit log, notify) │
└────────────────────────────────┬─────────────────────────────┘
                                 │ calls
┌────────────────────────────────▼─────────────────────────────┐
│  Domain Model Layer  (models.py)                              │
│  • Rich domain objects (with .clean() rules + model methods) │
│  • Never depend on services; never import from other apps    │
└────────────────────────────────┬─────────────────────────────┘
                                 │ maps via ORM
┌────────────────────────────────▼─────────────────────────────┐
│  Infrastructure Layer  (PostgreSQL tables + indexes)         │
│  • CHECK constraints, UNIQUE indexes, FKs, triggers (audit)  │
│  • Source of truth for data invariants                       │
└──────────────────────────────────────────────────────────────┘
```

### Cross-Cutting Concerns (Middleware / Decorators)
- `BusinessScopeMiddleware`: Ensures every request has a `request.business_id` (derived from JWT claim + user's active business selection; users MAY be staff of multiple businesses, must select at login).
- `TenancyFilter`: Custom Django ORM Manager that adds `.filter(business_id=…)` to all queries for business-scoped models. Models import `TenancyScopedManager`. Any bypass must be explicit and code-reviewed.
- `AuditMiddleware`: Hooks into request/response cycle; creates AuditLog entries (via signal from service layer for writes, not middleware directly, to capture DB-change diffs).
- `RateLimitMiddleware`: DRF throttling classes: login endpoint (5/minute/IP), auth'd write endpoints (60/minute/user), global (600/minute/user).

---

## 5. Typical Request Flow (Online POS)

### 5.1 "Complete a Sale" — Happy Path
```
React POS UI (Zustand cart)
   │
   │ 1. User clicks "Complete Sale" → action validates cart locally
   │    Checks: register open, qty available locally, payment sum === total
   │
   ▼
frontend/shared/services/api.ts (axios)
   │
   │ 2. POST /api/v1/sales/complete
   │    Body: { register_id, shift_id, sale_lines[], payments[],
   │            customer_id?, discount?, notes, idempotency_key }
   │    Header: Authorization: Bearer <access-jwt>
   │            X-Idempotency-Key: <uuid>
   │
   ▼
nginx (LAN reverse proxy, self-signed TLS)
   │
   │ 3. Proxy pass to Django:8000; adds X-Forwarded-For, request_id header
   │
   ▼
Django Middleware Chain
   │  4a. SecurityMiddleware (CSP, HSTS, X-Frame-Options)
   │  4b. CorsMiddleware (allow LAN IP range + localhost)
   │  4c. CsrfViewMiddleware (double-submit cookie for state-changing; exempt JWT-API but check Referer origin for LAN)
   │  4d. SimpleJWT auth → request.user
   │  4e. BusinessScopeMiddleware → request.business_id, request.active_branch_id
   │  4f. AuditMiddleware → attach audit context
   │  4g. DRF Throttle → 60 writes/min per user
   │  4h. IdempotencyMiddleware → checks sync.idempotency_store; if same key seen in last 24h, returns cached response
   │
   ▼
DRF View: sales.views.CompleteSaleViewSet.create()
   │
   │ 5. Permissions check:
   │    - IsAuthenticated
   │    - HasBusinessScope (request.business_id matches user's allowed businesses)
   │    - Object-level: register belongs to branch, shift open, user is assigned cashier for shift
   │    - Field-level: if price_override present → user.has_perm('sale.price_override')
   │    - Field-level: if discount > 10% → user.has_perm('sale.discount_above_10pct')
   │
   ▼
sales.services.complete_sale(dto)
   │
   │ 6. django.db.transaction.atomic():
   │    a. Validate inventory qty_on_hand per line with SELECT ... FOR UPDATE row-lock on Inventory
   │       -> Call inventory.services.stock_out_multi(lines, sale_ref)
   │          -> Write N StockMovement rows (type=SALE, delta=-qty)
   │          -> UPDATE Inventory SET qty_on_hand = qty_on_hand - qty, qty_reserved -= qty
   │    b. Compute tax breakdown per line (GST/NHIL/GETFund as per ProductTax + BusinessSettings)
   │    c. Insert Sale row (invoice_number gapless via business-level sequence)
   │    d. Bulk insert SaleItem rows
   │    e. Bulk insert SaleTax rows (aggregated by tax code)
   │    f. If discount: insert SaleDiscount rows (line-level + order-level)
   │    g. Call payments.services.process_payments(payments_dtos, sale)
   │       -> Insert N Payment rows
   │       -> For each: insert FinancialTransaction (Dr Cash/Asset, Cr Revenue/AR)
   │       -> If Customer Credit used: UPDATE CustomerCredit balance
   │       -> If loyalty account: INSERT LoyaltyTransaction (earn)
   │    h. accounting.services.record_cogs_for_sale(sale)  (if FIFO enabled)
   │       -> Matches StockMovement batches; inserts JournalEntry: Dr COGS, Cr Inventory
   │    i. Decrement Inventory.qty_reserved (previously reserved at "add to cart" if online)
   │
   ▼
Domain Signal: sale_completed.send(sender=Sale, instance=sale)
   │  (handlers in same atomic block so failure rolls back sale):
   │  7a. AuditLog handler → CREATE entry with before/after (null / sale JSON)
   │  7b. Notification handler → create in-app to dashboard for BranchManager if sale > GHS 5000
   │  7c. Low-stock check handler → if any line now below reorder, enqueue Notification
   │  7d. Receipt queue handler → enqueue print job to companion service over IPC
   │  7e. Cash drawer → enqueue kick pulse
   │
   ▼
Response (201 Created)
   │
   │ 8. DRF serialises: {
   │      id, invoice_number, status,
   │      total_incl_tax, total_tax, amount_paid, change,
   │      items[], payments[], taxes[], customer?,
   │      receipt_url
   │    }
   │
   ▼
React POS
   │
   │ 9. Zustand: clear cart, update shift totals locally,
   │    write Sale to IndexedDB (sync status = SYNCED),
   │    trigger print pipeline, route back to empty sale screen.
```

### 5.2 Transaction Boundary Guarantees
- If any step 6a–6i raises → `atomic()` rolls back: no partial sale, no phantom stock deduction, no half-payment.
- If a write to StockMovement fails (e.g. CHECK constraint qty_on_hand >= 0) → exception bubbles, sale not persisted.
- After commit, even if notification/print handlers fail, the financial transaction is preserved. Those are retried asynchronously by the companion print service (at-least-once delivery).

---

## 6. Offline & Sync Architecture Overview

### 6.1 State Machine — Frontend Lifecycle
```
           ┌───────────────────────── ONLINE (synced)
           │                          │   │
      server reachable     network failure │ heartbeat pong OK after 3 missed
           │                  ┌────────────▼───────────┐
           └─────────────────►│   OFFLINE (local ops)  │
                              └────────────┬───────────┘
                                           │ queue depth > 0 AND server reachable
                                           │
                              ┌────────────▼───────────┐
                              │ SYNCING (push then pull)│◄─── conflict
                              └────────────┬───────────┘    detected
                                           │
                              ┌────────────▼───────────┐
                              │ SYNC_ERROR (manual ops) │───► retry after
                              └────────────────────────┘       backoff
```

### 6.2 Sync Direction
- **Push**: Every write the user performs while OFFLINE → appended to `SyncQueue` in IndexedDB with: `entity_type, entity_uuid, op_type (CREATE/UPDATE/DELETE), payload_json, idempotency_key, created_at, retries`.
- **Pull**: When ONLINE → polling every 30s OR on user request. Pulls "delta" endpoint `/api/v1/sync/delta?since=<watermark>` that returns changes per entity ordered by `updated_at` (server watermark = max updated_at seen so far, persisted in IndexedDB).

### 6.3 Entity Sync Categories
| Class | Entities | Direction | Conflict Strategy |
|-------|----------|-----------|--------------------|
| Reference (shared master data) | Product, Category, Brand, Unit, PaymentMethod, Tax, User (active list only), Customer (shared), Supplier (shared) | PULL mostly; offline-create allowed for Customer/Supplier | Last-Writer-Wins on `updated_at`; if both sides changed → flag for manual diff in UI |
| Transactional (local-first) | Sale, SaleItem, Payment, HeldSale, SaleReturn, StockAdjustment (local), StockCount (local) | PUSH first (offline creates), then PULL | LWW on soft-fields; immutable fields (qty sold etc.) never overwritten; if server-side voided sale edited offline → flag |
| Ledger (never edit after create) | StockMovement, FinancialTransaction, JournalEntry, AuditLog | PUSH only (append) | Idempotency-key dedup on server side; conflicts impossible because immutable |
| Per-terminal private | Cart (draft), POS UI state, print queue | LOCAL ONLY | N/A — never sync |

### 6.4 Idempotency
- Client generates `X-Idempotency-Key: UUIDv4` per mutation. Server stores `(business_id, idempotency_key, created_at, response_body)` for 24 h.
- If client retries a push (because 500/timeout) with same key, server returns the original 200/201 response without re-mutating.
- Works across reconnects: offline push sets the key before queuing.

### 6.5 UUID Identity
- All business-scoped tables have a `uuid UUID DEFAULT gen_random_uuid()` column as secondary public key (the id bigserial remains primary for index size / FK compactness). Offline creates use client-generated UUIDv4; server accepts it or replaces with its own and returns mapping via sync (client remaps IndexedDB refs).

Detailed offline design is in `OFFLINE_ARCHITECTURE.md`.

---

## 7. Deployment Topologies (Stage 01)

### 7.1 Topology A — Single PC All-in-One (Shop Kiosk Mode)
```
 ┌──────────────────────────────────────────────────────────────┐
 │ Windows 11 Pro PC (i5-12400 / 16GB / 512GB SSD)              │
 │                                                              │
 │  ┌─────────────┐   ┌──────────────┐   ┌──────────────────┐  │
 │  │ nginx 1.26  │──►│ Django +     │──►│ PostgreSQL 16    │  │
 │  │ :80 / :443  │   │ Waitress     │   │ (SSD tablespace) │  │
 │  └──────┬──────┘   │ NSSM svc     │   │   pg_dump 02:00  │  │
 │         │          └──────────────┘   └──────────────────┘  │
 │         │                            (encrypted backup to   │
 │         │                             D:\popmyc_backups\    │
 │         │                             + \\\NAS\Backups\)    │
 │         ▼                                                     │
 │   Chrome 120+ (kiosk mode, --app=http://localhost)            │
 │     │   ▲                                                      │
 │     │   │ USB HID + WebUSB via COM companion:                │
 │     │   │   • Barcode scanner (HID wedge → input)            │
 │     ├───┤   • 80mm thermal printer ESC/POS USB               │
 │     │   │   • Cash drawer (RJ12 via printer)                 │
 │     ▼   │   • Kitchen printer (Ethernet IP)                  │
 │   Touchscreen (15" / 1024x768)                               │
 └──────────────────────────────────────────────────────────────┘
         │
         └── optional: WiFi for scheduled offsite backup upload
             (Stage 02: cloud disaster recovery bucket)
```

### 7.2 Topology B — Local Area Network (Supermarket 3–20 tills)
```
                       ┌──────────────────────────────────┐
                       │  Back Office Server (headless)   │
                       │  Windows Server 2022 / i7 / 32GB │
                       │  2x SSD RAID 1                   │
                       │                                 │
                       │  nginx + Django + PostgreSQL    │
                       │  + NSSM services                 │
                       │  + File share for backups        │
                       └───────────────┬─────────────────┘
                                       │ GbE LAN switch
                ┌──────────────────────┼────────────────────────┐
                │                      │                        │
      ┌─────────▼─────────┐  ┌────────▼────────┐   ┌───────────▼──────────┐
      │ POS Terminal 1    │  │ POS Terminal 2   │   │ POS Terminal N      │
      │ (Win 10 LTSC)     │  │ (Win 10 LTSC)    │   │ Back-office admin PC│
      │ Chrome kiosk      │  │ Chrome kiosk     │   │ (full admin UI)     │
      │ + printer/scanner │  │ + printer/scanner│   │ Reports + PO entry  │
      └───────────────────┘  └─────────────────┘   └──────────────────────┘
                         Offline tolerance: each terminal runs against
                         local IndexedDB, syncs back when LAN reachable.
```

### 7.3 Network Rules (LAN Topology B)
- All traffic between terminals and server: HTTPS (self-signed CA distributed to all terminals via Windows GPO or manual cert install).
- PostgreSQL port 5432 listens ONLY on 127.0.0.1 on server (never exposed to LAN). Django app connects locally.
- Nginx listens on LAN IP :443 (and localhost :443).
- Terminals resolve `popmyc.local` via DNS on router or local `hosts` file.
- No internet required day-to-day. Nightly optional: backup upload + NTP sync (server uses `time.google.com` for clock; fallback to BIOS RTC).

---

## 8. API Design Principles

### 8.1 Endpoint Shape & Versioning
- URL base: `/api/v1/{module}/{entity}/` for collection, `/api/v1/{module}/{entity}/{uuid}/` for detail.
- Versioning: URL path-based (`v1`). A future `v2` runs side-by-side in same deployment; legacy v1 supported 18 months after v2 GA.
- All responses envelope: `{ data: <list|object>, meta: { total, page, per_page, cursor?, request_id } }` for lists; `{ data: <object>, meta: { request_id } }` for single.
- All errors envelope: `{ error: { code: "INSUFFICIENT_STOCK", message: "...", details: [...], request_id, retriable: true|false } }`. Codes are stable strings (not numeric) for frontend branching.

### 8.2 CRUD Verbs
| HTTP | Purpose | Idempotent? |
|------|---------|-------------|
| GET /collection?page=2&per=50 | List (paginated) | Yes |
| GET /:uuid | Retrieve | Yes |
| POST /collection | Create | No (use Idempotency-Key header to make it idempotent) |
| PUT /:uuid | Full replace | Yes |
| PATCH /:uuid | Partial update | No (for our backend; but treat as Yes except for counter increments — those use dedicated action endpoints) |
| DELETE /:uuid | Soft delete (set `is_active=false` / `deleted_at`) | Yes |
| POST /:uuid/{action} | Action: e.g. `/complete`, `/receive`, `/approve`, `/close_shift` | No (protected by idempotency key via action-specific token) |

### 8.3 Filtering, Sorting, Pagination
- Filter: DRF django-filters, with `business_id` forced by `BusinessScopeFilter` even if client tries to pass a foreign one.
- Sort: `?ordering=field,-other` (prefix `-` = DESC).
- Pagination: default `CursorPagination` for large transactional tables (cursor on `(created_at DESC, id DESC)`); `PageNumberPagination` for small reference tables with `?page=&per_page=` (max per_page=500 to avoid pulling 100k products accidentally).

### 8.4 DateTime, Currency & Encoding
- All timestamps on wire: ISO 8601 UTC, e.g. `2026-09-04T08:30:00Z`. Frontend renders in `Africa/Accra` timezone via Intl (UTC offset +00:00 permanently; no DST).
- Money: integers in pesewas (GHS * 100) in JSON to avoid float precision. So `1234.56 GHS` = `123456` pesewas on wire. UI formats with GH₵ symbol. Backend uses `DecimalField(max_digits=14, decimal_places=2)`; wire conversion is in serializers layer.
- All JSON: UTF-8 with BOM NOT required. CJK and accented Twi/Èʋ names OK.

### 8.5 WebSocket (Future, Stage 02)
- Real-time: `/ws/dashboard/` (live feed of sales), `/ws/kitchen/` (order tickets). Django Channels + Redis channel layer. Not Stage 01.

---

## 9. Key Architectural Decisions (ADR Reference)

### ADR-001: Modular Monolith Over Microservices (Stage 01/02)
- **Context**: Team size is small; single LAN deploy target.
- **Decision**: Modular monolith with strict module boundaries.
- **Consequences**: Faster iteration, single deployable, no distributed-system network call failures. Extracting services later: each module is a candidate microservice boundary.

### ADR-002: StockMovement Append-Only Ledger vs. In-Place Inventory Updates
- **Decision**: StockMovement is immutable append-only. Inventory is a projection table maintained by triggers + service layer with `SELECT FOR UPDATE` locks.
- **Rationale**: Auditability: every stock change has a reason. Reconstruct any point-in-time inventory via sum of movements. Detect ledger drift nightly with checksum query.

### ADR-003: Pesewas (integer cents) Over Float on Wire vs. Decimal as String
- **Decision**: Integers of smallest currency unit (pesewas = 1/100 GHS) in JSON. Backend uses Decimal for math.
- **Rationale**: 0.1 + 0.2 IEEE 754 bugs in JS. String decimals require per-site parsing; int math is foolproof in TS.

### ADR-004: PostgreSQL Over SQLite or MySQL
- **Decision**: PostgreSQL 16 LTS.
- **Rationale**: ACID transactions with row-level `FOR UPDATE SKIP LOCKED`, JSONB for AuditLog before/after, partial/expression indexes for fast Ghanaian name search, CHECK constraints for non-negative stock, pg_dump industry standard.

### ADR-005: Companion Windows Service for USB Hardware (Stage 01)
- **Decision**: React SPA talks over localhost HTTP to a small Python/Go companion service that drives USB printer/cash drawer via Windows drivers. Companion service installed by inno-setup installer.
- **Rationale**: WebUSB support for cheap Chinese 58mm printers (XPrinter, Gprinter) is inconsistent on Windows Chrome. A local service with signed WinUSB drivers works reliably.

---

## 10. Observability & Diagnostics (Stage 01)

### 10.1 Logs (Structured JSON Lines)
```json
{
  "timestamp": "2026-09-04T08:30:12Z",
  "level": "INFO",
  "logger": "sales.services",
  "request_id": "req_01J9ZYXWVUTSRQPONM",
  "business_id": 3,
  "user_id": 17,
  "branch_id": 2,
  "event": "sale_completed",
  "sale_id": 10293,
  "invoice_number": "INV-2026-001023",
  "total_pesewas": 450000,
  "duration_ms": 142
}
```
Rotation: 50 MB / file, 14 compressed copies kept in `C:\ProgramData\POPMYC\logs\*.log.gz`.

### 10.2 Metrics (Stage 01: local dashboards)
- App-level counters exposed via Django Prometheus: `popmyc_sales_total{branch}`, `popmyc_payments_total{method}`, `popmyc_stock_movements_total{type}`, `popmyc_sync_queue_depth{terminal}`.
- Admin dashboard "Health" widget shows: PostgreSQL size, last backup age, sync lag per terminal (max age of unsynced entity per terminal UUID), disk free %.
- Stage 03: Prometheus + Grafana cloud.

### 10.3 Health Check
- `GET /api/v1/health/public`: 200 if Django + PostgreSQL reachable. Payload: `{ ok: true, db: true, uptime_s: 1234, version: "1.0.0" }`. Used by nginx upstream health and terminal offline-detection.

---

## 11. Extensibility & Integration Points

### 11.1 Payment Gateway Adapter Protocol (Python ABC)
```python
class IPaymentGatewayAdapter(ABC):
    """All MoMo/Card/Bank gateways implement this."""
    name: str
    supported_methods: list[str]  # e.g. ["MTN_MOMO", "TELECEL_CASH"]

    @abstractmethod
    def initiate_payment(self, payment: Payment, payer_phone: str | None = None) -> PaymentGatewayResult:
        """Return { status: PENDING|COMPLETED|FAILED, gateway_ref, gateway_fee, customer_message, poll_url? }"""

    @abstractmethod
    def poll_status(self, payment: Payment) -> PaymentGatewayResult:
        """Called by background job on PENDING payments."""

    @abstractmethod
    def initiate_refund(self, payment: Payment, amount_pesewas: int, reason: str) -> PaymentGatewayResult:
        ...
```
Stage 01 ships: `ManualMoMoAdapter` (cashier ticks confirmed), `ManualCashAdapter` (always COMPLETED immediately), `ManualBankTransferAdapter` (PENDING until accountant marks received). Stage 02 ships `HubtelAggregateAdapter`, `SlydepayAdapter`, `FlutterwaveAdapter`.

### 11.2 Hardware Driver Protocol (Frontend TypeScript + Companion Service)
- `PrinterDriver`: `queueReceipt(receiptDoc: EscPosDoc) : Promise<JobStatus>`
- `CashDrawerDriver`: `kick(pin: 2|5) : Promise<void>`
- `ScaleDriver`: `readWeight(timeoutMs: 3000) : Promise<{ grams: number, stable: boolean }>` (future)
- `BarcodeScannerDriver`: already handled via HID wedge as keyboard input + focus guard on POS search box.

### 11.3 Report Engine
- Core reports: raw-parameterised SQL views (materialised nightly for heavy ones) exposed via DRF as CSV/JSON/PDF (via ReportLab or WeasyPrint).
- Future: pluggable report templates (Jinja2 + WeasyPrint PDF) for custom receipt/invoice layouts.

---

## 12. Code Quality & Architecture Enforcement

| Rule | Enforcement Mechanism |
|------|-----------------------|
| No cross-module direct ORM calls | `pylint` plugin + pre-commit hook that greps `from apps.X.models` in `apps.Y.services` where X → Y not allowed in dependency graph |
| All mutations wrapped in `transaction.atomic()` | Code review checklist; service-decorator `@atomic_business_op` that also sets application name in PG `SET application_name = 'popmyc:sales'` for pg_stat_activity |
| Every business-scoped model uses `TenancyScopedManager` | CI test: introspect all models subclassing `BusinessScopedMixin`; fail if default_manager not a subclass |
| Pesewas (int) on wire, Decimal in DB | DRF field custom class `PesewasIntegerField`; serializer tests assert no floats leak |
| AuditLog for all writes | Signal-based audit logger on `post_save` / `post_delete` for `AuditableMixin` models + service-level explicit calls for soft deletes |
| Unsafe queries bypassing tenancy filter | Django `connection.execute_wrapper` in tests; any query on business-scoped table missing `business_id = ...` predicate fails the test with Explain analyse |

---

## 13. Future Evolution Path (Stage 02 / 03 / 04)

### 02
- Break companion hardware service into signed Electron shell for easier driver installs.
- Add Django Channels for live dashboard.
- Domain events outbox pattern (write to sync.outbox table, forward to MoMo gateway, SMS).

### 03
- Extract `payments` module to microservice with its own DB; synchronous gRPC for queries, async Kafka for events.
- PostgreSQL logical replication per business for cross-region DR.
- Tenant-aware connection pooling (PgBouncer in transaction pooling + `SET app.business_id` per statement via custom class).

### 04
- CQRS for reporting: Debezium CDC → Kafka → ClickHouse for ad-hoc analytics queries.
- OpenTelemetry tracing across services.

Architecture review at each stage exit gate; documents above are version-controlled alongside code (`docs/` folder committed to repo, reviewable in same PR as code that changes behavior).
