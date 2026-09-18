import { create } from 'zustand';

export type ExpenseStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
export type ExpensePaymentMethod = 'CASH' | 'MTN_MOMO' | 'TELECEL_CASH' | 'AT_MONEY' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'CREDIT';
export type CategoryType = 'OPERATING' | 'COGS' | 'CAPEX' | 'TAX' | 'OTHER';

export interface ExpenseCategory {
  id: string;
  name: string;
  code: string;
  type: CategoryType;
  parentId?: string;
  isActive: boolean;
}

export interface ExpenseRecord {
  id: string;
  category: string;
  categoryName: string;
  expenseDate: string;
  referenceNumber: string;
  description: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  paymentMethod: ExpensePaymentMethod;
  status: ExpenseStatus;
  isTaxDeductible: boolean;
  createdBy: string;
  notes: string;
  /** Branch this expense belongs to. null = shared/legacy record. */
  branchId?: string | null;
  createdAt: string;
}

interface ExpenseStore {
  expenses: ExpenseRecord[];
  categories: ExpenseCategory[];
  addExpense: (data: Omit<ExpenseRecord, 'id' | 'createdAt'>) => ExpenseRecord;
  updateExpense: (id: string, data: Partial<ExpenseRecord>) => void;
  deleteExpense: (id: string) => void;
  approveExpense: (id: string) => void;
}

const STORAGE_KEY = 'popmyc-expenses';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedCategories: ExpenseCategory[] = [
  { id: 'cat1', name: 'Rent & Utilities', code: 'RENT', type: 'OPERATING', isActive: true },
  { id: 'cat2', name: 'Salaries & Wages', code: 'SALARY', type: 'OPERATING', isActive: true },
  { id: 'cat3', name: 'Transport & Fuel', code: 'TRANSPORT', type: 'OPERATING', isActive: true },
  { id: 'cat4', name: 'Office Supplies', code: 'OFFICE', type: 'OPERATING', isActive: true },
  { id: 'cat5', name: 'Marketing & Ads', code: 'MARKETING', type: 'OPERATING', isActive: true },
  { id: 'cat6', name: 'Stock Purchases', code: 'STOCK', type: 'COGS', isActive: true },
  { id: 'cat7', name: 'Equipment', code: 'EQUIP', type: 'CAPEX', isActive: true },
  { id: 'cat8', name: 'Taxes & Levies', code: 'TAX', type: 'TAX', isActive: true },
  { id: 'cat9', name: 'Repairs & Maintenance', code: 'REPAIR', type: 'OPERATING', isActive: true },
  { id: 'cat10', name: 'Miscellaneous', code: 'MISC', type: 'OTHER', isActive: true },
];

