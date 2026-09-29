/**
 * Branch Inventory Store
 *
 * Tracks per-branch stock quantities separately from the global Product record.
 * The Product.stockQuantity field remains the "global/default" count used as a
 * fallback. Branch-specific stock is stored here as:
 *
 *   stock[branchId][productId] = qty
 *
 * This is the frontend equivalent of the backend's ProductStockLevel model.
 *
 * When the backend is reachable, fetchBranchStock() loads real quantities from
 *   GET /api/v1/products/product-stock-levels/branch-summary/?branch=<id>
 * In local/demo mode the seed data is used instead.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MovementType } from './inventory.store';
import * as branchInventoryService from '@/services/branchInventory.service';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BranchStockEntry {
  qty: number;
  reorderPoint: number;
  lastUpdated: string;
}

/** stock[branchId][productId] = BranchStockEntry */
export type BranchStockMap = Record<string, Record<string, BranchStockEntry>>;

export interface BranchStockMovement {
  id: string;
  branchId: string;
  productId: string;
  productName: string;
  sku: string;
  type: MovementType;
  qtyDelta: number;
  qtyAfter: number;
  reference: string;
  notes: string;
  createdAt: string;
}

interface BranchInventoryStore {
  /** stock[branchId][productId] = { qty, reorderPoint, lastUpdated } */
  stock: BranchStockMap;
  /** per-branch movement log */
  movements: BranchStockMovement[];
  /** which branches have been fetched from the backend this session */
  fetchedBranches: string[];

  /**
   * Fetch real stock levels from the backend for a specific branch.
   * Merges server data into the local map; falls back silently on error.
   * Safe to call in local/demo mode — it detects the session type.
   */
  fetchBranchStock: (branchId: string) => Promise<void>;

  /** Get qty for a product in a branch (0 if not set) */
  getStock: (branchId: string, productId: string) => number;

  /** Set absolute qty (used for stock counts / opening stock) */
  setStock: (branchId: string, productId: string, qty: number, reorderPoint?: number) => void;

  /** Decrement stock after a sale — floors at 0 */
  decrementStock: (branchId: string, productId: string, qty: number, reference?: string) => void;

  /** Increment stock (purchase / return / adjustment) */
  incrementStock: (branchId: string, productId: string, qty: number, type?: MovementType, reference?: string, notes?: string) => void;

  /** Manual adjustment (positive or negative delta) */
  adjustStock: (branchId: string, productId: string, delta: number, reason: string, reference?: string) => void;

  /** Transfer qty from one branch to another */
  transferStock: (fromBranchId: string, toBranchId: string, productId: string, qty: number, reference?: string) => void;

  /** Seed a branch with the global product stock quantities as starting point */
  seedBranchFromGlobal: (branchId: string, products: Array<{ id: string; stockQuantity: number; lowStockThreshold?: number }>) => void;

  /** Check if a branch has been seeded already */
  isBranchSeeded: (branchId: string) => boolean;

  /** Get all products for a branch with low/out stock */
  getLowStockForBranch: (branchId: string, products: Array<{ id: string; lowStockThreshold?: number }>) => Array<{ productId: string; qty: number; threshold: number }>;

