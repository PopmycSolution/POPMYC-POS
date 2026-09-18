# POPMYC Retail POS - Inventory Workflow & Principles

## Document Overview
- **Document ID**: POPMYC-INVWF-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04

---

## 1. Inventory Philosophy & Invariants

POPMYC's inventory subsystem is built around one non-negotiable principle:

> **The StockMovement ledger is the ONLY source of truth for stock quantities and values. All other tables are projections or caches derived deterministically from StockMovement rows.**

This means:
- `Inventory.qty_on_hand` is a **projection** — a denormalised cache — derived by summing `StockMovement.qty_delta` over `(business, variant, branch, warehouse)`.
- Any discrepancy between the projection and the aggregate of the ledger is a **P0 CRITICAL BUG**, not a data inconsistency "to fix later." A nightly check query validates this; a mismatch triggers alerts and freezes writes until investigated.
- StockMovement rows are **immutable after insert**: no UPDATE, no DELETE (except with dual-superuser emergency procedure that itself writes a new compensating StockMovement row plus a CRITICAL AuditLog entry).

### 1.1 Inventory Invariants (enforced by triggers + service checks)
Let `K = (business_id, product_variant_id, branch_id, warehouse_id)`.

1. **Non-negativity by default**:
   ```
   If BusinessSetting inventory.allow_negative_stock = false
     THEN (SELECT COALESCE(SUM(qty_delta),0) FROM stock_movements WHERE key=K) >= 0
   ```
   Checked via `DEFERRABLE INITIALLY IMMEDIATE` trigger per transaction commit, plus Inventory table constraint.
2. **Reservation invariant**:
   ```
   Inventory.qty_reserved >= 0
   Inventory.qty_on_hand  >= Inventory.qty_reserved   (cannot reserve more than on hand)
   ```
3. **Transit invariant**:
   ```
   For each StockTransfer(status IN (SENT, IN_TRANSIT)):
     sum(TRANSFER_OUT at src_wh) == sum(items.qty_sent)  (already written once on SEND)
     sum(TRANSFER_IN at dst_wh prior to complete) == 0 until receive event
     After RECEIVED: src_wh.qty_in_transit decreased by min(qty_sent, qty_received)
   ```
4. **Cost sum invariant (for Weighted Avg valuation)**:
   ```
   After every inbound movement, new_avg_cost computed;
     new_avg_cost = (old_on_hand * old_avg_cost + delta_qty * delta_unit_cost) / (old_on_hand + delta_qty)
     when delta_qty > 0
   ```
5. **Movement type sign convention (MUST NEVER BE BROKEN)**:
   | Movement class | Sign of qty_delta |
   |----------------|-------------------|
   | Stock enters this warehouse | POSITIVE (+) |
   | Stock leaves this warehouse | NEGATIVE (−) |

---

## 2. The 14 Stock Movement Types (Full List With Semantics)

POPMYC tracks 14 distinct movement types, each with its own accounting semantics, report grouping, and trigger side effects.

