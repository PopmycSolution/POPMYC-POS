import { useState } from 'react';
import {
  Tag,
  Plus,
  Trash2,
  RefreshCw,
  AlertTriangle,
  Package,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useCategoryStore, BUSINESS_CATEGORY_PRESETS } from '@/stores/category.store';
import { useSettingsStore } from '@/stores/settings.store';
import { BUSINESS_CATEGORY_LABELS } from '@/types';

// ── Colour palette ────────────────────────────────────────────────────────────
const COLOR_PALETTE = [
  { color: 'bg-blue-100',    accent: 'text-blue-700',    preview: 'bg-blue-400' },
  { color: 'bg-emerald-100', accent: 'text-emerald-700', preview: 'bg-emerald-400' },
  { color: 'bg-amber-100',   accent: 'text-amber-700',   preview: 'bg-amber-400' },
  { color: 'bg-rose-100',    accent: 'text-rose-700',    preview: 'bg-rose-400' },
  { color: 'bg-purple-100',  accent: 'text-purple-700',  preview: 'bg-purple-400' },
  { color: 'bg-sky-100',     accent: 'text-sky-700',     preview: 'bg-sky-400' },
  { color: 'bg-orange-100',  accent: 'text-orange-700',  preview: 'bg-orange-400' },
  { color: 'bg-pink-100',    accent: 'text-pink-700',    preview: 'bg-pink-400' },
  { color: 'bg-indigo-100',  accent: 'text-indigo-700',  preview: 'bg-indigo-400' },
  { color: 'bg-teal-100',    accent: 'text-teal-700',    preview: 'bg-teal-400' },
  { color: 'bg-fuchsia-100', accent: 'text-fuchsia-700', preview: 'bg-fuchsia-400' },
  { color: 'bg-stone-100',   accent: 'text-stone-700',   preview: 'bg-stone-400' },
];

// Legacy labels kept for old persisted data; new enum labels come from BUSINESS_CATEGORY_LABELS
const LEGACY_BUSINESS_LABELS: Record<string, string> = {
  general: 'General Retail', supermarket: 'Supermarket', pharmacy: 'Pharmacy',
  phone_shop: 'Phone Shop', electronics: 'Electronics', boutique: 'Boutique',
  cosmetics: 'Cosmetics', restaurant: 'Restaurant', wholesale: 'Wholesale',
};

function resolveBusinessLabel(key: string): string {
  // New enum key (e.g. GENERAL_RETAIL) → use BUSINESS_CATEGORY_LABELS
  if (key in BUSINESS_CATEGORY_LABELS) return BUSINESS_CATEGORY_LABELS[key as keyof typeof BUSINESS_CATEGORY_LABELS];
  // Legacy key (e.g. "general") → use legacy map
  return LEGACY_BUSINESS_LABELS[key] ?? key;
}

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow';

