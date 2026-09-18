import { useState, useMemo, useEffect } from 'react';
import {
  Package,
  TrendingUp,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Minus,
  Search,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  BarChart3,
  Activity,
  ShieldAlert,
  Settings2,
  Truck,
  ShoppingCart as CartIcon,
  FileText,
  Building2,
  Globe,
  Plus,
  ArrowDownCircle,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency, formatDate } from '@/utils/format';
import { useProductStore } from '@/stores/product.store';
import {
  useInventoryStore,
  type MovementType,
} from '@/stores/inventory.store';
import { useBranchInventoryStore } from '@/stores/branchInventory.store';
import { useBranchStore } from '@/stores/branch.store';
import { useSettingsStore } from '@/stores/settings.store';
import { OperatingModeGuard } from '@/components/guards/OperatingModeGuard';
import { productCategories } from '@/utils/constants';
import type { Product } from '@/types';

type Tab = 'overview' | 'movements' | 'alerts' | 'adjustments';

const tabs: { id: Tab; label: string; icon: typeof Package }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'movements', label: 'Movements', icon: Activity },
  { id: 'alerts', label: 'Alerts', icon: ShieldAlert },
  { id: 'adjustments', label: 'Adjustments', icon: Settings2 },
];

const movementTypeConfig: Record<MovementType, { label: string; color: string; icon: typeof ArrowUp; bg: string }> = {
  SALE: { label: 'Sale', color: 'text-rose-600', icon: CartIcon, bg: 'bg-rose-50' },
  PURCHASE: { label: 'Purchase', color: 'text-emerald-600', icon: Truck, bg: 'bg-emerald-50' },
  RETURN_IN: { label: 'Return In', color: 'text-blue-600', icon: RotateCcw, bg: 'bg-blue-50' },
  RETURN_OUT: { label: 'Return Out', color: 'text-orange-600', icon: RotateCcw, bg: 'bg-orange-50' },
  ADJUSTMENT: { label: 'Adjustment', color: 'text-purple-600', icon: Settings2, bg: 'bg-purple-50' },
  DAMAGED: { label: 'Damaged', color: 'text-red-600', icon: XCircle, bg: 'bg-red-50' },
  EXPIRED: { label: 'Expired', color: 'text-amber-600', icon: Clock, bg: 'bg-amber-50' },
  OPENING_STOCK: { label: 'Opening Stock', color: 'text-sky-600', icon: Package, bg: 'bg-sky-50' },
  STOCK_COUNT: { label: 'Stock Count', color: 'text-indigo-600', icon: FileText, bg: 'bg-indigo-50' },
  TRANSFER_IN: { label: 'Transfer In', color: 'text-teal-600', icon: ArrowDown, bg: 'bg-teal-50' },
  TRANSFER_OUT: { label: 'Transfer Out', color: 'text-orange-500', icon: ArrowUp, bg: 'bg-orange-50' },
};

const movementFilterOptions = [
  { value: 'all', label: 'All Types' },
  { value: 'SALE', label: 'Sales' },
  { value: 'PURCHASE', label: 'Purchases' },
  { value: 'ADJUSTMENT', label: 'Adjustments' },
  { value: 'DAMAGED', label: 'Damaged' },
  { value: 'OPENING_STOCK', label: 'Opening Stock' },
];