  /** Compute the SUM of a product's qty across ALL branches (for "All Branches" view) */
  sumAcrossBranches: (productId: string) => number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `bim-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}
const tsNow = () => new Date().toISOString();

// ── Seed data ─────────────────────────────────────────────────────────────────
// Each branch has its OWN stock levels. Products not stocked at a branch = 0.
// Main Branch (branch-1) is the primary warehouse with full stock.
// Other branches only hold what has been physically transferred to them.

// No seed stock — fresh installations start with zero inventory.
// Stock levels are populated as the customer adds products and records purchases.
const SEED_STOCK: BranchStockMap = {};

// ── Store ─────────────────────────────────────────────────────────────────────
export const useBranchInventoryStore = create<BranchInventoryStore>()(
  persist(
    (set, get) => ({
      stock:           SEED_STOCK,
      movements:       [],
      fetchedBranches: [],

      // ── fetchBranchStock ─────────────────────────────────────────────────────
      fetchBranchStock: async (branchId) => {
        // Skip API in local/demo mode
        const isLocal = (() => {
          try {
            const raw = localStorage.getItem('access_token') ?? '';
            if (raw.startsWith('local-session-')) return true;
            const stored = localStorage.getItem('popmyc-auth-storage');
            if (stored) {
              const p = JSON.parse(stored) as { state?: { accessToken?: string } };
              if ((p?.state?.accessToken ?? '').startsWith('local-session-')) return true;
            }
          } catch { /* noop */ }
          return false;
        })();

        if (isLocal) return;

        // Avoid double-fetching within the same session
        if (get().fetchedBranches.includes(branchId)) return;

        try {
          const { stock: serverStock } = await branchInventoryService.getBranchStockSummary(branchId);
          const ts = tsNow();

          set((s) => {
            const existing = s.stock[branchId] ?? {};
            const merged: Record<string, BranchStockEntry> = { ...existing };

            Object.entries(serverStock).forEach(([productId, entry]) => {
              merged[productId] = {
                qty:          entry.qty_available,
                reorderPoint: entry.reorder_level,
                lastUpdated:  ts,
              };
            });

            return {
              stock: { ...s.stock, [branchId]: merged },
              fetchedBranches: [...s.fetchedBranches, branchId],
            };
          });
        } catch {
          // Network error — keep existing seed / cached data silently
        }
      },

      // ── getStock ────────────────────────────────────────────────────────────
      getStock: (branchId, productId) => {
        return get().stock[branchId]?.[productId]?.qty ?? 0;
      },

      // ── setStock ────────────────────────────────────────────────────────────
      setStock: (branchId, productId, qty, reorderPoint) => {
        const prev = get().stock[branchId]?.[productId];
        set((s) => ({
          stock: {
            ...s.stock,
            [branchId]: {
              ...s.stock[branchId],
              [productId]: {
                qty: Math.max(0, qty),
                reorderPoint: reorderPoint ?? prev?.reorderPoint ?? 10,
                lastUpdated: tsNow(),
              },
            },
          },
        }));
      },

      // ── decrementStock ───────────────────────────────────────────────────────
      decrementStock: (branchId, productId, qty, reference = '') => {
        const current = get().stock[branchId]?.[productId]?.qty ?? 0;
        const after   = Math.max(0, current - qty);
        set((s) => {
          const prev = s.stock[branchId]?.[productId];
          const movement: BranchStockMovement = {
            id: genId(), branchId, productId,
            productName: '', sku: '',
            type: 'SALE', qtyDelta: -qty, qtyAfter: after,
            reference, notes: '', createdAt: tsNow(),
          };
          return {
            stock: {
              ...s.stock,
              [branchId]: {
                ...s.stock[branchId],
                [productId]: { qty: after, reorderPoint: prev?.reorderPoint ?? 10, lastUpdated: tsNow() },
              },
            },
            movements: [movement, ...s.movements].slice(0, 500),
          };
        });
      },

      // ── incrementStock ───────────────────────────────────────────────────────
      incrementStock: (branchId, productId, qty, type = 'PURCHASE', reference = '', notes = '') => {
        const current = get().stock[branchId]?.[productId]?.qty ?? 0;
        const after   = current + qty;
        set((s) => {
          const prev = s.stock[branchId]?.[productId];
          const movement: BranchStockMovement = {
            id: genId(), branchId, productId,
            productName: '', sku: '',
            type, qtyDelta: qty, qtyAfter: after,
            reference, notes, createdAt: tsNow(),
          };
          return {
            stock: {
              ...s.stock,
              [branchId]: {
                ...s.stock[branchId],
                [productId]: { qty: after, reorderPoint: prev?.reorderPoint ?? 10, lastUpdated: tsNow() },
              },
            },
            movements: [movement, ...s.movements].slice(0, 500),
          };
        });
      },

      // ── adjustStock ──────────────────────────────────────────────────────────
      adjustStock: (branchId, productId, delta, reason, reference = '') => {
        const current = get().stock[branchId]?.[productId]?.qty ?? 0;
        const after   = Math.max(0, current + delta);
        set((s) => {
          const prev = s.stock[branchId]?.[productId];
          const movement: BranchStockMovement = {
            id: genId(), branchId, productId,
            productName: '', sku: '',
            type: 'ADJUSTMENT', qtyDelta: delta, qtyAfter: after,
            reference, notes: reason, createdAt: tsNow(),
          };
          return {
            stock: {
              ...s.stock,
              [branchId]: {
                ...s.stock[branchId],
                [productId]: { qty: after, reorderPoint: prev?.reorderPoint ?? 10, lastUpdated: tsNow() },
              },
            },
            movements: [movement, ...s.movements].slice(0, 500),
          };
        });
      },

      // ── transferStock ────────────────────────────────────────────────────────
      transferStock: (fromBranchId, toBranchId, productId, qty, reference = '') => {
        const fromCurrent = get().stock[fromBranchId]?.[productId]?.qty ?? 0;
        const toCurrent   = get().stock[toBranchId]?.[productId]?.qty ?? 0;
        const actualQty   = Math.min(qty, fromCurrent); // can't transfer more than available
        if (actualQty <= 0) return;

        const ts = tsNow();
        set((s) => {
          const fromPrev = s.stock[fromBranchId]?.[productId];
          const toPrev   = s.stock[toBranchId]?.[productId];
          const outMovement: BranchStockMovement = {
            id: genId(), branchId: fromBranchId, productId,
            productName: '', sku: '',
            type: 'TRANSFER_OUT', qtyDelta: -actualQty, qtyAfter: fromCurrent - actualQty,
            reference, notes: `Transfer to branch ${toBranchId}`, createdAt: ts,
          };
          const inMovement: BranchStockMovement = {
            id: genId(), branchId: toBranchId, productId,
            productName: '', sku: '',
            type: 'TRANSFER_IN', qtyDelta: actualQty, qtyAfter: toCurrent + actualQty,
            reference, notes: `Transfer from branch ${fromBranchId}`, createdAt: ts,
          };
          return {
            stock: {
              ...s.stock,
              [fromBranchId]: {
                ...s.stock[fromBranchId],
                [productId]: { qty: fromCurrent - actualQty, reorderPoint: fromPrev?.reorderPoint ?? 10, lastUpdated: ts },
              },
              [toBranchId]: {
                ...s.stock[toBranchId],
                [productId]: { qty: toCurrent + actualQty, reorderPoint: toPrev?.reorderPoint ?? 10, lastUpdated: ts },
              },
            },
            movements: [outMovement, inMovement, ...s.movements].slice(0, 500),
          };
        });
      },

      // ── seedBranchFromGlobal ─────────────────────────────────────────────────
      seedBranchFromGlobal: (branchId, products) => {
        set((s) => {
          const existing = s.stock[branchId] ?? {};
          const merged: Record<string, BranchStockEntry> = { ...existing };
          products.forEach(({ id, stockQuantity, lowStockThreshold }) => {
            if (!merged[id]) {
              merged[id] = {
                qty: stockQuantity,
                reorderPoint: lowStockThreshold ?? 10,
                lastUpdated: tsNow(),
              };
            }
          });
          return { stock: { ...s.stock, [branchId]: merged } };
        });
      },

      // ── isBranchSeeded ───────────────────────────────────────────────────────
      isBranchSeeded: (branchId) => {
        const b = get().stock[branchId];
        return !!b && Object.keys(b).length > 0;
      },

      // ── getLowStockForBranch ─────────────────────────────────────────────────
      getLowStockForBranch: (branchId, products) => {
        const branchStock = get().stock[branchId] ?? {};
        return products
          .filter(({ id, lowStockThreshold = 10 }) => {
            const qty = branchStock[id]?.qty ?? 0;
            return qty <= lowStockThreshold;
          })
          .map(({ id, lowStockThreshold = 10 }) => ({
            productId: id,
            qty: branchStock[id]?.qty ?? 0,
            threshold: lowStockThreshold,
          }));
      },

      // ── sumAcrossBranches ─────────────────────────────────────────────────
      sumAcrossBranches: (productId) => {
        const allBranchStock = get().stock;
        return Object.values(allBranchStock).reduce(
          (total, branchEntry) => total + (branchEntry[productId]?.qty ?? 0),
          0
        );
      },
    }),
    {
      name: 'popmyc-branch-inventory',
      // __inv_version = 1 means "corrected per-branch seed" — main.tsx only
      // wipes the store when this is missing (version 0), preserving all
      // user-added stock on subsequent page loads.
      partialize: (s) => ({
        stock:           s.stock,
        fetchedBranches: s.fetchedBranches,
        __inv_version:   1,
      }),
    },
  ),
);
