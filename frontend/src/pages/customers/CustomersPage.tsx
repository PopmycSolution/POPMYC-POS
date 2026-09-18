import { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  MapPin,
  Star,
  CreditCard,
  ShoppingBag,
  X,
  UserPlus,
  ChevronRight,
  User,
  Building2,
  TrendingUp,
  UserCheck,
  Trash2,
  AlertTriangle,
  Receipt,
  CalendarDays,
  Package,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency, formatDate } from '@/utils/format';
import { useCustomerStore, type CustomerRecord } from '@/stores/customer.store';
import { useSalesStore } from '@/stores/sales.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';

const groupConfig: Record<string, { label: string; color: string }> = {
  vip: { label: 'VIP', color: 'bg-amber-100 text-amber-700 border border-amber-200' },
  wholesale: { label: 'Wholesale', color: 'bg-blue-100 text-blue-700 border border-blue-200' },
  regular: { label: 'Regular', color: 'bg-emerald-50 text-emerald-600 border border-emerald-200' },
  'walk-in': { label: 'Walk-in', color: 'bg-muted-100 text-muted-600' },
};

const groupFilters = [
  { value: 'all', label: 'All' },
  { value: 'vip', label: 'VIP' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'regular', label: 'Regular' },
  { value: 'walk-in', label: 'Walk-in' },
];

