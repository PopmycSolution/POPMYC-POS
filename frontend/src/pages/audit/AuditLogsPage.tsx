import { useState, useMemo } from 'react';
import {
  ClipboardList, Search, Filter, User,
  ShoppingCart, Package, Settings,
  FileText, Trash2, Plus, Pencil, LogIn,
  LogOut, RefreshCw, ChevronLeft, ChevronRight,
  CalendarDays, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatDate } from '@/utils/format';

// ── Audit log types ───────────────────────────────────────────────────────────
export type AuditAction =
  | 'LOGIN' | 'LOGOUT'
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'SALE_COMPLETED' | 'SALE_VOIDED' | 'SALE_REFUNDED'
  | 'STOCK_IN' | 'STOCK_OUT' | 'STOCK_ADJUSTED'
  | 'SETTINGS_CHANGED' | 'BACKUP_CREATED' | 'RESTORE_DONE'
  | 'USER_ACTIVATED' | 'USER_DEACTIVATED';

export type AuditResource =
  | 'Auth' | 'User' | 'Product' | 'Category' | 'Brand' | 'Inventory'
  | 'Sale' | 'Purchase' | 'Customer' | 'Supplier' | 'Expense'
  | 'Settings' | 'Backup';

interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  role: string;
  action: AuditAction;
  resource: AuditResource;
  resourceId?: string;
  description: string;
  ipAddress: string;
  status: 'SUCCESS' | 'FAILED' | 'WARNING';
}

// ── Seed data ─────────────────────────────────────────────────────────────────
function ago(h: number, m = 0): string {
  const d = new Date();
  d.setHours(d.getHours() - h, d.getMinutes() - m);
  return d.toISOString();
}

const SEED_LOGS: AuditEntry[] = [
  { id: 'al1',  timestamp: ago(0,5),   user: 'Owusu Michael',    role: 'SUPER_ADMIN',     action: 'LOGIN',           resource: 'Auth',      description: 'Admin logged in',                    ipAddress: '192.168.1.1',  status: 'SUCCESS' },
  { id: 'al2',  timestamp: ago(0,20),  user: 'Owusu Michael',    role: 'SUPER_ADMIN',     action: 'SETTINGS_CHANGED',resource: 'Settings',  description: 'Business name updated',              ipAddress: '192.168.1.1',  status: 'SUCCESS' },
  { id: 'al3',  timestamp: ago(1),     user: 'Grace Appiah',     role: 'ADMIN',           action: 'CREATE',          resource: 'Product',   resourceId: 'p-123', description: 'Added "Milo Tin 400g"', ipAddress: '192.168.1.5',  status: 'SUCCESS' },
  { id: 'al4',  timestamp: ago(1,30),  user: 'Kwame Asante',     role: 'CASHIER',         action: 'SALE_COMPLETED',  resource: 'Sale',      resourceId: 'SL-001', description: 'Sale GH₵92.00 – 3 items', ipAddress: '192.168.1.10', status: 'SUCCESS' },
  { id: 'al5',  timestamp: ago(2),     user: 'Abena Frimpong',   role: 'CASHIER',         action: 'SALE_COMPLETED',  resource: 'Sale',      resourceId: 'SL-002', description: 'Sale GH₵45.00 – 2 items', ipAddress: '192.168.1.11', status: 'SUCCESS' },
  { id: 'al6',  timestamp: ago(2,30),  user: 'Kofi Mensah',      role: 'INVENTORY_CLERK', action: 'STOCK_IN',        resource: 'Inventory', description: 'Received 50×Rice Bag 5kg from PO-001', ipAddress: '192.168.1.8',  status: 'SUCCESS' },
  { id: 'al7',  timestamp: ago(3),     user: 'Kwame Asante',     role: 'CASHIER',         action: 'SALE_VOIDED',     resource: 'Sale',      resourceId: 'SL-003', description: 'Voided sale – customer returned', ipAddress: '192.168.1.10', status: 'WARNING' },
  { id: 'al8',  timestamp: ago(4),     user: 'Grace Appiah',     role: 'ADMIN',           action: 'DELETE',          resource: 'Customer',  resourceId: 'cust-7', description: 'Deleted customer "Efua Mensah"',  ipAddress: '192.168.1.5',  status: 'SUCCESS' },
  { id: 'al9',  timestamp: ago(5),     user: 'Kofi Mensah',      role: 'INVENTORY_CLERK', action: 'STOCK_ADJUSTED',  resource: 'Inventory', description: 'Adjusted stock: Dettol Soap -6 units',ipAddress: '192.168.1.8',  status: 'SUCCESS' },
  { id: 'al10', timestamp: ago(6),     user: 'Ama Darko',        role: 'MANAGER',         action: 'UPDATE',          resource: 'Product',   resourceId: 'p-5', description: 'Updated price: Fanta 500ml → GH₵12', ipAddress: '192.168.1.6',  status: 'SUCCESS' },
  { id: 'al11', timestamp: ago(8),     user: 'Yaw Boateng',      role: 'CASHIER',         action: 'LOGIN',           resource: 'Auth',      description: 'Cashier logged in',                  ipAddress: '192.168.1.12', status: 'SUCCESS' },
  { id: 'al12', timestamp: ago(10),    user: 'Grace Appiah',     role: 'ADMIN',           action: 'CREATE',          resource: 'User',      description: 'Added new user "Efua Cashier"',       ipAddress: '192.168.1.5',  status: 'SUCCESS' },
  { id: 'al13', timestamp: ago(12),    user: 'Owusu Michael',    role: 'SUPER_ADMIN',     action: 'BACKUP_CREATED',  resource: 'Backup',    description: 'Full data backup created',            ipAddress: '192.168.1.1',  status: 'SUCCESS' },
  { id: 'al14', timestamp: ago(14),    user: 'Kofi Mensah',      role: 'INVENTORY_CLERK', action: 'STOCK_OUT',       resource: 'Inventory', description: 'Stock-out: 20×Pure Water',            ipAddress: '192.168.1.8',  status: 'SUCCESS' },
  { id: 'al15', timestamp: ago(16),    user: 'Unknown',          role: '—',               action: 'LOGIN',           resource: 'Auth',      description: 'Failed login attempt for "admin"',   ipAddress: '10.0.0.44',    status: 'FAILED'  },
  { id: 'al16', timestamp: ago(20),    user: 'Abena Frimpong',   role: 'CASHIER',         action: 'SALE_COMPLETED',  resource: 'Sale',      resourceId: 'SL-004', description: 'Sale GH₵136.00 – 6 items', ipAddress: '192.168.1.11', status: 'SUCCESS' },
  { id: 'al17', timestamp: ago(24),    user: 'Ama Darko',        role: 'MANAGER',         action: 'CREATE',          resource: 'Supplier',  description: 'Added supplier "West Coast Traders"', ipAddress: '192.168.1.6',  status: 'SUCCESS' },
  { id: 'al18', timestamp: ago(30),    user: 'Grace Appiah',     role: 'ADMIN',           action: 'UPDATE',          resource: 'User',      description: 'Deactivated user "Yaw Boateng"',     ipAddress: '192.168.1.5',  status: 'SUCCESS' },
  { id: 'al19', timestamp: ago(36),    user: 'Owusu Michael',    role: 'SUPER_ADMIN',     action: 'SETTINGS_CHANGED',resource: 'Settings',  description: 'VAT rate changed to 15%',            ipAddress: '192.168.1.1',  status: 'SUCCESS' },
  { id: 'al20', timestamp: ago(48),    user: 'Kofi Mensah',      role: 'INVENTORY_CLERK', action: 'STOCK_IN',        resource: 'Inventory', description: 'Received 200×Coca-Cola 500ml',        ipAddress: '192.168.1.8',  status: 'SUCCESS' },
];

