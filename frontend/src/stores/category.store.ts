import { create } from 'zustand';
import { useSyncStore } from './sync.store';
import api from '@/services/api';

export interface CategoryRecord {
  id: string;
  name: string;
  color: string; // tailwind bg class e.g. 'bg-blue-100'
  accent: string; // tailwind text class e.g. 'text-blue-600'
  icon: string; // emoji or short label
  isDefault: boolean; // seeded by business type — still deletable
  createdAt: string;
}

interface CategoryStore {
  categories: CategoryRecord[];
  addCategory: (data: { name: string; color: string; accent: string; icon: string }) => CategoryRecord;
  deleteCategory: (id: string) => void;
  seedForBusinessType: (businessType: string) => void;
  syncFromBackend: () => Promise<void>;
}

const STORAGE_KEY = 'popmyc-categories';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `cat-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

// ── Preset category palettes per business type ──────────────────────────────
// Each entry: [id-slug, name, color-bg, accent-text, icon-emoji]
type CatPreset = [string, string, string, string, string];

const BUSINESS_CATEGORY_PRESETS: Record<string, CatPreset[]> = {
  // ── Legacy string keys (old business.type field) ──────────────────────────
  general: [
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['food', 'Food & Snacks', 'bg-amber-100', 'text-amber-700', '🍞'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['dairy', 'Dairy & Eggs', 'bg-rose-100', 'text-rose-700', '🥛'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],
  supermarket: [
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['fresh-produce', 'Fresh Produce', 'bg-green-100', 'text-green-700', '🥦'],
    ['bakery', 'Bakery', 'bg-orange-100', 'text-orange-700', '🥐'],
    ['dairy', 'Dairy & Eggs', 'bg-rose-100', 'text-rose-700', '🥛'],
    ['meat-fish', 'Meat & Fish', 'bg-red-100', 'text-red-700', '🥩'],
    ['frozen', 'Frozen Foods', 'bg-cyan-100', 'text-cyan-700', '🧊'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['snacks', 'Snacks & Confectionery', 'bg-amber-100', 'text-amber-700', '🍫'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],
  pharmacy: [
    ['prescription', 'Prescription', 'bg-blue-100', 'text-blue-700', '💊'],
    ['otc', 'Over The Counter', 'bg-emerald-100', 'text-emerald-700', '🩺'],
    ['vitamins', 'Vitamins & Supplements', 'bg-amber-100', 'text-amber-700', '🧪'],
    ['personal-care', 'Personal Care', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['baby-care', 'Baby Care', 'bg-pink-100', 'text-pink-700', '👶'],
    ['equipment', 'Medical Equipment', 'bg-sky-100', 'text-sky-700', '🩻'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  phone_shop: [
    ['smartphones', 'Smartphones', 'bg-blue-100', 'text-blue-700', '📱'],
    ['accessories', 'Accessories', 'bg-purple-100', 'text-purple-700', '🎧'],
    ['chargers', 'Chargers & Cables', 'bg-amber-100', 'text-amber-700', '🔌'],
    ['cases', 'Cases & Covers', 'bg-emerald-100', 'text-emerald-700', '🛡️'],
    ['screen-protect', 'Screen Protectors', 'bg-sky-100', 'text-sky-700', '🔲'],
    ['tablets', 'Tablets', 'bg-indigo-100', 'text-indigo-700', '📲'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  electronics: [
    ['phones', 'Phones', 'bg-blue-100', 'text-blue-700', '📱'],
    ['laptops', 'Laptops & PCs', 'bg-indigo-100', 'text-indigo-700', '💻'],
    ['tv-audio', 'TV & Audio', 'bg-purple-100', 'text-purple-700', '📺'],
    ['home-appliances', 'Home Appliances', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['accessories', 'Accessories', 'bg-amber-100', 'text-amber-700', '🎧'],
    ['gaming', 'Gaming', 'bg-rose-100', 'text-rose-700', '🎮'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  boutique: [
    ['womens', "Women's Wear", 'bg-pink-100', 'text-pink-700', '👗'],
    ['mens', "Men's Wear", 'bg-blue-100', 'text-blue-700', '👔'],
    ['kids', "Kids' Wear", 'bg-amber-100', 'text-amber-700', '👕'],
    ['shoes', 'Shoes & Sandals', 'bg-rose-100', 'text-rose-700', '👠'],
    ['bags', 'Bags & Purses', 'bg-purple-100', 'text-purple-700', '👜'],
    ['accessories', 'Accessories', 'bg-emerald-100', 'text-emerald-700', '💍'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  cosmetics: [
    ['skincare', 'Skin Care', 'bg-rose-100', 'text-rose-700', '🧴'],
    ['makeup', 'Makeup', 'bg-pink-100', 'text-pink-700', '💄'],
    ['haircare', 'Hair Care', 'bg-amber-100', 'text-amber-700', '💇'],
    ['fragrances', 'Fragrances', 'bg-violet-100', 'text-violet-700', '🌸'],
    ['nails', 'Nail Care', 'bg-fuchsia-100', 'text-fuchsia-700', '💅'],
    ['body-care', 'Body Care', 'bg-orange-100', 'text-orange-700', '🛁'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  restaurant: [
    ['starters', 'Starters', 'bg-amber-100', 'text-amber-700', '🥗'],
    ['mains', 'Main Courses', 'bg-orange-100', 'text-orange-700', '🍛'],
    ['grills', 'Grills & BBQ', 'bg-red-100', 'text-red-700', '🍗'],
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['desserts', 'Desserts', 'bg-pink-100', 'text-pink-700', '🍰'],
    ['specials', 'Daily Specials', 'bg-emerald-100', 'text-emerald-700', '⭐'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  wholesale: [
    ['dry-goods', 'Dry Goods', 'bg-amber-100', 'text-amber-700', '🌾'],
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['frozen', 'Frozen Foods', 'bg-cyan-100', 'text-cyan-700', '🧊'],
    ['building', 'Building Materials', 'bg-stone-100', 'text-stone-700', '🧱'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],

  // ── New BusinessCategory enum keys (used by business.businessCategory) ────
  GENERAL_RETAIL: [
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['food', 'Food & Snacks', 'bg-amber-100', 'text-amber-700', '🍞'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['dairy', 'Dairy & Eggs', 'bg-rose-100', 'text-rose-700', '🥛'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],
  PROVISION_GROCERY: [
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['grains-cereals', 'Grains & Cereals', 'bg-amber-100', 'text-amber-700', '🌾'],
    ['canned-goods', 'Canned & Packaged', 'bg-orange-100', 'text-orange-700', '🥫'],
    ['dairy', 'Dairy & Eggs', 'bg-rose-100', 'text-rose-700', '🥛'],
    ['condiments', 'Condiments & Spices', 'bg-yellow-100', 'text-yellow-700', '🧂'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],
  SUPERMARKET: [
    ['beverages', 'Beverages', 'bg-blue-100', 'text-blue-700', '🥤'],
    ['fresh-produce', 'Fresh Produce', 'bg-green-100', 'text-green-700', '🥦'],
    ['bakery', 'Bakery', 'bg-orange-100', 'text-orange-700', '🥐'],
    ['dairy', 'Dairy & Eggs', 'bg-rose-100', 'text-rose-700', '🥛'],
    ['meat-fish', 'Meat & Fish', 'bg-red-100', 'text-red-700', '🥩'],
    ['frozen', 'Frozen Foods', 'bg-cyan-100', 'text-cyan-700', '🧊'],
    ['household', 'Household', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['toiletries', 'Toiletries', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['snacks', 'Snacks & Confectionery', 'bg-amber-100', 'text-amber-700', '🍫'],
    ['other', 'Other', 'bg-emerald-100', 'text-emerald-700', '📦'],
  ],
  PHARMACY: [
    ['prescription', 'Prescription', 'bg-blue-100', 'text-blue-700', '💊'],
    ['otc', 'Over The Counter', 'bg-emerald-100', 'text-emerald-700', '🩺'],
    ['vitamins', 'Vitamins & Supplements', 'bg-amber-100', 'text-amber-700', '🧪'],
    ['personal-care', 'Personal Care', 'bg-violet-100', 'text-violet-700', '🧴'],
    ['baby-care', 'Baby Care', 'bg-pink-100', 'text-pink-700', '👶'],
    ['equipment', 'Medical Equipment', 'bg-sky-100', 'text-sky-700', '🩻'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  COSMETICS: [
    ['skincare', 'Skin Care', 'bg-rose-100', 'text-rose-700', '🧴'],
    ['makeup', 'Makeup', 'bg-pink-100', 'text-pink-700', '💄'],
    ['haircare', 'Hair Care', 'bg-amber-100', 'text-amber-700', '💇'],
    ['fragrances', 'Fragrances', 'bg-violet-100', 'text-violet-700', '🌸'],
    ['nails', 'Nail Care', 'bg-fuchsia-100', 'text-fuchsia-700', '💅'],
    ['body-care', 'Body Care', 'bg-orange-100', 'text-orange-700', '🛁'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  ELECTRONICS: [
    ['phones', 'Phones', 'bg-blue-100', 'text-blue-700', '📱'],
    ['laptops', 'Laptops & PCs', 'bg-indigo-100', 'text-indigo-700', '💻'],
    ['tv-audio', 'TV & Audio', 'bg-purple-100', 'text-purple-700', '📺'],
    ['home-appliances', 'Home Appliances', 'bg-sky-100', 'text-sky-700', '🏠'],
    ['accessories', 'Accessories', 'bg-amber-100', 'text-amber-700', '🎧'],
    ['gaming', 'Gaming', 'bg-rose-100', 'text-rose-700', '🎮'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  PHONE_ACCESSORIES: [
    ['smartphones', 'Smartphones', 'bg-blue-100', 'text-blue-700', '📱'],
    ['accessories', 'Accessories', 'bg-purple-100', 'text-purple-700', '🎧'],
    ['chargers', 'Chargers & Cables', 'bg-amber-100', 'text-amber-700', '🔌'],
    ['cases', 'Cases & Covers', 'bg-emerald-100', 'text-emerald-700', '🛡️'],
    ['screen-protect', 'Screen Protectors', 'bg-sky-100', 'text-sky-700', '🔲'],
    ['tablets', 'Tablets', 'bg-indigo-100', 'text-indigo-700', '📲'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  FASHION_CLOTHING: [
    ['womens', "Women's Wear", 'bg-pink-100', 'text-pink-700', '👗'],
    ['mens', "Men's Wear", 'bg-blue-100', 'text-blue-700', '👔'],
    ['kids', "Kids' Wear", 'bg-amber-100', 'text-amber-700', '👕'],
    ['shoes', 'Shoes & Sandals', 'bg-rose-100', 'text-rose-700', '👠'],
    ['bags', 'Bags & Purses', 'bg-purple-100', 'text-purple-700', '👜'],
    ['accessories', 'Accessories', 'bg-emerald-100', 'text-emerald-700', '💍'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  SHOES: [
    ['mens-shoes', "Men's Shoes", 'bg-blue-100', 'text-blue-700', '👞'],
    ['womens-shoes', "Women's Shoes", 'bg-pink-100', 'text-pink-700', '👠'],
    ['kids-shoes', "Kids' Shoes", 'bg-amber-100', 'text-amber-700', '👟'],
    ['sandals', 'Sandals & Slippers', 'bg-orange-100', 'text-orange-700', '🩴'],
    ['sports', 'Sports & Sneakers', 'bg-emerald-100', 'text-emerald-700', '👟'],
    ['accessories', 'Shoe Accessories', 'bg-violet-100', 'text-violet-700', '🧦'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  SERVICE: [
    ['consultation', 'Consultation', 'bg-blue-100', 'text-blue-700', '🤝'],
    ['repair', 'Repair & Maintenance', 'bg-amber-100', 'text-amber-700', '🔧'],
    ['delivery', 'Delivery & Logistics', 'bg-sky-100', 'text-sky-700', '🚚'],
    ['installation', 'Installation', 'bg-indigo-100', 'text-indigo-700', '🔩'],
    ['cleaning', 'Cleaning', 'bg-cyan-100', 'text-cyan-700', '🧹'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
  OTHER: [
    ['category-1', 'Category 1', 'bg-blue-100', 'text-blue-700', '📦'],
    ['category-2', 'Category 2', 'bg-emerald-100', 'text-emerald-700', '📦'],
    ['category-3', 'Category 3', 'bg-amber-100', 'text-amber-700', '📦'],
    ['other', 'Other', 'bg-gray-100', 'text-gray-700', '📦'],
  ],
};

function presetsToRecords(presets: CatPreset[]): CategoryRecord[] {
  const now = new Date().toISOString();
  return presets.map(([id, name, color, accent, icon]) => ({
    id,
    name,
    color,
    accent,
    icon,
    isDefault: true,
    createdAt: now,
  }));
}

function loadState(businessType: string): CategoryRecord[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as CategoryRecord[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* noop */ }
  // First load — seed from business type
  const presets = BUSINESS_CATEGORY_PRESETS[businessType] ?? BUSINESS_CATEGORY_PRESETS.general;
  const seeded = presetsToRecords(presets);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
  return seeded;
}

function persist(categories: CategoryRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
}

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const auth = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
    return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
  } catch { return { businessId: null, branchId: null }; }
}

// Read business category from settings store's localStorage directly to avoid
// circular deps. Prefers the new businessCategory enum key; falls back to the
// legacy business.type string so old persisted data still works.
function getStoredBusinessType(): string {
  try {
    const raw = localStorage.getItem('popmyc-settings');
    if (raw) {
      const parsed = JSON.parse(raw) as { business?: { businessCategory?: string; type?: string } };
      // New stable key takes priority
      if (parsed?.business?.businessCategory) return parsed.business.businessCategory;
      // Legacy fallback
      if (parsed?.business?.type) return parsed.business.type;
    }
  } catch { /* noop */ }
  return 'GENERAL_RETAIL';
}

export const useCategoryStore = create<CategoryStore>((set) => {
  const businessType = getStoredBusinessType();
  const initial = loadState(businessType);
  return {
    categories: initial,

    addCategory: (data) => {
      const newCat: CategoryRecord = {
        id: genId(),
        name: data.name,
        color: data.color,
        accent: data.accent,
        icon: data.icon,
        isDefault: false,
        createdAt: new Date().toISOString(),
      };
      set((state) => {
        const next = [...state.categories, newCat];
        persist(next);
        return { categories: next };
      });
      useSyncStore.getState().enqueue({
        offlineUuid: newCat.id,
        appLabel: 'products',
        modelName: 'category',
        action: 'create',
        payload: newCat as unknown as Record<string, unknown>,
        ...getAuthContext(),
        version: 1,
      });
      return newCat;
    },

    deleteCategory: (id) => {
      set((state) => {
        const next = state.categories.filter((c) => c.id !== id);
        persist(next);
        return { categories: next };
      });
      useSyncStore.getState().enqueue({
        offlineUuid: id,
        appLabel: 'products',
        modelName: 'category',
        action: 'delete',
        payload: { id },
        ...getAuthContext(),
        version: Date.now(),
      });
    },

    // Called when user changes business type in settings — replaces stored categories
    seedForBusinessType: (businessType) => {
      const presets = BUSINESS_CATEGORY_PRESETS[businessType] ?? BUSINESS_CATEGORY_PRESETS.general;
      const seeded = presetsToRecords(presets);
      persist(seeded);
      set({ categories: seeded });
    },

    syncFromBackend: async () => {
      try {
        interface BackendCategory {
          id: string;
          name: string;
          code?: string;
          description?: string;
          is_active?: boolean;
          created_at?: string;
        }
        const res = await api.get<{ results?: BackendCategory[] } | BackendCategory[]>('/categories/?limit=500');
        const raw: BackendCategory[] = Array.isArray(res.data)
          ? res.data
          : (res.data.results ?? []);

        const now = new Date().toISOString();
        const backendRecords: CategoryRecord[] = raw.map((b) => ({
          id: b.id,
          name: b.name,
          color: 'bg-blue-100',
          accent: 'text-blue-700',
          icon: '📦',
          isDefault: false,
          createdAt: b.created_at ?? now,
        }));

        set((state) => {
          const backendIds = new Set(backendRecords.map((r) => r.id));
          const localOnly = state.categories.filter((c) => !backendIds.has(c.id));
          const merged = [...backendRecords, ...localOnly];
          persist(merged);
          return { categories: merged };
        });
      } catch { /* offline or unauthenticated — keep existing state */ }
    },
  };
});

// Export presets map so SettingsPage can show a preview
export { BUSINESS_CATEGORY_PRESETS };
export type { CatPreset };
