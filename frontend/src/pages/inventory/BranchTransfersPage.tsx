/**
 * BranchTransfersPage
 *
 * Available ONLY when Inventory Mode = STOCK_ENABLED.
 * Supports two transfer workflows:
 *   1. Physical Collection — staff from receiving branch collects in person
 *      (single action: complete_collection)
 *   2. Delivery / Dispatch — REQUESTED → APPROVED → IN_TRANSIT → RECEIVED → COMPLETED
 *
 * Discrepancies (sent ≠ received) are flagged and must be resolved by a Manager+.
 *
 * Route: /inventory/transfers
 */

import {
  useState,
  useMemo,
  useEffect,
  useCallback,
} from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  History,
  Info,
  Loader2,
  Lock,
  Package,
  Plus,
  RefreshCw,
  Search,
  SendHorizonal,
  ShieldAlert,
  ShieldOff,
  Trash2,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore }         from '@/stores/settings.store';
import { useProductStore }          from '@/stores/product.store';
import { useBranchStore }           from '@/stores/branch.store';
import { useBranchInventoryStore }  from '@/stores/branchInventory.store';
import { useAuthStore }             from '@/stores/auth.store';
import { getRoleConfig }            from '@/utils/permissions';
import { formatCurrency, formatDate } from '@/utils/format';
import api from '@/services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type TransferStatus =
  | 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT'
  | 'RECEIVED'  | 'COMPLETED' | 'CANCELLED'
  | 'DRAFT'     | 'SENT';     // legacy

type TransferMethod = 'PHYSICAL_COLLECTION' | 'DELIVERY' | 'OTHER';

type Tab = 'new' | 'pending' | 'in_transit' | 'receive' | 'history';

interface TransferItem {
  id: string;
  product:      string;
  product_name?: string;
  product_sku?:  string;
  qty_sent:     number;
  qty_received: number;
  unit_cost:    number | string;
  serial_number?: string;
  condition?:    string;
  discrepancy?:  number;
}

interface Transfer {
  id: string;
  reference_number:  string;
  status:            TransferStatus;
  status_display?:   string;
  transfer_method:   TransferMethod;
  method_display?:   string;
  from_branch:       string;
  to_branch:         string;
  from_branch_name?: string;
  to_branch_name?:   string;
  from_branch_code?: string;
  to_branch_code?:   string;
  notes:             string;
  total_items:       number;
  total_value:       number | string;
  total_discrepancy?: number;
  has_discrepancy:   boolean;
  discrepancy_notes?: string;
  discrepancy_resolved: boolean;
  created_at:        string;
  created_by_name?:  string;
  approved_by_name?: string;
  released_by_name?: string;
  received_by_name?: string;
  items?:            TransferItem[];
}