| # | movement_type | qty sign | Polymorphic Parent (ref_type + ref_id) | When Used |
|---|---------------|----------|-----------------------------------------|-----------|
| 1 | `OPENING_STOCK` | + | `OPENING_BALANCE` + none | Initial stock import from Excel during onboarding; opening balance for a new warehouse. |
| 2 | `PURCHASE_RECEIPT` | + | GoodsReceipt (GRN) | Goods received from a supplier via Purchase Order. Updates supplier metrics, weighted cost. |
| 3 | `SALE` | − | Sale (via SaleItem) | POS checkout or back-office credit sale. Triggers COGS journal; decreases qty_on_hand and reserved (if reservation model active). |
| 4 | `SALE_RETURN` | + | SaleReturn | Customer returns a sold item and it re-enters stock. Restock=false routes to DAMAGED instead. |
| 5 | `SUPPLIER_RETURN` | − | PurchaseReturn | Return to supplier due to defect / wrong item / expiry. Reduces AP. |
| 6 | `TRANSFER_OUT` | − | StockTransfer | Ship from source branch/warehouse; paired with TRANSFER_IN later on receive. |
| 7 | `TRANSFER_IN` | + | StockTransfer | Receive into destination branch/warehouse after transfer. |
| 8 | `STOCK_ADJUST_POS` | + | StockAdjustment (with reason FOUND / OVERAGE / COUNT+ ) | Manual increase (you found extra items not in system). |
| 9 | `STOCK_ADJUST_NEG` | − | StockAdjustment (reason WASTAGE / SHRINKAGE / INTERNAL_USE ) | Manual decrease (samples, staff use, small shrinkage). |
| 10 | `DAMAGED` | − | StockAdjustment (reason DAMAGED) | Write off because of water, breakage, spoilage. Creates Expense row → "Damaged Goods Write Off". |
| 11 | `EXPIRED` | − | medicine_batches.id (ref_type INVENTORY_JOB) | Scheduled nightly job or manual write-off. Sets MedicineBatch.status=EXPIRED. |
| 12 | `LOST_STOLEN` | − | StockAdjustment (reason LOST or STOLEN) | Requires incident description + optionally police report ref. AuditLog WARNING. |
| 13 | `COUNT_CORRECTION_POS` | + | StockCount | After stock count approved — positive variance (physical > system). |
| 14 | `COUNT_CORRECTION_NEG` | − | StockCount | After stock count approved — negative variance (system > physical). |

Auxiliary internal movement (visible in raw ledger, not in UI picker):
- 15 | `TRANSIT_ADJUST` | +/− pair | StockTransferItem (reason variance in transit) | Damaged/lost during transfer: write off the difference between sent and received qty.

### 2.1 StockMovement Table Row Anatomy

Each movement is a self-contained fact:

```
StockMovement row := {
  uuid,                         — public id for audit export
  business_id, branch_id, warehouse_id, product_variant_id,
  movement_type,                — one of 14 strings above (CHECK constraint)
  qty_delta,                    — signed NUMERIC(12,3)
  unit_cost_snapshot,           — DECIMAL(14,4) copy; never changes; used for weighted avg & COGS
  balance_after_qty,            — running qty ON HAND after this movement (reduces need for realtime SUM)
  balance_after_cost,           — avg unit cost AFTER this movement (for point-in-time valuation queries)
  medicine_batch_id?,           — link to batch
  imei_id?,                     — link to specific serial/IMEI unit
  reference_type?,              — string parent type
  reference_id?,                — bigint parent id
  note?,                        — human readable reason
  created_at,                   — when movement happened; not necessarily DB insert time (backdate entry allowed via approved StockAdjustment)
  created_by                    — user_id
}
```

**Balance_after fields**: These are "denormalised running totals." After any movement insert, the service layer re-selects the just-inserted row's two balance fields using:

```sql
WITH last_move AS (
  SELECT balance_after_qty, balance_after_cost
  FROM stock_movements
  WHERE business_id=$1 AND product_variant_id=$2 AND branch_id=$3 AND warehouse_id=$4
    AND created_at <= $5 AND id < $6   -- tiebreak by id for same timestamp
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
INSERT INTO stock_movements (..., balance_after_qty, balance_after_cost)
VALUES (...,
  COALESCE(last_move.balance_after_qty, 0) + $delta_qty,
  compute_weighted_avg(COALESCE(last_move.balance_after_qty, 0), COALESCE(last_move.balance_after_cost, 0), $delta_qty, $delta_cost)
) RETURNING *;
```
This allows "Inventory as of 2026-09-04 midnight" queries without re-summing millions of rows: simply pick the last balance_after_qty for each K before midnight.

---

## 3. FEFO / FIFO / Cost Layer Semantics

### 3.1 FEFO — First-Expired, First-Out
Applies to **medicine**, **cosmetics**, **food**, and any variant with `track_expiry=true`.