const seedExpenses: ExpenseRecord[] = [
  { id: 'exp1',  category: 'cat1', categoryName: 'Rent & Utilities',      expenseDate: daysAgo(1).slice(0,10),  referenceNumber: 'EXP-001', description: 'Monthly shop rent - September',  amount: 3500, taxAmount: 0,   totalAmount: 3500, paymentMethod: 'BANK_TRANSFER', status: 'PAID',     isTaxDeductible: true,  createdBy: 'Admin',   notes: 'Paid to landlord via bank',          branchId: 'branch-1', createdAt: daysAgo(1)  },
  { id: 'exp2',  category: 'cat1', categoryName: 'Rent & Utilities',      expenseDate: daysAgo(2).slice(0,10),  referenceNumber: 'EXP-002', description: 'ECG electricity bill',            amount: 850,  taxAmount: 0,   totalAmount: 850,  paymentMethod: 'MTN_MOMO',      status: 'PAID',     isTaxDeductible: true,  createdBy: 'Admin',   notes: '',                                   branchId: 'branch-1', createdAt: daysAgo(2)  },
  { id: 'exp3',  category: 'cat3', categoryName: 'Transport & Fuel',      expenseDate: daysAgo(0).slice(0,10),  referenceNumber: 'EXP-003', description: 'Delivery van fuel',               amount: 450,  taxAmount: 0,   totalAmount: 450,  paymentMethod: 'CASH',          status: 'APPROVED', isTaxDeductible: true,  createdBy: 'Cashier', notes: 'For Tema delivery route',            branchId: 'branch-2', createdAt: daysAgo(0)  },
  { id: 'exp4',  category: 'cat2', categoryName: 'Salaries & Wages',      expenseDate: daysAgo(5).slice(0,10),  referenceNumber: 'EXP-004', description: 'Staff salary - August',           amount: 8500, taxAmount: 0,   totalAmount: 8500, paymentMethod: 'BANK_TRANSFER', status: 'PAID',     isTaxDeductible: true,  createdBy: 'Admin',   notes: 'Monthly payroll',                    branchId: 'branch-1', createdAt: daysAgo(5)  },
  { id: 'exp5',  category: 'cat4', categoryName: 'Office Supplies',       expenseDate: daysAgo(3).slice(0,10),  referenceNumber: 'EXP-005', description: 'Receipt rolls (10 boxes)',        amount: 280,  taxAmount: 42,  totalAmount: 322,  paymentMethod: 'CASH',          status: 'PAID',     isTaxDeductible: true,  createdBy: 'Cashier', notes: '',                                   branchId: 'branch-1', createdAt: daysAgo(3)  },
  { id: 'exp6',  category: 'cat5', categoryName: 'Marketing & Ads',       expenseDate: daysAgo(7).slice(0,10),  referenceNumber: 'EXP-006', description: 'Facebook ads campaign',           amount: 1200, taxAmount: 0,   totalAmount: 1200, paymentMethod: 'CARD',          status: 'PAID',     isTaxDeductible: false, createdBy: 'Admin',   notes: 'September promo campaign',           branchId: 'branch-1', createdAt: daysAgo(7)  },
  { id: 'exp7',  category: 'cat9', categoryName: 'Repairs & Maintenance', expenseDate: daysAgo(4).slice(0,10),  referenceNumber: 'EXP-007', description: 'POS printer repair',              amount: 350,  taxAmount: 0,   totalAmount: 350,  paymentMethod: 'CASH',          status: 'APPROVED', isTaxDeductible: true,  createdBy: 'Admin',   notes: '',                                   branchId: 'branch-2', createdAt: daysAgo(4)  },
  { id: 'exp8',  category: 'cat7', categoryName: 'Equipment',             expenseDate: daysAgo(10).slice(0,10), referenceNumber: 'EXP-008', description: 'New barcode scanner',             amount: 2800, taxAmount: 420, totalAmount: 3220, paymentMethod: 'BANK_TRANSFER', status: 'PAID',     isTaxDeductible: true,  createdBy: 'Admin',   notes: 'Honeywell 1D/2D scanner',            branchId: 'branch-1', createdAt: daysAgo(10) },
  { id: 'exp9',  category: 'cat8', categoryName: 'Taxes & Levies',        expenseDate: daysAgo(12).slice(0,10), referenceNumber: 'EXP-009', description: 'GRA quarterly tax payment',       amount: 5500, taxAmount: 0,   totalAmount: 5500, paymentMethod: 'BANK_TRANSFER', status: 'PAID',     isTaxDeductible: false, createdBy: 'Admin',   notes: 'Q2 2024 estimated tax',              branchId: 'branch-1', createdAt: daysAgo(12) },
  { id: 'exp10', category: 'cat10',categoryName: 'Miscellaneous',         expenseDate: daysAgo(0).slice(0,10),  referenceNumber: 'EXP-010', description: 'Staff lunch allowance',           amount: 150,  taxAmount: 0,   totalAmount: 150,  paymentMethod: 'CASH',          status: 'DRAFT',    isTaxDeductible: false, createdBy: 'Cashier', notes: '',                                   branchId: 'branch-2', createdAt: daysAgo(0)  },
  { id: 'exp11', category: 'cat1', categoryName: 'Rent & Utilities',      expenseDate: daysAgo(1).slice(0,10),  referenceNumber: 'EXP-011', description: 'Ghana Water Company bill',        amount: 320,  taxAmount: 0,   totalAmount: 320,  paymentMethod: 'MTN_MOMO',      status: 'PENDING',  isTaxDeductible: true,  createdBy: 'Admin',   notes: '',                                   branchId: 'branch-3', createdAt: daysAgo(1)  },
  { id: 'exp12', category: 'cat3', categoryName: 'Transport & Fuel',      expenseDate: daysAgo(6).slice(0,10),  referenceNumber: 'EXP-012', description: 'Taxi for bank deposit',           amount: 80,   taxAmount: 0,   totalAmount: 80,   paymentMethod: 'CASH',          status: 'REJECTED', isTaxDeductible: true,  createdBy: 'Cashier', notes: 'Rejected - use company vehicle',     branchId: 'branch-3', createdAt: daysAgo(6)  },
];

interface StoredState {
  expenses: ExpenseRecord[];
  categories: ExpenseCategory[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.expenses?.length > 0) {
        const needsMigration = parsed.expenses.some(
          (e) => !Object.prototype.hasOwnProperty.call(e, 'branchId')
        );
        if (needsMigration) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          return parsed;
        }
      }
    }
  } catch { /* noop */ }
  const initial = { expenses: seedExpenses, categories: seedCategories };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useExpenseStore = create<ExpenseStore>((set) => {
  const initial = loadState();
  return {
    expenses: initial.expenses,
    categories: initial.categories,

    addExpense: (data) => {
      const newExpense: ExpenseRecord = {
        ...data,
        id: genId(),
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [newExpense, ...state.expenses];
        persist({ expenses: next, categories: state.categories });
        return { expenses: next };
      });
      return newExpense;
    },

    updateExpense: (id, data) => {
      set((state) => {
        const next = state.expenses.map((e) => e.id === id ? { ...e, ...data } : e);
        persist({ expenses: next, categories: state.categories });
        return { expenses: next };
      });
    },

    deleteExpense: (id) => {
      set((state) => {
        const next = state.expenses.filter((e) => e.id !== id);
        persist({ expenses: next, categories: state.categories });
        return { expenses: next };
      });
    },

    approveExpense: (id) => {
      set((state) => {
        const next = state.expenses.map((e) =>
          e.id === id ? { ...e, status: 'APPROVED' as ExpenseStatus } : e
        );
        persist({ expenses: next, categories: state.categories });
        return { expenses: next };
      });
    },
  };
});
