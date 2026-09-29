import { create } from 'zustand';
import type { Product } from '@/types';
import { useBranchInventoryStore } from './branchInventory.store';

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
}));
