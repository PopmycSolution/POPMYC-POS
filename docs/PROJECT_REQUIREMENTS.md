# POPMYC Retail POS - Project Requirements

## Document Overview
- **Document ID**: POPMYC-PRD-001
- **Version**: 1.0.0 (Stage 01 Scope)
- **Status**: DRAFT
- **Last Updated**: 2026-09-04
- **Owner**: POPMYC Engineering Team

---

## 1. Executive Summary

POPMYC Retail POS is a Ghana-focused, local-first, omnichannel retail management platform designed for small to medium-sized businesses across multiple verticals. The system prioritizes **offline reliability**, **data ownership**, **Ghana-specific payment integrations** (MTN MoMo, Telecel Cash, AirtelTigo Money), and **multi-business/branch isolation** in a single deployable instance.

POPMYC is engineered to operate on a single Windows PC (supermarket kiosk mode), local area network (LAN with multiple tills), and eventually cloud-hosted multi-tenant deployments. Stage 01 delivers a production-grade single-business/multi-branch LAN deployment with a React TypeScript frontend and Django/PostgreSQL backend.

---

## 2. Product Vision & Mission

### 2.1 Vision
To become the de-facto retail operating system for Ghanaian and West African SMEs, enabling formalized inventory, accounting, and customer management without requiring constant internet connectivity.

### 2.2 Mission
Deliver a robust, affordable, offline-capable POS that handles Ghana-specific business realities: Mobile Money dominance, frequent power outages (dumsor), TIN/VAT compliance requirements, multiple business verticals under one ownership, and cash-heavy retail environments.

---

## 3. Target Market & Vertical Coverage

POPMYC Stage 01 explicitly targets and is tested against the following retail verticals in Ghana:

| Vertical | Specific Requirements | Stage 01 Support |
|----------|----------------------|------------------|
| **Supermarket / Grocery** | Barcode scanning, weighted items, expiry tracking, promotional pricing, FMCG fast checkout | FULL |
| **Pharmacy / Chemist** | Medicine batch tracking, expiry alerts (FEFO), prescription linkage, restricted drug flags, NHIS eligibility field | FULL |
| **Phone Shop / Mobile Devices** | IMEI capture per unit, warranty tracking, device condition grading, repair ticket linkage, SIM/airtime top-ups | FULL |
| **Electronics & Appliances** | Serial number capture, warranty periods, repair management, large-ticket split payments, layaway (future) | FULL |
| **Fashion Boutique / Clothing** | Variant matrix (size/color/style), SKU-level stock, barcodes on tags, return window enforcement | FULL |
| **Cosmetics & Beauty** | Batch numbers, expiry dates, product variant shades, salon service add-ons (future) | FULL |
| **Restaurant / Fast Food** | Kitchen ticket printing, modifier groups, dining option (dine-in/takeaway/delivery), table management (future), menu modifiers | PARTIAL (kitchen print + modifiers; table mgmt in Stage 02) |
| **Wholesale / Bulk Trade** | Customer-specific price lists, case pack units, credit sale terms, post-dated cheque tracking, minimum order qty | FULL |
| **General Trade / Provision Store** | Mixed FMCG, open-item entry, fast cash checkout, simple stock count | FULL |

### 3.1 Customer Personas
- **Owusu** (Supermarket Owner, Accra): 3 branches, 12 staff, needs LAN multi-till, MoMo integration, stock transfer between branches.
- **Ama** (Pharmacy Owner, Kumasi): Single shop, pharmacist + 2 attendants, needs expiry alerts, batch tracking, prescription records.
- **Kofi** (Phone Shop, Takoradi): Mall kiosk, needs IMEI logging per handset, warranty records, repair tickets, split MoMo+cash payments.
- **Grace** (Boutique, Tamale): Single shop, part-time staff, needs size/color variants, customer loyalty, sale hold for fitting room.

---

## 4. Core Design Principles

