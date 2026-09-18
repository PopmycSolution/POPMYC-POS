/**
 * StockAdjustmentsPage
 *
 * Available ONLY when Inventory Mode = STOCK_ENABLED.
 * Lets authorised users create stock adjustments (damage, expiry, loss, theft,
 * internal use, stock correction, supplier return, found stock) and view the
 * full adjustment history with per-item details.
 *
 * Route: /inventory/adjustments
 */

import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Clock,
  Info,
  Loader2,
  Lock,
  Minus,
  Package,
  PackageX,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldOff,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore }       from '@/stores/settings.store';
import { useProductStore }        from '@/stores/product.store';
import { useBranchStore }         from '@/stores/branch.store';
import { useBranchInventoryStore } from '@/stores/branchInventory.store';
import { useInventoryStore }      from '@/stores/inventory.store';
import { useAuthStore }           from '@/stores/auth.store';
import { getRoleConfig }          from '@/utils/permissions';
import { formatCurrency, formatDate } from '@/utils/format';
import api from '@/services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────────────────────

type AdjReason =
  | 'DAMAGED'
  | 'EXPIRED'
  | 'LOST'
  | 'THEFT'
  | 'INTERNAL_USE'
  | 'STOCK_CORRECTION'
  | 'SUPPLIER_RETURN'
  | 'FOUND'
  | 'WRONG_ENTRY'
  | 'OTHER';

interface ReasonMeta {
  label: string;
  icon: typeof Package;
  color: string;
  bg: string;
  delta: 'negative' | 'positive' | 'either';
  highRisk: boolean;
  description: string;
}

const REASON_META: Record<AdjReason, ReasonMeta> = {
  DAMAGED: {
    label: 'Damaged',
    icon: PackageX,
    color: 'text-red-600',
    bg: 'bg-red-50 border-red-200',
    delta: 'negative',
    highRisk: false,
    description: 'Items physically damaged and no longer sellable.',
  },
  EXPIRED: {
    label: 'Expired',
    icon: Clock,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    delta: 'negative',
    highRisk: false,
    description: 'Items past their expiry or best-before date.',
  },
  LOST: {
    label: 'Lost / Missing',
    icon: AlertTriangle,
    color: 'text-orange-600',
    bg: 'bg-orange-50 border-orange-200',
    delta: 'negative',
    highRisk: false,
    description: 'Items unaccounted for during a stock count.',
  },
  THEFT: {
    label: 'Theft',
    icon: ShieldAlert,
    color: 'text-rose-700',
    bg: 'bg-rose-50 border-rose-200',
    delta: 'negative',
    highRisk: true,
    description: 'Items stolen or removed without authorisation.',
  },
  INTERNAL_USE: {
    label: 'Internal Use',
    icon: Zap,
    color: 'text-purple-600',
    bg: 'bg-purple-50 border-purple-200',
    delta: 'negative',
    highRisk: true,
    description: 'Items consumed internally (staff use, demos, etc.).',
  },
  STOCK_CORRECTION: {
    label: 'Stock Correction',
    icon: RefreshCw,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    delta: 'either',
    highRisk: false,
    description: 'Correcting a discrepancy found during a physical count.',
  },
  SUPPLIER_RETURN: {
    label: 'Supplier Return',
    icon: ArrowUpCircle,
    color: 'text-teal-600',
    bg: 'bg-teal-50 border-teal-200',
    delta: 'negative',
    highRisk: true,
    description: 'Items sent back to the supplier.',
  },
  FOUND: {
    label: 'Found Stock',
    icon: ArrowDownCircle,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    delta: 'positive',
    highRisk: false,
    description: 'Items found that were not recorded (e.g. behind shelving).',
  },
  WRONG_ENTRY: {
    label: 'Wrong Entry',
    icon: RefreshCw,
    color: 'text-sky-600',
    bg: 'bg-sky-50 border-sky-200',
    delta: 'either',
    highRisk: false,
    description: 'Correcting a previous data-entry error.',
  },
  OTHER: {
    label: 'Other',
    icon: Info,
    color: 'text-muted-600',
    bg: 'bg-muted-50 border-muted-200',
    delta: 'either',
    highRisk: false,
    description: 'Any other reason (specify in notes).',
  },
};

