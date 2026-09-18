# POPMYC Retail POS - POS Transaction Workflow

## Document Overview
- **Document ID**: POPMYC-POSWF-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04

---

## 1. Workflow Scope & Objectives

This document defines the end-to-end business process flow executed on the POPMYC POS terminal application — from cashier authentication through sale completion, receipt printing, and shift close. It includes edge cases: held sales, returns, refunds, price overrides, split payments, and failed network scenarios.

The POS terminal UI is a React TypeScript SPA optimized for 10" touch 1024×768 up to 1080p desktop keyboard/mouse. It runs in two operational modes:

- **Online mode** (server reachable over LAN): Stock lookups, price lookups, customer lookups all hit server first (with 300 ms timeout); on timeout, fall back to local IndexedDB snapshot.
- **Offline mode** (server unreachable, detected by 3 consecutive failed health checks at 5 s intervals): All reads come from IndexedDB; all writes are queued locally. The cashier sees a persistent orange banner: **"OFFLINE — Local storage active. Your changes will sync automatically when the server returns."**

Every flow in this document is valid in BOTH modes unless explicitly marked "online only."

---

## 2. POS State Machine (High-Level View)

The Zustand store `posStore.ts` exposes a state machine:

```
┌───────────┐  valid login+2FA?   ┌──────────────┐  select branch/register & open shift
│  LOGIN    │────────────────────►│  POST_LOGIN  │───────────────────────────────────────┐
│ (PASSWORD)│                     │  BRANCH/REG  │                                       │
└───────────┘                     └──────┬───────┘                                       │
                                         │ select register without shift?                │
                                         │                                               ▼
                                         │                                     ┌────────────────┐
                                         │                                     │ OPEN SHIFT UI  │
                                         └────────────────────────────────────►│ enter float    │
                                                                               │ confirm drawer │
                                                                               └───────┬────────┘
                                                                                       │ shift OPEN
                                                                                       ▼
                                                                              ┌────────────────┐
                                                                              │   POS EMPTY    │
                                                                              │   CART = []    │◄──────────────────────────┐
                                                                              └───────┬────────┘                           │
                                                                                      │                                    │
                                                                          ┌───────────┼───────────┐                        │
                                                                          ▼           ▼           ▼                        │
                                                                  scan/add item   F4 payment   F6 hold sale                  │
                                                                          │           │           │                        │
                                                                          ▼           │           ▼                        │
                                                                  ┌─────────────┐    │    ┌────────────┐ recall F7          │
                                                                  │ CART FILLED │    │    │ HELD SALES │────────────────────┘
                                                                  └──────┬──────┘    │    └────────────┘ convert HELD→SALE
                                                                         │           │
                                                          qty edit/price override/    │
                                                          customer attach/discount/   │
                                                          note edit/delete line       │
                                                                         │           │
                                                                         ▼           ▼
                                                                  ┌──────────────────────────┐
                                                                  │    SALE COMPLETE (atomic)│
                                                                  │  validate qty/payments   │
                                                                  │  persist locally first   │
                                                                  └──────────────┬───────────┘
                                                                                 │
                                                             ┌───────────────────┴─────────────────────┐
                                                             ▼                                         ▼
                                                  ┌──────────────────────┐                    ┌──────────────────┐
                                                  │ PRINT RECEIPT PIPE   │                    │ SYNC TO SERVER    │
                                                  │ ESC/POS → printer(s) │                    │ (online immediate │
                                                  │ + open cash drawer   │                    │  offline enqueue) │
                                                  └──────────────────────┘                    └─────────┬────────┘
                                                                                                         │
                                                                                                         ▼
                                                                                      ┌──────────────────────────────┐
                                                                                      │ END OF DAY / HANDOVER →      │
                                                                                      │ F3 → CLOSE SHIFT, recount    │
                                                                                      │ drawer, confirm variance,    │
                                                                                      │ print Z-report               │
                                                                                      └──────────────────────────────┘

Error / Exception states (anywhere):
  [NETWORK_DOWN] → banner + switch to offline mode (automatic)
  [STOCK_INSUFFICIENT] → inline warning on cart line; if BusinessSetting allow_negative=false → block Complete
  [PERMISSION_DENIED] → inline modal: "Requires Manager override", swipe Manager card / enter Manager PIN
  [PRINTER_DOWN] → re-queue receipt to retry + allow print later
```

---

## 3. Step-by-Step: Cashier Onboarding → Shift Open

### 3.1 Login Screen
1. Boot till PC → Chrome kiosk-mode auto-launches to `https://popmyc.local/pos/login`.
2. Fields:
   - **Username**: phone or email (autocomplete OFF).
   - **Password**: masked input; "Show" toggle with 3 s timeout.
   - **Branch** dropdown (only visible if user is assigned to >1 branches, filtered by user.employee.allowed_branches[]).
   - **Register/Till** dropdown (once branch selected).
3. Click "Sign In" or press Enter.
4. Rules:
   - 5 failed password attempts → 10-min IP/user lockout, message "Account temporarily locked. See BranchManager."
   - If TOTP required for that user → second screen "Enter 6-digit code from Authenticator app".
5. On success → POST_LOGIN / SESSION INIT state.

### 3.2 Post-Login: Shift Selection / Open Shift
Backend checks:
- Does selected `register_id` currently have an **open shift**? Fetch via:
  ```
  SELECT s.* FROM shifts s
  WHERE s.register_id = $1 AND s.status = 'OPEN'
  ORDER BY s.open_time DESC LIMIT 1;
  ```
