import { create } from 'zustand';

export type SupplierType = 'MANUFACTURER' | 'DISTRIBUTOR' | 'WHOLESALER' | 'IMPORTER' | 'LOCAL';
export type TransactionType = 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'REFUND';

export interface SupplierRecord {
  id: string;
  name: string;
  code: string;
  supplierType: SupplierType;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  tin: string;
  creditLimit: number;
  creditDays: number;
  totalPurchases: number;
  totalPaid: number;
  balance: number;
  isActive: boolean;
  /** Branch this supplier is assigned to. null = shared across all branches. */
  branchId?: string | null;
  createdAt: string;
}

export interface SupplierAttachment {
  /** original file name e.g. "invoice-sept.jpg" */
  fileName: string;
  /** MIME type e.g. "image/jpeg" | "image/png" | "application/pdf" */
  mimeType: string;
  /** base64 data-URL: "data:image/jpeg;base64,…" */
  dataUrl: string;
  /** file size in bytes */
  size: number;
}

/** One product line on a supplier invoice */
export interface SupplierInvoiceItem {
  /** ID of the product in our system — undefined if item not in catalog yet, will be auto-created on save */
  productId?: string;
  /** Product name (copied at time of invoice, may differ from catalog later) */
  productName: string;
  /** SKU / product code */
  sku: string;
  /** Unit name display label e.g. "Box", "Carton" — from the system unit store */
  unit: string;
  /** ID from the system unit store — stored so the created product links to the correct unit */
  unitId?: string;
  /** Quantity received */
  quantity: number;
  /** Unit cost charged by the supplier (GHS) */
  unitCost: number;
  /** quantity × unitCost */
  subtotal: number;
}

export interface SupplierTransaction {
  id: string;
  supplierId: string;
  supplierName: string;
  type: TransactionType;
  reference: string;
  /** Computed from invoiceItems when type === 'INVOICE', otherwise entered manually */
  amount: number;
  balanceAfter: number;
  transactionDate: string;
  notes: string;
  /** Structured product line-items (INVOICE transactions only) */
  invoiceItems?: SupplierInvoiceItem[];
  /** Tax rate as a percentage e.g. 15 = 15% (INVOICE transactions only) */
  taxRate?: number;
  /** optional supplier physical invoice / delivery note attachments */
  attachments?: SupplierAttachment[];
  /** Branch this transaction belongs to. null = shared/legacy. */
  branchId?: string | null;
}

export interface SupplierStore {
  suppliers: SupplierRecord[];
  transactions: SupplierTransaction[];
  addSupplier: (data: Omit<SupplierRecord, 'id' | 'createdAt' | 'totalPurchases' | 'totalPaid' | 'balance'>) => SupplierRecord;
  updateSupplier: (id: string, data: Partial<SupplierRecord>) => void;
  deleteSupplier: (id: string) => void;
  addTransaction: (data: Omit<SupplierTransaction, 'id'>) => SupplierTransaction;
  /** Replace entire supplier list from API response (maps raw API records to store shape) */
  syncSuppliersFromApi: (records: SupplierRecord[]) => void;
  /** Merge/replace transactions for a specific supplier from API response */
  syncTransactionsFromApi: (supplierId: string, records: SupplierTransaction[]) => void;
}

const STORAGE_KEY = 'popmyc-suppliers';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sup-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed suppliers or transactions — fresh installations start empty.
// Suppliers are added by the customer through the POS interface.
const seedSuppliers: SupplierRecord[] = [];
const seedTransactions: SupplierTransaction[] = [];

interface StoredState {
  suppliers: SupplierRecord[];
  transactions: SupplierTransaction[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed && Array.isArray(parsed.suppliers) && Array.isArray(parsed.transactions)) {
        return parsed;
      }
    }
  } catch { /* noop */ }
  const initial = { suppliers: seedSuppliers, transactions: seedTransactions };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSupplierStore = create<SupplierStore>((set) => {
  const initial = loadState();
  return {
    suppliers: initial.suppliers,
    transactions: initial.transactions,

    addSupplier: (data) => {
      const newSupplier: SupplierRecord = {
        ...data,
        id: genId(),
        totalPurchases: 0,
        totalPaid: 0,
        balance: 0,
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [newSupplier, ...state.suppliers];
        persist({ suppliers: next, transactions: state.transactions });
        return { suppliers: next };
      });
      return newSupplier;
    },

    updateSupplier: (id, data) => {
      set((state) => {
        const next = state.suppliers.map((s) => s.id === id ? { ...s, ...data } : s);
        persist({ suppliers: next, transactions: state.transactions });
        return { suppliers: next };
      });
    },

    deleteSupplier: (id) => {
      set((state) => {
        const nextSuppliers = state.suppliers.filter((s) => s.id !== id);
        // also remove all transactions belonging to this supplier
        const nextTransactions = state.transactions.filter((t) => t.supplierId !== id);
        persist({ suppliers: nextSuppliers, transactions: nextTransactions });
        return { suppliers: nextSuppliers, transactions: nextTransactions };
      });
    },

    addTransaction: (data) => {
      const newTx: SupplierTransaction = { ...data, id: genId() };
      set((state) => {
        const nextTx = [newTx, ...state.transactions];
        // update supplier balance figures
        const nextSuppliers = state.suppliers.map((s) => {
          if (s.id !== data.supplierId) return s;
          const totalPurchases = data.amount > 0
            ? s.totalPurchases + data.amount
            : s.totalPurchases;
          const totalPaid = data.amount < 0
            ? s.totalPaid + Math.abs(data.amount)
            : s.totalPaid;
          return { ...s, totalPurchases, totalPaid, balance: totalPurchases - totalPaid };
        });
        persist({ suppliers: nextSuppliers, transactions: nextTx });
        return { suppliers: nextSuppliers, transactions: nextTx };
      });
      return newTx;
    },

    syncSuppliersFromApi: (records) => {
      set((state) => {
        // Merge: API records replace matching local records by ID;
        // local-only records (seed/offline) are kept.
        const apiIds = new Set(records.map((r) => r.id));
        const localOnly = state.suppliers.filter((s) => !apiIds.has(s.id));
        const merged   = [...records, ...localOnly];
        persist({ suppliers: merged, transactions: state.transactions });
        return { suppliers: merged };
      });
    },

    syncTransactionsFromApi: (supplierId, records) => {
      set((state) => {
        // Replace all transactions for this supplier with API records
        const otherTx    = state.transactions.filter((t) => t.supplierId !== supplierId);
        const merged     = [...records, ...otherTx];
        persist({ suppliers: state.suppliers, transactions: merged });
        return { transactions: merged };
      });
    },
  };
});
