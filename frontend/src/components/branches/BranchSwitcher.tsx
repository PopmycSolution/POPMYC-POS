/**
 * BranchSwitcher
 *
 * Shown in the top header for SUPER_ADMIN and ADMIN roles.
 * - Super Admin sees "All Branches" + every branch in a dropdown
 * - Admin sees their own branch's name (non-interactive)
 * - Other roles: renders nothing
 *
 * When a Super Admin switches branch, the activeBranchId in branchStore updates.
 * Other parts of the app (reports, sales, etc.) should read activeBranchId to
 * scope their API calls accordingly.
 */
import { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, Globe } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/stores/auth.store';
import { useBranchStore } from '@/stores/branch.store';

export function BranchSwitcher() {
  const user            = useAuthStore((s) => s.user);
  const { branches, activeBranchId, setActiveBranch } = useBranchStore();

  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);

  const role = user?.role ?? 'CASHIER';

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Non-admin roles: render nothing ────────────────────────────────────────
  if (role !== 'SUPER_ADMIN' && role !== 'ADMIN') return null;

  // ── Admin: show their branch name only (read-only) ─────────────────────────
  if (role === 'ADMIN') {
    const userBranchId = user?.branch;
    const branch = userBranchId
      ? branches.find((b) => b.id === userBranchId)
      : null;

    return (
      <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 h-9 text-sm font-semibold text-slate-600">
        <Building2 className="h-3.5 w-3.5 text-teal-600 shrink-0" />
        <span className="truncate max-w-[140px]">{branch?.name ?? 'My Branch'}</span>
      </div>
    );
  }

  // ── Super Admin: full branch switcher ──────────────────────────────────────
  const activeBranch = activeBranchId
    ? branches.find((b) => b.id === activeBranchId) ?? null
    : null;

  const activeName = activeBranch?.name ?? 'All Branches';

  return (
    <div ref={ref} className="hidden sm:block relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex items-center gap-2 rounded-xl border h-9 px-3 text-sm font-semibold transition-all',
          open
            ? 'border-teal-500 bg-teal-50 text-teal-700'
            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-400 hover:text-teal-700',
        )}
      >
        {activeBranchId
          ? <Building2 className="h-3.5 w-3.5 text-teal-600 shrink-0" />
          : <Globe className="h-3.5 w-3.5 text-teal-600 shrink-0" />}
        <span className="truncate max-w-[140px]">{activeName}</span>
        <ChevronDown className={clsx('h-3.5 w-3.5 text-slate-400 transition-transform duration-200 shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-60 rounded-xl bg-white shadow-lg border border-slate-200 overflow-hidden z-50">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
            View Branch
          </p>

          {/* All Branches option */}
          <button
            type="button"
            onClick={() => { setActiveBranch(null); setOpen(false); }}
            className={clsx(
              'flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors',
              !activeBranchId
                ? 'bg-teal-50 text-teal-700 font-semibold'
                : 'text-slate-700 hover:bg-slate-50',
            )}
          >
            <Globe className="h-4 w-4 text-teal-500 shrink-0" />
            <span className="flex-1 text-left">All Branches</span>
            {!activeBranchId && <Check className="h-3.5 w-3.5 text-teal-600 shrink-0" />}
          </button>

          {/* Divider */}
          <div className="h-px bg-slate-100 mx-2" />

          {/* Individual branches */}
          <div className="max-h-56 overflow-y-auto">
            {branches.filter((b) => b.isActive).map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => { setActiveBranch(branch.id); setOpen(false); }}
                className={clsx(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors',
                  activeBranchId === branch.id
                    ? 'bg-teal-50 text-teal-700 font-semibold'
                    : 'text-slate-700 hover:bg-slate-50',
                )}
              >
                <Building2 className={clsx(
                  'h-4 w-4 shrink-0',
                  activeBranchId === branch.id ? 'text-teal-600' : 'text-slate-400',
                )} />
                <span className="flex-1 text-left truncate">{branch.name}</span>
                {branch.isHeadOffice && (
                  <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 shrink-0">
                    HQ
                  </span>
                )}
                {activeBranchId === branch.id && (
                  <Check className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                )}
              </button>
            ))}
            {branches.filter((b) => b.isActive).length === 0 && (
              <p className="px-3 py-4 text-xs text-slate-400 text-center">No active branches</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default BranchSwitcher;
