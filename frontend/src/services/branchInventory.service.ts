/**
 * Branch Inventory Service
 *
 * Calls the backend ProductStockLevel API endpoints:
 *   GET  /api/v1/products/product-stock-levels/branch-summary/?branch=<id>
 *   POST /api/v1/products/product-stock-levels/adjust/
 *   GET  /api/v1/inventory/stock-movements/branch-movements/?branch=<id>
 */
import api from './api';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StockLevelEntry {
  qty_on_hand:   number;
  qty_reserved:  number;
  qty_available: number;
  reorder_level: number;
  branch_id:     string;
  warehouse_id:  string;
}

/** { product_id: StockLevelEntry } */
export type BranchStockSummary = Record<string, StockLevelEntry>;

export interface BranchStockResponse {
  branch_id: string;
  stock:     BranchStockSummary;
}

export interface AdjustPayload {
  product:   string;   // UUID
  branch:    string;   // UUID
  warehouse: string;   // UUID
  delta:     number;   // positive = stock in, negative = stock out
  notes?:    string;
  type?:     string;   // StockMovement type, default ADJUSTMENT
}

export interface BackendMovement {
  id:             string;
  product:        string;
  branch:         string;
  warehouse:      string;
  qty_delta:      number;
  type:           string;
  reference_type: string;
  notes:          string;
  created_at:     string;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * Fetch the full stock summary for a branch in one request.
 * Returns { product_id: { qty_available, qty_on_hand, ... } }
 */
export async function getBranchStockSummary(branchId: string): Promise<BranchStockResponse> {
  const res = await api.get<BranchStockResponse>(
    '/products/product-stock-levels/branch-summary/',
    { params: { branch: branchId } },
  );
  return res.data;
}

/**
 * Adjust stock for a single product at a branch.
 * The backend atomically updates ProductStockLevel and records a StockMovement.
 */
export async function adjustStock(payload: AdjustPayload): Promise<void> {
  await api.post('/products/product-stock-levels/adjust/', payload);
}

/**
 * Fetch recent stock movements for a branch.
 */
export async function getBranchMovements(
  branchId: string,
  limit = 100,
): Promise<BackendMovement[]> {
  const res = await api.get<{ branch_id: string; movements: BackendMovement[] }>(
    '/inventory/stock-movements/branch-movements/',
    { params: { branch: branchId, limit } },
  );
  return res.data.movements;
}