const ACTION_META: Record<AuditAction, { label: string; color: string; icon: typeof LogIn }> = {
  LOGIN:            { label: 'Login',             color: 'bg-blue-50 text-blue-700',     icon: LogIn     },
  LOGOUT:           { label: 'Logout',            color: 'bg-muted-100 text-muted-600',  icon: LogOut    },
  CREATE:           { label: 'Created',           color: 'bg-emerald-50 text-emerald-700',icon: Plus     },
  UPDATE:           { label: 'Updated',           color: 'bg-amber-50 text-amber-700',   icon: Pencil    },
  DELETE:           { label: 'Deleted',           color: 'bg-rose-50 text-rose-700',     icon: Trash2    },
  SALE_COMPLETED:   { label: 'Sale',              color: 'bg-emerald-50 text-emerald-700',icon: ShoppingCart },
  SALE_VOIDED:      { label: 'Voided',            color: 'bg-rose-50 text-rose-700',     icon: X         },
  SALE_REFUNDED:    { label: 'Refunded',          color: 'bg-purple-50 text-purple-700', icon: RefreshCw },
  STOCK_IN:         { label: 'Stock In',          color: 'bg-sky-50 text-sky-700',       icon: Package   },
  STOCK_OUT:        { label: 'Stock Out',         color: 'bg-orange-50 text-orange-700', icon: Package   },
  STOCK_ADJUSTED:   { label: 'Adjustment',        color: 'bg-amber-50 text-amber-700',   icon: RefreshCw },
  SETTINGS_CHANGED: { label: 'Settings',          color: 'bg-slate-100 text-slate-700',  icon: Settings  },
  BACKUP_CREATED:   { label: 'Backup',            color: 'bg-indigo-50 text-indigo-700', icon: FileText  },
  RESTORE_DONE:     { label: 'Restore',           color: 'bg-purple-50 text-purple-700', icon: RefreshCw },
  USER_ACTIVATED:   { label: 'Activated',         color: 'bg-emerald-50 text-emerald-700',icon: User    },
  USER_DEACTIVATED: { label: 'Deactivated',       color: 'bg-rose-50 text-rose-700',     icon: User      },
};

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  FAILED:  'bg-rose-50 text-rose-700 border border-rose-200',
  WARNING: 'bg-amber-50 text-amber-700 border border-amber-200',
};

