# POPMYC Retail POS - Database Design

## Document Overview
- **Document ID**: POPMYC-DB-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04
- **RDBMS**: PostgreSQL 16

---

## 1. Schema Conventions & Global Rules

### 1.1 Naming Conventions
| Object | Convention | Example |
|--------|------------|---------|
| Table names | `snake_case`, plural (business data) or singular (lookup enum if table-backed) | `sales`, `sale_items`, `payment_methods` |
| Column names | `snake_case`, descriptive | `invoice_number`, `qty_on_hand`, `created_at` |
| Primary key | `id BIGSERIAL PRIMARY KEY` on every table (compact FK for indexes) | — |
| Public id | `uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE` on every business-scoped table (for offline UUID clients) | — |
| Foreign key | `{table_singular}_id BIGINT REFERENCES {table}(id) ON DELETE {CASCADE|RESTRICT|SET NULL}` | `sale_id BIGINT REFERENCES sales(id) ON DELETE RESTRICT` |
| Audit columns | Every table: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `created_by BIGINT NULL REFERENCES users(id)`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by BIGINT NULL REFERENCES users(id)`, `is_active BOOLEAN NOT NULL DEFAULT true` | — |
| Soft deletes | `deleted_at TIMESTAMPTZ NULL` on select tables (users, products, customers). Default queries: `WHERE deleted_at IS NULL AND is_active = true` (enforced via TenancyScopedManager) | — |
| Business scope | Every business-data table: `business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE` — with rare exception (system-only tables) | — |

### 1.2 Primitive Type Map
| Logical | PostgreSQL Column | Django Field | Wire (JSON) |
|---------|-------------------|--------------|-------------|
| ID / FK | `BIGINT` | `BigIntegerField` / `ForeignKey` | number (safe integer) |
| UUID | `UUID NOT NULL DEFAULT gen_random_uuid()` | `UUIDField(db_index=True)` | string (lowercase UUID v4) |
| Money (GHS) | `NUMERIC(14,2) NOT NULL` | `DecimalField(max_digits=14, decimal_places=2)` | integer = pesewas (value * 100) |
| Qty (stock/sales) | `NUMERIC(12,3) NOT NULL` (3 decimals for kg/L items) | `DecimalField(max_digits=12, decimal_places=3)` | number (float-safe) |
| Percentage | `NUMERIC(6,4) NOT NULL` e.g. 0.1500 = 15% | `DecimalField(max_digits=6, decimal_places=4)` | number (0..1) for API; UI shows % |
| Short string | `VARCHAR(255)` | `CharField(max_length=255)` | string |
| Long string / description | `TEXT` | `TextField()` | string |
| Boolean | `BOOLEAN NOT NULL DEFAULT false/true` | `BooleanField()` | boolean |
| Date-only (e.g. expiry, DOB) | `DATE` (no timezone, since Ghana = UTC and date is civil) | `DateField()` | string `YYYY-MM-DD` |
| Instant (timestamp) | `TIMESTAMPTZ NOT NULL` | `DateTimeField()` | ISO 8601 UTC, e.g. `2026-09-04T08:30:00Z` |
| JSON blob / semi-structured | `JSONB NOT NULL DEFAULT '{}'::jsonb` | `JSONField(default=dict)` | object |
| Enum | `VARCHAR(32)` + CHECK constraint (`IN (...)`) OR native `CREATE TYPE … AS ENUM` | `CharField(choices=…)` | string (case-sensitive) |

### 1.3 Money & Arithmetic Rules
- **No floats anywhere** for money or quantities. `NUMERIC` in DB, `Decimal` in Python, pesewa-integers in JSON.
- CHECK constraint: every monetary amount column that should not be negative has `CHECK (amount >= 0)`; signed columns (e.g. `StockMovement.qty_delta`, `JournalEntryLine.amount`) explicitly omit the sign constraint.
- Totals on transaction headers are **derivations stored for performance** and are guarded by triggers that re-derive them from lines on any line insert/update/delete (or service-layer code that explicitly wraps line + header mutation in the same atomic).

### 1.4 Indexing Strategy (Global Defaults)
- All FKs → separate B-tree index (Django does this by default).
- All `uuid` columns → UNIQUE B-tree.
- `(business_id, created_at DESC)` composite B-tree on every business-scoped table that is ever queried in date order (all transaction tables, AuditLog, Notification, StockMovement).
- `(business_id, <natural_key>)` UNIQUE where applicable, e.g. `UNIQUE (business_id, invoice_number)` on `sales`, because invoice numbers must be gapless per-business.
- GIN trigram index on searchable text: `(business_id, name) gin_trgm_ops` on `products`, `customers`, `suppliers` → enables `ILIKE '%kw%'` queries in <<250 ms over 100k rows.

### 1.5 Transaction Boundaries (Critical)
The following are always one database transaction (`BEGIN; … COMMIT;`)—never partial:
- `Sale complete`: Sale + N SaleItem + N SaleTax + N SaleDiscount + N Payment + N StockMovement(SALE) + Inventory decrements + LoyaltyTransaction (if) + CustomerCredit update (if) + FinancialTransaction rows + JournalEntry (COGS) → atomic.
- `Goods Receipt post`: GoodsReceiptItem inserts → StockMovement(PURCHASE_RECEIPT) × N → Inventory increments + avg cost recompute → PurchaseInvoice (auto-created) + JournalEntry (Dr Inventory, Cr AP).
- `Stock Transfer receive`: StockTransfer status → RECEIVED → StockMovement(TRANSFER_OUT at src already written at "send"; TRANSFER_IN at dest + Inventory adjustments + StockTransferItem.received_qty).
- `Shift close`: Shift end cash, variance, close note, finalise shift status CLOSED + prevent any further writes to tables referencing this shift.

---

## 2. Entity Relationship Summary (Textual ERD)

```
SYSTEM LAYER (shared instance, NOT business scoped)
├── SystemSetting {key,value_json,datatype,description}
└── License {license_key, business_id FK, issued_at, expires_at, max_branches, max_users, tier, status, signature}

TENANCY LAYER
businesses ─1:N─> business_settings (1:1 effectively, key per setting)
businesses ─1:N─> branches
businesses ─1:N─> warehouses
 branches  ─1:N─> registers (POS tills)
 registers ─1:1─> cash_drawers
 warehouses ─N:1─> branches (nullable; standalone warehouse has NULL branch_id)

IDENTITY LAYER
businesses ─1:N─> users (user is member of many-to-many via user_businesses)
 users ─N:M─> roles (many to many: user_roles)
 roles ─N:M─> permissions (many to many: role_permissions)
 users ─1:N─> login_sessions
businesses ─1:N─> employees ─1:1─> users (FK to user + business assignment)
              └─ branches M:1 (employee branch)
businesses ─1:N─> audit_log

CATALOG LAYER
businesses ─1:N─> categories (hierarchy: parent_id self-ref)
businesses ─1:N─> brands
businesses ─1:N─> units (e.g. PIECE, BOX, KG, L with conversion factor)
businesses ─1:N─> products
   products ─1:N─> product_variants (option grid; for simple product 1 variant is created automatically)
   products ─N:M─> categories (product_categories)
   products ─N:1─> brands (nullable)
   products ─N:1─> units (base unit, nullable for non-stock)
businesses ─1:N─> barcodes
   barcodes ─N:1─> products (nullable)
   barcodes ─N:1─> product_variants (nullable; exactly one of product_id or variant_id populated)
businesses ─1:N─> product_prices (price list)
   product_prices ─N:1─> product_variants
   product_prices ─N:1─> customer_groups (nullable; NULL = default price list)
businesses ─1:N─> product_taxes (many-to-many with extra data)
   product_taxes ─N:1─> products
   product_taxes ─N:1─> tax_rates (NHIL, VAT, GETFund, …)
businesses ─1:N─> product_suppliers
   product_suppliers ─N:1─> product_variants
   product_suppliers ─N:1─> suppliers
businesses ─1:N─> product_images
   product_images ─N:1─> product_variants (NULL → for product-level)
   product_images ─N:1─> products
businesses ─1:N─> medicines (1:1 extension to product_id for pharmaceutical)
businesses ─1:N─> medicine_batches
   medicine_batches ─N:1─> product_variants
businesses ─1:N─> devices (1:1 extension to product_id for device-tracked)
businesses ─1:N─> device_warranties
   device_warranties ─N:1─> product_variants
businesses ─1:N─> imeis
   imeis ─N:1─> product_variants
   imeis ─N:1─> medicine_batches (NULL unless applicable)
   imeis ─N:1─> sale_items (when sold)
   imeis ─N:1─> goods_receipt_items (when received)

INVENTORY LAYER (strictly append-only movements + projection Inventory table)
businesses ─1:N─> inventory (projection table: unique (variant_id, branch_id, warehouse_id))
   inventory ─N:1─> product_variants
   inventory ─N:1─> branches
   inventory ─N:1─> warehouses
businesses ─1:N─> stock_movements (append-only immutable ledger)
   stock_movements ─N:1─> product_variants
   stock_movements ─N:1─> branches
   stock_movements ─N:1─> warehouses
   stock_movements ─N:1─> medicine_batches (nullable)
   stock_movements ─ reference polymorphic via (reference_type, reference_id):
                       sales, sale_returns, goods_receipts, supplier_returns,
                       stock_adjustments, stock_transfers, stock_counts, purchases
businesses ─1:N─> stock_adjustments
   stock_adjustments ─1:N─> stock_adjustment_items
      stock_adjustment_items ─N:1─> product_variants
      stock_adjustment_items ─N:1─> medicine_batches (nullable)
businesses ─1:N─> stock_transfers
   stock_transfers ─N:1─> branches (from_branch, to_branch)
   stock_transfers ─N:1─> warehouses (from_warehouse, to_warehouse)
   stock_transfers ─1:N─> stock_transfer_items
      stock_transfer_items ─N:1─> product_variants
businesses ─1:N─> stock_counts
   stock_counts ─N:1─> warehouses
   stock_counts ─N:1─> categories (nullable; if category count)
   stock_counts ─1:N─> stock_count_items
      stock_count_items ─N:1─> product_variants

SALES LAYER
businesses ─1:N─> sales
   sales ─N:1─> branches
   sales ─N:1─> registers
   sales ─N:1─> shifts
   sales ─N:1─> customers (nullable)
   sales ─N:1─> employees (cashier)
   sales ─1:N─> sale_items
      sale_items ─N:1─> product_variants
      sale_items ─N:1─> tax_rates? (no; tax breakdown in sale_taxes)
   sales ─1:N─> sale_taxes (aggregated per tax code)
      sale_taxes ─N:1─> tax_rates
   sales ─1:N─> sale_discounts (order-level + line-level → links sale_item_id nullable)
      sale_discounts ─N:1─> sale_items (nullable)
businesses ─1:N─> payments
   payments ─N:1─> sales (nullable; payment for a sale OR customer credit topup/supplier payment)
   payments ─N:1─> customers (nullable)
   payments ─N:1─> suppliers (nullable)
   payments ─N:1─> payment_methods
   payments ─N:1─> shifts (nullable; cash drawer payments tied to shift)
   payments ─N:1─> cash_accounts (nullable; where money went)
   payments ─N:1─> bank_accounts (nullable)
businesses ─1:N─> held_sales
   held_sales ─N:1─> registers
   held_sales ─N:1─> customers (nullable)
   held_sales ─ (items stored as JSONB on held_sales.cart_snapshot; when recalled → loaded into POS cart)
businesses ─1:N─> sale_returns
   sale_returns ─N:1─> sales (original sale)
   sale_returns ─N:1─> customers
   sale_returns ─1:N─> sale_return_items
      sale_return_items ─N:1─> sale_items (line reference, nullable)
      sale_return_items ─N:1─> product_variants
businesses ─1:N─> refunds
   refunds ─N:1─> sale_returns
   refunds ─N:1─> payments (original payment, for refund reference; also split to multiple payments)
   refunds ─N:1─> payment_methods (method used for refund)

PURCHASING LAYER
businesses ─1:N─> suppliers
businesses ─1:N─> purchase_orders
   purchase_orders ─N:1─> suppliers
   purchase_orders ─N:1─> warehouses (receive destination)
   purchase_orders ─N:1─> branches (nullable)
   purchase_orders ─1:N─> purchase_order_items
      purchase_order_items ─N:1─> product_variants
businesses ─1:N─> goods_receipts
   goods_receipts ─N:1─> purchase_orders (nullable; ad-hoc GR allowed)
   goods_receipts ─N:1─> suppliers
   goods_receipts ─1:N─> goods_receipt_items
      goods_receipt_items ─N:1─> purchase_order_items (nullable)
      goods_receipt_items ─N:1─> product_variants
      goods_receipt_items ─N:1─> medicine_batches (nullable)
businesses ─1:N─> purchase_invoices
   purchase_invoices ─N:1─> goods_receipts (nullable)
   purchase_invoices ─N:1─> suppliers
   purchase_invoices ─1:N─> purchase_invoice_items
      purchase_invoice_items ─N:1─> goods_receipt_items (nullable)
      purchase_invoice_items ─N:1─> product_variants
businesses ─1:N─> purchase_returns
   purchase_returns ─N:1─> purchase_invoices
   purchase_returns ─N:1─> suppliers
   purchase_returns ─1:N─> purchase_return_items
      purchase_return_items ─N:1─> purchase_invoice_items
