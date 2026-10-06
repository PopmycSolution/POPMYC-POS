import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  ClipboardList, Search, Filter, User,
  ShoppingCart, Package, Settings,
  FileText, Trash2, Plus, Pencil, LogIn,
  LogOut, RefreshCw, ChevronLeft, ChevronRight,
  CalendarDays, X, Loader2, AlertTriangle,
  Shield, Key, Download, Upload, CheckCircle,
  XCircle, Sliders,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatDate } from '@/utils/format';
import * as auditService from '@/services/audit.service';
import type { AuditLogEntry } from '@/services/audit.service';
import { useAuthStore } from '@/stores/auth.store';

// ── Action → display meta ─────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string; icon: typeof LogIn }> = {
  CREATE:          { label: 'Created',      color: 'bg-emerald-50 text-emerald-700',  icon: Plus        },
  UPDATE:          { label: 'Updated',      color: 'bg-amber-50 text-amber-700',      icon: Pencil      },
  DELETE:          { label: 'Deleted',      color: 'bg-rose-50 text-rose-700',        icon: Trash2      },
  LOGIN:           { label: 'Login',        color: 'bg-blue-50 text-blue-700',        icon: LogIn       },
  LOGOUT:          { label: 'Logout',       color: 'bg-slate-100 text-slate-600',     icon: LogOut      },
  VOID:            { label: 'Voided',       color: 'bg-rose-50 text-rose-700',        icon: XCircle     },
  REFUND:          { label: 'Refund',       color: 'bg-purple-50 text-purple-700',    icon: RefreshCw   },
  DISCOUNT:        { label: 'Discount',     color: 'bg-amber-50 text-amber-700',      icon: Sliders     },
  OVERRIDE:        { label: 'Override',     color: 'bg-orange-50 text-orange-700',    icon: Shield      },
  ADJUSTMENT:      { label: 'Adjustment',   color: 'bg-amber-50 text-amber-700',      icon: RefreshCw   },
  PASSWORD_CHANGE: { label: 'Password',     color: 'bg-indigo-50 text-indigo-700',    icon: Key         },
  EXPORT:          { label: 'Export',       color: 'bg-sky-50 text-sky-700',          icon: Download    },
  IMPORT:          { label: 'Import',       color: 'bg-sky-50 text-sky-700',          icon: Upload      },
  BACKUP:          { label: 'Backup',       color: 'bg-indigo-50 text-indigo-700',    icon: FileText    },
  RESTORE:         { label: 'Restore',      color: 'bg-purple-50 text-purple-700',    icon: RefreshCw   },
  APPROVE:         { label: 'Approved',     color: 'bg-emerald-50 text-emerald-700',  icon: CheckCircle },
  REJECT:          { label: 'Rejected',     color: 'bg-rose-50 text-rose-700',        icon: XCircle     },
  CANCEL:          { label: 'Cancelled',    color: 'bg-rose-50 text-rose-700',        icon: X           },
  CLOSE:           { label: 'Closed',       color: 'bg-slate-100 text-slate-600',     icon: X           },
  OPEN:            { label: 'Opened',       color: 'bg-emerald-50 text-emerald-700',  icon: Plus        },
};

// Module display labels
const MODULE_LABELS: Record<string, string> = {
  Sale: 'Sale', Product: 'Product', Customer: 'Customer',
  Supplier: 'Supplier', Purchase: 'Purchase', Inventory: 'Inventory',
  User: 'User', Settings: 'Settings', Backup: 'Backup',
  Auth: 'Auth', License: 'License', Branch: 'Branch',
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, color: 'bg-muted-100 text-muted-600', icon: ClipboardList };
}

