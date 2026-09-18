import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ShoppingCart, Package, Warehouse, Receipt, Truck, Users, Factory,
  FileText, BarChart3, Settings, Server, ChevronRight, Sparkles,
  ShoppingBag, ArrowUpRight, PackageCheck, DollarSign, AlertTriangle,
  CalendarClock, TrendingUp, TrendingDown, Bookmark, Shield, ClipboardList,
  HardDrive, UserCog, Ruler, Bell, LayoutDashboard, Sun, Cloud, CloudRain,
  Phone, Wifi, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore }      from '@/stores/auth.store';
import { useProductStore }   from '@/stores/product.store';
import { useSalesStore }     from '@/stores/sales.store';
import { useExpenseStore }   from '@/stores/expense.store';
import { useCustomerStore }  from '@/stores/customer.store';
import { APP_NAME }          from '@/utils/constants';
import { formatCurrency }    from '@/utils/format';
import { canAccess, getRoleConfig, type AppRoute } from '@/utils/permissions';
import { useBranchFilter }   from '@/hooks/useBranchFilter';
import { buildLocalPL }      from '@/services/reports.service';

// ── Menu tiles ────────────────────────────────────────────────────────────────
type MenuItem = {
  name: string; subtitle?: string; href: AppRoute;
  icon: typeof ShoppingCart; color: string; bg: string; priority?: boolean;
};

const ALL_MENU_ITEMS: MenuItem[] = [
  { name:'Quick Sale',  subtitle:'Start selling',   href:'/pos',        icon:ShoppingCart, color:'text-[#00FFAA]', bg:'',           priority:true },
  { name:'Products',    subtitle:'Catalog',          href:'/products',   icon:Package,      color:'text-emerald-400', bg:'' },
  { name:'Inventory',   subtitle:'Stock control',    href:'/inventory',  icon:Warehouse,    color:'text-amber-400',   bg:'' },
  { name:'Sales',       subtitle:'Transactions',     href:'/sales',      icon:Receipt,      color:'text-sky-400',     bg:'' },
  { name:'Customers',   subtitle:'Client list',      href:'/customers',  icon:Users,        color:'text-rose-400',    bg:'' },
  { name:'Purchases',   subtitle:'Supplies',         href:'/purchases',  icon:Truck,        color:'text-violet-400',  bg:'' },
  { name:'Expenses',    subtitle:'Spending',         href:'/expenses',   icon:FileText,     color:'text-orange-400',  bg:'' },
  { name:'Suppliers',   subtitle:'Vendors',          href:'/suppliers',  icon:Factory,      color:'text-teal-400',    bg:'' },
  { name:'Reports',     subtitle:'Analytics',        href:'/reports',    icon:BarChart3,    color:'text-purple-400',  bg:'' },
  { name:'Debts',       subtitle:'Outstanding',      href:'/debt',       icon:AlertTriangle,color:'text-red-400',     bg:'' },
  { name:'Users',       subtitle:'Manage staff',     href:'/users',      icon:UserCog,      color:'text-slate-400',   bg:'' },
  { name:'Branches',    subtitle:'Locations',        href:'/branches',   icon:LayoutDashboard,color:'text-teal-300', bg:'' },
  { name:'Roles',       subtitle:'Permissions',      href:'/roles',      icon:Shield,       color:'text-red-300',     bg:'' },
  { name:'Settings',    subtitle:'Preferences',      href:'/settings',   icon:Settings,     color:'text-muted-400',   bg:'' },
  { name:'Categories',  subtitle:'Organise',         href:'/categories', icon:Bookmark,     color:'text-cyan-400',    bg:'' },
  { name:'Brands',      subtitle:'Manufacturers',    href:'/brands',     icon:Shield,       color:'text-indigo-400',  bg:'' },
  { name:'Units',       subtitle:'Measurements',     href:'/units',      icon:Ruler,        color:'text-blue-400',    bg:'' },
  { name:'Audit Logs',  subtitle:'Activity',         href:'/audit',      icon:ClipboardList,color:'text-indigo-300',  bg:'' },
  { name:'Backup',      subtitle:'Data safety',      href:'/backup',     icon:HardDrive,    color:'text-slate-300',   bg:'' },
];

