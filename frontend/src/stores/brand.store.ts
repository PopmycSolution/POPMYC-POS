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

function daysAgo(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedBrands: BrandRecord[] = [
  { id: 'br1', name: 'Coca-Cola', code: 'COCA', description: 'Global beverage brand', logoUrl: '', website: 'https://coca-cola.com', isActive: true, productCount: 5, createdAt: daysAgo(365) },
  { id: 'br2', name: 'Nestlé', code: 'NESTLE', description: 'Food and beverage multinational', logoUrl: '', website: 'https://nestle.com', isActive: true, productCount: 8, createdAt: daysAgo(300) },
  { id: 'br3', name: 'Unilever', code: 'UNILEV', description: 'Consumer goods company', logoUrl: '', website: 'https://unilever.com', isActive: true, productCount: 12, createdAt: daysAgo(250) },
  { id: 'br4', name: 'Procter & Gamble', code: 'PG', description: 'Household products', logoUrl: '', website: 'https://pg.com', isActive: true, productCount: 7, createdAt: daysAgo(200) },
  { id: 'br5', name: 'Dettol', code: 'DETTOL', description: 'Hygiene and health brand', logoUrl: '', website: 'https://dettol.com', isActive: true, productCount: 4, createdAt: daysAgo(180) },
  { id: 'br6', name: 'Fan Milk', code: 'FANMILK', description: 'West African dairy brand', logoUrl: '', website: '', isActive: true, productCount: 6, createdAt: daysAgo(150) },
  { id: 'br7', name: 'Colgate', code: 'COLGATE', description: 'Oral care products', logoUrl: '', website: 'https://colgate.com', isActive: true, productCount: 3, createdAt: daysAgo(120) },
  { id: 'br8', name: 'Samsung', code: 'SAMSUNG', description: 'Electronics and technology', logoUrl: '', website: 'https://samsung.com', isActive: false, productCount: 2, createdAt: daysAgo(90) },
];

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
