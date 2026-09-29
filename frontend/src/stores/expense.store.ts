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

// No seed expense categories or expenses — fresh installations start empty.
// Categories and expenses are created by the customer through the POS interface.
const seedCategories: ExpenseCategory[] = [];
const seedExpenses: ExpenseRecord[] = [];

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
        return parsed;
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