type DashNotification = {
  id:string; icon:typeof Bell; title:string; time:string; color:string; href?:string;
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return now;
}

function useServerPing() {
  const [online, setOnline] = useState<boolean | null>(null);
  const ping = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('/api/v1/health/', { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timeout); setOnline(res.ok);
    } catch { setOnline(false); }
  }, []);
  useEffect(() => { ping(); const iv = setInterval(ping, 30_000); return () => clearInterval(iv); }, [ping]);
  return online;
}

export function DashboardPage() {
  const { user }     = useAuthStore();
  const now          = useClock();
  const serverOnline = useServerPing();
  const { products } = useProductStore();
  const { sales: allSales }         = useSalesStore();
  const { customers: allCustomers } = useCustomerStore();
  const allExpenses                 = useExpenseStore((s) => s.expenses);

  const { filterByBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const sales     = filterByBranch(allSales);
  const customers = filterByBranch(allCustomers);

  const firstName  = user?.firstName ?? 'User';
  const userRole   = user?.role      ?? 'CASHIER';
  const roleConfig = getRoleConfig(userRole);

  const menuItems = useMemo(() => ALL_MENU_ITEMS.filter((item) => canAccess(userRole, item.href)), [userRole]);

  const [internetOnline, setInternetOnline] = useState(true);
  useEffect(() => {
    const h = () => setInternetOnline(navigator.onLine);
    h();
    window.addEventListener('online',  h);
    window.addEventListener('offline', h);
    return () => { window.removeEventListener('online', h); window.removeEventListener('offline', h); };
  }, []);

  const greeting = useMemo(() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, [now]);
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dateStr = now.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });

  const weatherKind = useMemo<'sun'|'cloud'|'rain'>(() => {
    const s = now.getDate() % 3;
    return s === 0 ? 'sun' : s === 1 ? 'cloud' : 'rain';
  }, [now]);
  const weatherTemp = useMemo(() => 24 + (now.getDate() % 8), [now]);
  const weatherDesc = weatherKind === 'sun' ? 'Sunny' : weatherKind === 'cloud' ? 'Cloudy' : 'Rainy';

  const productsCount   = useMemo(() => products.filter((p) => p.isActive).length, [products]);
  const lowStockCount   = useMemo(() => products.filter((p) => p.isActive && p.stockQuantity > 0 && p.stockQuantity <= (p.lowStockThreshold ?? 10)).length, [products]);
  const outOfStockCount = useMemo(() => products.filter((p) => p.isActive && p.stockQuantity === 0).length, [products]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const salesStats = useMemo(() => {
    const completed  = sales.filter((s) => s.status === 'COMPLETED');
    const todaySales = completed.filter((s) => s.createdAt.slice(0, 10) === today);
    return {
      todayRevenue:      todaySales.reduce((sum, s) => sum + s.totalAmount, 0),
      todayCount:        todaySales.length,
      totalRevenue:      completed.reduce((sum, s) => sum + s.totalAmount, 0),
      totalTransactions: completed.length,
    };
  }, [sales, today, effectiveBranchId]);

  // ── Today's P&L (local estimate from store data) ───────────────────────────
  const todayPL = useMemo(() => {
    const activeBranchId = effectiveBranchId ?? undefined;
    return buildLocalPL(
      sales.map((s) => ({
        status: s.status, totalAmount: s.totalAmount,
        discountAmount: s.discountAmount, taxAmount: s.taxAmount,
        createdAt: s.createdAt, branchId: s.branchId ?? null,
      })),
      allExpenses.map((e) => ({
        status: e.status, totalAmount: e.totalAmount,
        expenseDate: e.expenseDate, branchId: e.branchId ?? null,
      })),
      today, today, activeBranchId,
    );
  }, [sales, allExpenses, today, effectiveBranchId]);

  const statCards = useMemo(() => {
    const isLoss = todayPL.net_profit < 0;
    const all = [
      { label:"Today's Revenue", value:formatCurrency(salesStats.todayRevenue),           sub:`${salesStats.todayCount} sales today`,       icon:DollarSign,   accent:'#00FFAA', href:'/reports',   show:roleConfig.canViewReports },
      { label:"Today's Net Sales",value:formatCurrency(todayPL.revenue.net_sales),        sub:'After discounts & returns',                   icon:TrendingUp,   accent:'#60a5fa', href:'/reports',   show:roleConfig.canViewReports },
      { label:"Today's Expenses", value:formatCurrency(todayPL.expenses.total),           sub:'Approved & paid today',                       icon:TrendingDown, accent:'#f87171', href:'/expenses',  show:roleConfig.canViewReports },
      { label:"Today's Net Profit",value:formatCurrency(Math.abs(todayPL.net_profit)),    sub:isLoss ? 'Net loss today' : 'Net profit today', icon: isLoss ? TrendingDown : TrendingUp, accent: isLoss ? '#f87171' : '#34d399', href:'/reports', show:roleConfig.canViewReports },
      { label:'Transactions',    value:String(salesStats.totalTransactions),               sub:'Completed sales',                             icon:Receipt,      accent:'#c084fc', href:'/sales',     show:canAccess(userRole,'/sales') },
      { label:'Customers',       value:String(customers.filter((c) => c.isActive).length),sub:'Active customers',                            icon:Users,        accent:'#f87171', href:'/customers', show:canAccess(userRole,'/customers') },
      { label:'Products',        value:String(productsCount),                              sub:'Active products',                             icon:Package,      accent:'#34d399', href:'/products',  show:canAccess(userRole,'/products') },
      { label:'Low / Out Stock', value:`${lowStockCount} / ${outOfStockCount}`,            sub:'Needs restocking',                            icon:AlertTriangle,accent: outOfStockCount > 0 ? '#f87171' : '#fbbf24', href:'/inventory', show:canAccess(userRole,'/inventory') },
    ];
    return all.filter((c) => c.show);
  }, [salesStats, todayPL, customers, productsCount, lowStockCount, outOfStockCount, userRole, roleConfig, effectiveBranchId]); // eslint-disable-line

  // Activity feed
  const notifications = useMemo((): DashNotification[] => {
    const items: DashNotification[] = [];
    if (canAccess(userRole, '/sales')) {
      [...sales]
        .filter((s) => s.status === 'COMPLETED')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 4)
        .forEach((s) => {
          const minsAgo = Math.max(1, Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 60_000));
          const timeText = minsAgo < 60 ? `${minsAgo}m ago` : minsAgo < 1440 ? `${Math.floor(minsAgo / 60)}h ago` : `${Math.floor(minsAgo / 1440)}d ago`;
          items.push({ id:s.id, icon:Receipt, title:`${s.invoiceNumber} · ${formatCurrency(s.totalAmount)} · ${s.customerName}`, time:timeText, color:'text-mint-500', href:'/sales' });
        });
    }
    if (lowStockCount > 0 && canAccess(userRole, '/inventory'))
      items.push({ id:'low', icon:AlertTriangle, title:`${lowStockCount} product${lowStockCount===1?'':'s'} running low`, time:'Now', color:'text-amber-400', href:'/inventory' });
    if (outOfStockCount > 0 && canAccess(userRole, '/inventory'))
      items.push({ id:'out', icon:ShoppingBag, title:`${outOfStockCount} product${outOfStockCount===1?'':'s'} out of stock`, time:'Now', color:'text-rose-400', href:'/inventory' });
    if (items.length === 0)
      items.push(
        { id:'welcome', icon:Sparkles, title:`Welcome back, ${firstName}! Store is ready.`, time:'Now', color:'text-mint-500' },
        { id:'products', icon:PackageCheck, title:`${productsCount} active products in catalog`, time:'Today', color:'text-mint-400' },
      );
    return items.slice(0, 6);
  }, [sales, lowStockCount, outOfStockCount, userRole, productsCount, firstName]);

  const roleDesc: Record<string,string> = {
    SUPER_ADMIN:'Full system access', ADMIN:'Business operations', MANAGER:'Reports & oversight',
    CASHIER:'Process sales', INVENTORY_CLERK:'Stock management',
  };

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* ── Hero banner ─────────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #080f1e 0%, #0d2040 60%, #0f2a0f 100%)' }}>
        {/* subtle grid overlay */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'linear-gradient(rgba(0,255,170,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,170,.04) 1px,transparent 1px)',
            backgroundSize: '32px 32px',
          }} />
        {/* mint glow orb */}
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(0,255,170,.12) 0%, transparent 70%)' }} />

        <div className="relative p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="min-w-0">
            {/* Meta row */}
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-[11px] text-white/50 font-medium">{dateStr}</span>
              <span className="text-white/20">·</span>
              <span className="text-[11px] font-bold text-white/70 tabular-nums">{timeStr}</span>
              {activeBranchName !== 'All Branches' && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background:'rgba(0,255,170,.12)', color:'var(--mint)', border:'1px solid rgba(0,255,170,.2)' }}>
                  📍 {activeBranchName}
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold text-white leading-tight">
              {greeting}, {firstName} 👋
            </h1>
            <p className="mt-1 text-sm text-white/50">{roleDesc[userRole] ?? 'Welcome to POPMYC POS'}</p>

            {/* Status pills */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold border',
                internetOnline
                  ? 'border-mint-500/30 text-mint-400' : 'border-rose-500/30 text-rose-400')}
                style={{ background: internetOnline ? 'rgba(0,255,170,.08)' : 'rgba(239,68,68,.08)' }}>
                <Wifi className="h-2.5 w-2.5" />
                {internetOnline ? 'Online' : 'Offline'}
              </span>
              <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold border',
                serverOnline === null ? 'border-amber-500/30 text-amber-400' :
                serverOnline         ? 'border-mint-500/30 text-mint-400'   : 'border-rose-500/30 text-rose-400')}
                style={{ background: serverOnline === null ? 'rgba(251,191,36,.08)' : serverOnline ? 'rgba(0,255,170,.08)' : 'rgba(239,68,68,.08)' }}>
                <Server className="h-2.5 w-2.5" />
                {serverOnline === null ? 'Checking…' : serverOnline ? 'Server OK' : 'Server Down'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold border"
                style={{ background:'rgba(0,255,170,.08)', borderColor:'rgba(0,255,170,.2)', color:'var(--mint)' }}>
                <Zap className="h-2.5 w-2.5" />
                {roleConfig.label}
              </span>
            </div>
          </div>

          {/* Right side — weather + CTA */}
          <div className="shrink-0 flex items-center gap-3">
            {/* Weather widget */}
            <div className="rounded-xl px-3.5 py-3 flex items-center gap-2.5"
              style={{ background:'rgba(255,255,255,.06)', border:'1px solid rgba(255,255,255,.08)' }}>
              {weatherKind === 'sun'
                ? <Sun className="h-5 w-5 text-amber-400" />
                : weatherKind === 'cloud'
                  ? <Cloud className="h-5 w-5 text-slate-300" />
                  : <CloudRain className="h-5 w-5 text-sky-400" />}
              <div>
                <p className="text-base font-bold text-white leading-none">{weatherTemp}°</p>
                <p className="text-[10px] text-white/50 mt-0.5">{weatherDesc}</p>
              </div>
            </div>

            {/* POS CTA */}
            {canAccess(userRole, '/pos') && (
              <Link to="/pos"
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-150 active:scale-95 shadow-mint whitespace-nowrap"
                style={{ background:'var(--mint)', color:'#0a1628' }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.boxShadow = '0 0 24px rgba(0,255,170,.4)')}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.boxShadow = '')}>
                <ShoppingCart className="h-4 w-4" />
                <span className="hidden xs:inline">New Sale</span>
                <ArrowUpRight className="h-3.5 w-3.5 opacity-60" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      {statCards.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {statCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link key={card.label} to={card.href}
                className="group relative rounded-2xl p-4 overflow-hidden transition-all duration-200 hover:-translate-y-0.5"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                  boxShadow: 'var(--shadow-card)',
                }}>
                {/* accent glow strip */}
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-2xl"
                  style={{ background: card.accent, opacity: 0.7 }} />

                <div className="flex items-center justify-between mb-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl"
                    style={{ background: `${card.accent}18` }}>
                    <Icon className="h-4 w-4" style={{ color: card.accent }} />
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-page-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                <p className="text-lg sm:text-xl font-black leading-none text-page-primary">
                  {card.value}
                </p>
                <p className="text-[11px] font-semibold text-page-secondary mt-1 truncate">{card.label}</p>
                <p className="text-[10px] text-page-muted truncate">{card.sub}</p>
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Quick nav + activity ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_320px] gap-5">

        {/* ── Quick Navigation ── */}
        <div className="rounded-2xl p-4 sm:p-5"
          style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', boxShadow:'var(--shadow-card)' }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-page-primary">Quick Navigation</h2>
            {canAccess(userRole, '/products') && (
              <span className="text-[11px] text-page-muted font-medium">{productsCount} products</span>
            )}
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-4 gap-2 sm:gap-2.5">
            {menuItems.map((item) => {
              const I = item.icon;
              return (
                <Link key={item.name} to={item.href}
                  className="group flex flex-col items-center gap-2 rounded-xl p-2.5 sm:p-3 text-center transition-all duration-150 hover:-translate-y-0.5"
                  style={{
                    background: item.priority ? 'rgba(0,255,170,.06)' : 'var(--bg-page)',
                    border: item.priority ? '1px solid rgba(0,255,170,.18)' : '1px solid var(--border-card)',
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'rgba(0,255,170,.06)')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = item.priority ? 'rgba(0,255,170,.06)' : 'var(--bg-page)')}>

                  <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-105"
                    style={{ background:'var(--bg-card)', boxShadow:'var(--shadow-card)', border:'1px solid var(--border-card)' }}>
                    <I className={clsx('h-4 w-4 sm:h-5 sm:w-5', item.color)} />
                  </div>

                  <div className="min-w-0 w-full">
                    <p className="text-[11px] sm:text-xs font-semibold text-page-primary leading-tight truncate">
                      {item.name}
                    </p>
                    {item.subtitle && (
                      <p className="hidden sm:block text-[9px] sm:text-[10px] text-page-muted truncate mt-0.5">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <div className="rounded-2xl p-4 sm:p-5 flex flex-col"
          style={{ background:'var(--bg-card)', border:'1px solid var(--border-card)', boxShadow:'var(--shadow-card)' }}>

          <div className="flex items-center justify-between mb-4 shrink-0">
            <h2 className="text-sm font-bold text-page-primary">Recent Activity</h2>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-mint-500">
              <span className="h-1.5 w-1.5 rounded-full bg-mint-500 animate-pulse" />
              Live
            </span>
          </div>

          <div className="flex-1 space-y-1 overflow-y-auto">
            {notifications.map((n) => {
              const I = n.icon;
              const inner = (
                <div className="group flex items-start gap-2.5 rounded-xl px-2 py-2.5 transition-colors cursor-pointer"
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = 'var(--mint-alpha)')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = 'transparent')}>
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg mt-0.5"
                    style={{ background:'var(--bg-page)' }}>
                    <I className={clsx('h-3.5 w-3.5', n.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-page-primary leading-snug line-clamp-2">{n.title}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <CalendarClock className="h-2.5 w-2.5 text-page-muted" />
                      <span className="text-[10px] text-page-muted">{n.time}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-page-muted shrink-0 opacity-0 group-hover:opacity-100 mt-1 transition-opacity" />
                </div>
              );
              return n.href
                ? <Link key={n.id} to={n.href}>{inner}</Link>
                : <div key={n.id}>{inner}</div>;
            })}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 shrink-0" style={{ borderTop:'1px solid var(--border-card)' }}>
            <div className="flex items-center gap-1.5 text-[10px] text-page-muted mb-1">
              <Phone className="h-3 w-3 shrink-0" />
              <span>Support: <span className="font-semibold text-page-secondary">0256251295</span></span>
            </div>
            <p className="text-[10px] text-page-muted">{APP_NAME} · Powered by POPMYC</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
