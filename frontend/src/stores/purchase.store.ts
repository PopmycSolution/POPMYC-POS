import { create } from 'zustand';
import api from '@/services/api';

export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL_RECEIVED' | 'RECEIVED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface PurchaseItem {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  receivedQty: number;
  subtotal: number;
  expiryDate?: string | null;
  batchNumber?: string | null;
  // Batch tracking fields (populated after goods are received)
  batchId?: string | null;
  batchPurchaseDate?: string | null;
  batchReceivedDate?: string | null;
  batchQtyPurchased?: number | null;
  batchQtyReceived?: number | null;
  batchQtyRemaining?: number | null;
  batchStockOutDate?: string | null;
  batchDaysToSell?: number | null;
  batchDaysInStock?: number | null;
  batchIsSoldOut?: boolean;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: string;
  items: PurchaseItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: PurchaseStatus;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  orderDate: string;
  expectedDate: string;
  receivedDate?: string;
  notes: string;
  createdBy: string;
  /** Branch this PO belongs to. null = shared/legacy record. */
  branchId?: string | null;
  createdAt: string;
}

interface PurchaseStore {
  orders: PurchaseOrder[];
  addOrder: (data: Omit<PurchaseOrder, 'id' | 'createdAt'>) => PurchaseOrder;
  updateOrder: (id: string, data: Partial<PurchaseOrder>) => void;
  cancelOrder: (id: string) => void;
  receiveOrder: (id: string) => void;
  /** Sync one order from the API response (maps snake_case → camelCase) */
  syncFromApi: (raw: Record<string, unknown>) => void;
}

const STORAGE_KEY = 'popmyc-purchases';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `po-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed purchase orders — fresh installations start empty.
// Purchase orders are created by the customer through the POS interface.
const seedOrders: PurchaseOrder[] = [];

interface StoredState {
  orders: PurchaseOrder[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.orders?.length > 0) {
        return parsed;
      }
    }
  } catch { /* noop */ }
  const initial = { orders: seedOrders };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const usePurchaseStore = create<PurchaseStore>((set) => {
  const initial = loadState();
  return {
    orders: initial.orders,

    addOrder: (data) => {
      const newOrder: PurchaseOrder = {
        ...data,
        id: genId(),
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [newOrder, ...state.orders];
        persist({ orders: next });
        return { orders: next };
      });
      return newOrder;
    },

    updateOrder: (id, data) => {
      set((state) => {
        const next = state.orders.map((o) => o.id === id ? { ...o, ...data } : o);
        persist({ orders: next });
        return { orders: next };
      });
    },

    cancelOrder: (id) => {
      set((state) => {
        const next = state.orders.map((o) =>
          o.id === id ? { ...o, status: 'CANCELLED' as PurchaseStatus } : o
        );
        persist({ orders: next });
        return { orders: next };
      });
    },

    receiveOrder: (id) => {
      set((state) => {
        const next = state.orders.map((o) =>
          o.id === id ? {
            ...o,
            status: 'RECEIVED' as PurchaseStatus,
            paymentStatus: 'PAID' as PaymentStatus,
            receivedDate: new Date().toISOString().slice(0, 10),
            amountPaid: o.totalAmount,
          } : o
        );
        persist({ orders: next });
        return { orders: next };
      });
      // Also call the real backend if available
      void (async () => {
        try {
          const token = localStorage.getItem('access_token') ?? '';
          if (!token || token.startsWith('local-session-')) return;
          await api.post(`/purchases/purchase-orders/${id}/receive_goods/`, {
            received_date: new Date().toISOString().slice(0, 10),
            items: [],
          });
        } catch { /* silently ignore — local state already updated */ }
      })();
    },

    syncFromApi: (raw) => {
      const items: PurchaseItem[] = ((raw.items ?? []) as Record<string, unknown>[]).map((it) => ({
        id:           String(it.id ?? ''),
        productName:  String(it.product_name ?? it.productName ?? ''),
        sku:          String(it.product_sku  ?? it.sku ?? ''),
        quantity:     Number(it.qty_ordered  ?? it.quantity ?? 0),
        unitPrice:    Number(it.unit_cost    ?? it.unitPrice ?? 0),
        receivedQty:  Number(it.qty_received ?? it.receivedQty ?? 0),
        subtotal:     Number(it.subtotal ?? 0),
        expiryDate:   (it.expiry_date as string | null) ?? null,
        batchNumber:  (it.batch_number as string | null) ?? null,
        batchId:             (it.batch as string | null) ?? null,
        batchPurchaseDate:   (it.batch_purchase_date  as string | null) ?? null,
        batchReceivedDate:   (it.batch_received_date  as string | null) ?? null,
        batchQtyPurchased:   (it.batch_qty_purchased  as number | null) ?? null,
        batchQtyReceived:    (it.batch_qty_received   as number | null) ?? null,
        batchQtyRemaining:   (it.batch_qty_remaining  as number | null) ?? null,
        batchStockOutDate:   (it.batch_stock_out_date as string | null) ?? null,
        batchDaysToSell:     (it.batch_days_to_sell   as number | null) ?? null,
        batchDaysInStock:    (it.batch_days_in_stock  as number | null) ?? null,
        batchIsSoldOut:      Boolean(it.batch_is_sold_out ?? false),
      }));

      const order: PurchaseOrder = {
        id:            String(raw.id ?? ''),
        poNumber:      String(raw.po_number ?? raw.poNumber ?? ''),
        supplierName:  String(raw.supplier_name ?? raw.supplierName ?? ''),
        supplierId:    String(raw.supplier ?? raw.supplierId ?? ''),
        items,
        subtotal:      Number(raw.subtotal ?? 0),
        taxAmount:     Number(raw.tax_amount ?? raw.taxAmount ?? 0),
        totalAmount:   Number(raw.total_amount ?? raw.totalAmount ?? 0),
        status:        (raw.status as PurchaseStatus) ?? 'DRAFT',
        paymentStatus: (raw.payment_status as PaymentStatus) ?? 'UNPAID',
        amountPaid:    Number(raw.amount_paid ?? raw.amountPaid ?? 0),
        orderDate:     String(raw.order_date  ?? raw.orderDate ?? ''),
        expectedDate:  String(raw.expected_date ?? raw.expectedDate ?? ''),
        receivedDate:  (raw.received_date as string | undefined) ?? undefined,
        notes:         String(raw.notes ?? ''),
        createdBy:     String(raw.created_by_name ?? raw.createdBy ?? ''),
        branchId:      (raw.branch as string | null) ?? null,
        createdAt:     String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
      };

      set((state) => {
        const exists = state.orders.some((o) => o.id === order.id);
        const next   = exists
          ? state.orders.map((o) => o.id === order.id ? order : o)
          : [order, ...state.orders];
        persist({ orders: next });
        return { orders: next };
      });
    },
  };
});