const PAGE_SIZE = 10;

export default function AuditLogsPage() {
  const [search,     setSearch]     = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page,       setPage]       = useState(1);
  const [expanded,   setExpanded]   = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return SEED_LOGS.filter((log) => {
      const matchSearch = q === '' ||
        log.user.toLowerCase().includes(q) ||
        log.description.toLowerCase().includes(q) ||
        log.resource.toLowerCase().includes(q) ||
        (log.resourceId ?? '').toLowerCase().includes(q);
      const matchAction = actionFilter === 'all' || log.action === actionFilter;
      const matchStatus = statusFilter === 'all' || log.status === statusFilter;
      return matchSearch && matchAction && matchStatus;
    });
  }, [search, actionFilter, statusFilter]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const stats = useMemo(() => ({
    total:   SEED_LOGS.length,
    success: SEED_LOGS.filter((l) => l.status === 'SUCCESS').length,
    failed:  SEED_LOGS.filter((l) => l.status === 'FAILED').length,
    warning: SEED_LOGS.filter((l) => l.status === 'WARNING').length,
  }), []);

  function handleSearchChange(v: string) { setSearch(v); setPage(1); }
  function handleActionChange(v: string) { setActionFilter(v); setPage(1); }
  function handleStatusChange(v: string) { setStatusFilter(v); setPage(1); }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Audit Logs</h1>
        <p className="text-sm text-muted-500 mt-0.5">Complete history of all system actions and user activity</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Events', value: stats.total,   color: 'bg-blue-50 text-blue-600 ring-blue-100'     },
          { label: 'Successful',   value: stats.success, color: 'bg-emerald-50 text-emerald-600 ring-emerald-100' },
          { label: 'Failed',       value: stats.failed,  color: 'bg-rose-50 text-rose-600 ring-rose-100'     },
          { label: 'Warnings',     value: stats.warning, color: 'bg-amber-50 text-amber-600 ring-amber-100'  },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
            <p className="text-xs font-medium text-muted-500">{s.label}</p>
            <p className="text-2xl font-bold text-[#1E293B] mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input value={search} onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search user, action, resource..."
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>

        {/* Action filter */}
        <select value={actionFilter} onChange={(e) => handleActionChange(e.target.value)}
          className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 min-w-[160px]">
          <option value="all">All Actions</option>
          {(Object.keys(ACTION_META) as AuditAction[]).map((a) => (
            <option key={a} value={a}>{ACTION_META[a].label}</option>
          ))}
        </select>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          {(['all', 'SUCCESS', 'FAILED', 'WARNING'] as const).map((s) => (
            <button key={s} onClick={() => handleStatusChange(s)}
              className={clsx('rounded-full px-3 py-2 text-xs font-medium whitespace-nowrap transition-all',
                statusFilter === s ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="sm:ml-auto flex items-center gap-1.5 text-xs text-muted-400 self-center">
          <Filter className="h-3.5 w-3.5" />
          {filtered.length} results
        </div>
      </div>

      {/* Logs table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Timestamp</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">User</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Action</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Resource</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Description</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Status</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden xl:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map((log) => {
                const actionMeta = ACTION_META[log.action];
                const ActionIcon = actionMeta.icon;
                return (
                  <tr key={log.id}
                    onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                    className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-xs text-muted-500">
                        <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                        <span>{formatDate(log.timestamp, 'DD MMM, HH:mm')}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-100 shrink-0">
                          <User className="h-3.5 w-3.5 text-muted-500" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#1E293B] truncate max-w-[120px]">{log.user}</p>
                          <p className="text-[10px] text-muted-400">{log.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', actionMeta.color)}>
                        <ActionIcon className="h-3 w-3" />
                        {actionMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="text-xs font-medium text-muted-600 bg-muted-100 rounded-full px-2 py-0.5">{log.resource}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[250px]">
                      <p className="text-sm text-[#1E293B] truncate">{log.description}</p>
                      {log.resourceId && <p className="text-[11px] text-muted-400 font-mono">{log.resourceId}</p>}
                    </td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                      <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', STATUS_COLOR[log.status])}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <span className="text-xs font-mono text-muted-400">{log.ipAddress}</span>
                    </td>
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-400">
                  <ClipboardList className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No logs match your filters</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-4 py-3 border-t border-muted-100 bg-muted-50/50 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-500">
            Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-muted-200 text-muted-500 hover:bg-muted-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-muted-600 font-medium px-2">Page {page} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-muted-200 text-muted-500 hover:bg-muted-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
