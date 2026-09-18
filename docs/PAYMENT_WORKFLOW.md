# POPMYC Retail POS - Payment Workflow & Architecture

## Document Overview
- **Document ID**: POPMYC-PAYWF-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04

---

## 1. Payment Architecture Principles

POPMYC's payment subsystem is built on four principles:

1. **Payment Methods are rows, NOT enums.** New payment types (e.g. a new Fintech wallet "Zeepay" or "CBET") can be added via the Back Office UI by a user with `settings.payment_methods.create` permission — no code, no deploy, no migration.
2. **Split payment is first-class.** Every sale supports any number of payment lines in arbitrary methods, with mathematically correct rounding, fee handling, and change calculation. Ghana retail commonly sees: "GH₵ 50 cash + GH₵ 200 MTN MoMo + GH₵ 150 Telecel Cash" for a single GH₵ 400 shop-purchase of electronics or groceries.
3. **Accounting is double-entry by default.** Every successful Payment writes one `FinancialTransaction` row with a debit account (the asset account money landed in) and a credit account (revenue or accounts receivable reduced). For split payments: one FinancialTransaction per payment line.
4. **Payment Gateway decoupling via Adapter Protocol.** Any payment processor (Hubtel, Slydepay, Flutterwave, Tribe Banking, cheque, cash, customer credit) implements a 5-method Python ABC: `initiate_payment → poll_status → confirm_payment → initiate_refund → reconcile_statement`. The core payment service never hard-codes a processor. Stage 01 ships with Manual (cashier clicks "confirmed") adapters.

---

## 2. PaymentMethod Model (Database Rows — Seeding Defaults)

Table `payment_methods` (described fully in DATABASE_DESIGN.md):

### 2.1 Ghana Default Methods Seeded on Business.create()

| code | name | type | is_cash_equivalent | is_change_eligible | default fee (pct + flat) | account_type | adapter_class |
|------|------|------|---------------------|--------------------|--------------------------|--------------|---------------|
| CASH | Cash | CASH | true | true (only one) | 0% + GH₵ 0 | Cash Account (physical drawer) | ManualCashAdapter |
| MTN_MOMO | MTN MoMo | MOBILE_MONEY | true* | false | 0% flat (merchant absorbs default; editable) | Asset: MTN MoMo Wallet | ManualMoMoAdapter (Stage 01) / HubtelAggregateAdapter (Stage 02) |
| TELECEL_CASH | Telecel Cash | MOBILE_MONEY | true* | false | 0% default | Asset: Telecel Cash Wallet | ManualMoMoAdapter / Aggregate |
| AIRTELTIGO | AirtelTigo Money | MOBILE_MONEY | true* | false | 0% default | Asset: AirtelTigo Money Wallet | ManualMoMoAdapter / Aggregate |
| VISA_MC | Visa / Mastercard Card | CARD | false | false | 1.5% + GH₵ 0 (typical MSC; configurable) | Asset: Bank Account – POS Settlement | ManualCardAdapter / PaystackAdapter / FlutterwaveAdapter |
| BANK_TRANSFER | Bank Transfer / Deposit | BANK | false | false | 0% | Asset: Bank Account | ManualBankTransferAdapter |
| GHIPSS_QR | GhIPSS QR (Instant Pay) | QR | false** | false | 0.005% default (GhIPSS published fee cap) | Asset: Bank Account – Instant Settlement | ManualQrAdapter (scan user QR; Stage 02 API) |
| CUSTOMER_CREDIT | Customer Credit (On-Account) | CREDIT | false | false | 0% | Asset: Accounts Receivable / Customer Credit | CustomerCreditAdapter (internal, never external) |
| CHEQUE | Cheque (Post-dated / Current) | OTHER | false | false | GH₵ 0.20 flat (bank fee) | Asset: Undeposited Cheques | ManualChequeAdapter (with clearance date field) |
| VOUCHER | Gift Voucher / Coupon Credit | OTHER | true | false | 0% | Liability: Deferred Revenue (unredeemed vouchers) | InternalVoucherAdapter (future) |

