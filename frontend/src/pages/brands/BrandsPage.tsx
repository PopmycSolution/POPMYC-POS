import { useState, useMemo } from 'react';
import {
  Tag, Plus, Trash2, Search, Package,
  Globe, X, AlertTriangle, Pencil,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBrandStore, type BrandRecord } from '@/stores/brand.store';
import { useProductStore } from '@/stores/product.store';

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10';

// Colour palette for brand avatars
const BRAND_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-rose-500',
  'bg-amber-500', 'bg-sky-500', 'bg-indigo-500', 'bg-teal-500',
];
function getBrandColor(name: string) {
  const idx = name.charCodeAt(0) % BRAND_COLORS.length;
  return BRAND_COLORS[idx];
}
function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function BrandsPage() {
  const brands      = useBrandStore((s) => s.brands);
  const addBrand    = useBrandStore((s) => s.addBrand);
  const updateBrand = useBrandStore((s) => s.updateBrand);
  const deleteBrand = useBrandStore((s) => s.deleteBrand);
  const products    = useProductStore((s) => s.products);

  // Live count — never stale; no stored field needed
  const productCountByBrand = useMemo(() => {
    const counts: Record<string, number> = {};
    products.forEach((p) => {
      if (p.brandId) counts[p.brandId] = (counts[p.brandId] ?? 0) + 1;
    });
    return counts;
  }, [products]);

  const [search,       setSearch]       = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editTarget,   setEditTarget]   = useState<BrandRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandRecord | null>(null);

  const [form, setForm] = useState({ name: '', code: '', description: '', website: '', logoUrl: '', isActive: true });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return brands.filter((b) => {
      const matchSearch = q === '' ||
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q);
      const matchActive =
        filterActive === 'all' ? true :
        filterActive === 'active' ? b.isActive : !b.isActive;
      return matchSearch && matchActive;
    });
  }, [brands, search, filterActive]);

  const stats = useMemo(() => ({
    total:    brands.length,
    active:   brands.filter((b) => b.isActive).length,
    products: Object.values(productCountByBrand).reduce((s, n) => s + n, 0),
  }), [brands, productCountByBrand]);

  function openAdd() {
    setForm({ name: '', code: '', description: '', website: '', logoUrl: '', isActive: true });
    setAddModalOpen(true);
    setEditTarget(null);
  }

  function openEdit(b: BrandRecord) {
    setForm({ name: b.name, code: b.code, description: b.description, website: b.website ?? '', logoUrl: b.logoUrl ?? '', isActive: b.isActive });
    setEditTarget(b);
    setAddModalOpen(true);
  }

  function handleSave() {
    if (!form.name.trim() || !form.code.trim()) return;
    if (editTarget) {
      updateBrand(editTarget.id, { ...form });
    } else {
      addBrand({ ...form });
    }
    setAddModalOpen(false);
    setEditTarget(null);
  }

  function handleDelete() {
    if (deleteTarget) { deleteBrand(deleteTarget.id); setDeleteTarget(null); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Brands</h1>
          <p className="text-sm text-muted-500 mt-0.5">Manage product brands and manufacturers</p>
        </div>
        <button onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Add Brand
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Brands',    value: stats.total,    color: 'bg-blue-50 text-blue-600 ring-blue-100'    },
          { label: 'Active',          value: stats.active,   color: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
          { label: 'Total Products',  value: stats.products, color: 'bg-purple-50 text-purple-600 ring-purple-100' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
            <p className="text-xs font-medium text-muted-500">{s.label}</p>
            <p className="text-2xl font-bold text-[#1E293B] mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search name, code..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button key={f} onClick={() => setFilterActive(f)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all capitalize',
                filterActive === f ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Brands Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-muted-100 py-14 text-center">
          <Tag className="h-10 w-10 mx-auto mb-3 text-muted-300" />
          <p className="text-sm font-semibold text-muted-500">No brands found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((b) => (
            <div key={b.id} className="bg-white rounded-2xl border border-muted-100 shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-5 flex flex-col gap-3 group hover:-translate-y-0.5 hover:shadow-md transition-all">
              {/* Avatar + name */}
              <div className="flex items-center gap-3">
                <div className={clsx('flex h-11 w-11 items-center justify-center rounded-2xl text-white text-sm font-bold shrink-0', getBrandColor(b.name))}>
                  {b.logoUrl
                    ? <img src={b.logoUrl} alt={b.name} className="h-full w-full object-contain rounded-2xl" />
                    : getInitials(b.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-[#1E293B] truncate">{b.name}</p>
                  <p className="text-xs text-muted-400 font-mono">{b.code}</p>
                </div>
                <span className={clsx('text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0',
                  b.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-muted-100 text-muted-500')}>
                  {b.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              {b.description && (
                <p className="text-xs text-muted-500 line-clamp-2">{b.description}</p>
              )}

              <div className="flex items-center justify-between text-xs text-muted-400 mt-auto pt-2 border-t border-muted-50">
                <span className="flex items-center gap-1">
                  <Package className="h-3 w-3" /> {productCountByBrand[b.id] ?? 0} products
                </span>
                {b.website && (
                  <a href={b.website} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>
                    <Globe className="h-3 w-3" /> Website
                  </a>
                )}
              </div>

              {/* Actions — always visible */}
              <div className="flex gap-2 pt-1 border-t border-muted-100">
                <button onClick={() => openEdit(b)}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-muted-200 py-1.5 text-xs font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => updateBrand(b.id, { isActive: !b.isActive })}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-muted-200 py-1.5 text-xs font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                  {b.isActive ? <ToggleLeft className="h-3.5 w-3.5" /> : <ToggleRight className="h-3.5 w-3.5" />}
                  {b.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button
                  onClick={() => setDeleteTarget(b)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg border border-rose-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-colors shrink-0"
                  aria-label={`Delete ${b.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
              <h2 className="text-base font-bold text-[#1E293B]">{editTarget ? 'Edit Brand' : 'Add Brand'}</h2>
              <button onClick={() => { setAddModalOpen(false); setEditTarget(null); }} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Brand Name *</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nestlé" className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Code *</label>
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. NESTLE" className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Website</label>
                  <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://..." className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Logo URL (optional)</label>
                  <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://logo.url/image.png" className={inputClass} />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2}
                    placeholder="Short description..." className="w-full px-3 py-2.5 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none" />
                </div>
                <div className="col-span-2 flex items-center justify-between p-3 rounded-xl bg-muted-50 border border-muted-100">
                  <span className="text-sm font-medium text-[#1E293B]">Active</span>
                  <button onClick={() => setForm({ ...form, isActive: !form.isActive })}
                    className="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors"
                    style={{ backgroundColor: form.isActive ? '#1E293B' : '#D1D5DB' }}>
                    <span className={clsx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                      form.isActive ? 'translate-x-5' : 'translate-x-0')} />
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => { setAddModalOpen(false); setEditTarget(null); }}
                  className="rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">Cancel</button>
                <button onClick={handleSave} disabled={!form.name.trim() || !form.code.trim()}
                  className="rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-40">
                  {editTarget ? 'Save Changes' : 'Add Brand'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Delete Brand</h3>
                <p className="text-sm text-muted-500">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted-600">Delete <span className="font-semibold text-[#1E293B]">{deleteTarget.name}</span>?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">Cancel</button>
              <button onClick={handleDelete}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
