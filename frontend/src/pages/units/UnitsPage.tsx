import { useState, useMemo } from 'react';
import {
  Ruler,
  Plus,
  Trash2,
  Search,
  X,
  AlertTriangle,
  Pencil,
  Check,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useUnitStore, type UnitRecord } from '@/stores/unit.store';

const inputClass =
  'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow';

export default function UnitsPage() {
  const units      = useUnitStore((s) => s.units);
  const addUnit    = useUnitStore((s) => s.addUnit);
  const updateUnit = useUnitStore((s) => s.updateUnit);
  const deleteUnit = useUnitStore((s) => s.deleteUnit);

  const [search,        setSearch]        = useState('');
  const [filterActive,  setFilterActive]  = useState<'all' | 'active' | 'inactive'>('all');
  const [modalOpen,     setModalOpen]     = useState(false);
  const [editTarget,    setEditTarget]    = useState<UnitRecord | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<UnitRecord | null>(null);
  const [form, setForm] = useState({ name: '', abbreviation: '', description: '', isActive: true });
  const [saved, setSaved] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return units.filter((u) => {
      const matchSearch =
        q === '' ||
        u.name.toLowerCase().includes(q) ||
        u.abbreviation.toLowerCase().includes(q) ||
        u.description.toLowerCase().includes(q);
      const matchActive =
        filterActive === 'all'      ? true :
        filterActive === 'active'   ? u.isActive :
                                      !u.isActive;
      return matchSearch && matchActive;
    });
  }, [units, search, filterActive]);

  const stats = useMemo(() => ({
    total:  units.length,
    active: units.filter((u) => u.isActive).length,
  }), [units]);

  function openAdd() {
    setForm({ name: '', abbreviation: '', description: '', isActive: true });
    setEditTarget(null);
    setSaved(false);
    setModalOpen(true);
  }

  function openEdit(u: UnitRecord) {
    setForm({ name: u.name, abbreviation: u.abbreviation, description: u.description, isActive: u.isActive });
    setEditTarget(u);
    setSaved(false);
    setModalOpen(true);
  }

  function handleSave() {
    if (!form.name.trim() || !form.abbreviation.trim()) return;
    if (editTarget) {
      updateUnit(editTarget.id, { ...form });
    } else {
      addUnit({ ...form });
    }
    setSaved(true);
    setTimeout(() => {
      setModalOpen(false);
      setEditTarget(null);
      setSaved(false);
    }, 700);
  }

  function handleDelete() {
    if (deleteTarget) { deleteUnit(deleteTarget.id); setDeleteTarget(null); }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight flex items-center gap-2">
            <Ruler className="h-6 w-6 text-muted-400" /> Units of Measure
          </h1>
          <p className="text-sm text-muted-500 mt-0.5">
            Define units for products — pcs, pack, box, kg, L, etc.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" /> Add Unit
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Units',   value: stats.total,                    color: 'bg-blue-50 text-blue-600 ring-blue-100'     },
          { label: 'Active',        value: stats.active,                   color: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
          { label: 'Inactive',      value: stats.total - stats.active,     color: 'bg-muted-100 text-muted-600 ring-muted-200'  },
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
          <input
            type="text"
            placeholder="Search name or abbreviation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
          />
        </div>
        <div className="flex items-center gap-2">
          {(['all', 'active', 'inactive'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterActive(f)}
              className={clsx(
                'rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all capitalize',
                filterActive === f
                  ? 'bg-[#1E293B] text-white shadow-sm'
                  : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Units Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Ruler className="h-10 w-10 mx-auto mb-3 text-muted-300" />
            <p className="text-sm font-semibold text-muted-500">No units found</p>
            <p className="text-xs text-muted-400 mt-1">
              Add units like pcs, pack, box, kg to use on products.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted-100 bg-muted-50/50">
                  <th className="text-left font-semibold text-muted-600 px-5 py-3">Name</th>
                  <th className="text-left font-semibold text-muted-600 px-5 py-3 w-24">Abbrev.</th>
                  <th className="text-left font-semibold text-muted-600 px-5 py-3 hidden sm:table-cell">Description</th>
                  <th className="text-center font-semibold text-muted-600 px-5 py-3 w-24">Status</th>
                  <th className="text-center font-semibold text-muted-600 px-5 py-3 w-32">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-muted-50 hover:bg-muted-50/40 transition-colors group">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-[#1E293B]">{u.name}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center rounded-full bg-[#1E293B]/[0.07] text-[#1E293B] text-xs font-bold px-2.5 py-1 font-mono">
                        {u.abbreviation}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-500 text-xs hidden sm:table-cell max-w-[260px] truncate">
                      {u.description || '—'}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className={clsx(
                        'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                        u.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-muted-100 text-muted-500'
                      )}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(u)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-muted-100 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {/* Toggle active */}
                        <button
                          onClick={() => updateUnit(u.id, { isActive: !u.isActive })}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-muted-100 transition-colors"
                          title={u.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {u.isActive
                            ? <ToggleLeft className="h-4 w-4" />
                            : <ToggleRight className="h-4 w-4 text-emerald-600" />}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => setDeleteTarget(u)}
                          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add / Edit Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
              <h2 className="text-base font-bold text-[#1E293B] flex items-center gap-2">
                <Ruler className="h-4 w-4 text-muted-400" />
                {editTarget ? 'Edit Unit' : 'Add Unit'}
              </h2>
              <button onClick={() => { setModalOpen(false); setEditTarget(null); }}
                className="p-2 rounded-lg hover:bg-muted-100">
                <X className="h-5 w-5 text-muted-400" />
              </button>
            </div>

            {saved ? (
              <div className="px-5 py-10 flex flex-col items-center text-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-7 w-7 text-emerald-600" />
                </div>
                <p className="text-sm font-bold text-[#1E293B]">
                  Unit {editTarget ? 'updated' : 'added'}!
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Unit Name *</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Piece, Pack, Box"
                      className={inputClass}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Abbreviation *</label>
                    <input
                      value={form.abbreviation}
                      onChange={(e) => setForm({ ...form, abbreviation: e.target.value })}
                      placeholder="e.g. pcs"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Status</label>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, isActive: !form.isActive })}
                      className={clsx(
                        'w-full h-10 rounded-xl border text-sm font-semibold transition-colors flex items-center justify-center gap-2',
                        form.isActive
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-muted-200 bg-muted-50 text-muted-500'
                      )}
                    >
                      {form.isActive
                        ? <><ToggleLeft className="h-4 w-4" /> Active</>
                        : <><ToggleRight className="h-4 w-4" /> Inactive</>}
                    </button>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Description</label>
                    <input
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Short description (optional)"
                      className={inputClass}
                    />
                  </div>
                </div>

                {/* Live preview */}
                {form.name && form.abbreviation && (
                  <div className="rounded-xl bg-muted-50 border border-muted-100 p-3 flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-[#1E293B]/[0.07] text-[#1E293B] text-xs font-bold px-3 py-1.5 font-mono">
                      {form.abbreviation}
                    </span>
                    <span className="text-sm font-semibold text-[#1E293B]">{form.name}</span>
                    {form.description && <span className="text-xs text-muted-400 truncate">{form.description}</span>}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => { setModalOpen(false); setEditTarget(null); }}
                    className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!form.name.trim() || !form.abbreviation.trim()}
                    className="flex-1 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-40"
                  >
                    {editTarget ? 'Save Changes' : 'Add Unit'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Delete Unit</h3>
                <p className="text-sm text-muted-500">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted-600">
              Delete <span className="font-semibold text-[#1E293B]">{deleteTarget.name}</span>{' '}
              (<span className="font-mono text-xs">{deleteTarget.abbreviation}</span>)?
              Products using this unit will be unaffected but will lose their unit label.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