interface LineItem {
  _localId:     string;
  productId:    string;
  productName:  string;
  sku:          string;
  qty:          number;
  currentStock: number;
  unitCost:     number;
  serialNumber: string;
  condition:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
  REQUESTED:  { label: 'Requested',  color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',     icon: ClipboardList   },
  APPROVED:   { label: 'Approved',   color: 'text-teal-700',   bg: 'bg-teal-50 border-teal-200',     icon: CheckCircle     },
  IN_TRANSIT: { label: 'In Transit', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',   icon: Truck           },
  RECEIVED:   { label: 'Received',   color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200', icon: ClipboardCheck  },
  COMPLETED:  { label: 'Completed',  color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200',icon: CheckCircle    },
  CANCELLED:  { label: 'Cancelled',  color: 'text-red-700',    bg: 'bg-red-50 border-red-200',       icon: X               },
  DRAFT:      { label: 'Draft',      color: 'text-muted-600',  bg: 'bg-muted-50 border-muted-200',   icon: ClipboardList   },
  SENT:       { label: 'Sent',       color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',   icon: Truck           },
};

const METHOD_META: Record<TransferMethod, { label: string; icon: typeof Truck; desc: string }> = {
  PHYSICAL_COLLECTION: {
    label: 'Physical Collection',
    icon:  UserCheck,
    desc:  'Staff from the receiving branch physically collects the stock.',
  },
  DELIVERY: {
    label: 'Delivery / Dispatch',
    icon:  Truck,
    desc:  'Stock is dispatched and received through a delivery workflow.',
  },
  OTHER: {
    label: 'Other',
    icon:  ArrowLeftRight,
    desc:  'Another transfer method (specify in notes).',
  },
};

const HIGH_RISK_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'MANAGER']);

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

function genId() {
  return `local-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
      <h2 className="text-xl font-bold text-page-primary">Branch Transfers Unavailable</h2>
      <p className="mt-2 text-sm text-page-secondary max-w-sm leading-relaxed">
        Branch Transfers are only available when your business is set to{' '}
        <strong>Stock Enabled</strong> mode. Go to <strong>Settings → Inventory</strong>.
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.REQUESTED;
  const Icon = meta.icon;
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', meta.bg, meta.color)}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

function DiscrepancyBadge({ transfer }: { transfer: Transfer }) {
  if (!transfer.has_discrepancy) return null;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold',
      transfer.discrepancy_resolved
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-rose-50 border-rose-200 text-rose-700',
    )}>
      <ShieldAlert className="h-3 w-3" />
      {transfer.discrepancy_resolved ? 'Discrepancy Resolved' : 'Discrepancy'}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Transfer row with expand
// ─────────────────────────────────────────────────────────────────────────────

function TransferRow({
  transfer,
  canApprove,
  canSend,
  canReceive,
  canResolve,
  canCancel,
  onAction,
}: {
  transfer: Transfer;
  canApprove: boolean;
  canSend: boolean;
  canReceive: boolean;
  canResolve: boolean;
  canCancel: boolean;
  onAction: (action: string, transfer: Transfer) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const methodMeta = METHOD_META[transfer.transfer_method] ?? METHOD_META.DELIVERY;
  const MethodIcon = methodMeta.icon;

  return (
    <>
      <tr
        className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
        onClick={() => setExpanded((p) => !p)}
      >
        {/* Ref */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={clsx('text-muted-400 transition-transform duration-150', expanded && 'rotate-90')}>
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
            <span className="font-mono text-xs font-semibold text-[#1E293B]">{transfer.reference_number}</span>
          </div>
        </td>
        {/* Route */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-700">
            <span className="font-semibold">{transfer.from_branch_name ?? transfer.from_branch_code ?? '—'}</span>
            <ArrowRight className="h-3 w-3 text-muted-400 shrink-0" />
            <span className="font-semibold">{transfer.to_branch_name ?? transfer.to_branch_code ?? '—'}</span>
          </div>
        </td>
        {/* Method */}
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-600">
            <MethodIcon className="h-3.5 w-3.5" />
            {methodMeta.label}
          </span>
        </td>
        {/* Items */}
        <td className="px-4 py-3 text-center">
          <span className="text-sm font-semibold text-[#1E293B]">{transfer.total_items}</span>
        </td>
        {/* Value */}
        <td className="px-4 py-3 text-right hidden md:table-cell">
          <span className="text-sm font-semibold text-[#1E293B]">{formatCurrency(Number(transfer.total_value ?? 0))}</span>
        </td>
        {/* Status + discrepancy */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1 items-end">
            <StatusBadge status={transfer.status} />
            <DiscrepancyBadge transfer={transfer} />
          </div>
        </td>
        {/* Date */}
        <td className="px-4 py-3 text-right hidden lg:table-cell">
          <span className="text-xs text-muted-500">{formatDate(transfer.created_at, 'DD MMM YYYY, HH:mm')}</span>
          {transfer.created_by_name && (
            <p className="text-[10px] text-muted-400 mt-0.5">{transfer.created_by_name}</p>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={7} className="px-0 py-0 border-b border-muted-100">
            <div className="bg-muted-50/60 px-8 py-4 space-y-3">

              {/* People trail */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-600">
                {transfer.created_by_name  && <span>Created by: <strong>{transfer.created_by_name}</strong></span>}
                {transfer.approved_by_name && <span>· Approved by: <strong>{transfer.approved_by_name}</strong></span>}
                {transfer.released_by_name && <span>· Released by: <strong>{transfer.released_by_name}</strong></span>}
                {transfer.received_by_name && <span>· Received by: <strong>{transfer.received_by_name}</strong></span>}
              </div>

              {/* Discrepancy banner */}
              {transfer.has_discrepancy && (
                <div className={clsx(
                  'flex items-start gap-3 rounded-xl border px-4 py-3',
                  transfer.discrepancy_resolved
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-rose-50 border-rose-200',
                )}>
                  <ShieldAlert className={clsx('h-4 w-4 mt-0.5 shrink-0', transfer.discrepancy_resolved ? 'text-emerald-600' : 'text-rose-600')} />
                  <div>
                    <p className={clsx('text-xs font-bold', transfer.discrepancy_resolved ? 'text-emerald-700' : 'text-rose-700')}>
                      {transfer.discrepancy_resolved ? 'Discrepancy Resolved' : 'Transfer Discrepancy Detected'}
                    </p>
                    {transfer.discrepancy_notes && (
                      <p className="text-xs mt-0.5 text-muted-600">{transfer.discrepancy_notes}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Line items */}
              {transfer.items && transfer.items.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-500">Line Items</p>
                  {transfer.items.map((item) => {
                    const diff = item.qty_sent - item.qty_received;
                    return (
                      <div key={item.id} className="flex items-center gap-4 rounded-xl bg-white border border-muted-100 px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-[#1E293B] truncate">{item.product_name ?? '—'}</p>
                          <p className="text-[11px] text-muted-400 font-mono">{item.product_sku ?? ''}</p>
                        </div>
                        {item.serial_number && (
                          <span className="text-[10px] font-mono bg-muted-100 text-muted-600 rounded px-2 py-0.5 shrink-0">
                            S/N: {item.serial_number}
                          </span>
                        )}
                        {item.condition && (
                          <span className="text-[10px] bg-blue-50 text-blue-600 rounded px-2 py-0.5 shrink-0">
                            {item.condition}
                          </span>
                        )}
                        <div className="text-xs text-right shrink-0 space-y-0.5">
                          <p className="text-muted-600">Sent: <strong className="text-[#1E293B]">{item.qty_sent}</strong></p>
                          {item.qty_received > 0 && (
                            <p className="text-muted-600">Received: <strong className={clsx(diff > 0 ? 'text-rose-600' : 'text-emerald-600')}>{item.qty_received}</strong></p>
                          )}
                          {diff > 0 && (
                            <p className="text-rose-600 font-bold">Diff: -{diff}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Notes */}
              {transfer.notes && (
                <p className="text-xs text-muted-500 italic pl-1">Note: {transfer.notes}</p>
              )}

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                {canApprove && ['REQUESTED', 'DRAFT'].includes(transfer.status) && (
                  <button onClick={() => onAction('approve', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-teal-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-teal-700 transition-colors">
                    <CheckCircle className="h-3.5 w-3.5" /> Approve
                  </button>
                )}
                {canSend && ['APPROVED', 'REQUESTED'].includes(transfer.status) && transfer.transfer_method !== 'PHYSICAL_COLLECTION' && (
                  <button onClick={() => onAction('send', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-600 transition-colors">
                    <SendHorizonal className="h-3.5 w-3.5" /> Dispatch
                  </button>
                )}
                {canSend && ['APPROVED', 'REQUESTED'].includes(transfer.status) && transfer.transfer_method === 'PHYSICAL_COLLECTION' && (
                  <button onClick={() => onAction('complete_collection', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 transition-colors">
                    <UserCheck className="h-3.5 w-3.5" /> Confirm Collection
                  </button>
                )}
                {canReceive && ['IN_TRANSIT', 'SENT'].includes(transfer.status) && (
                  <button onClick={() => onAction('receive', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-purple-700 transition-colors">
                    <ClipboardCheck className="h-3.5 w-3.5" /> Record Receipt
                  </button>
                )}
                {canResolve && transfer.has_discrepancy && !transfer.discrepancy_resolved && transfer.status === 'RECEIVED' && (
                  <button onClick={() => onAction('resolve', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-rose-700 transition-colors">
                    <ShieldAlert className="h-3.5 w-3.5" /> Resolve Discrepancy
                  </button>
                )}
                {canCancel && ['REQUESTED', 'APPROVED', 'DRAFT'].includes(transfer.status) && (
                  <button onClick={() => onAction('cancel', transfer)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 px-3 py-1.5 text-xs font-semibold hover:bg-red-100 transition-colors">
                    <X className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Receive modal
// ─────────────────────────────────────────────────────────────────────────────

function ReceiveModal({
  transfer,
  onClose,
  onDone,
}: {
  transfer: Transfer;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qtyMap, setQtyMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    (transfer.items ?? []).forEach((it) => { m[it.id] = it.qty_sent; });
    return m;
  });
  const [notes,   setNotes]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit() {
    setSaving(true);
    setError('');
    try {
      const items = Object.entries(qtyMap).map(([id, qty]) => ({
        transfer_item_id: id,
        qty_received: qty,
      }));
      await api.post(`/inventory/stock-transfers/${transfer.id}/receive_transfer/`, { notes, items });
      onDone();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: unknown } };
      const d  = ae.response?.data;
      if (d && typeof d === 'object') {
        const first = Object.values(d as Record<string, string | string[]>)[0];
        setError(Array.isArray(first) ? first[0] : String(first));
      } else {
        setError('Failed to record receipt. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  const hasDiscrepancy = (transfer.items ?? []).some((it) => (qtyMap[it.id] ?? it.qty_sent) !== it.qty_sent);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-muted-100">
          <div>
            <h3 className="text-base font-bold text-[#1E293B]">Record Receipt</h3>
            <p className="text-xs text-muted-500 mt-0.5">{transfer.reference_number}</p>
          </div>
          <button onClick={onClose} className="text-muted-400 hover:text-[#1E293B] transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-muted-500">
            Enter the <strong>actual quantity received</strong> for each item.
            Any difference from the sent quantity will be flagged as a discrepancy.
          </p>

          {(transfer.items ?? []).map((item) => {
            const received = qtyMap[item.id] ?? item.qty_sent;
            const diff     = item.qty_sent - received;
            return (
              <div key={item.id} className="rounded-xl border border-muted-200 bg-muted-50/50 p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold text-[#1E293B]">{item.product_name ?? '—'}</p>
                    <p className="text-[11px] text-muted-400 font-mono">{item.product_sku ?? ''}</p>
                  </div>
                  <span className="text-xs text-muted-500 shrink-0">Sent: <strong>{item.qty_sent}</strong></span>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-600 font-medium shrink-0">Received:</label>
                  <input
                    type="number"
                    min={0}
                    max={item.qty_sent}
                    value={received}
                    onChange={(e) => setQtyMap((m) => ({ ...m, [item.id]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                    className="w-24 h-8 rounded-lg border border-muted-200 px-3 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                  />
                  {diff > 0 && (
                    <span className="text-xs font-bold text-rose-600">
                      -{diff} missing
                    </span>
                  )}
                  {diff === 0 && received === item.qty_sent && (
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                  )}
                </div>
              </div>
            );
          })}

          {hasDiscrepancy && (
            <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
              <ShieldAlert className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
              <p className="text-xs text-rose-700 font-medium">
                Discrepancy detected. The transfer will be marked as RECEIVED with a discrepancy
                flag until a Manager resolves it.
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-600 block mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about the receipt…"
              className="w-full rounded-xl border border-muted-200 bg-muted-50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-muted-100 flex gap-3">
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] text-white py-2.5 text-sm font-semibold hover:bg-[#0F172A] transition-colors disabled:opacity-50"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><ClipboardCheck className="h-4 w-4" /> Confirm Receipt</>}
          </button>
          <button onClick={onClose} className="rounded-xl border border-muted-200 px-4 py-2.5 text-sm text-muted-600 hover:bg-muted-50 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolve modal
// ─────────────────────────────────────────────────────────────────────────────

function ResolveModal({
  transfer,
  onClose,
  onDone,
}: {
  transfer: Transfer;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit() {
    if (!notes.trim()) { setError('Please provide a resolution explanation.'); return; }
    setSaving(true);
    try {
      await api.post(`/inventory/stock-transfers/${transfer.id}/resolve_discrepancy/`, { notes });
      onDone();
    } catch (err: unknown) {
      setError('Failed to resolve discrepancy.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-muted-100">
          <h3 className="text-base font-bold text-[#1E293B]">Resolve Discrepancy</h3>
          <button onClick={onClose} className="text-muted-400 hover:text-[#1E293B]"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3">
            <p className="text-xs text-rose-700 font-medium">Transfer: {transfer.reference_number}</p>
            {transfer.discrepancy_notes && (
              <p className="text-xs text-rose-600 mt-1">{transfer.discrepancy_notes}</p>
            )}
          </div>
          <p className="text-xs text-muted-500">
            Stock that was actually received has already been credited to{' '}
            <strong>{transfer.to_branch_name}</strong>. Resolving will mark this transfer as
            COMPLETED. Explain the resolution below.
          </p>
          <div>
            <label className="text-xs font-semibold text-muted-600 block mb-1">Resolution explanation *</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 1 unit was damaged in transit and has been written off."
              className="w-full rounded-xl border border-muted-200 bg-muted-50 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-muted-100 flex gap-3">
          <button
            onClick={() => void handleSubmit()}
            disabled={saving}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 text-white py-2.5 text-sm font-semibold hover:bg-rose-700 transition-colors disabled:opacity-50"
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle className="h-4 w-4" /> Resolve & Complete</>}
          </button>
          <button onClick={onClose} className="rounded-xl border border-muted-200 px-4 py-2.5 text-sm text-muted-600 hover:bg-muted-50 transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function BranchTransfersPage() {
  const stockEnabled   = useSettingsStore((s) => s.stockEnabled);
  const products       = useProductStore((s) => s.products);
  const branches       = useBranchStore((s) => s.branches);
  const activeBranchId = useBranchStore((s) => s.activeBranchId);
  const branchStock    = useBranchInventoryStore((s) => s.stock);
  const fetchBranchStock = useBranchInventoryStore((s) => s.fetchBranchStock);
  const transferStockLocal = useBranchInventoryStore((s) => s.transferStock);
  const { user } = useAuthStore();

  const userRole   = (user?.role ?? 'CASHIER').toUpperCase();
  const roleConfig = useMemo(() => getRoleConfig(userRole), [userRole]);
  const canTransfer = roleConfig.canTransferStock;
  const canApprove  = HIGH_RISK_ROLES.has(userRole);
  const canResolve  = HIGH_RISK_ROLES.has(userRole);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [fromBranchId,   setFromBranchId]   = useState(activeBranchId ?? '');
  const [toBranchId,     setToBranchId]     = useState('');
  const [fromWarehouseId,setFromWarehouseId]= useState('');
  const [toWarehouseId,  setToWarehouseId]  = useState('');
  const [method,         setMethod]         = useState<TransferMethod>('DELIVERY');
  const [notes,          setNotes]          = useState('');
  const [lineItems,      setLineItems]      = useState<LineItem[]>([]);
  const [productSearch,  setProductSearch]  = useState('');
  const [saving,         setSaving]         = useState(false);
  const [saveError,      setSaveError]      = useState('');
  const [saveSuccess,    setSaveSuccess]    = useState('');

  // ── Transfers list state ───────────────────────────────────────────────────
  const [transfers,     setTransfers]     = useState<Transfer[]>([]);
  const [listLoading,   setListLoading]   = useState(false);
  const [listSearch,    setListSearch]    = useState('');
  const [activeTab,     setActiveTab]     = useState<Tab>('new');

  // ── Modal state ────────────────────────────────────────────────────────────
  const [receiveTarget,  setReceiveTarget]  = useState<Transfer | null>(null);
  const [resolveTarget,  setResolveTarget]  = useState<Transfer | null>(null);
  const [actionSaving,   setActionSaving]   = useState<string | null>(null); // transferId being actioned

  // Keep fromBranch in sync with global switcher
  useEffect(() => {
    if (activeBranchId && !fromBranchId) setFromBranchId(activeBranchId);
  }, [activeBranchId, fromBranchId]);

  // Fetch warehouses when branch changes
  const fetchWarehouses = useCallback(async (branchId: string, setter: (id: string) => void) => {
    if (!branchId || isLocalSession()) return;
    try {
      const res = await api.get<{ results?: { id: string }[] } | { id: string }[]>(
        '/branches/warehouses/', { params: { branch: branchId, limit: 1 } }
      );
      const list = Array.isArray(res.data) ? res.data : (res.data as { results?: { id: string }[] }).results ?? [];
      if (list[0]?.id) setter(list[0].id);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => { void fetchWarehouses(fromBranchId, setFromWarehouseId); }, [fromBranchId, fetchWarehouses]);
  useEffect(() => { void fetchWarehouses(toBranchId,   setToWarehouseId);   }, [toBranchId,   fetchWarehouses]);

  useEffect(() => {
    if (fromBranchId) void fetchBranchStock(fromBranchId);
  }, [fromBranchId, fetchBranchStock]);

  // ── Current stock helper ───────────────────────────────────────────────────
  const currentStock = useCallback((productId: string) => {
    if (fromBranchId && branchStock[fromBranchId]?.[productId]) {
      return branchStock[fromBranchId][productId].qty;
    }
    return products.find((p) => p.id === productId)?.stockQuantity ?? 0;
  }, [fromBranchId, branchStock, products]);

  // ── Product search ─────────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const term = productSearch.toLowerCase().trim();
    if (term.length < 1) return [];
    return products
      .filter(p =>
        p.isActive &&
        !lineItems.some(li => li.productId === p.id) &&
        (p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? '').includes(term))
      )
      .slice(0, 8);
  }, [products, productSearch, lineItems]);

  function addLineItem(productId: string) {
    const p = products.find(pr => pr.id === productId);
    if (!p) return;
    setLineItems(prev => [...prev, {
      _localId: genId(),
      productId: p.id, productName: p.name, sku: p.sku,
      qty: 1, currentStock: currentStock(p.id),
      unitCost: p.cost ?? 0, serialNumber: '', condition: '',
    }]);
    setProductSearch('');
  }

  function removeLineItem(id: string) {
    setLineItems(prev => prev.filter(li => li._localId !== id));
  }

  function updateItem<K extends keyof LineItem>(id: string, field: K, value: LineItem[K]) {
    setLineItems(prev => prev.map(li => li._localId === id ? { ...li, [field]: value } : li));
  }

  // ── Fetch transfers ────────────────────────────────────────────────────────
  const fetchTransfers = useCallback(async (statusFilter?: string) => {
    if (isLocalSession()) { setTransfers([]); return; }
    setListLoading(true);
    try {
      const params: Record<string, string> = { ordering: '-created_at' };
      if (statusFilter) params.status = statusFilter;
      const res = await api.get<{ results?: Transfer[] } | Transfer[]>(
        '/inventory/stock-transfers/', { params }
      );
      const list = Array.isArray(res.data) ? res.data : (res.data as { results?: Transfer[] }).results ?? [];
      setTransfers(list);
    } catch { /* silently ignore */ }
    finally { setListLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'pending')    void fetchTransfers('REQUESTED,APPROVED');
    else if (activeTab === 'in_transit') void fetchTransfers('IN_TRANSIT,SENT');
    else if (activeTab === 'receive')    void fetchTransfers('IN_TRANSIT,SENT,RECEIVED');
    else if (activeTab === 'history')    void fetchTransfers();
  }, [activeTab, fetchTransfers]);

  // ── Action handler ─────────────────────────────────────────────────────────
  async function handleAction(action: string, transfer: Transfer) {
    if (action === 'receive')  { setReceiveTarget(transfer); return; }
    if (action === 'resolve')  { setResolveTarget(transfer); return; }

    setActionSaving(transfer.id);
    try {
      if (action === 'approve') {
        await api.post(`/inventory/stock-transfers/${transfer.id}/approve_transfer/`);
      } else if (action === 'send') {
        await api.post(`/inventory/stock-transfers/${transfer.id}/send_transfer/`);
        // Update local branch store
        transfer.items?.forEach(item => {
          transferStockLocal(transfer.from_branch, transfer.to_branch, item.product, item.qty_sent, transfer.reference_number);
        });
      } else if (action === 'complete_collection') {
        await api.post(`/inventory/stock-transfers/${transfer.id}/complete_collection/`);
        transfer.items?.forEach(item => {
          transferStockLocal(transfer.from_branch, transfer.to_branch, item.product, item.qty_sent, transfer.reference_number);
        });
      } else if (action === 'cancel') {
        await api.post(`/inventory/stock-transfers/${transfer.id}/cancel_transfer/`);
      }
      // Refresh the list
      if (activeTab === 'pending')     void fetchTransfers('REQUESTED,APPROVED');
      else if (activeTab === 'in_transit') void fetchTransfers('IN_TRANSIT,SENT');
      else void fetchTransfers();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } };
      alert(ae.response?.data?.error ?? 'Action failed. Please try again.');
    } finally {
      setActionSaving(null);
    }
  }

  // ── Submit new transfer ────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess('');
    if (!fromBranchId)          { setSaveError('Select a source branch.'); return; }
    if (!toBranchId)            { setSaveError('Select a destination branch.'); return; }
    if (fromBranchId === toBranchId) { setSaveError('Cannot transfer to the same branch.'); return; }
    if (lineItems.length === 0) { setSaveError('Add at least one product.'); return; }

    setSaving(true);

    if (isLocalSession()) {
      // Demo mode: apply immediately via store
      lineItems.forEach(li => {
        transferStockLocal(fromBranchId, toBranchId, li.productId, li.qty, `TRF-DEMO-${Date.now()}`);
      });
      setSaving(false);
      setSaveSuccess('Transfer created (demo mode — stock updated locally).');
      setLineItems([]);
      setNotes('');
      return;
    }

    const payload = {
      from_branch:    fromBranchId,
      to_branch:      toBranchId,
      from_warehouse: fromWarehouseId || fromBranchId,
      to_warehouse:   toWarehouseId   || toBranchId,
      transfer_method: method,
      notes,
      items: lineItems.map(li => ({
        product:       li.productId,
        qty:           li.qty,
        unit_cost:     li.unitCost,
        serial_number: li.serialNumber,
        condition:     li.condition,
      })),
    };

    try {
      await api.post('/inventory/stock-transfers/create_transfer/', payload);
      setSaveSuccess(`Transfer created (${METHOD_META[method].label}). ${
        method === 'PHYSICAL_COLLECTION'
          ? 'Awaiting approval then confirmation of collection.'
          : 'Awaiting approval and dispatch.'
      }`);
      setLineItems([]);
      setNotes('');
    } catch (err: unknown) {
      const ae = err as { response?: { data?: unknown } };
      const d = ae.response?.data;
      if (d && typeof d === 'object') {
        const first = Object.values(d as Record<string, string | string[]>)[0];
        setSaveError(Array.isArray(first) ? first[0] : String(first));
      } else {
        setSaveError('Failed to create transfer. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filteredTransfers = useMemo(() => {
    const term = listSearch.toLowerCase().trim();
    if (!term) return transfers;
    return transfers.filter(t =>
      t.reference_number.toLowerCase().includes(term) ||
      (t.from_branch_name ?? '').toLowerCase().includes(term) ||
      (t.to_branch_name   ?? '').toLowerCase().includes(term) ||
      (t.status_display   ?? '').toLowerCase().includes(term)
    );
  }, [transfers, listSearch]);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!stockEnabled) return <StockDisabledGuard />;

  if (!canTransfer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 mb-6">
          <Lock className="h-9 w-9 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-page-primary">Access Denied</h2>
        <p className="mt-2 text-sm text-page-secondary max-w-sm">
          Your role does not have permission to view Branch Transfers.
        </p>
      </div>
    );
  }

  const activeBranches = branches.filter(b => b.isActive);

  // ── Shared transfer table ──────────────────────────────────────────────────
  function TransfersTable({ statusFilter }: { statusFilter?: string }) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
            <input
              type="text"
              placeholder="Search reference, branch…"
              value={listSearch}
              onChange={(e) => setListSearch(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
            />
          </div>
          <button
            onClick={() => void fetchTransfers(statusFilter)}
            disabled={listLoading}
            className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-3 py-2 text-sm text-muted-600 hover:bg-muted-50 transition-all"
          >
            <RefreshCw className={clsx('h-4 w-4', listLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          {listLoading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-muted-400">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : filteredTransfers.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-center text-muted-400">
              <ArrowLeftRight className="h-10 w-10 mb-3 text-muted-300" />
              <p className="text-sm font-medium">
                {isLocalSession() ? 'No transfer history in demo mode' : 'No transfers found'}
              </p>
              <p className="text-xs mt-1">
                {listSearch ? 'Try a different search' : 'Create a transfer using the New Transfer tab'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-muted-100 bg-muted-50/50">
                    <th className="text-left font-semibold text-muted-600 px-4 py-3">Reference</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3">Route</th>
                    <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Method</th>
                    <th className="text-center font-semibold text-muted-600 px-4 py-3">Items</th>
                    <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Value</th>
                    <th className="text-right font-semibold text-muted-600 px-4 py-3">Status</th>
                    <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransfers.map((t) => (
                    <TransferRow
                      key={t.id}
                      transfer={t}
                      canApprove={canApprove && !actionSaving}
                      canSend={canTransfer && !actionSaving}
                      canReceive={canTransfer && !actionSaving}
                      canResolve={canResolve && !actionSaving}
                      canCancel={canApprove && !actionSaving}
                      onAction={handleAction}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-400 text-center">
          {filteredTransfers.length} transfer{filteredTransfers.length !== 1 ? 's' : ''}.
          All stock movements are permanent and cannot be deleted.
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Modals */}
      {receiveTarget && (
        <ReceiveModal
          transfer={receiveTarget}
          onClose={() => setReceiveTarget(null)}
          onDone={() => {
            setReceiveTarget(null);
            void fetchTransfers(activeTab === 'in_transit' ? 'IN_TRANSIT,SENT' : undefined);
          }}
        />
      )}
      {resolveTarget && (
        <ResolveModal
          transfer={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onDone={() => {
            setResolveTarget(null);
            void fetchTransfers();
          }}
        />
      )}

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Branch Transfers</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            Move stock between branches with a full audit trail
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 self-start sm:self-auto">
          <CheckCircle className="h-3.5 w-3.5" /> Stock Enabled
        </span>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
        {([
          { id: 'new'        as Tab, label: 'New Transfer',  icon: Plus          },
          { id: 'pending'    as Tab, label: 'Pending',       icon: ClipboardList },
          { id: 'in_transit' as Tab, label: 'In Transit',    icon: Truck         },
          { id: 'receive'    as Tab, label: 'Receive',       icon: ClipboardCheck},
          { id: 'history'    as Tab, label: 'History',       icon: History       },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
              activeTab === id
                ? 'bg-[#1E293B] text-white shadow-sm'
                : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ══════ NEW TRANSFER ══════ */}
      {activeTab === 'new' && (
        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-5">
          {saveSuccess && (
            <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
              <p className="text-sm text-emerald-700 font-medium">{saveSuccess}</p>
              <button type="button" onClick={() => setSaveSuccess('')} className="ml-auto text-emerald-500"><X className="h-4 w-4" /></button>
            </div>
          )}
          {saveError && (
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
              <p className="text-sm text-red-700 font-medium">{saveError}</p>
              <button type="button" onClick={() => setSaveError('')} className="ml-auto text-red-500"><X className="h-4 w-4" /></button>
            </div>
          )}

          {/* Step 1: Route */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">1</span>
              Transfer Route
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-600 block mb-1.5">From Branch *</label>
                <select
                  value={fromBranchId}
                  onChange={(e) => setFromBranchId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-muted-200 bg-muted-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                >
                  <option value="">Select source branch…</option>
                  {activeBranches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-600 block mb-1.5">To Branch *</label>
                <select
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  className="w-full h-10 rounded-xl border border-muted-200 bg-muted-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                >
                  <option value="">Select destination branch…</option>
                  {activeBranches
                    .filter(b => b.id !== fromBranchId)
                    .map(b => (
                      <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                    ))
                  }
                </select>
              </div>
            </div>
            {fromBranchId && toBranchId && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-600">
                <span className="font-semibold text-[#1E293B]">{activeBranches.find(b => b.id === fromBranchId)?.name}</span>
                <ArrowRight className="h-4 w-4 text-muted-400" />
                <span className="font-semibold text-[#1E293B]">{activeBranches.find(b => b.id === toBranchId)?.name}</span>
              </div>
            )}
          </div>

          {/* Step 2: Method */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">2</span>
              Transfer Method
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(Object.keys(METHOD_META) as TransferMethod[]).map((m) => {
                const meta = METHOD_META[m];
                const Icon = meta.icon;
                const sel  = method === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={clsx(
                      'flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-all',
                      sel
                        ? 'bg-[#1E293B] border-[#1E293B] text-white shadow-md'
                        : 'bg-muted-50 border-muted-200 text-muted-700 hover:border-muted-300',
                    )}
                  >
                    <Icon className={clsx('h-5 w-5', sel ? 'text-white' : 'text-muted-500')} />
                    <span className={clsx('text-xs font-bold', sel ? 'text-white' : 'text-[#1E293B]')}>{meta.label}</span>
                    <span className={clsx('text-[10px] leading-relaxed', sel ? 'text-white/70' : 'text-muted-400')}>{meta.desc}</span>
                  </button>
                );
              })}
            </div>

            {/* Workflow indicator */}
            <div className="mt-4 flex items-center gap-1.5 flex-wrap text-[10px] font-semibold text-muted-500">
              {method === 'PHYSICAL_COLLECTION' ? (
                <>
                  {['REQUESTED','APPROVED','COMPLETED'].map((s, i, arr) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <StatusBadge status={s} />
                      {i < arr.length - 1 && <ChevronDown className="h-3 w-3 rotate-[-90deg]" />}
                    </span>
                  ))}
                </>
              ) : (
                <>
                  {['REQUESTED','APPROVED','IN_TRANSIT','RECEIVED','COMPLETED'].map((s, i, arr) => (
                    <span key={s} className="flex items-center gap-1.5">
                      <StatusBadge status={s} />
                      {i < arr.length - 1 && <ChevronDown className="h-3 w-3 rotate-[-90deg]" />}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* Step 3: Products */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-4 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">3</span>
              Products
            </h3>

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
              <input
                type="text"
                placeholder="Search product name, SKU or barcode…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl bg-muted-50 border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
              />
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
                        )}>{stock} in stock</span>
                        <Plus className="h-4 w-4 text-muted-400 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Line items */}
            {lineItems.length > 0 ? (
              <div className="space-y-3">
                {lineItems.map((li) => (
                  <div key={li._localId} className="rounded-2xl border border-muted-200 bg-muted-50/50 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-sm text-[#1E293B]">{li.productName}</p>
                        <p className="text-[11px] text-muted-400 font-mono">{li.sku}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-500">Available: <strong>{li.currentStock}</strong></span>
                        <button type="button" onClick={() => removeLineItem(li._localId)} className="text-muted-400 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {li.qty > li.currentStock && (
                      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Quantity exceeds available stock at source branch
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-500 block mb-1">Qty *</label>
                        <input
                          type="number" min={1}
                          value={li.qty}
                          onChange={(e) => updateItem(li._localId, 'qty', Math.max(1, parseInt(e.target.value, 10) || 1))}
                          className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-bold text-[#1E293B] focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-500 block mb-1">Unit Cost</label>
                        <input
                          type="number" min={0} step="0.01"
                          value={li.unitCost}
                          onChange={(e) => updateItem(li._localId, 'unitCost', parseFloat(e.target.value) || 0)}
                          className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-500 block mb-1">Serial / IMEI</label>
                        <input
                          type="text"
                          placeholder="optional"
                          value={li.serialNumber}
                          onChange={(e) => updateItem(li._localId, 'serialNumber', e.target.value)}
                          className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-500 block mb-1">Condition</label>
                        <input
                          type="text"
                          placeholder="e.g. New"
                          value={li.condition}
                          onChange={(e) => updateItem(li._localId, 'condition', e.target.value)}
                          className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center py-10 text-center text-muted-400">
                <Package className="h-10 w-10 mb-3 text-muted-300" />
                <p className="text-sm font-medium">No products added yet</p>
                <p className="text-xs mt-1">Search above to add products</p>
              </div>
            )}
          </div>

          {/* Step 4: Notes + Submit */}
          <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
            <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-white text-[11px] font-bold">4</span>
              Notes
            </h3>
            <textarea
              rows={2}
              placeholder="Any notes about this transfer…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-muted-200 bg-muted-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none"
            />

            {lineItems.length > 0 && fromBranchId && toBranchId && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-600">
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">{lineItems.length} product{lineItems.length !== 1 ? 's' : ''}</span>
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">
                  Total: {lineItems.reduce((s, li) => s + li.qty, 0)} units
                </span>
                <span className="bg-muted-100 rounded-lg px-3 py-1.5 font-semibold">
                  Value: {formatCurrency(lineItems.reduce((s, li) => s + li.qty * li.unitCost, 0))}
                </span>
              </div>
            )}

            <div className="mt-4 flex gap-3">
              <button
                type="submit"
                disabled={saving || lineItems.length === 0 || !fromBranchId || !toBranchId}
                className={clsx(
                  'inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all shadow-sm',
                  saving || lineItems.length === 0 || !fromBranchId || !toBranchId
                    ? 'bg-muted-300 cursor-not-allowed'
                    : 'bg-[#1E293B] hover:bg-[#0F172A] active:scale-[0.98]',
                )}
              >
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : <><SendHorizonal className="h-4 w-4" /> Create Transfer</>}
              </button>
              <button
                type="button"
                onClick={() => { setLineItems([]); setNotes(''); setSaveError(''); setSaveSuccess(''); }}
                className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-4 py-2.5 text-sm text-muted-600 hover:bg-muted-50 transition-all"
              >
                <X className="h-4 w-4" /> Clear
              </button>
            </div>
          </div>
        </form>
      )}

      {activeTab === 'pending'    && <TransfersTable statusFilter="REQUESTED,APPROVED" />}
      {activeTab === 'in_transit' && <TransfersTable statusFilter="IN_TRANSIT,SENT" />}
      {activeTab === 'receive'    && (
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-2xl bg-purple-50 border border-purple-200 px-4 py-3">
            <Info className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
            <p className="text-xs text-purple-700">
              Expand any IN_TRANSIT transfer below to record the actual quantities received.
              Discrepancies will be flagged for Manager resolution.
            </p>
          </div>
          <TransfersTable statusFilter="IN_TRANSIT,SENT,RECEIVED" />
        </div>
      )}
      {activeTab === 'history'    && <TransfersTable />}
    </div>
  );
}
