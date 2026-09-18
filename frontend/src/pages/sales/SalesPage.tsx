import { useState, useMemo } from 'react';
import {
  Receipt,
  Search,
  TrendingUp,
  ShoppingBag,
  Banknote,
  CreditCard,
  Wallet,
  Building2,
  CheckSquare,
  ChevronRight,
  X,
  ArrowUpRight,
  Clock,
  User,
  Package,
  CalendarDays,
  CheckCircle,
  XCircle,
  AlertCircle,
  RotateCcw,
  FileText,
  Mail,
  Send,
  Check,
  AlertTriangle,
  Calendar,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency, formatDate } from '@/utils/format';
import { useSalesStore, type SaleRecord, type SaleStatus, type PaymentStatus } from '@/stores/sales.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';

// ── Status config ─────────────────────────────────────────────────────────────
const statusConfig: Record<SaleStatus, { label: string; color: string; icon: typeof CheckCircle }> = {
  COMPLETED:     { label: 'Completed',     color: 'bg-emerald-50 text-emerald-600 border border-emerald-200', icon: CheckCircle  },
  VOIDED:        { label: 'Voided',        color: 'bg-red-50 text-red-600 border border-red-200',             icon: XCircle      },
  REFUNDED:      { label: 'Refunded',      color: 'bg-purple-50 text-purple-600 border border-purple-200',    icon: RotateCcw    },
  PARTIAL_REFUND:{ label: 'Partial Refund',color: 'bg-amber-50 text-amber-700 border border-amber-200',       icon: AlertCircle  },
  DRAFT:         { label: 'Draft',         color: 'bg-muted-100 text-muted-600',                               icon: FileText     },
  HELD:          { label: 'Held',          color: 'bg-sky-50 text-sky-600 border border-sky-200',             icon: Clock        },
};

// ── Payment status config ─────────────────────────────────────────────────────
const paymentStatusConfig: Record<PaymentStatus, { label: string; color: string }> = {
  PAID:    { label: 'Paid',    color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  PARTIAL: { label: 'Partial', color: 'bg-amber-50 text-amber-700 border border-amber-200'       },
  CREDIT:  { label: 'Owed',    color: 'bg-rose-50 text-rose-700 border border-rose-200'          },
  UNPAID:  { label: 'Unpaid',  color: 'bg-rose-50 text-rose-700 border border-rose-200'          },
  OVERPAID:{ label: 'Overpaid',color: 'bg-blue-50 text-blue-700 border border-blue-200'          },
};

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  CASH: Banknote,
  MOBILE_MONEY: Wallet,
  CARD: CreditCard,
  BANK_TRANSFER: Building2,
  CHEQUE: CheckSquare,
  CREDIT: CreditCard,
};

const STATUS_FILTERS = [
  { value: 'all',        label: 'All Sales'     },
  { value: 'COMPLETED',  label: 'Completed'     },
  { value: 'VOIDED',     label: 'Voided'        },
  { value: 'REFUNDED',   label: 'Refunded'      },
];

type PeriodFilter = 'all' | 'today' | 'week' | 'month' | 'year';
const PERIOD_FILTERS: { value: PeriodFilter; label: string }[] = [
  { value: 'all',   label: 'All Time' },
  { value: 'today', label: 'Today'    },
  { value: 'week',  label: 'This Week'},
  { value: 'month', label: 'This Month'},
  { value: 'year',  label: 'This Year'},
];

// ─────────────────────────────────────────────────────────────────────────────

function getPeriodStart(period: PeriodFilter): string | null {
  const now = new Date();
  if (period === 'today') return now.toISOString().slice(0, 10);
  if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - d.getDay()); // Sunday
    return d.toISOString().slice(0, 10);
  }
  if (period === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  if (period === 'year')  return `${now.getFullYear()}-01-01`;
  return null;
}