### 4.1 Local-First / Offline-First Architecture
The frontend POS terminal operates with a fully functional local state persisted to IndexedDB. Critical transaction paths (sale creation, payment recording, stock lookup) never block on network availability. Syncing to the central PostgreSQL store is bidirectional and asynchronous with idempotency guarantees.

### 4.2 Data Ownership & Portability
All business data is stored in a PostgreSQL database the business owner controls. SQL dump exports are standard format, importable into any PostgreSQL 14+ instance. The application layer never encrypts data with keys held only by POPMYC.

### 4.3 Multi-Business Isolation (Shared Instance)
A single POPMYC deployment MAY host multiple logical `Business` records. All row-level queries (including stock lookups, reports, sales) are scoped by `business_id` at the ORM layer. Cross-business data leakage is a Critical-severity defect category. Branches and warehouses are scoped within a Business.

### 4.4 Ghana-Specific First
Every user-facing numeric currency field defaults to **Ghana Cedi (GHS) with GH₵ symbol and 2-decimal precision**. TIN (Taxpayer Identification Number) fields are first-class on Business, Supplier, and Customer. Mobile Money (MTN, Telecel Cash, AirtelTigo) payment methods are pre-seeded, not afterthoughts.

### 4.5 Auditability & Non-Repudiation
Stock movements are an **immutable append-only ledger**. Financial transactions (sales, payments, purchases, expenses, journal entries) form a double-entry trace. Every data mutation produces an `AuditLog` record with actor IP, session ID, and change diff.

---

## 5. Functional Requirements (Stage 01)

### 5.1 Business & Tenancy Management
- FR-BIZ-01: Create, update, deactivate a Business record with legal name, trading name, TIN, VAT registration flag, postal address, GPS address, contact phone, email, logo, currency (default GHS), locale (en-GH default).
- FR-BIZ-02: A Business MAY have N Branches. Each Branch has a name, code, address, phone, default warehouse, operating hours, and active flag.
- FR-BIZ-03: A Business MAY have N Warehouses. A Warehouse MAY be linked to a Branch (retail stockroom) or standalone (central distribution).
- FR-BIZ-04: BusinessSettings record controls: default tax rate, default price list, receipt footer text, loyalty program enable flag, stock valuation method (FIFO / weighted average), negative stock allowed flag, return window (days), receipt printer IP per branch.
- FR-BIZ-05: Row-level security: every table with business_id returns zero rows when queried by a user belonging to a different business. API layer validates this on every request.

### 5.2 Identity, Authentication & Authorization
- FR-AUTH-01: User accounts with email OR phone as username. Password length min 10 chars, enforced complexity (upper, lower, digit required).
- FR-AUTH-02: Role-Based Access Control (RBAC) with a Permission matrix. Out-of-box roles: SuperAdmin (system-wide), BusinessOwner, BranchManager, Cashier, StockController, Accountant, Pharmacist (view-restricted), ReadOnlyAuditor.
- FR-AUTH-03: Permission granularity supports: `sale.create`, `sale.price_override`, `sale.discount_above_10pct`, `stock.adjust`, `stock.transfer.approve`, `payment.refund`, `report.view_profit_loss`, `backup.restore` and 60+ more.
- FR-AUTH-04: JWT access token (15-min expiry) + refresh token (7-day sliding expiry) stored HTTPOnly secure cookie. Additionally, LoginSession records track device, IP, user agent, and support remote logout.
- FR-AUTH-05: Employee records linked to User. Employee has payroll number, hire date, branch assignment, allowed registers, commission rate.