* MoMo wallets are "cash equivalents" in a liquidity sense (convert to cash within 24h), but not change-eligible — a customer overpaying by GH₵ 5 on MoMo cannot get GH₵ 5 from the till; you must refund the excess back to MoMo or apply to Customer Credit.
** GhIPSS QR = instant; settlement T+0 or T+1 depending on bank.

### 2.2 PaymentMethod Customisation UI
- BranchManager role with `settings.payment_methods.edit` can: Enable/disable methods at a branch, rename display name (e.g. rebrand `MTN_MOMO` to "MTN Mobile Money (MoMo)"), set fees per method, set per-method min / max amount (USSD daily limit for MoMo networks max ~GH₵ 2,000 single transaction; you may set lower shop limits).
- Adding a **new custom PaymentMethod**: Form → Code, Display Name, Type dropdown, Account mapping, adapter "Manual External" only in Stage 01. Custom payment methods never allow backend integration; they always require manual confirmation.
- Deleting a PaymentMethod: Soft-delete (is_active=false). Historical payments referencing code remain intact; code may not be reused (UNIQUE on business_id + code even for inactive to prevent collision with historical financial statements).

---

## 3. Split Payment Algorithm (Formal Specification)

### 3.1 Definitions & Notation
- `T ∈ ℚ` (Decimal): Invoice grand total `sale.total_incl` including tax + rounding adjustment − discount + tip.
- `N ∈ ℕ`: Number of payment lines (1..10 enforced max to avoid errors).
- `Pi, i ∈ 1..N`: Each payment line.
  - `mi = Pi.method_code`
  - `Ai = Pi.amount ∈ ℚ, Ai > 0`
  - `Ri = Pi.reference (string, optional)` — MoMo Tx ID, cheque no, etc.
  - `Pi.status ∈ {PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED, REFUNDED_FULL, REFUNDED_PARTIAL, TIMED_OUT}`
- `C = sum_{i: method mi has is_cash_equivalent=true} Ai`
- `NC = sum_{i: method mi has is_cash_equivalent=false} Ai`
- `Sum_A = sum_{all i} Ai = C + NC`
- `ChangeEligibleAmount = max(0, sum_{i: method mi has is_change_eligible=true} Ai)` = usually just cash portion.

### 3.2 Hard Constraints (Enforced Backend + Frontend)

The following predicates must all be TRUE for the sale to finalise:

```
C1. Sum_A >= T - 0.01  (pesewa numeric tolerance: allow ± 0.01 due to rounding to pesewe)
C2. Sum_A <= T + max_allowable_over_payment()  where
     max_allowable_over_payment() = ChangeEligibleAmount (see C4)
     OR if ChangeEligibleAmount = 0: Sum_A must equal T within ±0.01 (no overpayment allowed on MoMo-only)
C3. For every method NOT is_change_eligible: Ai <= T (cannot overpay on any single non-change method — disallow GH₵ 500 MoMo on GH₵ 250 sale to force "cash change" — which is money laundering red flag. Must use two lines if needed.)
C4. Change = max(0, Sum_A - T)
    IF Change > 0:
      a. Exactly one payment method with is_change_eligible=true must exist in the array (typically Cash).
      b. Change must be <= Cash amount (because change is given FROM the cash received).
      c. Methods without is_change_eligible=true have Ai = exactly as required (cannot exceed pro-rata beyond T).
C5. For each method min/max_amount limits from payment_methods table:
    min_amount <= Ai <= max_amount (or min null, max null → ignore)
C6. For CUSTOMER_CREDIT method:
    Cc = Customer current_credit_limit + available credit balance
    Ai <= Cc (cannot draw more credit than approved)
    AND if combined credit sale: sum of credit lines <= Cc
C7. For CHEQUE: clearance_date required AND clearance_date >= today() - 1 (allow backdating 1 day)
C8. For VISA_MC (card) OR MOBILE_MONEY: last_4 (of card or phone) stored if not full PAN; never store full PAN.
C9. No split payment can combine CUSTOMER_CREDIT > 0 with a Tip > 15% (fraud pattern guard).
C10. If BusinessSetting payment.require_reference = true for a method → Pi.reference non-empty.
```

