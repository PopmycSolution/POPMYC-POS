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

const now = new Date();
function daysAgo(d: number): string {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - d);
  return dt.toISOString();
}

const seedMovements: StockMovement[] = [
  { id: 'sm1', productId: 'p1', productName: 'Pure Water Sachet (500ml)', sku: 'PW-001', type: 'OPENING_STOCK', qtyDelta: 500, unitCost: 0.80, reference: 'OS-001', notes: 'Initial stock', createdAt: daysAgo(30) },
  { id: 'sm2', productId: 'p2', productName: 'Coca-Cola Bottle 500ml', sku: 'CC-500', type: 'OPENING_STOCK', qtyDelta: 300, unitCost: 6.50, reference: 'OS-001', notes: 'Initial stock', createdAt: daysAgo(30) },
  { id: 'sm3', productId: 'p1', productName: 'Pure Water Sachet (500ml)', sku: 'PW-001', type: 'SALE', qtyDelta: -12, unitCost: 2.00, reference: 'SL-240901-0001', notes: '', createdAt: daysAgo(7) },
  { id: 'sm4', productId: 'p2', productName: 'Coca-Cola Bottle 500ml', sku: 'CC-500', type: 'SALE', qtyDelta: -6, unitCost: 10.00, reference: 'SL-240901-0001', notes: '', createdAt: daysAgo(7) },
  { id: 'sm5', productId: 'p3', productName: 'Loaf of Bread (Sliced)', sku: 'BR-001', type: 'PURCHASE', qtyDelta: 40, unitCost: 9.00, reference: 'PO-001', notes: 'Weekly restock', createdAt: daysAgo(5) },
  { id: 'sm6', productId: 'p9', productName: 'Dettol Soap 120g', sku: 'DT-120', type: 'SALE', qtyDelta: -3, unitCost: 18.00, reference: 'SL-240903-0012', notes: '', createdAt: daysAgo(5) },
  { id: 'sm7', productId: 'p7', productName: 'Omo Detergent 500g', sku: 'OM-500', type: 'PURCHASE', qtyDelta: 50, unitCost: 33.00, reference: 'PO-002', notes: 'Bulk purchase', createdAt: daysAgo(4) },
  { id: 'sm8', productId: 'p10', productName: 'Sprite 500ml', sku: 'SP-500', type: 'SALE', qtyDelta: -8, unitCost: 10.00, reference: 'SL-240904-0018', notes: '', createdAt: daysAgo(4) },
  { id: 'sm9', productId: 'p14', productName: 'Eggs (Crate of 30)', sku: 'EG-30', type: 'PURCHASE', qtyDelta: 20, unitCost: 18.00, reference: 'PO-003', notes: '', createdAt: daysAgo(3) },
  { id: 'sm10', productId: 'p5', productName: 'Fanta Orange 500ml', sku: 'FN-500', type: 'SALE', qtyDelta: -10, unitCost: 10.00, reference: 'SL-240905-0022', notes: '', createdAt: daysAgo(3) },
  { id: 'sm11', productId: 'p15', productName: 'Colgate Toothpaste 100ml', sku: 'CL-100', type: 'DAMAGED', qtyDelta: -2, unitCost: 15.00, reference: 'DMG-001', notes: 'Shop damage - dropped', createdAt: daysAgo(2) },
  { id: 'sm12', productId: 'p11', productName: 'Rice Bag 5kg', sku: 'RC-5KG', type: 'SALE', qtyDelta: -5, unitCost: 95.00, reference: 'SL-240906-0030', notes: '', createdAt: daysAgo(2) },
  { id: 'sm13', productId: 'p4', productName: 'Milo Tin 400g', sku: 'ML-400', type: 'PURCHASE', qtyDelta: 30, unitCost: 38.00, reference: 'PO-004', notes: '', createdAt: daysAgo(1) },
  { id: 'sm14', productId: 'p12', productName: 'Cooking Oil 1L', sku: 'CO-1L', type: 'SALE', qtyDelta: -4, unitCost: 55.00, reference: 'SL-240907-0035', notes: '', createdAt: daysAgo(1) },
  { id: 'sm15', productId: 'p8', productName: 'Ideal Milk Tin', sku: 'IM-TIN', type: 'ADJUSTMENT', qtyDelta: -2, unitCost: 20.00, reference: 'ADJ-001', notes: 'Stock count variance', createdAt: daysAgo(1) },
  { id: 'sm16', productId: 'p1', productName: 'Pure Water Sachet (500ml)', sku: 'PW-001', type: 'SALE', qtyDelta: -20, unitCost: 2.00, reference: 'SL-240908-0040', notes: '', createdAt: daysAgo(0) },
  { id: 'sm17', productId: 'p16', productName: 'Luxury Biscuit Pack', sku: 'BX-LUX', type: 'SALE', qtyDelta: -8, unitCost: 35.00, reference: 'SL-240908-0040', notes: '', createdAt: daysAgo(0) },
  { id: 'sm18', productId: 'p17', productName: 'Sanitary Pads (Pack)', sku: 'SP-PK', type: 'SALE', qtyDelta: -5, unitCost: 25.00, reference: 'SL-240908-0041', notes: '', createdAt: daysAgo(0) },
];

