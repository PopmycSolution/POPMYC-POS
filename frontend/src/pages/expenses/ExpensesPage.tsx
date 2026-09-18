import { useState, useMemo } from 'react';
import {
  FileText, Search, Plus, X, Check, Clock, XCircle,
  TrendingUp, CalendarDays,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency } from '@/utils/format';
import { useExpenseStore, type ExpenseRecord, type ExpensePaymentMethod } from '@/stores/expense.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';

const statusConfig: Record<string, { label: string; color: string; icon: typeof Check }> = {
  DRAFT: { label: 'Draft', color: 'bg-muted-100 text-muted-600', icon: FileText },
  PENDING: { label: 'Pending', color: 'bg-amber-100 text-amber-700', icon: Clock },
  APPROVED: { label: 'Approved', color: 'bg-blue-100 text-blue-700', icon: Check },
  PAID: { label: 'Paid', color: 'bg-emerald-50 text-emerald-600', icon: Check },
  REJECTED: { label: 'Rejected', color: 'bg-rose-100 text-rose-600', icon: XCircle },
  CANCELLED: { label: 'Cancelled', color: 'bg-muted-100 text-muted-400', icon: XCircle },
};

const paymentLabels: Record<string, string> = {
  CASH: 'Cash', MTN_MOMO: 'MTN MoMo', TELECEL_CASH: 'Telecel', AT_MONEY: 'AT Money',
  CARD: 'Card', BANK_TRANSFER: 'Bank', CHEQUE: 'Cheque', CREDIT: 'Credit',
};

const statusFilters = [
  { value: 'all', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PAID', label: 'Paid' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function ExpensesPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formData, setFormData] = useState<{ description: string; category: string; amount: string; taxAmount: string; paymentMethod: ExpensePaymentMethod; notes: string }>({ description: '', category: 'cat10', amount: '', taxAmount: '', paymentMethod: 'CASH', notes: '' });

  const expenses = useExpenseStore((s) => s.expenses);
  const categories = useExpenseStore((s) => s.categories);
  const addExpense = useExpenseStore((s) => s.addExpense);
  const approveExpense = useExpenseStore((s) => s.approveExpense);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, stampBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchExpenses = filterByBranch(expenses);

  const stats = useMemo(() => {
    const total = branchExpenses.reduce((s, e) => s + e.totalAmount, 0);
    const paid = branchExpenses.filter((e) => e.status === 'PAID').reduce((s, e) => s + e.totalAmount, 0);
    const pending = branchExpenses.filter((e) => e.status === 'PENDING' || e.status === 'APPROVED').reduce((s, e) => s + e.totalAmount, 0);
    const thisMonth = branchExpenses.filter((e) => {
      const d = new Date(e.expenseDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reduce((s, e) => s + e.totalAmount, 0);
    return { total, paid, pending, thisMonth };
  }, [branchExpenses, effectiveBranchId]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return branchExpenses.filter((e) => {
      const matchSearch = searchTerm === '' ||
        e.description.toLowerCase().includes(term) ||
        e.categoryName.toLowerCase().includes(term) ||
        e.referenceNumber.toLowerCase().includes(term);
      const matchStatus = statusFilter === 'all' || e.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [branchExpenses, searchTerm, statusFilter, effectiveBranchId]);

  function handleAdd() {
    if (!formData.description || !formData.amount) return;
    const amount = Number(formData.amount) || 0;
    const tax = Number(formData.taxAmount) || 0;
    const cat = categories.find((c) => c.id === formData.category);
    addExpense({
      category: formData.category,
      categoryName: cat?.name || 'Miscellaneous',
      expenseDate: new Date().toISOString().slice(0, 10),
      referenceNumber: `EXP-${String(expenses.length + 1).padStart(3, '0')}`,
      description: formData.description,
      amount, taxAmount: tax, totalAmount: amount + tax,
      paymentMethod: formData.paymentMethod,
      status: 'DRAFT', isTaxDeductible: true,
      createdBy: 'Admin', notes: formData.notes,
      branchId: stampBranch,
    });
    setFormData({ description: '', category: 'cat10', amount: '', taxAmount: '', paymentMethod: 'CASH', notes: '' });
    setAddModalOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — expense records</>
              : 'All branches — expense records'}
          </p>
          <p className="text-sm text-muted-500 mt-0.5">Track and manage business expenses</p>
        </div>
        <button onClick={() => setAddModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Record Expense
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Expenses', value: formatCurrency(stats.total), icon: TrendingUp, color: 'bg-blue-50 text-blue-600', ring: 'ring-blue-100' },
          { label: 'Paid', value: formatCurrency(stats.paid), icon: Check, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Pending', value: formatCurrency(stats.pending), icon: Clock, color: 'bg-amber-50 text-amber-600', ring: 'ring-amber-100' },
          { label: 'This Month', value: formatCurrency(stats.thisMonth), icon: CalendarDays, color: 'bg-purple-50 text-purple-600', ring: 'ring-purple-100' },
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

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search description, category..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {statusFilters.map((f) => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                statusFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Expense Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Expense</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Category</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3">Amount</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Payment</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Status</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const sc = statusConfig[e.status] || statusConfig.DRAFT;
                return (
                  <tr key={e.id} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-[#1E293B] text-sm truncate">{e.description}</p>
                        <p className="text-xs text-muted-400">{e.referenceNumber}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs font-medium text-muted-600 bg-muted-100 rounded-full px-2.5 py-1">{e.categoryName}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-bold text-[#1E293B]">{formatCurrency(e.totalAmount)}</p>
                      {e.taxAmount > 0 && <p className="text-[11px] text-muted-400">Tax: {formatCurrency(e.taxAmount)}</p>}
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className="text-xs font-medium text-muted-600">{paymentLabels[e.paymentMethod] || e.paymentMethod}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', sc.color)}>
                        <sc.icon className="h-3 w-3" />{sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-500 text-xs">{new Date(e.expenseDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-3 text-center">
                      {(e.status === 'DRAFT' || e.status === 'PENDING') && (
                        <button onClick={() => approveExpense(e.id)} className="text-xs font-semibold text-blue-600 hover:text-blue-800">Approve</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-400">
                  <FileText className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No expenses found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-[#1E293B]">Record Expense</h2>
              <button onClick={() => setAddModalOpen(false)} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Description *</label><input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Category</label>
                  <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Payment Method</label>
                  <select value={formData.paymentMethod} onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value as ExpenseRecord['paymentMethod'] })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                    {Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Amount *</label><input type="number" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Tax Amount</label><input type="number" value={formData.taxAmount} onChange={(e) => setFormData({ ...formData, taxAmount: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
              </div>
              <div><label className="text-xs font-semibold text-muted-600 mb-1 block">Notes</label><textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} className="w-full px-3 py-2.5 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none" /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setAddModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-600 hover:bg-muted-100">Cancel</button>
                <button onClick={handleAdd} className="rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155]">Record Expense</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