### 3.3 Auto-Balance UI Helper (UX for Cashier)
Cashier clicks method tiles one at a time. After each click on a tile, frontend computes `remaining = max(0, T − already_assigned_Ai)`. Next tile clicked auto-fills Ai = remaining (unless user overrides to a partial). This speeds up typical single-method transactions.

**Examples**:

#### Example 1 — Typical Supermarket (Cash Only)
```
T = GH₵ 47.80
Cashier enters Cash GH₵ 50.00 (overpayment GH₵ 2.20)
C1-3 OK, C4: ChangeEligibleAmount = 50. Change = 2.20.
Final Cash posted: GH₵ 50.00 received; change GH₵ 2.20 given.
Journal: Dr Cash on Hand 50.00; Cr Revenue + Taxes 47.80; Cr Cash Float (Change Payable) 2.20? OR simpler — net Cash actually goes up by 47.80 (because 2.20 was removed from drawer as change). Record net financial transaction amount GH₵ 47.80 Dr Cash; change tracked separately in metadata of sale.change_due + drawer event.
```

#### Example 2 — Phone Shop (Split 3 Way)
```
Samsung S24 — T = GH₵ 8,400.00
Customer: "GH₵ 2,000 cash, GH₵ 4,000 MTN MoMo, GH₵ 2,400 Bank Transfer (Stanbic app)"
Payments:
 [Cash       A=2000, Ref=          ]
 [MTN MoMo   A=4000, Ref=MTN-8AD21C, Phone=024…1234]
 [Bank Trf   A=2400, Ref=STANBIC-APP-202609041522]
Sum_A = 8,400. T = 8,400.
C1-C6 OK. No Change because Sum_A == T.
Ledger: Dr Cash 2,000 Dr MTN MoMo Wallet 4,000 Dr Stanbic Bank 2,400  / Cr Revenue+Taxes 8,400.
```

#### Example 3 — Boutique VIP on Credit
```
Dress + 2 perfumes: T = GH₵ 3,120.00
Customer "Grace" — CustomerGroup VIP, credit_limit 10,000, current balance 0, available 10,000.
Payment line:
 [Customer Credit  A=3,120 ]
C6 OK, C1-C4 OK.
Ledger: Dr Accounts Receivable / Customer Credit 3,120
        Cr Revenue 2,739.13, Cr VAT 410.87 (example split)
CustomerCredit running ledger line added: +3,120 INVOICE_CHARGE balance_after 3,120.
```

---

## 4. Payment Status Lifecycle

```
  user initiates
       │
       ▼
  ┌─────────┐          adapter.initiate() success?          ┌─────────────┐
  │ PENDING │─────────────── yes ─────────────────────────►│ PROCESSING  │
  └────┬────┘                                               └──────┬──────┘
       │ no adapter needed (cash)                                 │
       └─────────────────────────────────────┐                   │ poll loop /
                                             ▼                   │ webhook callback
                                      ┌─────────────┐            │
                                      │ COMPLETED   │◄───────────┘
                                      └──────┬──────┘
                                             │ partial refund
                                             ▼
                                      ┌─────────────────┐    full refund
                                      │ REFUNDED_PARTIAL│────────────┐
                                      └─────────────────┘            │
                                                                     ▼
                  initiate failed │    timeout │   cancel      ┌────────────────┐
                                  ▼         ▼        ▼          │ REFUNDED_FULL  │
                              ┌──────┐ ┌───────────┐ ┌────────┐ └────────────────┘
                              │FAILED│ │TIMED_OUT  │ │CANCEL. │
                              └──────┘ └───────────┘ └────────┘
```

### 4.1 Status Transitions Table
| From → To | When Allowed | AuditLog Severity |
|-----------|--------------|-------------------|
| PENDING → COMPLETED | CASH immediate; MoMo manual confirmed; gateway callback success | INFO |
| PENDING → PROCESSING | External adapter initiated, awaiting callback/poll | INFO |
| PENDING → FAILED | Validations fail (insufficient balance in MoMo adapter, Card declined) | WARNING |
| PENDING → CANCELLED | Cashier clicks "cancel payment attempt" before timeout | INFO |
| PROCESSING → COMPLETED | Gateway callback success | INFO |
| PROCESSING → TIMED_OUT | 120s poll window passed without callback | WARNING |
| PROCESSING → FAILED | Gateway responds DECLINED | WARNING |
| COMPLETED → REFUNDED_PARTIAL | Partial refund issued | WARNING |
| COMPLETED → REFUNDED_FULL | Full refund issued (or split refund → total sum back) | WARNING |
| TIMED_OUT → COMPLETED | Late callback arrives within 24h (out-of-band) | WARNING |