// Reasons that INCREASE stock on the backend
const POSITIVE_REASONS: AdjReason[] = ['FOUND', 'STOCK_CORRECTION', 'WRONG_ENTRY'];

// Roles that may post high-risk adjustments
const HIGH_RISK_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'INVENTORY_CLERK']);

interface LineItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  qty: number;
  currentStock: number;
  unitCost: number;
  serialNumber: string;
  notes: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: check if session is demo / local (no real backend)
// ─────────────────────────────────────────────────────────────────────────────
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

function genLocalId() {
  return `local-adj-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StockDisabledGuard() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-amber-100 mb-6">
        <ShieldOff className="h-9 w-9 text-amber-600" />
      </div>
      <h2 className="text-xl font-bold text-page-primary">Stock Adjustments Unavailable</h2>
      <p className="mt-2 text-sm text-page-secondary max-w-sm leading-relaxed">
        Stock Adjustments are only available when your business is set to{' '}
        <strong>Stock Enabled</strong> mode. Go to{' '}
        <strong>Settings → Inventory</strong> to change this.
      </p>
    </div>
  );
}

function ReasonCard({
  reason,
  selected,
  disabled,
  onSelect,
}: {
  reason: AdjReason;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const meta = REASON_META[reason];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={clsx(
        'relative flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-left transition-all text-sm',
        selected
          ? 'border-[#1E293B] bg-[#1E293B] text-white shadow-md ring-2 ring-[#1E293B]/30'
          : disabled
          ? 'opacity-40 cursor-not-allowed border-muted-200 bg-muted-50'
          : `${meta.bg} hover:shadow-sm cursor-pointer`,
      )}
    >
      <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl', selected ? 'bg-white/15' : meta.bg)}>
        <Icon className={clsx('h-4.5 w-4.5', selected ? 'text-white' : meta.color)} />
      </div>
      <span className={clsx('font-semibold text-xs', selected ? 'text-white' : meta.color)}>
        {meta.label}
      </span>
      {meta.highRisk && (
        <span className={clsx(
          'absolute top-2 right-2 text-[9px] font-bold rounded-full px-1.5 py-0.5',
          selected ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-700',
        )}>
          Senior Only
        </span>
      )}
      {disabled && !selected && (
        <Lock className="absolute top-2 right-2 h-3 w-3 text-muted-400" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// History table row
// ─────────────────────────────────────────────────────────────────────────────
interface HistoryAdj {
  id: string;
  reference_number: string;
  reason: AdjReason;
  reason_display?: string;
  status: string;
  branch_name?: string;
  notes: string;
  total_items: number;
  total_value_change: number | string;
  created_at: string;
  created_by_name?: string;
  items?: Array<{
    id: string;
    product_name?: string;
    product_sku?: string;
    qty_delta: number;
    unit_cost: number | string;
    serial_number?: string;
    notes?: string;
  }>;
}

function HistoryRow({ adj }: { adj: HistoryAdj }) {
  const [expanded, setExpanded] = useState(false);
  const meta    = REASON_META[adj.reason] ?? REASON_META.OTHER;
  const Icon    = meta.icon;
  const valueChange = Number(adj.total_value_change ?? 0);
  const isPositive  = valueChange >= 0;

  return (
    <>
      <tr
        className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        {/* Reference */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-400 transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-xs font-semibold text-[#1E293B]">{adj.reference_number}</span>
          </div>
        </td>

        {/* Type */}
        <td className="px-4 py-3">
          <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border', meta.bg, meta.color)}>
            <Icon className="h-3 w-3" />
            {adj.reason_display ?? meta.label}
          </span>
        </td>

        {/* Branch */}
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-xs text-muted-600">{adj.branch_name ?? '—'}</span>
        </td>

        {/* Items / value */}
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-semibold text-[#1E293B]">{adj.total_items}</span>
        </td>
        <td className="px-4 py-3 text-right hidden md:table-cell">
          <span className={clsx('text-sm font-bold', isPositive ? 'text-emerald-600' : 'text-rose-600')}>
            {isPositive ? '+' : ''}{formatCurrency(Math.abs(valueChange))}
          </span>
        </td>

        {/* Date */}
        <td className="px-4 py-3 hidden lg:table-cell text-right">
          <span className="text-xs text-muted-500">{formatDate(adj.created_at, 'DD MMM YYYY, HH:mm')}</span>
          {adj.created_by_name && (
            <p className="text-[10px] text-muted-400 mt-0.5">{adj.created_by_name}</p>
          )}
        </td>

        {/* Status */}
        <td className="px-4 py-3 text-right">
          <span className={clsx(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            adj.status === 'POSTED'    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            adj.status === 'CANCELLED' ? 'bg-red-50 text-red-700 border border-red-200' :
                                          'bg-muted-100 text-muted-600 border border-muted-200',
          )}>
            {adj.status === 'POSTED' && <CheckCircle className="h-3 w-3" />}
            {adj.status}
          </span>
        </td>
      </tr>

      {/* Expanded item detail */}
      {expanded && adj.items && adj.items.length > 0 && (
        <tr>
          <td colSpan={7} className="px-0 py-0 border-b border-muted-100">
            <div className="bg-muted-50/60 px-8 py-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-500 mb-2">Line Items</p>
              {adj.items.map((item) => {
                const delta = item.qty_delta ?? 0;
                return (
                  <div key={item.id} className="flex items-center gap-4 rounded-xl bg-white border border-muted-100 px-3 py-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-[#1E293B] truncate">{item.product_name ?? '—'}</p>
                      <p className="text-[11px] text-muted-400 font-mono">{item.product_sku ?? ''}</p>
                    </div>
                    {item.serial_number && (
                      <span className="text-[10px] font-mono bg-muted-100 text-muted-600 rounded px-2 py-0.5">
                        S/N: {item.serial_number}
                      </span>
                    )}
                    <span className={clsx('font-bold text-sm shrink-0', delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                      {delta > 0 ? '+' : ''}{delta} units
                    </span>
                    <span className="text-xs text-muted-500 hidden sm:inline">
                      {formatCurrency(Number(item.unit_cost ?? 0))} / unit
                    </span>
                  </div>
                );
              })}
              {adj.notes && (
                <p className="text-xs text-muted-500 pt-1 pl-1 italic">Note: {adj.notes}</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function StockAdjustmentsPage() {
  // ── Store access ──────────────────────────────────────────────────────────
  const stockEnabled   = useSettingsStore((s) => s.stockEnabled);
  const products       = useProductStore((s) => s.products);
  const branches       = useBranchStore((s) => s.branches);
  const activeBranchId = useBranchStore((s) => s.activeBranchId);
  const branchStock    = useBranchInventoryStore((s) => s.stock);
  const fetchBranchStock = useBranchInventoryStore((s) => s.fetchBranchStock);
  const { user }       = useAuthStore();

  // inventory store — for local/demo mode persistence
  const addAdjustment  = useInventoryStore((s) => s.addAdjustment);
  const addMovement    = useInventoryStore((s) => s.addMovement);
  const adjustStock    = useBranchInventoryStore((s) => s.adjustStock);

  const userRole = (user?.role ?? 'CASHIER').toUpperCase();
  const roleConfig = useMemo(() => getRoleConfig(userRole), [userRole]);
  const canAdjust  = roleConfig.canAdjustStock;

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedBranchId, setSelectedBranchId] = useState<string>(activeBranchId ?? '');
  const [selectedReason,   setSelectedReason]   = useState<AdjReason | ''>('');
  const [globalNotes,      setGlobalNotes]       = useState('');
  const [lineItems,        setLineItems]         = useState<LineItem[]>([]);
  const [productSearch,    setProductSearch]     = useState('');
  const [saving,           setSaving]            = useState(false);
  const [saveError,        setSaveError]         = useState('');
  const [saveSuccess,      setSaveSuccess]       = useState('');

  // ── History state ─────────────────────────────────────────────────────────
  const [history,        setHistory]        = useState<HistoryAdj[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearch,  setHistorySearch]  = useState('');
  const [activeTab,      setActiveTab]      = useState<'new' | 'history'>('new');

  // Keep branch in sync with the global active branch switcher
  useEffect(() => {
    if (activeBranchId && !selectedBranchId) setSelectedBranchId(activeBranchId);
  }, [activeBranchId, selectedBranchId]);

  // Fetch stock levels when branch changes
  useEffect(() => {
    if (selectedBranchId) void fetchBranchStock(selectedBranchId);
  }, [selectedBranchId, fetchBranchStock]);

  // ── Current stock helper (branch-aware) ───────────────────────────────────
  const currentStock = useCallback(
    (productId: string): number => {
      if (selectedBranchId && branchStock[selectedBranchId]?.[productId]) {
        return branchStock[selectedBranchId][productId].qty;
      }
      return products.find((p) => p.id === productId)?.stockQuantity ?? 0;
    },
    [selectedBranchId, branchStock, products],
  );

  // ── Projected stock after adjustment ─────────────────────────────────────
  function projectedStock(item: LineItem): number {
    if (!selectedReason) return item.currentStock;
    const isPos = POSITIVE_REASONS.includes(selectedReason as AdjReason);
    return Math.max(0, item.currentStock + (isPos ? item.qty : -item.qty));
  }

  // ── Product search ────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const term = productSearch.toLowerCase().trim();
    if (term.length < 1) return [];
    return products
      .filter(
        (p) =>
          p.isActive &&
          !lineItems.some((li) => li.productId === p.id) &&
          (p.name.toLowerCase().includes(term) ||
            p.sku.toLowerCase().includes(term) ||
            (p.barcode ?? '').includes(term)),
      )
      .slice(0, 8);
  }, [products, productSearch, lineItems]);

  function addLineItem(productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setLineItems((prev) => [
      ...prev,
      {
        id: genLocalId(),
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        qty: 1,
        currentStock: currentStock(product.id),
        unitCost: product.cost ?? 0,
        serialNumber: '',
        notes: '',
      },
    ]);
    setProductSearch('');
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  }

  function updateLineItem<K extends keyof LineItem>(id: string, field: K, value: LineItem[K]) {
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li)),
    );
  }

  // ── Fetch history ─────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    if (isLocalSession()) {
      // In demo mode, pull from the local inventory store
      const stored = useInventoryStore.getState().adjustments;
      // Map local store shape → HistoryAdj shape
      const mapped: HistoryAdj[] = stored.map((a) => ({
        id: a.id,
        reference_number: a.reference,
        reason: a.reason as AdjReason,
        reason_display: REASON_META[a.reason as AdjReason]?.label ?? a.reason,
        status: a.status,
        branch_name: undefined,
        notes: a.notes,
        total_items: 1,
        total_value_change: a.qtyDelta * a.unitCost,
        created_at: a.createdAt,
        created_by_name: undefined,
        items: [{
          id: a.id + '-item',
          product_name: a.productName,
          product_sku: a.sku,
          qty_delta: a.qtyDelta,
          unit_cost: a.unitCost,
          serial_number: '',
        }],
      }));
      setHistory(mapped);
      return;
    }
    setHistoryLoading(true);
    try {
      const params: Record<string, string> = { ordering: '-created_at' };
      if (selectedBranchId) params.branch = selectedBranchId;
      const res = await api.get<{ results?: HistoryAdj[]; } | HistoryAdj[]>(
        '/inventory/stock-adjustments/',
        { params },
      );
      const results = Array.isArray(res.data)
        ? res.data
        : (res.data as { results?: HistoryAdj[] }).results ?? [];
      setHistory(results);
    } catch {
      // silently ignore — history is supplementary
    } finally {
      setHistoryLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    if (activeTab === 'history') void fetchHistory();
  }, [activeTab, fetchHistory]);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess('');

    if (!selectedReason) { setSaveError('Please select an adjustment type.'); return; }
    if (!selectedBranchId) { setSaveError('Please select a branch.'); return; }
    if (lineItems.length === 0) { setSaveError('Add at least one product.'); return; }

    // High-risk role check (client-side guard — backend also validates)
    if (REASON_META[selectedReason as AdjReason]?.highRisk && !HIGH_RISK_ROLES.has(userRole)) {
      setSaveError(`Your role (${userRole}) is not authorised to post "${REASON_META[selectedReason as AdjReason].label}" adjustments.`);
      return;
    }

    setSaving(true);

    // ── Local / demo mode ────────────────────────────────────────────────────
    if (isLocalSession()) {
      const today     = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const count     = useInventoryStore.getState().adjustments.length + 1;
      const reference = `ADJ-${today}-${String(count).padStart(4, '0')}`;
      const isPos     = POSITIVE_REASONS.includes(selectedReason as AdjReason);
      const meta      = REASON_META[selectedReason as AdjReason];

      lineItems.forEach((li) => {
        const delta = isPos ? li.qty : -li.qty;
        // Update local branch stock
        adjustStock(selectedBranchId, li.productId, delta, selectedReason);
        // Record in inventory store
        addAdjustment({
          reference,
          reason: selectedReason as 'DAMAGED' | 'EXPIRED' | 'LOST' | 'FOUND' | 'WRONG_ENTRY' | 'OTHER',
          productName: li.productName,
          sku: li.sku,
          productId: li.productId,
          qtyExpected: li.currentStock,
          qtyActual: li.currentStock + delta,
          qtyDelta: delta,
          unitCost: li.unitCost,
          notes: globalNotes,
          status: 'POSTED',
        });
        addMovement({
          productId: li.productId,
          productName: li.productName,
          sku: li.sku,
          type: meta.delta === 'positive' ? 'ADJUSTMENT' : 'ADJUSTMENT',
          qtyDelta: delta,
          unitCost: li.unitCost,
          reference,
          notes: `[${selectedReason}] ${globalNotes}`.trim(),
        });
      });

      setSaving(false);
      setSaveSuccess(`Adjustment ${reference} posted successfully.`);
      setLineItems([]);
      setSelectedReason('');
      setGlobalNotes('');
      return;
    }

    // ── Real backend ──────────────────────────────────────────────────────────
    // Resolve a warehouse ID — use first warehouse or placeholder
    let warehouseId = '';
    try {
      const wRes = await api.get<{ results?: { id: string }[]; } | { id: string }[]>(
        '/branches/warehouses/',
        { params: { branch: selectedBranchId, limit: 1 } },
      );
      const wList = Array.isArray(wRes.data)
        ? wRes.data
        : (wRes.data as { results?: { id: string }[] }).results ?? [];
      warehouseId = wList[0]?.id ?? '';
    } catch { /* warehouse lookup failed — continue */ }

    const payload = {
      branch:    selectedBranchId,
      warehouse: warehouseId || selectedBranchId, // fallback: use branch id (backend will 400 if invalid)
      reason:    selectedReason,
      notes:     globalNotes,
      items:     lineItems.map((li) => ({
        product:       li.productId,
        qty:           li.qty,
        unit_cost:     li.unitCost,
        serial_number: li.serialNumber,
        notes:         li.notes,
      })),
    };

    try {
      await api.post('/inventory/stock-adjustments/post_adjustment/', payload);
      setSaveSuccess('Adjustment posted successfully. Stock has been updated.');
      setLineItems([]);
      setSelectedReason('');
      setGlobalNotes('');
      // Refresh branch stock
      if (selectedBranchId) void fetchBranchStock(selectedBranchId);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown } };
      const data = axiosErr.response?.data;
      if (data && typeof data === 'object') {
        const msg = (data as Record<string, string[] | string>);
        const first = Object.values(msg)[0];
        setSaveError(Array.isArray(first) ? first[0] : String(first));
      } else {
        setSaveError('Failed to post adjustment. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Filtered history ──────────────────────────────────────────────────────
  const filteredHistory = useMemo(() => {
    const term = historySearch.toLowerCase().trim();
    if (!term) return history;
    return history.filter(
      (a) =>
        a.reference_number.toLowerCase().includes(term) ||
        (a.reason_display ?? '').toLowerCase().includes(term) ||
        (a.branch_name ?? '').toLowerCase().includes(term) ||
        a.notes.toLowerCase().includes(term),
    );
  }, [history, historySearch]);

  // ── Guard: stock disabled ─────────────────────────────────────────────────
  if (!stockEnabled) return <StockDisabledGuard />;

  // ── Guard: no permission ──────────────────────────────────────────────────
  if (!canAdjust) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 mb-6">
          <Lock className="h-9 w-9 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-page-primary">Access Denied</h2>
        <p className="mt-2 text-sm text-page-secondary max-w-sm">
          Your role does not have permission to view Stock Adjustments.
        </p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Stock Adjustments</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            Record and track all stock changes with a permanent audit trail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle className="h-3.5 w-3.5" /> Stock Enabled
          </span>
        </div>
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex items-center gap-2">
        {(['new', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
              activeTab === tab
                ? 'bg-[#1E293B] text-white shadow-sm'
                : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50',
            )}
          >
            {tab === 'new' ? <><Plus className="h-4 w-4" /> New Adjustment</> : <><ClipboardList className="h-4 w-4" /> History</>}
          </button>
        ))}
      </div>

      {/* ══════════════════ NEW ADJUSTMENT FORM ══════════════════ */}
      {activeTab === 'new' && (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">

          {/* Success / Error banners */}
          {saveSuccess && (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-700 font-medium">{saveSuccess}</p>
              <button type="button" onClick={() => setSaveSuccess('')} className="ml-auto text-emerald-500 hover:text-emerald-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {saveError && (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <p className="text-sm text-red-700 font-medium">{saveError}</p>
              <button type="button" onClick={() => setSaveError('')} className="ml-auto text-red-500 hover:text-red-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Step 1: Branch ── */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">1</span>
              Select Branch
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {branches.filter((b) => b.isActive).map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => setSelectedBranchId(branch.id)}
                  className={clsx(
                    'flex flex-col items-start rounded-xl border p-3 text-left text-sm transition-all',
                    selectedBranchId === branch.id
                      ? 'bg-[#1E293B] border-[#1E293B] text-white shadow-sm'
                      : 'bg-muted-50 border-muted-200 text-muted-700 hover:border-muted-300 hover:bg-muted-100',
                  )}
                >
                  <span className="font-semibold text-xs truncate w-full">{branch.name}</span>
                  <span className={clsx('text-[10px] font-mono', selectedBranchId === branch.id ? 'text-white/70' : 'text-muted-400')}>
                    {branch.code}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Step 2: Adjustment type ── */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">2</span>
              Adjustment Type
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
              {(Object.keys(REASON_META) as AdjReason[]).map((reason) => {
                const isHighRisk  = REASON_META[reason].highRisk;
                const isDisabled  = isHighRisk && !HIGH_RISK_ROLES.has(userRole);
                return (
                  <ReasonCard
                    key={reason}
                    reason={reason}
                    selected={selectedReason === reason}
                    disabled={isDisabled}
                    onSelect={() => setSelectedReason(reason)}
                  />
                );
              })}
            </div>

            {selectedReason && (
              <div className={clsx('mt-3 flex items-start gap-2.5 rounded-xl border px-4 py-3', REASON_META[selectedReason].bg)}>
                <Info className={clsx('h-4 w-4 mt-0.5 shrink-0', REASON_META[selectedReason].color)} />
                <p className={clsx('text-xs leading-relaxed', REASON_META[selectedReason].color)}>
                  <strong>{REASON_META[selectedReason].label}:</strong>{' '}
                  {REASON_META[selectedReason].description}
                  {' '}
                  {POSITIVE_REASONS.includes(selectedReason)
                    ? <span className="font-semibold">This will INCREASE stock.</span>
                    : REASON_META[selectedReason].delta === 'either'
                    ? <span className="font-semibold">Stock will be corrected to match actual count.</span>
                    : <span className="font-semibold">This will DECREASE stock.</span>
                  }
                </p>
              </div>
            )}
          </div>

          {/* ── Step 3: Products ── */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">3</span>
              Products
            </h3>

            {/* Product search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
              <input
                type="text"
                placeholder="Search product name, SKU or barcode…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted-50 border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
              />
              {/* Dropdown results */}
              {searchResults.length > 0 && (
                <div className="absolute left-0 top-full mt-1 z-30 w-full rounded-xl border border-muted-200 bg-white shadow-lg overflow-hidden">
                  {searchResults.map((p) => {
                    const stock = currentStock(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addLineItem(p.id)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted-50 transition-colors border-b border-muted-50 last:border-0"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 shrink-0">
                          <Package className="h-4 w-4 text-blue-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-[#1E293B] truncate">{p.name}</p>
                          <p className="text-[11px] text-muted-400 font-mono">{p.sku}</p>
                        </div>
                        <span className={clsx(
                          'text-xs font-semibold rounded-full px-2 py-0.5 shrink-0',
                          stock === 0 ? 'bg-red-50 text-red-600' :
                          stock <= (p.lowStockThreshold ?? 10) ? 'bg-amber-50 text-amber-600' :
                          'bg-emerald-50 text-emerald-600',
                        )}>
                          {stock} in stock
                        </span>
                        <Plus className="h-4 w-4 text-muted-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Line items table */}
            {lineItems.length > 0 ? (
              <div className="space-y-3">
                {lineItems.map((li) => {
                  const projected = projectedStock(li);
                  const isPos     = selectedReason ? POSITIVE_REASONS.includes(selectedReason as AdjReason) : false;
                  return (
                    <div key={li.id} className="rounded-2xl border border-muted-200 bg-muted-50/50 p-4 space-y-3">
                      {/* Product name + current stock */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sm text-[#1E293B]">{li.productName}</p>
                          <p className="text-[11px] text-muted-400 font-mono">{li.sku}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLineItem(li.id)}
                          className="text-muted-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Stock effect preview */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="bg-white border border-muted-200 rounded-lg px-2 py-1 font-mono text-muted-700">
                          Current: <strong>{li.currentStock}</strong>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-400" />
                        <span className={clsx(
                          'rounded-lg px-2 py-1 font-mono font-bold border',
                          projected < li.currentStock ? 'bg-red-50 border-red-200 text-red-700' :
                          projected > li.currentStock ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                          'bg-muted-50 border-muted-200 text-muted-600',
                        )}>
                          New: {projected}
                          {' '}
                          {projected < li.currentStock
                            ? <span className="inline-flex items-center gap-0.5"><Minus className="h-2.5 w-2.5" />{li.currentStock - projected}</span>
                            : projected > li.currentStock
                            ? <span className="inline-flex items-center gap-0.5"><Plus className="h-2.5 w-2.5" />{projected - li.currentStock}</span>
                            : null}
                        </span>
                        {isPos
                          ? <ArrowUpCircle className="h-3.5 w-3.5 text-emerald-500" />
                          : <ArrowDownCircle className="h-3.5 w-3.5 text-red-500" />}
                      </div>

                      {/* Qty + Cost + Serial */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Quantity *</label>
                          <input
                            type="number"
                            min={1}
                            value={li.qty}
                            onChange={(e) => updateLineItem(li.id, 'qty', Math.max(1, parseInt(e.target.value, 10) || 1))}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-bold text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Unit Cost</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={li.unitCost}
                            onChange={(e) => updateLineItem(li.id, 'unitCost', parseFloat(e.target.value) || 0)}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">
                            Serial / IMEI{' '}
                            <span className="font-normal text-muted-400">(optional)</span>
                          </label>
                          <input
                            type="text"
                            placeholder="e.g. 353123450012345"
                            value={li.serialNumber}
                            onChange={(e) => updateLineItem(li.id, 'serialNumber', e.target.value)}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center py-10 text-center text-muted-400">
                <Package className="h-10 w-10 mb-3 text-muted-300" />
                <p className="text-sm font-medium">No products added yet</p>
                <p className="text-xs mt-1">Search above to add products to this adjustment</p>
              </div>
            )}
          </div>

          {/* ── Step 4: Notes + Submit ── */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">4</span>
              Reason / Notes
            </h3>
            <textarea
              rows={3}
              placeholder="Describe why this adjustment is being made…"
              value={globalNotes}
              onChange={(e) => setGlobalNotes(e.target.value)}
              className="w-full rounded-xl border border-muted-200 bg-muted-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none"
            />

            {/* Summary row */}
            {lineItems.length > 0 && selectedReason && (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-600">
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">
                  {lineItems.length} product{lineItems.length !== 1 ? 's' : ''}
                </span>
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">
                  Type: {REASON_META[selectedReason].label}
                </span>
                <span className={clsx(
                  'rounded-lg px-3 py-1.5 font-semibold',
                  POSITIVE_REASONS.includes(selectedReason as AdjReason)
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700',
                )}>
                  Total Δ: {lineItems.reduce((s, li) => {
                    const d = POSITIVE_REASONS.includes(selectedReason as AdjReason) ? li.qty : -li.qty;
                    return s + d;
                  }, 0)} units
                </span>
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">
                  Value: {formatCurrency(lineItems.reduce((s, li) => {
                    const d = POSITIVE_REASONS.includes(selectedReason as AdjReason) ? li.qty : -li.qty;
                    return s + Math.abs(d * li.unitCost);
                  }, 0))}
                </span>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit"
                disabled={saving || lineItems.length === 0 || !selectedReason || !selectedBranchId}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all shadow-sm',
                  saving || lineItems.length === 0 || !selectedReason || !selectedBranchId
                    ? 'bg-muted-300 cursor-not-allowed'
                    : 'bg-[#1E293B] hover:bg-[#0F172A] active:scale-[0.98]',
                )}
              >
                {saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Posting…</>
                ) : (
                  <><CheckCircle className="h-4 w-4" /> Post Adjustment</>
                )}
              </button>
              <button
                type="button"
                onClick={() => { setLineItems([]); setSelectedReason(''); setGlobalNotes(''); setSaveError(''); setSaveSuccess(''); }}
                className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-4 py-2.5 text-sm font-medium text-muted-600 hover:bg-muted-50 transition-all"
              >
                <X className="h-4 w-4" /> Clear
              </button>
            </div>
          </div>
        </form>
      )}

      {/* ══════════════════ HISTORY TAB ══════════════════ */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Search + Refresh */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
              <input
                type="text"
                placeholder="Search reference, type or branch…"
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
              />
            </div>
            <button
              type="button"
              onClick={() => void fetchHistory()}
              disabled={historyLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-3 py-2 text-sm text-muted-600 hover:bg-muted-50 transition-all"
            >
              <RefreshCw className={clsx('h-4 w-4', historyLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
            {historyLoading ? (
              <div className="flex items-center justify-center py-16 gap-3 text-muted-400">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Loading history…</span>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center text-muted-400">
                <ClipboardList className="h-10 w-10 mb-3 text-muted-300" />
                <p className="text-sm font-medium">No adjustments found</p>
                <p className="text-xs mt-1">
                  {historySearch ? 'Try a different search term' : 'Create your first adjustment using the "New Adjustment" tab'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-muted-100 bg-muted-50/50">
                      <th className="text-left font-semibold text-muted-600 px-4 py-3">Reference</th>
                      <th className="text-left font-semibold text-muted-600 px-4 py-3">Type</th>
                      <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Branch</th>
                      <th className="text-center font-semibold text-muted-600 px-4 py-3">Items</th>
                      <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Value Δ</th>
                      <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date / By</th>
                      <th className="text-right font-semibold text-muted-600 px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHistory.map((adj) => (
                      <HistoryRow key={adj.id} adj={adj} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-400 text-center">
            Showing {filteredHistory.length} adjustment{filteredHistory.length !== 1 ? 's' : ''}.
            Stock movement records are permanent and cannot be deleted.
          </p>
        </div>
      )}
    </div>
  );
}