export default function CustomersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CustomerRecord | null>(null);
  const [formData, setFormData] = useState({ firstName: '', lastName: '', phone: '', email: '', address: '', city: '', company: '', creditLimit: '', group: 'regular' });

  const customers = useCustomerStore((s) => s.customers);
  const addCustomer = useCustomerStore((s) => s.addCustomer);
  const deleteCustomer = useCustomerStore((s) => s.deleteCustomer);
  const allSales = useSalesStore((s) => s.sales);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, stampBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchCustomers = filterByBranch(customers);
  const branchSales     = filterByBranch(allSales);

  const stats = useMemo(() => {
    const total = branchCustomers.length;
    const active = branchCustomers.filter((c) => c.isActive).length;
    const totalCredit = branchCustomers.reduce((s, c) => s + c.creditBalance, 0);
    const totalRevenue = branchCustomers.reduce((s, c) => s + c.totalPurchases, 0);
    return { total, active, totalCredit, totalRevenue };
  }, [branchCustomers, effectiveBranchId]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return branchCustomers.filter((c) => {
      const matchSearch = searchTerm === '' ||
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(term) ||
        c.phone.includes(term) || c.email.toLowerCase().includes(term) ||
        (c.company || '').toLowerCase().includes(term);
      const matchGroup = groupFilter === 'all' || c.group === groupFilter;
      return matchSearch && matchGroup;
    });
  }, [branchCustomers, searchTerm, groupFilter, effectiveBranchId]);

  function openDetail(c: CustomerRecord) { setSelectedCustomer(c); setDetailOpen(true); }
  function closeDetail() { setDetailOpen(false); setSelectedCustomer(null); }

  function confirmDelete(c: CustomerRecord) {
    setDeleteTarget(c);
    setDetailOpen(false);
    setSelectedCustomer(null);
  }

  function handleDelete() {
    if (deleteTarget) {
      deleteCustomer(deleteTarget.id);
      setDeleteTarget(null);
    }
  }

  function handleAddCustomer() {
    if (!formData.firstName || !formData.phone) return;
    addCustomer({
      firstName: formData.firstName, lastName: formData.lastName, phone: formData.phone,
      email: formData.email, address: formData.address, city: formData.city,
      company: formData.company, creditLimit: Number(formData.creditLimit) || 0,
      group: formData.group, isActive: true,
      branchId: stampBranch,
    });
    setFormData({ firstName: '', lastName: '', phone: '', email: '', address: '', city: '', company: '', creditLimit: '', group: 'regular' });
    setAddModalOpen(false);
  }

  function getInitials(c: CustomerRecord) {
    return `${c.firstName[0] || ''}${c.lastName[0] || ''}`.toUpperCase();
  }

  function getAvatarColor(c: CustomerRecord) {
    const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-rose-500', 'bg-amber-500', 'bg-sky-500', 'bg-indigo-500'];
    const idx = (c.firstName.charCodeAt(0) + c.lastName.charCodeAt(0)) % colors.length;
    return colors[idx];
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Customers</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — customer list</>
              : 'All branches — customer list'}
          </p>
          <p className="text-sm text-muted-500 mt-0.5">Manage your customer database and loyalty</p>
        </div>
        <button onClick={() => setAddModalOpen(true)} className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Add Customer
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Customers', value: stats.total.toString(), icon: Users, color: 'bg-blue-50 text-blue-600', ring: 'ring-blue-100' },
          { label: 'Active', value: stats.active.toString(), icon: UserCheck, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Outstanding Credit', value: formatCurrency(stats.totalCredit), icon: CreditCard, color: 'bg-amber-50 text-amber-600', ring: 'ring-amber-100' },
          { label: 'Total Revenue', value: formatCurrency(stats.totalRevenue), icon: TrendingUp, color: 'bg-purple-50 text-purple-600', ring: 'ring-purple-100' },
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
          <input type="text" placeholder="Search name, phone, email..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {groupFilters.map((f) => (
            <button key={f.value} onClick={() => setGroupFilter(f.value)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                groupFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Customer</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Contact</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Group</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Purchases</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Loyalty</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Credit</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const grp = groupConfig[c.group] || groupConfig.regular;
                return (
                  <tr key={c.id} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer" onClick={() => openDetail(c)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={clsx('flex h-9 w-9 items-center justify-center rounded-full text-white text-xs font-bold shrink-0', getAvatarColor(c))}>
                          {getInitials(c) || <User className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1E293B] text-sm truncate">{c.firstName} {c.lastName}</p>
                          {c.company && <p className="text-xs text-muted-400 truncate">{c.company}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-600 flex items-center gap-1"><Phone className="h-3 w-3" />{c.phone}</p>
                        {c.email && <p className="text-xs text-muted-400 flex items-center gap-1"><Mail className="h-3 w-3" />{c.email}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', grp.color)}>{grp.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="font-semibold text-[#1E293B]">{formatCurrency(c.totalPurchases)}</span>
                      <p className="text-[11px] text-muted-400">{c.totalTransactions} txns</p>
                    </td>
                    <td className="px-4 py-3 text-center hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><Star className="h-3 w-3" />{c.loyaltyPoints}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {c.creditBalance > 0 ? (
                        <span className="font-semibold text-rose-600">{formatCurrency(c.creditBalance)}</span>
                      ) : (
                        <span className="text-muted-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center"><ChevronRight className="h-4 w-4 text-muted-300" /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-400">
                  <Users className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No customers found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Slide-over */}
      {detailOpen && selectedCustomer && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={closeDetail} />
          <div className="fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100 shrink-0">
              <h2 className="text-base font-bold text-[#1E293B]">Customer Details</h2>
              <button onClick={closeDetail} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100 transition-colors"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Profile */}
              <div className="flex items-center gap-4">
                <div className={clsx('flex h-14 w-14 items-center justify-center rounded-2xl text-white text-lg font-bold shrink-0', getAvatarColor(selectedCustomer))}>
                  {getInitials(selectedCustomer) || <User className="h-6 w-6" />}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-[#1E293B]">{selectedCustomer.firstName} {selectedCustomer.lastName}</h3>
                  {selectedCustomer.company && <p className="text-sm text-muted-500 flex items-center gap-1"><Building2 className="h-3.5 w-3.5" />{selectedCustomer.company}</p>}
                  <span className={clsx('rounded-full px-2.5 py-0.5 text-[11px] font-semibold mt-1 inline-block', (groupConfig[selectedCustomer.group] || groupConfig.regular).color)}>
                    {(groupConfig[selectedCustomer.group] || groupConfig.regular).label}
                  </span>
                </div>
              </div>
              {/* Contact */}
              <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100 space-y-2">
                <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider">Contact</p>
                <div className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-muted-400" />{selectedCustomer.phone}</div>
                {selectedCustomer.email && <div className="flex items-center gap-2 text-sm"><Mail className="h-4 w-4 text-muted-400" />{selectedCustomer.email}</div>}
                {selectedCustomer.address && <div className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4 text-muted-400" />{selectedCustomer.address}, {selectedCustomer.city}</div>}
              </div>
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Total Purchases', value: formatCurrency(selectedCustomer.totalPurchases), icon: ShoppingBag },
                  { label: 'Transactions', value: selectedCustomer.totalTransactions.toString(), icon: TrendingUp },
                  { label: 'Loyalty Points', value: selectedCustomer.loyaltyPoints.toString(), icon: Star },
                  { label: 'Credit Balance', value: formatCurrency(selectedCustomer.creditBalance), icon: CreditCard },
                ].map((s) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.label} className="bg-[#F8FAFC] rounded-xl p-3 border border-muted-100">
                      <Icon className="h-4 w-4 text-muted-400 mb-1" />
                      <p className="text-lg font-bold text-[#1E293B]">{s.value}</p>
                      <p className="text-[11px] text-muted-400">{s.label}</p>
                    </div>
                  );
                })}
              </div>
              {/* Credit info */}
              {selectedCustomer.creditLimit > 0 && (
                <div className="bg-[#F8FAFC] rounded-xl p-4 border border-muted-100">
                  <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider mb-2">Credit</p>
                  <div className="flex justify-between text-sm"><span className="text-muted-500">Limit</span><span className="font-semibold">{formatCurrency(selectedCustomer.creditLimit)}</span></div>
                  <div className="flex justify-between text-sm mt-1"><span className="text-muted-500">Used</span><span className="font-semibold text-rose-600">{formatCurrency(selectedCustomer.creditBalance)}</span></div>
                  <div className="flex justify-between text-sm mt-1"><span className="text-muted-500">Available</span><span className="font-semibold text-emerald-600">{formatCurrency(selectedCustomer.creditLimit - selectedCustomer.creditBalance)}</span></div>
                </div>
              )}
              <p className="text-xs text-muted-400">Customer since {formatDate(selectedCustomer.createdAt, 'DD MMMM YYYY')}</p>

              {/* Purchase History from sales store */}
              {(() => {
                const fullName = `${selectedCustomer.firstName} ${selectedCustomer.lastName}`;
                const customerSales = branchSales
                  .filter((s) => s.customerName === fullName && s.status === 'COMPLETED')
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .slice(0, 10);
                if (customerSales.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5" /> Purchase History
                    </p>
                    <div className="space-y-2">
                      {customerSales.map((sale) => (
                        <div key={sale.id} className="bg-[#F8FAFC] rounded-xl border border-muted-100 overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2.5">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#1E293B]">{sale.invoiceNumber}</p>
                              <p className="text-[11px] text-muted-400 flex items-center gap-1 mt-0.5">
                                <CalendarDays className="h-2.5 w-2.5" />
                                {formatDate(sale.createdAt, 'DD MMM YYYY, HH:mm')}
                              </p>
                            </div>
                            <span className="text-sm font-bold text-[#1E293B] shrink-0 ml-2">
                              {formatCurrency(sale.totalAmount)}
                            </span>
                          </div>
                          <div className="border-t border-muted-100 px-3 py-2 space-y-1">
                            {sale.items.map((item) => (
                              <div key={item.id} className="flex items-center justify-between text-xs text-muted-600">
                                <span className="flex items-center gap-1 min-w-0">
                                  <Package className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate max-w-[140px]">{item.name}</span>
                                  <span className="text-muted-400 shrink-0">×{item.quantity}</span>
                                </span>
                                <span className="font-medium shrink-0 ml-2">{formatCurrency(item.subtotal)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="border-t border-muted-100 px-3 py-1.5 flex items-center justify-between">
                            <span className="text-[10px] text-muted-400 uppercase font-medium">
                              {sale.paymentMethod.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-emerald-600 font-semibold">
                              {sale.paymentStatus}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="px-5 py-4 border-t border-muted-100 shrink-0">
              <button
                onClick={() => confirmDelete(selectedCustomer)}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 text-rose-600 px-4 py-2.5 text-sm font-semibold hover:bg-rose-50 transition-colors"
              >
                <Trash2 className="h-4 w-4" /> Delete Customer
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Delete Customer</h3>
                <p className="text-sm text-muted-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted-600">
              Are you sure you want to delete{' '}
              <span className="font-semibold text-[#1E293B]">{deleteTarget.firstName} {deleteTarget.lastName}</span>?
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {addModalOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md animate-fade-in overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
                <h2 className="text-base font-bold text-[#1E293B] flex items-center gap-2"><UserPlus className="h-5 w-5" /> Add Customer</h2>
                <button onClick={() => setAddModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100"><X className="h-5 w-5" /></button>
              </div>
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-muted-600 mb-1 block">First Name *</label>
                    <input value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                  <div><label className="text-xs font-medium text-muted-600 mb-1 block">Last Name</label>
                    <input value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                </div>
                <div><label className="text-xs font-medium text-muted-600 mb-1 block">Phone *</label>
                  <input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                <div><label className="text-xs font-medium text-muted-600 mb-1 block">Email</label>
                  <input value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                <div><label className="text-xs font-medium text-muted-600 mb-1 block">Company</label>
                  <input value={formData.company} onChange={(e) => setFormData({ ...formData, company: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs font-medium text-muted-600 mb-1 block">City</label>
                    <input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                  <div><label className="text-xs font-medium text-muted-600 mb-1 block">Credit Limit</label>
                    <input type="number" value={formData.creditLimit} onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" /></div>
                </div>
                <div><label className="text-xs font-medium text-muted-600 mb-1 block">Address</label>
                  <textarea value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} rows={2} className="w-full px-3 py-2 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none" /></div>
                <div><label className="text-xs font-medium text-muted-600 mb-1 block">Group</label>
                  <select value={formData.group} onChange={(e) => setFormData({ ...formData, group: e.target.value })} className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                    <option value="regular">Regular</option>
                    <option value="vip">VIP</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="walk-in">Walk-in</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-muted-100">
                <button onClick={() => setAddModalOpen(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-muted-600 hover:bg-muted-100 transition-colors">Cancel</button>
                <button onClick={handleAddCustomer} disabled={!formData.firstName || !formData.phone}
                  className="rounded-xl bg-[#1E293B] px-5 py-2 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-50">
                  Add Customer
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
