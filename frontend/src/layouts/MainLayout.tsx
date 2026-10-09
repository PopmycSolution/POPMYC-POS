import { useState, useMemo, useRef, useEffect } from 'react';import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard, ShoppingCart, Package, Warehouse, Receipt, Truck,
  Users, Factory, FileText, BarChart3, Settings, UserCog, Menu, X,
  ChevronDown, LogOut, User as UserIcon, Bell, Search, Tag,
  AlertTriangle, ShieldOff, Home, TrendingUp, Clock, Shield,
  ClipboardList, Server, HardDrive, Bookmark, Ruler, Building2,
  Sun, Moon, ChevronRight, Zap, KeyRound, Camera, ArrowLeftRight,
  CalendarClock, XCircle, RefreshCw,
} from 'lucide-react';
import { APP_VERSION } from '@/utils/constants';
import { Avatar } from '@/components/ui/Avatar';
import { BranchSwitcher } from '@/components/branches/BranchSwitcher';
import { HelpBot } from '@/components/help/HelpBot';
import { SyncStatusIndicator } from '@/components/sync/SyncStatusIndicator';
import { useBranchStore } from '@/stores/branch.store';
import { useBranchInventoryStore } from '@/stores/branchInventory.store';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUserStore } from '@/stores/user.store';
import { useProductStore } from '@/stores/product.store';
import { useThemeStore } from '@/stores/theme.store';
import type { Product } from '@/types';
import { getExpiryStatus, daysUntilExpiry } from '@/types';
import { useSalesStore } from '@/stores/sales.store';
import { useCustomerStore } from '@/stores/customer.store';
import * as authService from '@/services/auth.service';
import { canAccess, getRoleConfig, type AppRoute } from '@/utils/permissions';
import { formatCurrency, formatDate } from '@/utils/format';
import ChangePasswordModal from '@/components/auth/ChangePasswordModal';
import ProfilePictureModal from '@/components/auth/ProfilePictureModal';
import { useUpdater } from '@/hooks/useUpdater';
import { playAlertSound, playNotificationSound } from '@/utils/sound';
import api from '@/services/api';

