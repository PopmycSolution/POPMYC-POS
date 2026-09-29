import { create } from 'zustand';

export type MovementType =
  | 'SALE'
  | 'PURCHASE'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'ADJUSTMENT'
  | 'DAMAGED'
  | 'EXPIRED'
  | 'OPENING_STOCK'
  | 'STOCK_COUNT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

export type AlertType = 'LOW_STOCK' | 'EXPIRING_SOON' | 'EXPIRED' | 'OUT_OF_STOCK';

export type AdjustmentReason =
  | 'DAMAGED'
  | 'EXPIRED'
  | 'LOST'
  | 'FOUND'
  | 'WRONG_ENTRY'
  | 'OTHER';

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  type: MovementType;
  qtyDelta: number;
  unitCost: number;
  reference: string;
  notes: string;
  createdAt: string;
}

export interface StockAlertItem {
  id: string;
  type: AlertType;
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  threshold: number;
  message: string;
  isAcknowledged: boolean;
  createdAt: string;
}

export interface StockAdjustment {
  id: string;
  reference: string;
  reason: AdjustmentReason;
  productName: string;
  sku: string;
  productId: string;
  qtyExpected: number;
  qtyActual: number;
  qtyDelta: number;
  unitCost: number;
  notes: string;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  createdAt: string;
}

interface InventoryStore {
  movements: StockMovement[];
  alerts: StockAlertItem[];
  adjustments: StockAdjustment[];
  addMovement: (movement: Omit<StockMovement, 'id' | 'createdAt'>) => void;
  acknowledgeAlert: (id: string) => void;
  addAdjustment: (adj: Omit<StockAdjustment, 'id' | 'createdAt'>) => void;
}

const STORAGE_KEY = 'popmyc-inventory';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `inv-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// No seed inventory data — fresh installations start empty.
// Stock movements and adjustments are recorded as the customer adds products.
const seedMovements: StockMovement[] = [];
const seedAlerts: StockAlertItem[] = [];
const seedAdjustments: StockAdjustment[] = [];

interface StoredState {
  movements: StockMovement[];
  alerts: StockAlertItem[];
  adjustments: StockAdjustment[];
}

function loadState(): StoredState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.movements?.length > 0) return parsed;
    }
  } catch { /* noop */ }
  const initial = { movements: seedMovements, alerts: seedAlerts, adjustments: seedAdjustments };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useInventoryStore = create<InventoryStore>((set) => {
  const initial = loadState();
  return {
    movements: initial.movements,
    alerts: initial.alerts,
    adjustments: initial.adjustments,

    addMovement: (movement) => {
      const newMovement: StockMovement = {
        ...movement,
        id: genId(),
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = { ...state, movements: [newMovement, ...state.movements] };
        persist({ movements: next.movements, alerts: next.alerts, adjustments: next.adjustments });
        return { movements: next.movements };
      });
    },

    acknowledgeAlert: (id) => {
      set((state) => {
        const next = {
          ...state,
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, isAcknowledged: true } : a
          ),
        };
        persist({ movements: next.movements, alerts: next.alerts, adjustments: next.adjustments });
        return { alerts: next.alerts };
      });
    },

    addAdjustment: (adj) => {
      const newAdj: StockAdjustment = {
        ...adj,
        id: genId(),
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = { ...state, adjustments: [newAdj, ...state.adjustments] };
        persist({ movements: next.movements, alerts: next.alerts, adjustments: next.adjustments });
        return { adjustments: next.adjustments };
      });
    },
  };
});
