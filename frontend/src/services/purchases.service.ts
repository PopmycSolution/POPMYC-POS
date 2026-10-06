/**
 * purchases.service.ts
 * ====================
 * All HTTP calls for the purchases API.
 *
 * Endpoint base: /api/v1/purchases/
 *
 * Used by PurchasesPage and purchase.store — keeps API logic separate
 * from UI and from localStorage fallback logic.
 */
import api from './api';
import type {
  PurchaseOrder,
  PurchaseItem,
  PurchaseStatus,
  PaymentStatus,
} from '@/stores/purchase.store';

// ── Raw backend shapes ──────────────────────────────────────────────────────

export interface RawPurchaseItem {
  id: string;
  product: string;
  product_name?: string;
  product_sku?: string;
  variant?: string | null;
  batch?: string | null;
  batch_number?: string | null;
  qty_ordered: number;
  qty_received: number;
  unit_cost: string | number;
  subtotal: string | number;
  expiry_date?: string | null;
  // Batch tracking (populated after receive_goods)
  batch_purchase_date?: string | null;
  batch_received_date?: string | null;
  batch_qty_purchased?: number | null;
  batch_qty_received?: number | null;
  batch_qty_remaining?: number | null;
  batch_stock_out_date?: string | null;
  batch_days_to_sell?: number | null;
  batch_days_in_stock?: number | null;
  batch_is_sold_out?: boolean;
}

export interface RawPurchaseOrder {
  id: string;
  po_number: string;
  supplier?: string | null;
  supplier_name?: string | null;
  branch?: string | null;
  branch_name?: string | null;
  warehouse?: string | null;
  items: RawPurchaseItem[];
  subtotal: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  amount_paid: string | number;
  status: PurchaseStatus;
  payment_status: PaymentStatus;
  order_date: string;
  expected_date?: string | null;
  received_date?: string | null;
  reference?: string;
  notes: string;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Mapping helpers ──────────────────────────────────────────────────────────

export function mapItem(raw: RawPurchaseItem): PurchaseItem {
  return {
    id:           raw.id,
    productId:    raw.product ?? undefined,   // backend UUID — needed for receive_goods
    productName:  raw.product_name ?? '',
    sku:          raw.product_sku  ?? '',
    quantity:     Number(raw.qty_ordered),
    unitPrice:    Number(raw.unit_cost),
    receivedQty:  Number(raw.qty_received),
    subtotal:     Number(raw.subtotal),
    expiryDate:   raw.expiry_date ?? null,
    batchNumber:  raw.batch_number ?? null,
    batchId:             raw.batch ?? null,
    batchPurchaseDate:   raw.batch_purchase_date  ?? null,
    batchReceivedDate:   raw.batch_received_date  ?? null,
    batchQtyPurchased:   raw.batch_qty_purchased  ?? null,
    batchQtyReceived:    raw.batch_qty_received   ?? null,
    batchQtyRemaining:   raw.batch_qty_remaining  ?? null,
    batchStockOutDate:   raw.batch_stock_out_date ?? null,
    batchDaysToSell:     raw.batch_days_to_sell   ?? null,
    batchDaysInStock:    raw.batch_days_in_stock  ?? null,
    batchIsSoldOut:      raw.batch_is_sold_out    ?? false,
  };
}

export function mapOrder(raw: RawPurchaseOrder): PurchaseOrder {
  return {
    id:            raw.id,
    poNumber:      raw.po_number,
    supplierName:  raw.supplier_name ?? '',
    supplierId:    raw.supplier ?? '',
    items:         (raw.items ?? []).map(mapItem),
    subtotal:      Number(raw.subtotal),
    taxAmount:     Number(raw.tax_amount),
    totalAmount:   Number(raw.total_amount),
    amountPaid:    Number(raw.amount_paid),
    status:        raw.status,
    paymentStatus: raw.payment_status,
    orderDate:     raw.order_date,
    expectedDate:  raw.expected_date ?? raw.order_date,
    receivedDate:  raw.received_date ?? undefined,
    notes:         raw.notes,
    createdBy:     raw.created_by_name ?? '',
    branchId:      raw.branch ?? null,
    createdAt:     raw.created_at,
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

/** Fetch all POs for the authenticated business (paginated, returns all) */
export async function fetchOrders(params?: Record<string, string>): Promise<PurchaseOrder[]> {
  const res = await api.get<PaginatedResponse<RawPurchaseOrder> | RawPurchaseOrder[]>(
    '/purchases/purchase-orders/',
    { params: { limit: 200, ordering: '-created_at', ...(params ?? {}) } },
  );
  const list = Array.isArray(res.data) ? res.data : res.data.results ?? [];
  return list.map(mapOrder);
}

/** Create a purchase order */
export async function createOrder(payload: {
  supplier?: string | null;
  branch?: string | null;
  warehouse?: string | null;
  order_date: string;
  expected_date?: string | null;
  reference?: string;
  notes?: string;
  items: Array<{
    product: string;
    variant?: string | null;
    qty_ordered: number;
    unit_cost?: number;
    expiry_date?: string | null;
    notes?: string;
  }>;
}): Promise<PurchaseOrder> {
  const res = await api.post<RawPurchaseOrder>('/purchases/purchase-orders/', payload);
  return mapOrder(res.data);
}

/** Receive goods against a PO — creates Batch + StockMovement */
export async function receiveGoods(
  orderId: string,
  payload: {
    received_date: string;
    branch?: string | null;
    warehouse?: string | null;
    notes?: string;
    items: Array<{
      product: string;
      variant?: string | null;
      purchase_order_item?: string | null;
      qty_received: number;
      unit_cost?: number;
      expiry_date?: string | null;
      batch_number?: string;
      notes?: string;
    }>;
  }
): Promise<RawPurchaseOrder> {
  const res = await api.post<RawPurchaseOrder>(
    `/purchases/purchase-orders/${orderId}/receive_goods/`,
    payload,
  );
  return res.data;
}

/** Cancel a PO */
export async function cancelOrder(orderId: string): Promise<PurchaseOrder> {
  const res = await api.post<RawPurchaseOrder>(
    `/purchases/purchase-orders/${orderId}/cancel/`,
  );
  return mapOrder(res.data);
}

/** Record a payment against a PO */
export async function addPayment(
  orderId: string,
  payload: {
    amount: number;
    payment_method?: string;
    payment_date?: string;
    reference?: string;
    notes?: string;
  }
): Promise<PurchaseOrder> {
  const res = await api.post<RawPurchaseOrder>(
    `/purchases/purchase-orders/${orderId}/add_payment/`,
    payload,
  );
  return mapOrder(res.data);
}