function getModuleIcon(module: string) {
  const m = module?.toLowerCase() ?? '';
  if (m.includes('sale'))     return ShoppingCart;
  if (m.includes('product') || m.includes('inventory')) return Package;
  if (m.includes('user') || m.includes('auth')) return User;
  if (m.includes('setting') || m.includes('business')) return Settings;
  return FileText;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isLocalSession(): boolean {
  try {
    const raw = localStorage.getItem('access_token') ?? '';
    if (raw.startsWith('local-session-')) return true;
    const stored = localStorage.getItem('popmyc-auth-storage');
    if (stored) {
      const p = JSON.parse(stored) as { state?: { accessToken?: string } };
      if ((p?.state?.accessToken ?? '').startsWith('local-session-')) return true;
    }
  } catch { /* noop */ }
  return false;
}

const PAGE_SIZE = 25;

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogsPage() {
  const [entries,      setEntries]      = useState<AuditLogEntry[]>([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [startDate,    setStartDate]    = useState('');
  const [endDate,      setEndDate]      = useState('');
  const [expanded,     setExpanded]     = useState<string | null>(null);
  const [searchInput,  setSearchInput]  = useState('');

  const accessToken = useAuthStore((s) => s.accessToken);
  const isLocal     = isLocalSession();

  // ── Fetch from backend ──────────────────────────────────────────────────────
  const loadLogs = useCallback(async (pg: number = 1) => {
    if (isLocal) return;
    setLoading(true);
    setError('');
    try {
      const result = await auditService.fetchAuditLogs({
        limit:      PAGE_SIZE,
        offset:     (pg - 1) * PAGE_SIZE,
        search:     search || undefined,
        action:     actionFilter !== 'all' ? actionFilter : undefined,
        module:     moduleFilter !== 'all' ? moduleFilter : undefined,
        start_date: startDate   || undefined,
        end_date:   endDate     || undefined,
      });
      setEntries(result.entries);
      setTotalCount(result.count);
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setError(ae.response?.data?.detail ?? 'Could not load audit logs. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [isLocal, search, actionFilter, moduleFilter, startDate, endDate]);

  // Initial load + whenever filters change
  useEffect(() => {
    setPage(1);
    void loadLogs(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, actionFilter, moduleFilter, startDate, endDate, search]);

  // Page changes (without resetting to page 1)
  useEffect(() => {
    void loadLogs(page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  function handleSearch() {
    setSearch(searchInput);
    setPage(1);
  }

  function clearFilters() {
    setSearchInput(''); setSearch('');
    setActionFilter('all'); setModuleFilter('all');
    setStartDate(''); setEndDate('');
    setPage(1);
  }

  // Stats derived from current page (backend gives totals)
  const stats = useMemo(() => ({
    total:   totalCount,
    creates: entries.filter((e) => e.action === 'CREATE').length,
    logins:  entries.filter((e) => e.action === 'LOGIN').length,
    deletes: entries.filter((e) => e.action === 'DELETE').length,
  }), [entries, totalCount]);

  // ── Local/demo mode notice ─────────────────────────────────────────────────
  if (isLocal) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Audit Logs</h1>
          <p className="text-sm text-muted-500 mt-0.5">Complete history of all system actions and user activity</p>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200">
            <Shield className="h-8 w-8 text-amber-500" />
          </div>
          <div>
            <p className="text-base font-bold text-slate-800">Audit Logs require a live backend connection</p>
            <p className="text-sm text-slate-500 mt-1 max-w-sm">Log in with your real POPMYC credentials (not demo mode) to view the full audit trail for your business.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Audit Logs</h1>
          <p className="text-sm text-muted-500 mt-0.5">Complete history of all system actions and user activity</p>
        </div>
        <button
          onClick={() => void loadLogs(page)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-muted-200 px-4 py-2 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Events',  value: totalCount,     color: 'bg-blue-50 text-blue-600 ring-blue-100'       },
          { label: 'This Page',     value: entries.length, color: 'bg-slate-50 text-slate-600 ring-slate-100'    },
          { label: 'Logins',        value: stats.logins,   color: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
          { label: 'Deletions',     value: stats.deletes,  color: 'bg-rose-50 text-rose-600 ring-rose-100'       },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
            <p className="text-xs font-medium text-muted-500">{s.label}</p>
            <p className="text-2xl font-bold text-[#1E293B] mt-1">{loading ? '…' : s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search user, description, IP…"
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
          />
        </div>
        <button onClick={handleSearch} className="h-10 px-4 rounded-xl bg-[#1E293B] text-white text-sm font-semibold hover:bg-[#334155] transition-colors shrink-0">
          Search
        </button>

        {/* Action filter */}
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none min-w-[150px]">
          <option value="all">All Actions</option>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Module filter */}
        <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none min-w-[150px]">
          <option value="all">All Modules</option>
          {Object.entries(MODULE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        {/* Date range */}
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none" />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none" />

        {/* Clear */}
        {(search || actionFilter !== 'all' || moduleFilter !== 'all' || startDate || endDate) && (
          <button onClick={clearFilters}
            className="h-10 px-3 rounded-xl border border-muted-200 text-sm text-muted-600 hover:bg-muted-50 transition-colors inline-flex items-center gap-1.5">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}

        <div className="sm:ml-auto flex items-center gap-1.5 text-xs text-muted-400 self-center">
          <Filter className="h-3.5 w-3.5" />
          {loading ? 'Loading…' : `${totalCount.toLocaleString()} total`}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
          <p className="text-sm text-rose-700 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-400">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Loading audit logs…</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted-100 bg-muted-50/50">
                  <th className="text-left font-semibold text-muted-600 px-4 py-3">Timestamp</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">User</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3">Action</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Module</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3">Description</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden xl:table-cell">IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((log) => {
                  const meta    = getActionMeta(log.action);
                  const ModIcon = getModuleIcon(log.module);
                  const ActionIcon = meta.icon;
                  const isExpanded = expanded === log.id;
                  return (
                    <>
                      <tr
                        key={log.id}
                        onClick={() => setExpanded(isExpanded ? null : log.id)}
                        className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-xs text-muted-500">
                            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                            {formatDate(log.timestamp, 'DD MMM, HH:mm')}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-100 shrink-0">
                              <User className="h-3.5 w-3.5 text-muted-500" />
                            </div>
                            <p className="text-sm font-medium text-[#1E293B] truncate max-w-[130px]">{log.userName}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', meta.color)}>
                            <ActionIcon className="h-3 w-3" />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-600 bg-muted-100 rounded-full px-2 py-0.5">
                            <ModIcon className="h-3 w-3" />
                            {log.module}
                          </span>
                        </td>
                        <td className="px-4 py-3 max-w-[260px]">
                          <p className="text-sm text-[#1E293B] truncate">{log.description}</p>
                          {log.entityId && (
                            <p className="text-[11px] text-muted-400 font-mono truncate">{log.entityId}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <span className="text-xs font-mono text-muted-400">{log.ipAddress}</span>
                        </td>
                      </tr>
                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${log.id}-detail`} className="border-b border-muted-100 bg-muted-50/30">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                              <div>
                                <p className="font-semibold text-muted-500 mb-1 uppercase tracking-wider">Details</p>
                                <p><span className="text-muted-400">User:</span> <span className="font-medium text-[#1E293B]">{log.userName}</span></p>
                                <p><span className="text-muted-400">Action:</span> <span className="font-medium text-[#1E293B]">{log.action}</span></p>
                                <p><span className="text-muted-400">Module:</span> <span className="font-medium text-[#1E293B]">{log.module}</span></p>
                                <p><span className="text-muted-400">Entity:</span> <span className="font-medium text-[#1E293B] font-mono">{log.entityType} {log.entityId ? `(${log.entityId})` : ''}</span></p>
                                <p><span className="text-muted-400">IP:</span> <span className="font-medium text-[#1E293B] font-mono">{log.ipAddress}</span></p>
                                <p><span className="text-muted-400">Time:</span> <span className="font-medium text-[#1E293B]">{new Date(log.timestamp).toLocaleString('en-GB')}</span></p>
                              </div>
                              {(log.oldValues || log.newValues) && (
                                <div>
                                  <p className="font-semibold text-muted-500 mb-1 uppercase tracking-wider">Changes</p>
                                  {log.oldValues && Object.keys(log.oldValues).length > 0 && (
                                    <div className="mb-2">
                                      <p className="text-[10px] font-bold text-rose-500 mb-0.5">Before</p>
                                      <pre className="text-[10px] text-muted-600 bg-white rounded-lg p-2 border border-muted-100 overflow-auto max-h-32">
                                        {JSON.stringify(log.oldValues, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.newValues && Object.keys(log.newValues).length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-emerald-500 mb-0.5">After</p>
                                      <pre className="text-[10px] text-muted-600 bg-white rounded-lg p-2 border border-muted-100 overflow-auto max-h-32">
                                        {JSON.stringify(log.newValues, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center text-muted-400">
                      <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                      <p className="text-sm font-medium">No audit logs found</p>
                      <p className="text-xs text-muted-400 mt-1">
                        {(search || actionFilter !== 'all' || startDate)
                          ? 'Try adjusting your filters'
                          : 'Audit events will appear here as users interact with the system'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalCount > 0 && (
          <div className="px-4 py-3 border-t border-muted-100 bg-muted-50/50 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-muted-500">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-muted-200 text-muted-500 hover:bg-muted-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-600 font-medium px-2">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-muted-200 text-muted-500 hover:bg-muted-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
