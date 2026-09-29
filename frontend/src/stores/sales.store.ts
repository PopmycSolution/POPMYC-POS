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

// No seed sales — fresh installations start with zero transactions.
// All sales are created by the customer through the POS checkout screen.
const seedSales: SaleRecord[] = [];

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
