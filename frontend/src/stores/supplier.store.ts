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

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedSuppliers: SupplierRecord[] = [
  { id: 'sup1', name: 'Accra Wholesale Ltd',        code: 'SUP-001', supplierType: 'WHOLESALER',   contactPerson: 'Kwesi Amponsah',  phone: '0244111222', email: 'kwesi@accrawholesale.com',  address: '45 Industrial Area',   city: 'Accra',      country: 'Ghana', tin: 'C0011223344', creditLimit: 50000,  creditDays: 30, totalPurchases: 125000, totalPaid: 110000, balance: 15000, isActive: true,  branchId: 'branch-1', createdAt: daysAgo(365) },
  { id: 'sup2', name: 'Kumasi Beverages Co',         code: 'SUP-002', supplierType: 'DISTRIBUTOR',  contactPerson: 'Yaw Boateng',     phone: '0201333444', email: 'yaw@kumabev.com',            address: '12 Suame Magazine Rd', city: 'Kumasi',     country: 'Ghana', tin: 'C0022334455', creditLimit: 30000,  creditDays: 14, totalPurchases: 85000,  totalPaid: 82000,  balance: 3000,  isActive: true,  branchId: 'branch-2', createdAt: daysAgo(300) },
  { id: 'sup3', name: 'Cocoa Import Ghana',          code: 'SUP-003', supplierType: 'IMPORTER',     contactPerson: 'Nana Adjei',      phone: '0277555666', email: 'nana@cocoaimport.com',       address: '8 Harbour Road',       city: 'Tema',       country: 'Ghana', tin: 'C0033445566', creditLimit: 100000, creditDays: 45, totalPurchases: 240000, totalPaid: 200000, balance: 40000, isActive: true,  branchId: 'branch-1', createdAt: daysAgo(400) },
  { id: 'sup4', name: 'Northern Foods PLC',          code: 'SUP-004', supplierType: 'MANUFACTURER', contactPerson: 'Alhassan Ibrahim', phone: '0266777888', email: 'alhassan@northernfoods.com', address: 'Industrial Zone',      city: 'Tamale',     country: 'Ghana', tin: 'C0044556677', creditLimit: 80000,  creditDays: 30, totalPurchases: 180000, totalPaid: 175000, balance: 5000,  isActive: true,  branchId: 'branch-1', createdAt: daysAgo(250) },
  { id: 'sup5', name: 'Teshie Market Traders',       code: 'SUP-005', supplierType: 'LOCAL',        contactPerson: 'Auntie Ama',      phone: '0551999000', email: '',                           address: 'Teshie Market',        city: 'Accra',      country: 'Ghana', tin: '',            creditLimit: 5000,   creditDays: 7,  totalPurchases: 22000,  totalPaid: 22000,  balance: 0,     isActive: true,  branchId: 'branch-1', createdAt: daysAgo(180) },
  { id: 'sup6', name: 'Sunshine Electronics Ltd',    code: 'SUP-006', supplierType: 'IMPORTER',     contactPerson: 'David Chen',      phone: '0244888999', email: 'david@sunshineelec.com',     address: '23 Circle Market',     city: 'Accra',      country: 'Ghana', tin: 'C0066778899', creditLimit: 60000,  creditDays: 21, totalPurchases: 95000,  totalPaid: 90000,  balance: 5000,  isActive: true,  branchId: 'branch-2', createdAt: daysAgo(200) },
  { id: 'sup7', name: 'Cape Coast Pharmaceuticals',  code: 'SUP-007', supplierType: 'DISTRIBUTOR',  contactPerson: 'Dr. Efua Mensah', phone: '0507222333', email: 'efua@ccpharma.com',          address: '5 Victoria Park',      city: 'Cape Coast', country: 'Ghana', tin: 'C0077889900', creditLimit: 40000,  creditDays: 30, totalPurchases: 68000,  totalPaid: 68000,  balance: 0,     isActive: false, branchId: 'branch-3', createdAt: daysAgo(150) },
  { id: 'sup8', name: 'Volta Region Agro',           code: 'SUP-008', supplierType: 'MANUFACTURER', contactPerson: 'Kofi Agbeko',     phone: '0209444555', email: 'kofi@voltaagro.com',         address: 'Ho Main Road',         city: 'Ho',         country: 'Ghana', tin: 'C0088990011', creditLimit: 25000,  creditDays: 14, totalPurchases: 42000,  totalPaid: 38000,  balance: 4000,  isActive: true,  branchId: 'branch-3', createdAt: daysAgo(120) },
];

