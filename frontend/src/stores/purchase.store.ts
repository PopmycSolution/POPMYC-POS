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

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

function daysFromNow(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
}

const seedOrders: PurchaseOrder[] = [
  {
    id: 'po1', poNumber: 'PO-240901-001', supplierName: 'Accra Wholesale Ltd', supplierId: 'sup1',
    items: [
      { id: 'pi1', productName: 'Rice Bag 5kg', sku: 'RC-5KG', quantity: 50, unitPrice: 72, receivedQty: 50, subtotal: 3600 },
      { id: 'pi2', productName: 'Cooking Oil 1L', sku: 'CO-1L', quantity: 100, unitPrice: 42, receivedQty: 100, subtotal: 4200 },
    ],
    subtotal: 7800, taxAmount: 0, totalAmount: 7800, status: 'RECEIVED', paymentStatus: 'PAID',
    amountPaid: 7800, orderDate: daysAgo(10).slice(0, 10), expectedDate: daysAgo(5).slice(0, 10),
    receivedDate: daysAgo(5).slice(0, 10), notes: 'Monthly restock', createdBy: 'Admin', branchId: 'branch-1', createdAt: daysAgo(10),
  },
  {
    id: 'po2', poNumber: 'PO-240902-002', supplierName: 'Kumasi Beverages Co', supplierId: 'sup2',
    items: [
      { id: 'pi3', productName: 'Coca-Cola Bottle 500ml', sku: 'CC-500', quantity: 200, unitPrice: 7.5, receivedQty: 200, subtotal: 1500 },
      { id: 'pi4', productName: 'Fanta Orange 500ml', sku: 'FN-500', quantity: 150, unitPrice: 7.5, receivedQty: 150, subtotal: 1125 },
      { id: 'pi5', productName: 'Sprite 500ml', sku: 'SP-500', quantity: 100, unitPrice: 7.5, receivedQty: 100, subtotal: 750 },
    ],
    subtotal: 3375, taxAmount: 0, totalAmount: 3375, status: 'RECEIVED', paymentStatus: 'PAID',
    amountPaid: 3375, orderDate: daysAgo(8).slice(0, 10), expectedDate: daysAgo(3).slice(0, 10),
    receivedDate: daysAgo(3).slice(0, 10), notes: '', createdBy: 'Admin', branchId: 'branch-2', createdAt: daysAgo(8),
  },
  {
    id: 'po3', poNumber: 'PO-240904-003', supplierName: 'Cocoa Import Ghana', supplierId: 'sup3',
    items: [
      { id: 'pi6', productName: 'Milo Tin 400g', sku: 'ML-400', quantity: 80, unitPrice: 38, receivedQty: 40, subtotal: 3040 },
      { id: 'pi7', productName: 'Ideal Milk Tin', sku: 'IM-TIN', quantity: 120, unitPrice: 22, receivedQty: 60, subtotal: 2640 },
    ],
    subtotal: 5680, taxAmount: 0, totalAmount: 5680, status: 'PARTIAL_RECEIVED', paymentStatus: 'PARTIAL',
    amountPaid: 3000, orderDate: daysAgo(5).slice(0, 10), expectedDate: daysFromNow(2),
    notes: 'Partial delivery received', createdBy: 'Admin', branchId: 'branch-1', createdAt: daysAgo(5),
  },
  {
    id: 'po4', poNumber: 'PO-240905-004', supplierName: 'Northern Foods PLC', supplierId: 'sup4',
    items: [
      { id: 'pi8', productName: 'Sugar Sachet 1kg', sku: 'SG-1KG', quantity: 200, unitPrice: 24, receivedQty: 0, subtotal: 4800 },
      { id: 'pi9', productName: 'Pure Water Sachet (500ml)', sku: 'PW-001', quantity: 500, unitPrice: 1.2, receivedQty: 0, subtotal: 600 },
    ],
    subtotal: 5400, taxAmount: 0, totalAmount: 5400, status: 'ORDERED', paymentStatus: 'UNPAID',
    amountPaid: 0, orderDate: daysAgo(2).slice(0, 10), expectedDate: daysFromNow(5),
    notes: 'Urgent restock needed', createdBy: 'Admin', branchId: 'branch-2', createdAt: daysAgo(2),
  },
  {
    id: 'po5', poNumber: 'PO-240906-005', supplierName: 'Sunshine Electronics Ltd', supplierId: 'sup6',
    items: [
      { id: 'pi10', productName: 'Phone Charger USB-C', sku: 'CHG-USC', quantity: 30, unitPrice: 45, receivedQty: 0, subtotal: 1350 },
      { id: 'pi11', productName: 'Screen Protector Galaxy', sku: 'SP-GAL', quantity: 50, unitPrice: 12, receivedQty: 0, subtotal: 600 },
    ],
    subtotal: 1950, taxAmount: 0, totalAmount: 1950, status: 'DRAFT', paymentStatus: 'UNPAID',
    amountPaid: 0, orderDate: daysAgo(0).slice(0, 10), expectedDate: daysFromNow(7),
    notes: 'Pending approval', createdBy: 'Admin', branchId: 'branch-3', createdAt: daysAgo(0),
  },
  {
    id: 'po6', poNumber: 'PO-240828-006', supplierName: 'Teshie Market Traders', supplierId: 'sup5',
    items: [
      { id: 'pi12', productName: 'Toilet Roll (Pack of 6)', sku: 'TR-6PK', quantity: 40, unitPrice: 28, receivedQty: 40, subtotal: 1120 },
      { id: 'pi13', productName: 'Dettol Soap 120g', sku: 'DT-120', quantity: 60, unitPrice: 14, receivedQty: 60, subtotal: 840 },
    ],
    subtotal: 1960, taxAmount: 0, totalAmount: 1960, status: 'CANCELLED', paymentStatus: 'UNPAID',
    amountPaid: 0, orderDate: daysAgo(15).slice(0, 10), expectedDate: daysAgo(10).slice(0, 10),
    notes: 'Cancelled - supplier out of stock', createdBy: 'Admin', branchId: 'branch-1', createdAt: daysAgo(15),
  },
];

interface StoredState {
  orders: PurchaseOrder[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.orders?.length > 0) {
        const needsMigration = parsed.orders.some(
          (o) => !Object.prototype.hasOwnProperty.call(o, 'branchId')
        );
        if (needsMigration) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          return parsed;
        }
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
            items: [],   // frontend will pass real items from the modal
          });
        } catch { /* silently ignore — local state already updated */ }
      })();
    },

    syncFromApi: (raw) => {
      // Map a backend API PurchaseOrder (snake_case) → store PurchaseOrder (camelCase)
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
        // Batch tracking
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