### 5.3 Product & Catalog Management
- FR-CAT-01: Product with SKU, name, description, category, brand, base unit, track-stock flag, is-active flag, tax-class (standard/exempt/zero-rated), reorder level, expiry-track flag, batch-track flag, serial/IMEI-track flag.
- FR-CAT-02: ProductVariant with option grid (Size:S/M/L | Color:Red/Blue). Variant has own SKU, barcode, price, weight, stock track override.
- FR-CAT-03: Barcode entity (many-to-one Product/Variant) supporting EAN-13, UPC-A, CODE-128, QR code, internal custom barcodes. Same product MAY have multiple barcodes from different suppliers.
- FR-CAT-04: ProductPrice with price list support: Default, Wholesale, VIP, CustomerGroup-X. Start/end date for promotional pricing. Priority ordering.
- FR-CAT-05: ProductSupplier (many-to-many) with supplier SKU, lead time days, last cost price, preferred supplier flag.
- FR-CAT-06: ProductTax (many-to-many tax class per jurisdiction): VAT (15% standard Ghana rate), NHIL (2.5%), GETFund (2.5%), COVID Levy (0% as of 2024, configurable), exempt flag.
- FR-CAT-07: Medicine extension: generic name, dosage form, strength, schedule class (OTC/Rx), contraindications text. MedicineBatch links ProductVariant to batch number, expiry date, manufacturing date, purchase cost per unit.
- FR-CAT-08: Device extension: IMEI/serial mandatory flag, warranty months, condition grade (New/Open-Box/Used-A/Used-B/Refurbished). IMEI table records per-unit serial with status (InStock/Sold/Returned/Repair/Lost).
- FR-CAT-09: ProductImage up to 6 images, sorted by display order. Images stored on local disk, path in DB.

### 5.4 Inventory & Stock Management
- FR-INV-01: Inventory ledger. A single physical SKU at a single Branch/Warehouse has exactly one current Inventory row (qty_on_hand, qty_reserved, qty_available, avg_unit_cost, last_purchase_cost, updated_at).
- FR-INV-02: StockMovement is the immutable ledger. Every change to Inventory qty_on_hand writes exactly one StockMovement row with: movement_type, reference_type (Sale/Purchase/Adjustment/Transfer/Count), reference_id, qty_delta (+/-), unit_cost snapshot, balance_after, branch_id, warehouse_id, performed_by, created_at.
- FR-INV-03: 12 stock movement types implemented in Stage 01:
  1. `OPENING_STOCK` - Initial data load / stock take upload
  2. `PURCHASE_RECEIPT` - Goods received against a purchase order
  3. `SALE` - Items sold (negative delta)
  4. `SALE_RETURN` - Customer return received back (positive delta)
  5. `SUPPLIER_RETURN` - Returned to supplier (negative delta)
  6. `TRANSFER_OUT` - Branch/Warehouse transfer origin
  7. `TRANSFER_IN` - Branch/Warehouse transfer destination (after receive)
  8. `STOCK_ADJUST` - Manual +/- correction with reason code
  9. `DAMAGED` - Write-off damaged stock (negative delta, expense account)
  10. `EXPIRED` - Write-off expired stock (scheduled job + manual)
  11. `LOST_STOLEN` - Write-off lost/theft (with incident ref)
  12. `COUNT_CORRECTION` - Delta after a stock count / cycle count reconciliation
- FR-INV-04: StockTransfer: Draft → Sent (TRANSFER_OUT written at source, qty_in_transit incremented) → Received (TRANSFER_IN at dest, qty_in_transit decremented, qty_on_hand incremented). Partial receive allowed, variance captured as adjustment.
- FR-INV-05: StockAdjustment: single header + N items, requires reason code (Damaged/Lost/Found/Wastage/WriteOff_Other), approval flag if value > configurable threshold (default GHS 500). Approval requires role with `stock.adjust.approve`.
- FR-INV-06: StockCount / Cycle Count: schedule a count for a warehouse/category. Count has status: Scheduled → InProgress → Recount → Approved/Rejected. StockCountItem captures expected_qty (system) vs counted_qty (user entered). On approval, writes COUNT_CORRECTION StockMovement per SKU variance.
- FR-INV-07: Valuation: FIFO or Weighted Average (business setting). Weighted average recomputes `avg_unit_cost` on every inbound movement using formula: `new_avg = (old_qty * old_cost + delta_qty * delta_cost) / (old_qty + delta_qty)`.
- FR-INV-08: Expiry tracking: nightly job flags MedicineBatches expiring within 90/30/7 days. FEFO (First-Expired-First-Out) recommended order for POS item suggestions when batch-pick is enabled.
- FR-INV-09: Low stock alerts: Inventory below reorder_level triggers Notification to StockController and BranchManager.

