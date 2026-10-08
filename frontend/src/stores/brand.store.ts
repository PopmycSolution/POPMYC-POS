import { create } from 'zustand';
import { useSyncStore } from './sync.store';

export interface BrandRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  logoUrl?: string;
  website?: string;
  isActive: boolean;
  productCount: number;
  createdAt: string;
}

interface BrandStore {
  brands: BrandRecord[];
  addBrand: (data: Omit<BrandRecord, 'id' | 'createdAt' | 'productCount'>) => BrandRecord;
  updateBrand: (id: string, data: Partial<BrandRecord>) => void;
  deleteBrand: (id: string) => void;
}

const STORAGE_KEY = 'popmyc-brands';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `br-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed brands — fresh installations start empty.
const seedBrands: BrandRecord[] = [];

function loadState(): BrandRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as BrandRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* noop */ }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seedBrands));
  return seedBrands;
}

function persist(brands: BrandRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(brands));
}

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const auth = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
    return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
  } catch { return { businessId: null, branchId: null }; }
}

export const useBrandStore = create<BrandStore>((set) => ({
  brands: loadState(),

  addBrand: (data) => {
    const newBrand: BrandRecord = {
      ...data,
      id: genId(),
      productCount: 0,
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      const next = [newBrand, ...state.brands];
      persist(next);
      return { brands: next };
    });
    useSyncStore.getState().enqueue({
      offlineUuid: newBrand.id,
      appLabel: 'products',
      modelName: 'brand',
      action: 'create',
      payload: newBrand as unknown as Record<string, unknown>,
      ...getAuthContext(),
      version: 1,
    });
    return newBrand;
  },

  updateBrand: (id, data) => {
    set((state) => {
      const next = state.brands.map((b) => b.id === id ? { ...b, ...data } : b);
      persist(next);
      return { brands: next };
    });
    const updated = useBrandStore.getState().brands.find((b) => b.id === id);
    if (updated) {
      useSyncStore.getState().enqueue({
        offlineUuid: id,
        appLabel: 'products',
        modelName: 'brand',
        action: 'update',
        payload: updated as unknown as Record<string, unknown>,
        ...getAuthContext(),
        version: Date.now(),
      });
    }
  },

  deleteBrand: (id) => {
    set((state) => {
      const next = state.brands.filter((b) => b.id !== id);
      persist(next);
      return { brands: next };
    });
    useSyncStore.getState().enqueue({
      offlineUuid: id,
      appLabel: 'products',
      modelName: 'brand',
      action: 'delete',
      payload: { id },
      ...getAuthContext(),
      version: Date.now(),
    });
  },
}));