### 4.2 Duplicate Protection (Idempotency + Reference Uniqueness)
- **Server side**: `UNIQUE(business_id, method_code, external_reference) WHERE external_reference IS NOT NULL AND status IN ('COMPLETED','REFUNDED_PARTIAL')`. Attempting to post a payment with already-used MoMo reference → DUP error. This prevents double-charging a customer when the same MoMo Tx ID is entered twice.
- **Client side**: The POS payment modal generates a single `payment_attempt_uuid` per "Send MoMo request" click. Retries (polls / re-sends) reuse the same attempt UUID; server maps to its internal payment.id.

---

## 5. Mobile Money Workflow (Stage 01 Manual + Stage 02 Aggregator)

### 5.1 MTN/Telecel/AirtelTigo Number → Network Auto-Detection
Lookup table in BusinessSettings or payment_methods (network_prefixes_json):
```json
{
  "MTN_MOMO":      ["024", "054", "055", "059", "025", "073"],
  "TELECEL_CASH":  ["020", "050", "070"],
  "AIRTELTIGO":    ["026", "027", "056", "057", "076", "077"]
}
```
User enters customer phone number in Payment modal → JS function:
```ts
export function detectMoMoNetwork(e164_or_local: string): keyof PrefixMap | 'UNKNOWN' {
  const cleaned = e164_or_local.replace(/^\+233/, '0').replace(/\s/g, '');
  for (const [network, prefixes] of Object.entries(prefixesByNetwork)) {
    if (prefixes.some(p => cleaned.startsWith(p))) return network as any;
  }
  return 'UNKNOWN';
}
```
If network ≠ method selected → Modal: "Phone 020-xxx is Telecel Cash but you selected MTN. Switch method?" → Auto-corrects method code.

### 5.2 Stage 01 Manual Confirm UX (Current Scope)
1. Cashier enters amount + phone → Detects network → Click **"Send Request (Manual)"**.
2. Modal shows:
   ```
   ┌──────────────────────────────────────────────┐
   │  MTN MoMo Payment Request                    │
   │                                              │
   │  Customer: +233 24 123 4567                  │
   │  Merchant: POPMYC DEMO SHOP                  │
   │  Merchant ID: MM123456789                    │
   │  Amount: GH₵ 4,000.00                       │
   │  Reference: PAY-2026-000041                  │
   │                                              │
   │  Step 1: Customer receives prompt on phone.  │
   │  Step 2: Customer enters their MoMo PIN to   │
   │          approve GH₵ 4,000 debit.            │
   │  Step 3: On YOUR MoMo merchant phone,        │
   │          confirm you received GH₵ 4,000.     │
   │                                              │
   │  Countdown: 1:58                             │
   │                                              │
   │  [ I CONFIRMED RECEIPT ON MY MOMO PHONE ]    │
   │  [ Customer cancelled / declined ]           │
   │  [ Payment timed out, retry? ]               │
   └──────────────────────────────────────────────┘
   ```
3. Cashier ticks confirmed → Payment.status=COMPLETED, external_reference = manual MoMo TX ID (6-digit code from SMS optional). AuditLog: "Manual MTN MoMo completion for #41 by cashier Ama; no adapter gateway callback".

### 5.3 Stage 02 Aggregator Adapter (Hubtel / Slydepay / Flutterwave)
```
    ┌────────────┐    init()     ┌──────────────┐   HTTP POST /receive      ┌───────────┐
    │ POS React  │──────────────►│  Django      │ ────────────────────────► │  Hubtel    │
    │            │◄──────────────│  Backend     │ ◄──────── Webhook / Poll  │  Gateway   │
    │            │   pending id  │  Adapter    │                           └───────────┘
    └────────────┘               └──────────────┘
          │
          └─── SSE Event stream from companion service / poll / websocket
               to update modal UI when status changes.
```
- Initiate → Gateway returns a `transaction_id = HT-20260904-XXXX` + poll URL.
- Polling job (Django Q, every 5 seconds up to 120 s) → calls adapter.poll_status.
- On success: update Payment.status, create FinancialTransaction, mark sale COMPLETED.
- Webhook signed with adapter's `webhook_secret` from BusinessSettings; HMAC signature verified before trusting any payload.

