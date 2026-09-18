import { create } from 'zustand';
import type { CartItem } from '@/types';

export type SaleStatus = 'COMPLETED' | 'VOIDED' | 'REFUNDED' | 'PARTIAL_REFUND' | 'DRAFT' | 'HELD';
export type PaymentStatus = 'PAID' | 'UNPAID' | 'PARTIAL' | 'OVERPAID' | 'CREDIT';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

export interface SaleRecord {
  id: string;
  /**
   * Stable, client-generated UUID used as the idempotency key when uploading
   * to the server. Set once at creation and never changed. This ensures that
   * if the same sale is retried, the server recognises it as a duplicate.
   */
  offlineUuid: string;
  reference: string;
  invoiceNumber: string;
  customerName: string;
  cashierName: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  amountPaid: number;
  changeAmount: number;
  amountOwed: number;
  status: SaleStatus;
  paymentStatus: PaymentStatus;
  totalQty: number;
  notes: string;
  branchId: string | null;
  createdAt: string;
  /** Sync lifecycle state — defaults to 'pending' for new local sales */
  syncStatus: SyncStatus;
  syncedAt?: string | null;
  syncError?: string | null;
}

interface SalesStore {
  sales: SaleRecord[];
  addSale: (sale: Omit<SaleRecord, 'id' | 'createdAt' | 'offlineUuid' | 'syncStatus' | 'syncedAt' | 'syncError'> & { branchId?: string | null }) => SaleRecord;
  voidSale: (id: string) => void;
  /** Called by the sync engine to update a sale's sync lifecycle state */
  updateSaleSync: (offlineUuid: string, patch: Pick<SaleRecord, 'syncStatus'> & { syncedAt?: string | null; syncError?: string | null }) => void;
}

const STORAGE_KEY = 'popmyc-sales';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

const now = new Date();
function daysAgo(d: number, h = 10, m = 0): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  dt.setHours(h, m, 0, 0);
  return dt.toISOString();
}