export default function SalesPage() {
  const [searchTerm,    setSearchTerm]    = useState('');
  const [statusFilter,  setStatusFilter]  = useState('all');
  const [periodFilter,  setPeriodFilter]  = useState<PeriodFilter>('all');
  const [selectedSale,  setSelectedSale]  = useState<SaleRecord | null>(null);
  const [detailOpen,    setDetailOpen]    = useState(false);
  const [emailSale,     setEmailSale]     = useState<SaleRecord | null>(null);
  const [emailTo,       setEmailTo]       = useState('');
  const [emailStatus,   setEmailStatus]   = useState<'idle' | 'sending' | 'sent'>('idle');

  const sales       = useSalesStore((s) => s.sales);
  const ownerEmail  = useSettingsStore((s) => s.emailNotifications.ownerEmail);
  const businessName = useSettingsStore((s) => s.business.name);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchSales = filterByBranch(sales);

  // ── Period-filtered sales ──────────────────────────────────────────────────
  const periodFilteredSales = useMemo(() => {
    const start = getPeriodStart(periodFilter);
    if (!start) return branchSales;
    if (periodFilter === 'today') return branchSales.filter((s) => s.createdAt.slice(0, 10) === start);
    return branchSales.filter((s) => s.createdAt.slice(0, 10) >= start);
  }, [branchSales, periodFilter, effectiveBranchId]);

  // ── Stats (based on period) ───────────────────────────────────────────────
  const stats = useMemo(() => {
    const completed  = periodFilteredSales.filter((s) => s.status === 'COMPLETED');
    const totalRevenue = completed.reduce((sum, s) => sum + s.totalAmount, 0);
    const totalTransactions = completed.length;
    const avgOrder   = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const todayStr   = new Date().toISOString().slice(0, 10);
    const todaySales = branchSales.filter((s) => s.status === 'COMPLETED' && s.createdAt.slice(0, 10) === todayStr);
    const todayRevenue = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
    return { totalRevenue, totalTransactions, avgOrder, todayRevenue, todayCount: todaySales.length };
  }, [periodFilteredSales, branchSales]);

  // ── Filtered + searched ───────────────────────────────────────────────────
  const filteredSales = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return periodFilteredSales.filter((s) => {
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
      const matchesSearch = searchTerm === '' ||
        s.reference.toLowerCase().includes(term) ||
        s.invoiceNumber.toLowerCase().includes(term) ||
        s.customerName.toLowerCase().includes(term) ||
        s.cashierName.toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [periodFilteredSales, statusFilter, searchTerm]);

  function openDetail(sale: SaleRecord) { setSelectedSale(sale); setDetailOpen(true); }
  function closeDetail() { setDetailOpen(false); setSelectedSale(null); }

  function openEmailModal(sale: SaleRecord) { setEmailSale(sale); setEmailTo(ownerEmail); setEmailStatus('idle'); }
  function handleSendEmail() {
    if (!emailTo.trim() || !emailSale) return;
    setEmailStatus('sending');
    setTimeout(() => setEmailStatus('sent'), 1200);
  }
  function closeEmailModal() { setEmailSale(null); setEmailStatus('idle'); setEmailTo(''); }

  function buildSaleEmailBody(sale: SaleRecord): string {
    const sep = '─'.repeat(44);
    const lines = [
      businessName,
      `Sale Receipt — ${sale.invoiceNumber}`,
      `Date: ${formatDate(sale.createdAt, 'DD MMMM YYYY at HH:mm')}`,
      sep,
      `Customer : ${sale.customerName}`,
      `Cashier  : ${sale.cashierName}`,
      `Status   : ${sale.status}`,
      sep, 'ITEMS',
      ...sale.items.map((item) => `  ${item.name.padEnd(24)} x${item.quantity}  ${formatCurrency(item.subtotal)}`),
      sep,
      `Subtotal : ${formatCurrency(sale.subtotal)}`,
      ...(sale.taxAmount > 0      ? [`Tax      : ${formatCurrency(sale.taxAmount)}`]            : []),
      ...(sale.discountAmount > 0  ? [`Discount : -${formatCurrency(sale.discountAmount)}`]     : []),
      `TOTAL    : ${formatCurrency(sale.totalAmount)}`,
      sep,
      `Payment  : ${sale.paymentMethod.replace('_', ' ')}`,
      `Paid     : ${formatCurrency(sale.amountPaid)}`,
      ...(sale.changeAmount > 0   ? [`Change   : ${formatCurrency(sale.changeAmount)}`]          : []),
      '', 'Sent from your POS system.',
    ];
    return lines.join('\n');
  }

  function PaymentIcon({ method }: { method: string }) {
    const Icon = PAYMENT_ICONS[method] ?? Banknote;
    return <Icon className="h-4 w-4" />;
  }

  function StatusBadge({ status }: { status: SaleStatus }) {
    const cfg = statusConfig[status] ?? statusConfig.COMPLETED;
    const Icon = cfg.icon;
    return (
      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', cfg.color)}>
        <Icon className="h-3 w-3" />{cfg.label}
      </span>
    );
  }

  function PaymentBadge({ paymentStatus, amountOwed }: { paymentStatus: PaymentStatus; amountOwed: number }) {
    const cfg = paymentStatusConfig[paymentStatus] ?? paymentStatusConfig.PAID;
    return (
      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', cfg.color)}>
        {cfg.label}
        {amountOwed > 0 && (
          <span className="ml-0.5 font-bold">· {formatCurrency(amountOwed)}</span>
        )}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Sales</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — sales history</>
              : 'All branches — sales history'}
          </p>
          <p className="text-sm text-muted-500 mt-0.5">Track transactions, revenue, and payment history</p>
        </div>
      </div>

      {/* Period filter tabs */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
        <Calendar className="h-4 w-4 text-muted-400 shrink-0" />
        {PERIOD_FILTERS.map((f) => (
          <button key={f.value} onClick={() => setPeriodFilter(f.value)}
            className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
              periodFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
            {f.label}
          </button>
        ))}
        {periodFilter !== 'all' && (
          <span className="text-xs text-muted-400 ml-1 shrink-0">
            {filteredSales.length} sale{filteredSales.length !== 1 ? 's' : ''} found
          </span>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Today's Revenue",  value: formatCurrency(stats.todayRevenue),      sub: `${stats.todayCount} txns today`,       icon: TrendingUp,  color: 'bg-blue-50 text-blue-600',    ring: 'ring-blue-100'    },
          { label: periodFilter === 'all' ? 'Total Revenue' : `${PERIOD_FILTERS.find(f=>f.value===periodFilter)?.label} Revenue`,
                                       value: formatCurrency(stats.totalRevenue),      sub: 'Completed sales',                       icon: ArrowUpRight, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Transactions',     value: stats.totalTransactions.toString(),      sub: `${periodFilter === 'all' ? 'All' : PERIOD_FILTERS.find(f=>f.value===periodFilter)?.label} completed`, icon: ShoppingBag, color: 'bg-purple-50 text-purple-600', ring: 'ring-purple-100' },
          { label: 'Avg. Order',       value: formatCurrency(stats.avgOrder),          sub: 'Per transaction',                       icon: Banknote,    color: 'bg-amber-50 text-amber-600',  ring: 'ring-amber-100'   },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-500 truncate">{stat.label}</p>
                  <p className="text-xl sm:text-2xl font-bold text-[#1E293B] mt-1 truncate">{stat.value}</p>
                  <p className="text-[11px] text-muted-400 mt-0.5 truncate">{stat.sub}</p>
                </div>
                <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4', stat.color, stat.ring)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Search + Status Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search by reference, customer, cashier..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {STATUS_FILTERS.map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                statusFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Reference</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Customer</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Items</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3">Total</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Payment</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Status</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filteredSales.map((sale) => (
                <tr key={sale.id} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
                  onClick={() => openDetail(sale)}>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-[#1E293B] text-sm">{sale.invoiceNumber}</span>
                      <span className="text-[11px] text-muted-400 font-mono">{sale.reference}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-100">
                        <User className="h-3.5 w-3.5 text-muted-500" />
                      </div>
                      <span className="text-sm text-[#1E293B]">{sale.customerName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-600">
                      <Package className="h-3 w-3" />{sale.totalQty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-bold text-[#1E293B]">{formatCurrency(sale.totalAmount)}</span>
                  </td>
                  <td className="px-4 py-3 text-center hidden md:table-cell">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted-50 px-2.5 py-1 text-[11px] font-medium text-muted-600">
                      <PaymentIcon method={sale.paymentMethod} />
                      {sale.paymentMethod.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <StatusBadge status={sale.status} />
                      <PaymentBadge paymentStatus={sale.paymentStatus} amountOwed={sale.amountOwed ?? 0} />
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-xs text-muted-400">
                      <CalendarDays className="h-3 w-3" />
                      {formatDate(sale.createdAt, 'DD MMM YYYY')}
                      <span className="text-muted-300 ml-1">{formatDate(sale.createdAt, 'HH:mm')}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center"><ChevronRight className="h-4 w-4 text-muted-300" /></td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-400">
                  <Receipt className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No sales found</p>
                  <p className="text-xs mt-1">Try adjusting your period, status, or search filters</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sale Detail Slide-over */}
      {detailOpen && selectedSale && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={closeDetail} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100 shrink-0">
              <div>
                <h2 className="text-base font-bold text-[#1E293B]">Sale Details</h2>
                <p className="text-xs text-muted-400 font-mono">{selectedSale.reference}</p>
              </div>
              <button onClick={closeDetail} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <div className="flex items-center gap-3 flex-wrap">
                <StatusBadge status={selectedSale.status} />
                <PaymentBadge paymentStatus={selectedSale.paymentStatus} amountOwed={selectedSale.amountOwed ?? 0} />
                <span className="text-xs text-muted-400">{selectedSale.invoiceNumber}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#F8FAFC] rounded-xl p-3 border border-muted-100">
                  <p className="text-[10px] font-medium text-muted-400 uppercase tracking-wider">Customer</p>
                  <p className="text-sm font-semibold text-[#1E293B] mt-0.5">{selectedSale.customerName}</p>
                </div>
                <div className="bg-[#F8FAFC] rounded-xl p-3 border border-muted-100">
                  <p className="text-[10px] font-medium text-muted-400 uppercase tracking-wider">Cashier</p>
                  <p className="text-sm font-semibold text-[#1E293B] mt-0.5">{selectedSale.cashierName}</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider mb-2">Items ({selectedSale.items.length})</p>
                <div className="space-y-2">
                  {selectedSale.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted-50 border border-muted-100">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#1E293B] truncate">{item.name}</p>
                        <p className="text-xs text-muted-400">{item.sku} · {formatCurrency(item.price)} each</p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-bold text-[#1E293B]">{formatCurrency(item.subtotal)}</p>
                        <p className="text-[11px] text-muted-400">x{item.quantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-500">Subtotal</span><span className="font-medium">{formatCurrency(selectedSale.subtotal)}</span></div>
                {selectedSale.taxAmount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-500">Tax</span><span className="font-medium">{formatCurrency(selectedSale.taxAmount)}</span></div>}
                {selectedSale.discountAmount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-500">Discount</span><span className="font-medium text-emerald-600">-{formatCurrency(selectedSale.discountAmount)}</span></div>}
                <div className="border-t border-muted-200 pt-2">
                  <div className="flex justify-between"><span className="text-sm font-semibold text-[#1E293B]">Total</span><span className="text-lg font-bold text-[#1E293B]">{formatCurrency(selectedSale.totalAmount)}</span></div>
                </div>
              </div>
              <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100 space-y-2">
                <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider mb-2">Payment</p>
                <div className="flex justify-between text-sm"><span className="text-muted-500">Method</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-[#1E293B]"><PaymentIcon method={selectedSale.paymentMethod} />{selectedSale.paymentMethod.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-500">Amount Paid</span><span className="font-semibold">{formatCurrency(selectedSale.amountPaid)}</span></div>
                {selectedSale.changeAmount > 0 && <div className="flex justify-between text-sm"><span className="text-muted-500">Change</span><span className="font-semibold text-emerald-600">{formatCurrency(selectedSale.changeAmount)}</span></div>}
                {(selectedSale.amountOwed ?? 0) > 0 && (
                  <div className="flex justify-between text-sm pt-2 mt-1 border-t border-dashed border-rose-200">
                    <span className="font-bold text-rose-700">Balance Owed</span>
                    <span className="font-bold text-rose-700 text-base">{formatCurrency(selectedSale.amountOwed!)}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-400">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(selectedSale.createdAt, 'DD MMMM YYYY at HH:mm')}
              </div>
              {selectedSale.notes && (
                <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                  <p className="text-xs font-medium text-amber-700">Notes</p>
                  <p className="text-sm text-amber-800 mt-0.5">{selectedSale.notes}</p>
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-muted-100 shrink-0">
              <button onClick={() => openEmailModal(selectedSale)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">
                <Mail className="h-4 w-4" /> Send Receipt by Email
              </button>
            </div>
          </div>
        </>
      )}

      {/* Email Modal */}
      {emailSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 shrink-0"><Mail className="h-4 w-4 text-blue-600" /></div>
                <div><h2 className="text-base font-bold text-[#1E293B]">Send Receipt by Email</h2><p className="text-xs text-muted-400 mt-0.5">{emailSale.invoiceNumber}</p></div>
              </div>
              <button onClick={closeEmailModal} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5 text-muted-400" /></button>
            </div>
            {emailStatus === 'sent' ? (
              <div className="px-5 py-10 flex flex-col items-center text-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"><Check className="h-7 w-7 text-emerald-600" /></div>
                <h3 className="text-base font-bold text-[#1E293B]">Receipt Sent!</h3>
                <p className="text-sm text-muted-500">Queued for delivery to <strong>{emailTo}</strong>.</p>
                <button onClick={closeEmailModal} className="mt-4 rounded-xl bg-[#1E293B] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#334155]">Done</button>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {!ownerEmail && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">No owner email configured. Go to <strong>Settings → Email &amp; Reports</strong>.</p>
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Send To *</label>
                  <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="owner@yourbusiness.com"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Receipt Preview</label>
                  <textarea readOnly value={buildSaleEmailBody(emailSale)} rows={12}
                    className="w-full px-3 py-2.5 rounded-xl bg-muted-50 border border-muted-200 text-xs font-mono text-muted-600 resize-none focus:outline-none" />
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={closeEmailModal} className="rounded-xl border border-muted-200 px-5 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">Cancel</button>
                  <button onClick={handleSendEmail} disabled={emailStatus === 'sending' || !emailTo.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-50">
                    {emailStatus === 'sending'
                      ? <><span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" /> Sending…</>
                      : <><Send className="h-4 w-4" /> Send</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