FEFO selection at POS sale time:
```
Given: variant, qty_required
SELECT batch_id, expiry_date, qty_available
FROM (
  SELECT b.id AS batch_id,
         b.expiry_date,
         LEAST(batch_on_hand.sum_delta, required) AS qty_available,
         ROW_NUMBER() OVER (ORDER BY expiry_date ASC, fe_priority ASC, id ASC) AS pick_order
  FROM   medicine_batches b
  JOIN  (
    SELECT   medicine_batch_id, SUM(qty_delta) AS sum_delta
    FROM     stock_movements
    WHERE    variant=$v AND branch=$b AND warehouse=$w AND medicine_batch_id IS NOT NULL
    GROUP BY medicine_batch_id
    HAVING   SUM(qty_delta) > 0
  ) batch_on_hand ON batch_on_hand.medicine_batch_id = b.id
  WHERE  b.product_variant_id = $v AND b.status='ACTIVE'
) pick_list
WHERE pick_order <= CEIL(qty_required / qty_per_batch_usually_one_for_medicine)
ORDER BY expiry_date ASC;
```

**FEFO enforcement rules**:
1. If the system finds a batch expiring ≤ 90 days and the qty on hand of newer batches ≥ sale qty, the cashier MAY override to newer batch, BUT this override is logged (AuditLog) and attributed — required to allow customers to intentionally pick a longer shelf life when offered.
2. If a batch has EXPIRED (status=EXPIRED or expiry_date < today()): UI renders line red "EXPIRED — DO NOT SELL"; hard block on sale unless pharmacist override + reason logged.

### 3.2 FIFO — First-In, First-Out (Inventory Valuation Method Option)
Valuation setting `BusinessSetting pricing.valuation_method = FIFO`.

At sale time, when computing COGS (for the JournalEntry Dr COGS / Cr Inventory), FIFO consumes the earliest inbound `PURCHASE_RECEIPT` layers first. FIFO cost layers are tracked in a separate `fifo_cost_layer` table (structure not required for Stage 01 if Weighted Average is the default; document it for future enablement):

```
fifo_cost_layer(id, variant_id, purchase_movement_id, unit_cost, qty_original, qty_remaining, created_at)
```
Each SALE movement decrements qty_remaining of the oldest layers with qty_remaining>0; writes a join row `sale_item_fifo_consumption(sale_item_id, fifo_layer_id, qty_consumed)` for auditability.

### 3.3 Weighted Average (Default / Stage 01 Only Required)
Setting `pricing.valuation_method = WEIGHTED_AVERAGE`.

Algorithm (runs inside StockMovement insert trigger/service):
```python
def apply_weighted_avg_movement(variant, branch, warehouse, delta_qty: Decimal, delta_unit_cost: Decimal):
    inv = Inventory.objects.select_for_update().get(
        variant=variant, branch=branch, warehouse=warehouse
    )
    old_qty = inv.qty_on_hand
    old_avg = inv.avg_unit_cost

    if delta_qty > 0:  # inbound movement
        new_qty = old_qty + delta_qty
        if new_qty == 0:
            new_avg = Decimal(0)
        else:
            new_avg = (old_qty * old_avg + delta_qty * delta_unit_cost) / new_qty
            new_avg = new_avg.quantize(Decimal("0.0001"))  # 4 decimal places for precision
    else:  # outbound movement
        new_qty = old_qty + delta_qty  # (delta_qty is negative; sum)
        new_avg = old_avg  # unchanged for outbound (carry avg)

    inv.qty_on_hand = new_qty
    inv.avg_unit_cost = new_avg
    inv.last_movement_at = now()
    inv.full_clean()
    inv.save()
    return (new_qty, new_avg)
```

**Ghana-specific accounting note**: Weighted Average (also known as AVCO) is an accepted cost formula per Ghanaian accounting standards (derived from IFRS IAS 2.25). The business owner chooses FIFO or AVCO during onboarding and — once set for the first financial year — changing it requires approval of the BusinessOwner and closing the prior year's books (AuditLog event with dual approval).

---

## 4. Reservation Model & Oversell Prevention

Stage 01 implements a **soft-reservation at POS add-to-cart** model with timeouts:

