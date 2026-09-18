import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  ShoppingCart,
  Package,
  Users,
  DollarSign,
  CalendarDays,
  ArrowUpRight,
  Banknote,
  CreditCard,
  Receipt,
  Activity,
  Mail,
  X,
  Send,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  User,
  Wallet,
  Building2,
  CheckSquare,
  TrendingDown,
  Loader2,
  ShieldAlert,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency, formatDate } from '@/utils/format';
import { useSalesStore, type SaleRecord } from '@/stores/sales.store';
import { useExpenseStore }                from '@/stores/expense.store';
import { useCustomerStore }               from '@/stores/customer.store';
import { useSettingsStore }               from '@/stores/settings.store';
import { useBranchStore }                 from '@/stores/branch.store';
import { useBranchFilter }                from '@/hooks/useBranchFilter';
import * as reportsService                from '@/services/reports.service';
import type { PLReport }                  from '@/services/reports.service';

type ReportType = 'sales' | 'products' | 'customers' | 'payments' | 'profit';

const reportTabs: { id: ReportType; label: string; icon: typeof BarChart3 }[] = [
  { id: 'profit',    label: 'Profit & Loss',   icon: TrendingUp  },
  { id: 'sales',     label: 'Sales Summary',   icon: TrendingUp  },
  { id: 'products',  label: 'Top Products',    icon: Package     },
  { id: 'customers', label: 'Top Customers',   icon: Users      },
  { id: 'payments',  label: 'Payment Methods', icon: CreditCard },
];

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  CASH: Banknote,
  MOBILE_MONEY: Wallet,
  CARD: CreditCard,
  BANK_TRANSFER: Building2,
  CHEQUE: CheckSquare,
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED:     'bg-emerald-50 text-emerald-700 border border-emerald-200',
  VOIDED:        'bg-rose-50 text-rose-600 border border-rose-200',
  REFUNDED:      'bg-purple-50 text-purple-600 border border-purple-200',
  PARTIAL_REFUND:'bg-amber-50 text-amber-700 border border-amber-200',
  DRAFT:         'bg-muted-100 text-muted-600',
  HELD:          'bg-sky-50 text-sky-600 border border-sky-200',
};

// ─── Email Send Modal ──────────────────────────────────────────────────────────
interface SendEmailModalProps {
  onClose: () => void;
  defaultSubject: string;
  bodyLines: string[];
  configuredEmail: string;
}

