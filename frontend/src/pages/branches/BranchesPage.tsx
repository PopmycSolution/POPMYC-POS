import { useState, useEffect, useMemo } from 'react';
import {
  Building2, Plus, Search, MoreVertical, Pencil, Trash2,
  ToggleLeft, ToggleRight, MapPin, Phone, Star, CheckCircle,
  XCircle, Loader2, X, AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBranchStore } from '@/stores/branch.store';
import { useAuthStore } from '@/stores/auth.store';
import type { Branch } from '@/types';
import type { BranchPayload } from '@/services/branch.service';

// ─── helpers ─────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-50 mb-4">
        <Building2 className="h-8 w-8 text-teal-600" />
      </div>
      <h3 className="text-lg font-bold text-slate-800">No branches yet</h3>
      <p className="mt-1 text-sm text-slate-500 max-w-xs">
        Add your first branch to start managing multiple locations from one place.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 transition-colors"
      >
        <Plus className="h-4 w-4" /> Add First Branch
      </button>
    </div>
  );
}

// ─── Branch form modal ───────────────────────────────────────────────────────
interface BranchFormProps {
  initial?: Branch | null;
  businessId: string;
  onSave: (payload: BranchPayload) => Promise<void>;
  onClose: () => void;
}

function BranchFormModal({ initial, businessId, onSave, onClose }: BranchFormProps) {
  const [name,        setName]        = useState(initial?.name        ?? '');
  const [code,        setCode]        = useState(initial?.code        ?? '');
  const [address,     setAddress]     = useState(initial?.address     ?? '');
  const [phone,       setPhone]       = useState(initial?.phone       ?? '');
  const [isHeadOffice,setIsHeadOffice]= useState(initial?.isHeadOffice ?? false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Branch name is required.'); return; }
    if (!code.trim()) { setError('Branch code is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        business: businessId,
        name: name.trim(),
        code: code.trim().toUpperCase(),
        address: address.trim(),
        phone: phone.trim(),
        is_head_office: isHeadOffice,
        is_active: true,
      });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save branch. Please try again.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
              <Building2 className="h-5 w-5 text-teal-600" />
            </div>
            <h2 className="text-base font-bold text-slate-800">
              {initial ? 'Edit Branch' : 'Add New Branch'}
            </h2>
          </div>
          <button
            type="button" onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs font-medium text-red-700">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {/* Name */}
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Branch Name *</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main Branch"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
              />
            </div>
            {/* Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Branch Code *</label>
              <input
                type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. MAIN"
                maxLength={10}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors font-mono uppercase"
              />
            </div>
            {/* Phone */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone</label>
              <input
                type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0302000001"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
              />
            </div>
            {/* Address */}
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Address</label>
              <input
                type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Accra Central, Greater Accra"
                className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
              />
            </div>
          </div>

          {/* Head office toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none p-3 rounded-xl bg-slate-50 border border-slate-100 hover:bg-teal-50 hover:border-teal-200 transition-colors">
            <input
              type="checkbox" checked={isHeadOffice}
              onChange={(e) => setIsHeadOffice(e.target.checked)}
              className="h-4 w-4 rounded accent-teal-600"
            />
            <div>
              <p className="text-sm font-semibold text-slate-700">Mark as Head Office</p>
              <p className="text-xs text-slate-500">This branch will be the primary/headquarters location.</p>
            </div>
            {isHeadOffice && <Star className="ml-auto h-4 w-4 text-amber-500 shrink-0" />}
          </label>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 transition-colors">
              {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : (initial ? 'Save Changes' : 'Add Branch')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete confirm modal ────────────────────────────────────────────────────
function DeleteConfirm({ branch, onConfirm, onClose }: {
  branch: Branch; onConfirm: () => Promise<void>; onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 mx-auto mb-4">
          <Trash2 className="h-6 w-6 text-red-600" />
        </div>
        <h3 className="text-base font-bold text-slate-800 text-center">Delete Branch?</h3>
        <p className="mt-2 text-sm text-slate-500 text-center leading-relaxed">
          Are you sure you want to delete <strong className="text-slate-700">{branch.name}</strong>?
          This action cannot be undone.
        </p>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose}
            className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button type="button" disabled={deleting}
            onClick={async () => { setDeleting(true); await onConfirm(); }}
            className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 transition-colors">
            {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Branch card ─────────────────────────────────────────────────────────────
interface BranchCardProps {
  branch: Branch;
  canManage: boolean;
  onEdit: (b: Branch) => void;
  onToggle: (b: Branch) => void;
  onDelete: (b: Branch) => void;
}

function BranchCard({ branch, canManage, onEdit, onToggle, onDelete }: BranchCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={clsx(
      'relative rounded-2xl border bg-white p-5 shadow-sm hover:shadow-md transition-all',
      branch.isActive ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70',
    )}>
      {/* Head-office badge */}
      {branch.isHeadOffice && (
        <span className="absolute top-4 right-4 flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          <Star className="h-2.5 w-2.5" /> HQ
        </span>
      )}

      {/* Icon + name */}
      <div className="flex items-start gap-3">
        <div className={clsx(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
          branch.isActive ? 'bg-teal-50' : 'bg-slate-100',
        )}>
          <Building2 className={clsx('h-6 w-6', branch.isActive ? 'text-teal-600' : 'text-slate-400')} />
        </div>

        <div className="min-w-0 flex-1 pr-6">
          <h3 className="text-sm font-bold text-slate-800 truncate">{branch.name}</h3>
          <span className="inline-block mt-0.5 font-mono text-[11px] font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
            {branch.code}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="mt-4 space-y-2">
        {branch.address && (
          <div className="flex items-start gap-2 text-xs text-slate-500">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" />
            <span className="leading-snug">{branch.address}</span>
          </div>
        )}
        {branch.phone && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>{branch.phone}</span>
          </div>
        )}
      </div>

      {/* Footer — status + actions */}
      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
        {/* Status pill */}
        <span className={clsx(
          'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
          branch.isActive
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-slate-100 text-slate-500 border border-slate-200',
        )}>
          {branch.isActive
            ? <><CheckCircle className="h-3 w-3" /> Active</>
            : <><XCircle className="h-3 w-3" /> Inactive</>}
        </span>

        <div className="flex items-center gap-1 text-xs text-slate-400">
          <span>Since {formatDate(branch.createdAt)}</span>

          {canManage && (
            <div className="relative ml-2">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <MoreVertical className="h-4 w-4" />
              </button>

              {menuOpen && (
                <>
                  {/* invisible backdrop */}
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 bottom-full mb-1 w-40 rounded-xl bg-white shadow-lg border border-slate-200 overflow-hidden z-20">
                    <button type="button"
                      onClick={() => { setMenuOpen(false); onEdit(branch); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                      <Pencil className="h-3.5 w-3.5 text-slate-400" /> Edit
                    </button>
                    <button type="button"
                      onClick={() => { setMenuOpen(false); onToggle(branch); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                      {branch.isActive
                        ? <><ToggleLeft className="h-3.5 w-3.5 text-slate-400" /> Deactivate</>
                        : <><ToggleRight className="h-3.5 w-3.5 text-teal-500" /> Activate</>}
                    </button>
                    <div className="h-px bg-slate-100 mx-2" />
                    <button type="button"
                      onClick={() => { setMenuOpen(false); onDelete(branch); }}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function BranchesPage() {
  const { branches, loading, fetchBranches, addBranch, editBranch, toggleActive, removeBranch } =
    useBranchStore();
  const user = useAuthStore((s) => s.user);

  // In backend mode the business UUID comes from the authenticated user object.
  // loginWithLocalCredentials sets user.id but not user.business, so fall back
  // to the local demo placeholder so branch creation still works offline.
  const businessId = (user as unknown as { business?: string })?.business ?? 'biz-1';

  const canManage   = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [search,        setSearch]        = useState('');
  const [filterStatus,  setFilterStatus]  = useState<'all' | 'active' | 'inactive'>('all');
  const [showForm,      setShowForm]      = useState(false);
  const [editTarget,    setEditTarget]    = useState<Branch | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<Branch | null>(null);

  // Fetch on mount
  useEffect(() => { void fetchBranches(); }, [fetchBranches]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return branches.filter((b) => {
      const matchSearch = !q ||
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        (b.address ?? '').toLowerCase().includes(q) ||
        (b.phone ?? '').includes(q);
      const matchStatus =
        filterStatus === 'all' ? true :
        filterStatus === 'active' ? b.isActive : !b.isActive;
      return matchSearch && matchStatus;
    });
  }, [branches, search, filterStatus]);

  const stats = useMemo(() => ({
    total:    branches.length,
    active:   branches.filter((b) => b.isActive).length,
    inactive: branches.filter((b) => !b.isActive).length,
    hq:       branches.filter((b) => b.isHeadOffice).length,
  }), [branches]);

  async function handleSave(payload: BranchPayload) {
    if (editTarget) {
      await editBranch(editTarget.id, payload);
    } else {
      await addBranch(payload);
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2.5">
            <Building2 className="h-7 w-7 text-teal-600" />
            Branch Management
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage all business locations from one place.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-all shadow-sm"
          >
            <Plus className="h-4 w-4" /> Add Branch
          </button>
        )}
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Branches', value: stats.total,    color: 'bg-slate-50 border-slate-200',    text: 'text-slate-700' },
          { label: 'Active',         value: stats.active,   color: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
          { label: 'Inactive',       value: stats.inactive, color: 'bg-slate-100 border-slate-200',    text: 'text-slate-500'  },
          { label: 'Head Offices',   value: stats.hq,       color: 'bg-amber-50 border-amber-200',     text: 'text-amber-700' },
        ].map(({ label, value, color, text }) => (
          <div key={label} className={clsx('rounded-2xl border px-5 py-4', color)}>
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className={clsx('mt-1 text-2xl font-bold', text)}>{value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search branches by name, code, address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex rounded-xl border border-slate-200 overflow-hidden shrink-0">
          {(['all', 'active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={clsx(
                'px-4 py-2 text-xs font-semibold capitalize transition-colors',
                filterStatus === s
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
        </div>
      ) : filtered.length === 0 ? (
        branches.length === 0
          ? <EmptyState onAdd={() => { setEditTarget(null); setShowForm(true); }} />
          : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Search className="h-8 w-8 text-slate-300 mb-3" />
              <p className="text-sm font-semibold text-slate-500">No branches match your search.</p>
              <button type="button" onClick={() => { setSearch(''); setFilterStatus('all'); }}
                className="mt-3 text-sm text-teal-600 font-medium hover:underline">
                Clear filters
              </button>
            </div>
          )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((b) => (
            <BranchCard
              key={b.id}
              branch={b}
              canManage={canManage}
              onEdit={(br) => { setEditTarget(br); setShowForm(true); }}
              onToggle={(br) => void toggleActive(br.id)}
              onDelete={(br) => setDeleteTarget(br)}
            />
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {showForm && (
        <BranchFormModal
          initial={editTarget}
          businessId={businessId}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          branch={deleteTarget}
          onConfirm={async () => {
            await removeBranch(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export default BranchesPage;
