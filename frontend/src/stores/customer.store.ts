import { create } from 'zustand';

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

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedCustomers: CustomerRecord[] = [
  { id: 'cust1',  firstName: 'Kofi',   lastName: 'Mensah',   company: '',                 phone: '0244567890', email: 'kofi@email.com',     address: '12 Oxford Street', city: 'Accra',      creditLimit: 500,   creditBalance: 150,  loyaltyPoints: 245,  totalPurchases: 3420,  totalTransactions: 28,  group: 'regular',   isActive: true,  branchId: 'branch-1', createdAt: daysAgo(90)  },
  { id: 'cust2',  firstName: 'Ama',    lastName: 'Serwaa',   company: 'Serwaa Trading',   phone: '0201234567', email: 'ama@serwaa.com',      address: '45 Ring Road',     city: 'Accra',      creditLimit: 2000,  creditBalance: 0,    loyaltyPoints: 890,  totalPurchases: 12500, totalTransactions: 65,  group: 'vip',       isActive: true,  branchId: 'branch-1', createdAt: daysAgo(180) },
  { id: 'cust3',  firstName: 'Kwame',  lastName: 'Boateng',  company: '',                 phone: '0551234567', email: 'kwame.b@email.com',   address: '7 Adum Main St',   city: 'Kumasi',     creditLimit: 0,     creditBalance: 0,    loyaltyPoints: 120,  totalPurchases: 1850,  totalTransactions: 15,  group: 'regular',   isActive: true,  branchId: 'branch-2', createdAt: daysAgo(60)  },
  { id: 'cust4',  firstName: 'Abena',  lastName: 'Osei',     company: 'Osei Enterprises', phone: '0277890123', email: 'abena@osei.com',      address: '22 Airport City',  city: 'Accra',      creditLimit: 5000,  creditBalance: 1200, loyaltyPoints: 2100, totalPurchases: 28900, totalTransactions: 120, group: 'wholesale', isActive: true,  branchId: 'branch-1', createdAt: daysAgo(365) },
  { id: 'cust5',  firstName: 'Yaw',    lastName: 'Darko',    company: '',                 phone: '0266789012', email: '',                    address: '88 Lapaz',         city: 'Accra',      creditLimit: 0,     creditBalance: 0,    loyaltyPoints: 55,   totalPurchases: 680,   totalTransactions: 8,   group: 'walk-in',   isActive: true,  branchId: 'branch-1', createdAt: daysAgo(30)  },
  { id: 'cust6',  firstName: 'Akosua', lastName: 'Frimpong', company: '',                 phone: '0544567890', email: 'akosua.f@email.com',  address: '33 Spintex Rd',    city: 'Accra',      creditLimit: 1000,  creditBalance: 320,  loyaltyPoints: 450,  totalPurchases: 6200,  totalTransactions: 42,  group: 'regular',   isActive: true,  branchId: 'branch-1', createdAt: daysAgo(120) },
  { id: 'cust7',  firstName: 'Kweku',  lastName: 'Appiah',   company: 'Appiah & Sons',    phone: '0209876543', email: 'kweku@appiah.com',    address: '15 Harbour Rd',    city: 'Tema',       creditLimit: 3000,  creditBalance: 800,  loyaltyPoints: 1560, totalPurchases: 18500, totalTransactions: 88,  group: 'vip',       isActive: true,  branchId: 'branch-2', createdAt: daysAgo(200) },
  { id: 'cust8',  firstName: 'Efua',   lastName: 'Mensah',   company: '',                 phone: '0507654321', email: '',                    address: '',                 city: 'Cape Coast', creditLimit: 0,     creditBalance: 0,    loyaltyPoints: 30,   totalPurchases: 420,   totalTransactions: 5,   group: 'walk-in',   isActive: true,  branchId: 'branch-3', createdAt: daysAgo(15)  },
  { id: 'cust9',  firstName: 'Kojo',   lastName: 'Ansah',    company: 'Ansah Electronics', phone: '0241112233', email: 'kojo@ansah.com',     address: '90 Circle',        city: 'Accra',      creditLimit: 10000, creditBalance: 3500, loyaltyPoints: 4200, totalPurchases: 52000, totalTransactions: 210, group: 'wholesale', isActive: true,  branchId: 'branch-1', createdAt: daysAgo(400) },
  { id: 'cust10', firstName: 'Adwoa',  lastName: 'Boateng',  company: '',                 phone: '0277112233', email: 'adwoa.b@email.com',   address: '5 East Legon',     city: 'Accra',      creditLimit: 500,   creditBalance: 50,   loyaltyPoints: 180,  totalPurchases: 2100,  totalTransactions: 18,  group: 'regular',   isActive: false, branchId: 'branch-2', createdAt: daysAgo(150) },
];

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
      return newCustomer;
    },

    updateCustomer: (id, data) => {
      set((state) => {
        const next = state.customers.map((c) => c.id === id ? { ...c, ...data } : c);
        persist({ customers: next });
        return { customers: next };
      });
    },

    deleteCustomer: (id) => {
      set((state) => {
        const next = state.customers.filter((c) => c.id !== id);
        persist({ customers: next });
        return { customers: next };
      });
    },
  };
});