businesses ─1:N─> supplier_payments
   supplier_payments ─N:1─> suppliers
   supplier_payments ─N:1─> payment_methods
   supplier_payments ─N:1─> bank_accounts / cash_accounts (source)
   supplier_payments ─1:N─> supplier_payment_allocations (junction to purchase_invoices with amount allocated)

CUSTOMER / LOYALTY LAYER
businesses ─1:N─> customer_groups
businesses ─1:N─> customers
   customers ─N:1─> customer_groups (nullable)
businesses ─1:N─> customer_credits (account / balance snapshot 1:1 with customer effectively, but rows are running ledger; current balance = sum of debits-credits)
   customer_credits ─N:1─> customers
businesses ─1:N─> customer_credit_payments
   customer_credit_payments ─N:1─> customers
   customer_credit_payments ─N:1─> payments (source)
businesses ─1:N─> loyalty_accounts (1:1 with customers who opted in)
   loyalty_accounts ─N:1─> customers
businesses ─1:N─> loyalty_transactions
   loyalty_transactions ─N:1─> loyalty_accounts
   loyalty_transactions ─N:1─> sales (nullable)

ACCOUNTING LAYER
businesses ─1:N─> accounts (chart of accounts; with parent_id self-ref for hierarchy)
businesses ─1:N─> expense_categories
businesses ─1:N─> expenses
   expenses ─N:1─> expense_categories
   expenses ─N:1─> payments (for the disbursement)
businesses ─1:N─> incomes (non-sale revenue)
   incomes ─N:1─> payments (for the receipt)
businesses ─1:N─> cash_accounts (sub-type of Account with a register; tied to physical drawer)
   cash_accounts ─N:1─> accounts (parent ledger account)
businesses ─1:N─> bank_accounts (sub-type)
   bank_accounts ─N:1─> accounts
businesses ─1:N─> financial_transactions (every cash/bank/MoMo flow; 1:1 with Payments or other sources)
   financial_transactions ─N:1─> accounts (debit account + credit account 2-column FKs)
businesses ─1:N─> journal_entries (manual journals; auto journals from sales/purchases flagged system=true)
   journal_entries ─1:N─> journal_entry_lines
      journal_entry_lines ─N:1─> accounts (one line is Dr, one Cr; many lines allowed as long as sum=0)
businesses ─1:N─> shifts
   shifts ─N:1─> registers
   shifts ─N:1─> employees (cashier)
   shifts ─1:1─> cash_drawers (logical)
businesses ─1:N─> cash_drawers
   cash_drawers ─N:1─> registers

REPAIRS LAYER (device shops + electronics)
businesses ─1:N─> technicians
businesses ─1:N─> repair_statuses (lookup table or enum row)
businesses ─1:N─> repairs
   repairs ─N:1─> customers
   repairs ─N:1─> employees (intake)
   repairs ─N:1─> technicians (assigned)
   repairs ─N:1─> repair_statuses
   repairs ─1:N─> repair_items
      repair_items ─N:1─> product_variants (if spare part used; chargeable)
      repair_items ─N:1─> imeis (customer device IMEI)

NOTIFICATIONS LAYER
businesses ─1:N─> notifications
   notifications ─N:1─> users (target user)

BACKUPS LAYER
businesses ─1:N─> backups
   backups ─N:1─> users (created_by)
```

---

## 3. Full Table Definitions

> **Note**: All tables have `id BIGSERIAL PRIMARY KEY`. Columns marked `[SYS]` mean "all tables have these audit columns; we list the first time and abbreviate after".

### 3.1 System & Instance-Wide Tables (NOT business-scoped)

#### 3.1.1 `system_settings`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] created_at, created_by, updated_at, updated_by` | — | — | Audit |
| `key` | `VARCHAR(128)` | `UNIQUE NOT NULL` | Setting key e.g. `instance.name`, `security.min_password_length`, `backup.encryption_salt_version` |
| `value_json` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | — | Value. Use with datatype for correct casting. |
| `datatype` | `VARCHAR(16)` | `CHECK (datatype IN ('string','integer','boolean','number','json','date')) NOT NULL` | Type-hint for UI. |
| `description` | `TEXT NULL` | — | Admin-visible description |

#### 3.1.2 `licenses`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] created_at, created_by, updated_at, updated_by` | — | — | Audit |
| `uuid` | `UUID` | `UNIQUE NOT NULL DEFAULT gen_random_uuid()` | — |
| `business_id` | `BIGINT` | `REFERENCES businesses(id) ON DELETE CASCADE, NOT NULL` | Binds license to one business |
| `license_key` | `VARCHAR(128)` | `UNIQUE NOT NULL` | e.g. `POPMYC-PRO-XXXX-XXXX` |
| `tier` | `VARCHAR(32)` | `CHECK (tier IN ('FREE','STARTER','PRO','ENTERPRISE')) NOT NULL` | Feature tier |
| `issued_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | — |
| `expires_at` | `TIMESTAMPTZ` | `NULL` (NULL = perpetual) | — |
| `max_branches` | `INTEGER` | `NOT NULL DEFAULT 1 CHECK (max_branches > 0)` | — |
| `max_users` | `INTEGER` | `NOT NULL DEFAULT 5 CHECK (max_users > 0)` | — |
| `max_sku_limit` | `INTEGER` | `NULL` (NULL = unlimited) | — |
| `status` | `VARCHAR(16)` | `CHECK (status IN ('ACTIVE','EXPIRED','SUSPENDED','REVOKED')) NOT NULL DEFAULT 'ACTIVE'` | — |
| `signature` | `VARCHAR(256)` | `NOT NULL` | HMAC(SK, business_id + tier + expires) — verify at boot to prevent tampering |

---

### 3.2 Tenancy Layer

#### 3.2.1 `businesses`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] created_at, created_by, updated_at, updated_by` | — | — | Audit |
| `uuid` | `UUID` | `UNIQUE NOT NULL DEFAULT gen_random_uuid()` | — |
| `legal_name` | `VARCHAR(255)` | `NOT NULL` | Full registered company name for GRA invoices |
| `trading_name` | `VARCHAR(255)` | `NOT NULL` | Name on signboard/receipts |
| `business_type` | `VARCHAR(32)` | `CHECK (business_type IN ('SOLE_PROPRIETOR','PARTNERSHIP','LIMITED','NGO','OTHER')) NOT NULL` | Entity type |
| `registration_number` | `VARCHAR(64)` | `NULL` | Registrar General's number (RGD) |
| `tin` | `VARCHAR(32)` | `NULL` | GRA Taxpayer Identification Number; validated format |
| `vat_registered` | `BOOLEAN` | `NOT NULL DEFAULT false` | Determines if VAT lines charged |
| `vat_flat_rate_scheme` | `BOOLEAN` | `NOT NULL DEFAULT false` | Alternative: 3% flat on revenue |
| `vat_flat_rate_pct` | `NUMERIC(6,4)` | `NULL` (0.03 if flat) | — |
| `address_line1` | `VARCHAR(255)` | `NOT NULL` | — |
| `address_line2` | `VARCHAR(255)` | `NULL` | — |
| `city` | `VARCHAR(128)` | `NOT NULL` | e.g. Accra, Kumasi |
| `region` | `VARCHAR(128)` | `NOT NULL` | Greater Accra, Ashanti … |
| `gps_address_code` | `VARCHAR(32)` | `NULL` | Ghana Post GPS e.g. GA-123-4567 |
| `primary_phone` | `VARCHAR(32)` | `NOT NULL` | +233… |
| `secondary_phone` | `VARCHAR(32)` | `NULL` | — |
| `email` | `VARCHAR(255)` | `NULL` | — |
| `website` | `VARCHAR(255)` | `NULL` | — |
| `logo_path` | `VARCHAR(512)` | `NULL` | Local path under /media/ |
| `currency_code` | `VARCHAR(3)` | `NOT NULL DEFAULT 'GHS' CHECK (currency_code IN ('GHS','USD','EUR','GBP'))` | — |
| `currency_symbol` | `VARCHAR(8)` | `NOT NULL DEFAULT 'GH₵'` | — |
| `locale` | `VARCHAR(16)` | `NOT NULL DEFAULT 'en_GH'` | en_GH, fr_TG (future Togo market), etc. |
| `timezone` | `VARCHAR(64)` | `NOT NULL DEFAULT 'Africa/Accra'` | — |
| `fiscal_year_start_month` | `INTEGER` | `NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12)` | For P&L comparison |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | Soft-delete/ban flag |
| `deleted_at` | `TIMESTAMPTZ` | `NULL` | — |
| **Indexes** | — | — | `UNIQUE NULLS NOT DISTINCT (tin) WHERE tin IS NOT NULL AND is_active=true;` Trigram on trading_name/legal_name |

#### 3.2.2 `business_settings`
Per-setting key-value rows scoped to a business. Overrides system_settings.
| Column | Type | Constraints |
|--------|------|-------------|
| `[SYS] created_at, created_by, updated_at, updated_by` | — | — |
| `business_id` | `BIGINT` | `REFERENCES businesses(id) ON DELETE CASCADE, NOT NULL` |
| `key` | `VARCHAR(128)` | `NOT NULL` |
| `value_json` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | — |
| `datatype` | `VARCHAR(16)` | `CHECK (…) NOT NULL` |
| `UNIQUE (business_id, key)` | — | Enforced |
Keys include: `tax.vat_pct`, `tax.nhil_pct`, `tax.getfund_pct`, `tax.covid_levy_pct`, `pricing.allow_negative_sale`, `pricing.valuation_method` (FIFO/WEIGHTED), `pricing.default_price_list`, `inventory.allow_negative_stock`, `inventory.reorder_default_warning_days`, `returns.window_days` (default 7), `loyalty.enabled`, `loyalty.cedis_per_point`, `loyalty.points_per_cedi_redeem`, `receipt.footer_line1`, `receipt.footer_line2`, `receipt.print_logo`, `receipt.width_mm`, `receipt.copies`, `momo.merchant_id_mtn`, `momo.merchant_id_telecel`, `momo.merchant_id_at`, `backup.schedule_time`, `backup.retention_days_daily`, `backup.network_share_path`.

#### 3.2.3 `branches`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `code` | `VARCHAR(32)` | `NOT NULL` | Short code e.g. `ACC-01` |
| `name` | `VARCHAR(255)` | `NOT NULL` | Display name "Accra Mall Branch" |
| `default_warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE SET NULL` | Fallback for retail stock |
| `address` | `VARCHAR(512)` | `NOT NULL` | — |
| `gps_address_code` | `VARCHAR(32)` | `NULL` | — |
| `phone` | `VARCHAR(32)` | `NOT NULL` | — |
| `email` | `VARCHAR(255)` | `NULL` | — |
| `operating_hours_json` | `JSONB` | `NOT NULL DEFAULT '{}'::jsonb` | `{"monday": {"open":"08:00","close":"20:00"},…}` |
| `printer_ip_receipt` | `VARCHAR(64)` | `NULL` | 192.168.1.150 (for network printer default) |
| `printer_ip_kitchen` | `VARCHAR(64)` | `NULL` | — |
| `customer_display_ip` | `VARCHAR(64)` | `NULL` | Pole display IP |
| `is_head_office` | `BOOLEAN` | `NOT NULL DEFAULT false` | — |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, code)`, trigram on name |

#### 3.2.4 `warehouses`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE SET NULL, NULL` | Tied to a branch? NULL = central warehouse |
| `code` | `VARCHAR(32)` | `NOT NULL` | `WH-ACC-MAIN` |
| `name` | `VARCHAR(255)` | `NOT NULL` | — |
| `location_description` | `TEXT NULL` | — | e.g. "Back storage room, rack A4" |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, code)` |

#### 3.2.5 `registers` (POS tills)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE RESTRICT, NOT NULL` | — |
| `warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE RESTRICT, NOT NULL` | Source of stock this till deducts from |
| `code` | `VARCHAR(32)` | `NOT NULL` | Till number e.g. T1, T2 |
| `name` | `VARCHAR(255)` | `NOT NULL` | "Front Desk Till 1" |
| `receipt_printer_id` | `VARCHAR(64)` | `NULL` | USB serial / network id used by companion service |
| `terminal_uuid` | `UUID` | `UNIQUE NULL` | Persistent UUID burned into terminal; used for sync status per machine |
| `require_cash_shift_open` | `BOOLEAN` | `NOT NULL DEFAULT true` | Block sales until Shift opened |
| `cash_account_id` | `BIGINT` | `REFERENCES cash_accounts(id) ON DELETE SET NULL, NULL` | Tied physical drawer to a cash asset account |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, branch_id, code)` |

#### 3.2.6 `cash_drawers`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `register_id` | `BIGINT` | `REFERENCES registers(id) ON DELETE CASCADE, NOT NULL` | — |
| `name` | `VARCHAR(64)` | `NOT NULL DEFAULT 'Main Drawer'` | — |
| `last_opened_at` | `TIMESTAMPTZ` | `NULL` | — |
| `last_opened_by_id` | `BIGINT` | `REFERENCES users(id), NULL` | — |
| `last_open_reason` | `VARCHAR(32)` | `CHECK (last_open_reason IN ('SALE','NO_SALE','REFUND','PAYOUT','SHIFT_OPEN','MANUAL')) NULL` | — |
| **Indexes** | — | `UNIQUE (register_id)` |

---

### 3.3 Identity & Access Layer

#### 3.3.1 `users`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `businesses` (M:N via `user_businesses`) | — | Junction table: `user_id FK`, `business_id FK`, `UNIQUE(user_id,business_id)`, `is_default BOOLEAN NOT NULL DEFAULT false`, `assigned_at TIMESTAMPTZ` | User's active business selection at login drives scoping |
| `email` | `VARCHAR(254)` | `NULL UNIQUE NULLS NOT DISTINCT` | Optional username |
| `phone` | `VARCHAR(32)` | `NULL UNIQUE NULLS NOT DISTINCT` | Optional username (GH normalized E.164) |
| `username_internal` | `VARCHAR(64)` | `NOT NULL UNIQUE` | Derived: lower(email) if email else phone |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` | Django PBKDF2_SHA256 output |
| `pin_hash` | `VARCHAR(255)` | `NULL` | 4–6 digit PIN for POS quick unlock; salted, PBKDF2 |
| `full_name` | `VARCHAR(255)` | `NOT NULL` | — |
| `short_name` | `VARCHAR(64)` | `NULL` | Printed on receipts "Kwame B." |
| `avatar_path` | `VARCHAR(512)` | `NULL` | — |
| `language` | `VARCHAR(16)` | `NOT NULL DEFAULT 'en'` | en / tw (Twi, future) |
| `must_change_password` | `BOOLEAN` | `NOT NULL DEFAULT true` | At onboarding |
| `is_superuser` | `BOOLEAN` | `NOT NULL DEFAULT false` | Instance-wide super admin (bypasses business scoping for very few actions: license mgmt) |
| `is_staff` | `BOOLEAN` | `NOT NULL DEFAULT false` | Can log into django-admin (back-office only) |
| `last_login_at` | `TIMESTAMPTZ` | `NULL` | — |
| `last_active_at` | `TIMESTAMPTZ` | `NULL DEFAULT now()` | Heartbeat updated via API calls |
| `locked_until` | `TIMESTAMPTZ` | `NULL` | Temporarily locked after N failed logins |
| `failed_login_attempts` | `INTEGER` | `NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0)` | — |
| `totp_secret` | `VARCHAR(64)` | `NULL` | TOTP base32 (2FA enabled if NOT NULL) |
| `deleted_at` | `TIMESTAMPTZ` | `NULL` | Soft delete; users never hard-deleted if they have audit trail |
| **Checks** | — | `CHECK (email IS NOT NULL OR phone IS NOT NULL)`; valid E.164 phone trigger function |

