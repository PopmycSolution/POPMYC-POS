import { create } from 'zustand';
import { useSyncStore } from './sync.store';
import api from '@/services/api';

export interface UnitRecord {
  id: string;
  name: string;       // e.g. "Piece"
  abbreviation: string; // e.g. "pcs"
  description: string;
  isActive: boolean;
  createdAt: string;
}

interface UnitStore {
  units: UnitRecord[];
  addUnit: (data: Omit<UnitRecord, 'id' | 'createdAt'>) => UnitRecord;
  updateUnit: (id: string, data: Partial<UnitRecord>) => void;
  deleteUnit: (id: string) => void;
  syncFromBackend: () => Promise<void>;
}

const STORAGE_KEY = 'popmyc-units';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `unit-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// ── Preset units ──────────────────────────────────────────────────────────────
const SEED_UNITS: UnitRecord[] = [
  { id: 'u1',  name: 'Piece',      abbreviation: 'pcs',   description: 'Individual item or piece',             isActive: true, createdAt: new Date().toISOString() },
  { id: 'u2',  name: 'Pack',       abbreviation: 'pack',  description: 'A packaged group of items',            isActive: true, createdAt: new Date().toISOString() },
  { id: 'u3',  name: 'Box',        abbreviation: 'box',   description: 'Items packed in a box',                isActive: true, createdAt: new Date().toISOString() },
  { id: 'u4',  name: 'Bag',        abbreviation: 'bag',   description: 'Items in a bag (e.g. rice bag)',       isActive: true, createdAt: new Date().toISOString() },
  { id: 'u5',  name: 'Bottle',     abbreviation: 'btl',   description: 'Liquid in a bottle',                   isActive: true, createdAt: new Date().toISOString() },
  { id: 'u6',  name: 'Carton',     abbreviation: 'ctn',   description: 'Large carton of goods',                isActive: true, createdAt: new Date().toISOString() },
  { id: 'u7',  name: 'Dozen',      abbreviation: 'doz',   description: '12 units',                             isActive: true, createdAt: new Date().toISOString() },
  { id: 'u8',  name: 'Kilogram',   abbreviation: 'kg',    description: 'Weight in kilograms',                  isActive: true, createdAt: new Date().toISOString() },
  { id: 'u9',  name: 'Gram',       abbreviation: 'g',     description: 'Weight in grams',                      isActive: true, createdAt: new Date().toISOString() },
  { id: 'u10', name: 'Litre',      abbreviation: 'L',     description: 'Volume in litres',                     isActive: true, createdAt: new Date().toISOString() },
  { id: 'u11', name: 'Millilitre', abbreviation: 'ml',    description: 'Volume in millilitres',                isActive: true, createdAt: new Date().toISOString() },
  { id: 'u12', name: 'Crate',      abbreviation: 'crate', description: 'A crate of items (e.g. soft drinks)',  isActive: true, createdAt: new Date().toISOString() },
  { id: 'u13', name: 'Roll',       abbreviation: 'roll',  description: 'Rolled items (e.g. toilet roll)',      isActive: true, createdAt: new Date().toISOString() },
  { id: 'u14', name: 'Pair',       abbreviation: 'pr',    description: 'Two items sold together',              isActive: true, createdAt: new Date().toISOString() },
  { id: 'u15', name: 'Tin',        abbreviation: 'tin',   description: 'Items in a tin container',             isActive: true, createdAt: new Date().toISOString() },
  { id: 'u16', name: 'Sachet',     abbreviation: 'sch',   description: 'Small sachet / pouch',                 isActive: true, createdAt: new Date().toISOString() },
  { id: 'u17', name: 'Bundle',     abbreviation: 'bndl',  description: 'Bundled group of items',               isActive: true, createdAt: new Date().toISOString() },
  { id: 'u18', name: 'Sheet',      abbreviation: 'sht',   description: 'Flat sheet item',                      isActive: true, createdAt: new Date().toISOString() },
  { id: 'u19', name: 'Metre',      abbreviation: 'm',     description: 'Length in metres',                     isActive: true, createdAt: new Date().toISOString() },
  { id: 'u20', name: 'Set',        abbreviation: 'set',   description: 'A matched set of items',               isActive: true, createdAt: new Date().toISOString() },
];

function loadState(): UnitRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as UnitRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* noop */ }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_UNITS));
  return SEED_UNITS;
}

function persist(units: UnitRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
}

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const auth = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
    return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
  } catch { return { businessId: null, branchId: null }; }
}

export const useUnitStore = create<UnitStore>((set) => ({
  units: loadState(),

  addUnit: (data) => {
    const newUnit: UnitRecord = { ...data, id: genId(), createdAt: new Date().toISOString() };
    set((state) => {
      const next = [...state.units, newUnit];
      persist(next);
      return { units: next };
    });
    useSyncStore.getState().enqueue({
      offlineUuid: newUnit.id,
      appLabel: 'products',
      modelName: 'unitofmeasure',
      action: 'create',
      payload: newUnit as unknown as Record<string, unknown>,
      ...getAuthContext(),
      version: 1,
    });
    return newUnit;
  },

  updateUnit: (id, data) => {
    set((state) => {
      const next = state.units.map((u) => u.id === id ? { ...u, ...data } : u);
      persist(next);
      return { units: next };
    });
    const updated = useUnitStore.getState().units.find((u) => u.id === id);
    if (updated) {
      useSyncStore.getState().enqueue({
        offlineUuid: id,
        appLabel: 'products',
        modelName: 'unitofmeasure',
        action: 'update',
        payload: updated as unknown as Record<string, unknown>,
        ...getAuthContext(),
        version: Date.now(),
      });
    }
  },

  deleteUnit: (id) => {
    set((state) => {
      const next = state.units.filter((u) => u.id !== id);
      persist(next);
      return { units: next };
    });
    useSyncStore.getState().enqueue({
      offlineUuid: id,
      appLabel: 'products',
      modelName: 'unitofmeasure',
      action: 'delete',
      payload: { id },
      ...getAuthContext(),
      version: Date.now(),
    });
  },

  syncFromBackend: async () => {
    try {
      interface BackendUnit {
        id: string;
        name: string;
        code?: string;
        symbol?: string;
        description?: string;
        is_active?: boolean;
        created_at?: string;
      }
      const res = await api.get<{ results?: BackendUnit[] } | BackendUnit[]>('/units/?limit=500');
      const raw: BackendUnit[] = Array.isArray(res.data)
        ? res.data
        : (res.data.results ?? []);

      const now = new Date().toISOString();
      const backendRecords: UnitRecord[] = raw.map((b) => ({
        id: b.id,
        name: b.name,
        abbreviation: b.symbol ?? b.code ?? '',
        description: b.description ?? '',
        isActive: b.is_active ?? true,
        createdAt: b.created_at ?? now,
      }));

      set((state) => {
        const backendIds = new Set(backendRecords.map((r) => r.id));
        const localOnly = state.units.filter((u) => !backendIds.has(u.id));
        const merged = [...backendRecords, ...localOnly];
        persist(merged);
        return { units: merged };
      });
    } catch { /* offline or unauthenticated — keep existing state */ }
  },
}));