function SendEmailModal({ onClose, defaultSubject, bodyLines, configuredEmail }: SendEmailModalProps) {
  const [toEmail,  setToEmail]  = useState(configuredEmail);
  const [subject,  setSubject]  = useState(defaultSubject);
  const [status,   setStatus]   = useState<'idle' | 'sending' | 'sent'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function handleSend() {
    if (!toEmail.trim()) { setErrorMsg('Please enter a recipient email.'); return; }
    setErrorMsg('');
    setStatus('sending');
    setTimeout(() => setStatus('sent'), 1200);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 shrink-0">
              <Mail className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1E293B]">Send Report by Email</h2>
              <p className="text-xs text-muted-400 mt-0.5">
                {configuredEmail ? 'Default recipient from Settings' : 'Configure owner email in Settings → Email & Reports'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted-100 transition-colors">
            <X className="h-5 w-5 text-muted-400" />
          </button>
        </div>

        {status === 'sent' ? (
          <div className="px-5 py-10 flex flex-col items-center text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Check className="h-7 w-7 text-emerald-600" />
            </div>
            <h3 className="text-base font-bold text-[#1E293B]">Report Sent!</h3>
            <p className="text-sm text-muted-500">Queued for delivery to <strong className="text-[#1E293B]">{toEmail}</strong>.</p>
            <p className="text-xs text-muted-400 mt-1">Actual delivery requires SMTP setup in Settings → Email &amp; Reports.</p>
            <button onClick={onClose} className="mt-4 rounded-xl bg-[#1E293B] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">Done</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {!configuredEmail && (
              <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">No owner email configured. Go to <strong>Settings → Email &amp; Reports</strong>.</p>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">To *</label>
              <input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)}
                placeholder="owner@yourbusiness.com"
                className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Subject</label>
              <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Report Preview</label>
              <textarea readOnly value={bodyLines.join('\n')} rows={10}
                className="w-full px-3 py-2.5 rounded-xl bg-muted-50 border border-muted-200 text-xs font-mono text-muted-600 resize-none focus:outline-none" />
            </div>
            {errorMsg && <p className="text-xs text-rose-600 font-medium">{errorMsg}</p>}
            <div className="flex justify-end gap-3 pt-1">
              <button onClick={onClose} className="rounded-xl border border-muted-200 px-5 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">Cancel</button>
              <button onClick={handleSend} disabled={status === 'sending'}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-50">
                {status === 'sending'
                  ? <><span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" /> Sending…</>
                  : <><Send className="h-4 w-4" /> Send Report</>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Day detail slide-over ──────────────────────────────────────────────────
interface DayDetailPanelProps {
  date: string;
  sales: SaleRecord[];
  onClose: () => void;
}

function DayDetailPanel({ date, sales, onClose }: DayDetailPanelProps) {
  const dayLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const totalRevenue = sales.reduce((s, x) => s + x.totalAmount, 0);
  const totalItems   = sales.reduce((s, x) => s + x.totalQty, 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1E293B] truncate">{dayLabel}</h2>
            <p className="text-xs text-muted-400 mt-0.5">
              {sales.length} transaction{sales.length !== 1 ? 's' : ''} · {totalItems} items · {formatCurrency(totalRevenue)}
            </p>
          </div>
          <button onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100 transition-colors shrink-0 ml-3">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-3 gap-px bg-muted-100 border-b border-muted-100 shrink-0">
          {[
            { label: 'Revenue',      value: formatCurrency(totalRevenue) },
            { label: 'Transactions', value: String(sales.length)         },
            { label: 'Items Sold',   value: String(totalItems)           },
          ].map((s) => (
            <div key={s.label} className="bg-white px-4 py-3 text-center">
              <p className="text-[11px] font-medium text-muted-400">{s.label}</p>
              <p className="text-sm font-bold text-[#1E293B] mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Sale list */}
        <div className="flex-1 overflow-y-auto divide-y divide-muted-50">
          {sales.map((sale) => {
            const PayIcon = PAYMENT_ICONS[sale.paymentMethod] ?? Banknote;
            const statusColor = STATUS_COLORS[sale.status] ?? STATUS_COLORS.COMPLETED;
            return (
              <div key={sale.id} className="px-5 py-4 space-y-3">
                {/* Sale header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#1E293B]">{sale.invoiceNumber}</span>
                      <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', statusColor)}>
                        {sale.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-400 font-mono mt-0.5">{sale.reference}</p>
                  </div>
                  <p className="text-sm font-bold text-[#1E293B] shrink-0">{formatCurrency(sale.totalAmount)}</p>
                </div>

                {/* Customer / cashier / time */}
                <div className="flex items-center gap-4 text-xs text-muted-500 flex-wrap">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />{sale.customerName}
                  </span>
                  <span className="flex items-center gap-1">
                    <PayIcon className="h-3 w-3" />{sale.paymentMethod.replace('_', ' ')}
                  </span>
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />{formatDate(sale.createdAt, 'HH:mm')}
                  </span>
                </div>

                {/* Line items */}
                <div className="bg-muted-50 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-muted-100">
                        <th className="text-left font-semibold text-muted-500 px-3 py-2">Product</th>
                        <th className="text-center font-semibold text-muted-500 px-3 py-2 w-10">Qty</th>
                        <th className="text-right font-semibold text-muted-500 px-3 py-2">Price</th>
                        <th className="text-right font-semibold text-muted-500 px-3 py-2">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sale.items.map((item) => (
                        <tr key={item.id} className="border-b border-muted-100 last:border-0">
                          <td className="px-3 py-2">
                            <p className="font-medium text-[#1E293B] truncate max-w-[160px]">{item.name}</p>
                            <p className="text-[10px] text-muted-400 font-mono">{item.sku}</p>
                          </td>
                          <td className="px-3 py-2 text-center text-muted-600">{item.quantity}</td>
                          <td className="px-3 py-2 text-right text-muted-600">{formatCurrency(item.price)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-[#1E293B]">{formatCurrency(item.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Totals */}
                  <div className="px-3 py-2.5 border-t border-muted-200 space-y-1 bg-white/60">
                    {sale.taxAmount > 0 && (
                      <div className="flex justify-between text-[11px] text-muted-500">
                        <span>Tax</span><span>{formatCurrency(sale.taxAmount)}</span>
                      </div>
                    )}
                    {sale.discountAmount > 0 && (
                      <div className="flex justify-between text-[11px] text-muted-500">
                        <span>Discount</span><span className="text-emerald-600">-{formatCurrency(sale.discountAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs font-bold text-[#1E293B] pt-0.5 border-t border-muted-100">
                      <span>Total</span><span>{formatCurrency(sale.totalAmount)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-500">
                      <span>Paid</span>
                      <span>{formatCurrency(sale.amountPaid)}</span>
                    </div>
                    {sale.changeAmount > 0 && (
                      <div className="flex justify-between text-[11px] text-muted-500">
                        <span>Change</span><span className="text-emerald-600">{formatCurrency(sale.changeAmount)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {sale.notes && (
                  <p className="text-[11px] text-muted-500 italic px-1">Note: {sale.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [activeReport,   setActiveReport]   = useState<ReportType>('profit');
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [selectedDay,    setSelectedDay]    = useState<string | null>(null);

  // ── P&L state ──────────────────────────────────────────────────────────────
  const [plPeriod,   setPlPeriod]   = useState('this_month');
  const [plDateFrom, setPlDateFrom] = useState('');
  const [plDateTo,   setPlDateTo]   = useState('');
  const [plData,     setPlData]     = useState<PLReport | null>(null);
  const [plLoading,  setPlLoading]  = useState(false);
  const [plError,    setPlError]    = useState('');

  const sales        = useSalesStore((s) => s.sales);
  const allExpenses  = useExpenseStore((s) => s.expenses);
  const customers    = useCustomerStore((s) => s.customers);
  const ownerEmail   = useSettingsStore((s) => s.emailNotifications.ownerEmail);
  const businessName = useSettingsStore((s) => s.business.name);
  const activeBranchId = useBranchStore((s) => s.activeBranchId);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchSales     = filterByBranch(sales);
  const branchCustomers = filterByBranch(customers);

  // ── Fetch P&L from API or compute locally ─────────────────────────────────
  const isLocalSession = (() => {
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
  })();

  const fetchPL = useCallback(async () => {
    setPlError('');
    if (isLocalSession) {
      // Offline / demo mode — compute locally from Zustand stores
      const dateFrom = plPeriod === 'custom' ? plDateFrom : undefined;
      const dateTo   = plPeriod === 'custom' ? plDateTo   : undefined;
      // Quick date resolution for non-custom presets
      const today    = new Date();
      let fromStr = dateFrom;
      let toStr   = dateTo;
      if (plPeriod !== 'custom') {
        const t = today;
        if (plPeriod === 'today')       { fromStr = toStr = t.toISOString().slice(0, 10); }
        else if (plPeriod === 'yesterday') {
          const y = new Date(t); y.setDate(y.getDate() - 1);
          fromStr = toStr = y.toISOString().slice(0, 10);
        } else if (plPeriod === 'this_week') {
          const mon = new Date(t); mon.setDate(t.getDate() - t.getDay() + 1);
          fromStr = mon.toISOString().slice(0, 10);
          toStr   = t.toISOString().slice(0, 10);
        } else if (plPeriod === 'this_month') {
          fromStr = new Date(t.getFullYear(), t.getMonth(), 1).toISOString().slice(0, 10);
          toStr   = t.toISOString().slice(0, 10);
        } else if (plPeriod === 'last_month') {
          const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1);
          fromStr  = lm.toISOString().slice(0, 10);
          toStr    = new Date(t.getFullYear(), t.getMonth(), 0).toISOString().slice(0, 10);
        } else if (plPeriod === 'this_year') {
          fromStr = new Date(t.getFullYear(), 0, 1).toISOString().slice(0, 10);
          toStr   = t.toISOString().slice(0, 10);
        }
      }
      const local = reportsService.buildLocalPL(
        sales.map((s) => ({ status: s.status, totalAmount: s.totalAmount, discountAmount: s.discountAmount, taxAmount: s.taxAmount, createdAt: s.createdAt, branchId: s.branchId ?? null })),
        allExpenses.map((e) => ({ status: e.status, totalAmount: e.totalAmount, expenseDate: e.expenseDate, branchId: e.branchId ?? null })),
        fromStr, toStr, activeBranchId ?? undefined,
      );
      setPlData(local);
      return;
    }
    setPlLoading(true);
    try {
      const params: Record<string, string> = { period: plPeriod };
      if (plPeriod === 'custom') {
        if (plDateFrom) params.date_from = plDateFrom;
        if (plDateTo)   params.date_to   = plDateTo;
      }
      if (activeBranchId) params.branch = activeBranchId;
      const data = await reportsService.fetchPLReport(params);
      setPlData(data);
    } catch {
      setPlError('Could not load P&L from server. Showing local estimate.');
      // Fallback to local
      const local = reportsService.buildLocalPL(
        sales.map((s) => ({ status: s.status, totalAmount: s.totalAmount, discountAmount: s.discountAmount, taxAmount: s.taxAmount, createdAt: s.createdAt, branchId: s.branchId ?? null })),
        allExpenses.map((e) => ({ status: e.status, totalAmount: e.totalAmount, expenseDate: e.expenseDate, branchId: e.branchId ?? null })),
        undefined, undefined, activeBranchId ?? undefined,
      );
      setPlData(local);
    } finally {
      setPlLoading(false);
    }
  }, [plPeriod, plDateFrom, plDateTo, activeBranchId, isLocalSession, sales, allExpenses]);

  // Fetch P&L whenever the tab becomes active or period/branch changes
  useEffect(() => {
    if (activeReport === 'profit') void fetchPL();
  }, [activeReport, fetchPL]);

  const completedSales = useMemo(
    () => branchSales.filter((s) => s.status === 'COMPLETED'),
    [branchSales, effectiveBranchId]
  );

  // --- Sales grouped by day ---
  const salesByDay = useMemo(() => {
    const map = new Map<string, SaleRecord[]>();
    branchSales.forEach((sale) => {
      const date = sale.createdAt.slice(0, 10);
      const arr = map.get(date);
      if (arr) arr.push(sale);
      else map.set(date, [sale]);
    });
    return map;
  }, [branchSales, effectiveBranchId]);

  // --- Sales Summary (daily) — totals from completed only ---
  const dailySales = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; transactions: number; items: number }>();
    completedSales.forEach((sale) => {
      const date = sale.createdAt.slice(0, 10);
      const existing = map.get(date);
      if (existing) {
        existing.revenue      += sale.totalAmount;
        existing.transactions += 1;
        existing.items        += sale.totalQty;
      } else {
        map.set(date, { date, revenue: sale.totalAmount, transactions: 1, items: sale.totalQty });
      }
    });
    // Merge in dates that only have non-completed sales so they still appear
    salesByDay.forEach((_, date) => {
      if (!map.has(date)) map.set(date, { date, revenue: 0, transactions: 0, items: 0 });
    });
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [completedSales, salesByDay, effectiveBranchId]);

  // --- Top Products ---
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; sku: string; qty: number; revenue: number }>();
    completedSales.forEach((sale) => {
      sale.items.forEach((item) => {
        const existing = map.get(item.productId);
        if (existing) { existing.qty += item.quantity; existing.revenue += item.subtotal; }
        else map.set(item.productId, { name: item.name, sku: item.sku, qty: item.quantity, revenue: item.subtotal });
      });
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [completedSales, effectiveBranchId]);

  // --- Payment Method Breakdown ---
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { method: string; count: number; total: number }>();
    completedSales.forEach((sale) => {
      const existing = map.get(sale.paymentMethod);
      if (existing) { existing.count += 1; existing.total += sale.totalAmount; }
      else map.set(sale.paymentMethod, { method: sale.paymentMethod, count: 1, total: sale.totalAmount });
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [completedSales, effectiveBranchId]);

  // --- Overall Stats ---
  const overallStats = useMemo(() => {
    const totalRevenue      = completedSales.reduce((s, sale) => s + sale.totalAmount, 0);
    const totalTransactions = completedSales.length;
    const avgOrder          = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const totalItems        = completedSales.reduce((s, sale) => s + sale.totalQty, 0);
    return { totalRevenue, totalTransactions, avgOrder, totalItems };
  }, [completedSales, effectiveBranchId]);

  const totalPaymentSum = paymentBreakdown.reduce((s, p) => s + p.total, 0);

  // --- Email content ---
  const emailSubject = useMemo(() => {
    const today    = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const tabLabel = reportTabs.find((t) => t.id === activeReport)?.label ?? 'Report';
    return `${businessName} — ${tabLabel} · ${today}`;
  }, [activeReport, businessName]);

  const emailBody = useMemo(() => {
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const sep   = '─'.repeat(48);
    const lines: string[] = [`${businessName}`, `Report: ${reportTabs.find((t) => t.id === activeReport)?.label}`, `Generated: ${today}`, sep, ''];

    if (activeReport === 'sales') {
      lines.push('OVERALL SUMMARY');
      lines.push(`  Total Revenue    : ${formatCurrency(overallStats.totalRevenue)}`);
      lines.push(`  Transactions     : ${overallStats.totalTransactions}`);
      lines.push(`  Average Order    : ${formatCurrency(overallStats.avgOrder)}`);
      lines.push(`  Items Sold       : ${overallStats.totalItems}`);
      lines.push('', sep, '', 'DAILY BREAKDOWN');
      dailySales.slice(0, 14).forEach((d) => {
        const label = new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        lines.push(`  ${label.padEnd(16)} | ${String(d.transactions).padStart(3)} txns | ${formatCurrency(d.revenue)}`);
      });
    } else if (activeReport === 'products') {
      lines.push('TOP SELLING PRODUCTS');
      topProducts.slice(0, 15).forEach((p, i) =>
        lines.push(`  ${String(i + 1).padStart(2)}. ${p.name.padEnd(28)} ${String(p.qty).padStart(5)} units  ${formatCurrency(p.revenue)}`)
      );
    } else if (activeReport === 'customers') {
      lines.push('TOP CUSTOMERS BY REVENUE');
      [...branchCustomers].sort((a, b) => b.totalPurchases - a.totalPurchases).slice(0, 15).forEach((c, i) => {
        const name = `${c.firstName} ${c.lastName}${c.company ? ` (${c.company})` : ''}`;
        lines.push(`  ${String(i + 1).padStart(2)}. ${name.padEnd(30)} ${formatCurrency(c.totalPurchases)}`);
      });
    } else if (activeReport === 'payments') {
      lines.push('PAYMENT METHOD BREAKDOWN');
      paymentBreakdown.forEach((pm) => {
        const pct = totalPaymentSum > 0 ? ((pm.total / totalPaymentSum) * 100).toFixed(1) : '0.0';
        lines.push(`  ${pm.method.replace('_', ' ').padEnd(20)} | ${String(pm.count).padStart(4)} txns | ${formatCurrency(pm.total)} (${pct}%)`);
      });
    }
    lines.push('', sep, '', 'This report was generated automatically by your POS system.');
    return lines;
  }, [activeReport, overallStats, dailySales, topProducts, branchCustomers, paymentBreakdown, totalPaymentSum, businessName]);

  const selectedDaySales = selectedDay ? (salesByDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Reports</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — analytics &amp; reports</>
              : 'All branches — analytics & reports'}
          </p>
          <p className="text-sm text-muted-500 mt-0.5">Analytics and business insights</p>
        </div>
        <button onClick={() => setEmailModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
          <Mail className="h-4 w-4" /> Send Report by Email
        </button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Revenue',  value: formatCurrency(overallStats.totalRevenue),    icon: DollarSign,  color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Transactions',   value: overallStats.totalTransactions.toString(),    icon: ShoppingCart, color: 'bg-blue-50 text-blue-600',    ring: 'ring-blue-100'    },
          { label: 'Avg. Order',     value: formatCurrency(overallStats.avgOrder),        icon: ArrowUpRight, color: 'bg-purple-50 text-purple-600', ring: 'ring-purple-100'  },
          { label: 'Items Sold',     value: overallStats.totalItems.toString(),           icon: Package,     color: 'bg-amber-50 text-amber-600',   ring: 'ring-amber-100'   },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-500 truncate">{s.label}</p>
                  <p className="text-xl sm:text-2xl font-bold text-[#1E293B] mt-1 truncate">{s.value}</p>
                </div>
                <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4', s.color, s.ring)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Report Type Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {reportTabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => { setActiveReport(tab.id); setSelectedDay(null); }}
              className={clsx('inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                activeReport === tab.id ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              <Icon className="h-4 w-4" />{tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Profit & Loss ── */}
      {activeReport === 'profit' && (
        <div className="space-y-5">
          {/* Filters */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={plPeriod}
                onChange={(e) => setPlPeriod(e.target.value)}
                className="h-9 rounded-xl border border-muted-200 bg-muted-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="this_year">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
              {plPeriod === 'custom' && (
                <>
                  <input type="date" value={plDateFrom} onChange={(e) => setPlDateFrom(e.target.value)}
                    className="h-9 rounded-xl border border-muted-200 bg-muted-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                  <span className="text-muted-400 text-sm">to</span>
                  <input type="date" value={plDateTo} onChange={(e) => setPlDateTo(e.target.value)}
                    className="h-9 rounded-xl border border-muted-200 bg-muted-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </>
              )}
              <button
                onClick={() => void fetchPL()}
                disabled={plLoading}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E293B] text-white px-4 py-2 text-sm font-semibold hover:bg-[#334155] transition-colors disabled:opacity-50"
              >
                {plLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                {plLoading ? 'Loading…' : 'Apply'}
              </button>
              <span className="ml-auto text-xs text-muted-500 font-medium">
                {activeBranchName !== 'All Branches'
                  ? <><Building2 className="h-3.5 w-3.5 inline mr-1" />{activeBranchName}</>
                  : 'All Branches'}
              </span>
            </div>
          </div>

          {plError && (
            <div className="flex items-center gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-700">{plError}</p>
            </div>
          )}

          {plLoading && !plData && (
            <div className="flex items-center justify-center py-20 gap-3 text-muted-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Calculating P&L…</span>
            </div>
          )}

          {plData && (() => {
            const pl   = plData;
            const isLoss = pl.net_profit < 0;

            return (
              <>
                {/* Summary KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Gross Sales',    value: pl.revenue.gross_sales,  color: 'text-blue-600',    bg: 'bg-blue-50',    icon: ArrowUp     },
                    { label: 'Net Sales',      value: pl.revenue.net_sales,    color: 'text-teal-600',    bg: 'bg-teal-50',    icon: TrendingUp  },
                    { label: 'COGS',           value: pl.cogs,                 color: 'text-orange-600',  bg: 'bg-orange-50',  icon: ArrowDown   },
                    { label: 'Gross Profit',   value: pl.gross_profit,         color: 'text-emerald-600', bg: 'bg-emerald-50', icon: TrendingUp  },
                    { label: 'Expenses',       value: pl.expenses.total,       color: 'text-red-600',     bg: 'bg-red-50',     icon: TrendingDown},
                    { label: 'Net Profit',     value: pl.net_profit,           color: isLoss ? 'text-red-700' : 'text-emerald-700', bg: isLoss ? 'bg-red-50' : 'bg-emerald-50', icon: isLoss ? TrendingDown : TrendingUp },
                  ].map(({ label, value, color, bg, icon: Icon }) => (
                    <div key={label} className="bg-white rounded-2xl border border-muted-100 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
                      <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl mb-2', bg)}>
                        <Icon className={clsx('h-4 w-4', color)} />
                      </div>
                      <p className="text-[11px] text-muted-500 font-medium">{label}</p>
                      <p className={clsx('text-lg font-bold mt-0.5', value < 0 ? 'text-red-600' : color)}>
                        {formatCurrency(Math.abs(value))}{value < 0 ? ' (Loss)' : ''}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Main P&L Statement */}
                <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                  <div className="px-5 py-3 border-b border-muted-100 bg-muted-50/50">
                    <h3 className="text-sm font-bold text-[#1E293B]">Profit & Loss Statement</h3>
                    <p className="text-[11px] text-muted-400 mt-0.5">
                      {pl.period.from && pl.period.to
                        ? `${pl.period.from} to ${pl.period.to}`
                        : 'Selected period'} · {pl.revenue.sale_count} transactions
                    </p>
                  </div>

                  <div className="divide-y divide-muted-50">
                    {/* Revenue section */}
                    <div className="px-5 py-3 bg-blue-50/30">
                      <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-2">Revenue</p>
                      {[
                        { label: 'Gross Sales',         value: pl.revenue.gross_sales,     indent: false, positive: true  },
                        { label: '− Discounts',         value: pl.revenue.total_discounts, indent: true,  positive: false },
                        { label: '− Customer Returns',  value: pl.revenue.total_returns,   indent: true,  positive: false },
                      ].map(({ label, value, indent, positive }) => value > 0 && (
                        <div key={label} className={clsx('flex items-center justify-between py-1', indent && 'pl-4')}>
                          <span className="text-sm text-muted-600">{label}</span>
                          <span className={clsx('text-sm font-semibold', positive ? 'text-[#1E293B]' : 'text-rose-600')}>
                            {positive ? '' : '−'}{formatCurrency(value)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between py-1.5 border-t border-blue-200 mt-1">
                        <span className="text-sm font-bold text-[#1E293B]">Net Sales</span>
                        <span className="text-sm font-bold text-blue-700">{formatCurrency(pl.revenue.net_sales)}</span>
                      </div>
                    </div>

                    {/* COGS */}
                    <div className="px-5 py-3 bg-orange-50/30">
                      <p className="text-[10px] font-bold text-orange-700 uppercase tracking-wider mb-1">Cost of Goods Sold</p>
                      <div className="flex items-center justify-between py-1">
                        <span className="text-sm text-muted-600 pl-4">
                          {pl.cogs === 0 && isLocalSession
                            ? 'COGS (not available offline — requires API)'
                            : 'COGS (from purchase cost snapshots)'}
                        </span>
                        <span className="text-sm font-semibold text-rose-600">−{formatCurrency(pl.cogs)}</span>
                      </div>
                      <div className="flex items-center justify-between py-1.5 border-t border-orange-200 mt-1">
                        <span className="text-sm font-bold text-[#1E293B]">Gross Profit</span>
                        <div className="text-right">
                          <span className="text-sm font-bold text-emerald-700">{formatCurrency(pl.gross_profit)}</span>
                          <span className="ml-2 text-[11px] text-muted-400">({pl.gross_margin_pct}% margin)</span>
                        </div>
                      </div>
                    </div>

                    {/* Operating Expenses */}
                    <div className="px-5 py-3 bg-red-50/20">
                      <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-2">Operating Expenses</p>
                      {pl.expenses.by_category.length > 0
                        ? pl.expenses.by_category.map((cat) => (
                          <div key={cat.category__name} className="flex items-center justify-between py-1 pl-4">
                            <span className="text-sm text-muted-600">{cat.category__name ?? 'Uncategorised'}</span>
                            <span className="text-sm font-semibold text-rose-600">−{formatCurrency(Number(cat.total))}</span>
                          </div>
                        ))
                        : (
                          <div className="flex items-center justify-between py-1 pl-4">
                            <span className="text-sm text-muted-600">Total Expenses</span>
                            <span className="text-sm font-semibold text-rose-600">−{formatCurrency(pl.expenses.total)}</span>
                          </div>
                        )
                      }
                      <div className="flex items-center justify-between py-1.5 border-t border-red-200 mt-1">
                        <span className="text-sm font-bold text-muted-600">Total Expenses</span>
                        <span className="text-sm font-bold text-rose-700">−{formatCurrency(pl.expenses.total)}</span>
                      </div>
                    </div>

                    {/* Net Profit */}
                    <div className={clsx('px-5 py-4', isLoss ? 'bg-red-50' : 'bg-emerald-50')}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className={clsx('text-base font-bold', isLoss ? 'text-red-700' : 'text-emerald-700')}>
                            Net {isLoss ? 'Loss' : 'Profit'}
                          </span>
                          <span className="ml-3 text-xs text-muted-500">({pl.net_margin_pct}% net margin)</span>
                        </div>
                        <span className={clsx('text-xl font-bold', isLoss ? 'text-red-700' : 'text-emerald-700')}>
                          {isLoss ? '−' : '+'}{formatCurrency(Math.abs(pl.net_profit))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* By category breakdown */}
                {pl.by_category.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-muted-100 bg-muted-50/50">
                      <h3 className="text-sm font-bold text-[#1E293B]">Gross Profit by Category</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[520px]">
                        <thead>
                          <tr className="border-b border-muted-100 bg-muted-50/50">
                            <th className="text-left font-semibold text-muted-600 px-4 py-2.5">Category</th>
                            <th className="text-right font-semibold text-muted-600 px-4 py-2.5">Revenue</th>
                            <th className="text-right font-semibold text-muted-600 px-4 py-2.5">COGS</th>
                            <th className="text-right font-semibold text-muted-600 px-4 py-2.5">Gross Profit</th>
                            <th className="text-right font-semibold text-muted-600 px-4 py-2.5">Margin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pl.by_category.map((cat) => (
                            <tr key={cat.product__category__name} className="border-b border-muted-50 hover:bg-muted-50/40">
                              <td className="px-4 py-2.5 font-medium text-[#1E293B]">{cat.product__category__name ?? 'Uncategorised'}</td>
                              <td className="px-4 py-2.5 text-right text-[#1E293B]">{formatCurrency(cat.revenue)}</td>
                              <td className="px-4 py-2.5 text-right text-rose-600">{formatCurrency(cat.cogs)}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">{formatCurrency(cat.gross_profit)}</td>
                              <td className="px-4 py-2.5 text-right">
                                <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-bold',
                                  cat.margin_pct >= 30 ? 'bg-emerald-100 text-emerald-700' :
                                  cat.margin_pct >= 10 ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700')}>
                                  {cat.margin_pct}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Stock Losses */}
                {pl.stock_losses.total_cost_value > 0 && (
                  <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-muted-100 bg-amber-50/50">
                      <h3 className="text-sm font-bold text-amber-800 flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" />
                        Inventory Losses (informational — not counted as sales or expenses)
                      </h3>
                    </div>
                    <div className="divide-y divide-muted-50">
                      {pl.stock_losses.by_type.map((lt) => (
                        <div key={lt.type} className="flex items-center justify-between px-5 py-2.5">
                          <span className="text-sm text-muted-700">{lt.type.replace(/_/g, ' ')} ({lt.units_lost} units)</span>
                          <span className="text-sm font-semibold text-amber-700">{formatCurrency(lt.cost_value)} lost</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-5 py-3 bg-amber-50/40">
                        <span className="text-sm font-bold text-amber-800">Total Inventory Loss Value</span>
                        <span className="text-sm font-bold text-amber-800">{formatCurrency(pl.stock_losses.total_cost_value)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Note about transfers */}
                <p className="text-[11px] text-muted-400 text-center pb-2">
                  Branch transfers are excluded from revenue. Voided/cancelled sales are excluded.
                  {isLocalSession && ' COGS requires a live backend connection.'}
                </p>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Sales Summary ── */}
      {activeReport === 'sales' && (
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-muted-100 bg-muted-50/50 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1E293B] flex items-center gap-2">
              <Activity className="h-4 w-4" />Daily Sales Breakdown
            </h3>
            <p className="text-[11px] text-muted-400">Click a row to see individual sales</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted-100">
                  <th className="text-left font-semibold text-muted-600 px-4 py-3">Date</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3">Transactions</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Items Sold</th>
                  <th className="text-right font-semibold text-muted-600 px-4 py-3">Revenue</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Avg. Sale</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {dailySales.map((day) => {
                  const avg = day.transactions > 0 ? day.revenue / day.transactions : 0;
                  const isSelected = selectedDay === day.date;
                  const allDaySales = salesByDay.get(day.date) ?? [];
                  return (
                    <tr
                      key={day.date}
                      onClick={() => setSelectedDay(isSelected ? null : day.date)}
                      className={clsx(
                        'border-b border-muted-50 transition-colors cursor-pointer select-none',
                        isSelected ? 'bg-[#1E293B]/[0.04]' : 'hover:bg-muted-50/50'
                      )}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CalendarDays className="h-4 w-4 text-muted-400 shrink-0" />
                          <div>
                            <span className="font-semibold text-[#1E293B]">
                              {new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            {allDaySales.length > day.transactions && (
                              <span className="ml-2 text-[10px] text-muted-400">
                                +{allDaySales.length - day.transactions} other
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center h-6 min-w-[24px] rounded-full bg-muted-100 text-xs font-semibold text-muted-700 px-2">
                          {day.transactions}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-muted-600 hidden sm:table-cell">{day.items}</td>
                      <td className="px-4 py-3 text-right font-bold text-[#1E293B]">{formatCurrency(day.revenue)}</td>
                      <td className="px-4 py-3 text-center text-muted-500 hidden md:table-cell text-xs">
                        {day.transactions > 0 ? formatCurrency(avg) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isSelected
                          ? <ChevronUp className="h-4 w-4 text-[#1E293B] mx-auto" />
                          : <ChevronDown className="h-4 w-4 text-muted-300 mx-auto" />}
                      </td>
                    </tr>
                  );
                })}
                {dailySales.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-400">
                    <BarChart3 className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                    <p className="text-sm font-medium">No sales data yet</p>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Top Products ── */}
      {activeReport === 'products' && (
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-muted-100 bg-muted-50/50">
            <h3 className="text-sm font-semibold text-[#1E293B] flex items-center gap-2"><Package className="h-4 w-4" />Top Selling Products</h3>
          </div>
          <div className="divide-y divide-muted-50">
            {topProducts.map((p, idx) => {
              const maxRevenue = topProducts[0]?.revenue || 1;
              const barPct = (p.revenue / maxRevenue) * 100;
              return (
                <div key={p.name} className="px-4 py-3.5 flex items-center gap-4 hover:bg-muted-50/50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted-100 text-xs font-bold text-muted-600 shrink-0">#{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-[#1E293B] truncate">{p.name}</p>
                      <p className="text-sm font-bold text-[#1E293B] shrink-0 ml-3">{formatCurrency(p.revenue)}</p>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-muted-100 overflow-hidden">
                      <div className="absolute left-0 top-0 h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${barPct}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-400 mt-0.5">{p.qty} units sold &middot; {p.sku}</p>
                  </div>
                </div>
              );
            })}
            {topProducts.length === 0 && (
              <div className="px-4 py-12 text-center text-muted-400">
                <Package className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                <p className="text-sm font-medium">No product data yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Top Customers ── */}
      {activeReport === 'customers' && (
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-muted-100 bg-muted-50/50">
            <h3 className="text-sm font-semibold text-[#1E293B] flex items-center gap-2"><Users className="h-4 w-4" />Top Customers by Revenue</h3>
          </div>
          <div className="divide-y divide-muted-50">
            {[...branchCustomers].sort((a, b) => b.totalPurchases - a.totalPurchases).map((c, idx) => {
              const maxPurchases = branchCustomers[0]?.totalPurchases || 1;
              const barPct = (c.totalPurchases / maxPurchases) * 100;
              return (
                <div key={c.id} className="px-4 py-3.5 flex items-center gap-4 hover:bg-muted-50/50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted-100 text-xs font-bold text-muted-600 shrink-0">#{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1E293B] truncate">{c.firstName} {c.lastName}</p>
                        {c.company && <p className="text-[11px] text-muted-400">{c.company}</p>}
                      </div>
                      <p className="text-sm font-bold text-[#1E293B] shrink-0 ml-3">{formatCurrency(c.totalPurchases)}</p>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-muted-100 overflow-hidden">
                      <div className="absolute left-0 top-0 h-full rounded-full bg-blue-400 transition-all" style={{ width: `${barPct}%` }} />
                    </div>
                    <p className="text-[11px] text-muted-400 mt-0.5">{c.totalTransactions} transactions &middot; {c.loyaltyPoints} pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Payment Methods ── */}
      {activeReport === 'payments' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {paymentBreakdown.map((pm) => {
            const pct = totalPaymentSum > 0 ? (pm.total / totalPaymentSum) * 100 : 0;
            return (
              <div key={pm.method} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted-100">
                      {pm.method === 'CASH' ? <Banknote className="h-4 w-4 text-emerald-600" />
                        : pm.method === 'CARD' ? <CreditCard className="h-4 w-4 text-blue-600" />
                        : <Receipt className="h-4 w-4 text-purple-600" />}
                    </div>
                    <span className="text-sm font-semibold text-[#1E293B]">{pm.method.replace('_', ' ')}</span>
                  </div>
                  <span className="text-xs font-semibold text-muted-400">{pct.toFixed(1)}%</span>
                </div>
                <p className="text-2xl font-bold text-[#1E293B]">{formatCurrency(pm.total)}</p>
                <p className="text-xs text-muted-400 mt-0.5">{pm.count} transactions</p>
                <div className="relative h-1.5 rounded-full bg-muted-100 overflow-hidden mt-3">
                  <div className="absolute left-0 top-0 h-full rounded-full bg-[#1E293B] transition-all" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Day detail slide-over ── */}
      {selectedDay && (
        <DayDetailPanel
          date={selectedDay}
          sales={selectedDaySales}
          onClose={() => setSelectedDay(null)}
        />
      )}

      {/* ── Email modal ── */}
      {emailModalOpen && (
        <SendEmailModal
          onClose={() => setEmailModalOpen(false)}
          defaultSubject={emailSubject}
          bodyLines={emailBody}
          configuredEmail={ownerEmail}
        />
      )}
    </div>
  );
}