1. Cashier scans/adds an item with qty=3.
2. If `inventory.track_stock` true AND `allow_negative_stock=false`:
   - Backend (online mode): runs `SELECT ... FOR UPDATE SKIP LOCKED` on Inventory row.
     - If success → UPDATE Inventory SET qty_reserved = qty_reserved + requested_qty — returns OK + reservation_id (UUID) with TTL = 5 minutes.
   - Offline mode: locally decrement IndexedDB Inventory.qty_available **only in memory**; write "pending reservation" to cart. At sync time, server re-validates against real qty_on_hand − qty_reserved; if now insufficient → conflict, hold sale for manager review (cannot auto-complete that line; cashier either removes or requests oversell override).
3. Reservation release:
   - On complete sale → decrement qty_on_hand by 3, decrement qty_reserved by 3.
   - On remove-from-cart after < 5 min → release reservation.
   - TTL release job: every 2 min, scan reservations where created_at < now()−5min; release qty_reserved. Expired reservation ID rejected on complete-sale call.
4. Concurrent safety: Use `SELECT qty_on_hand, qty_reserved FROM inventory WHERE id=X FOR UPDATE SKIP LOCKED`; if two cashiers both try to grab last 1 unit, one SKIP LOCKED sees 0 available (because other session locked it), returns "Stock temporarily reserved for another till — try again in 2s or ask manager to oversell".