#### 3.3.2 `roles`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | Roles defined per business, except system roles (business_id NULL for seed) |
| `name` | `VARCHAR(64)` | `NOT NULL` | e.g. "Cashier" |
| `description` | `TEXT NULL` | — | — |
| `system_role_key` | `VARCHAR(64)` | `NULL` | Non-editable system roles: `SUPER_ADMIN`, `BUSINESS_OWNER`, `BRANCH_MANAGER`, `CASHIER`, `STOCK_CONTROLLER`, `ACCOUNTANT`, `PHARMACIST`, `AUDITOR_READONLY` |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, name) WHERE business_id IS NOT NULL; UNIQUE (system_role_key) WHERE system_role_key IS NOT NULL` |

#### 3.3.3 `permissions`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `BIGSERIAL PK` | — | — |
| `codename` | `VARCHAR(128)` | `UNIQUE NOT NULL` | e.g. `sale.create`, `sale.price_override`, `stock.transfer.approve` |
| `group_code` | `VARCHAR(64)` | `NOT NULL` | e.g. `sale`, `inventory`, `purchases`, `accounting`, `reporting`, `settings`, `backup`, `users` |
| `name` | `VARCHAR(255)` | `NOT NULL` | Human readable description for role editor |
| `description` | `TEXT NULL` | — | — |
| `requires_2fa` | `BOOLEAN` | `NOT NULL DEFAULT false` | e.g. `backup.restore`, `payment.refund_above_1000` |
Seeded ~80 permissions. Permissions are instance-wide (not business-scoped); role assignments bind them to businesses.

#### 3.3.4 `role_permissions` (M:N)
| Column | Type | Constraints |
|--------|------|-------------|
| `role_id` | `BIGINT` | `REFERENCES roles(id) ON DELETE CASCADE, NOT NULL` |
| `permission_id` | `BIGINT` | `REFERENCES permissions(id) ON DELETE CASCADE, NOT NULL` |
| `UNIQUE(role_id, permission_id)` | — | — |

#### 3.3.5 `user_roles` (M:N)
| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | `BIGINT` | `REFERENCES users(id) ON DELETE CASCADE, NOT NULL` |
| `role_id` | `BIGINT` | `REFERENCES roles(id) ON DELETE CASCADE, NOT NULL` |
| `business_id` | `BIGINT` | `REFERENCES businesses(id) ON DELETE CASCADE, NOT NULL` | Scope role to a business |
| `granted_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` |
| `granted_by_id` | `BIGINT` | `REFERENCES users(id), NULL` |
| `UNIQUE(user_id, role_id, business_id)` | — | — |

#### 3.3.6 `employees`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `user_id` | `BIGINT` | `REFERENCES users(id) ON DELETE SET NULL, NULL UNIQUE` | Login identity (can be NULL for ex-employee retained for payroll history) |
| `employee_number` | `VARCHAR(32)` | `NOT NULL` | — |
| `national_id_number` | `VARCHAR(64)` | `NULL` | Ghana Card ID |
| `date_of_birth` | `DATE NULL` | — | — |
| `hire_date` | `DATE` | `NOT NULL` | — |
| `termination_date` | `DATE NULL` | — | — |
| `position_title` | `VARCHAR(128)` | `NOT NULL` | — |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE SET NULL, NULL` | Home branch assignment |
| `salary_per_month` | `NUMERIC(14,2)` | `NULL CHECK (salary_per_month IS NULL OR salary_per_month >= 0)` | — |
| `commission_pct_sales` | `NUMERIC(6,4)` | `NOT NULL DEFAULT 0 CHECK (commission_pct_sales >= 0 AND commission_pct_sales <= 1)` | e.g. 0.02 = 2% of sale value |
| `allowed_register_ids_json` | `JSONB NULL` | `[]` → allowed at all; else array of register UUIDs |
| `is_active` | `BOOLEAN` | `NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, employee_number)` |

#### 3.3.7 `login_sessions`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `user_id` | `BIGINT` | `REFERENCES users(id) ON DELETE CASCADE, NOT NULL` | — |
| `business_id` | `BIGINT` | `REFERENCES businesses(id) ON DELETE CASCADE, NULL` | Selected business at login |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE SET NULL, NULL` | Active branch selection |
| `register_id` | `BIGINT` | `REFERENCES registers(id) ON DELETE SET NULL, NULL` | Active till if POS user |
| `refresh_token_hash` | `VARCHAR(128)` | `NOT NULL UNIQUE` | SHA-256 of raw refresh token; never store raw tokens |
| `expires_at` | `TIMESTAMPTZ` | `NOT NULL` | 7 days from login, sliding |
| `last_seen_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Slide expiry forward each use |
| `ip_address` | `VARCHAR(64)` | `NOT NULL` | LAN IP or remote IP |
| `user_agent` | `VARCHAR(512)` | `NULL` | Browser UA |
| `device_fingerprint` | `VARCHAR(128)` | `NULL` | Derived: UA + screen + fonts hash |
| `terminal_uuid` | `UUID` | `NULL` | Matches registers.terminal_uuid for POS terminals |
| `city_geoip` | `VARCHAR(128)` | `NULL` | — |
| `is_mfa_verified` | `BOOLEAN` | `NOT NULL DEFAULT false` | TOTP check passed this session |
| `status` | `VARCHAR(16)` | `CHECK (status IN ('ACTIVE','EXPIRED','LOGGED_OUT','REVOKED','SUSPICIOUS')) NOT NULL DEFAULT 'ACTIVE'` | — |
| `revoked_at` | `TIMESTAMPTZ NULL` | — | Manual admin logout |
| **Indexes** | — | `(user_id, status, expires_at)`, `(expires_at)` for periodic cleanup |

#### 3.3.8 `audit_log`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id BIGSERIAL PK` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `REFERENCES businesses(id) ON DELETE CASCADE, NULL` | NULL for system events |
| `user_id` | `BIGINT` | `REFERENCES users(id) ON DELETE SET NULL, NULL` | — |
| `session_id` | `BIGINT` | `REFERENCES login_sessions(id) ON DELETE SET NULL, NULL` | — |
| `timestamp` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | — |
| `ip_address` | `VARCHAR(64) NULL` | — | — |
| `user_agent` | `VARCHAR(512) NULL` | — | — |
| `severity` | `VARCHAR(8)` | `CHECK (severity IN ('DEBUG','INFO','WARNING','ERROR','CRITICAL')) NOT NULL DEFAULT 'INFO'` | e.g. RESTORE=CRITICAL |
| `table_name` | `VARCHAR(64) NULL` | — | Which DB table was written (if row event) |
| `record_id` | `BIGINT NULL` | — | PK of row; UUID in record_uuid |
| `record_uuid` | `UUID NULL` | — | — |
| `action` | `VARCHAR(32)` | `CHECK (action IN ('CREATE','UPDATE','DELETE','SOFT_DELETE','RESTORE','LOGIN','LOGIN_FAIL','LOGOUT','BACKUP','RESTORE','EXPORT','IMPORT','APPROVE','VOID','PRINT','EMAIL','SMS')) NOT NULL` | — |
| `summary` | `VARCHAR(512) NULL` | — | One-line: "User 'Cashier Ama' granted 'sale.price_override' permission" |
| `before_jsonb` | `JSONB NULL` | — | Row state before mutation (null for CREATE) |
| `after_jsonb` | `JSONB NULL` | — | Row state after mutation (null for DELETE) |
| **Indexes** | — | `(business_id, timestamp DESC)`, `(user_id, timestamp DESC)`, `(table_name, record_id, timestamp DESC)`, `GIN (before_jsonb jsonb_path_ops)`, `GIN (after_jsonb jsonb_path_ops)`; Partition by RANGE(timestamp) recommended for >10M rows |

---

### 3.4 Catalog Layer

