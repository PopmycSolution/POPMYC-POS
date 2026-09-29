import { create } from 'zustand';

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
    return newBrand;
  },

  updateBrand: (id, data) => {
    set((state) => {
      const next = state.brands.map((b) => b.id === id ? { ...b, ...data } : b);
      persist(next);
      return { brands: next };
    });
  },

  deleteBrand: (id) => {
    set((state) => {
      const next = state.brands.filter((b) => b.id !== id);
      persist(next);
      return { brands: next };
    });
  },
}));