### 4.1 Oversell Flag
BusinessSetting `inventory.allow_negative_stock` global default + per-variant override:
- If global = false: default block.
- If global = true or per-variant override: allow Inventory.qty_on_hand to become negative; AuditLog every movement that takes it below 0 with "OVERSOLD by Cashier X".
- Pharmacies / device shops: default global = false and variant-override never allowed (cannot ship what you don't have; traceability requirements for NPA/FDB Ghana).

---

## 5. Stock Transfer Workflow (Send → In Transit → Receive)

Triggered from Back Office → Inventory → Stock Transfers (permission `stock.transfer.create`; cross-branch approval `stock.transfer.approve`).

### 5.1 Step 1: Create Transfer (DRAFT)
User fills:
```
From: Branch "Accra Mall" / Warehouse "Retail Stockroom"
To:   Branch "Kumasi Adum" / Warehouse "Back Store"
Items: [
  Variant "iPhone 15 256GB Blue", qty=5, wholesale_cost_snapshot=GH₵ 8,400.00
  Variant "Paracetamol 500mg x 1000", qty=20 cartons, FEFO batch B2026-0018
  Variant "Mayonnaise 750g", qty=48
]
Shipping: GIG Logistics, Waybill GIG-12345678, Expected delivery 2026-09-06
Freight cost allocation: GH₵ 350 (proportional to line value, added to unit landed cost of received items at destination — optional)
```
- Save → status DRAFT.

### 5.2 Step 2: Approve (if required)
If from_branch != to_branch AND current user.employee.branch != from_branch → needs approval from BranchManager of source branch:
- Click "Approve" → status REQUESTED → APPROVED.
- Approval permission-checked; AuditLog event.

### 5.3 Step 3: Mark Sent / Dispatch
Source warehouse physically packs, driver collects. Click **"Mark as SENT & Print Dispatch Note"**:
1. Service opens transaction:
   - For each transfer_item:
     a. Validate source Inventory qty_on_hand ≥ transfer_item.qty_sent (default = requested). Lock row FOR UPDATE.
     b. INSERT StockMovement(
          movement_type = 'TRANSFER_OUT', qty_delta = -qty_sent,
          unit_cost_snapshot = Inventory.avg_unit_cost,
          balance_after_qty / balance_after_cost via projection
        )
     c. UPDATE Inventory SET qty_on_hand = qty_on_hand − qty_sent, qty_in_transit = qty_in_transit + qty_sent.
     d. If batch-tracked → decrement medicine_batches linked qty (or just movement.batch_id).
     e. If IMEI-tracked → UPDATE imeis SET status='TRANSIT', warehouse_id = NULL, transfer_id = id.
2. status → SENT or IN_TRANSIT (shipped). sent_at = now(), shipped_by = current_user, shipping_method filled.
3. Print: Dispatch Note (3 copies: 1-Source warehouse file, 2-Driver, 3-Destination receive-in envelope).
4. Notification to destination BranchManager: "Transfer TRF-2026-00041 with 73 items dispatched from Accra → Kumasi, expected 2026-09-06".

### 5.4 Step 4: Receive at Destination (Goods-In Against Transfer)
Destination warehouse opens transfer → **Receive Items**:

1. Receive mode: Full Receive OR Partial Receive.
2. For each line:
   - Field "Qty received" (pre-filled = qty_sent; editable).
   - Field "Qty damaged during transit" → editable, optional (0 default).
   - For batch-tracked: Assign a new or existing batch at destination (batch auto-created from source batch_number + expiry copy).
   - For IMEI: Scan IMEIs physically received; system flags any IMEI not on the dispatch IMEI list as EXCEPTION.
3. Sum: `Qty received + Qty damaged + Qty lost = Qty sent` (else warn "Missing qty — investigate freight claim").
4. Press **"Post Receive"**:
   - Transaction:
     a. For each line where received > 0:
        - INSERT StockMovement(movement_type='TRANSFER_IN', qty_delta=+received, unit_cost_snapshot=source_unit_cost + proportional_freight_allocation).
        - Upsert Inventory at destination: qty_on_hand += received; recompute avg cost if weighted.
     b. For each line where damaged > 0 OR where sent != received (lost):
        - If lost/damaged: create StockAdjustment reason=TRANSIT_DAMAGE; writes STOCK_ADJUST_NEG at the destination **and** pair decrease qty_in_transit at source by appropriate amount.
     c. On source branch:
        - UPDATE Inventory SET qty_in_transit = qty_in_transit − min(qty_sent, qty_received + qty_damaged_marked_at_dest + qty_lost_confirmed_now).  (Only that which has been dispositioned is removed from in-transit.)
     d. Mark transfer status:
        - if all sent == all received (after any disposition): status = RECEIVED / COMPLETED
        - else status = PARTIALLY_RECEIVED → remains open until remaining arrives or freight claim resolves.
5. Print Goods Received Note (GRN vs Transfer): "Received 71 of 73 items; 2 damaged pending claim with GIG Logistics".
6. If stock value variance > GHS 500 due to damage/loss: system auto-creates a StockAdjustment (DAMAGED / LOST) and flags it requiring BranchManager or Owner approval.

### 5.5 Stock Transfer Return (Opposite Direction)
If wrong items shipped, "Return Transfer" action creates a **new reverse StockTransfer** (to_branch swaps with from_branch). It does NOT edit the existing transfer; keeps the history clean.

---

## 6. Stock Adjustment Workflow

Used for: broken eggs, sample use, staff consumption, found items in wrong bin, etc.
**Do NOT use adjustments for**: receiving/sales/returns/transfers/counts (each of those has its own movement type). Adjustments are an escape hatch; they always log a reason and (above threshold) require approval.

### 6.1 Create Adjustment
Back Office → Inventory → Stock Adjustments → New:
```
Branch/warehouse selector
Reference (optional): "Water pipe leak, aisle 3 — Sep 1"
Reason code dropdown:
  OVERAGE (Found extra stock) / WASTAGE / INTERNAL_USE / SHRINKAGE_UNKNOWN /
  DAMAGED / EXPIRED / LOST / STOLEN / QUALITY_CONTROL_FAIL / PEST / RECALL / OTHER
Items list:
  SKU search → Variant "Eggs (Big Dozen)",
    Current system qty: 56
    New qty after: 50  (→ delta = -6)
    OR: enter delta directly: -6
    Unit cost at current avg cost, editable by Accountant role if needs restating.
Attach photo (optional): camera upload of the damage.
```
Save → status DRAFT if requires approval, or directly POSTED if user has `stock.adjust.post` AND total value < threshold.

### 6.2 Approval Workflow
Threshold (BusinessSetting `inventory.adjust_approval_threshold_ghs`): default GHS 500.
- If abs(total_value_delta) > threshold → status = PENDING_APPROVAL. Notification sent to users with `stock.adjust.approve`.
- Approver opens → View line items + photos + reason → APPROVE (→ posts movement + inventory update) / REJECT (→ status REJECTED, no stock movement, saved for audit).
- Separation of duties: Adjustment created_by_id != approver_id UNLESS role BusinessOwner.

### 6.3 Post Effects
On status=POSTED (atomic):
- Write StockMovement rows: STOCK_ADJUST_POS / STOCK_ADJUST_NEG, STOCK_ADJUST_DAMAGED, LOST_STOLEN as appropriate.
- For reason DAMAGED, EXPIRED, LOST, STOLEN: create Expense (if Accountant role) posting Dr Inventory Write-Off Expense, Cr Inventory Asset (JournalEntry).
- LOST_STOLEN: AuditLog WARNING entry; incident_number text field saved.
- STOLEN > GHS 2,000: in-app notification to all BusinessOwners.

---

## 7. Stock Count (Physical Count / Cycle Count)

POPMYC supports full warehouse counts, per-category counts, per-Aisle/Zone scheduled counts (cycle counting).

### 7.1 Stock Count Types
| Type | Frequency Example | Use Case |
|------|-------------------|----------|
| **Full Count** | Annual / end-of-financial-year | All items in warehouse; mandatory before publishing annual balance sheet |
| **Warehouse Count** | Quarterly | Single warehouse only |
| **Cycle Count (ABC)** | Weekly A-category, Bi-weekly B, Monthly C | Pareto: A = top 20% SKUs by value (high-value electronics/pharmaceuticals) |
| **Category Count** | Monthly e.g. "All cosmetics" | |

### 7.2 Count Lifecycle
```
 SCHEDULED → IN_PROGRESS → PENDING_APPROVAL → (if recount needed)
                                           ↘ (if OK) → APPROVED → movements written
                                           ↘ → REJECTED → back to IN_PROGRESS recount
```
1. **Scheduled**: Back Office creates count, assigns warehouses/categories, counters (employees).
2. **Start Count**: Button "Start Blind Count" → system hides expected_qty from counter; they enter ONLY counted_quantity based on physical floor. Barcode scanner workflow: scan SKU → pop qty field → enter + enter (repeat blind; no peeking at system).
3. **Save → Recount option**: After first pass, StockCountItem lines where abs(variance_pct) > threshold (e.g. 5%) OR abs(variance_value) > GHS 200 → auto-flagged Recount Required; assign second counter independent to re-count those SKUs only.
4. **Pending Approval**: All variance > threshold resolved, manager reviews summary:
   ```
   Total lines: 486
   Matched exactly: 392
   Variance < threshold and accepted: 84
   Variance > threshold and recounted: 10
     OVERAGE total value: + GH₵ 342.20 (mostly stationery miscounts)
     SHORTAGE total value: - GH₵ 1,212.80  ← Investigate top contributors:
       iPhone 15 256GB qty_expected 25 qty_counted 24 (-1, -GH₵ 8,400?? — wait recalculated: recounted, corrected to 25)
       Vaseline Intensive Care 400ml (-144 pcs, -GH₵ 1,872 — suspected shoplifting; LOST_STOLEN to be split out manually afterwards)
   ```
5. **Approve & Post**:
   - Transactional atomic: For each StockCountItem with variance != 0:
     - INSERT StockMovement(COUNT_CORRECTION_POS or COUNT_CORRECTION_NEG)
     - UPDATE Inventory qty_on_hand accordingly
     - Write AuditLog with before/after qty and variance value
   - Send summary PDF to Accountant for end-of-month adjustment journals.
6. **Snapshot for Audit**: Export StockCount + all items to PDF + CSV, stored in /media/audits/ (immutable once approved).

---

## 8. Expiry Tracking & Batch Management (Pharmacy/Food Focused)

### 8.1 Expiry Alert Regime
BusinessSetting overrides default alert levels; default:
```
┌──────────────────────────────────────────────────────────────┐
│ business_settings                                            │
├──────────────────────────────────────────────────────────────┤
│ inventory.expiry.warn_90d  = true   (notify 90 days before)  │
│ inventory.expiry.warn_30d  = true                            │
│ inventory.expiry.warn_7d   = true                            │
│ inventory.expiry.auto_writeoff_past = true                   │
│ inventory.expiry.auto_writeoff_future_months = 0 (disabled)  │
└──────────────────────────────────────────────────────────────┘
```
- Nightly scheduled job (02:30 AM, after backup):
  1. `SELECT * FROM medicine_batches WHERE status='ACTIVE' AND expiry_date BETWEEN today AND today+90d`
     - Group by 90/30/7-day buckets.
     - Create Notification records for StockController role + BranchManager.
     - If product is RESTRICTED/Rx: additionally email Pharmacist.
  2. `SELECT * FROM medicine_batches WHERE status='ACTIVE' AND expiry_date < today()`
     - If auto_writeoff_past=true:
       a. For each batch with remaining qty_on_hand > 0:
          - StockMovement.EXPIRED rows (qty_delta = remaining qty with sign −), cost snapshot = avg cost.
          - Update Inventory qty_on_hand → decr, recompute if needed.
          - Set status medicine_batches = EXPIRED.
       b. Journal entries Dr Expired Stock Expense, Cr Inventory (automatic).
       c. CRITICAL Notification to Pharmacist.
       d. Generate PDF: "Expired Batch Write-Off Report — 2026-09-04" for FDB/NPA inspection.

### 8.2 FEFO Dispense Enforcement Audit
All movements movement_type=SALE with medicine_batch_id NOT NULL → row stores batch_id. Periodic report (monthly):
"Percentage of sales where batch picked was NOT oldest-expirable available". If > 15% for pharmacy → warn and assign training. Required for good pharmacy practice inspections.

---

## 9. Low-Stock / Reorder Alerts

### 9.1 Alert Generation
- Nightly job: `SELECT * FROM inventory WHERE track_stock=true AND qty_on_hand + qty_in_transit < COALESCE(variant.reorder_level_override, product.reorder_level)`.
- Generate Notification per product; group digest email "7 low-stock items, 3 at critical level" to StockController daily at 08:00.
- Critical threshold: `qty_on_hand < reorder_level * 0.25` → red dashboard widget + SMS to BranchManager.

### 9.2 Suggested PO Generation (Auto-Reorder)
Future Stage 02 helper: "Generate Suggested Purchase Order(s)" for low-stock variants → sums recommended qty = EOQ (Economic Order Quantity model: `EOQ = sqrt(2 D S / H)`) → group by preferred ProductSupplier → creates PO drafts (unposted) for review.

---

## 10. Inventory Reconciliation: Nightly Health Check Job

At 03:00 AM each day, PostgreSQL PL/pgSQL function `sp_integrity_check_inventory()` runs:

```sql
-- Step 1: Compute expected per K from ledger
CREATE TEMP TABLE expected_inv AS
SELECT business_id, product_variant_id, branch_id, warehouse_id,
       SUM(qty_delta)                                          AS expected_qty,
       COUNT(*)                                                AS movement_count,
       MAX(balance_after_qty)                                  AS last_balance_after
FROM   stock_movements
GROUP BY 1,2,3,4;

-- Step 2: Compare with projection table
SELECT
  i.*,
  e.expected_qty,
  e.movement_count,
  (i.qty_on_hand - e.expected_qty) AS drift_amount,
  CASE WHEN ABS(i.qty_on_hand - e.expected_qty) > 1e-4 THEN 'MISMATCH' ELSE 'OK' END AS status
FROM inventory i
FULL OUTER JOIN expected_inv e
  USING (business_id, product_variant_id, branch_id, warehouse_id)
WHERE ABS(i.qty_on_hand - e.expected_qty) > 1e-4   -- tolerance for NUMERIC rounding
   OR e.business_id IS NULL    -- inventory row but no movements?
   OR i.business_id IS NULL;   -- movements exist but no inventory row yet
```
If any row returned with status MISMATCH:
1. Writes AuditLog ERROR with full JSON of mismatched rows.
2. Creates backup of the Inventory table as `inventory_snapshot_20260904_pre_repair`.
3. Notification: SUPER_ADMIN + BusinessOwner.
4. Optional auto-repair (disabled by default; enable only in BusinessSetting `inventory.auto_repair_projection_from_ledger=true`):
   - TRUNCATE inventory; re-INSERT from aggregate of StockMovement balance_after or recomputed SUMs. If auto-repair runs, CRITICAL audit log + email of all affected rows.
5. Blocks POS writes at affected branches until owner confirms.

This job is the single best regression test for any new feature that writes to StockMovement. Any buggy movement writer will be caught within 24 hours.

---

## 11. Inventory Valuation Reports (Ghana FDB / GRA Audit Ready)

Every inventory valuation report (printed PDF) includes:
```
COMPANY HEADER
  (BusinessName, TIN, Address)
Report Title: INVENTORY VALUATION REPORT AS AT 2026-09-04
Valuation Method: WEIGHTED AVERAGE (or FIFO)
Total SKUs: 1,245
Total Quantity on Hand: 18,200 units

TABLE
  Category
  SKU | Product / Variant | Batch (if any) | Expiry (if any) | QOH | Unit Cost (GHS) | Ext Value (GHS)
  -----
  1,245 lines…

SUMMARY BY CATEGORY:
  Phamaceuticals:  GH₵ 142,800.00
  Electronics:     GH₵ 312,400.00
  Cosmetics:       GH₵  38,200.00
  FMCG:            GH₵  84,100.00
  GRAND TOTAL:     GH₵ 577,500.00

Page X of Y  |  Report Generated At: 2026-09-05 08:01 by user_id=34
Printed sequentially numbered report id: RPT-IVAL-2026-09-04-000123
```

Features:
- Signed by: `Prepared by: _____________ (StockController)`, `Reviewed by: _____________ (Accountant)`, `Approved by: _____________ (BusinessOwner/CEO)`.
- PDF version digitally time-stamped (future Stage 02) for GRA audit admissibility.
- Filter options: per branch, per warehouse, per category, "Zero-value lines hide/show", "Show batches older than 6 months".

---

## 12. Inventory-Related Access Control Summary

| Permission Codename | Typical Role | Scope |
|---------------------|--------------|-------|
| `inventory.view` | Cashier (read only on-hand lookup), StockController, Accountant | Read-only stock on-hand at own branch (Cashier); all branches (StockController+) |
| `inventory.view_costs` | Accountant, BusinessOwner, StockController (configurable option) | Visibility of unit cost columns; Cashier never sees costs |
| `stock.adjust` | StockController | Create StockAdjustment DRAFT; auto-post below threshold |
| `stock.adjust.approve` | BranchManager, BusinessOwner, Accountant | Approve adjustments above GHS 500 |
| `stock.transfer.create` | StockController, BranchManager | Create/send transfers |
| `stock.transfer.receive` | StockController at receiving branch | Receive transfers (cannot send/receive same branch without approval) |
| `stock.transfer.approve` | BranchManager (source branch only) | Approve outbound cross-branch transfers |
| `stock.count.create` | StockController | Schedule counts |
| `stock.count.enter_counts` | Counter employee | Enter physical quantities (blind or visible) |
| `stock.count.approve` | BranchManager + Accountant dual | Approve final count before posting movement |
| `stock.write_off_batch_expired` | Pharmacist + Accountant dual | Manual batch expiry write-off if auto-writeoff disabled |
| `inventory.repair_projection` | SUPER_ADMIN only | Run emergency inventory rebuild from ledger |

---

## 13. Inventory Test Oracle (Reference For QA)

QA uses these algorithms in tests to assert the system computes correctly:

```python
def expected_balance_after_movements(variant, branch, warehouse, movements_after_sort_in_creation_order):
    qty = 0
    avg_cost = Decimal(0)
    for m in movements_after_sort_in_creation_order:
        if m.qty_delta > 0:
            qty += m.qty_delta
            prev_total = (qty - m.qty_delta) * avg_cost
            avg_cost = (prev_total + m.qty_delta * m.unit_cost_snapshot) / qty
        else:
            qty += m.qty_delta  # (m negative)
            # avg_cost unchanged
    return qty, avg_cost

def expected_inventory_report_rows(report_parameters):
    # re-sum from StockMovement to verify Inventory table independently
```
All tests compare both channels (Inventory table read vs ad-hoc StockMovement aggregate). See TESTING_STRATEGY.md §Critical Test Areas for the full inventory matrix.