#### 3.4.1 `categories`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `parent_id` | `BIGINT` | `REFERENCES categories(id) ON DELETE SET NULL, NULL` | Hierarchy, depth limit 5 enforced in trigger |
| `name` | `VARCHAR(255)` | `NOT NULL` | — |
| `slug` | `VARCHAR(255)` | `NOT NULL` | URL/computed slug per business |
| `image_path` | `VARCHAR(512) NULL` | — | For POS category tile |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` | — | — |
| `tax_class_default_id` | `BIGINT` | `REFERENCES tax_rates(id) ON DELETE SET NULL, NULL` | Default tax when creating product in this category |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |
| **Indexes** | — | `UNIQUE (business_id, parent_id, name)`; `UNIQUE (business_id, slug)` |
| **Trigger** | — | After insert/update/delete → recurse closure table `category_ancestors` (category_id, ancestor_id, depth) for fast "all products in category and descendants" queries |

Also `category_ancestors` closure table.

#### 3.4.2 `brands`
| Column | Type | Constraints |
|--------|------|-------------|
| `[SYS] audit cols` | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` |
| `business_id` | `BIGINT` | `FK, NOT NULL` |
| `name` | `VARCHAR(255)` | `NOT NULL` |
| `image_path` | `VARCHAR(512) NULL` | — |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, name)`; trigram on name |

#### 3.4.3 `units`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `code` | `VARCHAR(16)` | `NOT NULL` | `PCS`, `BOX`, `PKT`, `KG`, `L`, `CRT` |
| `name` | `VARCHAR(128)` | `NOT NULL` | Pieces, Box, Packet, Kilogram, Litre, Carton |
| `category` | `VARCHAR(16)` | `CHECK (category IN ('COUNT','WEIGHT','VOLUME','TIME','OTHER')) NOT NULL` | Drives POS decimal input allowed |
| `allow_fractional_qty` | `BOOLEAN NOT NULL DEFAULT false` | TRUE for KG/L (decimal qty allowed) |
| `base_unit_id` | `BIGINT` | `REFERENCES units(id) ON DELETE SET NULL, NULL` | For conversions |
| `conversion_factor` | `NUMERIC(14,6) NOT NULL DEFAULT 1 CHECK (conversion_factor > 0)` | Multiply by this to get to base unit (e.g. BOX of 12 PCS: factor=12 to base PCS) |
| `display_precision_decimals` | `INTEGER NOT NULL DEFAULT 0` | POS display qty: 0 for PCS, 2 for KG |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — |
| **Indexes** | — | `UNIQUE (business_id, code)` |

#### 3.4.4 `tax_rates`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `code` | `VARCHAR(32)` | `NOT NULL` | `VAT`, `NHIL`, `GETFUND`, `COVID`, `EXEMPT`, `ZERO` |
| `name` | `VARCHAR(128)` | `NOT NULL` | Value Added Tax, National Health Insurance Levy, etc. |
| `rate_pct` | `NUMERIC(6,4) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 1)` | 0.15 = 15% |
| `compound_tax` | `BOOLEAN NOT NULL DEFAULT false` | True = applied on subtotal+previous taxes (not applicable in GH VAT regime; default false) |
| `is_inclusive_default` | `BOOLEAN NOT NULL DEFAULT false` | Display prices include tax? (retail vs B2B) |
| `tax_account_id` | `BIGINT` | `REFERENCES accounts(id) ON DELETE SET NULL, NULL` | Liability account for collected tax |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |
| **Indexes** | — | `UNIQUE (business_id, code)` |

#### 3.4.5 `products`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `type` | `VARCHAR(16)` | `CHECK (type IN ('STANDARD','VARIABLE','SERVICE','BUNDLE','MEDICINE','DEVICE')) NOT NULL DEFAULT 'STANDARD'` | — |
| `sku` | `VARCHAR(64)` | `NOT NULL` | Internal Stock Keeping Unit |
| `name` | `VARCHAR(512)` | `NOT NULL` | — |
| `slug` | `VARCHAR(512) NOT NULL` | — | — |
| `description` | `TEXT NULL` | — | — |
| `brand_id` | `BIGINT` | `REFERENCES brands(id) ON DELETE SET NULL, NULL` | — |
| `unit_id` | `BIGINT` | `REFERENCES units(id) ON DELETE RESTRICT, NOT NULL` | Base unit of measure (default variant inherits) |
| `weight_grams` | `NUMERIC(12,3) NULL CHECK (weight_grams IS NULL OR weight_grams >= 0)` | For shipping/weighing scales |
| `track_stock` | `BOOLEAN NOT NULL DEFAULT true` | Service items = false |
| `allow_fractional_sale` | `BOOLEAN NOT NULL DEFAULT false` | KG items = true |
| `track_batches` | `BOOLEAN NOT NULL DEFAULT false` | Medicine/food: true |
| `track_expiry` | `BOOLEAN NOT NULL DEFAULT false` | Medicine/food: true |
| `track_imei_or_serial` | `BOOLEAN NOT NULL DEFAULT false` | Phones/electronics: true (each unit has serial/IMEI) |
| `is_restricted_sale` | `BOOLEAN NOT NULL DEFAULT false` | Restricted drug/age-gated item; POS prompts for ID |
| `restriction_note` | `VARCHAR(255) NULL` | — | — |
| `has_variants` | `BOOLEAN NOT NULL DEFAULT false` | — |
| `variant_option_labels_json` | `JSONB NOT NULL DEFAULT '{"labels":[]}'::jsonb` | `["Size","Color"]` |
| `tax_class` | `VARCHAR(32)` | `CHECK (tax_class IN ('STANDARD','EXEMPT','ZERO_RATED')) NOT NULL DEFAULT 'STANDARD'` | — |
| `reorder_level` | `NUMERIC(12,3) NULL CHECK (reorder_level IS NULL OR reorder_level >= 0)` | Triggers low-stock alert |
| `shelf_location` | `VARCHAR(64) NULL` | For picker: A-12-3 |
| `default_cost_currency` | `VARCHAR(3) NOT NULL DEFAULT 'GHS'` | — |
| `last_purchase_cost` | `NUMERIC(14,2) NULL CHECK (last_purchase_cost IS NULL OR last_purchase_cost >= 0)` | Auto-updated on GR |
| `is_returnable` | `BOOLEAN NOT NULL DEFAULT true` | Perishable = false option |
| `return_window_days` | `INTEGER NULL CHECK (return_window_days IS NULL OR return_window_days >= 0)` | Overrides business default |
| `warranty_months_default` | `INTEGER NULL CHECK (warranty_months_default IS NULL OR warranty_months_default >= 0)` | For devices |
| `tags_json` | `JSONB NOT NULL DEFAULT '[]'::jsonb` | Array of strings for filters |
| `search_keywords_tsv` | `TSVECTOR NULL` | Full-text search column; updated via trigger on name/description/sku/tags |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |
| `deleted_at` | `TIMESTAMPTZ NULL` | — | Soft delete; products with history kept |
| **Checks** | — | `CHECK (NOT (has_variants=false AND track_imei_or_serial=true AND type='STANDARD'))` (warning for operator: variants created for imei-sku still possible but 1 variant is fine) — actually relax, allow single variant |
| **Indexes** | — | `UNIQUE (business_id, sku)`; `(business_id, brand_id)`; `(business_id, is_active, created_at DESC)`; GIN trigram on name; GIN on tags_json; GIN on search_keywords_tsv using GIN (default PostgreSQL); `(business_id, reorder_level, track_stock)` WHERE reorder_level IS NOT NULL |
| **Junction** | `product_categories` | `product_id FK + category_id FK, UNIQUE` |

#### 3.4.6 `product_variants`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NOT NULL` | — |
| `variant_sku` | `VARCHAR(64)` | `NOT NULL` | Per-variant SKU; default = product sku + suffix |
| `option_values_json` | `JSONB NOT NULL DEFAULT '{}'::jsonb` | `{"Size":"M","Color":"Red"}` |
| `variant_hash` | `VARCHAR(64)` | `NOT NULL` | sha256(sorted JSON of option_values) → ensure uniqueness per product |
| `unit_id` | `BIGINT` | `REFERENCES units(id) ON DELETE RESTRICT, NOT NULL` | Override product unit |
| `weight_grams_override` | `NUMERIC(12,3) NULL` | — | — |
| `barcode_default_id` | `BIGINT` | `REFERENCES barcodes(id) ON DELETE SET NULL, NULL` | Default EAN13 printed on receipt lookups |
| `reorder_level_override` | `NUMERIC(12,3) NULL` | Overrides product-level |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |
| **Indexes** | — | `UNIQUE (product_id, variant_hash)`; `UNIQUE (business_id, variant_sku)`; `(product_id, is_active)` |

#### 3.4.7 `barcodes`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NULL` | — |
| `barcode` | `VARCHAR(64)` | `NOT NULL` | The string the scanner outputs |
| `format` | `VARCHAR(16)` | `CHECK (format IN ('EAN8','EAN13','UPC','UPCA','UPCE','CODE128','CODE39','QR','INTERNAL')) NOT NULL DEFAULT 'EAN13'` | — |
| `is_primary` | `BOOLEAN NOT NULL DEFAULT false` | One primary per variant |
| **Checks** | — | `CHECK (product_id IS NOT NULL OR product_variant_id IS NOT NULL)`; `CHECK (NOT (product_id IS NOT NULL AND product_variant_id IS NOT NULL))` |
| **Indexes** | — | `UNIQUE (business_id, barcode, format)`; `(product_variant_id)`; `(business_id, barcode)` (for scanner lookup) |

#### 3.4.8 `product_prices` (multi price-list)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` | — |
| `price_list_code` | `VARCHAR(32)` | `NOT NULL` | `DEFAULT`, `RETAIL`, `WHOLESALE`, `VIP`, `STAFF`, `CG-{id}` (customer group) |
| `customer_group_id` | `BIGINT` | `REFERENCES customer_groups(id) ON DELETE SET NULL, NULL` | Optional explicit link |
| `price_incl_tax` | `NUMERIC(14,2) NOT NULL CHECK (price_incl_tax >= 0)` | Shelf/display price — tax inclusive is default for Ghana retail |
| `price_excl_tax` | `NUMERIC(14,2) NOT NULL CHECK (price_excl_tax >= 0)` | Computed & stored (trigger recalc on tax rate change for default tax class) |
| `min_qty` | `NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (min_qty > 0)` | Volume price: apply price when qty >= min_qty (same product/price_list) |
| `valid_from` | `DATE NOT NULL DEFAULT CURRENT_DATE` | — |
| `valid_until` | `DATE NULL` | Promotional expiry |
| `is_promotional` | `BOOLEAN NOT NULL DEFAULT false` | — |
| **Checks** | — | `CHECK (valid_until IS NULL OR valid_until >= valid_from)` |
| **Indexes** | — | `UNIQUE (business_id, product_variant_id, price_list_code, min_qty, valid_from) WHERE is_active = true`; applied price = sort by (min_qty DESC fits qty, valid_from DESC, priority promotional) |

#### 3.4.9 `product_taxes` (M:N with attributes)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NOT NULL` | — |
| `tax_rate_id` | `BIGINT` | `REFERENCES tax_rates(id) ON DELETE RESTRICT, NOT NULL` | — |
| `is_overridden` | `BOOLEAN NOT NULL DEFAULT false` | True if product sets non-default rate; else inherits from category |
| `UNIQUE(business_id, product_id, tax_rate_id)` | — | — |

#### 3.4.10 `product_suppliers`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` | — |
| `supplier_id` | `BIGINT` | `REFERENCES suppliers(id) ON DELETE CASCADE, NOT NULL` | — |
| `supplier_sku` | `VARCHAR(128) NULL` | Their code for the variant |
| `lead_time_days` | `INTEGER NULL CHECK (lead_time_days IS NULL OR lead_time_days >= 0)` | Expected from order to ship |
| `last_purchase_price` | `NUMERIC(14,2) NULL CHECK (last_purchase_price IS NULL OR last_purchase_price >= 0)` | Most recent unit cost from this supplier |
| `last_purchase_date` | `DATE NULL` | — | — |
| `is_preferred` | `BOOLEAN NOT NULL DEFAULT false` | Default PO suggestion |
| `moq` | `NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (moq > 0)` | Minimum order quantity in variant units |
| `UNIQUE(product_variant_id, supplier_id)` | — | — |

#### 3.4.11 `product_images`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NULL` | — |
| `storage_path` | `VARCHAR(512)` | `NOT NULL` | /media/products/{business_uuid}/{uuid}.jpg |
| `mime_type` | `VARCHAR(64)` | `NOT NULL` | image/jpeg, image/webp |
| `width_px` | `INTEGER NOT NULL CHECK (width_px > 0)` | — |
| `height_px` | `INTEGER NOT NULL CHECK (height_px > 0)` | — |
| `size_bytes` | `BIGINT NOT NULL CHECK (size_bytes > 0)` | — |
| `display_order` | `INTEGER NOT NULL DEFAULT 0` | — |
| `is_thumbnail` | `BOOLEAN NOT NULL DEFAULT false` | One per product/variant |
| `checksum_sha256` | `VARCHAR(64)` | `NOT NULL` | De-dupe on upload |

#### 3.4.12 `medicines` (product extension)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NOT NULL UNIQUE` | 1:1 to product |
| `generic_name` | `VARCHAR(512)` | `NOT NULL` | Paracetamol 500mg |
| `brand_name` | `VARCHAR(512)` | `NULL` | Paradol |
| `dosage_form` | `VARCHAR(64)` | `NOT NULL` | Tablet, Capsule, Syrup, Injection, Cream, Drops, Inhaler, Suppository, Other |
| `strength` | `VARCHAR(128)` | `NOT NULL` | 500mg / 250mg/5ml |
| `pack_size` | `VARCHAR(128) NULL` | — | Blister x 10 |
| `schedule_class` | `VARCHAR(16)` | `CHECK (schedule_class IN ('OTC','RX','SCHEDULE_2','SCHEDULE_3','SCHEDULE_4','CONTROLLED')) NOT NULL DEFAULT 'OTC'` | RX = Prescription only |
| `requires_prescription_sale` | `BOOLEAN NOT NULL DEFAULT false` | Blocks POS sale without prescription link |
| `administration_route` | `VARCHAR(32) NULL` | Oral / Topical / IV / IM |
| `contraindications` | `TEXT NULL` | — |
| `side_effects` | `TEXT NULL` | — |
| `storage_conditions` | `VARCHAR(255) NULL` | Store below 25C, Protect from light |
| `fdb_code` | `VARCHAR(32) NULL` | Food & Drugs Board Ghana registration code |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |

#### 3.4.13 `medicine_batches`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` | — |
| `batch_number` | `VARCHAR(128)` | `NOT NULL` | e.g. B2026-0012 (alphanumeric from manufacturer) |
| `manufacturer_name` | `VARCHAR(255) NULL` | — | — |
| `manufacture_date` | `DATE NULL` | — | — |
| `expiry_date` | `DATE` | `NOT NULL` | — |
| `supplier_id` | `BIGINT` | `REFERENCES suppliers(id) ON DELETE SET NULL, NULL` | Supplier who provided this batch |
| `goods_receipt_id` | `BIGINT` | `REFERENCES goods_receipts(id) ON DELETE SET NULL, NULL` | Source GR |
| `unit_cost_at_receipt` | `NUMERIC(14,2) NOT NULL CHECK (unit_cost_at_receipt >= 0)` | Pesewas? No: NUMERIC(14,2) GHS |
| `initial_qty_received` | `NUMERIC(12,3) NOT NULL CHECK (initial_qty_received > 0)` | Units in base UOM |
| `warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE RESTRICT, NOT NULL` | Location of batch stock |
| `fe_priority` | `INTEGER NOT NULL DEFAULT 0` | FEFO index: lower = dispatch first (sort by expiry ASC, fe_priority ASC) |
| `status` | `VARCHAR(16)` | `CHECK (status IN ('ACTIVE','QUARANTINED','EXPIRED','RETURNED_TO_SUPPLIER','WRITTEN_OFF')) NOT NULL DEFAULT 'ACTIVE'` | — |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | — | — |
| **Trigger** | — | Nightly scheduled job: set `status='EXPIRED'` AND write StockMovement(EXPIRED) for remaining qty in this batch (deduct Inventory) |
| **Indexes** | — | `UNIQUE (business_id, product_variant_id, batch_number, warehouse_id)`; `(business_id, expiry_date) WHERE status='ACTIVE'` (critical for expiry alerts); `(product_variant_id, warehouse_id, expiry_date, fe_priority)` (FEFO selection ORDER BY) |

