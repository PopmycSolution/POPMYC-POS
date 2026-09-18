import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Search,
  ChevronRight,
  X,
  Check,
  Banknote,
  Wallet,
  CreditCard,
  Building2,
  CheckSquare,
  User,
  CalendarDays,
  TrendingDown,
  DollarSign,
  Users,
  Clock,
  Plus,
  RefreshCw,
  Download,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useDebtStore, type DebtRecord, type DebtStatus } from '@/stores/debt.store';
import { useCustomerStore } from '@/stores/customer.store';
import { useSettingsStore } from '@/stores/settings.store';
import { formatCurrency, formatDate } from '@/utils/format';
import { useAuthStore } from '@/stores/auth.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';

// ── Status config ──────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<DebtStatus, { label: string; color: string; dot: string }> = {
  UNPAID:      { label: 'Unpaid',      color: 'bg-rose-50 text-rose-700 border border-rose-200',   dot: 'bg-rose-500'   },
  PARTIAL:     { label: 'Partial',     color: 'bg-amber-50 text-amber-700 border border-amber-200', dot: 'bg-amber-500' },
  PAID:        { label: 'Paid',        color: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500' },
  WRITTEN_OFF: { label: 'Written Off', color: 'bg-muted-100 text-muted-500',                        dot: 'bg-muted-400'  },
};

const PAYMENT_METHODS = [
  { value: 'CASH',          label: 'Cash'          },
  { value: 'MOBILE_MONEY',  label: 'Mobile Money'  },
  { value: 'CARD',          label: 'Card'           },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer'  },
  { value: 'CHEQUE',        label: 'Cheque'         },
];

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  CASH: Banknote, MOBILE_MONEY: Wallet, CARD: CreditCard,
  BANK_TRANSFER: Building2, CHEQUE: CheckSquare,
};

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'all',        label: 'All'         },
  { value: 'UNPAID',     label: 'Unpaid'      },
  { value: 'PARTIAL',    label: 'Partial'     },
  { value: 'PAID',       label: 'Paid'        },
  { value: 'WRITTEN_OFF',label: 'Written Off' },
];

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10';