const seedAlerts: StockAlertItem[] = [
  { id: 'sa1', type: 'LOW_STOCK', productId: 'p10', productName: 'Sprite 500ml', sku: 'SP-500', currentStock: 15, threshold: 25, message: 'Stock below minimum threshold', isAcknowledged: false, createdAt: daysAgo(2) },
  { id: 'sa2', type: 'LOW_STOCK', productId: 'p15', productName: 'Colgate Toothpaste 100ml', sku: 'CL-100', currentStock: 8, threshold: 20, message: 'Stock below minimum threshold', isAcknowledged: false, createdAt: daysAgo(3) },
  { id: 'sa3', type: 'LOW_STOCK', productId: 'p17', productName: 'Sanitary Pads (Pack)', sku: 'SP-PK', currentStock: 8, threshold: 25, message: 'Stock critically low', isAcknowledged: false, createdAt: daysAgo(1) },
  { id: 'sa4', type: 'LOW_STOCK', productId: 'p9', productName: 'Dettol Soap 120g', sku: 'DT-120', currentStock: 19, threshold: 15, message: 'Stock approaching minimum threshold', isAcknowledged: true, createdAt: daysAgo(5) },
  { id: 'sa5', type: 'LOW_STOCK', productId: 'p8', productName: 'Ideal Milk Tin', sku: 'IM-TIN', currentStock: 12, threshold: 10, message: 'Stock approaching minimum threshold', isAcknowledged: false, createdAt: daysAgo(4) },
];

const seedAdjustments: StockAdjustment[] = [
  { id: 'adj1', reference: 'ADJ-240901-001', reason: 'LOST', productName: 'Ideal Milk Tin', sku: 'IM-TIN', productId: 'p8', qtyExpected: 14, qtyActual: 12, qtyDelta: -2, unitCost: 20.00, notes: 'Missing from shelf during stock count', status: 'POSTED', createdAt: daysAgo(1) },
  { id: 'adj2', reference: 'ADJ-240828-001', reason: 'DAMAGED', productName: 'Colgate Toothpaste 100ml', sku: 'CL-100', productId: 'p15', qtyExpected: 10, qtyActual: 8, qtyDelta: -2, unitCost: 15.00, notes: 'Dropped and damaged during cleaning', status: 'POSTED', createdAt: daysAgo(2) },
  { id: 'adj3', reference: 'ADJ-240905-001', reason: 'FOUND', productName: 'Sugar Sachet 1kg', sku: 'SG-1KG', productId: 'p6', qtyExpected: 38, qtyActual: 40, qtyDelta: 2, unitCost: 25.00, notes: 'Found behind display shelf', status: 'POSTED', createdAt: daysAgo(3) },
];

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