function genRef(d: number): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  const ds = dt.toISOString().slice(0, 10).replace(/-/g, '');
  return `SL-${ds}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

function genInv(d: number, seq: number): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  const ds = dt.toISOString().slice(2, 10).replace(/-/g, '');
  return `INV-${ds}-${String(seq).padStart(4, '0')}`;
}

// Seed data uses a looser type — migration in loadState backfills the new fields
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const seedSales: SaleRecord[] = ([
  {
    id: 'sale1', reference: genRef(0), invoiceNumber: genInv(0, 42),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si1', productId: 'p1', name: 'Pure Water Sachet (500ml)', sku: 'PW-001', price: 2.00, quantity: 10, subtotal: 20.00 },
      { id: 'si2', productId: 'p16', name: 'Luxury Biscuit Pack', sku: 'BX-LUX', price: 35.00, quantity: 2, subtotal: 70.00 },
    ],
    subtotal: 90.00, taxAmount: 0, discountAmount: 0, totalAmount: 90.00,
    paymentMethod: 'CASH', amountPaid: 100.00, changeAmount: 10.00,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 12, notes: '', createdAt: daysAgo(0, 14, 30),
  },
  {
    id: 'sale2', reference: genRef(0), invoiceNumber: genInv(0, 41),
    customerName: 'Kofi Mensah', cashierName: 'Admin User',
    items: [
      { id: 'si3', productId: 'p11', name: 'Rice Bag 5kg', sku: 'RC-5KG', price: 95.00, quantity: 1, subtotal: 95.00 },
      { id: 'si4', productId: 'p12', name: 'Cooking Oil 1L', sku: 'CO-1L', price: 55.00, quantity: 1, subtotal: 55.00 },
      { id: 'si5', productId: 'p6', name: 'Sugar Sachet 1kg', sku: 'SG-1KG', price: 32.00, quantity: 1, subtotal: 32.00 },
    ],
    subtotal: 182.00, taxAmount: 0, discountAmount: 0, totalAmount: 182.00,
    paymentMethod: 'MOBILE_MONEY', amountPaid: 182.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 3, notes: '', createdAt: daysAgo(0, 11, 15),
  },
  {
    id: 'sale3', reference: genRef(1), invoiceNumber: genInv(1, 40),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si6', productId: 'p2', name: 'Coca-Cola Bottle 500ml', sku: 'CC-500', price: 10.00, quantity: 3, subtotal: 30.00 },
      { id: 'si7', productId: 'p5', name: 'Fanta Orange 500ml', sku: 'FN-500', price: 10.00, quantity: 2, subtotal: 20.00 },
    ],
    subtotal: 50.00, taxAmount: 0, discountAmount: 0, totalAmount: 50.00,
    paymentMethod: 'CASH', amountPaid: 50.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 5, notes: '', createdAt: daysAgo(1, 16, 45),
  },
  {
    id: 'sale4', reference: genRef(1), invoiceNumber: genInv(1, 39),
    customerName: 'Ama Serwaa', cashierName: 'Admin User',
    items: [
      { id: 'si8', productId: 'p9', name: 'Dettol Soap 120g', sku: 'DT-120', price: 18.00, quantity: 3, subtotal: 54.00 },
      { id: 'si9', productId: 'p15', name: 'Colgate Toothpaste 100ml', sku: 'CL-100', price: 22.00, quantity: 2, subtotal: 44.00 },
      { id: 'si10', productId: 'p13', name: 'Toilet Roll (Pack of 6)', sku: 'TR-6PK', price: 38.00, quantity: 1, subtotal: 38.00 },
    ],
    subtotal: 136.00, taxAmount: 0, discountAmount: 0, totalAmount: 136.00,
    paymentMethod: 'CARD', amountPaid: 136.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 6, notes: '', createdAt: daysAgo(1, 13, 20),
  },
  {
    id: 'sale5', reference: genRef(2), invoiceNumber: genInv(2, 38),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si11', productId: 'p3', name: 'Loaf of Bread (Sliced)', sku: 'BR-001', price: 15.00, quantity: 2, subtotal: 30.00 },
      { id: 'si12', productId: 'p14', name: 'Eggs (Crate of 30)', sku: 'EG-30', price: 22.00, quantity: 1, subtotal: 22.00 },
    ],
    subtotal: 52.00, taxAmount: 0, discountAmount: 0, totalAmount: 52.00,
    paymentMethod: 'CASH', amountPaid: 60.00, changeAmount: 8.00,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 3, notes: '', createdAt: daysAgo(2, 9, 30),
  },
  {
    id: 'sale6', reference: genRef(2), invoiceNumber: genInv(2, 37),
    customerName: 'Kwame Boateng', cashierName: 'Admin User',
    items: [
      { id: 'si13', productId: 'p7', name: 'Omo Detergent 500g', sku: 'OM-500', price: 45.00, quantity: 2, subtotal: 90.00 },
    ],
    subtotal: 90.00, taxAmount: 0, discountAmount: 0, totalAmount: 90.00,
    paymentMethod: 'MOBILE_MONEY', amountPaid: 90.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 2, notes: '', createdAt: daysAgo(2, 15, 10),
  },
  {
    id: 'sale7', reference: genRef(3), invoiceNumber: genInv(3, 36),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si14', productId: 'p4', name: 'Milo Tin 400g', sku: 'ML-400', price: 50.00, quantity: 1, subtotal: 50.00 },
      { id: 'si15', productId: 'p8', name: 'Ideal Milk Tin', sku: 'IM-TIN', price: 28.00, quantity: 2, subtotal: 56.00 },
      { id: 'si16', productId: 'p6', name: 'Sugar Sachet 1kg', sku: 'SG-1KG', price: 32.00, quantity: 1, subtotal: 32.00 },
    ],
    subtotal: 138.00, taxAmount: 0, discountAmount: 0, totalAmount: 138.00,
    paymentMethod: 'CASH', amountPaid: 150.00, changeAmount: 12.00,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 4, notes: '', createdAt: daysAgo(3, 10, 0),
  },
  {
    id: 'sale8', reference: genRef(3), invoiceNumber: genInv(3, 35),
    customerName: 'Abena Osei', cashierName: 'Admin User',
    items: [
      { id: 'si17', productId: 'p18', name: 'Yoghurt Drink 500ml', sku: 'YG-500', price: 14.00, quantity: 4, subtotal: 56.00 },
      { id: 'si18', productId: 'p16', name: 'Luxury Biscuit Pack', sku: 'BX-LUX', price: 35.00, quantity: 3, subtotal: 105.00 },
    ],
    subtotal: 161.00, taxAmount: 0, discountAmount: 0, totalAmount: 161.00,
    paymentMethod: 'CASH', amountPaid: 161.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 7, notes: '', createdAt: daysAgo(3, 14, 30),
  },
  {
    id: 'sale9', reference: genRef(4), invoiceNumber: genInv(4, 34),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si19', productId: 'p10', name: 'Sprite 500ml', sku: 'SP-500', price: 10.00, quantity: 5, subtotal: 50.00 },
    ],
    subtotal: 50.00, taxAmount: 0, discountAmount: 0, totalAmount: 50.00,
    paymentMethod: 'CASH', amountPaid: 50.00, changeAmount: 0,
    branchId: 'branch-1', status: 'VOIDED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 5, notes: 'Customer returned all items', createdAt: daysAgo(4, 11, 0),
  },
  {
    id: 'sale10', reference: genRef(5), invoiceNumber: genInv(5, 33),
    customerName: 'Yaw Darko', cashierName: 'Admin User',
    items: [
      { id: 'si20', productId: 'p17', name: 'Sanitary Pads (Pack)', sku: 'SP-PK', price: 25.00, quantity: 3, subtotal: 75.00 },
      { id: 'si21', productId: 'p9', name: 'Dettol Soap 120g', sku: 'DT-120', price: 18.00, quantity: 2, subtotal: 36.00 },
    ],
    subtotal: 111.00, taxAmount: 0, discountAmount: 0, totalAmount: 111.00,
    paymentMethod: 'MOBILE_MONEY', amountPaid: 111.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 5, notes: '', createdAt: daysAgo(5, 9, 15),
  },
  {
    id: 'sale11', reference: genRef(6), invoiceNumber: genInv(6, 32),
    customerName: 'Walk-in Customer', cashierName: 'Admin User',
    items: [
      { id: 'si22', productId: 'p11', name: 'Rice Bag 5kg', sku: 'RC-5KG', price: 95.00, quantity: 2, subtotal: 190.00 },
    ],
    subtotal: 190.00, taxAmount: 0, discountAmount: 0, totalAmount: 190.00,
    paymentMethod: 'BANK_TRANSFER', amountPaid: 190.00, changeAmount: 0,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 2, notes: '', createdAt: daysAgo(6, 16, 0),
  },
  {
    id: 'sale12', reference: genRef(7), invoiceNumber: genInv(7, 31),
    customerName: 'Akosua Frimpong', cashierName: 'Admin User',
    items: [
      { id: 'si23', productId: 'p1', name: 'Pure Water Sachet (500ml)', sku: 'PW-001', price: 2.00, quantity: 20, subtotal: 40.00 },
      { id: 'si24', productId: 'p3', name: 'Loaf of Bread (Sliced)', sku: 'BR-001', price: 15.00, quantity: 3, subtotal: 45.00 },
      { id: 'si25', productId: 'p14', name: 'Eggs (Crate of 30)', sku: 'EG-30', price: 22.00, quantity: 2, subtotal: 44.00 },
      { id: 'si26', productId: 'p18', name: 'Yoghurt Drink 500ml', sku: 'YG-500', price: 14.00, quantity: 5, subtotal: 70.00 },
    ],
    subtotal: 199.00, taxAmount: 0, discountAmount: 0, totalAmount: 199.00,
    paymentMethod: 'CASH', amountPaid: 200.00, changeAmount: 1.00,
    branchId: 'branch-1', status: 'COMPLETED', paymentStatus: 'PAID', amountOwed: 0, totalQty: 30, notes: 'Bulk family purchase', createdAt: daysAgo(7, 8, 30),
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
] as any[]).map((s: any): SaleRecord => ({
  ...s,
  offlineUuid: s.offlineUuid ?? s.id,
  syncStatus:  s.syncStatus  ?? 'synced',
  syncedAt:    s.syncedAt    ?? null,
  syncError:   s.syncError   ?? null,
}));

interface StoredState {
  sales: SaleRecord[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.sales?.length > 0) {
        // Safe migration: backfill new fields instead of wiping all data
        const migrated = parsed.sales.map((s): SaleRecord => ({
          ...s,
          branchId:    s.branchId    ?? null,
          offlineUuid: s.offlineUuid ?? s.id,
          syncStatus:  s.syncStatus  ?? 'pending',
          syncedAt:    s.syncedAt    ?? null,
          syncError:   s.syncError   ?? null,
        }));
        return { sales: migrated };
      }
    }
  } catch { /* noop */ }
  const initial = { sales: seedSales };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSalesStore = create<SalesStore>((set) => {
  const initial = loadState();
  return {
    sales: initial.sales,

    addSale: (saleData) => {
      const offlineUuid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `sale-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      const newSale: SaleRecord = {
        ...saleData,
        branchId:    saleData.branchId ?? null,
        offlineUuid,
        id:          genId(),
        createdAt:   new Date().toISOString(),
        syncStatus:  'pending',
        syncedAt:    null,
        syncError:   null,
      };
      set((state) => {
        const next = [newSale, ...state.sales];
        persist({ sales: next });
        return { sales: next };
      });
      return newSale;
    },

    voidSale: (id) => {
      set((state) => {
        const next = state.sales.map((s) =>
          s.id === id ? { ...s, status: 'VOIDED' as SaleStatus } : s
        );
        persist({ sales: next });
        return { sales: next };
      });
    },

    updateSaleSync: (offlineUuid, patch) => {
      set((state) => {
        const next = state.sales.map((s) =>
          s.offlineUuid === offlineUuid ? { ...s, ...patch } : s
        );
        persist({ sales: next });
        return { sales: next };
      });
    },
  };
});
