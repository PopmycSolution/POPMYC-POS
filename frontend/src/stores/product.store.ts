import { create } from 'zustand';
import type { Product } from '@/types';
import { useBranchInventoryStore } from './branchInventory.store';
import api from '@/services/api';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed products — fresh installations start empty.
// Products are created by the customer through the POS interface.
const seedProducts: Product[] = [];

const STORAGE_KEY = 'popmyc-products';

interface ProductStore {
  products: Product[];
  addProduct: (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Product;
  updateProduct: (id: string, data: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  bulkImportProducts: (items: Array<Partial<Product> & { name: string; sku: string; price: number; stockQuantity: number }>) => Product[];
  getProductById: (id: string) => Product | undefined;
  /** Decrement stock. When branchId is provided, writes to branchInventoryStore. Always also decrements the global field. */
  decrementStock: (productId: string, qty: number, branchId?: string) => void;
  /** Increment stock. When branchId is provided, writes to branchInventoryStore. Always also increments the global field. */
  incrementStock: (productId: string, qty: number, branchId?: string) => void;
  /**
   * Fetch products from the backend API and merge them into the local store.
   * Called after login and periodically via the sync hook.
   * Products in local storage take precedence over backend for unsaved local changes;
   * backend products fill in anything that's missing.
   */
  syncFromBackend: () => Promise<void>;
}

function loadInitial(): Product[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Product[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // noop
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seedProducts));
  return seedProducts;
}

export const useProductStore = create<ProductStore>((set, get) => ({
  products: loadInitial(),

  addProduct: (data) => {
    const ts = new Date().toISOString();
    const newProduct: Product = {
      id: genId(),
      createdAt: ts,
      updatedAt: ts,
      ...data,
    } as Product;
    set((state) => {
      const next = [newProduct, ...state.products];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
    return newProduct;
  },

  updateProduct: (id, data) => {
    const ts = new Date().toISOString();
    set((state) => {
      const next = state.products.map((p) =>
        p.id === id ? { ...p, ...data, updatedAt: ts } : p
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
  },

  deleteProduct: (id) => {
    set((state) => {
      const next = state.products.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
  },

  bulkImportProducts: (items) => {
    const ts = new Date().toISOString();
    const newProducts: Product[] = items.map((data, idx) => ({
      id: genId() + idx,
      createdAt: ts,
      updatedAt: ts,
      name: data.name,
      sku: data.sku,
      price: Number(data.price) || 0,
      stockQuantity: Number(data.stockQuantity) || 0,
      description: data.description,
      modelNumber: data.modelNumber,
      cost: data.cost ? Number(data.cost) : undefined,
      lowStockThreshold: data.lowStockThreshold ? Number(data.lowStockThreshold) : 10,
      categoryId: data.categoryId || 'other',
      barcode: data.barcode,
      imageUrl: data.imageUrl,
      isActive: data.isActive !== false,
      expiryDate: data.expiryDate ?? null,
      expiryAlertDays: data.expiryAlertDays ? Number(data.expiryAlertDays) : 30,
    }));
    set((state) => {
      const next = [...newProducts, ...state.products];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
    return newProducts;
  },

  getProductById: (id) => get().products.find((p) => p.id === id),

  decrementStock: (productId, qty, branchId) => {
    if (branchId) {
      // Branch sale: only deduct from that branch's stock.
      // Global stockQuantity is the SUM of all branches — only the backend should update it.
      useBranchInventoryStore.getState().decrementStock(branchId, productId, qty);
      return;
    }
    // No branch specified (Super Admin global op) — update global only
    set((state) => {
      const next = state.products.map((p) =>
        p.id === productId
          ? { ...p, stockQuantity: Math.max(0, p.stockQuantity - qty), updatedAt: new Date().toISOString() }
          : p
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
  },

  incrementStock: (productId, qty, branchId) => {
    if (branchId) {
      // Branch stock-in: only add to that branch's stock.
      useBranchInventoryStore.getState().incrementStock(branchId, productId, qty);
      return;
    }
    // No branch specified — update global only
    set((state) => {
      const next = state.products.map((p) =>
        p.id === productId
          ? { ...p, stockQuantity: p.stockQuantity + qty, updatedAt: new Date().toISOString() }
          : p
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return { products: next };
    });
  },

  syncFromBackend: async () => {
    // Fetch products from the backend and merge into the local store.
    // Strategy: backend is the authority for IDs that exist there.
    // Local-only products (id starts with 'p-' or not a UUID format) are preserved.
    try {
      type BackendProduct = {
        id: string;
        name: string;
        sku?: string;
        description?: string;
        model_number?: string;
        selling_price?: number | string;
        cost_price?: number | string;
        stock_quantity?: number;
        low_stock_threshold?: number;
        category?: string;
        category_id?: string;
        brand?: string;
        brand_id?: string;
        unit_of_measure?: string;
        unit_id?: string;
        barcode?: string;
        is_active?: boolean;
        expiry_date?: string | null;
        expiry_alert_days?: number;
        image?: string | null;
        created_at?: string;
        updated_at?: string;
        pricing_type?: string;
        wholesale_price?: number | string;
      };
      type BackendResponse = {
        results?: BackendProduct[];
        count?: number;
      } | BackendProduct[];

      // Fetch all pages (up to 500 products per request to limit calls)
      const res = await api.get<BackendResponse>('/products/?limit=500');
      const raw = Array.isArray(res.data)
        ? (res.data as BackendProduct[])
        : ((res.data as { results?: BackendProduct[] }).results ?? []);

      if (!raw || raw.length === 0) return;

      const ts = new Date().toISOString();
      const backendProducts: Product[] = raw.map((p) => ({
        id:               p.id,
        name:             p.name ?? '',
        sku:              p.sku ?? '',
        description:      p.description ?? undefined,
        modelNumber:      p.model_number ?? undefined,
        price:            Number(p.selling_price ?? 0),
        wholesalePrice:   p.wholesale_price !== undefined ? Number(p.wholesale_price) : undefined,
        cost:             p.cost_price !== undefined ? Number(p.cost_price) : undefined,
        stockQuantity:    Number(p.stock_quantity ?? 0),
        lowStockThreshold: Number(p.low_stock_threshold ?? 10),
        categoryId:       p.category_id ?? p.category ?? 'other',
        brandId:          p.brand_id ?? p.brand ?? undefined,
        unitId:           p.unit_id ?? p.unit_of_measure ?? undefined,
        barcode:          p.barcode ?? undefined,
        isActive:         p.is_active !== false,
        expiryDate:       p.expiry_date ?? null,
        expiryAlertDays:  Number(p.expiry_alert_days ?? 30),
        imageUrl:         p.image ?? undefined,
        pricingType:      (p.pricing_type as 'FIXED' | 'NEGOTIABLE') ?? 'FIXED',
        createdAt:        p.created_at ?? ts,
        updatedAt:        p.updated_at ?? ts,
      }));

      set((state) => {
        // Build a map of existing local products by id for fast lookup
        const localMap = new Map(state.products.map((p) => [p.id, p]));
        const backendMap = new Map(backendProducts.map((p) => [p.id, p]));

        // Backend products take full precedence — they are the source of truth
        // Local-only products (not found in backend) are also kept
        const localOnly = state.products.filter((p) => !backendMap.has(p.id));
        const merged = [...backendProducts, ...localOnly];

        // Avoid unnecessary re-renders if nothing changed
        if (merged.length === state.products.length) {
          const unchanged = merged.every((p) => {
            const existing = localMap.get(p.id);
            return existing && existing.updatedAt === p.updatedAt;
          });
          if (unchanged) return {};
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        return { products: merged };
      });
    } catch {
      // Offline or unauthenticated — keep existing local data
    }
  },
}));