### 5.5 Point of Sale (Frontend Terminal)
- FR-POS-01: Login → Branch/Register Selection → Open Shift/Cash Drawer flow mandatory before sale entry.
- FR-POS-02: Register (till) entity. A physical POS terminal = one Register record per Branch. Open shift records starting cash float, cashier, opened_at. Close shift records closing cash, expected cash (computed from sales + payments), variance, closing note.
- FR-POS-03: CashDrawer linked to Register. Each drawer open event is logged (manual / after sale / no-sale kick).
- FR-POS-04: Product lookup: by barcode scan (HID wedge), by SKU, by name search (fuzzy), by category browse. 100ms target lookup from IndexedDB.
- FR-POS-05: Cart line items support: qty edit, unit price override (permission gated: `sale.price_override`), line discount % or flat amount, line tax override (exempt toggle, permission `sale.tax_exempt`), item note (kitchen instruction / prescription ref).
- FR-POS-06: Order-level discount: % or flat amount, capped per user role (e.g., Cashier max 10%, BranchManager unlimited: permission `sale.discount_above_10pct`).
- FR-POS-07: Customer association: search by phone, name, or scan loyalty ID. Auto-apply CustomerGroup price list and discount tier.
- FR-POS-08: Split payments across ANY number of methods. PaymentMethods are database rows (not hardcoded). Ghana defaults: Cash, MTN MoMo, Telecel Cash, AirtelTigo Money, Visa/Mastercard Card, Bank Transfer, QR Code (GhIPSS), Customer Credit (On-Account).
- FR-POS-09: MoMo payment UX: Enter customer phone number, select network auto-detect from prefix (024/054/055=MTN, 020/050=Telecel, 026/027/056/057=AirtelTigo), pop confirm "Request sent to {number}. Awaiting customer approval...". Status: Pending → Completed / Failed / TimedOut. Integration adapter pattern (Stage 01: manual confirmation; Stage 02: direct aggregator API).
- FR-POS-10: Held Sale (parked transaction). A cart MAY be held with a customer name/phone reference and recalled later. Frontend persists held sales to IndexedDB immediately. 48-hour auto-expire (configurable).
- FR-POS-11: Sale Return / Refund: select original sale (by invoice # search), select returnable items, specify return qty, return reason (Defective/ChangedMind/WrongItem/Expired/Other), restock flag (default true except Defective+Expired). Refund payment: refund to original method(s) pro-rata, OR split to cash only. Permission `payment.refund` required.
- FR-POS-12: Receipt printing: 58mm or 80mm thermal ESC/POS. Content: Business logo/name/TIN/address, invoice number, date/time, cashier name, line items (SKU, name, qty, unit, discount, subtotal), tax breakdown per VAT/NHIL/GETFund line, total, payment breakdown (method + ref), change due, footer ("Thank you for your patronage", "Goods sold are returnable within 7 days with receipt", MoMo merchant ID if applicable), QR of invoice ID for lookup.
- FR-POS-13: Receipt re-print allowed within shift, permission gated.
- FR-POS-14: Repair ticket entry for device shops: customer device details, IMEI, fault description, diagnostic fee quote, parts estimate, status (Intake→Diagnosed→PartsOrdered→InRepair→Ready→Delivered→Unrepairable). Technician assignment.

### 5.6 Purchase Order & Supplier Management
- FR-PUR-01: Supplier record: name, contact person, phone, email, address, TIN, payment terms (net-7/15/30/CashOnDelivery), credit limit GHS, tax registration flag, preferred payment method, active.
- FR-PUR-02: PurchaseOrder (PO): Draft → Sent → PartiallyReceived → FullyReceived → Cancelled / Closed. Lines: product variant, qty ordered, unit cost (excl tax), expected delivery date, tax rate per line.
- FR-PUR-03: GoodsReceipt (GR): against PO. Partial allowed. GRItem: qty received, batch number, expiry date (if medicine), serial/IMEI list per unit (if device-tracked). On GR post: PURCHASE_RECEIPT StockMovement, increment inventory, update weighted avg cost, create linked PurchaseInvoice (or skip if pending).
- FR-PUR-04: PurchaseInvoice: final liability. Matches GR lines + freight + tax lines. Status: Draft → Posted → PartiallyPaid → Paid → Void. Posts double-entry journal (Dr Inventory, Dr VAT Input, Cr Accounts Payable / Supplier).
- FR-PUR-05: SupplierPayment: pays one or many PurchaseInvoices (auto-allocate, oldest-first). Payment method + reference. Overpayment recorded as Supplier Credit (future use).
- FR-PUR-06: PurchaseReturn: return GR items to supplier. Creates SUPPLIER_RETURN StockMovement. Dr Accounts Payable, Cr Inventory.

### 5.7 Customer, Loyalty & Credit Management
- FR-CUS-01: Customer: name, phone (unique per business), email, TIN, GPS address, shipping address, date of birth, anniversary, group_id, loyalty_enable flag, credit_limit GHS, current_balance GHS (negative = owes us), notes.
- FR-CUS-02: CustomerGroup: name, discount % (order-level default), price list link, credit limit default. Examples: Retail, Wholesale, VIP, Staff, Family.
- FR-CUS-03: CustomerCredit (on-account / layaway future): direct balance adjustments (invoice on credit, credit payment, credit note). CustomerCreditPayment records method + ref.
- FR-CUS-04: LoyaltyAccount: points balance, tier (Bronze/Silver/Gold/Platinum), last activity date. LoyaltyTransaction: type (Earn from sale / Redeem for discount / Adjust by admin / Expire), points delta, sale reference, description. Earn formula (configurable per BusinessSetting): `points = floor(total_sale_cedi / earn_rate_cedi_per_point)`. e.g. GHS 1 = 1 point. Redeem rate: e.g. 100 points = GHS 5 discount.
- FR-CUS-05: Customer credit sale (on account): payment method "Customer Credit" defers balance, requires permission `sale.on_account` AND total <= available credit limit + terms OK.

### 5.8 Expense & Double-Entry Accounting (Lightweight)
- FR-FIN-01: Chart of Accounts (Account table): types Asset/Liability/Equity/Revenue/Expense. Pre-seeded Ghana standard chart: Cash on Hand (Asset), MTN MoMo Wallet (Asset), Bank Account (Asset), Accounts Receivable (Asset), Inventory (Asset), Accounts Payable (Liability), VAT Payable (Liability), NHIL Payable (Liability), GETFund Payable (Liability), Sales Revenue (Revenue), Sales Discount (Contra-Revenue), Sales Returns (Contra-Revenue), Purchase Discount (Contra-Expense), COGS (Expense), Rent (Expense), Salaries (Expense), Utilities (Expense), etc.
- FR-FIN-02: Expense: header + ExpenseCategory (Rent/Utilities/Salaries/Marketing/Transport/Misc), amount, payment method, receipt attachment (file path), paid_by employee, branch_id, notes, date. On post: Dr Expense account, Cr Cash/Bank.
- FR-FIN-03: Income (non-sale revenue): similar to Expense but revenue-side (interest, commish, etc.)
- FR-FIN-04: FinancialTransaction: every monies movement (sale payment, supplier payment, expense, income, transfer between cash/bank/MoMo) writes a FinancialTransaction row linked to the source document.
- FR-FIN-05: JournalEntry: manual journal for end-of-month adjustments. Header + N lines (at least one Dr, one Cr; sum Dr == sum Cr; posted with audit). Permission `accounting.journal.post` required.
- FR-FIN-06: BankAccount, CashAccount (Asset accounts with a register of transactions). CashAccount ties to CashDrawer / Shift for reconciliation.
- FR-FIN-07: Reports: Daily Sales Summary (by method, by cashier), Cashier Shift Report (opening float → expected → actual → variance), Profit & Loss (income statement) date range, Balance Sheet (summary), Inventory Valuation (at cost, at retail), Aged Receivables, Aged Payables, Top Selling Items, GST/VAT Return report (GRA format fields: output VAT, input VAT, NHIL, GETFund, net tax payable).

### 5.9 Notifications & System Alerts
- FR-NOT-01: In-app Notification center (bell icon, unread count). Notifications by role subscription.
- FR-NOT-02: Event notifications: Low stock, Expiry (90/30/7 day), Stock transfer awaiting receipt at destination, Purchase order expected today, Supplier payment due today, Customer birthday (VIP), Shift not closed after 24h, Backup success/failure.
- FR-NOT-03: Future channels: SMS (Mnotify / Hubtel), Email (SMTP / SES). Stage 01: in-app only.

### 5.10 Backup & Recovery
- FR-BKP-01: Database backups via pg_dump with encrypted output (AES-256-GCM). Encryption key from admin-provided passphrase-derived key (PBKDF2-SHA256, 200k iter).
- FR-BKP-02: Manual backup (Admin → Backup → Download .bak.enc), scheduled nightly backup at 02:00 local time to local disk + optional network share path (UNC on Windows / Samba).
- FR-BKP-03: Retention policy (configurable): daily 30 days, weekly 12 months, monthly 3 years.
- FR-BKP-04: Restore UI: upload .bak.enc → enter passphrase → pre-flight checks (DB empty? PostgreSQL version? disk space?) → restore → verify → prompt for re-login.
- FR-BKP-05: Backup metadata in Backup table: id, filename, size_bytes, checksum (SHA-256 plaintext), scheduled_vs_manual, created_by, status. Restore events logged to AuditLog with Critical severity.

### 5.11 Audit & Compliance
- FR-AUD-01: AuditLog for EVERY CREATE/UPDATE/DELETE on business data tables. Columns: timestamp, business_id, user_id, session_id, ip_address, user_agent, table_name, record_id, action (CREATE/UPDATE/DELETE/SOFT_DELETE/RESTORE/LOGIN/LOGOUT/BACKUP/RESTORE), before_jsonb, after_jsonb, change_summary text.
- FR-AUD-02: LoginSession audit: every login records device fingerprint, geo (LAN IP noted), user agent. Session invalidation on explicit logout, password change, or admin remote kill.
- FR-AUD-03: Read-only Auditor role can view AuditLog and reports but cannot modify any transactional data.
- FR-AUD-04: Data retention: raw AuditLog retained 7 years (Ghana tax audit requirement). Sales/purchases/inventory records retained indefinitely unless Business deletion is requested (hard delete option for SuperAdmin with dual approval).

### 5.12 Ghana-Specific Compliance Requirements
- FR-GH-01: All tax invoices display Business legal name, TIN, physical address, tax invoice serial numbering with format: `INV-{YYYY}-{SEQ:06d}` and sequential gapless per business.
- FR-GH-02: VAT registered businesses: standard rate 15% + NHIL 2.5% + GETFund 2.5% (total 20% on vatable goods as of 2024, but configurable per BusinessSetting because rates change). Flat Rate Scheme businesses have separate config (e.g. 3% turnover flat).
- FR-GH-03: TIN validation: format check (GHA######### or ##########) on Business/Supplier/Customer TIN fields. (GRA TIN lookup API integration Stage 03.)
- FR-GH-04: Mobile Money receipt reference: when MoMo payment completes, the Merchant Transaction ID and Customer Transaction ID are stored on Payment.momo_ref and printed on receipt.
- FR-GH-05: Receipt footer includes a statement about return policy and the Ghana GPS address of the branch when available.

---

## 6. Non-Functional Requirements

### 6.1 Performance
- NFR-PERF-01: Single-terminal point-of-sale: barcode scan → cart item add roundtrip < 150ms (from IndexedDB, offline mode). Network lookup for latest price < 500ms (online mode, server on same LAN).
- NFR-PERF-02: 100,000 SKU catalog: product name fuzzy search returns top 20 hits < 250ms in IndexedDB.
- NFR-PERF-03: PostgreSQL query targets: invoice lookup by number < 20ms, stock on hand query by branch+sku < 10ms, end-of-day shift close < 2s (all aggregates).
- NFR-PERF-04: Support 20 concurrent POS terminals on a single modest LAN server (8 GB RAM, 4-core i5, SSD).

### 6.2 Reliability & Availability
- NFR-REL-01: Offline reliability: POS terminal remains fully operational for 7 days without server connectivity. After reconnect, all transactions sync within 2 minutes (500 pending sales volume).
- NFR-REL-02: Database corruption resistance: every sale write uses a database transaction with SET CONSTRAINTS IMMEDIATE. Sale + StockMovement + Payment are atomic; if any step fails, the entire transaction aborts.
- NFR-REL-03: Shift integrity: once a shift is closed, no new sales, payments, or cash drawer events may reference it.
- NFR-REL-04: Backup success rate: scheduled nightly backup must be verified (checksum + trial decrypt test). Backup failure triggers a red banner on all admin dashboards next login.

### 6.3 Scalability
- NFR-SCAL-01: Schema supports up to 10,000,000 StockMovement rows per Business (indexed by business_id + created_at) before partitioning is required.
- NFR-SCAL-02: Single Business supports 100 Branches / 200 Registers / 500 Users without schema change.

### 6.4 Maintainability
- NFR-MAINT-01: DRF backend + React frontend. All code organized by module/feature (not by technical layer alone).
- NFR-MAINT-02: Database migrations backward-compatible (additive migrations only between minor versions; destructive migrations require major version bump and documented upgrade path).
- NFR-MAINT-03: Backend and frontend log every error with structured JSON (Winston / Python structlog). Rotate logs 50 MB / file, keep 14 days.

### 6.5 Usability & Localization
- NFR-USA-01: UI text default en-GH. Currency formatting: `GH₵ 1,234.56` (space separator, comma thousands, dot decimal).
- NFR-USA-02: POS UI optimized for 10-inch touchscreen (800x480) up to 1080p desktop. Touch targets minimum 44x44 px.
- NFR-USA-03: Keyboard shortcuts for power cashiers: F2 = search, F4 = payment, F6 = hold sale, F7 = recall held, F8 = return/refund, F9 = customer, F10 = open drawer (no sale), F12 = print receipt.

---

## 7. Stage 01 Scope vs. Future Stages

### Stage 01 — Foundation & Core Retail (CURRENT SCOPE)
Deliverables:
- Single Business with multi-Branch / multi-Warehouse on one shared PostgreSQL instance
- Core catalog, inventory ledger, stock movements, transfers, counts
- POS terminal (offline-first IndexedDB, but no cloud sync)
- Sales, returns, refunds, split payments with Ghana payment methods
- Purchasing (PO, GR, Purchase Invoice, Supplier Payment)
- Lightweight double-entry accounting, expenses, manual journals, GRA VAT-report fields
- RBAC with 7 pre-seeded roles + custom permissions
- Cashier shifts, cash drawer logging
- Customer, loyalty, customer credit
- Medicine batch/expiry, device IMEI + warranty, repair tickets
- Audit log, in-app notifications, local backup with encryption
- Hardware: 58/80mm ESC/POS USB printer (USB + network IP), HID barcode scanner, cash drawer kick

### Stage 02 — Hospitality & Advanced
- Table management, dining options, restaurant menu modifiers, kitchen display system (KDS)
- Layaway / Hire Purchase (installment plans)
- SMS/Email receipts and low-stock alerts (Mnotify, Hubtel integration)
- Barcode label design + printing (A4 sheet / roll label printer)
- Multi-currency (USD/EUR) exchange for airports/duty-free
- GhIPSS QR / Instant Pay integration
- Direct MoMo API aggregator integration (e.g., Hubtel, Slydepay, Flutterwave)

### Stage 03 — Cloud Multi-Tenant & Platform
- Multi-tenant SaaS deployment (AWS/GCP, per-tenant or shared DB with strict RLS)
- TIN verification via GRA API, e-invoicing submission to GRA e-tax portal
- E-commerce web store + WooCommerce/Shopify product sync
- Customer-facing Android app (loyalty lookup, digital receipt, order history)
- Payroll & HR (payslip generation, tax table for Ghana PAYE, SSNIT deductions)
- Advanced analytics & BI dashboards (Metabase embedded)

### Stage 04 — Financial Ecosystem
- Bank integration (GCB, Ecobank, Absa) for statement auto-import and reconciliation
- Mobile Money merchant wallet auto-reconciliation
- Business credit scoring & embedded micro-loans (partner integrations)
- Supply chain: RFQ, supplier portal

### Out of Scope (All Stages Unless Revisited)
- ERP manufacturing / BOM / MRP
- HRIS beyond basic payroll
- Full GRA tax e-filing submission API (Stage 03 partial only)
- Cryptocurrency payments

---

## 8. Assumptions & Dependencies

### 8.1 Assumptions
- AS-01: End-user hardware runs Windows 10/11 Pro (x64) for the single-PC deployment model.
- AS-02: LAN terminals run modern Chromium-based browser (Chrome 120+ or Edge 120+); no Firefox/Safari support commitment in Stage 01.
- AS-03: Business has a dedicated person with basic IT literacy to perform backup restores and install updates.
- AS-04: Ghana VAT/NHIL/GETFund rates are known values stored in BusinessSettings; admin can update if budget readjusts.
- AS-05: MoMo payments in Stage 01 are "manual confirmation" (cashier confirms on their phone / MoMo app then marks as paid). Automatic callback integration is Stage 02.

### 8.2 Dependencies
- DP-01: PostgreSQL 14+ with pg_dump and pg_restore CLI utilities on the server.
- DP-02: Django 5.x LTS with DRF 3.15+, SimpleJWT, django-guardian (future for object-level perms if needed), django-auditlog (or custom).
- DP-03: Node.js 20.x LTS for React frontend build.
- DP-04: NSSM (Non-Sucking Service Manager) for Django runserver/gunicorn as Windows service OR Docker Desktop on server PC.

---

## 9. Success Criteria (Stage 01 Go-Live)

1. Unit test coverage: backend models & services ≥ 75%; frontend business logic ≥ 60%.
2. 50+ end-to-end manual test cases executed successfully (supermarket flow, pharmacy flow, phone shop flow).
3. 72-hour soak test: single POS terminal offline, 200+ sales created offline, reconnected, all sync'd with zero conflicts requiring manual intervention.
4. Shift close end-to-end: 100 sales, 5 payment methods, zero variance in shift report vs computed totals.
5. Backup: manual backup → new blank DB → restore → spot check 10 random invoices match before/after.
6. Access control: Cashier attempting price_override is denied 100% of the time without the permission.
7. StockMovement ledger integrity check query (sum of deltas per sku+branch vs inventory.qty_on_hand) returns 0 mismatches after full test suite.

---

## 10. Glossary

| Term | Definition |
|------|------------|
| GHS | Ghana Cedi, currency code GHS, symbol GH₵ |
| TIN | Taxpayer Identification Number issued by GRA |
| MoMo | Mobile Money: MTN MoMo, Telecel Cash, AirtelTigo Money |
| GRA | Ghana Revenue Authority |
| NHIL | National Health Insurance Levy (2.5% on vatable supplies as of 2024) |
| GETFund | Ghana Education Trust Fund (2.5% on vatable supplies as of 2024) |
| FEFO | First-Expired, First-Out (dispense oldest expiry first for medicines) |
| FIFO | First-In, First-Out inventory valuation |
| ESC/POS | Standard thermal printer command language |
| HID Wedge | Barcode scanner that appears as a USB keyboard |
| GR | Goods Receipt |
| PO | Purchase Order |
| SKU | Stock Keeping Unit |
| IMEI | International Mobile Equipment Identity (unique phone ID) |
| RBAC | Role-Based Access Control |
| DRF | Django REST Framework |
| IndexedDB | Browser local structured database used by frontend for offline storage |