### 5.4 MoMo Charges & Fees (Merchant MSC Deductions)
BusinessSetting:
- For each MobileMoney method: `momo_fee_borne_by = MERCHANT (default) / CUSTOMER`.
- If MERCHANT: each successful payment adds the fee to an Expense line `Dr Merchant Service Charges Expense`; Cr Payment Method Asset (reduces amount settled into bank by fee).
- If CUSTOMER: fee added on top of T before computing split-payment sum (invoice surcharge "MoMo Processing Fee GH₵ X.XX"). Receipt shows this as a separate line item.
- Reconciliation report (end of day): `Gross Received GH₵ 4,000.00, Fees GH₵ 40.00, Net Settlement GH₵ 3,960.00 (T+1)`.

---

## 6. Customer Credit / On-Account & Layaway

### 6.1 Customer Credit Adapter (Internal Double-Entry Bookkeeping)
When method code = `CUSTOMER_CREDIT` is used, adapter:

```python
class CustomerCreditAdapter(IPaymentGatewayAdapter):
    def initiate_payment(self, payment: Payment, payer_phone=None):
        customer = Customer.objects.get(id=payment.customer_id)
        available = customer.credit_limit - customer.current_balance  # (positive balance = they owe us; available is limit minus owed)
        if payment.amount_base > available:
            return PaymentResult(status='FAILED', gateway_ref=None, error='CREDIT_LIMIT_EXCEEDED')
        # DO NOT FINANCIAL TRANSACTION HERE — sale completion does it: Dr A/R, Cr Revenue
        # Also write a running CustomerCredit row:
        CustomerCredit.objects.create(
            customer_id=customer.id,
            txn_type='INVOICE_CHARGE',
            amount = payment.amount_base,  # positive = balance goes up (they owe more)
            balance_after = customer.current_balance + payment.amount_base,
            reference_type='SALE', reference_id=payment.sale_id,
            note='Point-of-sale on-account',
        )
        return PaymentResult(status='COMPLETED', gateway_ref=f'AR-{payment.reference_number}')
```

### 6.2 Customer Paying Down Their Credit (Accounts Receivable)
Menu → Customers → Receive Payment against credit balance.
- Select customer → Shows current balance, list of unpaid invoices.
- `Auto-Allocate Oldest First` (default): GH₵ 1,000 payment allocated to oldest invoices until exhausted.
- Or manual: specify amounts per invoice.
- Payment method: Cash / MoMo / Bank Transfer → real payment row created; CustomerCredit txn_type = PAYMENT_RECEIVED (negative amount reduces balance).

---

## 7. Refund Architecture

### 7.1 Refund Policy Matrix UI (Back Office → Settings → Refund Rules)
Per business:
```
refund_rules = [
  { "sale_age_days": 7,  "reason": "CHANGED_MIND",         "refund_allowed": true,  "restock": true,  "restocking_fee_pct": 0,   "manager_override": false },
  { "sale_age_days": 30, "reason": "CHANGED_MIND",         "refund_allowed": true,  "restock": true,  "restocking_fee_pct": 10,  "manager_override": true  },
  { "sale_age_days": 7,  "reason": "DEFECTIVE",            "refund_allowed": true,  "restock": false, "restocking_fee_pct": 0,   "manager_override": false },
  { "sale_age_days": 0,  "reason": "PERISHABLE_EXPIRED",   "refund_allowed": false, "restock": false, "restocking_fee_pct": 0,   "manager_override": true  },
]
```
Backend validates on SaleReturn POST → first matches rule → blocks/disallows.

### 7.2 Refund Method Rules
Payment method `can_be_refunded_to` flag per payment_methods row (default true for all; CHEQUE → refund to Bank Transfer only, not cash back).