#### 3.4.14 `devices` (product extension)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_id` | `BIGINT` | `REFERENCES products(id) ON DELETE CASCADE, NOT NULL UNIQUE` | — |
| `device_category` | `VARCHAR(32)` | `CHECK (device_category IN ('SMARTPHONE','FEATURE_PHONE','LAPTOP','TABLET','TV','AUDIO','APPLIANCE','ACCESSORY','OTHER')) NOT NULL DEFAULT 'SMARTPHONE'` | — |
| `imei_required` | `BOOLEAN NOT NULL DEFAULT true` | Accessories no |
| `serial_required` | `BOOLEAN NOT NULL DEFAULT true` | — |
| `warranty_months` | `INTEGER NOT NULL DEFAULT 12 CHECK (warranty_months >= 0)` | — |
| `repair_enabled` | `BOOLEAN NOT NULL DEFAULT true` | Allows repair ticket creation |

#### 3.4.15 `device_warranties` (post-sale record)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `sale_item_id` | `BIGINT` | `REFERENCES sale_items(id) ON DELETE CASCADE, NOT NULL UNIQUE` | Per unit sold |
| `imei_id` | `BIGINT` | `REFERENCES imeis(id) ON DELETE SET NULL, NULL UNIQUE` | Tied to specific IMEI |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` | — |
| `customer_id` | `BIGINT` | `REFERENCES customers(id) ON DELETE CASCADE, NOT NULL` | — |
| `warranty_code` | `VARCHAR(32) NOT NULL UNIQUE` | Printed on card |
| `warranty_start_date` | `DATE NOT NULL` | Sale date |
| `warranty_end_date` | `DATE NOT NULL` | Sale + warranty months; trigger checks |
| `terms_summary` | `TEXT NULL` | — |
| `status` | `VARCHAR(16)` | `CHECK (status IN ('ACTIVE','EXPIRED','VOID','CLAIMED')) NOT NULL DEFAULT 'ACTIVE'` | — |

#### 3.4.16 `imeis` (individual unit serial numbers)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS] audit cols` | — | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` | — |
| `imei1` | `VARCHAR(32)` | `NULL` | Primary IMEI (15 digits for phones) |
| `imei2` | `VARCHAR(32)` | `NULL` | Dual SIM second IMEI |
| `serial_number` | `VARCHAR(64)` | `NULL` | Non-IMEI serial |
| `medicine_batch_id` | `BIGINT` | `REFERENCES medicine_batches(id) ON DELETE SET NULL, NULL` | Re-use this row for serialized non-device items? Typically no; keep NULL for devices |
| `condition_on_intake` | `VARCHAR(16)` | `CHECK (condition_on_intake IN ('NEW','OPEN_BOX','USED_A','USED_B','USED_C','REFURBISHED','AS_IS')) NOT NULL DEFAULT 'NEW'` | — |
| `goods_receipt_item_id` | `BIGINT` | `REFERENCES goods_receipt_items(id) ON DELETE SET NULL, NULL` | Source of this unit into stock |
| `warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE RESTRICT, NULL` | Current physical location (NULL = sold/lost) |
| `sale_item_id` | `BIGINT` | `REFERENCES sale_items(id) ON DELETE SET NULL, NULL` | If sold: sale reference |
| `sale_return_item_id` | `BIGINT` | `REFERENCES sale_return_items(id) ON DELETE SET NULL, NULL` | If returned-in |
| `cost_price` | `NUMERIC(14,2) NULL CHECK (cost_price IS NULL OR cost_price >= 0)` | Unit landed cost |
| `status` | `VARCHAR(16)` | `CHECK (status IN ('INSTOCK','RESERVED','SOLD','RETURNED','IN_REPAIR','WRITTEN_OFF','LOST','STOLEN','TRANSIT')) NOT NULL DEFAULT 'INSTOCK'` | — |
| `note` | `TEXT NULL` | — | "Back cover scratch" |
| **Checks** | — | `CHECK (imei1 IS NOT NULL OR serial_number IS NOT NULL)` |
| **Indexes** | — | `UNIQUE (business_id, imei1) WHERE imei1 IS NOT NULL`; `UNIQUE (business_id, imei2) WHERE imei2 IS NOT NULL`; `UNIQUE (business_id, serial_number) WHERE serial_number IS NOT NULL`; `(product_variant_id, warehouse_id, status)`; `(status, business_id)` |

---

Given the length of this document, remaining tables are documented compactly below with critical relationships and invariants. Full Django model code will match column names 1:1.

### 3.5 Inventory Layer (continued)

#### 3.5.1 `inventory` (projection table; source of truth = StockMovement sum)
| Column | Type | Constraints |
|--------|------|-------------|
| `[SYS] audit cols` | — | — |
| `uuid` | `UUID` | `UNIQUE NOT NULL` |
| `business_id` | `BIGINT` | `FK, NOT NULL` |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE CASCADE, NOT NULL` |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE RESTRICT, NOT NULL` |
| `warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE RESTRICT, NOT NULL` |
| `qty_on_hand` | `NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0 OR (inventory.allow_negative flag via business_setting))` |
| `qty_reserved` | `NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_reserved >= 0)` | Held carts, transfers in-progress, repair parts |
| `qty_in_transit` | `NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (qty_in_transit >= 0)` | StockTransfer sent but not yet received at destination |
| `qty_available` (GENERATED STORED) | `NUMERIC(12,3)` | `ALWAYS AS (qty_on_hand - qty_reserved) STORED CHECK (qty_on_hand >= qty_reserved)` |
| `avg_unit_cost` | `NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (avg_unit_cost >= 0)` | Weighted average cost (business setting=WEIGHTED); else last purchase cost |
| `last_movement_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Updated trigger on every related StockMovement |
| `reorder_level_effective` | `NUMERIC(12,3) NULL` | Variant override or product default; low stock predicate |
| `UNIQUE (business_id, product_variant_id, branch_id, warehouse_id)` | — | Enforced |
| **Trigger** | — | After each StockMovement INSERT → `UPDATE inventory` with `ON CONFLICT DO INSERT` + apply weighted average formula; NEVER manually update this table; all writes go through trigger |

