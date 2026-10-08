import { create } from 'zustand';
import { useSyncStore } from './sync.store';

export interface CustomerRecord {
  id: string;
  firstName: string;
  lastName: string;
  company?: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  creditLimit: number;
  creditBalance: number;
  loyaltyPoints: number;
  totalPurchases: number;
  totalTransactions: number;
  group: string;
  isActive: boolean;
  /** Branch this customer belongs to. null = shared/legacy record visible to all. */
  branchId?: string | null;
  createdAt: string;
}

interface CustomerStore {
  customers: CustomerRecord[];
  addCustomer: (data: Omit<CustomerRecord, 'id' | 'createdAt' | 'totalPurchases' | 'totalTransactions' | 'creditBalance' | 'loyaltyPoints'>) => CustomerRecord;
  updateCustomer: (id: string, data: Partial<CustomerRecord>) => void;
  deleteCustomer: (id: string) => void;
}

const STORAGE_KEY = 'popmyc-customers';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `c-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed customers — fresh installations start empty.
// Customers are added by the customer through the POS interface.
const seedCustomers: CustomerRecord[] = [];

interface StoredState { customers: CustomerRecord[] }

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.customers?.length > 0) {
        // Migration: if any record is missing branchId, wipe and re-seed
        const needsMigration = parsed.customers.some(
          (c) => !Object.prototype.hasOwnProperty.call(c, 'branchId')
        );
        if (needsMigration) {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          return parsed;
        }
      }
    }
  } catch { /* noop */ }
  const initial = { customers: seedCustomers };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const auth = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
    return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
  } catch { return { businessId: null, branchId: null }; }
}

export const useCustomerStore = create<CustomerStore>((set) => {
  const initial = loadState();
  return {
    customers: initial.customers,

    addCustomer: (data) => {
      const newCustomer: CustomerRecord = {
        ...data,
        id: genId(),
        creditBalance: 0,
        loyaltyPoints: 0,
        totalPurchases: 0,
        totalTransactions: 0,
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [newCustomer, ...state.customers];
        persist({ customers: next });
        return { customers: next };
      });
      useSyncStore.getState().enqueue({
        offlineUuid: newCustomer.id,
        appLabel: 'customers',
        modelName: 'customer',
        action: 'create',
        payload: newCustomer as unknown as Record<string, unknown>,
        ...getAuthContext(),
        version: 1,
      });
      return newCustomer;
    },

    updateCustomer: (id, data) => {
      set((state) => {
        const next = state.customers.map((c) => c.id === id ? { ...c, ...data } : c);
        persist({ customers: next });
        return { customers: next };
      });
      const updated = useCustomerStore.getState().customers.find((c) => c.id === id);
      if (updated) {
        useSyncStore.getState().enqueue({
          offlineUuid: id,
          appLabel: 'customers',
          modelName: 'customer',
          action: 'update',
          payload: updated as unknown as Record<string, unknown>,
          ...getAuthContext(),
          version: Date.now(),
        });
      }
    },

    deleteCustomer: (id) => {
      set((state) => {
        const next = state.customers.filter((c) => c.id !== id);
        persist({ customers: next });
        return { customers: next };
      });
      useSyncStore.getState().enqueue({
        offlineUuid: id,
        appLabel: 'customers',
        modelName: 'customer',
        action: 'delete',
        payload: { id },
        ...getAuthContext(),
        version: Date.now(),
      });
    },
  };
});