export default function CategoriesPage() {
  const categories     = useCategoryStore((s) => s.categories);
  const addCategory    = useCategoryStore((s) => s.addCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);
  const seedForType    = useCategoryStore((s) => s.seedForBusinessType);

  // Read businessCategory (new field) first; fall back to legacy type so old
  // persisted settings still work correctly.
  const businessCategory = useSettingsStore((s) => s.business.businessCategory);
  const legacyType       = useSettingsStore((s) => s.business.type);
  const businessKey      = businessCategory || legacyType || 'GENERAL_RETAIL';

  const [newCatName,     setNewCatName]     = useState('');
  const [newCatIcon,     setNewCatIcon]     = useState('📦');
  const [newCatColor,    setNewCatColor]    = useState(0);
  const [catDeleteId,    setCatDeleteId]    = useState<string | null>(null);
  const [reseedConfirm,  setReseedConfirm]  = useState(false);

  // Use businessKey for preset lookup — works for both new enum keys and legacy strings
  const previewPresets = BUSINESS_CATEGORY_PRESETS[businessKey]
    ?? BUSINESS_CATEGORY_PRESETS[legacyType]
    ?? BUSINESS_CATEGORY_PRESETS['GENERAL_RETAIL'];
  const businessLabel  = resolveBusinessLabel(businessKey);

  function handleAdd() {
    const name = newCatName.trim();
    if (!name) return;
    const palette = COLOR_PALETTE[newCatColor];
    addCategory({ name, icon: newCatIcon.trim() || '📦', color: palette.color, accent: palette.accent });
    setNewCatName('');
    setNewCatIcon('📦');
    setNewCatColor(0);
  }

  function handleReseed() {
    seedForType(businessKey);
    setReseedConfirm(false);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Categories</h1>
          <p className="text-sm text-muted-500 mt-0.5">Manage product categories for your store</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1E293B]/[0.06] text-[#1E293B] text-xs font-semibold px-3 py-1.5 w-fit">
          <Tag className="h-3.5 w-3.5" />
          {categories.length} {categories.length === 1 ? 'category' : 'categories'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* ── Left: category list ── */}
        <div className="space-y-4">
          {/* Category cards */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-muted-100">
              <h2 className="text-sm font-bold text-[#1E293B]">All Categories</h2>
            </div>

            {categories.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <Package className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                <p className="text-sm font-semibold text-muted-500">No categories yet</p>
                <p className="text-xs text-muted-400 mt-1">Add your first category using the form on the right.</p>
              </div>
            ) : (
              <div className="divide-y divide-muted-50">
                {categories.map((cat) => (
                  <div key={cat.id}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted-50/50 transition-colors group">
                    {/* Icon swatch */}
                    <div className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl shrink-0 text-xl shadow-sm', cat.color)}>
                      {cat.icon}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-sm font-bold truncate', cat.accent)}>{cat.name}</p>
                      <p className="text-[11px] text-muted-400 mt-0.5">
                        {cat.isDefault ? '✦ Default for this business type' : '✎ Custom category'}
                      </p>
                    </div>

                    {/* Colour pill */}
                    <span className={clsx('hidden sm:inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold shrink-0', cat.color, cat.accent)}>
                      {cat.name}
                    </span>

                    {/* Delete inline confirm */}
                    {catDeleteId === cat.id ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-500 hidden sm:inline">Delete?</span>
                        <button onClick={() => setCatDeleteId(null)}
                          className="text-xs font-semibold text-muted-600 border border-muted-200 rounded-lg px-2.5 py-1.5 hover:bg-muted-50 transition-colors">
                          Cancel
                        </button>
                        <button onClick={() => { deleteCategory(cat.id); setCatDeleteId(null); }}
                          className="text-xs font-semibold text-white bg-rose-600 rounded-lg px-2.5 py-1.5 hover:bg-rose-700 transition-colors">
                          Delete
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setCatDeleteId(cat.id)}
                        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-300 hover:text-rose-500 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        aria-label={`Delete ${cat.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Reset to business-type defaults ── */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-muted-400" />
              <h2 className="text-sm font-bold text-[#1E293B]">Reset to Business Type Defaults</h2>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-muted-600">
                Your current business type is{' '}
                <strong className="text-[#1E293B]">{businessLabel}</strong>.
                Resetting will replace <em>all</em> current categories with the preset list below.
              </p>

              {/* Preset preview pills */}
              <div className="flex flex-wrap gap-2">
                {previewPresets.map(([id, name, , , icon]) => (
                  <span key={id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted-100 px-3 py-1 text-xs font-medium text-muted-600">
                    {icon} {name}
                  </span>
                ))}
              </div>

              {!reseedConfirm ? (
                <button onClick={() => setReseedConfirm(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-200 text-amber-700 bg-amber-50 px-5 py-2.5 text-sm font-semibold hover:bg-amber-100 transition-colors">
                  <RefreshCw className="h-4 w-4" /> Reset Categories
                </button>
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-sm font-semibold text-amber-800">
                      This will delete all current categories. This cannot be undone.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setReseedConfirm(false)}
                      className="rounded-xl border border-muted-200 px-4 py-2 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleReseed}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors">
                      Yes, Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: Add new category ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden h-fit sticky top-24">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Plus className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Add New Category</h2>
          </div>
          <div className="p-5 space-y-5">
            {/* Name */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Category Name *</label>
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
                placeholder="e.g. Frozen Foods"
                className={inputClass}
              />
            </div>

            {/* Icon */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Icon (emoji)</label>
              <input
                value={newCatIcon}
                onChange={(e) => setNewCatIcon(e.target.value)}
                placeholder="🧊"
                className={clsx(inputClass, 'text-2xl text-center')}
                maxLength={4}
              />
            </div>

            {/* Colour picker */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-2 block">Category Colour</label>
              <div className="flex flex-wrap gap-2.5">
                {COLOR_PALETTE.map((p, i) => (
                  <button key={i} type="button" onClick={() => setNewCatColor(i)}
                    className={clsx('h-8 w-8 rounded-full transition-all', p.preview,
                      newCatColor === i
                        ? 'ring-2 ring-offset-2 ring-[#1E293B] scale-110'
                        : 'hover:scale-105 opacity-75 hover:opacity-100')}
                    aria-label={`Select colour ${i + 1}`}
                  />
                ))}
              </div>
            </div>

            {/* Live preview */}
            {newCatName.trim() && (
              <div className="rounded-xl border border-muted-100 p-3 bg-muted-50/50">
                <p className="text-[11px] font-semibold text-muted-400 mb-2 uppercase tracking-wider">Preview</p>
                <div className="flex items-center gap-3">
                  <div className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl shrink-0 text-xl shadow-sm', COLOR_PALETTE[newCatColor].color)}>
                    {newCatIcon || '📦'}
                  </div>
                  <span className={clsx('text-sm font-bold', COLOR_PALETTE[newCatColor].accent)}>
                    {newCatName}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleAdd}
              disabled={!newCatName.trim()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <Plus className="h-4 w-4" /> Add Category
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