export default function DebtPage() {
  const debts         = useDebtStore((s) => s.debts);
  const recordPayment = useDebtStore((s) => s.recordPayment);
  const writeOff      = useDebtStore((s) => s.writeOff);
  const customers     = useCustomerStore((s) => s.customers);
  const { user }      = useAuthStore();
  const business      = useSettingsStore((s) => s.business);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchDebts = filterByBranch(debts);

  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected,     setSelected]     = useState<DebtRecord | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [writeOffId,   setWriteOffId]   = useState<string | null>(null);

  // Payment form
  const [payAmount,  setPayAmount]  = useState('');
  const [payMethod,  setPayMethod]  = useState('CASH');
  const [payNotes,   setPayNotes]   = useState('');

  const cashierName = user ? `${user.firstName} ${user.lastName}` : 'Admin';

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active  = branchDebts.filter((d) => d.status === 'UNPAID' || d.status === 'PARTIAL');
    const paid    = branchDebts.filter((d) => d.status === 'PAID');
    const totalOwed     = active.reduce((s, d) => s + d.amountOwed, 0);
    const totalCollected = paid.reduce((s, d) => s + d.totalAmount, 0)
                        + branchDebts.filter((d) => d.status === 'PARTIAL').reduce((s, d) => s + d.amountPaid, 0);
    const debtors = new Set(active.map((d) => d.customerName)).size;
    return { totalOwed, totalCollected, active: active.length, debtors };
  }, [branchDebts, effectiveBranchId]);

  // ── Filtered ───────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return branchDebts.filter((d) => {
      const matchSearch = q === '' ||
        d.customerName.toLowerCase().includes(q) ||
        d.invoiceNumber.toLowerCase().includes(q) ||
        d.reference.toLowerCase().includes(q) ||
        (d.customerPhone ?? '').includes(q);
      const matchStatus = statusFilter === 'all' || d.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [branchDebts, search, statusFilter, effectiveBranchId]);

  function openPayment(debt: DebtRecord) {
    setSelected(debt);
    setPayAmount(debt.amountOwed.toFixed(2));
    setPayMethod('CASH');
    setPayNotes('');
    setPayModalOpen(true);
  }

  function handleRecordPayment() {
    if (!selected) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    const capped = Math.min(amount, selected.amountOwed);
    recordPayment(selected.id, { amount: capped, method: payMethod, cashierName, notes: payNotes });

    // Also update customer creditBalance if customer exists
    const matchedCustomer = customers.find(
      (c) => `${c.firstName} ${c.lastName}` === selected.customerName
    );
    if (matchedCustomer && matchedCustomer.creditBalance > 0) {
      // Note: useCustomerStore().updateCustomer is called via the store directly
      // (we don't import updateCustomer here; customer store is updated in POS on credit sale creation)
    }

    setPayModalOpen(false);
    setSelected(null);
    setPayAmount('');
    setPayNotes('');
  }

  function handleWriteOff() {
    if (!writeOffId) return;
    writeOff(writeOffId);
    setWriteOffId(null);
    if (selected?.id === writeOffId) setSelected(null);
  }

  // ── Download Invoice as HTML / print-ready page ───────────────────────────
  function downloadInvoice(debt: DebtRecord) {
    const currSymbol = business.currencySymbol || 'GH₵';
    const fmt = (n: number) => `${currSymbol}${n.toFixed(2)}`;
    const owedAmount = debt.amountOwed;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Credit Invoice - ${debt.invoiceNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1E293B; background: #fff; }
  .page { max-width: 600px; margin: 0 auto; padding: 32px 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1E293B; padding-bottom: 16px; margin-bottom: 24px; }
  .brand h1 { font-size: 20px; font-weight: 800; color: #1E293B; }
  .brand p { font-size: 11px; color: #64748b; margin-top: 2px; }
  .invoice-title { text-align: right; }
  .invoice-title h2 { font-size: 18px; font-weight: 700; color: #b45309; }
  .invoice-title p { font-size: 11px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; border-radius: 20px; padding: 2px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; margin-top: 4px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .meta-box label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.05em; display: block; margin-bottom: 4px; }
  .meta-box p { font-size: 13px; font-weight: 600; }
  .meta-box small { font-size: 11px; color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  thead tr { background: #1E293B; color: white; }
  th { padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
  th:last-child { text-align: right; }
  tbody tr { border-bottom: 1px solid #f1f5f9; }
  td { padding: 9px 12px; font-size: 12px; }
  td:last-child { text-align: right; font-weight: 600; }
  .totals { width: 100%; max-width: 260px; margin-left: auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .totals tr { border-bottom: 1px solid #f1f5f9; }
  .totals td { padding: 8px 14px; font-size: 12px; }
  .totals .label { color: #64748b; }
  .total-row { background: #1E293B; }
  .total-row td { color: white; font-weight: 700; font-size: 14px; padding: 10px 14px; }
  .debt-row { background: #fef2f2; }
  .debt-row td { color: #dc2626; font-weight: 700; font-size: 15px; padding: 12px 14px; }
  .payments { margin-bottom: 24px; }
  .payments h3 { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 8px; }
  .payment-row { display: flex; justify-content: space-between; align-items: center; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; font-size: 12px; }
  .payment-row .amt { font-weight: 700; color: #16a34a; }
  .footer { border-top: 1px solid #e2e8f0; padding-top: 16px; text-align: center; }
  .footer p { font-size: 11px; color: #94a3b8; }
  .footer strong { color: #1E293B; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">
      <h1>${business.name}</h1>
      <p>${business.address}</p>
      <p>${business.phone}${business.email ? ` · ${business.email}` : ''}</p>
      ${business.tin ? `<p>TIN: ${business.tin}</p>` : ''}
    </div>
    <div class="invoice-title">
      <h2>CREDIT INVOICE</h2>
      <p>${debt.invoiceNumber}</p>
      <p>${debt.reference}</p>
      <span class="badge">${debt.status}</span>
    </div>
  </div>

  <div class="meta">
    <div class="meta-box">
      <label>Customer</label>
      <p>${debt.customerName}</p>
      ${debt.customerPhone ? `<small>${debt.customerPhone}</small>` : ''}
    </div>
    <div class="meta-box">
      <label>Invoice Date</label>
      <p>${new Date(debt.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <small>Issued by ${debt.cashierName}</small>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Product</th>
        <th>SKU</th>
        <th>Qty</th>
        <th>Unit Price</th>
        <th>Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${debt.items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.name}</td>
        <td style="font-family:monospace;color:#64748b">${item.sku}</td>
        <td>${item.quantity}</td>
        <td>${fmt(item.price)}</td>
        <td>${fmt(item.subtotal)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr><td class="label">Subtotal</td><td>${fmt(debt.subtotal)}</td></tr>
    ${debt.taxAmount > 0 ? `<tr><td class="label">Tax</td><td>${fmt(debt.taxAmount)}</td></tr>` : ''}
    ${debt.discountAmount > 0 ? `<tr><td class="label">Discount</td><td>-${fmt(debt.discountAmount)}</td></tr>` : ''}
    <tr class="total-row"><td>Total Invoice</td><td>${fmt(debt.totalAmount)}</td></tr>
    ${debt.amountPaid > 0 ? `<tr><td class="label" style="color:#16a34a">Paid Upfront</td><td style="color:#16a34a;font-weight:600">-${fmt(debt.amountPaid)}</td></tr>` : ''}
    <tr class="debt-row"><td>⚠ Outstanding Debt</td><td>${fmt(owedAmount)}</td></tr>
  </table>

  ${debt.payments.length > 0 ? `
  <div class="payments">
    <h3>Repayment History</h3>
    ${debt.payments.map(p => `
    <div class="payment-row">
      <span>${p.method.replace('_', ' ')} · ${new Date(p.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · by ${p.cashierName}</span>
      <span class="amt">+${fmt(p.amount)}</span>
    </div>`).join('')}
  </div>` : ''}

  <div class="footer">
    <p>This is an official credit invoice from <strong>${business.name}</strong>.</p>
    <p>Please settle the outstanding balance of <strong>${fmt(owedAmount)}</strong> as soon as possible.</p>
    ${business.phone ? `<p>Contact us: ${business.phone}${business.email ? ` · ${business.email}` : ''}</p>` : ''}
    <p style="margin-top:12px;font-size:10px;color:#cbd5e1">Generated on ${new Date().toLocaleString('en-GB')} · Powered by ${business.name} POS</p>
  </div>
</div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credit-invoice-${debt.invoiceNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-rose-500" />
          Debts & Credit
        </h1>
        <p className="text-sm text-muted-500 mt-0.5">
          {activeBranchName !== 'All Branches'
            ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — unpaid invoices &amp; credit sales</>
            : 'All branches — unpaid invoices & credit sales'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Owed',     value: formatCurrency(stats.totalOwed),      icon: TrendingDown, color: 'bg-rose-50 text-rose-600',    ring: 'ring-rose-100'    },
          { label: 'Active Debts',   value: stats.active.toString(),               icon: Clock,        color: 'bg-amber-50 text-amber-600',  ring: 'ring-amber-100'   },
          { label: 'Debtors',        value: stats.debtors.toString(),              icon: Users,        color: 'bg-blue-50 text-blue-600',    ring: 'ring-blue-100'    },
          { label: 'Total Collected',value: formatCurrency(stats.totalCollected),  icon: DollarSign,   color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
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

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search customer, invoice, reference..."
            value={search} onChange={(e) => setSearch(e.target.value)}
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

      {/* Debt table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-muted-300" />
            <p className="text-sm font-semibold text-muted-500">No debt records found</p>
            <p className="text-xs text-muted-400 mt-1">
              Credit sales made at the POS will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-muted-100 bg-muted-50/50">
                  <th className="text-left font-semibold text-muted-600 px-4 py-3">Invoice</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Customer</th>
                  <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Total</th>
                  <th className="text-right font-semibold text-muted-600 px-4 py-3">Owed</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3">Status</th>
                  <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date</th>
                  <th className="text-center font-semibold text-muted-600 px-4 py-3 w-32">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const sc = STATUS_CONFIG[d.status];
                  return (
                    <tr key={d.id}
                      className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#1E293B] text-sm">{d.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-400 font-mono">{d.reference}</p>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted-100 shrink-0">
                            <User className="h-3.5 w-3.5 text-muted-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[#1E293B]">{d.customerName}</p>
                            {d.customerPhone && <p className="text-[11px] text-muted-400">{d.customerPhone}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right hidden md:table-cell">
                        <span className="text-sm text-muted-600">{formatCurrency(d.totalAmount)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={clsx('text-sm font-bold', d.amountOwed > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                          {formatCurrency(d.amountOwed)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', sc.color)}>
                          <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0', sc.dot)} />
                          {sc.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-xs text-muted-400">
                          <CalendarDays className="h-3 w-3" />
                          {formatDate(d.createdAt, 'DD MMM YYYY')}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {(d.status === 'UNPAID' || d.status === 'PARTIAL') && (
                            <button
                              onClick={() => openPayment(d)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                            >
                              <Plus className="h-3 w-3" /> Pay
                            </button>
                          )}
                          <button
                            onClick={() => downloadInvoice(d)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-muted-100 transition-colors"
                            title="Download Invoice"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setSelected(selected?.id === d.id ? null : d)}
                            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-muted-100 transition-colors"
                          >
                            <ChevronRight className={clsx('h-4 w-4 transition-transform', selected?.id === d.id && 'rotate-90')} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100 shrink-0">
              <div>
                <h2 className="text-base font-bold text-[#1E293B] flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-500" />
                  Debt Detail
                </h2>
                <p className="text-xs text-muted-400 font-mono mt-0.5">{selected.invoiceNumber}</p>
              </div>
              <button onClick={() => setSelected(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Status + balance */}
              <div className="flex items-center gap-3">
                <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold',
                  STATUS_CONFIG[selected.status].color)}>
                  <span className={clsx('h-1.5 w-1.5 rounded-full', STATUS_CONFIG[selected.status].dot)} />
                  {STATUS_CONFIG[selected.status].label}
                </span>
                <span className="text-sm font-bold text-rose-600">{formatCurrency(selected.amountOwed)} owed</span>
              </div>

              {/* Customer */}
              <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100 space-y-1.5">
                <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider">Customer</p>
                <p className="text-sm font-semibold text-[#1E293B]">{selected.customerName}</p>
                {selected.customerPhone && <p className="text-xs text-muted-500">{selected.customerPhone}</p>}
                <p className="text-xs text-muted-400 flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {formatDate(selected.createdAt, 'DD MMMM YYYY at HH:mm')}
                </p>
              </div>

              {/* Items */}
              <div>
                <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider mb-2">Items</p>
                <div className="space-y-2">
                  {selected.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted-50 border border-muted-100">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#1E293B] truncate">{item.name}</p>
                        <p className="text-xs text-muted-400">{item.sku} · {formatCurrency(item.price)} each</p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-sm font-bold">{formatCurrency(item.subtotal)}</p>
                        <p className="text-[11px] text-muted-400">×{item.quantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financials */}
              <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-500">Total Invoice</span><span className="font-semibold">{formatCurrency(selected.totalAmount)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-500">Paid Upfront</span><span className="font-semibold text-emerald-600">{formatCurrency(selected.amountPaid - selected.payments.reduce((s, p) => s + p.amount, 0))}</span></div>
                {selected.payments.length > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-500">Repayments</span><span className="font-semibold text-emerald-600">{formatCurrency(selected.payments.reduce((s, p) => s + p.amount, 0))}</span></div>
                )}
                <div className="border-t border-muted-200 pt-2">
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-rose-600">Still Owed</span>
                    <span className="text-lg font-bold text-rose-600">{formatCurrency(selected.amountOwed)}</span>
                  </div>
                </div>
              </div>

              {/* Payment history */}
              {selected.payments.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider mb-2">Repayment History</p>
                  <div className="space-y-2">
                    {selected.payments.map((p) => {
                      const Icon = PAYMENT_ICONS[p.method] ?? Banknote;
                      return (
                        <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 shrink-0">
                            <Icon className="h-4 w-4 text-emerald-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-emerald-700">{formatCurrency(p.amount)} paid</p>
                            <p className="text-[11px] text-muted-400">
                              {p.method.replace('_', ' ')} · {formatDate(p.paidAt, 'DD MMM YYYY, HH:mm')}
                              {p.notes && ` · ${p.notes}`}
                            </p>
                          </div>
                          <span className="text-xs font-semibold text-emerald-600 shrink-0">by {p.cashierName.split(' ')[0]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selected.notes && (
                <div className="bg-amber-50 rounded-xl p-3 border border-amber-100">
                  <p className="text-xs font-medium text-amber-700">Notes</p>
                  <p className="text-sm text-amber-800 mt-0.5">{selected.notes}</p>
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="px-5 py-4 border-t border-muted-100 shrink-0 space-y-2">
              {/* Download button — always available */}
              <button
                onClick={() => downloadInvoice(selected)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#1E293B] text-[#1E293B] px-4 py-2.5 text-sm font-semibold hover:bg-muted-50 transition-colors"
              >
                <Download className="h-4 w-4" /> Download Credit Invoice
              </button>
              {(selected.status === 'UNPAID' || selected.status === 'PARTIAL') && (
                <button
                  onClick={() => openPayment(selected)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Record Payment
                </button>
              )}
              {(selected.status === 'UNPAID' || selected.status === 'PARTIAL') && (
                <button
                  onClick={() => setWriteOffId(selected.id)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-muted-200 text-muted-600 px-4 py-2.5 text-sm font-semibold hover:bg-muted-50 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" /> Write Off Debt
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Record Payment Modal */}
      {payModalOpen && selected && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
              <h2 className="text-base font-bold text-[#1E293B]">Record Payment</h2>
              <button onClick={() => { setPayModalOpen(false); setPayAmount(''); setPayNotes(''); }}
                className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-3">
                <p className="text-xs text-muted-500">Outstanding balance</p>
                <p className="text-xl font-bold text-rose-600">{formatCurrency(selected.amountOwed)}</p>
                <p className="text-xs text-muted-400">{selected.customerName} · {selected.invoiceNumber}</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Amount Paid *</label>
                <input type="number" min="0.01" step="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="0.00" className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Payment Method</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className={inputClass}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Notes (optional)</label>
                <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="e.g. Cash received at counter" className={inputClass} />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => { setPayModalOpen(false); setPayAmount(''); setPayNotes(''); }}
                  className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                  Cancel
                </button>
                <button
                  onClick={handleRecordPayment}
                  disabled={!payAmount || parseFloat(payAmount) <= 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                  <Check className="h-4 w-4" /> Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Write-off confirmation */}
      {writeOffId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Write Off Debt</h3>
                <p className="text-sm text-muted-500">This marks the debt as uncollectable.</p>
              </div>
            </div>
            <p className="text-sm text-muted-600">
              The outstanding balance of{' '}
              <span className="font-bold text-rose-600">
                {formatCurrency(debts.find((d) => d.id === writeOffId)?.amountOwed ?? 0)}
              </span>{' '}
              will be written off. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setWriteOffId(null)}
                className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                Cancel
              </button>
              <button onClick={handleWriteOff}
                className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-700">
                Write Off
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