const seedTransactions: SupplierTransaction[] = [
  {
    id: 'st1', supplierId: 'sup1', supplierName: 'Accra Wholesale Ltd',
    type: 'INVOICE', reference: 'INV-240901-001',
    amount: 15000, balanceAfter: 15000,
    transactionDate: daysAgo(3).slice(0, 10),
    notes: 'Bulk order - rice and oil',
    taxRate: 0,
    invoiceItems: [
      { productId: 'p11', productName: 'Rice Bag 5kg',    sku: 'RC-5KG', unit: 'Bag',    quantity: 100, unitCost: 75,    subtotal: 7500  },
      { productId: 'p12', productName: 'Cooking Oil 1L',  sku: 'CO-1L',  unit: 'Carton', quantity: 70,  unitCost: 42,    subtotal: 2940  },
      { productId: 'p6',  productName: 'Sugar Sachet 1kg',sku: 'SG-1KG', unit: 'Bag',    quantity: 92,  unitCost: 25,    subtotal: 2300  },
      { productName: 'Tomato Paste 400g', sku: 'TP-400',  unit: 'Carton',quantity: 130,  unitCost: 17.38,subtotal: 2260 },
    ],
  },
  {
    id: 'st2', supplierId: 'sup1', supplierName: 'Accra Wholesale Ltd',
    type: 'PAYMENT', reference: 'PAY-240902-001',
    amount: -8000, balanceAfter: 7000,
    transactionDate: daysAgo(2).slice(0, 10),
    notes: 'Mobile money payment',
  },
  {
    id: 'st3', supplierId: 'sup3', supplierName: 'Cocoa Import Ghana',
    type: 'INVOICE', reference: 'INV-240830-003',
    amount: 45000, balanceAfter: 45000,
    transactionDate: daysAgo(8).slice(0, 10),
    notes: 'Imported cocoa products',
    taxRate: 15,
    invoiceItems: [
      { productName: 'Cocoa Powder 1kg',   sku: 'CP-1KG', unit: 'Bag',    quantity: 500, unitCost: 52.17, subtotal: 26087 },
      { productName: 'Dark Chocolate Bar', sku: 'DC-BAR', unit: 'Carton', quantity: 300, unitCost: 39.13, subtotal: 11739 },
      { productName: 'Cocoa Butter 500g',  sku: 'CB-500', unit: 'Box',    quantity: 100, unitCost: 71.96, subtotal: 7196  },
    ],
  },
  {
    id: 'st4', supplierId: 'sup3', supplierName: 'Cocoa Import Ghana',
    type: 'PAYMENT', reference: 'PAY-240901-002',
    amount: -25000, balanceAfter: 20000,
    transactionDate: daysAgo(5).slice(0, 10),
    notes: 'Bank transfer',
  },
  {
    id: 'st5', supplierId: 'sup2', supplierName: 'Kumasi Beverages Co',
    type: 'INVOICE', reference: 'INV-240903-002',
    amount: 8500, balanceAfter: 3000,
    transactionDate: daysAgo(1).slice(0, 10),
    notes: 'Weekly beverage delivery',
    taxRate: 0,
    invoiceItems: [
      { productId: 'p1',  productName: 'Pure Water Sachet (500ml)', sku: 'PW-001', unit: 'Crate',  quantity: 1000, unitCost: 0.80, subtotal: 800  },
      { productId: 'p2',  productName: 'Coca-Cola Bottle 500ml',    sku: 'CC-500', unit: 'Crate',  quantity: 400,  unitCost: 6.50, subtotal: 2600 },
      { productId: 'p5',  productName: 'Fanta Orange 500ml',        sku: 'FN-500', unit: 'Crate',  quantity: 400,  unitCost: 6.50, subtotal: 2600 },
      { productId: 'p10', productName: 'Sprite 500ml',              sku: 'SP-500', unit: 'Crate',  quantity: 384,  unitCost: 6.50, subtotal: 2500 },
    ],
  },
  {
    id: 'st6', supplierId: 'sup4', supplierName: 'Northern Foods PLC',
    type: 'PAYMENT', reference: 'PAY-240901-003',
    amount: -10000, balanceAfter: 5000,
    transactionDate: daysAgo(4).slice(0, 10),
    notes: 'Cheque payment',
  },
];

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
        // Migration: wipe if any supplier is missing branchId
        const needsMigration = parsed.suppliers.length > 0 && parsed.suppliers.some(
          (s) => !Object.prototype.hasOwnProperty.call(s, 'branchId')
        );
        if (needsMigration) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          return parsed;
        }
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
