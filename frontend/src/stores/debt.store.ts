import { create } from 'zustand';
import type { CartItem } from '@/types';

export type DebtStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'WRITTEN_OFF';

export interface DebtRecord {
  id: string;
  invoiceNumber: string;
  reference: string;
  customerName: string;
  customerPhone?: string;
  cashierName: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountOwed: number;
  status: DebtStatus;
  notes: string;
  /** Branch this debt belongs to. null = legacy record. */
  branchId?: string | null;
  createdAt: string;
  dueDate?: string;
  payments: DebtPayment[];
}

export interface DebtPayment {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  cashierName: string;
  notes: string;
}

interface DebtStore {
  debts: DebtRecord[];
  addDebt: (data: Omit<DebtRecord, 'id' | 'createdAt' | 'payments' | 'amountOwed' | 'status'>) => DebtRecord;
  recordPayment: (debtId: string, payment: Omit<DebtPayment, 'id' | 'paidAt'>) => void;
  writeOff: (debtId: string) => void;
}

const STORAGE_KEY = 'popmyc-debts';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `dbt-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function loadState(): DebtRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DebtRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Migration: wipe if any record is missing branchId
        const needsMigration = parsed.some(
          (d) => !Object.prototype.hasOwnProperty.call(d, 'branchId')
        );
        if (needsMigration) {
          localStorage.removeItem(STORAGE_KEY);
          return [];
        }
        return parsed;
      }
    }
  } catch { /* noop */ }
  return [];
}

function persist(debts: DebtRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(debts));
}

export const useDebtStore = create<DebtStore>((set) => ({
  debts: loadState(),

  addDebt: (data) => {
    const newDebt: DebtRecord = {
      ...data,
      id:        genId(),
      createdAt: new Date().toISOString(),
      amountOwed: data.totalAmount - data.amountPaid,
      status:    data.amountPaid > 0 ? 'PARTIAL' : 'UNPAID',
      payments:  [],
    };
    set((state) => {
      const next = [newDebt, ...state.debts];
      persist(next);
      return { debts: next };
    });
    return newDebt;
  },

  recordPayment: (debtId, paymentData) => {
    set((state) => {
      const next = state.debts.map((d) => {
        if (d.id !== debtId) return d;
        const payment: DebtPayment = { ...paymentData, id: genId(), paidAt: new Date().toISOString() };
        const newPaid = d.amountPaid + paymentData.amount;
        const newOwed = Math.max(0, d.totalAmount - newPaid);
        const updated: DebtRecord = {
          ...d,
          amountPaid: newPaid,
          amountOwed: newOwed,
          status:     newOwed <= 0 ? 'PAID' : 'PARTIAL',
          payments:   [...d.payments, payment],
        };
        return updated;
      });
      persist(next);
      return { debts: next };
    });
  },

  writeOff: (debtId) => {
    set((state) => {
      const next = state.debts.map((d) =>
        d.id === debtId ? { ...d, status: 'WRITTEN_OFF' as DebtStatus } : d
      );
      persist(next);
      return { debts: next };
    });
  },
}));