- **Case A (existing open shift for current cashier)**: e.g. yesterday's shift was NEVER closed, or same cashier resumed. Modal:
  > An open shift exists on Till T1 opened by you at {time}.
  > - [Resume shift] — keep using same shift ID (recommended).
  > - [Force-close previous & open new] — requires `shift.force_close` permission. Previous shift is marked status=CLOSED with closing_cash_counted = closing_cash_expected and a variance note "Force-closed by {user}".
- **Case B (no open shift)**: Show Open Shift modal.
  - Open Shift fields:
    - Cashier (pre-filled, read-only, employee.full_name).
    - Opening Float in GH₵: default 500.00 (configurable BusinessSetting `pos.default_opening_float_ghs`).
    - Denomination breakdown (optional, expanded on "+"): 1×200, 2×100, 5×20, … totals auto-sum → sum must equal opening float declared; warns on mismatch → allows override if non-cash.
    - Attach camera photo of opening float cash (optional, permission gated).
    - Button "Confirm & Open Drawer" → triggers hardware `kickDrawer()`.
  - After confirm:
    - POST `/api/v1/shifts/open` (idempotency-key = login session + register_id).
    - Response: shift object { id, open_time, opening_float, status: OPEN }.
    - Zustand: `posStore.setActiveShift(shift)`.
    - Header shows: "Branch: Accra Mall | Till: T1 | Cashier: Ama K. | Shift #SH-2026-00123" — orange if offline mode, green online.
    - Navigation drawer + cart panel become active.

---

## 4. Product Lookup, Cart Composition, Line Edits

### 4.1 Product Search & Scan
Top of screen = search box auto-focused. Inputs accepted:
1. **HID Barcode Scanner (wedge)**: Scanner outputs barcode digits + carriage return → React catches Enter in search → immediate `addToCart(barcode=input)`. No click required. Scanner mode indicator 🔵 shows in search box.
2. **Manual SKU/name search**: As user types 3+ chars → debounced 150 ms IndexedDB fuzzy search (Dexie + Fuse.js) returns top 20 matches, grouped by category. Result tile shows thumbnail, name, SKU, price, qty available (green if > 5, yellow ≤ 5, red 0). Click tile or use arrow keys + Enter to add.
3. **Category browse**: Left sidebar tile grid. Click category → filtered product list to right; nested sub-category breadcrumb.
4. **Open item ("+ Quick Item")**: Tile for non-coded items, e.g. "Bag" 0.50, "Delivery fee" 15.00 → auto-created as product(type=SERVICE, track_stock=false) on first use. Requires permission `pos.open_item_create`.

Add-to-cart flow (function `addLineToCart(variantId, qty, batchId?, imeiId?)`):
1. Look up product_variant + active price list for customer group in IndexedDB.
2. If variant is **batch-tracked / medicine**:
   - Fetch FEFO-sorted batches for (variant, warehouse).
   - Auto-pick soonest expiry batch (top).
   - OR modal prompts cashier "Pick batch: [B2026-001 Exp:2027-03, QOH: 120 / B2026-040 Exp:2026-11, QOH: 80]".
3. If variant is **IMEI/serial-tracked (phone/device)**:
   - Modal "Scan/Enter IMEI" with IMEI1 + IMEI2 + serial fields, validate checksum (Luhn for IMEI-14/15).
   - Auto-fetch from `imeis` table where status = INSTOCK and warehouse matches → show matches list with condition grade (NEW/OPEN_BOX …).
   - On pick, bind IMEI row to cart line; mark status = RESERVED locally.
4. Apply business rule: Check current cart qty of variant + qty incoming vs local inventory `qty_available`.
   - If insufficient AND BusinessSetting `inventory.allow_negative_stock = false`: Inline toast "Stock insufficient. System reports only 3 available at this branch." Do not add line. Option "Request manager override" → modal prompts Manager PIN → if success, add anyway, tag line `OVER_SOLD=true`.
5. Append SaleItemRow to Zustand `cart.lines[]`. Each row: `{rowId (uuid), variantId, skuSnapshot, nameSnapshot, qty, unitId, basePriceIncl, unitPriceIncl, unitPriceExcl, costPriceSnapshot, lineDiscountPct, lineDiscountAmt, taxableAmt, taxAmtTotal, taxesBreakdown:{VAT:x,NHIL:y,GETFund:z}, restockableSnapshot, batchId?, imeiId?, kitchenNote, prescriptionId, oversoldFlag, priceOverrideFlag }`.
6. Keyboard shortcut after add: focus returns to search box (ready for next scan). F2 anytime focuses search.

### 4.2 Cart Line Edit Operations
Click a line in the left cart panel → popover **Row actions**:
1. **Quantity (+ / − / keypad)**. Shortcut: Select line → type digits = new qty (0 removes line). Fractional allowed only if unit.allow_fractional=true (KG/L).
2. **Remove line**: Trash icon or press Delete. Permission: `sale.delete_line_after_n_seconds` — if line added more than 60 s ago, records the delete in AuditLog (reason: DeletedByCashier, note).
3. **Discount per line**: % or flat GH₵. Default max per line: Cashier 10%. If Cashier enters 15% → **Permission Gate 1**:
   - Modal: "Discount 15% exceeds Cashier limit of 10%. Manager override required." Fields: Manager PIN / Manager RFID badge scan (future).
   - BranchManager or above has PIN → PIN validated server-side (or locally against cached PIN hash if offline). If OK → line.lineDiscountPct = 15%; stamped with `override_by_user_id`. Locally records audit diff.