#### 3.5.2 `stock_movements` (immutable ledger; NEVER UPDATE; DELETE only on audit-approved correction, which is logged)
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `[SYS: created_at, created_by ONLY — no updated_at because immutable]` | — | — | Created at only; UPDATED forbidden by trigger |
| `uuid` | `UUID` | `UNIQUE NOT NULL` | — |
| `business_id` | `BIGINT` | `FK, NOT NULL` | — |
| `product_variant_id` | `BIGINT` | `REFERENCES product_variants(id) ON DELETE RESTRICT, NOT NULL` | — |
| `branch_id` | `BIGINT` | `REFERENCES branches(id) ON DELETE RESTRICT, NOT NULL` | — |
| `warehouse_id` | `BIGINT` | `REFERENCES warehouses(id) ON DELETE RESTRICT, NOT NULL` | — |
| `movement_type` | `VARCHAR(32)` | `CHECK (movement_type IN ('OPENING_STOCK','PURCHASE_RECEIPT','SALE','SALE_RETURN','SUPPLIER_RETURN','TRANSFER_OUT','TRANSFER_IN','STOCK_ADJUST_POS','STOCK_ADJUST_NEG','DAMAGED','EXPIRED','LOST_STOLEN','COUNT_CORRECTION_POS','COUNT_CORRECTION_NEG','TRANSIT_ADJUST')) NOT NULL` | Granular 15 |
| `qty_delta` | `NUMERIC(12,3) NOT NULL` | Signed: positive inbound, negative outbound |
| `unit_cost_snapshot` | `NUMERIC(14,4) NOT NULL CHECK (unit_cost_snapshot >= 0)` | Cost at time of movement — used for COGS and avg cost recalc |
| `balance_after_qty` | `NUMERIC(12,3) NOT NULL` | Inventory qty after this movement (for point-in-time rebuild without aggregation) |
| `balance_after_cost` | `NUMERIC(14,4) NOT NULL` | Inventory avg unit cost after |
| `medicine_batch_id` | `BIGINT` | `REFERENCES medicine_batches(id) ON DELETE SET NULL, NULL` | Required if variant.track_batches=true |
| `imei_id` | `BIGINT` | `REFERENCES imeis(id) ON DELETE SET NULL, NULL` | Required if per-unit tracked AND the movement is discrete (SALE, RECEIPT) |
| `reference_type` | `VARCHAR(32) NULL` | `CHECK (reference_type IN ('SALE','SALE_RETURN','GOODS_RECEIPT','SUPPLIER_RETURN','STOCK_ADJUSTMENT','STOCK_TRANSFER','STOCK_COUNT','OPENING_BALANCE','MANUAL_CORRECTION','INVENTORY_JOB'))` | Polymorphic parent |
| `reference_id` | `BIGINT NULL` | FK into the parent table (no hard FK; application-level integrity) |
| `note` | `VARCHAR(512) NULL` | Reason text for ADJUST/LOST/DAMAGED |
| **Trigger 1 (immutable)** | — | INSTEAD OF UPDATE/DELETE on stock_movements → RAISE EXCEPTION "StockMovement is immutable" |
| **Trigger 2 (ledger check)** | — | After INSERT on stock_movements → check (sum(qty_delta) for variant+branch+warehouse from ledger = Inventory.qty_on_hand). If mismatch → set health flag and log AuditLog(ERROR). (Do this in a deferred constraint trigger so bulk inserts don't thrash, or nightly check job for performance.) |
| **Indexes** | — | `(business_id, product_variant_id, branch_id, warehouse_id, created_at)`; `(business_id, movement_type, created_at)`; `(business_id, reference_type, reference_id)`; `(medicine_batch_id, created_at)`; `(imei_id, created_at)` | Partitioned by RANGE(created_at) monthly for high-volume shops. |

#### 3.5.3 `stock_adjustments` + `stock_adjustment_items`
- **stock_adjustments**: `id`, `uuid`, `business_id`, `branch_id`, `warehouse_id`, `adjustment_number`(UNIQUE per business), `reference`, `reason_code`(Damaged/Lost/Found/Wastage/WriteOff_Other/Pest_Infestation/Product_Recall), `reason_detail TEXT`, `total_value_delta NUMERIC(14,2) NOT NULL CHECK (total_value_delta >= 0)` (absolute), `status`(DRAFT→APPROVED→REJECTED→VOID), `requires_approval_flag`(auto TRUE IF value > threshold GHS), `approver_id FK users`, `approved_at`, `posted_at`, `is_active`, FK shift_id (nullable, POS adjustment).
- **stock_adjustment_items**: `id`, `stock_adjustment_id FK CASCADE`, `product_variant_id FK`, `medicine_batch_id NULL`, `imei_id NULL`, `qty_before NUMERIC(12,3) NOT NULL`, `qty_after NUMERIC(12,3) NOT NULL`, `qty_delta GEN STORED = qty_after - qty_before`, `unit_cost_snapshot NUMERIC(14,4)`, `value_delta NUMERIC(14,2) GEN STORED = qty_delta * unit_cost_snapshot`, `note TEXT NULL`.
- When status=APPROVED, service writes 2 StockMovement rows per item (POS/NEG pair if multi).

#### 3.5.4 `stock_transfers` + `stock_transfer_items`
- **stock_transfers**: `id`, `uuid`, `business_id`, `transfer_number` UNIQUE per biz, `from_branch_id FK`, `from_warehouse_id FK`, `to_branch_id FK`, `to_warehouse_id FK CHECK (from_warehouse <> to_warehouse)`, `requested_by FK users`, `approved_by FK users NULL` (required if branch <> branch same user), `shipped_by FK users NULL`, `received_by FK users NULL`, `status`(DRAFT→REQUESTED→APPROVED→SENT→IN_TRANSIT→RECEIVED→PARTIALLY_RECEIVED→CANCELLED), `shipping_method VARCHAR(64) NULL`, `tracking_number VARCHAR(64) NULL`, `sent_at`, `received_at`, `expected_delivery_date`, `freight_cost NUMERIC(14,2) NOT NULL DEFAULT 0`, `note TEXT NULL`, `reference TEXT NULL`.
- **stock_transfer_items**: `id`, `stock_transfer_id FK CASCADE`, `product_variant_id FK`, `qty_requested NUMERIC(12,3) NOT NULL CHECK (qty_requested > 0)`, `qty_sent NUMERIC(12,3) NULL CHECK (qty_sent >= 0)`, `qty_received NUMERIC(12,3) NULL CHECK (qty_received >= 0)`, `unit_cost_snapshot NUMERIC(14,4) NULL`, `medicine_batch_id NULL`, `imei_ids_json JSONB NULL` (per unit transfer), `variance_reason_code VARCHAR(64) NULL`, `variance_note TEXT NULL`.
- Rules: status=SENT → write StockMovement(TRANSFER_OUT, qty_sent) at from_warehouse, Inventory dec qty_on_hand, inc qty_in_transit at from. status=RECEIVED → write StockMovement(TRANSFER_IN,qty_received) at to_warehouse, dec qty_in_transit at from for min(qty_sent, qty_received); any variance → StockAdjustment(TRANSIT_ADJUST) auto created and requires approval.

#### 3.5.5 `stock_counts` + `stock_count_items`
- **stock_counts**: `id`, `uuid`, `business_id`, `warehouse_id FK`, `branch_id FK`, `count_number` UNIQUE, `name`(e.g. "Aisle 4 Cycle Count"), `type`(FULL/WAREHOUSE/CYCLE/CATEGORY), `category_id FK NULL`, `scheduled_date DATE`, `started_at`, `completed_at`, `approved_at`, `reconciled_at`, `status`(SCHEDULED→IN_PROGRESS→PENDING_APPROVAL→RECOUNT_REQUIRED→APPROVED→CANCELLED), `assigned_counter_ids_json JSONB` (array of user_ids), `snapshot_qty_total_value NUMERIC(14,2) NOT NULL DEFAULT 0` (system value at start), `variance_value_total NUMERIC(14,2) NOT NULL DEFAULT 0`, `approver_id FK users NULL`, `note TEXT`.
- **stock_count_items**: `id`, `stock_count_id FK CASCADE`, `product_variant_id FK`, `medicine_batch_id NULL`, `system_quantity NUMERIC(12,3) NOT NULL`, `counted_quantity NUMERIC(12,3) NULL`, `variance_qty GEN STORED = counted_quantity - system_quantity`, `variance_pct GEN STORED CASE WHEN system_quantity=0 THEN NULL ELSE variance_qty/system_quantity END`, `unit_cost_snapshot NUMERIC(14,4)`, `variance_value NUMERIC(14,2) GEN STORED = variance_qty * unit_cost_snapshot`, `counted_by_id FK users NULL`, `counted_at`, `recount_quantity NUMERIC(12,3) NULL`, `recount_by_id FK users NULL`, `recount_at`, `resolution VARCHAR(16)`(RECOUNTED/MATCH/SYSTEM_ERROR/WRITE_OFF/VARIANCE_ACCEPTED) NULL.
- On status=APPROVED → write StockMovement(COUNT_CORRECTION_POS/NEG) per non-zero variance item.

---

### 3.6 Sales Layer (Compact)
- **sales**: `id`, `uuid`, `business_id UNIQUE`, `branch_id FK`, `register_id FK`, `shift_id FK NOT NULL while shift open, but can be retroactively detached if shift is reopened (blocked)`, `cashier_id (employee FK)`, `customer_id FK NULL`, `invoice_number VARCHAR(32) UNIQUE per business NOT NULL` (INV-YYYY-NNNNNN, gapless via sequence per business_id — trigger acquires advisory lock), `sale_type`(RETAIL/WHOLESALE/CREDIT_SALE/LAYAWAY_PAYMENT/EXCHANGE), `dining_option`(DINE_IN/TAKEAWAY/DELIVERY/PICKUP/NOT_APPLICABLE), `order_channel`(POS/ONLINE/PHONE/APP), `reference_number VARCHAR(64) NULL`, `item_count INT NOT NULL DEFAULT 0`, `qty_total NUMERIC(12,3) NOT NULL DEFAULT 0`, `subtotal_incl NUMERIC(14,2) NOT NULL` sum(line total incl), `subtotal_excl NUMERIC(14,2) NOT NULL`, `discount_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_total >= 0)`, `tax_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0)`, `total_incl NUMERIC(14,2) NOT NULL`, `total_excl NUMERIC(14,2) NOT NULL`, `rounding_adjustment NUMERIC(14,2) NOT NULL DEFAULT 0` (for pesewa rounding), `amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0)`, `change_due NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (change_due >= 0)`, `balance_due NUMERIC(14,2) NOT NULL DEFAULT 0`, `currency_code VARCHAR(3) NOT NULL DEFAULT 'GHS'`, `currency_rate NUMERIC(14,6) NOT NULL DEFAULT 1`, `notes_internal TEXT NULL`, `notes_customer TEXT NULL`, `sale_source VARCHAR(16)`(OFFLINE/ONLINE/RECOVERED_SYNC), `offline_uuid UUID NULL UNIQUE` (maps POS offline record for idempotent re-sync), `created_at`, `completed_at`, `updated_at`, `status`(DRAFT/HELD/COMPLETED/VOIDED/REFUNDED_PARTIAL/REFUNDED_FULL), `void_reason VARCHAR(255) NULL`, `voided_by_id FK users NULL`, `voided_at NULL`, `receipt_printed_count INT NOT NULL DEFAULT 0`, `loyalty_points_earned INT NOT NULL DEFAULT 0`.
- **sale_items**: `id`, `uuid`, `business_id FK`, `sale_id FK CASCADE`, `product_variant_id FK`, `medicine_batch_id NULL`, `imei_id NULL`, `line_number INT NOT NULL`, `sku_snapshot VARCHAR(128)`, `name_snapshot VARCHAR(512) NOT NULL` (immutable snapshot at sale time so product renames don't change historical invoice), `unit_snapshot VARCHAR(16) NOT NULL`, `quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0)`, `unit_price_incl NUMERIC(14,2) NOT NULL`, `unit_price_excl NUMERIC(14,2) NOT NULL`, `cost_price_snapshot NUMERIC(14,4) NOT NULL` (for COGS), `discount_pct NUMERIC(6,4) NOT NULL DEFAULT 0`, `discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0`, `taxable_amount NUMERIC(14,2) NOT NULL`, `tax_amount_total NUMERIC(14,2) NOT NULL DEFAULT 0`, `line_total_incl NUMERIC(14,2) GENERATED ALWAYS AS ((quantity * unit_price_incl) - discount_amount) STORED NOT NULL`, `line_total_excl NUMERIC(14,2) GENERATED ALWAYS AS ((quantity * unit_price_excl) - discount_amount_excl) STORED NOT NULL` (discount_amount_excl also stored), `tax_breakdown_json JSONB NOT NULL DEFAULT '{}'::jsonb` ({VAT:1.50, NHIL:0.25,…}), `is_returnable_snapshot BOOLEAN NOT NULL DEFAULT true`, `warranty_months_snapshot INT NULL`, `returned_qty NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0 AND returned_qty <= quantity)` (running total of returns against this line), `kitchen_note TEXT NULL`, `prescription_id FK NULL`, `created_at`, `updated_at`, `UNIQUE(sale_id, line_number)`.
- **sale_taxes**: Aggregated per-tax-code per sale. `id`, `sale_id FK CASCADE`, `tax_rate_id FK`, `tax_code VARCHAR(32) NOT NULL`, `tax_name_snapshot`, `rate_pct_snapshot`, `taxable_amount NUMERIC(14,2) NOT NULL`, `tax_amount NUMERIC(14,2) NOT NULL`, `is_inclusive_in_price BOOLEAN NOT NULL`. Sum(tax_amount) = sale.tax_total enforced by trigger.
- **sale_discounts**: `id`, `sale_id FK CASCADE`, `sale_item_id FK NULL` (NULL = order-level), `type`(PERCENTAGE/FLAT/LOYALTY_POINTS/COUPON), `discount_pct NUMERIC(6,4) NULL`, `discount_amount NUMERIC(14,2) NOT NULL`, `coupon_code VARCHAR(64) NULL`, `applied_by_id FK users`, `reason VARCHAR(64) NULL` (e.g. "Staff discount"), `loyalty_points_redeemed INT NULL`.
- **payment_methods** (database rows, not enum): `id`, `uuid`, `business_id FK`, `code VARCHAR(32) UNIQUE per biz NOT NULL` (CASH, MTN_MOMO, TELECEL_CASH, AIRTELTIGO, CARD, BANK_TRANSFER, GHIPSS_QR, CUSTOMER_CREDIT, CHEQUE, VOUCHER), `name VARCHAR(128) NOT NULL`, `type VARCHAR(16)`(CASH/MOBILE_MONEY/CARD/BANK/QR/CREDIT/OTHER) NOT NULL, `is_active BOOLEAN`, `icon VARCHAR(64) NULL`, `is_cash_equivalent BOOLEAN NOT NULL DEFAULT FALSE`, `is_change_eligible BOOLEAN NOT NULL DEFAULT FALSE` (only CASH), `fee_pct NUMERIC(6,4) NOT NULL DEFAULT 0` (Merchant Service Charge), `fee_flat NUMERIC(14,2) NOT NULL DEFAULT 0`, `account_id FK accounts ON DELETE SET NULL` (asset account this payment posts to), `gateway_adapter VARCHAR(64) NULL` (ManualMoMoAdapter / HubtelAdapter…), `gateway_config_json JSONB NOT NULL DEFAULT '{}'::jsonb`, `sort_order INT NOT NULL DEFAULT 0`, `min_amount NUMERIC(14,2) NULL`, `max_amount NUMERIC(14,2) NULL`, `network_prefixes_json JSONB NULL` (MTN: ["024","054","055","059","025"]).
- **payments**: `id`, `uuid`, `business_id FK`, `sale_id FK NULL` (NULL = standalone e.g. customer credit topup), `customer_id FK NULL`, `supplier_id FK NULL` (for supplier payment records, which have their own SupplierPayment parent; reuse financial transaction pattern), `shift_id FK NULL` (must match sale.shift_id), `register_id FK NULL`, `payment_method_id FK payment_methods(id) ON DELETE RESTRICT NOT NULL`, `reference_number VARCHAR(64) NOT NULL UNIQUE per business (PAY-YYYY-NNNNNN)`, `external_reference VARCHAR(128) NULL` (MoMo Transaction ID, cheque number, card auth code), `customer_phone VARCHAR(32) NULL` (for MoMo), `momo_network VARCHAR(16) NULL CHECK (momo_network IN ('MTN','TELECEL','AIRTELTIGO',NULL))`, `amount NUMERIC(14,2) NOT NULL CHECK (amount > 0)` (in currency_code), `currency_code VARCHAR(3) NOT NULL DEFAULT 'GHS'`, `currency_rate NUMERIC(14,6) NOT NULL DEFAULT 1`, `amount_base NUMERIC(14,2) NOT NULL` (amount * rate, GHS base), `fee_amount NUMERIC(14,2) NOT NULL DEFAULT 0`, `cash_back NUMERIC(14,2) NOT NULL DEFAULT 0` (for cashback at POS via card), `tip_amount NUMERIC(14,2) NOT NULL DEFAULT 0`, `total_amount NUMERIC(14,2) GENERATED ALWAYS AS (amount + fee_amount + tip_amount - cash_back) STORED NOT NULL`, `collected_by_id FK employees`, `status VARCHAR(16)`(PENDING/PROCESSING/COMPLETED/FAILED/CANCELLED/REFUNDED_PARTIAL/REFUNDED_FULL/TIMED_OUT) NOT NULL, `gateway_poll_token VARCHAR(128) NULL`, `gateway_payload_request JSONB NULL`, `gateway_payload_response JSONB NULL`, `processed_at`, `failed_reason VARCHAR(512) NULL`, `reconciled_at`, `reconciliation_status VARCHAR(16)`(UNRECONCILED/MATCHED/MISMATCHED) NOT NULL DEFAULT 'UNRECONCILED', `note TEXT NULL`, `created_at`, `updated_at`, `is_void BOOLEAN NOT NULL DEFAULT false`, `voided_at`, `UNIQUE(business_id, reference_number)`, **Index**: `(business_id, sale_id, status)`.
- **held_sales**: `id`, `uuid`, `business_id FK`, `register_id FK`, `shift_id FK NULL`, `cashier_id FK employees NULL`, `customer_id FK NULL`, `customer_phone_lookup VARCHAR(32) NULL`, `hold_reference VARCHAR(32) NOT NULL` (shown on hold tile, e.g. "Kwame + shoes"), `cart_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb` (full sale draft schema, serialised from Zustand), `totals_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb`, `notes TEXT NULL`, `expires_at TIMESTAMPTZ NOT NULL` (now() + 48h default), `status VARCHAR(16)`(HELD/CONVERTED/EXPIRED/CANCELLED) NOT NULL, `converted_sale_id FK sales(id) NULL ON DELETE SET NULL`, `created_at`, `updated_at`. **Cleanup job**: hourly set status=EXPIRED past expires_at.
- **sale_returns**: `id`, `uuid`, `business_id FK`, `return_number UNIQUE per business NOT NULL`, `original_sale_id FK sales(id) ON DELETE RESTRICT NOT NULL`, `customer_id FK NOT NULL`, `branch_id FK`, `returned_by_id FK employees NOT NULL`, `received_by_id FK employees NOT NULL`, `created_at`, `posted_at`, `return_type VARCHAR(16)`(FULL/PARTIAL/EXCHANGE) NOT NULL, `reason_code VARCHAR(32) NOT NULL` (DEFECTIVE, DAMAGED_IN_TRANSIT, WRONG_ITEM, WRONG_SIZE, CHANGED_MIND, EXPIRED, DUPLICATE, OTHER), `reason_detail TEXT NULL`, `restock_all_items BOOLEAN NOT NULL DEFAULT true` (if false → items to damaged location), `item_return_value NUMERIC(14,2) NOT NULL`, `tax_refund_total NUMERIC(14,2) NOT NULL DEFAULT 0`, `total_refund NUMERIC(14,2) NOT NULL`, `refund_method VARCHAR(16)`(ORIGINAL_METHODS, CASH_ONLY, CUSTOMER_CREDIT, BANK_TRANSFER) NOT NULL, `status`(DRAFT/POSTED/APPROVED/VOID) NOT NULL.
- **sale_return_items**: `id`, `sale_return_id FK CASCADE`, `original_sale_item_id FK sale_items(id) ON DELETE SET NULL NULL`, `product_variant_id FK`, `medicine_batch_id NULL`, `imei_id NULL`, `qty_returned NUMERIC(12,3) NOT NULL CHECK (qty_returned > 0)`, `unit_price_refund NUMERIC(14,2) NOT NULL`, `tax_refund NUMERIC(14,2) NOT NULL DEFAULT 0`, `line_total_refund NUMERIC(14,2) NOT NULL`, `restock_item BOOLEAN NOT NULL`, `returned_condition VARCHAR(16)`(NEW/OPEN_BOX/USED/DAMAGED/DEFECTIVE/MISSING_PARTS), `note TEXT NULL`. On return POST → write StockMovement(SALE_RETURN) per line where restock_item=true, update Inventory, update sale_items.returned_qty running counter.
- **refunds**: Per-refund disbursement (may split across methods). `id`, `uuid`, `business_id FK`, `sale_return_id FK NOT NULL`, `original_payment_id FK payments(id) ON DELETE RESTRICT NULL`, `payment_method_id FK NOT NULL`, `amount NUMERIC(14,2) NOT NULL`, `reference VARCHAR(64) NULL`, `status`(PENDING/COMPLETED/FAILED) NOT NULL, `completed_at`, `processed_by_id FK users`, `gateway_ref JSONB NULL`, `note TEXT NULL`.

---

### 3.7 Purchasing Layer (Compact; tables mirror sales structurally)
- **suppliers**: id, uuid, business_id, code UNIQUE, name, contact_person, phone, email, website, address, city, region, gps_address, tin, vat_registered BOOLEAN, payment_terms(VARCHAR16:NET_7,NET_15,NET_30,NET_60,CASH_ON_DELIVERY,ADVANCE_PAYMENT), credit_limit NUMERIC(14,2) NULL, current_balance NUMERIC(14,2) NOT NULL DEFAULT 0, preferred_payment_method_id FK payment_methods, tax_account_id FK, is_active, created_at.
- **purchase_orders**: id, uuid, business_id, po_number UNIQUE, supplier_id FK, branch_id NULL, warehouse_id FK, requested_by FK users, approved_by FK users NULL, expected_receipt_date DATE, status (DRAFT→SENT→PARTIALLY_RECEIVED→FULLY_RECEIVED→CANCELLED→CLOSED), tax_total NUMERIC, subtotal NUMERIC, total NUMERIC, discount NUMERIC, freight NUMERIC, terms_notes TEXT, internal_note TEXT, sent_at, completed_at, **Index**: `(business_id, status, created_at)`.
- **purchase_order_items**: po_id FK, variant_id FK, qty_ordered, unit_cost_excl, tax_rate_pct_snapshot, line_total, qty_received_running NUMERIC DEFAULT 0 (maintained by trigger), qty_billed_running NUMERIC DEFAULT 0, description_overide.
- **goods_receipts**: id, uuid, business_id, gr_number UNIQUE, po_id FK NULL, supplier_id FK, warehouse_id FK, gr_date DATE, received_by FK employees, posted_by FK users, status(DRAFT→POSTED), subtotal, tax_total, freight_allocated NUMERIC, total, supplier_delivery_note VARCHAR(64), supplier_invoice_number VARCHAR(64), posted_at, note.
- **goods_receipt_items**: gr_id FK, po_item_id FK NULL, variant_id FK, medicine_batch_id FK NULL, imei_ids_json JSONB (device-tracked), qty_received, qty_accepted, qty_rejected, unit_cost_excl (final), tax_amount, batch_number_input VARCHAR(128), expiry_date_input DATE, serial_numbers_input_json JSONB, reason_rejected VARCHAR(64).
- **purchase_invoices**: id, uuid, business_id, invoice_number UNIQUE per biz, supplier_id FK, gr_id FK NULL, supplier_invoice_ref VARCHAR(64), issue_date DATE, due_date DATE, tax_invoice BOOLEAN, subtotal_excl, discount_amount, tax_total, total_incl, freight, rounding, grand_total NUMERIC(14,2) NOT NULL, amount_paid_running NUMERIC DEFAULT 0, balance NUMERIC GENERATED ALWAYS AS (grand_total - amount_paid_running) STORED, status (DRAFT→POSTED→PARTIALLY_PAID→PAID→OVERPAID→VOID), posted_at, paid_at, note, gl_posted BOOLEAN NOT NULL DEFAULT false (JournalEntry done flag).
- **purchase_invoice_items**: invoice_id FK, goods_receipt_item_id FK NULL, variant_id FK, qty_invoiced, unit_cost_excl, line_subtotal, tax_amount, line_total.
- **purchase_returns** + **purchase_return_items**: structure mirror SaleReturn/SaleReturnItem but direction to Supplier; on POST → StockMovement(SUPPLIER_RETURN).
- **supplier_payments**: id, uuid, business_id, supplier_id FK, payment_number UNIQUE, payment_method_id FK, source_account_type VARCHAR(16) (CASH/BANK/MOMO), cash_account_id FK NULL, bank_account_id FK NULL, amount NUMERIC(14,2) NOT NULL, reference VARCHAR(64), payment_date DATE, status(PENDING→POSTED→VOID) NOT NULL, posted_at, note, **Allocations table**: `supplier_payment_allocations`(payment_id FK, purchase_invoice_id FK, amount_allocated NUMERIC NOT NULL) with check sum(allocation) <= payment.amount; oldest-first auto.

---

### 3.8 Customer / Loyalty Layer
- **customer_groups**: id, uuid, business_id FK, code UNIQUE, name, price_list_code VARCHAR(32), order_discount_pct NUMERIC(6,4), credit_limit_default NUMERIC(14,2), payment_terms_default VARCHAR(16), loyalty_exempt BOOLEAN DEFAULT false, is_active.
- **customers**: id, uuid, business_id FK, group_id FK NULL, customer_number UNIQUE per biz, full_name, email NULL UNIQUE NULLS DISTINCT, phone E.164 NOT NULL UNIQUE, secondary_phone NULL, tin NULL, date_of_birth DATE NULL, anniversary DATE NULL, gps_address NULL, address TEXT NULL, city NULL, total_spend_lifetime NUMERIC(14,2) DEFAULT 0, total_visits INT DEFAULT 0, last_visit_at NULL, vip_tier VARCHAR(16) NULL, opt_in_sms BOOLEAN DEFAULT false, opt_in_email BOOLEAN DEFAULT false, referral_source VARCHAR(64) NULL, notes TEXT, is_active, created_at, deleted_at NULL, **Index**: trigram on full_name, phone; (customer_number, business_id) UNIQUE.
- **customer_credits**: Running ledger (NOT a single balance column). id, uuid, business_id, customer_id FK, transaction_number UNIQUE, txn_date, txn_type(INVOICE_CHARGE/PAYMENT_RECEIVED/CREDIT_NOTE/DEBIT_NOTE/REFUND_TO_CREDIT/OPENING_BALANCE), amount NUMERIC(14,2) SIGNED, balance_after NUMERIC(14,2) NOT NULL, reference_type VARCHAR(32) NULL (SALE/SALE_RETURN/SUPPLIER_CREDIT/…), reference_id BIGINT NULL, created_by FK users, note TEXT, **Aggregate view**: `customer_current_balances` → group by customer_id, select sum(amount) as balance.
- **customer_credit_payments**: id, uuid, business_id, customer_id FK, payment_id FK payments (the actual cash/momo receipt), customer_credit_id FK (the credit transaction line it creates), amount_applied NUMERIC(14,2) NOT NULL, note.
- **loyalty_accounts**: id, uuid, business_id UNIQUE customer_id FK (unique per business), customer_id FK, tier VARCHAR(16) (BRONZE/SILVER/GOLD/PLATINUM), points_balance INT NOT NULL DEFAULT 0, points_total_earned INT NOT NULL DEFAULT 0, points_total_redeemed INT NOT NULL DEFAULT 0, points_expire_next DATE NULL, enrolled_at, last_activity_at, is_active, **Indexes**: UNIQUE(business_id, customer_id).
- **loyalty_transactions**: id, uuid, business_id, loyalty_account_id FK, txn_type(EARN/REDEEM/ADJUST/EXPIRE/TRANSFER/BONUS), points_delta INT SIGNED NOT NULL, balance_after INT NOT NULL, sale_id FK NULL, reference_id BIGINT NULL, reason VARCHAR(128) NULL, created_at, created_by FK users, note, **Trigger**: after insert → UPDATE loyalty_accounts.points_balance += points_delta, last_activity_at = now(); recompute tier if tier-based on balance.

---

### 3.9 Accounting Layer
- **accounts** (Chart of Accounts): id, uuid, business_id FK, parent_id FK self NULL, code VARCHAR(32) NOT NULL UNIQUE per biz (hierarchical: 1=Assets, 10=Current Assets, 1000=Cash on Hand), name NOT NULL, description TEXT, type VARCHAR(16) (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE/CONTRA_ASSET/CONTRA_LIABILITY/CONTRA_REVENUE/CONTRA_EXPENSE) NOT NULL, sub_type VARCHAR(32) (CASH/BANK/MOMO/AR/AP/INVENTORY/TAX/REVENUE_SALE/COGS/EXPENSE_RENT/…), normal_balance_side VARCHAR(4) (DEBIT/CREDIT) NOT NULL, is_bank_reconciliation_enabled BOOLEAN NOT NULL DEFAULT false, is_active, allow_manual_journal BOOLEAN NOT NULL DEFAULT true, **Seed**: Ghana standard chart per business on Business.create().
- **expense_categories**: id, uuid, business_id FK, code UNIQUE, name, account_id FK (default expense account for this category), parent_id FK self NULL, is_active.
- **expenses**: id, uuid, business_id FK, branch_id FK, expense_category_id FK, account_id FK NOT NULL, expense_number UNIQUE per biz, date, amount NUMERIC(14,2), tax_amount NUMERIC(14,2), reference VARCHAR(128), vendor_name VARCHAR(255), description TEXT, receipt_path VARCHAR(512) NULL, paid_from_type VARCHAR(16)(CASH/BANK/MOMO), cash_account_id FK NULL, bank_account_id FK NULL, payment_id FK payments(id) ON DELETE SET NULL NULL, paid_by FK employees, is_posted BOOLEAN, posted_at, created_by, gl_posted BOOLEAN NOT NULL DEFAULT false.
- **incomes**: parallel structure with income_category_id.
- **cash_accounts**: id, uuid, business_id FK, account_id FK NOT NULL UNIQUE, name, branch_id FK, register_id FK UNIQUE NULL, currency_code, current_balance NUMERIC(14,2) NOT NULL DEFAULT 0 (running from FinancialTransaction), last_reconciled_at NULL.
- **bank_accounts**: id, uuid, business_id FK, account_id FK NOT NULL UNIQUE, name, bank_name, branch_name, account_number VARCHAR(32) NOT NULL, sort_code VARCHAR(32) NULL, currency_code, current_book_balance NUMERIC(14,2), last_reconciled_balance NUMERIC NULL, last_reconciled_at NULL.
- **financial_transactions**: Unified money movement ledger. id, uuid, business_id FK, txn_number UNIQUE, txn_date, txn_type(SALE_PAYMENT/SALE_REFUND/CUSTOMER_CREDIT_PAYMENT/SUPPLIER_PAYMENT/EXPENSE/INCOME/TRANSFER_BETWEEN_ACCOUNTS/OPENING_BALANCE/OTHER), debit_account_id FK accounts NOT NULL, credit_account_id FK accounts NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK (amount > 0), currency_code, reference_type VARCHAR(32), reference_id BIGINT, payment_id FK payments ON DELETE SET NULL NULL, description TEXT, posted_at, created_by, is_reversed BOOLEAN DEFAULT false, reversal_of_id FK self NULL, **Trigger**: after insert → UPDATE cash_accounts/bank_accounts running balances.
- **journal_entries**: id, uuid, business_id FK, journal_number UNIQUE per biz, entry_date, memo TEXT, reference_type VARCHAR(32) NULL, reference_id BIGINT NULL, source_system BOOLEAN NOT NULL DEFAULT false (auto-generated sales/purchases/system), status(DRAFT/POSTED/VOID/REVERSED) NOT NULL, posted_at, posted_by FK users NULL, approved_by FK users NULL, **Check**: sum(journal_entry_lines.debit) == sum(journal_entry_lines.credit).
- **journal_entry_lines**: id, journal_entry_id FK CASCADE, account_id FK accounts, description TEXT, debit NUMERIC(14,2) NOT NULL DEFAULT 0, credit NUMERIC(14,2) NOT NULL DEFAULT 0, reference_type NULL, reference_id NULL, **Check**: CHECK (debit >= 0 AND credit >= 0 AND (debit > 0 OR credit > 0) AND NOT (debit > 0 AND credit > 0)).
- **shifts**: id, uuid, business_id FK, register_id FK NOT NULL, branch_id FK, employee_id FK NOT NULL (cashier), shift_number UNIQUE, open_time, close_time NULL, opening_float NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0), closing_cash_counted NUMERIC(14,2) NULL CHECK (closing_cash_counted IS NULL OR closing_cash_counted >= 0), closing_cash_expected NUMERIC(14,2) NULL (opening_float + sum cash payments - sum cash refunds - sum cash payouts; aggregate), cash_variance NUMERIC(14,2) GENERATED ALWAYS AS (closing_cash_counted - closing_cash_expected) STORED NULL, closing_note TEXT, status(OPEN/CLOSED/RECONCILED/Void) NOT NULL DEFAULT 'OPEN', summary_json JSONB NOT NULL DEFAULT '{}'::jsonb ({payments_by_method:…, sales_count, returns_count, no_sale_drawer_opens:…}), reconciled_at, reconciled_by_id FK users, close_reason VARCHAR(32) NULL (END_OF_DAY/SHIFT_HANDOVER/FORCE_CLOSE), **Constraint**: Trigger prevents new INSERT of sales/payments/cash_drawer events referencing shift WHERE status='CLOSED'.
- **cash_drawer_events**: id, uuid, business_id FK, register_id FK, shift_id FK, drawer_id FK, opened_at, opened_by FK users, reason VARCHAR(32) NOT NULL CHECK (IN(SALE_END,NO_SALE,REFUND,PAYOUT,MID_SHIFT_BANK_DEPOSIT,MANUAL)), amount NUMERIC(14,2) NULL (for PAYOUT/BANK_DEPOSIT), reference_id BIGINT NULL, note TEXT.

---

### 3.10 Repairs Layer (for phone/electronics shops)
- **technicians**: id, uuid, business_id FK, user_id FK users ON DELETE SET NULL NULL UNIQUE, employee_number UNIQUE per biz, full_name, phone, email, specialty_json JSONB (["iOS","Android","Laptops"]), hire_date, status(ACTIVE/INACTIVE/ON_LEAVE), commission_pct NUMERIC(6,4).
- **repair_statuses**: id, business_id FK NULL (NULL = global seed), status_key VARCHAR(32) UNIQUE, name VARCHAR(128), color_hex VARCHAR(7), sort_order INT, is_active. Seeds: INTAKE, DIAGNOSIS_IN_PROGRESS, AWAITING_PARTS, REPAIR_IN_PROGRESS, QC, READY_FOR_PICKUP, DELIVERED, UNREPAIRABLE_SCRAPPED, LOST_BY_SHOP, CANCELLED.
- **repairs**: id, uuid, business_id FK, ticket_number UNIQUE per biz NOT NULL, customer_id FK NOT NULL, intake_employee_id FK employees, assigned_technician_id FK technicians NULL, repair_status_id FK repair_statuses NOT NULL, branch_id FK, intake_date, promised_date DATE, completed_date NULL, delivered_date NULL, device_type VARCHAR(64), brand_name VARCHAR(128), model_name VARCHAR(128), imei_id FK imeis ON DELETE SET NULL NULL, imei_text_snapshot VARCHAR(32) NULL, serial_snapshot VARCHAR(64) NULL, device_condition_text TEXT, device_passcode VARCHAR(64) NULL (encrypted? TODO: use pgcrypto pgp_sym_encrypt), reported_fault TEXT NOT NULL, initial_diagnosis TEXT NULL, diagnostic_fee NUMERIC(14,2) NOT NULL DEFAULT 0, parts_estimate NUMERIC(14,2) NOT NULL DEFAULT 0, labour_estimate NUMERIC(14,2) NOT NULL DEFAULT 0, total_estimate NUMERIC GENERATED ALWAYS AS (diagnostic_fee + parts_estimate + labour_estimate) STORED, discount NUMERIC(14,2) NOT NULL DEFAULT 0, final_total NUMERIC(14,2) NULL, amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0, balance NUMERIC GENERATED ALWAYS AS (COALESCE(final_total,0) - amount_paid) STORED, deposit_paid NUMERIC(14,2) NOT NULL DEFAULT 0, customer_notes TEXT, internal_notes TEXT, warranty_on_repair_months INT NOT NULL DEFAULT 3 CHECK (warranty_on_repair_months >= 0), signed_intake_form_path VARCHAR(512) NULL, status_change_log_json JSONB NOT NULL DEFAULT '[]'::jsonb, is_active, created_at, updated_at.
- **repair_items**: id, repair_id FK, item_type VARCHAR(16) CHECK (IN (PART,LABOUR,DIAGNOSTIC,FEE,EXPRESS_CHARGE,OTHER)), product_variant_id FK product_variants ON DELETE SET NULL NULL (for PART rows), name_snapshot VARCHAR(512) NOT NULL, description TEXT NULL, qty NUMERIC(12,3) NOT NULL DEFAULT 1, unit_price NUMERIC(14,2) NOT NULL, discount NUMERIC(14,2) NOT NULL DEFAULT 0, line_total NUMERIC(14,2) GENERATED ALWAYS AS (qty * unit_price - discount) STORED, stock_consumed BOOLEAN NOT NULL DEFAULT false (for PARTS: true → StockMovement(SALE_OUT) against repair), consumed_from_warehouse_id FK NULL, imei_id FK NULL, status VARCHAR(16) (ESTIMATED/USED/RETURNED_TO_STOCK/WASTED).

---

### 3.11 Notifications, Backups
- **notifications**: id, uuid, business_id FK, user_id FK (target), from_system BOOLEAN DEFAULT false, type VARCHAR(32) (LOW_STOCK, EXPIRY_WARNING_90D/30D/7D, TRANSFER_AWAITING_RECEIPT, SLA_BREACH_REPAIR, PAYMENT_DUE_SUPPLIER, CUSTOMER_BIRTHDAY, SHIFT_NOT_CLOSED, BACKUP_SUCCESS, BACKUP_FAILURE, LICENSE_EXPIRING), title VARCHAR(255) NOT NULL, body TEXT NOT NULL, action_url VARCHAR(512) NULL, data_json JSONB DEFAULT '{}', is_read BOOLEAN NOT NULL DEFAULT false, read_at NULL, is_email_sent BOOLEAN DEFAULT false, is_sms_sent BOOLEAN DEFAULT false, created_at, expires_at NULL, **Index**: `(user_id, is_read, created_at DESC)`.
- **backups**: id, uuid, business_id FK, filename_local VARCHAR(512) NOT NULL, filename_display VARCHAR(255) NOT NULL, size_bytes BIGINT NOT NULL CHECK (size_bytes > 0), type VARCHAR(16) (FULL_DB_SCHEMA_DATA/FULL_DATA_ONLY/PARTIAL_BRANCH) NOT NULL DEFAULT 'FULL_DB_SCHEMA_DATA', source VARCHAR(16) (MANUAL/SCHEDULED/ON_DEMAND_SCRIPT) NOT NULL, schedule_id VARCHAR(64) NULL, plaintext_sha256 CHAR(64) NOT NULL, encrypted_sha256 CHAR(64) NOT NULL, encryption_algo VARCHAR(32) NOT NULL DEFAULT 'AES-256-GCM', encryption_kdf_iter INT NOT NULL DEFAULT 200000, encryption_salt_hex VARCHAR(64) NOT NULL, created_by FK users, created_at, status VARCHAR(16) (CREATED/VERIFIED/VERIFY_FAILED/EXPIRED/DELETED) NOT NULL DEFAULT 'CREATED', verified_at NULL, retained_until DATE NOT NULL, backup_note TEXT, restore_count INT NOT NULL DEFAULT 0, last_restored_at NULL, last_restored_by_id FK users NULL, offsite_replicated BOOLEAN NOT NULL DEFAULT false, offsite_location VARCHAR(512) NULL.

---

## 4. Stock Movement Rules & Transaction Boundary Semantics (Summary)

| Event | StockMovement.type | qty_delta sign | Impact on Inventory | Reference (polymorphic parent) |
|-------|-------------------|----------------|---------------------|---------------------------------|
| Stock import / opening balance | `OPENING_STOCK` | + | qty_on_hand +, avg cost = input | `OPENING_BALANCE` |
| Supplier goods received | `PURCHASE_RECEIPT` | + | qty_on_hand +, recompute weighted avg cost | GoodsReceipt.id |
| POS sale item | `SALE` | − | qty_on_hand −, qty_reserved −, FEFO batch consumed first | SaleItem via Sale.id |
| Customer returns (restocked) | `SALE_RETURN` | + | qty_on_hand +, returned batch tracked | SaleReturn.id |
| Return items to supplier | `SUPPLIER_RETURN` | − | qty_on_hand − | PurchaseReturn.id |
| Stock transfer: branch A sends | `TRANSFER_OUT` | −, qty_in_transit + | qty_on_hand −, qty_in_transit + at src | StockTransfer.id |
| Stock transfer: branch B receives | `TRANSFER_IN` | +, qty_in_transit − at src | qty_on_hand + at dest; qty_in_transit − at src | StockTransfer.id |
| Stock adjustment + | `STOCK_ADJUST_POS` | + | qty_on_hand + | StockAdjustment.id |
| Stock adjustment − | `STOCK_ADJUST_NEG` | − | qty_on_hand − | StockAdjustment.id |
| Damaged / write-off | `DAMAGED` | − | qty_on_hand −; expense: Dr Damaged Goods Write-Off | StockAdjustment.id (reason=Damaged) |
| Expired batch (scheduled job OR manual) | `EXPIRED` | − | qty_on_hand −; Dr Inventory Write-Off Expense; MedicineBatch.status → EXPIRED | medicine_batches.id, reference_type=INVENTORY_JOB |
| Lost / stolen incident | `LOST_STOLEN` | − | qty_on_hand −; Dr Loss Expense + AuditLog(WARNING) | StockAdjustment.id |
| Stock count variance + | `COUNT_CORRECTION_POS` | + | qty_on_hand + | StockCount.id |
| Stock count variance − | `COUNT_CORRECTION_NEG` | − | qty_on_hand − | StockCount.id |
| Transfer variance (damaged in transit) | `TRANSIT_ADJUST` | pair +/− or single | Dr Expense, Cr Inventory in transit | StockTransferItem.variance_reason |

The integrity rule:
```
For every (business_id, product_variant_id, branch_id, warehouse_id):
  Inventory.qty_on_hand == (
    SELECT COALESCE(SUM(qty_delta),0) FROM stock_movements sm
      WHERE sm.business_id = i.business_id
        AND sm.product_variant_id = i.product_variant_id
        AND sm.branch_id = i.branch_id
        AND sm.warehouse_id = i.warehouse_id
  )
```
A nightly check query runs with `EXCEPT` between Inventory and the aggregate view; any mismatch → AuditLog(ERROR) + admin notification, auto-freeze posting to that branch until investigated. A deferred constraint trigger performs this check at COMMIT time for each transaction — but not per row, to avoid O(n²) bulk inserts.

---

## 5. Sequences & Gapless Numbers

PostgreSQL sequences are not gapless (they skip on aborted transactions). For invoice/purchase order/receipt numbers that must be sequential per GRA requirements, we use:
- A table `business_number_counters(business_id PK BIGINT, counter_key VARCHAR(32) PK, last_value BIGINT NOT NULL, prefix VARCHAR(64) NOT NULL, padding INT NOT NULL DEFAULT 6, year INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE))`.
- Function `assign_gapless_number(business_id, counter_key) RETURNS TEXT` that:
  1. Locks the row with `SELECT … FROM business_number_counters WHERE business_id=$1 AND counter_key=$2 FOR UPDATE`.
  2. Increments `last_value += 1`.
  3. Returns `prefix || '-' || year || '-' || LPAD(last_value::text, padding, '0')`.
- Counter keys: `SALE_INVOICE`, `RETURN_INVOICE`, `PURCHASE_ORDER`, `PURCHASE_INVOICE`, `GOODS_RECEIPT`, `STOCK_TRANSFER`, `STOCK_ADJUSTMENT`, `STOCK_COUNT`, `REPAIR_TICKET`, `CUSTOMER_NO`, `SUPPLIER_NO`.
- On PostgreSQL 15+ `UNIQUE NULLS NOT DISTINCT` and the advisory lock guarantee strict gaplessness under concurrent writes.

---

## 6. Migration & Partitioning Strategy

### 6.1 Migrations
- Django migrations are additive-only between minor versions. Destructive migrations (DROP COLUMN, DROP TABLE, CHANGE TYPE that rewrites) require a two-step dance:
  1. vN.M.0 Add new column nullable + dual-write trigger in service layer.
  2. vN.M.1 Backfill old column → new column.
  3. v(N+1).0.0 (major) drop old column.
- Squash migrations each major release to keep history compact (keep initial squashed migration + "from squashed" path).

### 6.2 Partitioning
Recommended for deployments exceeding 2M rows on:
- `audit_log` → RANGE partition by `timestamp`, monthly partitions, retain as per business policy (7 years + detach partitions older than that to archive).
- `stock_movements` → RANGE partition by `created_at`, quarterly.
- `financial_transactions` → RANGE partition by `txn_date`, yearly.
- `sales` → RANGE partition by `created_at`, yearly.

PostgreSQL declarative partitioning syntax applied manually in a dedicated migration; Django ORM works transparently because constraints propagate from parent to children.

---

## 7. RACI / Ownership

| Aspect | Owner | Reviewed By |
|--------|-------|-------------|
| Schema design changes | Backend Tech Lead | Solutions Architect + DBA consultant (external) |
| Migration reviews | Senior Backend Engineer | Backend Tech Lead |
| Performance of top-10 queries (pg_stat_statements) | Backend Engineer on-call | Tech Lead (monthly) |
| Backup/restore drill | DevOps / Release Engineer | BusinessOwner (customer IT) quarterly |

All schema changes MUST be accompanied by: (a) forward migration, (b) reverse migration if possible, (c) benchmark against 1M-row fixture if the table is transactional, (d) update to this document.