#### Default Pro-Rata Refund Split Algorithm
```
Original sale T = 400
Original payments = [ Cash 200, MTN 200 ]

Requested refund = 240 (60% of total)
Compute pro-rata per original method (pct = Ai / T):
  Cash refund = 240 * (200 / 400) = GH₵ 120.00
  MTN  refund = 240 * (200 / 400) = GH₵ 120.00

→ Refunds array = [
    { method: CASH,         amount 120, to_customer: "till payout" },
    { method: MTN_MOMO,     amount 120, to_customer_phone: 024xxxx }
  ]
```
Cashier may override to **Cash-Only** (as discussed in POS_WORKFLOW F8) — requires `refund.allow_cash_only_cross_method` permission + TOTP if > GH₵ 500.

### 7.3 Adapter initiate_refund() Implementation
For MoMo/Card adapters, refund support:
- Attempts to call the gateway: `POST /transactions/:original_id/refund`.
- Gateway refund transaction ID stored in `refunds.gateway_ref JSONB` + `Refund.status`.
- If gateway returns DECLINED (customer closed wallet, etc.) → Retry queue and notification to Accountant: "Manual refund required for #RF-0123".

---

## 8. Change Calculation & Denomination Suggestion

After sale total T and cash payment CASH_IN, change = max(0, CASH_IN − T).

### 8.1 Denomination Breakdown (Ghana Cedi)
Modal shows cashier how to make change optimally (fewest notes/coins possible):

```
Change Due: GH₵ 43.70

Optimal combination:
  1 × GH₵ 20 note
  1 × GH₵ 20 note
  0 × GH₵ 10
  0 × GH₵ 5
  1 × GH₵ 2 coin
  1 × GH₵ 1 coin
  1 × 50p coin
  1 × 20p coin
  0 × 10p
  0 × 5p
Tender: GH₵ 43.70
```
Algorithm: Greedy with Ghana denominations set `[200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05]`. If future banknotes change → editable in BusinessSettings.

### 8.2 Drawer Balance Projection
During shift: every change-given event subtracts from a projected "Notes/coins balance by denomination" running counter. When a denomination hits 0 → in-app toast "Low on GH₵ 10 notes — request change from manager!". Useful for busy supermarkets.

---

## 9. End-to-End Financial Entry Per Payment Type

After Payment.status == COMPLETED, `financial_transactions` rows created (one per payment line):

| Scenario (payment.method.code) | Debit Account (Dr) | Credit Account (Cr) | Amount |
|--------------------------------|--------------------|---------------------|--------|
| CASH | 1000 Cash on Hand (asset) | 4000 Sales Revenue + 2200 VAT Payable (split to contra accounts per GL posting from sale aggregate) | Net amount received (T) for financial transaction row; revenue split elsewhere |
| MTN_MOMO (or any MoMo) | 1010 Asset / MTN MoMo Wallet | Same revenue + taxes | Net MoMo received |
| VISA_MC Card | 1020 Asset / POS Card Settlement Account | Same | Gross received; separate journal for fees posted at month-end or daily |
| BANK_TRANSFER | 1100 Asset / Bank (Stanbic Current) | Same | — |
| GHIPSS_QR | 1100 Asset / Bank — Instant Settlement | Same | — |
| CUSTOMER_CREDIT | 1200 Asset / Trade Debtors — Customer Credit | Same | Increase AR balance |
| CHEQUE (received) | 1050 Asset / Undeposited Cheques | Same | On clearance date: move 1050 → 1100 via manual JournalEntry when bank statement confirms |

Additionally for MERCHANT-borne fees:
- Daily batch job: For each payment with method.fee_pct > 0 AND method.fee_borne_by=MERCHANT → create Expense + FinancialTransaction Dr 5430 Merchant Fees Expense / Cr corresponding Asset (reduces balance to net settlement amount).

---

## 10. Reconciliation Workflow (Accountant Daily / Monthly)