4. **Unit price override**: Click unit price cell → edit. **Permission Gate 2**: `sale.price_override`. Requires same Manager override flow.
5. **Line note / Kitchen remark**: For restaurants, free-text e.g. "No ice, extra hot pepper". Stored as line.kitchenNote.
6. **Tax toggle (Exempt)**: Click "Taxable" → dropdown "Exempt (zero-tax) / VAT-only / Standard". **Permission Gate 3**: `sale.tax_exempt` (e.g. diplomatic customers, NHIS-exempt prescription items). Must input "Exemption certificate number" text if toggled (logged).

### 4.3 Order-Level Discounts
Right side of totals card → "Add Discount" button:
- Inputs: Discount type: % or flat GH₵. Value: numeric.
- Applies proportionally across all lines to preserve per-line tax math correctly: `line.discount += (lineTotal / subtotal) * discountTotal`.
- Gate same as per-line — if % > Cashier limit, manager override required.

### 4.4 Attach Customer
Button "Customer (F9)" or F9:
- Open modal: Search customer by phone number (fastest, Ghana standard) → type `024` → live filtered list. "+ New customer" inline mini-form: Phone required, name optional.
- If selected customer belongs to CustomerGroup:
  - Apply group-specific price list (re-fetch line prices from `product_prices` for that group's `price_list_code`).
  - Apply group order-level discount percentage (stacks with manual discounts additive; flags compound discount if > 25% for log).
- If customer has **customer credit balance** (they have prepaid): payment option "Customer Credit" is auto-suggested with balance display.
- If customer has loyalty account → preview estimated points earn: "You will earn 345 points on this sale (balance after: 18,240 pts)".

---

## 5. Payment Flow (F4 → Complete Sale)

Click **"Complete / Pay (F4)"** or press F4 → Payment Modal.

### 5.1 Payment Modal Layout
```
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ Invoice #INV-2026-001423              Customer: Kweku A.  (+233 24 123 4567)│
 ├────────────────────────────────────────────────────────────────────────────┤
 │ Items 12  Subtotal GH₵ 420.00  Disc GH₵ 21.00  VAT GH₵ 54.41              │
 │ NHIL GH₵ 9.07  GETFund GH₵ 9.07               Round GH₵ 0.00              │
 │ TOTAL INCL. TAX  GH₵ 479.55                                 CHANGE GH₵ 0.00│
 ├───────────────────────────────┬────────────────────────────────────────────┤
 │   PAYMENT METHODS            │  AMOUNT BREAKDOWN (split)                   │
 │  ┌────────────┐  ┌────────┐  │  #  Method       Reference     Amount      │
 │  │   CASH     │  │MTN MoMo│  │  1  Cash                      GH₵ 200.00 ✕ │
 │  │  GH₵ 200   │  │GH₵ 179.│  │  2  MTN MoMo   024…678      GH₵ 179.55 ✕ │
 │  └────────────┘  └────────┘  │  3  Telecel …  +              GH₵ 100.00 ✕ │
 │  ┌────────────┐  ┌────────┐  │                              ───────────── │
 │  │ Telecel    │  │AT MoMo │  │  Remaining:                  GH₵ 0.00      │
 │  │ Cash       │  │ Card   │  │  Paid:                        GH₵ 479.55   │
 │  └────────────┘  └────────┘  ├────────────────────────────────────────────┤
 │  ┌────────────┐  ┌────────┐  │  Tip: [GH₵ 0.00  ▲▼  5% 10% 15% Custom ]  │
 │  │ Bank Trf   │  │GhipssQR│  │                                            │
 │  └────────────┘  └────────┘  │  [ Use Customer Credit (balance GH₵ 1,240)]│
 │  ┌────────────┐              │  [ Print Receipt?  ✅   Copies: 1 ]         │
 │  │ Cheque     │              │  [ Email Receipt? ☐  SMS Receipt?  ☐ ]     │
 │  └────────────┘              │                                            │
 │                               │  [Cancel]         [CONFIRM & FINISH (F12)] │
 │                               └────────────────────────────────────────────┘
```

### 5.2 Split Payment Algorithm (Backend Service + Frontend Match)
Rules implemented identically in front (validation UX) and back (enforcement):

Let `Total = T = 479.55`.
Payments array = `[P1, P2, … Pn]`.
Each payment `Pi = { method_id, amount, reference?, status, customer_phone? }`.

**Frontend rules**:
1. Click method tile → auto-fills `Pi.amount = T - sum(Pi…i-1)` (the remainder). Cashier may override Pi.amount to partial; remaining re-calculates.
2. If method = CASH and Pi.amount > remaining:
   - Excess becomes CHANGE = Pi.amount - remaining.
   - CHANGE line appears at bottom of breakdown.
   - Backend may produce additional cash drawer open event (because money taken + change given).
3. If method = MOBILE_MONEY (MTN_MOMO / TELECEL_CASH / AIRTELTIGO):
   - Pi.amount input auto-set; if overridden to 0, remove.
   - Secondary field: `Customer Phone Number` (required). Validated against prefix ranges in payment_methods.network_prefixes_json for that method. If user enters 020 for MTN → auto-corrects method to Telecel Cash + warns.
4. If method = CUSTOMER_CREDIT:
   - Pi.amount min 0, max = min( remaining, customer.credit_limit_remaining + current_balance_available_credit ).
   - If exceeds → toast "Insufficient customer credit balance (remaining GH₵ X). Top up or use another method."
5. **Closeout rule**: Final array must satisfy:
   - `sum(Pi.amount for Pi in Pay) >= T` (shortfall → block, show red "Remaining GH₵ X").
   - `sum(Pi.amount where method not change-eligible) <= T` (cannot overpay on MoMo — cash is the change eligible method only).
   - Each method's min/max_amount respected (e.g. CARD min GH₵ 1, max GH₵ 10,000; MoMo max GH₵ 2,000 per network limits).
6. **Tip**: If tip > 0, append to total BEFORE split math recalc, or — if user enters tip after methods — ask "Distribute tip across methods?" or "Add tip to last method selected."

### 5.3 Mobile Money Sub-flow (Stage 01 = Manual Confirm, Stage 02 = Aggregator)
Click MTN MoMo → input customer phone `0241234567`, amount GH₵ 179.55 → click "Send Request" (online) / "Mark as Pending" (offline).
- **Stage 01 manual**:
  1. POST `/api/v1/payments/momo/initiate` → returns gateway response `status: PENDING` + `gateway_poll_token`.
  2. Modal shows:
     > Request sent to MTN MoMo wallet +233 24 123 4567
     > GH₵ 179.55 — Merchant: MYSHOP (Merchant ID: M12345678)
     > Ask customer to approve on their phone…
     > Countdown timer: 02:00 (auto-fail after)
     > Buttons: [I have confirmed the payment completed] / [Cancel / payment failed]
  3. Cashier confirms on own MoMo handset that funds arrived → ticks confirmed → status Pi.status = COMPLETED.
  4. If timeout after 2 min → Pi.status = TIMED_OUT; remove payment method line or retry.
- **Stage 02 with API**: Backend calls Hubtel SDK → push USSD prompt to customer phone. Polls every 5 s via background job. Auto-updates Pi.status to COMPLETED on callback. Frontend listens to local event stream (companion service SSE + HTTP polling) and greys out payment tile during pending.
- **Offline mode**: MoMo payment stored in Queue with status PENDING. When sync returns online, server initiates payment (if gateway configured); if manual-only mode, cashier must re-confirm once online by opening the sale details → "Confirm MoMo".

### 5.4 Final Atomic Commit
When user clicks **CONFIRM & FINISH (F12)** → `completeSale()` orchestrator function runs:

```typescript
async function completeSale(cart: Cart, payments: PaymentInput[], meta: SaleMeta): Promise<Sale | SaleError> {
  // ========== PHASE A: LOCAL VALIDATION ==========
  const totals = recalculateTotalsFromLines(cart.lines); // NEVER trust cached totals
  if (Math.abs(totals.totalInclPesewas - sumPaymentAmountsPesewas(payments)) > 1 /* pesewa tolerance */)
    return { kind: 'PAYMENT_MISMATCH', detail: 'Payments do not sum to total. Re-verify.' }

  for (const line of cart.lines) {
    if (!line.variantId) return { kind: 'INVALID_CART', line };
    const inventory = await IndexedDB.inventory.get([line.variantId, activeBranchId, activeWarehouseId]);
    if (inventory && !inventory.allowNegative && (inventory.qtyAvailable - line.qty) < 0 && !line.oversoldFlag)
      return { kind: 'INSUFFICIENT_STOCK', line, available: inventory.qtyAvailable };
    if (line.priceOverrideFlag && !meta.overrides.byUserId(line.rowId))
      return { kind: 'OVERRIDE_WITHOUT_APPROVAL', line };
  }

  // ========== PHASE B: PREPARE IMMUTABLE RECORDS FOR STORAGE ==========
  const saleUuid = crypto.randomUUID(); // client-generated; used as sync idempotency key
  const invoiceNumber = nextInvoiceNumberFromLocalCounter(); // local, server will reassign if gapless conflict

  const stagedSale = {
    uuid: saleUuid,
    businessId: userCtx.businessId,
    branchId: activeBranchId,
    registerId: activeRegisterId,
    shiftId: activeShiftId,
    cashierId: employeeId,
    customerId: cart.customerId ?? null,
    saleType: cart.saleType,
    diningOption: cart.diningOption ?? 'NOT_APPLICABLE',
    invoiceNumber, // provisional; server may overwrite with gapless
    lines: cart.lines.map(l => serialiseSaleLine(l)),
    taxes: aggregateTaxesFromLines(cart.lines),
    payments: payments.map(p => ({ ...p, status: (onlineMode ? p.status : 'PENDING_LOCAL') })),
    discounts: [...cart.lineDiscounts, ...cart.orderDiscounts],
    totals,
    createdAt: new Date().toISOString(),
    offlineUuid: onlineMode ? null : saleUuid,
    idempotencyKey: `${userCtx.sessionUuid}-${saleUuid}`,
  };

  // ========== PHASE C: DURABLE LOCAL WRITE FIRST (OFFLINE GUARANTEE) ==========
  const tx = IndexedDB.db.transaction(
    ['sales','saleItems','saleTaxes','saleDiscounts','payments','inventory','stockMovements','syncQueue','heldSales'],
    'readwrite'
  );
  try {
    await tx.sales.put(withoutLines(stagedSale));      // header
    await tx.saleItems.bulkAdd(stagedSale.lines.map(l => ({...l, saleUuid: stagedSale.uuid})));
    await tx.saleTaxes.bulkAdd(stagedSale.taxes);
    await tx.saleDiscounts.bulkAdd(stagedSale.discounts);
    await tx.payments.bulkAdd(stagedSale.payments.map(p => ({...p, saleUuid: stagedSale.uuid})));

    for (const line of stagedSale.lines) {
      const mov = buildStockMovement({ type: 'SALE', variantId: line.variantId, qtyDelta: -line.qty, batchId: line.batchId, imeiId: line.imeiId });
      await tx.stockMovements.put(mov);
      await IndexedDB.decrementInventoryQtyAvailable(tx, line.variantId, activeBranchId, activeWarehouseId, -line.qty);
      if (line.imeiId) await tx.imeis.update(line.imeiId, { status: 'SOLD' });
    }

    await tx.syncQueue.add({ op: 'CREATE_SALE', entityId: stagedSale.uuid, entityType: 'SALE', payload: stagedSale, status: 'QUEUED', retries: 0, queuedAt: new Date() });
    await tx.holdSales.delete(cart.heldSaleRefId ?? 'none'); // clear if converted from hold

    await tx.done;
  } catch (e) {
    await tx.abort();
    captureException(e);
    return { kind: 'LOCAL_WRITE_FAILED', detail: e.message };
  }

  // ========== PHASE D: HARDWARE TRIGGER (PRINT + DRAWER) — FIRE AND FORGET WITH RETRY ==========
  hardware.queueJob({ type: 'PRINT_RECEIPT', saleUuid: stagedSale.uuid, copies: receiptCopies });
  if (payments.some(p => p.methodCode === 'CASH') && stagedSale.changeDuePesewas >= 0)
    hardware.queueJob({ type: 'KICK_DRAWER', registerId: activeRegisterId, reason: 'SALE_END' });

  // ========== PHASE E: IF ONLINE, PUSH IMMEDIATELY; ELSE RETURN SUCCESS AND LET SYNC WORKER HANDLE ==========
  if (networkStore.online) {
    const [serverResult, err] = await safeAwait(api.sales.complete(stagedSale));
    if (err) {
      syncQueue.updateLastAdded({ status: 'PENDING', retries: 1, lastError: err.message });
      toast.show(LOW_PRIORITY, 'Saved locally. Will sync when connection stabilises…');
    } else {
      await IndexedDB.sales.update(stagedSale.uuid, { serverId: serverResult.id, invoiceNumber: serverResult.invoiceNumber, syncStatus: 'SYNCED' });
    }
  } else {
    toast.show(MEDIUM_PRIORITY, 'Saved locally while offline. Change GH₵ X.XX given.');
  }

  // ========== PHASE F: RESET TO EMPTY POS ==========
  posStore.resetCartAfterSale(stagedSale);
  posStore.setLastSale(stagedSale);
  if (meta.smsReceipt) smsQueue.enqueueCustomer(customerId, stagedSale);
  return stagedSale;
}
```

### 5.5 Receipt Data Model
Every completed sale produces a receipt document that is rendered:
- **On-screen** (A4/Letter HTML view, printable via browser).
- **ESC/POS byte stream** to 58 mm / 80 mm thermal printer.

Receipt fields:
```
ReceiptDoc = {
  header: {
    logoBase64? (max 512x256 1-bit bmp),
    businessName, tradingName, tin, addressLine1, addressLine2, gpsAddress, phones[], email?, website?,
    branchName, branchAddress, branchGps?,
    receiptTitle: "TAX INVOICE" || "SALES RECEIPT" || "PROFORMA",
    invoiceNumber, duplicate: "ORIGINAL" / "DUPLICATE #" ,
    timestamp (format: "04/09/2026 08:41:22 AM"),
    cashier: "Ama K.",
    servedBy?,
    customerName?, customerPhone? (masked),
    saleTypeBadge: RETAIL / WHOLESALE, diningOption: "DINE-IN" / "TAKEAWAY"
  },
  columns: [
    { key: "item", width_ratio: 0.58, align: LEFT,   header: "Item" },
    { key: "qty",  width_ratio: 0.09, align: CENTER, header: "Qty"  },
    { key: "price",width_ratio: 0.13, align: RIGHT,  header: "Price"},
    { key: "disc", width_ratio: 0.08, align: RIGHT,  header: "Disc" },
    { key: "total",width_ratio: 0.12, align: RIGHT,  header: "Total"}
  ],
  lines: [{
    item: "Nivea Men Creme 150ml", sku: "NIV-MC-150",
    qty: "2", price: "GH₵ 22.00", disc: "-GH₵ 4.40", total: "GH₵ 39.60",
    sublines: ["  Disc: Manager 20% override", "  Batch B2501 exp Jun 2028"]
  }],
  subtotalLines: [
    { label: "Subtotal (excl. tax)", value: "GH₵ 380.92" },
    { label: "Total Discounts",     value: "-GH₵ 21.00" },
    { label: "VAT Standard 15%",    value: "GH₵ 54.41" },
    { label: "NHIL 2.5%",           value: "GH₵ 9.07" },
    { label: "GETFund 2.5%",        value: "GH₵ 9.07" },
    { label: "Rounding Adjustment", value: "GH₵ 0.00" }
  ],
  totalBig: { label: "TOTAL PAID", value: "GH₵ 479.55", align: CENTER, large: true },
  payments: [
    { method: "Cash",       ref: "",           amount: "GH₵ 200.00" },
    { method: "MTN MoMo",   ref: "Txn 8A1F9B", amount: "GH₵ 179.55" },
    { method: "Telecel Cash",ref: "224678001", amount: "GH₵ 100.00" }
  ],
  changeLine: { label: "Change", value: "GH₵ 0.00" },
  loyaltyLine?: { label: "Loyalty earned", value: "+479 pts (Balance: 18,240)" },
  customerCreditLine?: { label: "On-credit balance after", value: "GH₵ 12.50 owed" },
  taxInvoiceSummary?: { label: "Tax Invoice #", value: "INV-2026-001423", tinLabel: "TIN: C0001234567" },
  warrantyBlock?: { label: "Warranty", value: "12 months. Keep receipt as proof of purchase." },
  returnPolicy: [
    "GOODS RETURNABLE WITHIN 7 DAYS",
    "WITH ORIGINAL RECEIPT & SEALED PACKAGING",
    "NO REFUNDS ON PERISHABLES OR PHONES WITH BROKEN SEAL"
  ],
  footer: [
    "Thank you for your patronage!",
    "Tel: 030 212 3456  •  WhatsApp: 050 789 0123",
    "Powered by POPMYC Retail POS",
    "GPS GA-123-4567  •  Accra Mall Branch"
  ],
  qrCodePayload?: { data: "https://popmyc.app/r/INV-2026-001423?sig=SHA256BASE64", size: 8 }
}
```
Receipt QR payload MUST be signed with `HMAC(RECEIPT_SECRET, invoiceNumber|totalPesewas|timestamp)` so that customer verifying via future customer portal can trust receipt data has not been edited.

---

## 6. Held Sales (F6 Hold / F7 Recall)

### 6.1 Hold Sale
Use case: Customer walks to fitting room with 5 items; cashier needs to serve next customer without losing cart.
- Press **F6 Hold** or click Hold button.
- Modal: "Reference for this hold" (required):
  - Auto-filled from customer name if customer attached, else ask "Customer name or phone (last 4 digits)". 25 char max.
- Click "Save & Hold".
- Cart snapshot written to `held_sales` IndexedDB (cart_snapshot JSONB) + held_sales.syncQueue.
- Zustand resets to empty cart. Badge on Recall button = held count.

### 6.2 Recall Held Sale
Press **F7 Recall** → tile list showing currently held:
```
┌─────────────────────────────────────────────────────┐
│ HELD SALES (8)                                    🔍│
├──────────┬──────────┬────────────┬──────────────────┤
│ #HK-0421 │ 12 items │ Ama A.     │ 08:15  3m ago ✕ │
│ #HK-0420 │ 3 items  │ 024…2246   │ 08:02 16m ago   │
│ #HK-0419 │ 28 items │ Wholesale- │ 07:55 23m ago   │
│ …        │          │            │                  │
└──────────┴──────────┴────────────┴──────────────────┘
  [Recall: merge with current cart? ▼]  [Discard selected?]
```
- Click tile → recall. Options:
  - **Replace current cart**: If current cart non-empty → warn "Discard 4 unsaved items?"
  - **Merge into current cart**: Sum lines; duplicate SKUs → combine qty.
- After recall: `held_sales.status = 'CONVERTED'` (kept 48 h for audit then cleaned up).

### 6.3 Auto-expiry
Expiry job: every 30 min check held_sales.expires_at > now; set status='EXPIRED'. On expiry, release any RESERVED IMEIs in that cart back to INSTOCK in IndexedDB (since no committed sale existed).

---

## 7. Return & Refund Workflow (F8)

Press **F8 Return/Refund** OR access from Sale Details → "Process Return".

### 7.1 Step 1: Find Original Sale
Search modal:
- Input invoice number `INV-2026-001234` exact → jump to match.
- **OR** search by customer phone + date range → list sale tiles → select.
- **OR** scan receipt QR code → decode `https://popmyc.app/r/INV-2026-001423?sig=…` → validate HMAC signature locally; load from DB or IndexedDB.

### 7.2 Step 2: Pick Returnable Lines
Sale loads → "Select items to return" screen:
- Each line shows: SKU, Name, Sold qty, **Previously returned qty** (from sale_items.returned_qty), **Returnable qty** = max(0, sold_qty - returned_qty). Grey if returnable=0.
- Column "Qty returning": +/- stepper or numeric input.
- Column "Return reason" dropdown (required, per line): DEFECTIVE, WRONG_ITEM, WRONG_SIZE/COLOR, CHANGED_MIND, EXPIRED, DAMAGED_IN_TRANSIT, DUPLICATE_SALE, OTHER / CUSTOMER_RELATIONSHIP, MISSING_PARTS.
- Column "Restock?": Toggle per line. Defaults:
  - reason = DEFECTIVE → restock=false; qty is routed to damaged warehouse via StockMovement(DAMAGED) on restock=false
  - reason = EXPIRED → restock=false → write-off EXPIRED
  - reason = CHANGED_MIND, WRONG_ITEM → restock=true (condition verified by cashier)
- Column "Condition returned": NEW / OPEN_BOX / USED / DAMAGED.

### 7.3 Step 3: Return Value Calculation
Calculate per line:
```
refundable_amount_per_line = min(return_qty, returnable_qty) * sale_line_unit_price_after_original_discount
                            - (pro-rated order discount, if any)
                            - any restocking fee % (configurable BusinessSetting returns.restocking_fee_pct e.g. 5% for change-of-mind)
```
- Sum of line refunds + refundable taxes → total_refund_amount.
- If line has warranty attached and return reason DEFECTIVE within warranty period: modal: "Auto-create repair/replacement claim?" → links sale_return_id to a Repair ticket (intake).

### 7.4 Step 4: Refund Method(s)
Rules enforced:
- **Default (ORIGINAL_METHODS pro-rata)**: If customer paid GH₵ 400 cash + GH₵ 79.55 MoMo → refund GH₵ (400/479.55)×total_refund to cash, remainder to MoMo.
- **CASH_ONLY option**: Refund entire amount in cash regardless. Requires permission `refund.allow_cash_only_cross_method` (anti-fraud; MoMo refund requires explicit manager approval if reversing out of original method).
- **CUSTOMER_CREDIT**: Refund goes to on-account balance instead of cash-out.
- Split refund also allowed: "GH₵ 50 cash, remainder store credit".
- For MoMo refund back to network: Stage 01 manual entry of MoMo reference (to verify refund sent); Stage 02 adapter calls `initiate_refund` on gateway.

### 7.5 Step 5: Commit
Permissions required:
- `payment.refund` (Cashier can do < GH₵ 200).
- `payment.refund_above_1000` + TOTP re-challenge if > GH₵ 1,000.
- If IMEI-tracked device returning → UPDATE imeis.status = RETURNED, sale_return_item.imeiId, write StockMovement(SALE_RETURN) to warehouse; later repair ticket consumes that IMEI.

On commit, atomically:
- Sale return + items insert.
- Stock movements (SALE_RETURN restock=true / DAMAGED for restock=false).
- Refund payment entries.
- Customer credit adjustments (if CUSTOMER_CREDIT refund method).
- JournalEntry reversal: Dr Sales Revenue, Cr Cash / MoMo Asset (mirror of original sale).
- Return receipt printed: Title "RETURN / REFUND — DUPLICATE ATTACHED TO SHIFT Z-REPORT".
- Notification to BranchManager for any refund > GH₵ 200 (inline decision log captured).

---

## 8. End-of-Day: Shift Close (Z-Report / Cash-Up)

Shortcut: **F3 Close Shift** OR Menu → Till → Close Shift.

### 8.1 Close Shift Screen
Sections:
1. **Shift Summary** (auto-computed, immutable from DB):
   - Period: 04/09/2026 08:00 AM — 04/09/2026 06:12 PM.
   - Transactions: 248 sales, 4 returns, 2 held and expired, 9 no-sale drawer opens.
   - Gross Sales: GH₵ 24,812.50, Refunds: GH₵ 312.00, Net Sales: GH₵ 24,500.50.
   - Tax Breakdown: VAT GH₵ 2,771.25, NHIL GH₵ 461.88, GETFund GH₵ 461.88.
   - Payment Method Summary:
     | Method     | Count | Total        | Fees   | Net in Drawer |
     |------------|-------|--------------|--------|---------------|
     | Cash       | 184   | GH₵ 16,400.50| GH₵ 0  | GH₵ 16,400.50 |
     | MTN MoMo   | 38    | GH₵ 4,800.00 | GH₵ 48 | GH₵ 0 (Momo wallet) |
     | Telecel    | 12    | GH₵ 1,900.00 | GH₵ 19 | GH₵ 0         |
     | Card       | 14    | GH₵ 1,400.00 | GH₵ 28 | GH₵ 0         |
     | Credit     | 0     | GH₵ 0        | GH₵ 0  | GH₵ 0         |
   - Expected Cash in Drawer = Opening Float GH₵ 500 + GH₵ 16,400.50 (cash sales) − GH₵ 300.00 (cash refunds) − GH₵ 6,000 (mid-shift bank deposit payout slip #DEP-081) = **GH₵ 10,600.50 expected**.
2. **Denomination count input**: Cashier counts actual cash, enters quantities by denomination:
   50×200 = 10,000; 20×10 = 200; 10×50 = 500; 40×0.50 = 20; 80×0.10 = 8 → sum actual = GH₵ 10,728.00.
3. **Variance calculation**: Actual − Expected = **+ GH₵ 127.50 (over)**. Text input "Variance explanation (required if |Δ| > GH₵ 5 or >0.5%)": "Possible overchange on MoMo payment → customer underpaid by cash difference?". File upload: photo of counted cash bundle.
4. **Other payout / payout entries**: List of manual PAYOUT events (e.g. "Supermarket cleaning supplies GH₵ 45" approved by manager) — attach receipt.
5. **Close Shift options**:
   - Print "X-Report" (mid-day, without closing shift) — no permission.
   - **[Close Shift & Print Z-Report]** (F12): Requires all variance fields complete.
   - **[Save for later, continue]**: Keep shift open.

### 8.2 Shift Close Commit
Atomic DB operations:
1. UPDATE shifts SET status='CLOSED', close_time=now(), closing_cash_counted=…, closing_cash_expected=…, summary_json=…, closing_note=…
2. Journal entry for cash variance: Dr Cash Short/Over Expense (if negative) OR Cr Cash Short/Over Income (positive).
3. FinancialTransaction for the closing bank deposit (if any — moves from Cash to Bank account).
4. Trigger on `shifts.status`: prevent any new inserts of sales referencing a shift WHERE status != 'OPEN'.
5. Queue: print 2 copies of Z-Report (1 for cashier sign-off + 1 for safe/audit binder). Send push notification to BranchManager email/WhatsApp summary of shift.

### 8.3 Shift Lock-out
After close: till returns to Shift Open screen. Cashier may NOT reopen same shift ID. New day → new shift with new shift_number.

---

## 9. Exception Handling / Permission Gates Summary
| Gate Name | Required Permission | Trigger | Action Required |
|-----------|---------------------|---------|------------------|
| GATE-1 | `sale.discount_above_10pct` | Discount > 10% line or order | Manager PIN / RFID override |
| GATE-2 | `sale.price_override` | Manual edit unit_price not matched to DB price | Manager PIN + override reason field |
| GATE-3 | `sale.tax_exempt` | Line toggled to zero-tax for exempt customer | Enter exemption certificate number + reason |
| GATE-4 | `sale.allow_oversell` | qty > qty_available AND allow_negative_stock=false | Manager PIN + log to stock shortage event |
| GATE-5 | `sale.on_account` | Payment method Customer Credit used | Credit limit check + override if exceeded (Manager) |
| GATE-6 | `payment.refund` | Any return refund | Basic Cashier allowed < GH₵ 200 without PIN |
| GATE-7 | `payment.refund_above_1000` + TOTP | Refund amount > GH₵ 1000 | TOTP 6-digit entry + Manager PIN |
| GATE-8 | `refund.allow_cash_only_cross_method` | Refunding MoMo sale as cash-out | Anti-fraud: requires BranchManager + TOTP |
| GATE-9 | `drawer.open_no_sale` | F10 No-Sale open drawer | Reason field mandatory; log event to cash_drawer_events |
| GATE-10 | `shift.force_close` | Previous shift abandoned, open shift of another user | Close previous with variance note; AuditLog CRITICAL |
| GATE-11 | `pos.open_item_create` | Quick-item (unlisted product) | Enable on a per-user basis (Supermarket till often disabled; Boutique enabled) |

---

## 10. Keyboard Shortcut Reference Card (Printed & Stuck by Till)

| Key | Action | Permission |
|-----|--------|------------|
| F2 | Focus product search box (scan next) | All |
| F3 | Close shift | Cashier (self) / Manager (force) |
| F4 | Open payment / complete sale | Cashier |
| F5 | Suspend / screen lock (PIN to unlock) | All |
| F6 | Hold current sale | Cashier |
| F7 | Recall held sale | Cashier |
| F8 | Process return / refund | payment.refund |
| F9 | Customer search / attach | Cashier |
| F10 | Open cash drawer (no sale) | drawer.open_no_sale |
| F11 | Switch to another cashier / change user | All |
| F12 | Confirm dialog / print / finish | All |
| Alt+P | Reprint last receipt | Cashier |
| Alt+L | Logout / switch user | All |
| − (minus) | Discount selected line | Cashier (≤ 10%) |
| Ctrl+E | Edit line unit price | sale.price_override |
| Ctrl+D | Delete selected line | sale.delete_line_after_n_seconds if > 60 s |
| Ctrl+Z | Undo last line added | All (last 5 actions stack stored) |

Shortcuts are **not** override gates. Every gate still requires its specific permission check server-side.

---

## 11. POS Transaction State Recovery Scenarios

| Scenario | Recovery Flow |
|----------|---------------|
| **Till PC BSOD/crash mid-sale during payment** | Power on → login. POS detects "Unfinished transaction from {time} — 12 lines, payment partially entered". Options: [Discard all lines / Restore & continue]. If a payment row had status=COMPLETED (e.g. customer MoMo already deducted) but sale header not committed → Recovery worker marks the orphaned payments PENDING_RECONCILIATION and displays reconciliation modal for Manager on login: "Attach orphaned payment #P-xxxx to new sale or refund it." |
| **Network dropped exactly during F12 commit** | Frontend has already written IndexedDB tx (Phase C). User sees a spinner then "Saved locally" toast. Reconnect → Sync worker pushes sale with idempotency key; server either returns existing sale (if backend got it before crash) or creates new, returns invoice number. No duplicate sale possible. |
| **Printer jammed halfway through receipt** | Companion service keeps receipt in printQueue.status = FAILED. POS button "Reprint receipt" resubmits; cashier clears jam, reprints 1 copy. Reprint count increments; each copy printed watermarked "COPY — NOT A TAX INVOICE" except copy #1. |
| **Cashier took MoMo cash from customer mistakenly (double payment)** | Reconciliation step next day shift close: Cashier reports double → Manager issues MoMo refund (go to Sale details → manual refund row with note "reimburse overcharge") + writes expense for MoMo fee if any. AuditLog ties both entries together. |
| **Manager override mid-transaction — Manager walks away with PIN typed** | Manager PIN modal has 30-second inactivity timeout; auto-closes and revokes granted gates. Cashier must re-request if needed. |
| **Customer walks out after MoMo approved but before receipt printed** → Sale is already committed. Queue receipt and print on demand next time customer returns; SMS auto-receipt if phone in customer profile. |

All flows tested in both ONLINE and OFFLINE mode with automated integration tests (see TESTING_STRATEGY.md for scenarios matrix).