// ── License expiry banner ─────────────────────────────────────────────────────
function LicenseExpiryBanner() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const userRole    = useAuthStore((s) => s.user?.role ?? 'CASHIER');
  const [daysLeft, setDaysLeft]   = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [licStatus, setLicStatus] = useState<string>('');
  const navigate = useNavigate();

  // Only SUPER_ADMIN and ADMIN can renew — everyone else just sees the warning
  const canRenew = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

  useEffect(() => {
    if (!accessToken || accessToken.startsWith('local-session-')) return;
    api.get('/licensing/licenses/status/').then((res) => {
      const d = res.data as { days_remaining?: number | null; status?: string; license_type?: string };
      if (d.license_type === 'LIFETIME') return;
      setLicStatus(d.status ?? '');
      if (typeof d.days_remaining === 'number') setDaysLeft(d.days_remaining);
    }).catch(() => { /* non-blocking */ });
  }, [accessToken]);

  if (dismissed) return null;

  if (licStatus === 'EXPIRED') {
    return (
      <div className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium bg-red-600 text-white">
        <span>⛔ Your POPMYC POS license has expired. {canRenew ? 'Renew to continue using all features.' : 'Contact your administrator to renew.'}</span>
        {canRenew && (
          <button onClick={() => navigate('/settings')} className="ml-auto shrink-0 underline font-semibold">Renew Now</button>
        )}
        <button onClick={() => setDismissed(true)} className="shrink-0 text-white/70 hover:text-white ml-2">✕</button>
      </div>
    );
  }

  if (daysLeft !== null && daysLeft <= 14 && daysLeft >= 0) {
    const urgent = daysLeft <= 3;
    return (
      <div className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium ${urgent ? 'bg-red-500 text-white' : 'bg-amber-400 text-amber-900'}`}>
        <span>⚠ Your license expires in <strong>{daysLeft === 0 ? 'today' : `${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}</strong>. {canRenew ? 'Renew to avoid interruption.' : 'Contact your administrator to renew.'}</span>
        {canRenew && (
          <button onClick={() => navigate('/settings')} className="ml-auto shrink-0 underline font-semibold">Renew</button>
        )}
        <button onClick={() => setDismissed(true)} className="shrink-0 opacity-70 hover:opacity-100 ml-2">✕</button>
      </div>
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation config
// ─────────────────────────────────────────────────────────────────────────────
interface NavItem  { name: string; href: AppRoute; icon: typeof LayoutDashboard; mode?: 'pos' | 'inventory' | 'all' }
interface NavGroup { id: string; label: string; items: NavItem[] }

const ALL_NAV_GROUPS: NavGroup[] = [
  {
    id: 'core', label: 'Core',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'POS',       href: '/pos',       icon: ShoppingCart,  mode: 'pos' },
    ],
  },
  {
    id: 'catalog', label: 'Catalog',
    items: [
      { name: 'Products',           href: '/products',              icon: Package                                   },
      { name: 'Categories',         href: '/categories',            icon: Tag                                       },
      { name: 'Brands',             href: '/brands',                icon: Bookmark                                  },
      { name: 'Units',              href: '/units',                 icon: Ruler                                     },
      { name: 'Inventory',          href: '/inventory',             icon: Warehouse,      mode: 'inventory'         },
      { name: 'Stock Adjustments',  href: '/inventory/adjustments', icon: ClipboardList,  mode: 'inventory'         },
      { name: 'Branch Transfers',   href: '/inventory/transfers',   icon: ArrowLeftRight, mode: 'inventory'         },
    ],
  },
  {
    id: 'commerce', label: 'Commerce',
    items: [
      { name: 'Sales',     href: '/sales',     icon: Receipt,       mode: 'pos'       },
      { name: 'Purchases', href: '/purchases', icon: Truck,         mode: 'inventory' },
      { name: 'Customers', href: '/customers', icon: Users,         mode: 'pos'       },
      { name: 'Suppliers', href: '/suppliers', icon: Factory,       mode: 'inventory' },
      { name: 'Expenses',  href: '/expenses',  icon: FileText                         },
      { name: 'Debts',     href: '/debt',      icon: AlertTriangle, mode: 'pos'       },
    ],
  },
  {
    id: 'analytics', label: 'Analytics',
    items: [{ name: 'Reports', href: '/reports', icon: BarChart3 }],
  },
  {
    id: 'people', label: 'People & Access',
    items: [
      { name: 'Users',               href: '/users',    icon: UserCog   },
      { name: 'Roles & Permissions', href: '/roles',    icon: Shield    },
      { name: 'Branches',            href: '/branches', icon: Building2 },
    ],
  },
  {
    id: 'admin', label: 'Administration',
    items: [
      { name: 'Settings',         href: '/settings', icon: Settings    },
      { name: 'Audit Logs',       href: '/audit',    icon: ClipboardList },
      { name: 'System Settings',  href: '/system',   icon: Server      },
      { name: 'Backup & Restore', href: '/backup',   icon: HardDrive   },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 403 component
// ─────────────────────────────────────────────────────────────────────────────
function AccessDenied({ roleName }: { roleName: string }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 dark:bg-rose-900/30 mb-6">
        <ShieldOff className="h-9 w-9 text-rose-600" />
      </div>
      <h1 className="text-2xl font-bold text-page-primary tracking-tight">Access Denied</h1>
      <p className="mt-3 text-sm text-page-secondary max-w-sm leading-relaxed">
        Your role <span className="font-semibold text-page-primary">{roleName}</span> does not have
        permission to view this page.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="btn-mint mt-8 px-5 py-2.5"
      >
        <Home className="h-4 w-4" /> Back to Dashboard
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Search panel
// ─────────────────────────────────────────────────────────────────────────────
function SearchPanel({ query, onClose }: { query: string; onClose: () => void }) {
  const navigate   = useNavigate();
  const products   = useProductStore((s) => s.products);
  const sales      = useSalesStore((s) => s.sales);
  const customers  = useCustomerStore((s) => s.customers);
  const q = query.trim().toLowerCase();

  const matchedProducts  = useMemo(() =>
    q.length < 2 ? [] : products
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q))
      .slice(0, 5),
  [products, q]);

  const matchedSales = useMemo(() =>
    q.length < 2 ? [] : sales
      .filter((s) => s.invoiceNumber.toLowerCase().includes(q) || s.reference.toLowerCase().includes(q) || s.customerName.toLowerCase().includes(q))
      .slice(0, 4),
  [sales, q]);

  const matchedCustomers = useMemo(() =>
    q.length < 2 ? [] : customers
      .filter((c) => `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.phone.includes(q) || (c.company ?? '').toLowerCase().includes(q))
      .slice(0, 4),
  [customers, q]);

  const hasResults = matchedProducts.length + matchedSales.length + matchedCustomers.length > 0;
  if (q.length < 2) return null;

  function go(path: string) { onClose(); navigate(path); }

  return (
    <div className="absolute left-0 top-full mt-2 w-full sm:w-[480px] rounded-2xl shadow-modal border overflow-hidden z-50 max-h-[70vh] overflow-y-auto animate-scale-in"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}>
      {!hasResults ? (
        <div className="px-4 py-10 text-center">
          <Search className="h-8 w-8 mx-auto mb-2 text-muted-300" />
          <p className="text-sm font-medium text-page-secondary">No results for "{query}"</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
          {matchedProducts.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-page-muted"
                style={{ background: 'var(--bg-page)' }}>Products</p>
              {matchedProducts.map((p) => (
                <button key={p.id} onClick={() => go('/products')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--mint-alpha)]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
                    <Package className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-page-primary truncate">{p.name}</p>
                    <p className="text-[11px] text-page-muted font-mono">{p.sku} · {formatCurrency(p.price)}</p>
                  </div>
                  <span className={clsx('text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0',
                    p.stockQuantity === 0 ? 'bg-rose-500/15 text-rose-500' :
                    p.stockQuantity <= (p.lowStockThreshold ?? 10) ? 'bg-amber-500/15 text-amber-500' :
                    'bg-mint-500/15 text-mint-500')}>
                    {p.stockQuantity} in stock
                  </span>
                </button>
              ))}
            </div>
          )}
          {matchedSales.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-page-muted"
                style={{ background: 'var(--bg-page)' }}>Sales</p>
              {matchedSales.map((s) => (
                <button key={s.id} onClick={() => go('/sales')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--mint-alpha)]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 shrink-0">
                    <Receipt className="h-4 w-4 text-emerald-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-page-primary truncate">{s.invoiceNumber}</p>
                    <p className="text-[11px] text-page-muted">{s.customerName} · {formatDate(s.createdAt, 'DD MMM YYYY')}</p>
                  </div>
                  <span className="text-sm font-bold text-mint-500 shrink-0">{formatCurrency(s.totalAmount)}</span>
                </button>
              ))}
            </div>
          )}
          {matchedCustomers.length > 0 && (
            <div>
              <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-page-muted"
                style={{ background: 'var(--bg-page)' }}>Customers</p>
              {matchedCustomers.map((c) => (
                <button key={c.id} onClick={() => go('/customers')}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--mint-alpha)]">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/10 shrink-0">
                    <UserIcon className="h-4 w-4 text-violet-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-page-primary truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-[11px] text-page-muted">{c.phone}{c.company ? ` · ${c.company}` : ''}</p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-page-muted shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications panel
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const products       = useProductStore((s) => s.products);
  const sales          = useSalesStore((s) => s.sales);
  const { user }       = useAuthStore();
  const activeBranchId = useBranchStore((s) => s.activeBranchId);
  const branchStockSlice = useBranchInventoryStore(
    (s) => activeBranchId ? s.stock[activeBranchId] : undefined
  );

  const role         = user?.role ?? 'CASHIER';
  const isManagement = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'MANAGER';

  const notifQty = (p: Product): number => {
    if (isManagement && !activeBranchId) return p.stockQuantity;
    if (activeBranchId) return branchStockSlice?.[p.id]?.qty ?? 0;
    return p.stockQuantity;
  };

  const lowStockItems = useMemo(() =>
    products
      .filter((p) => p.isActive && notifQty(p) <= (p.lowStockThreshold ?? 10))
      .sort((a, b) => notifQty(a) - notifQty(b))
      .slice(0, 8),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [products, activeBranchId, branchStockSlice]);

  // ── Expiry alerts ──────────────────────────────────────────────────────────
  const { expiredItems, expiringSoonItems } = useMemo(() => {
    const withExpiry = products.filter((p) => p.isActive && p.expiryDate);
    const expired     = withExpiry.filter((p) => getExpiryStatus(p) === 'expired')
      .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))
      .slice(0, 8);
    const expiringSoon = withExpiry.filter((p) => getExpiryStatus(p) === 'expiring_soon')
      .sort((a, b) => (daysUntilExpiry(a) ?? 999) - (daysUntilExpiry(b) ?? 999))
      .slice(0, 8);
    return { expiredItems: expired, expiringSoonItems: expiringSoon };
  }, [products]);

  const recentSales = useMemo(() => {
    const completed = sales.filter((s) => s.status === 'COMPLETED');
    const scoped = isManagement && !activeBranchId
      ? completed
      : completed.filter((s) => !activeBranchId || s.branchId === activeBranchId);
    return scoped.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, activeBranchId, isManagement]);

  const totalAlerts = lowStockItems.length + expiredItems.length + expiringSoonItems.length;

  return (
    <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-2xl shadow-modal border overflow-hidden z-50 max-h-[80vh] flex flex-col animate-scale-in"
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--border-card)' }}>
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-mint-500" />
          <h3 className="text-sm font-bold text-page-primary">Notifications</h3>
          {totalAlerts > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-rose-500 text-white text-[10px] font-bold px-1.5">
              {totalAlerts}
            </span>
          )}
        </div>
        <button onClick={onClose}
          className="p-1.5 rounded-lg text-page-muted hover:text-page-primary transition-colors"
          style={{ background: 'transparent' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ borderColor: 'var(--border-card)' }}>

        {/* ── Expired products ── */}
        {expiredItems.length > 0 && (
          <div>
            <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-red-500"
              style={{ background: 'var(--bg-page)' }}>
              <XCircle className="h-3 w-3" /> Expired Products
            </p>
            {expiredItems.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 transition-colors"
                style={{ borderBottom: '1px solid var(--border-card)' }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 shrink-0">
                  <CalendarClock className="h-4 w-4 text-red-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-page-primary truncate">{p.name}</p>
                  <p className="text-[11px] text-page-muted">{p.sku}</p>
                </div>
                <span className="text-xs font-bold text-red-500 shrink-0 whitespace-nowrap">
                  {p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Expiring soon ── */}
        {expiringSoonItems.length > 0 && (
          <div>
            <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-orange-500"
              style={{ background: 'var(--bg-page)' }}>
              <Clock className="h-3 w-3" /> Expiring Soon
            </p>
            {expiringSoonItems.map((p) => {
              const days = daysUntilExpiry(p) ?? 0;
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 transition-colors"
                  style={{ borderBottom: '1px solid var(--border-card)' }}>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/15 shrink-0">
                    <CalendarClock className="h-4 w-4 text-orange-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-page-primary truncate">{p.name}</p>
                    <p className="text-[11px] text-page-muted">{p.sku}</p>
                  </div>
                  <span className="text-xs font-bold text-orange-500 shrink-0 whitespace-nowrap">
                    {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Low stock ── */}
        {lowStockItems.length > 0 && (
          <div>
            <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-amber-500"
              style={{ background: 'var(--bg-page)' }}>
              <AlertTriangle className="h-3 w-3" /> Low Stock Alerts
            </p>
            {lowStockItems.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3 transition-colors"
                style={{ borderBottom: '1px solid var(--border-card)' }}>
                <div className={clsx('flex h-8 w-8 items-center justify-center rounded-lg shrink-0',
                  notifQty(p) === 0 ? 'bg-rose-500/15' : 'bg-amber-500/15')}>
                  <Package className={clsx('h-4 w-4', notifQty(p) === 0 ? 'text-rose-500' : 'text-amber-500')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-page-primary truncate">{p.name}</p>
                  <p className="text-[11px] text-page-muted">{p.sku}</p>
                </div>
                <span className={clsx('text-xs font-bold shrink-0',
                  notifQty(p) === 0 ? 'text-rose-500' : 'text-amber-500')}>
                  {notifQty(p) === 0 ? 'Out' : `${notifQty(p)} left`}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ── Recent sales ── */}
        {recentSales.length > 0 && (
          <div>
            <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 text-mint-500"
              style={{ background: 'var(--bg-page)' }}>
              <TrendingUp className="h-3 w-3" /> Recent Sales
            </p>
            {recentSales.map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: '1px solid var(--border-card)' }}>
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mint-500/10 shrink-0">
                  <Receipt className="h-4 w-4 text-mint-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-page-primary truncate">{s.invoiceNumber}</p>
                  <p className="text-[11px] text-page-muted flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />{formatDate(s.createdAt, 'DD MMM, HH:mm')}
                  </p>
                </div>
                <span className="text-sm font-bold text-mint-500 shrink-0">{formatCurrency(s.totalAmount)}</span>
              </div>
            ))}
          </div>
        )}

        {totalAlerts === 0 && recentSales.length === 0 && (
          <div className="px-4 py-10 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full mb-3"
              style={{ background: 'var(--mint-alpha)' }}>
              <Bell className="h-5 w-5 text-mint-500" />
            </div>
            <p className="text-sm font-semibold text-page-primary">All clear!</p>
            <p className="text-xs text-page-muted mt-1">No alerts right now</p>
          </div>
        )}
      </div>

      <div className="px-4 py-3 shrink-0 text-center"
        style={{ borderTop: '1px solid var(--border-card)', background: 'var(--bg-page)' }}>
        <p className="text-[11px] text-page-muted">
          {expiredItems.length > 0 && (
            <span className="text-red-500 font-semibold">{expiredItems.length} expired</span>
          )}
          {expiredItems.length > 0 && expiringSoonItems.length > 0 && ' · '}
          {expiringSoonItems.length > 0 && (
            <span className="text-orange-500 font-semibold">{expiringSoonItems.length} expiring soon</span>
          )}
          {(expiredItems.length > 0 || expiringSoonItems.length > 0) && lowStockItems.length > 0 && ' · '}
          {lowStockItems.length > 0
            ? <span>{lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} need restocking</span>
            : totalAlerts === 0 && 'Stock levels are healthy'}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Theme toggle button
// ─────────────────────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="relative inline-flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200 text-page-secondary hover:text-mint-500"
      style={{ background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {theme === 'dark'
        ? <Sun  className="h-4.5 w-4.5" />
        : <Moon className="h-4.5 w-4.5" />}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon button (header actions)
// ─────────────────────────────────────────────────────────────────────────────
function HeaderIconBtn({
  children, onClick, title, badge,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  badge?: number;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="relative inline-flex items-center justify-center h-9 w-9 rounded-xl text-page-secondary hover:text-mint-500 transition-all duration-150"
      style={{ background: 'transparent' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold ring-2 ring-white dark:ring-dark-200">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PWA LAYOUT — separate mobile layout, only rendered by App.tsx when IS_PWA === true
// ═══════════════════════════════════════════════════════════════════
export function PWALayout() {
  const [drawerOpen,      setDrawerOpen]      = useState(false);
  const [profileOpen,     setProfileOpen]     = useState(false);
  const [changePwdOpen,   setChangePwdOpen]   = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [permTick,        setPermTick]        = useState(0);
  const [bannerHeight, setBannerHeight] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Measure the license banner height so content isn't hidden behind it
  useEffect(() => {
    const el = bannerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setBannerHeight(el.offsetHeight));
    obs.observe(el);
    setBannerHeight(el.offsetHeight);
    return () => obs.disconnect();
  }, []);

  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout: storeLogout } = useAuthStore();
  const setAvatarUrl = useAuthStore((s) => s.setAvatarUrl);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'popmyc-role-matrix') setPermTick((t) => t + 1);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const userRole: string = (() => {
    if (user?.role) return user.role;
    try {
      const raw = localStorage.getItem('popmyc-auth-storage');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { user?: { role?: string } } };
        if (parsed?.state?.user?.role) return parsed.state.user.role;
      }
    } catch { /* noop */ }
    return 'CASHIER';
  })();

  const firstName   = user?.firstName ?? 'User';
  const lastName    = user?.lastName  ?? '';
  const initials    = `${firstName[0] ?? 'U'}${lastName[0] ?? ''}`.toUpperCase() || 'U';
  const displayName = `${firstName} ${lastName}`.trim();
  const avatarUrl   = user?.avatarUrl ?? null;

  const { branches, activeBranchId, setActiveBranch } = useBranchStore();
  const userRecords = useUserStore((s) => s.users);

  // Branch auto-assignment — same logic as the desktop layout
  useEffect(() => {
    if (!user) return;
    const role = user.role ?? 'CASHIER';
    if (role === 'SUPER_ADMIN') return;
    const resolve = (val: string | null | undefined): string | null => {
      if (!val) return null;
      const byId   = branches.find((b) => b.id   === val);
      if (byId)   return byId.id;
      const byName = branches.find((b) => b.name.toLowerCase() === val.toLowerCase());
      return byName?.id ?? null;
    };
    let branchId = resolve(user.branch);
    if (!branchId) {
      const record = userRecords.find((u) => u.email === user.email || u.id === user.id);
      branchId = resolve(record?.branch);
    }
    if (branchId && activeBranchId !== branchId) setActiveBranch(branchId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.branch, user?.email, user?.id, branches.length, userRecords.length]);

  const businessName     = useSettingsStore((s) => s.business.name);
  const posEnabled       = useSettingsStore((s) => s.posEnabled);
  const inventoryEnabled = useSettingsStore((s) => s.inventoryEnabled);
  const isSingleBranch   = useSettingsStore((s) => s.isSingleBranch);
  const roleConfig       = useMemo(() => getRoleConfig(userRole), [userRole, permTick]); // eslint-disable-line

  const navGroups = useMemo(() =>
    ALL_NAV_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          if (!canAccess(userRole, i.href)) return false;
          if (i.mode === 'pos'       && !posEnabled)       return false;
          if (i.mode === 'inventory' && !inventoryEnabled) return false;
          if (i.href === '/branches' && isSingleBranch)    return false;
          if (i.href === '/inventory/transfers' && isSingleBranch) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0),
  [userRole, permTick, posEnabled, inventoryEnabled, isSingleBranch]); // eslint-disable-line

  // Current route for access guard
  const _rawSegment  = ('/' + location.pathname.split('/')[1]) as AppRoute;
  const _fullPath    = location.pathname as AppRoute;
  const currentRoute: AppRoute = (
    _fullPath === '/inventory/adjustments' ||
    _fullPath === '/inventory/transfers'
  ) ? _fullPath : _rawSegment;
  const routeAllowed =
    userRole === 'SUPER_ADMIN' || userRole === 'super_admin' || canAccess(userRole, currentRoute);

  const handleLogout = () => {
    authService.logout();
    storeLogout();
    setProfileOpen(false);
    setDrawerOpen(false);
    navigate('/login');
  };

  // Bottom tab definitions
  const bottomTabs: {
    key: string;
    label: string;
    href?: AppRoute;
    icon: typeof Home;
    isFab?: boolean;
    action?: () => void;
  }[] = [
    { key: 'home',     label: 'Home',     href: '/dashboard', icon: Home         },
    // POS FAB only shown when posEnabled — hide for inventory-only businesses
    ...(posEnabled ? [{ key: 'pos', label: 'POS', href: '/pos' as AppRoute, icon: ShoppingCart, isFab: true }] : []),
    { key: 'products', label: 'Products', href: '/products',  icon: Package      },
    { key: 'sales',    label: 'Sales',    href: '/sales',     icon: Receipt      },
    { key: 'more',     label: 'More',     icon: Menu,         action: () => setDrawerOpen(true) },
  ];

  const visibleTabs = bottomTabs.filter((t) =>
    t.href ? canAccess(userRole, t.href) : true
  );

  return (
    <div className="min-h-screen" style={{ background: '#f0faf8' }}>
      {/* ── Modals ── */}
      <ChangePasswordModal open={changePwdOpen} onClose={() => setChangePwdOpen(false)} />
      <ProfilePictureModal
        open={avatarModalOpen}
        onClose={() => {
          setAvatarModalOpen(false);
          const token = useAuthStore.getState().accessToken ?? '';
          if (!token || token.startsWith('local-session-')) return;
          api.get<Record<string, unknown>>('/accounts/me/', { _skipAuthRedirect: true } as Record<string, unknown>)
            .then((res) => {
              const url = (res.data.profile_picture_url as string | null) ?? null;
              setAvatarUrl(url);
            })
            .catch(() => {});
        }}
        currentAvatarUrl={avatarUrl}
        initials={initials}
      />
      <ChangePasswordModal
        open={user?.mustChangePassword === true && !changePwdOpen}
        onClose={() => {/* forced */}}
        forced
      />

      {/* ── Drawer overlay ── */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          opacity: drawerOpen ? 1 : 0,
          pointerEvents: drawerOpen ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={() => setDrawerOpen(false)}
      />

      {/* ── Left Drawer ── */}
      <div
        style={{
          position: 'fixed', top: 0, left: 0, zIndex: 50,
          height: '100%', width: 280,
          background: '#ffffff',
          display: 'flex', flexDirection: 'column',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.28s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.15)',
        }}
      >
        {/* Drawer header */}
        <div style={{ background: '#004D40', padding: '20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <p style={{ color: '#ffffff', fontWeight: 700, fontSize: 16, margin: 0 }}>
                {businessName || 'POPMYC'}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, margin: '2px 0 0' }}>
                {displayName}
              </p>
            </div>
            <button
              onClick={() => setDrawerOpen(false)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: 'none', borderRadius: 8,
                width: 32, height: 32, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#ffffff',
              }}
            >
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>
          {/* Role badge */}
          <span style={{
            display: 'inline-block',
            background: 'rgba(78,204,163,0.18)',
            color: '#4ECCA3',
            border: '1px solid rgba(78,204,163,0.4)',
            borderRadius: 20,
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}>
            {roleConfig.label}
          </span>
        </div>

        {/* Drawer nav */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
          {navGroups.map((group) => (
            <div key={group.id} style={{ marginBottom: 8 }}>
              {navGroups.length > 1 && (
                <p style={{
                  padding: '6px 16px 4px',
                  fontSize: 10, fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.16em',
                  color: '#004D40',
                  margin: 0,
                }}>
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.href ||
                  location.pathname.startsWith(item.href + '/');
                return (
                  <button
                    key={item.name}
                    onClick={() => { navigate(item.href); setDrawerOpen(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', padding: '10px 16px',
                      background: isActive ? '#00897B' : 'transparent',
                      color: isActive ? '#ffffff' : '#374151',
                      border: 'none', cursor: 'pointer',
                      fontSize: 14, fontWeight: isActive ? 600 : 400,
                      borderRadius: 0, textAlign: 'left',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#f0faf8';
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    <Icon style={{ width: 18, height: 18, flexShrink: 0, opacity: isActive ? 1 : 0.6 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Drawer footer */}
        <div style={{
          borderTop: '1px solid #e5e7eb',
          padding: '12px 0 8px',
          flexShrink: 0,
        }}>
          <button
            onClick={() => { setDrawerOpen(false); setAvatarModalOpen(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '10px 16px',
              background: 'transparent', border: 'none',
              color: '#374151', fontSize: 14, cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f0faf8'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <Camera style={{ width: 18, height: 18, flexShrink: 0, opacity: 0.6 }} />
            Profile Picture
          </button>
          <button
            onClick={() => { setDrawerOpen(false); setChangePwdOpen(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '10px 16px',
              background: 'transparent', border: 'none',
              color: '#374151', fontSize: 14, cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f0faf8'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <KeyRound style={{ width: 18, height: 18, flexShrink: 0, opacity: 0.6 }} />
            Change Password
          </button>
          <button
            onClick={handleLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              width: '100%', padding: '10px 16px',
              background: 'transparent', border: 'none',
              color: '#ef4444', fontSize: 14, cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
          >
            <LogOut style={{ width: 18, height: 18, flexShrink: 0 }} />
            Log out
          </button>
          <p style={{
            textAlign: 'center', fontSize: 11,
            color: '#9ca3af', padding: '8px 16px 4px', margin: 0,
          }}>
            v{APP_VERSION}
          </p>
        </div>
      </div>

      {/* ── Fixed top bar ── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        height: 56,
        background: '#ffffff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 12px',
      }}>
        {/* Hamburger */}
        <button
          onClick={() => setDrawerOpen(true)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 10, color: '#004D40',
          }}
        >
          <Menu style={{ width: 22, height: 22 }} />
        </button>

        {/* Brand */}
        <span style={{ color: '#004D40', fontWeight: 700, fontSize: 16, letterSpacing: '0.02em' }}>
          POPMYC POS
        </span>

        {/* Profile avatar */}
        <div ref={profileRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%', padding: 0,
            }}
          >
            <Avatar size="sm" variant="primary" initials={initials} src={avatarUrl ?? undefined} />
          </button>

          {/* Profile dropdown */}
          {profileOpen && (
            <div style={{
              position: 'absolute', top: '110%', right: 0,
              background: '#ffffff', borderRadius: 12,
              boxShadow: '0 4px 24px rgba(0,0,0,0.14)',
              border: '1px solid #e5e7eb',
              minWidth: 200, zIndex: 60,
              overflow: 'hidden',
            }}>
              {/* User info */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#111827' }}>{displayName}</p>
                <span style={{
                  display: 'inline-block', marginTop: 4,
                  background: 'rgba(78,204,163,0.15)',
                  color: '#00897B',
                  border: '1px solid rgba(78,204,163,0.3)',
                  borderRadius: 20, padding: '2px 8px',
                  fontSize: 11, fontWeight: 700,
                }}>
                  {roleConfig.label}
                </span>
              </div>
              {/* Actions */}
              {[
                { label: 'Profile Picture', icon: Camera,   action: () => { setProfileOpen(false); setAvatarModalOpen(true); } },
                { label: 'Change Password', icon: KeyRound, action: () => { setProfileOpen(false); setChangePwdOpen(true); } },
              ].map(({ label, icon: Icon, action }) => (
                <button
                  key={label}
                  onClick={action}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 16px',
                    background: 'transparent', border: 'none',
                    color: '#374151', fontSize: 14, cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f0faf8'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <Icon style={{ width: 16, height: 16, opacity: 0.6, flexShrink: 0 }} />
                  {label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid #f3f4f6' }}>
                <button
                  onClick={handleLogout}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 16px',
                    background: 'transparent', border: 'none',
                    color: '#ef4444', fontSize: 14, cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.06)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <LogOut style={{ width: 16, height: 16, flexShrink: 0 }} />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* License banner just below top bar */}
      <div ref={bannerRef} style={{ position: 'fixed', top: 56, left: 0, right: 0, zIndex: 49 }}>
        <LicenseExpiryBanner />
      </div>

      {/* ── Main content ── */}
      <main style={{ paddingTop: 56 + bannerHeight, paddingBottom: 80, minHeight: '100vh' }}>
        {(!user || routeAllowed) ? <Outlet /> : <AccessDenied roleName={roleConfig.label} />}
      </main>

      {/* ── Bottom tab bar ── */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        height: 64, paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: '#ffffff',
        boxShadow: '0 -1px 3px rgba(0,0,0,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      }}>
        {visibleTabs.map((tab) => {
          const Icon  = tab.icon;
          const isActive = tab.href
            ? location.pathname === tab.href || location.pathname.startsWith(tab.href + '/')
            : false;

          if (tab.isFab) {
            return (
              <button
                key={tab.key}
                onClick={() => tab.href && navigate(tab.href)}
                style={{
                  background: '#00897B',
                  border: 'none', cursor: 'pointer',
                  width: 52, height: 52, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transform: 'translateY(-16px)',
                  boxShadow: '0 4px 16px rgba(0,137,123,0.45)',
                  flexShrink: 0,
                }}
                aria-label={tab.label}
              >
                <Icon style={{ width: 24, height: 24, color: '#ffffff' }} />
              </button>
            );
          }

          return (
            <button
              key={tab.key}
              onClick={() => tab.action ? tab.action() : (tab.href && navigate(tab.href))}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 2, flex: 1, height: '100%',
                color: isActive ? '#00897B' : '#9ca3af',
              }}
              aria-label={tab.label}
            >
              <Icon style={{ width: 22, height: 22 }} />
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, lineHeight: 1.2 }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main layout
// ─────────────────────────────────────────────────────────────────────────────
export function MainLayout() {
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [searchQuery,   setSearchQuery]   = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [permTick,      setPermTick]      = useState(0);
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef  = useRef<HTMLDivElement>(null);
  const userRef   = useRef<HTMLDivElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout: storeLogout } = useAuthStore();
  const setAvatarUrl = useAuthStore((s) => s.setAvatarUrl);
  const { branches, activeBranchId, setActiveBranch } = useBranchStore();
  const userRecords = useUserStore((s) => s.users);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'popmyc-role-matrix') setPermTick((t) => t + 1);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Re-fetch the current user from the backend on mount to restore the
  // latest avatar URL. Skipped in local/demo mode (no real backend token).
  useEffect(() => {
    const token = useAuthStore.getState().accessToken ?? '';
    if (!token || token.startsWith('local-session-')) return;
    // _skipAuthRedirect tells the 401 interceptor not to force-logout for this
    // non-critical background request — a stale avatar URL is not worth logging the user out.
    api.get<Record<string, unknown>>('/accounts/me/', { _skipAuthRedirect: true } as Record<string, unknown>)
      .then((res) => {
        const url = (res.data.profile_picture_url as string | null) ?? null;
        // Only update if the value actually changed — avoids needless re-renders
        if (url !== useAuthStore.getState().user?.avatarUrl) {
          setAvatarUrl(url);
        }
      })
      .catch(() => { /* silently ignore — user picture is non-critical */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    const role = user.role ?? 'CASHIER';
    if (role === 'SUPER_ADMIN') return;
    const resolve = (val: string | null | undefined): string | null => {
      if (!val) return null;
      const byId   = branches.find((b) => b.id   === val);
      if (byId)   return byId.id;
      const byName = branches.find((b) => b.name.toLowerCase() === val.toLowerCase());
      return byName?.id ?? null;
    };
    let branchId = resolve(user.branch);
    if (!branchId) {
      const record = userRecords.find((u) => u.email === user.email || u.id === user.id);
      branchId = resolve(record?.branch);
    }
    if (branchId && activeBranchId !== branchId) setActiveBranch(branchId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.branch, user?.email, user?.id, branches.length, userRecords.length]);

  const firstName = user?.firstName ?? 'User';
  const lastName  = user?.lastName  ?? '';
  const userEmail = user?.email     ?? '';
  const userRole: string = (() => {
    if (user?.role) return user.role;
    try {
      const raw = localStorage.getItem('popmyc-auth-storage');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { user?: { role?: string } } };
        if (parsed?.state?.user?.role) return parsed.state.user.role;
      }
    } catch { /* noop */ }
    return 'CASHIER';
  })();

  const displayName  = `${firstName} ${lastName}`.trim();
  const initials     = `${firstName[0] ?? 'U'}${lastName[0] ?? ''}`.toUpperCase() || 'U';
  const avatarUrl    = user?.avatarUrl ?? null;
  const businessLogo = useSettingsStore((s) => s.business.logoUrl);
  const businessName = useSettingsStore((s) => s.business.name);
  const roleConfig   = useMemo(() => getRoleConfig(userRole), [userRole, permTick]); // eslint-disable-line

  const posEnabled       = useSettingsStore((s) => s.posEnabled);
  const inventoryEnabled = useSettingsStore((s) => s.inventoryEnabled);
  const isSingleBranch   = useSettingsStore((s) => s.isSingleBranch);

  // Auto-updater state — drives the update button in the header
  const updater = useUpdater();

  const navGroups = useMemo(() =>
    ALL_NAV_GROUPS
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          // Role-based access first
          if (!canAccess(userRole, i.href)) return false;
          // Operating-mode filter
          if (i.mode === 'pos'       && !posEnabled)       return false;
          if (i.mode === 'inventory' && !inventoryEnabled) return false;
          // Hide Branches nav for single-branch businesses
          if (i.href === '/branches' && isSingleBranch)    return false;
          // Hide Branch Transfers for single-branch businesses
          if (i.href === '/inventory/transfers' && isSingleBranch) return false;
          return true;
        }),
      }))
      .filter((g) => g.items.length > 0),
  [userRole, permTick, posEnabled, inventoryEnabled, isSingleBranch]); // eslint-disable-line

  const products         = useProductStore((s) => s.products);
  const notifBranchSlice = useBranchInventoryStore(
    (s) => activeBranchId ? s.stock[activeBranchId] : undefined
  );
  const alertCount = useMemo(() => {
    const isMgmt = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'MANAGER';
    const stockAlerts = products.filter((p) => {
      if (!p.isActive) return false;
      const qty = (isMgmt && !activeBranchId)
        ? p.stockQuantity
        : (activeBranchId ? (notifBranchSlice?.[p.id]?.qty ?? 0) : p.stockQuantity);
      return qty <= (p.lowStockThreshold ?? 10);
    }).length;
    const expiryAlerts = products.filter((p) => {
      if (!p.isActive) return false;
      const status = getExpiryStatus(p);
      return status === 'expired' || status === 'expiring_soon';
    }).length;
    return stockAlerts + expiryAlerts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, activeBranchId, notifBranchSlice, userRole]);

  // Close dropdowns on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchFocused(false);
      if (notifRef.current  && !notifRef.current.contains(e.target as Node))  setNotifOpen(false);
      if (userRef.current   && !userRef.current.contains(e.target as Node))   setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Play alert sound once when new alerts appear (e.g. stock drops below threshold)
  const prevAlertCountRef = useRef(0);
  useEffect(() => {
    if (alertCount > 0 && prevAlertCountRef.current === 0) {
      // First time alerts appear this session — play the alert chime
      playAlertSound();
    }
    prevAlertCountRef.current = alertCount;
  }, [alertCount]);

  // Build the current route — prefer the full path when it matches a known two-segment route
  const _rawSegment = ('/' + location.pathname.split('/')[1]) as AppRoute;
  const _fullPath   = location.pathname as AppRoute;
  const currentRoute: AppRoute = (
    _fullPath === '/inventory/adjustments' ||
    _fullPath === '/inventory/transfers'
  ) ? _fullPath : _rawSegment;
  const routeAllowed =
    userRole === 'SUPER_ADMIN' || userRole === 'super_admin' || canAccess(userRole, currentRoute);

  const handleLogout = () => {
    authService.logout();
    storeLogout();
    setUserMenuOpen(false);
    navigate('/login');
  };

  // Page title from route
  const pageTitle = useMemo(() => {
    for (const g of ALL_NAV_GROUPS) {
      const found = g.items.find((i) => i.href === currentRoute);
      if (found) return found.name;
    }
    return 'POPMYC POS';
  }, [currentRoute]);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>

      {/* ── Self-service change password modal ── */}
      <ChangePasswordModal
        open={changePwdOpen}
        onClose={() => setChangePwdOpen(false)}
      />

      {/* ── Profile picture modal ── */}
      <ProfilePictureModal
        open={avatarModalOpen}
        onClose={() => {
          setAvatarModalOpen(false);
          // Re-fetch avatar URL from backend after modal closes (may have changed)
          const token = useAuthStore.getState().accessToken ?? '';
          if (!token || token.startsWith('local-session-')) return;
          api.get<Record<string, unknown>>('/accounts/me/', { _skipAuthRedirect: true } as Record<string, unknown>)
            .then((res) => {
              const url = (res.data.profile_picture_url as string | null) ?? null;
              setAvatarUrl(url);
            })
            .catch(() => {});
        }}
        currentAvatarUrl={avatarUrl}
        initials={initials}
      />

      {/* ── Forced change-password when must_change_password is true ── */}
      <ChangePasswordModal
        open={user?.mustChangePassword === true && !changePwdOpen}
        onClose={() => {/* forced */}}
        forced
      />

      {/* ── Mobile overlay ── */}
      <div
        className="lg:hidden fixed inset-0 z-40 transition-all duration-300"
        style={{
          background: 'rgba(0,0,0,.55)',
          backdropFilter: 'blur(4px)',
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? 'auto' : 'none',
        }}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ═══════════════════════════════════════════════════════════════════
          SIDEBAR
          ═══════════════════════════════════════════════════════════════ */}
      <aside className={clsx(
        'fixed top-0 left-0 z-50 h-screen w-64 flex flex-col',
        'transform transition-transform duration-300 ease-in-out',
        'lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )} style={{ background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border-side)' }}>

        {/* ── Brand ── */}
        <div className="flex items-center justify-between h-16 px-5 shrink-0"
          style={{ borderBottom: '1px solid var(--border-side)' }}>
          <NavLink to="/dashboard" className="flex items-center gap-3 group" onClick={() => setSidebarOpen(false)}>
            {/* Mint-glow logo mark */}
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl shrink-0 overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #00FFAA22, #00FFAA44)', border: '1px solid var(--mint-glow)' }}>
              {businessLogo
                ? <img src={businessLogo} alt="logo" className="h-full w-full object-contain" />
                : <Zap className="h-5 w-5" style={{ color: 'var(--mint)' }} />}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-bold text-white leading-tight truncate max-w-[120px]">
                {businessName || 'POPMYC'}
              </span>
              <span className="text-[10px] font-medium leading-none" style={{ color: 'var(--mint)', opacity: 0.7 }}>
                Retail POS
              </span>
            </div>
          </NavLink>
          <button
            type="button"
            className="lg:hidden h-8 w-8 inline-flex items-center justify-center rounded-lg text-white/50 hover:text-white transition-colors"
            style={{ background: 'transparent' }}
            onClick={() => setSidebarOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Role badge ── */}
        <div className="px-4 pt-3 pb-1 shrink-0">
          <span className={clsx(
            'badge-mint text-[10px] font-bold',
            roleConfig.color, roleConfig.accent
          )}>
            {roleConfig.label}
          </span>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-none space-y-4">
          {navGroups.map((group) => (
            <div key={group.id}>
              {navGroups.length > 1 && (
                <p className="px-3 mb-1.5 text-[9px] font-black uppercase tracking-[0.18em]"
                  style={{ color: 'rgba(255,255,255,.22)' }}>
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={({ isActive }) => clsx(
                        'nav-item',
                        isActive ? 'nav-item-active' : 'nav-item-inactive',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon className={clsx('h-[17px] w-[17px] shrink-0 transition-colors',
                            isActive ? '' : 'opacity-50')}
                            style={isActive ? { color: 'var(--mint)' } : {}} />
                          <span className="truncate flex-1 text-[13px]">{item.name}</span>
                          {isActive && (
                            <span className="ml-auto h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ background: 'var(--mint)' }} />
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Sidebar footer — user info + theme toggle ── */}
        <div className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border-side)' }}>
          <div className="rounded-xl p-3 flex items-center gap-3"
            style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--border-side)' }}>
            <Avatar size="sm" variant="primary" initials={initials}
              src={avatarUrl ?? undefined}
              className="shrink-0 ring-2" style={{ ringColor: 'var(--mint-glow)' } as React.CSSProperties} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-white/90 truncate">{displayName}</p>
              <p className="text-[10px] truncate" style={{ color: 'var(--mint)', opacity: 0.7 }}>{roleConfig.label}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              className="h-7 w-7 flex items-center justify-center rounded-lg text-white/40 hover:text-rose-400 transition-colors shrink-0">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════════════════════════════════════
          MAIN CONTENT AREA
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col min-h-screen lg:ml-64">

        {/* ── Header ── */}
        <header className="sticky top-0 z-30 shrink-0"
          style={{
            background: 'var(--bg-header)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderBottom: '1px solid var(--border-base)',
            boxShadow: theme === 'dark' ? '0 1px 0 rgba(255,255,255,.04)' : '0 1px 0 rgba(0,0,0,.04)',
          }}>

          {/* Main row */}
          <div className="flex items-center justify-between h-14 sm:h-16 px-3 sm:px-4 lg:px-6 gap-2">

            {/* Left — hamburger + page title */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <button type="button"
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-xl text-page-secondary transition-all"
                style={{ background: 'transparent' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => setSidebarOpen(true)}>
                <Menu className="h-5 w-5" />
              </button>

              {/* Page title — desktop */}
              <h1 className="hidden lg:block text-base font-bold text-page-primary truncate">
                {pageTitle}
              </h1>

              {/* Search — desktop */}
              <div ref={searchRef} className="hidden sm:block relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-page-muted pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  className="input-base pl-9 h-9 text-sm w-36 md:w-52 lg:w-64 focus:lg:w-80 transition-all duration-200"
                />
                {searchFocused && searchQuery.length >= 2 && (
                  <SearchPanel query={searchQuery} onClose={() => { setSearchFocused(false); setSearchQuery(''); }} />
                )}
              </div>
            </div>

            {/* Right — actions */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Mobile search */}
              <HeaderIconBtn onClick={() => setSearchFocused((v) => !v)} title="Search">
                <Search className="h-4.5 w-4.5" />
              </HeaderIconBtn>

              {/* Branch switcher */}
              <BranchSwitcher />

              {/* ── Update available button — appears when update is ready ── */}
              {updater.isDesktop && updater.state === 'ready' && (
                <button
                  type="button"
                  onClick={() => updater.install()}
                  title={`Update to v${updater.updateVersion ?? '...'} — click to restart and install`}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-xl px-3 h-8 text-xs font-bold transition-all animate-pulse"
                  style={{ background: '#003D35', color: '#4ECCA3', border: '1px solid rgba(78,204,163,0.4)' }}
                >
                  <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                  Update v{updater.updateVersion}
                </button>
              )}
              {/* Mobile: just icon */}
              {updater.isDesktop && updater.state === 'ready' && (
                <button
                  type="button"
                  onClick={() => updater.install()}
                  title={`Update to v${updater.updateVersion ?? '...'}`}
                  className="sm:hidden inline-flex items-center justify-center h-9 w-9 rounded-xl animate-pulse"
                  style={{ background: '#003D35', color: '#4ECCA3', border: '1px solid rgba(78,204,163,0.4)' }}
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              )}
              {/* Downloading: show a small spinner so user knows it's happening */}
              {updater.isDesktop && updater.state === 'downloading' && (
                <div
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-xl px-3 h-8 text-xs font-medium"
                  style={{ background: 'var(--mint-alpha)', color: 'var(--mint)' }}
                  title="Downloading update…"
                >
                  <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                  {Math.round(updater.progress?.percent ?? 0)}%
                </div>
              )}

              {/* Sync status indicator */}
              <SyncStatusIndicator />

              {/* Theme toggle */}
              <ThemeToggle />

              {/* Notifications */}
              <div ref={notifRef} className="relative">
                <HeaderIconBtn
                  onClick={() => {
                    setNotifOpen((v) => !v);
                    if (!notifOpen && alertCount > 0) playNotificationSound();
                  }}
                  title="Notifications"
                  badge={alertCount}
                >
                  <Bell className="h-4.5 w-4.5" />
                </HeaderIconBtn>
                {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
              </div>

              {/* User menu */}
              <div ref={userRef} className="relative">
                <button type="button"
                  className="flex items-center gap-1.5 sm:gap-2 rounded-xl px-1 sm:px-2 py-1 transition-all duration-150"
                  style={{ background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
                  onMouseLeave={e => userMenuOpen ? null : (e.currentTarget.style.background = 'transparent')}
                  onClick={() => setUserMenuOpen((v) => !v)}>
                  <Avatar size="sm" variant="primary" initials={initials}
                    src={avatarUrl ?? undefined}
                    className="ring-2 shadow-sm shrink-0"
                    style={{ '--tw-ring-color': 'var(--mint-glow)' } as React.CSSProperties} />
                  <div className="hidden sm:flex flex-col items-start max-w-[100px] lg:max-w-[130px]">
                    <span className="text-[12px] font-semibold text-page-primary leading-tight truncate w-full">{displayName}</span>
                    <span className="text-[10px] text-page-muted leading-tight truncate w-full">{roleConfig.label}</span>
                  </div>
                  <ChevronDown className={clsx('hidden sm:block h-3.5 w-3.5 text-page-muted transition-transform duration-200 shrink-0',
                    userMenuOpen && 'rotate-180')} />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 mt-2 w-60 rounded-2xl shadow-modal border z-50 overflow-hidden animate-scale-in"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}>
                    {/* User info */}
                    <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--border-card)' }}>
                      <div className="flex items-center gap-3">
                        <Avatar size="md" variant="primary" initials={initials}
                          src={avatarUrl ?? undefined}
                          style={{ '--tw-ring-color': 'var(--mint-glow)' } as React.CSSProperties} />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-page-primary truncate">{displayName}</p>
                          <p className="text-xs text-page-muted truncate">{userEmail || 'admin@popmyc.com'}</p>
                          <span className="badge-mint mt-1">{roleConfig.label}</span>
                        </div>
                      </div>
                    </div>

                    {/* Menu items */}
                    <div className="py-1.5">
                      {[
                        { label: 'My Profile',      icon: UserIcon,  onClick: () => setUserMenuOpen(false),                        show: true },
                        { label: 'Profile Picture', icon: Camera,    onClick: () => { setUserMenuOpen(false); setAvatarModalOpen(true); }, show: true },
                        { label: 'Change Password', icon: KeyRound,  onClick: () => { setUserMenuOpen(false); setChangePwdOpen(true); }, show: true },
                        { label: 'Settings',        icon: Settings,  onClick: () => { setUserMenuOpen(false); navigate('/settings'); }, show: roleConfig.canAccessSettings },
                        { label: 'System',          icon: Server,    onClick: () => { setUserMenuOpen(false); navigate('/system'); },   show: roleConfig.canAccessSystem  },
                      ]
                        .filter((i) => i.show)
                        .map((item) => {
                          const Icon = item.icon;
                          return (
                            <button key={item.label} type="button" onClick={item.onClick}
                              className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-page-secondary transition-colors"
                              style={{ background: 'transparent' }}
                              onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                              <Icon className="h-4 w-4 shrink-0 text-page-muted" />
                              {item.label}
                            </button>
                          );
                        })}
                    </div>

                    {/* Logout */}
                    <div className="py-1.5" style={{ borderTop: '1px solid var(--border-card)' }}>
                      <button type="button" onClick={handleLogout}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-rose-500 transition-colors"
                        style={{ background: 'transparent' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,.08)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <LogOut className="h-4 w-4 shrink-0" />
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile search bar */}
          {searchFocused && (
            <div className="sm:hidden px-3 pb-2" style={{ borderTop: '1px solid var(--border-base)' }}>
              <div ref={searchRef} className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-page-muted pointer-events-none" />
                <input
                  type="search"
                  placeholder="Search products, sales, customers…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="input-base pl-9 w-full h-9 text-sm mt-2"
                />
                {searchQuery.length >= 2 && (
                  <SearchPanel query={searchQuery} onClose={() => { setSearchFocused(false); setSearchQuery(''); }} />
                )}
              </div>
            </div>
          )}
        </header>

        {/* ── License expiry warning banner ── */}
        <LicenseExpiryBanner />

        {/* ── Page content ── */}
        <main className="flex-1 p-3 sm:p-5 lg:p-8">
          {(!user || routeAllowed) ? <Outlet /> : <AccessDenied roleName={roleConfig.label} />}
        </main>

        <HelpBot />
      </div>
    </div>
  );
}

export default MainLayout;