export default function InventoryPage() {
  const inventoryEnabled = useSettingsStore((s) => s.inventoryEnabled);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [movementFilter, setMovementFilter] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const products = useProductStore((s) => s.products);
  const movements = useInventoryStore((s) => s.movements);
  const alerts = useInventoryStore((s) => s.alerts);
  const adjustments = useInventoryStore((s) => s.adjustments);
  const acknowledgeAlert = useInventoryStore((s) => s.acknowledgeAlert);

  // ── Branch-scoped stock ──────────────────────────────────────────────────────
  const activeBranchId    = useBranchStore((s) => s.activeBranchId);
  const branches          = useBranchStore((s) => s.branches);
  const branchStockSlice  = useBranchInventoryStore(
    (s) => activeBranchId ? s.stock[activeBranchId] : undefined
  );
  const sumAcrossBranches = useBranchInventoryStore((s) => s.sumAcrossBranches);
  const fetchBranchStock  = useBranchInventoryStore((s) => s.fetchBranchStock);
  const incrementStock    = useBranchInventoryStore((s) => s.incrementStock);
  const incrementGlobal   = useProductStore((s) => s.incrementStock);

  // Stock-in modal state
  const [stockInTarget,  setStockInTarget]  = useState<Product | null>(null);
  const [stockInQty,     setStockInQty]     = useState('');
  const [stockInNote,    setStockInNote]    = useState('');
  const [stockInType,    setStockInType]    = useState<'PURCHASE' | 'ADJUSTMENT' | 'RETURN_IN'>('PURCHASE');
  const [stockInSaving,  setStockInSaving]  = useState(false);

  // Fetch backend stock levels whenever the active branch changes
  useEffect(() => {
    if (activeBranchId) {
      void fetchBranchStock(activeBranchId);
    }
  }, [activeBranchId, fetchBranchStock]);

  const activeBranch = activeBranchId
    ? branches.find((b) => b.id === activeBranchId) ?? null
    : null;

  /** Returns branch-specific qty. When branch is active, 0 = out of stock (no global fallback). */
  const branchQty = (p: Product): number => {
    if (!activeBranchId) {
      const sum = sumAcrossBranches(p.id);
      return sum > 0 ? sum : p.stockQuantity;
    }
    return branchStockSlice?.[p.id]?.qty ?? 0;
  };

  function openStockIn(p: Product) {
    setStockInTarget(p);
    setStockInQty('');
    setStockInNote('');
    setStockInType('PURCHASE');
  }

  function handleStockIn() {
    if (!stockInTarget || !activeBranchId) return;
    const qty = parseInt(stockInQty, 10);
    if (isNaN(qty) || qty <= 0) return;
    setStockInSaving(true);
    // Update branch stock
    incrementStock(activeBranchId, stockInTarget.id, qty, stockInType, '', stockInNote);
    // Also update the global stockQuantity so POS and product lists stay consistent
    incrementGlobal(stockInTarget.id, qty);
    setStockInTarget(null);
    setStockInSaving(false);
  }

  // --- Stats ---
  const stats = useMemo(() => {
    const active = products.filter((p) => p.isActive);
    const totalProducts = active.length;
    const lowStock = active.filter(
      (p) => p.lowStockThreshold && branchQty(p) <= p.lowStockThreshold && branchQty(p) > 0
    ).length;
    const outOfStock = active.filter((p) => branchQty(p) <= 0).length;
    const totalValue = active.reduce((sum, p) => sum + branchQty(p) * (p.cost || 0), 0);
    const unacknowledgedAlerts = alerts.filter((a) => !a.isAcknowledged).length;
    return { totalProducts, lowStock, outOfStock, totalValue, unacknowledgedAlerts };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, alerts, activeBranchId, branchStockSlice]);

  // --- Filtered products ---
  const filteredProducts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return products.filter((p) => {
      if (!p.isActive) return false;
      const matchesSearch =
        searchTerm === '' ||
        p.name.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term);
      const matchesCat =
        selectedCategory === 'all' || p.categoryId === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [products, searchTerm, selectedCategory]);

  // --- Filtered movements ---
  const filteredMovements = useMemo(() => {
    if (movementFilter === 'all') return movements;
    return movements.filter((m) => m.type === movementFilter);
  }, [movements, movementFilter]);

  // --- Product stock status (branch-aware) ---
  function getStockStatus(p: Product) {
    const qty = branchQty(p);
    if (qty <= 0) return { label: 'Out of Stock', color: 'bg-danger-500 text-white', icon: XCircle };
    if (p.lowStockThreshold && qty <= p.lowStockThreshold)
      return { label: 'Low Stock', color: 'bg-amber-100 text-amber-700 border border-amber-200', icon: AlertTriangle };
    return { label: 'In Stock', color: 'bg-emerald-50 text-emerald-600 border border-emerald-200', icon: CheckCircle };
  }

  // --- Movement type badge ---
  function MovementBadge({ type }: { type: MovementType }) {
    const cfg = movementTypeConfig[type] || movementTypeConfig.ADJUSTMENT;
    const Icon = cfg.icon;
    return (
      <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold', cfg.bg, cfg.color)}>
        <Icon className="h-3 w-3" />
        {cfg.label}
      </span>
    );
  }

  // --- Stock level bar (branch-aware) ---
  function StockBar({ product }: { product: Product }) {
    const qty = branchQty(product);
    const maxStock = Math.max(qty, (product.lowStockThreshold || 10) * 3, 50);
    const pct = Math.min(100, (qty / maxStock) * 100);
    const thresholdPct = product.lowStockThreshold ? Math.min(100, (product.lowStockThreshold / maxStock) * 100) : null;
    const barColor = qty <= 0 ? 'bg-danger-500' : product.lowStockThreshold && qty <= product.lowStockThreshold ? 'bg-amber-400' : 'bg-emerald-400';

    return (
      <div className="relative w-full h-2 rounded-full bg-muted-100 overflow-hidden">
        <div className={clsx('absolute left-0 top-0 h-full rounded-full transition-all duration-500', barColor)} style={{ width: `${pct}%` }} />
        {thresholdPct && (
          <div className="absolute top-0 h-full w-px bg-muted-400" style={{ left: `${thresholdPct}%` }} />
        )}
      </div>
    );
  }

  if (!inventoryEnabled) {
    return <OperatingModeGuard requiredMode="inventory" />;
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Inventory</h1>
          <p className="text-sm text-muted-500 mt-0.5">Manage stock levels, movements, and alerts</p>
        </div>
        {activeBranchId && (
          <button
            type="button"
            onClick={() => setStockInTarget(filteredProducts[0] ?? null)}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 active:scale-[0.98] transition-all shadow-sm"
          >
            <ArrowDownCircle className="h-4 w-4" /> Stock In
          </button>
        )}
      </div>

      {/* Branch context banner */}
      <div className={clsx(
        'flex items-center gap-3 rounded-2xl px-4 py-3 border',
        activeBranch
          ? 'bg-teal-50 border-teal-200'
          : 'bg-slate-50 border-slate-200',
      )}>
        {activeBranch ? (
          <Building2 className="h-4 w-4 text-teal-600 shrink-0" />
        ) : (
          <Globe className="h-4 w-4 text-slate-500 shrink-0" />
        )}
        <p className="text-sm font-semibold text-slate-700">
          {activeBranch
            ? <>Showing stock for <span className="text-teal-700">{activeBranch.name}</span></>
            : 'Showing global stock across all branches'}
        </p>
        <span className="ml-auto text-xs text-slate-400">
          Use the branch switcher in the header to change view
        </span>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Products', value: stats.totalProducts.toString(), icon: Package, color: 'bg-blue-50 text-blue-600', ring: 'ring-blue-100' },
          { label: 'Low Stock', value: stats.lowStock.toString(), icon: AlertTriangle, color: 'bg-amber-50 text-amber-600', ring: 'ring-amber-100' },
          { label: 'Out of Stock', value: stats.outOfStock.toString(), icon: XCircle, color: 'bg-red-50 text-red-600', ring: 'ring-red-100' },
          { label: 'Stock Value', value: formatCurrency(stats.totalValue), icon: TrendingUp, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-500 truncate">{stat.label}</p>
                  <p className="text-xl sm:text-2xl font-bold text-[#1E293B] mt-1 truncate">{stat.value}</p>
                </div>
                <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4', stat.color, stat.ring)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tab Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                isActive ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50'
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              {tab.id === 'alerts' && stats.unacknowledgedAlerts > 0 && (
                <span className={clsx(
                  'inline-flex items-center justify-center h-5 min-w-[20px] rounded-full text-[10px] font-bold px-1',
                  isActive ? 'bg-white/20 text-white' : 'bg-danger-500 text-white'
                )}>
                  {stats.unacknowledgedAlerts}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Search + Category Filter */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative w-full sm:w-auto sm:min-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              {productCategories.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(cat.value)}
                  className={clsx(
                    'rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all',
                    selectedCategory === cat.value
                      ? 'bg-[#1E293B] text-white' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50'
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Products Stock Table */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-muted-100 bg-muted-50/50">
                    <th className="text-left font-semibold text-muted-600 px-4 py-3">Product</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Category</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Stock</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell w-40">Level</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Status</th>
                    <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Value</th>
                    {activeBranchId && (
                      <th className="text-center font-semibold text-muted-600 px-4 py-3">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const status = getStockStatus(product);
                    const StatusIcon = status.icon;
                    const catLabel = productCategories.find((c) => c.value === product.categoryId)?.label || '-';
                    const stockValue = branchQty(product) * (product.cost || 0);
                    return (
                      <tr
                        key={product.id}
                        className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedProduct(selectedProduct?.id === product.id ? null : product)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-[#1E293B] text-sm">{product.name}</span>
                            <span className="text-xs text-muted-400 font-mono">{product.sku}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-muted-600 bg-muted-100 rounded-full px-2.5 py-1">{catLabel}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="font-bold text-[#1E293B]">{branchQty(product)}</span>
                          {activeBranchId && (
                            <span className="block text-[10px] text-muted-400">
                              Global: {product.stockQuantity}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <StockBar product={product} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', status.color)}>
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right hidden lg:table-cell">
                          <span className="font-semibold text-[#1E293B]">{formatCurrency(stockValue)}</span>
                        </td>
                        {activeBranchId && (
                          <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => openStockIn(product)}
                              title="Add stock to this branch"
                              className="inline-flex items-center gap-1 rounded-lg bg-teal-50 border border-teal-200 px-2.5 py-1.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-100 transition-colors"
                            >
                              <Plus className="h-3 w-3" /> Stock In
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-muted-400">
                        <Package className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                        <p className="text-sm font-medium">No products found</p>
                        <p className="text-xs mt-1">Try adjusting your search or filters</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Selected Product Detail */}
          {selectedProduct && (
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
              <h3 className="text-sm font-bold text-[#1E293B] mb-4">
                Recent Movements — {selectedProduct.name}
              </h3>
              <div className="space-y-2">
                {movements
                  .filter((m) => m.productId === selectedProduct.id)
                  .slice(0, 5)
                  .map((m) => (
                    <div key={m.id} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-muted-50">
                      <div className="flex items-center gap-3">
                        <MovementBadge type={m.type} />
                        <div>
                          <p className="text-sm font-medium text-[#1E293B]">{m.reference}</p>
                          <p className="text-xs text-muted-400">{formatDate(m.createdAt, 'DD MMM YYYY, HH:mm')}</p>
                        </div>
                      </div>
                      <span className={clsx('text-sm font-bold', m.qtyDelta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                        {m.qtyDelta > 0 ? '+' : ''}{m.qtyDelta}
                      </span>
                    </div>
                  ))}
                {movements.filter((m) => m.productId === selectedProduct.id).length === 0 && (
                  <p className="text-sm text-muted-400 text-center py-4">No movements recorded</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'movements' && (
        <div className="space-y-4">
          {/* Movement Type Filter */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            {movementFilterOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMovementFilter(opt.value)}
                className={clsx(
                  'rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-all',
                  movementFilter === opt.value
                    ? 'bg-[#1E293B] text-white' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Movement List */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="divide-y divide-muted-50">
              {filteredMovements.map((m) => {
                const isPositive = m.qtyDelta >= 0;
                return (
                  <div key={m.id} className="flex items-center justify-between px-4 py-3.5 hover:bg-muted-50/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={clsx(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                        movementTypeConfig[m.type]?.bg || 'bg-muted-50'
                      )}>
                        {(() => { const Icon = movementTypeConfig[m.type]?.icon || Minus; return <Icon className={clsx('h-4 w-4', movementTypeConfig[m.type]?.color || 'text-muted-600')} />; })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#1E293B] truncate">{m.productName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <MovementBadge type={m.type} />
                          <span className="text-[11px] text-muted-400 font-mono">{m.reference}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <p className={clsx('text-sm font-bold', isPositive ? 'text-emerald-600' : 'text-rose-600')}>
                        {isPositive ? '+' : ''}{m.qtyDelta}
                      </p>
                      <p className="text-[11px] text-muted-400">{formatDate(m.createdAt, 'DD MMM, HH:mm')}</p>
                    </div>
                  </div>
                );
              })}
              {filteredMovements.length === 0 && (
                <div className="px-4 py-12 text-center text-muted-400">
                  <Activity className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No movements found</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="divide-y divide-muted-50">
              {alerts.map((alert) => {
                const isUrgent = alert.type === 'OUT_OF_STOCK' || alert.type === 'EXPIRED';
                return (
                  <div key={alert.id} className={clsx('flex items-start gap-4 px-4 py-4 transition-colors', alert.isAcknowledged ? 'opacity-50' : 'hover:bg-muted-50/50')}>
                    <div className={clsx(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl mt-0.5',
                      isUrgent ? 'bg-red-50' : 'bg-amber-50'
                    )}>
                      <AlertTriangle className={clsx('h-5 w-5', isUrgent ? 'text-red-500' : 'text-amber-500')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-[#1E293B]">{alert.productName}</p>
                        <span className={clsx(
                          'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                          isUrgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        )}>
                          {alert.type.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-600 mt-0.5">{alert.message}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="text-xs text-muted-400">
                          Current: <span className="font-semibold text-[#1E293B]">{alert.currentStock}</span>
                        </span>
                        <span className="text-xs text-muted-400">
                          Threshold: <span className="font-semibold text-[#1E293B]">{alert.threshold}</span>
                        </span>
                        <span className="text-xs text-muted-400">{formatDate(alert.createdAt, 'DD MMM YYYY')}</span>
                      </div>
                    </div>
                    {!alert.isAcknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-muted-100 hover:bg-[#1E293B] hover:text-white px-3 py-2 text-xs font-medium text-muted-600 transition-all"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Acknowledge
                      </button>
                    )}
                    {alert.isAcknowledged && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-400">
                        <CheckCircle className="h-3.5 w-3.5" /> Resolved
                      </span>
                    )}
                  </div>
                );
              })}
              {alerts.length === 0 && (
                <div className="px-4 py-12 text-center text-muted-400">
                  <CheckCircle className="h-10 w-10 mx-auto mb-3 text-emerald-300" />
                  <p className="text-sm font-medium text-emerald-600">All clear!</p>
                  <p className="text-xs mt-1">No stock alerts at this time</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'adjustments' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-muted-100 bg-muted-50/50">
                    <th className="text-left font-semibold text-muted-600 px-4 py-3">Reference</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3">Product</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Reason</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Expected</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Actual</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Change</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Status</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((adj) => (
                    <tr key={adj.id} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-600">{adj.reference}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-semibold text-[#1E293B] text-sm">{adj.productName}</p>
                          <p className="text-xs text-muted-400 font-mono">{adj.sku}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className={clsx(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          adj.reason === 'DAMAGED' ? 'bg-red-50 text-red-600' :
                          adj.reason === 'LOST' ? 'bg-orange-50 text-orange-600' :
                          adj.reason === 'FOUND' ? 'bg-emerald-50 text-emerald-600' :
                          adj.reason === 'EXPIRED' ? 'bg-amber-50 text-amber-600' :
                          'bg-muted-100 text-muted-600'
                        )}>
                          {adj.reason.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium">{adj.qtyExpected}</td>
                      <td className="px-4 py-3 text-center font-medium">{adj.qtyActual}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={clsx('font-bold', adj.qtyDelta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                          {adj.qtyDelta > 0 ? '+' : ''}{adj.qtyDelta}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={clsx(
                          'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                          adj.status === 'POSTED' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                          adj.status === 'CANCELLED' ? 'bg-red-50 text-red-600' :
                          'bg-muted-100 text-muted-600'
                        )}>
                          {adj.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-400 hidden lg:table-cell">
                        {formatDate(adj.createdAt, 'DD MMM YYYY')}
                      </td>
                    </tr>
                  ))}
                  {adjustments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-muted-400">
                        <Settings2 className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                        <p className="text-sm font-medium">No adjustments recorded</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Stock In Modal ── */}
      {stockInTarget && activeBranchId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={() => setStockInTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50">
                  <ArrowDownCircle className="h-5 w-5 text-teal-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Stock In</h2>
                  <p className="text-xs text-slate-500">{activeBranch?.name ?? 'Branch'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setStockInTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Product selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Product</label>
                <select
                  value={stockInTarget.id}
                  onChange={(e) => {
                    const p = filteredProducts.find((x) => x.id === e.target.value);
                    if (p) { setStockInTarget(p); }
                  }}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-teal-500 transition-colors bg-white"
                >
                  {filteredProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — {p.sku}</option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Current stock at {activeBranch?.name}: <strong>{branchQty(stockInTarget)}</strong>
                </p>
              </div>

              {/* Type */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Type</label>
                <div className="flex gap-2">
                  {([['PURCHASE', 'Purchase / Delivery'], ['ADJUSTMENT', 'Manual Adjustment'], ['RETURN_IN', 'Customer Return']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStockInType(val)}
                      className={clsx(
                        'flex-1 rounded-xl border py-2 text-[11px] font-semibold transition-colors',
                        stockInType === val
                          ? 'bg-teal-600 border-teal-600 text-white'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Quantity to Add *</label>
                <input
                  type="number"
                  min="1"
                  value={stockInQty}
                  onChange={(e) => setStockInQty(e.target.value)}
                  placeholder="e.g. 50"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
                  autoFocus
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes (optional)</label>
                <input
                  type="text"
                  value={stockInNote}
                  onChange={(e) => setStockInNote(e.target.value)}
                  placeholder="e.g. Supplier delivery PO-2026-001"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors"
                />
              </div>

              {/* Preview */}
              {stockInQty && parseInt(stockInQty, 10) > 0 && (
                <div className="rounded-xl bg-teal-50 border border-teal-200 px-4 py-3 flex items-center justify-between">
                  <span className="text-xs text-teal-700 font-medium">New stock at {activeBranch?.name}</span>
                  <span className="text-sm font-bold text-teal-800">
                    {branchQty(stockInTarget)} → {branchQty(stockInTarget) + parseInt(stockInQty, 10)}
                  </span>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setStockInTarget(null)}
                  className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!stockInQty || parseInt(stockInQty, 10) <= 0 || stockInSaving}
                  onClick={handleStockIn}
                  className="flex-1 h-10 flex items-center justify-center gap-2 rounded-xl bg-teal-600 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  <ArrowDownCircle className="h-4 w-4" /> Confirm Stock In
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
