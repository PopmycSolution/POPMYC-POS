import { create } from 'zustand';
import type { Product } from '@/types';
import { useBranchInventoryStore } from './branchInventory.store';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `p-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

const nowIso = new Date('2025-09-08T10:00:00.000Z').toISOString();

// Seed expiry dates relative to "today" (Sep 15 2026 per system clock) so
// expiry notifications are visible out-of-the-box:
//   - already expired  : bread, yoghurt
//   - expiring soon     : Coca-Cola, Milo, eggs
//   - far future        : all others (or no expiry date)
const seedProducts: Product[] = [
  { id: 'p1',  name: 'Pure Water Sachet (500ml)',  sku: 'PW-001',  description: 'Filtered drinking water in sachet',  price: 2.00,  cost: 0.80,  stockQuantity: 432, lowStockThreshold: 50,  categoryId: 'beverages', barcode: '6001001', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p2',  name: 'Coca-Cola Bottle 500ml',     sku: 'CC-500',  description: 'Classic carbonated soft drink',       price: 10.00, cost: 6.50,  stockQuantity: 218, lowStockThreshold: 30,  categoryId: 'beverages', barcode: '6001002', imageUrl: undefined, isActive: true, expiryDate: '2026-10-05', expiryAlertDays: 30, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p3',  name: 'Loaf of Bread (Sliced)',     sku: 'BR-001',  price: 15.00, cost: 9.00,  stockQuantity: 56,  lowStockThreshold: 15,  categoryId: 'food',      barcode: '6001003', imageUrl: undefined, isActive: true, expiryDate: '2026-09-10', expiryAlertDays: 7,  createdAt: nowIso, updatedAt: nowIso },
  { id: 'p4',  name: 'Milo Tin 400g',              sku: 'ML-400',  description: 'Chocolate malt beverage powder',     price: 50.00, cost: 38.00, stockQuantity: 98,  lowStockThreshold: 20,  categoryId: 'food',      barcode: '6001004', imageUrl: undefined, isActive: true, expiryDate: '2026-09-30', expiryAlertDays: 30, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p5',  name: 'Fanta Orange 500ml',         sku: 'FN-500',  price: 10.00, cost: 6.50,  stockQuantity: 164, lowStockThreshold: 30,  categoryId: 'beverages', barcode: '6001005', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p6',  name: 'Sugar Sachet 1kg',           sku: 'SG-1KG', price: 32.00, cost: 25.00, stockQuantity: 40,  lowStockThreshold: 25,  categoryId: 'food',      barcode: '6001006', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p7',  name: 'Omo Detergent 500g',         sku: 'OM-500',  description: 'Multi-active washing powder',        price: 45.00, cost: 33.00, stockQuantity: 87,  lowStockThreshold: 20,  categoryId: 'household', barcode: '6001007', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p8',  name: 'Ideal Milk Tin',             sku: 'IM-TIN', price: 28.00, cost: 20.00, stockQuantity: 12,  lowStockThreshold: 10,  categoryId: 'dairy',     barcode: '6001008', imageUrl: undefined, isActive: true, expiryDate: '2027-03-01', expiryAlertDays: 30, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p9',  name: 'Dettol Soap 120g',           sku: 'DT-120',  description: 'Antibacterial bathing soap',         price: 18.00, cost: 12.00, stockQuantity: 19,  lowStockThreshold: 15,  categoryId: 'toiletries',barcode: '6001009', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p10', name: 'Sprite 500ml',               sku: 'SP-500',  price: 10.00, cost: 6.50,  stockQuantity: 15,  lowStockThreshold: 25,  categoryId: 'beverages', barcode: '6001010', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p11', name: 'Rice Bag 5kg',               sku: 'RC-5KG', description: 'Local perfumed rice',                price: 95.00, cost: 75.00, stockQuantity: 42,  lowStockThreshold: 10,  categoryId: 'food',      barcode: '6001011', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p12', name: 'Cooking Oil 1L',             sku: 'CO-1L',  price: 55.00, cost: 42.00, stockQuantity: 28,  lowStockThreshold: 20,  categoryId: 'food',      barcode: '6001012', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p13', name: 'Toilet Roll (Pack of 6)',    sku: 'TR-6PK', price: 38.00, cost: 28.00, stockQuantity: 35,  lowStockThreshold: 15,  categoryId: 'household', barcode: '6001013', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p14', name: 'Eggs (Crate of 30)',         sku: 'EG-30',  price: 22.00, cost: 18.00, stockQuantity: 64,  lowStockThreshold: 10,  categoryId: 'dairy',     barcode: '6001014', imageUrl: undefined, isActive: true, expiryDate: '2026-09-20', expiryAlertDays: 14, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p15', name: 'Colgate Toothpaste 100ml',  sku: 'CL-100', price: 22.00, cost: 15.00, stockQuantity: 8,   lowStockThreshold: 20,  categoryId: 'toiletries',barcode: '6001015', imageUrl: undefined, isActive: true, expiryDate: '2028-06-01', expiryAlertDays: 30, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p16', name: 'Luxury Biscuit Pack',        sku: 'BX-LUX', description: 'Assorted cream biscuits',            price: 35.00, cost: 24.00, stockQuantity: 189, lowStockThreshold: 30,  categoryId: 'food',      barcode: '6001016', imageUrl: undefined, isActive: true, expiryDate: '2026-09-12', expiryAlertDays: 7,  createdAt: nowIso, updatedAt: nowIso },
  { id: 'p17', name: 'Sanitary Pads (Pack)',       sku: 'SP-PK',  price: 25.00, cost: 18.00, stockQuantity: 8,   lowStockThreshold: 25,  categoryId: 'toiletries',barcode: '6001017', imageUrl: undefined, isActive: true, createdAt: nowIso, updatedAt: nowIso },
  { id: 'p18', name: 'Yoghurt Drink 500ml',        sku: 'YG-500', price: 14.00, cost: 9.00,  stockQuantity: 52,  lowStockThreshold: 20,  categoryId: 'dairy',     barcode: '6001018', imageUrl: undefined, isActive: true, expiryDate: '2026-09-08', expiryAlertDays: 7,  createdAt: nowIso, updatedAt: nowIso },
];

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