### 10.1 Daily Reconciliation Steps
1. **Cash Drawer Physical Count vs Shift Expected Cash = Variance** (from POS_WORKFLOW §8) → post cash short/over.
2. **MoMo Wallet reconciliation**:
   - Report: POS → Accounting → Reconcile → MoMo per method:
     | POS Payment Time | Invoice # | Customer Phone | POS Amount | MoMo Merchant Statement Amount | Tx ID | Match? | Diff |
   - Auto-match by external_reference (Tx ID).
   - Manual match by: timestamp ± 10 min, amount, phone.
   - Auto-matching threshold 98%; remaining 2% manually resolved by Accountant.
   - Unmatched MoMo-In (money arrived in wallet but no corresponding sale): "POS not recorded?" → ability to create +post a new sale from reconciliation screen (supervised).
   - Unmatched MoMo-Out (sale recorded, but missing from statement): payment status TIMED_OUT with no callback → "Did customer actually pay?". If they did → fix external reference and mark COMPLETED; if not → VOID sale and issue credit note.
3. **Bank Account statement vs POS Bank-Transfer Deposits**: CSV statement import → column mapping → auto match by amount + reference.
4. **Card processor settlement**: Daily settlement file (CSV) from Ecobank / POS terminal → upload. Reconcile by RRN / Auth Code.
5. **Customer Credit Statements**: Run monthly statements for all customers with balance > 0 → PDF + optional SMS/email via Stage 02 integrations.

### 10.2 Reconciliation Table (financial_transactions.reconciliation_status)
```
UNRECONCILED (default)
  ├──AUTO_MATCHED──►MATCHED
  ├──MANUAL_MATCH──►MATCHED
  └──EXCEPTIONS──►MISMATCHED
       MISMATCHED ───► user investigates ───►MATCHED / ADJUSTED_VIA_JOURNAL
```
Journal Entry to resolve differences: `Dr/Cr Cash Over/Short Suspense` ↔ appropriate AR/AP account.

---

## 11. Fraud & Risk Controls (Hard)

Payment subsystem includes these non-configurable risk gates (they run in production always):

1. **Velocity check per customer_phone/method**: max 5 successful MoMo debits per phone per 24 h. Prevents "testing stolen phones" scenarios.
2. **High-amount split gate**: Sale total > GH₵ 20,000 AND split across ≥ 4 MoMo methods from different phones → blocks with "Possible structuring (smurfing) — Manager override with ID check required". Logs WARNING to AuditLog.
3. **Large cash refund anomaly**: Cash refund > GH₵ 2,000 within 15 min of an original MoMo-paid sale → block (conversion to cash laundering vector). Requires BusinessOwner approval.
4. **Reversal-of-large-transaction**: Refund > GHS 5,000 requires dual approval (Accountant + Owner) within 48-hour window (pending until both signatures).
5. **PIN/TOTP gating**: (Already described in SECURITY.md) Refund > GHS 1000 triggers TOTP re-challenge.
6. **Cheque kiting guard**: Customer+date combination — if 2+ post-dated cheques from same customer with future clearance date within 7 days overlap clearance → warning to Accountant.
7. **Backdated payment entry**: Payment.posted_at != created_at and difference > 48 hours → always requires dual approval; logged in AuditLog as EDIT_POST_HISTORICAL.
8. **Receipt print count**: Receipts > printed_count 5 within 1 hour → warning "Receipt printed unusually often for same sale (fraud pattern duplicate till copies?)".

All 8 controls unit-tested under `tests/fraud/` and may not be toggled off.

---

## 12. Payment Domain Test Cases (Brief; Extend in TESTING_STRATEGY.md)

Must-pass payment tests (all):
- Split payment 2 methods, exact total → sale.status COMPLETED; sum payments = sum FinancialTransaction amounts.
- Cash overpayment exact change → change_due correct; drawer balance decrement matches.
- Split payment 3 MoMo networks → each adapter call invoked, status COMPLETED.
- Customer credit limit = GH₵ 1,000; sale = GH₵ 1,500 → CREDIT_LIMIT_EXCEEDED error; no ledger written (rollback).
- Pro-rata refund 60% → refund array sums correct ± 0.01 pesewa rounding.
- MoMo duplicate external_reference → DUP error on second attempt; no double FinancialTransaction.
- MoMo timeout then late success callback → status TIMED_OUT → COMPLETED transition allowed, duplicate entry guard prevents double-posting.
- Ghana pesewa rounding edge case: `T = 1.00, method = Cash paid 1.00; returns 0.00 change, no drift`.
