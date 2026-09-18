import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Factory, Search, Plus, Phone, Mail, MapPin, X,
  ChevronRight, CreditCard, TrendingUp, User, Package,
  CalendarDays, Trash2, AlertTriangle, Receipt, ArrowDownCircle,
  FileText, ArrowUpCircle, RefreshCw, ExternalLink, Building2,
  Hash, Clock, Paperclip, ImageIcon, ZoomIn, Download,
  ChevronLeft, ChevronRight as ChevronR, Upload, Eye,
  ShoppingBag, Percent, Printer, CheckCircle2, PlusCircle,
  BoxSelect, AlertCircle, Layers, Filter,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency } from '@/utils/format';
import { useSupplierStore,
  type SupplierRecord,
  type SupplierType,
  type SupplierTransaction,
  type SupplierAttachment,
  type SupplierInvoiceItem,
  type TransactionType,
} from '@/stores/supplier.store';
import { useProductStore } from '@/stores/product.store';
import { useUnitStore } from '@/stores/unit.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import * as suppliersService from '@/services/suppliers.service';

/** True when running in local/demo mode (no real backend token) */
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

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1_048_576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1_048_576).toFixed(1)} MB`;
}
function computeInvoiceTotals(items: SupplierInvoiceItem[], taxRate: number) {
  const subtotal = items.reduce((s, it) => s + it.subtotal, 0);
  const taxAmt   = subtotal * (taxRate / 100);
  return { subtotal, taxAmt, total: subtotal + taxAmt };
}

// ─── config ───────────────────────────────────────────────────────────────────
const supplierTypeConfig: Record<string, { label: string; color: string }> = {
  MANUFACTURER: { label: 'Manufacturer', color: 'bg-purple-100 text-purple-700 border border-purple-200' },
  DISTRIBUTOR:  { label: 'Distributor',  color: 'bg-blue-100 text-blue-700 border border-blue-200'       },
  WHOLESALER:   { label: 'Wholesaler',   color: 'bg-emerald-50 text-emerald-700 border border-emerald-200'},
  IMPORTER:     { label: 'Importer',     color: 'bg-amber-100 text-amber-700 border border-amber-200'    },
  LOCAL:        { label: 'Local',        color: 'bg-slate-100 text-slate-600 border border-slate-200'    },
};
const txTypeConfig: Record<TransactionType, { label: string; color: string; icon: React.ElementType; amountColor: string }> = {
  INVOICE:     { label: 'Invoice',     color: 'bg-rose-50 text-rose-700 border border-rose-200',          icon: Receipt,        amountColor: 'text-rose-600'    },
  PAYMENT:     { label: 'Payment',     color: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: ArrowDownCircle,amountColor: 'text-emerald-600' },
  CREDIT_NOTE: { label: 'Credit Note', color: 'bg-blue-50 text-blue-700 border border-blue-200',          icon: FileText,       amountColor: 'text-blue-600'    },
  DEBIT_NOTE:  { label: 'Debit Note',  color: 'bg-amber-50 text-amber-700 border border-amber-200',      icon: ArrowUpCircle,  amountColor: 'text-amber-600'   },
  REFUND:      { label: 'Refund',      color: 'bg-violet-50 text-violet-700 border border-violet-200',   icon: RefreshCw,      amountColor: 'text-violet-600'  },
};
const supplierTypeFilters = [
  { value: 'all', label: 'All' }, { value: 'MANUFACTURER', label: 'Manufacturer' },
  { value: 'DISTRIBUTOR', label: 'Distributor' }, { value: 'WHOLESALER', label: 'Wholesaler' },
  { value: 'IMPORTER', label: 'Importer' }, { value: 'LOCAL', label: 'Local' },
];
const txTypeFilters: { value: TransactionType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'INVOICE', label: 'Invoices' },
  { value: 'PAYMENT', label: 'Payments' }, { value: 'CREDIT_NOTE', label: 'Credit' },
  { value: 'DEBIT_NOTE', label: 'Debit' }, { value: 'REFUND', label: 'Refunds' },
];

// ─── form types ───────────────────────────────────────────────────────────────
interface LineItemDraft {
  productId?: string;
  productName: string;
  sku: string;
  unit: string;       // display name
  unitId?: string;    // system unit store ID
  quantity: string;
  unitCost: string;
}
const emptyLine = (): LineItemDraft => ({ productId: undefined, productName: '', sku: '', unit: '', unitId: undefined, quantity: '', unitCost: '' });
interface TxFormData {
  type: TransactionType;
  reference: string;
  amount: string;
  transactionDate: string;
  notes: string;
  taxRate: string;
  lines: LineItemDraft[];
  attachments: SupplierAttachment[];
}
const emptyTxForm = (): TxFormData => ({
  type: 'INVOICE', reference: '', amount: '',
  transactionDate: new Date().toISOString().slice(0, 10),
  notes: '', taxRate: '0', lines: [emptyLine()], attachments: [],
});

// ─── AttachmentThumb ──────────────────────────────────────────────────────────
function AttachmentThumb({ att, onRemove, onClick }: { att: SupplierAttachment; onRemove?: () => void; onClick?: () => void }) {
  const isImg = att.mimeType.startsWith('image/');
  return (
    <div className="relative group rounded-xl overflow-hidden border border-muted-200 bg-muted-50 flex flex-col">
      <button type="button" onClick={onClick}
        className="w-full h-24 flex items-center justify-center overflow-hidden bg-muted-100 hover:bg-muted-200 transition-colors relative">
        {isImg
          ? <img src={att.dataUrl} alt={att.fileName} className="w-full h-full object-cover" />
          : <div className="flex flex-col items-center gap-1"><FileText className="h-8 w-8 text-rose-500" /><span className="text-[9px] font-bold text-rose-600 uppercase tracking-wide">PDF</span></div>}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Eye className="h-5 w-5 text-white drop-shadow" />
        </div>
      </button>
      <div className="px-2 py-1.5 flex items-center justify-between gap-1">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[#1E293B] truncate">{att.fileName}</p>
          <p className="text-[9px] text-muted-400">{fmtBytes(att.size)}</p>
        </div>
        {onRemove && (
          <button type="button" onClick={e => { e.stopPropagation(); onRemove(); }}
            className="shrink-0 p-1 rounded-md hover:bg-rose-50 text-muted-400 hover:text-rose-500 transition-colors">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ attachments, startIndex, onClose }: { attachments: SupplierAttachment[]; startIndex: number; onClose: () => void }) {
  const [idx, setIdx] = useState(startIndex);
  const att = attachments[idx];
  if (!att) return null;
  const isImg = att.mimeType.startsWith('image/');
  const dl = () => { const a = document.createElement('a'); a.href = att.dataUrl; a.download = att.fileName; a.click(); };
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/96" onClick={onClose}>
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-black/60" onClick={e => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{att.fileName}</p>
          <p className="text-[11px] text-white/50">{fmtBytes(att.size)} · {idx + 1} / {attachments.length}</p>
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          <button onClick={dl} className="flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center relative overflow-hidden px-14" onClick={e => e.stopPropagation()}>
        {isImg
          ? <img src={att.dataUrl} alt={att.fileName} className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" style={{ maxHeight: 'calc(100vh - 130px)' }} />
          : <embed src={att.dataUrl} type="application/pdf" className="w-full rounded-xl shadow-2xl" style={{ height: 'calc(100vh - 180px)' }} />}
        {attachments.length > 1 && <>
          <button onClick={() => setIdx(i => (i - 1 + attachments.length) % attachments.length)} className="absolute left-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"><ChevronLeft className="h-5 w-5" /></button>
          <button onClick={() => setIdx(i => (i + 1) % attachments.length)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"><ChevronR className="h-5 w-5" /></button>
        </>}
      </div>
      {attachments.length > 1 && (
        <div className="shrink-0 flex items-center gap-2 overflow-x-auto px-4 py-3 bg-black/60 scrollbar-none" onClick={e => e.stopPropagation()}>
          {attachments.map((a, i) => (
            <button key={i} onClick={() => setIdx(i)} className={clsx('shrink-0 h-14 w-14 rounded-lg overflow-hidden border-2 transition-all', i === idx ? 'border-white opacity-100' : 'border-transparent opacity-50 hover:opacity-75')}>
              {a.mimeType.startsWith('image/') ? <img src={a.dataUrl} alt={a.fileName} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-rose-900 flex items-center justify-center"><FileText className="h-5 w-5 text-rose-300" /></div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FileDropZone ─────────────────────────────────────────────────────────────
function FileDropZone({ onFiles }: { onFiles: (atts: SupplierAttachment[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const readFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const valid = Array.from(files).filter(f => allowed.includes(f.type) && f.size <= 10_485_760);
    if (!valid.length) return;
    Promise.all(valid.map(file => new Promise<SupplierAttachment>(res => {
      const r = new FileReader();
      r.onload = e => res({ fileName: file.name, mimeType: file.type, dataUrl: e.target!.result as string, size: file.size });
      r.readAsDataURL(file);
    }))).then(onFiles);
  }, [onFiles]);
  return (
    <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); readFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={clsx('w-full rounded-xl border-2 border-dashed px-4 py-5 flex flex-col items-center gap-2 cursor-pointer transition-all',
        dragging ? 'border-[#1E293B] bg-[#1E293B]/5' : 'border-muted-200 hover:border-muted-400 hover:bg-muted-50')}>
      <div className={clsx('flex h-10 w-10 items-center justify-center rounded-xl transition-colors', dragging ? 'bg-[#1E293B]/10' : 'bg-muted-100')}>
        <Upload className={clsx('h-5 w-5', dragging ? 'text-[#1E293B]' : 'text-muted-400')} />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-[#1E293B]">{dragging ? 'Drop files here' : 'Attach supplier document'}</p>
        <p className="text-xs text-muted-400 mt-0.5">Drag & drop or click · JPG, PNG, PDF · max 10 MB each</p>
      </div>
      <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="hidden" onChange={e => readFiles(e.target.files)} />
    </div>
  );
}

// ─── InvoiceView ──────────────────────────────────────────────────────────────
function InvoiceView({ tx, supplier, onViewAttachment }: { tx: SupplierTransaction; supplier?: SupplierRecord; onViewAttachment: (i: number) => void }) {
  const items = tx.invoiceItems ?? [];
  const taxRate = tx.taxRate ?? 0;
  const { subtotal, taxAmt, total } = computeInvoiceTotals(items, taxRate);
  const atts = tx.attachments ?? [];
  return (
    <div className="space-y-4">
      {/* header card */}
      <div className="bg-gradient-to-br from-[#1E293B] to-[#334155] rounded-2xl p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="h-4 w-4 text-white/60" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">Supplier Invoice</span>
            </div>
            <p className="text-xl font-bold">{tx.reference}</p>
            {supplier && <p className="text-sm text-white/70 mt-1 flex items-center gap-1.5"><Factory className="h-3.5 w-3.5" />{supplier.name}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-white/50 uppercase tracking-wide font-semibold">Date</p>
            <p className="text-sm font-semibold text-white mt-0.5">{new Date(tx.transactionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {supplier?.tin && <p className="text-[10px] text-white/40 mt-1">TIN: {supplier.tin}</p>}
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-white/15 grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Subtotal', value: formatCurrency(subtotal), cls: 'text-white' },
            { label: `Tax (${taxRate}%)`, value: formatCurrency(taxAmt), cls: 'text-white' },
            { label: 'Total', value: formatCurrency(total), cls: 'text-emerald-300 text-base font-extrabold' },
          ].map(({ label, value, cls }) => (
            <div key={label}>
              <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
              <p className={clsx('text-sm font-bold mt-0.5', cls)}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* line items */}
      {items.length > 0 && (
        <div className="rounded-2xl border border-muted-100 overflow-hidden">
          <div className="px-4 py-2.5 bg-muted-50 border-b border-muted-100 flex items-center gap-2">
            <ShoppingBag className="h-3.5 w-3.5 text-muted-400" />
            <p className="text-xs font-bold text-[#1E293B]">Products Received</p>
            <span className="ml-auto rounded-full bg-muted-200 px-2 py-0.5 text-[10px] font-semibold text-muted-600">{items.length} item{items.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-muted-100">
                  <th className="text-left font-semibold text-muted-500 px-4 py-2.5">Product</th>
                  <th className="text-center font-semibold text-muted-500 px-2 py-2.5">Unit</th>
                  <th className="text-center font-semibold text-muted-500 px-2 py-2.5">Qty</th>
                  <th className="text-right font-semibold text-muted-500 px-3 py-2.5">Unit Cost</th>
                  <th className="text-right font-semibold text-muted-500 px-4 py-2.5">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-[#1E293B]">{it.productName}</p>
                      <p className="text-muted-400 mt-0.5">{it.sku}</p>
                    </td>
                    <td className="px-2 py-2.5 text-center text-muted-500">{it.unit || '—'}</td>
                    <td className="px-2 py-2.5 text-center font-semibold text-[#1E293B]">{it.quantity}</td>
                    <td className="px-3 py-2.5 text-right text-muted-600">{formatCurrency(it.unitCost)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-[#1E293B]">{formatCurrency(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted-50/50">
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-xs text-muted-500 font-semibold">Subtotal</td>
                  <td className="px-4 py-2 text-right text-xs font-semibold text-[#1E293B]">{formatCurrency(subtotal)}</td>
                </tr>
                {taxRate > 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-xs text-muted-500 font-semibold">Tax ({taxRate}%)</td>
                    <td className="px-4 py-2 text-right text-xs font-semibold text-amber-600">{formatCurrency(taxAmt)}</td>
                  </tr>
                )}
                <tr className="border-t border-muted-200">
                  <td colSpan={4} className="px-4 py-2.5 text-right text-sm text-[#1E293B] font-bold">Total</td>
                  <td className="px-4 py-2.5 text-right text-sm font-extrabold text-[#1E293B]">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {tx.notes && (
        <div className="bg-muted-50 rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold text-muted-400 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-[#1E293B] leading-relaxed">{tx.notes}</p>
        </div>
      )}

      {/* attachments */}
      <div>
        <p className="text-xs font-bold text-[#1E293B] mb-2 flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5 text-muted-400" />Supplier Documents
          {atts.length > 0 && <span className="rounded-full bg-muted-100 px-1.5 py-0.5 text-[10px] font-semibold text-muted-600">{atts.length}</span>}
        </p>
        {atts.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {atts.map((a, i) => <AttachmentThumb key={i} att={a} onClick={() => onViewAttachment(i)} />)}
            </div>
            {atts.length === 1 && atts[0].mimeType.startsWith('image/') && (
              <button onClick={() => onViewAttachment(0)} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-muted-200 py-2 text-xs font-semibold text-[#1E293B] hover:bg-muted-50 transition-colors">
                <ZoomIn className="h-3.5 w-3.5" /> View Full Document
              </button>
            )}
            {atts.filter(a => a.mimeType === 'application/pdf').map((a, i) => (
              <a key={i} href={a.dataUrl} download={a.fileName} className="mt-1 flex items-center gap-2 rounded-xl border border-muted-200 px-3 py-2 text-xs font-semibold text-[#1E293B] hover:bg-muted-50 transition-colors">
                <FileText className="h-4 w-4 text-rose-500 shrink-0" /><span className="flex-1 truncate">{a.fileName}</span><Download className="h-3.5 w-3.5 text-muted-400 shrink-0" />
              </a>
            ))}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-muted-200 bg-muted-50/50 px-4 py-5 text-center">
            <ImageIcon className="h-7 w-7 mx-auto mb-1.5 text-muted-200" />
            <p className="text-xs text-muted-400 font-medium">No document attached</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Main page
// ═════════════════════════════════════════════════════════════════════════════
export default function SuppliersPage() {
  // list
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // detail panel — now has two tabs
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierRecord | null>(null);
  const [detailOpen, setDetailOpen]               = useState(false);
  const [detailTab, setDetailTab]                 = useState<'transactions' | 'goods'>('transactions');
  const [txTypeFilter, setTxTypeFilter]           = useState<TransactionType | 'all'>('all');

  // supplied goods tab state
  const [goodsSearch, setGoodsSearch]   = useState('');
  const [goodsUnitFilter, setGoodsUnitFilter] = useState('all');

  // tx detail modal
  const [selectedTx, setSelectedTx] = useState<SupplierTransaction | null>(null);

  // lightbox
  const [lightboxTx, setLightboxTx]       = useState<SupplierTransaction | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  // add-tx
  const [addTxOpen, setAddTxOpen] = useState(false);
  const [txForm,    setTxForm]    = useState<TxFormData>(emptyTxForm());
  const [txFormErr, setTxFormErr] = useState('');

  // product search inside line items
  const [lineSearch,    setLineSearch]    = useState('');
  const [lineSearchIdx, setLineSearchIdx] = useState<number | null>(null);

  // delete
  const [deleteTarget, setDeleteTarget] = useState<SupplierRecord | null>(null);

  // add supplier
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [formData, setFormData] = useState<{
    name: string; code: string; supplierType: SupplierType;
    contactPerson: string; phone: string; email: string;
    address: string; city: string; country: string;
    tin: string; creditLimit: string; creditDays: string; isActive: boolean;
  }>({ name: '', code: '', supplierType: 'LOCAL', contactPerson: '', phone: '', email: '', address: '', city: '', country: 'Ghana', tin: '', creditLimit: '', creditDays: '', isActive: true });

  // stores
  const suppliers             = useSupplierStore(s => s.suppliers);
  const transactions          = useSupplierStore(s => s.transactions);
  const addSupplier           = useSupplierStore(s => s.addSupplier);
  const deleteSupplier        = useSupplierStore(s => s.deleteSupplier);
  const addTransaction        = useSupplierStore(s => s.addTransaction);
  const syncSuppliersFromApi  = useSupplierStore(s => s.syncSuppliersFromApi);

  // ── Fetch suppliers from backend on mount (skipped in local/demo mode) ─────
  useEffect(() => {
    if (isLocalSession()) return;
    suppliersService.fetchSuppliers()
      .then((records) => syncSuppliersFromApi(records))
      .catch(() => { /* silently keep local data — UI still works offline */ });
  }, [syncSuppliersFromApi]);

  const products       = useProductStore(s => s.products);
  const addProduct     = useProductStore(s => s.addProduct);
  const incrementStock = useProductStore(s => s.incrementStock);
  const units          = useUnitStore(s => s.units);

  // ── Branch filter ──────────────────────────────────────────────────────────
  const { filterByBranch, stampBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchSuppliers = filterByBranch(suppliers);

  // ── computed ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:          branchSuppliers.length,
    active:         branchSuppliers.filter(s => s.isActive).length,
    totalOwed:      branchSuppliers.reduce((a, s) => a + s.balance, 0),
    totalPurchases: branchSuppliers.reduce((a, s) => a + s.totalPurchases, 0),
  }), [branchSuppliers, effectiveBranchId]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return branchSuppliers.filter(s =>
      (!searchTerm || s.name.toLowerCase().includes(term) || s.code.toLowerCase().includes(term)
        || s.contactPerson.toLowerCase().includes(term) || s.city.toLowerCase().includes(term))
      && (typeFilter === 'all' || s.supplierType === typeFilter),
    );
  }, [branchSuppliers, searchTerm, typeFilter, effectiveBranchId]);

  const supplierTxAll = useMemo(() => {
    if (!selectedSupplier) return [];
    return [...transactions.filter(t => t.supplierId === selectedSupplier.id)]
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }, [transactions, selectedSupplier]);

  const supplierTxFiltered = useMemo(
    () => txTypeFilter === 'all' ? supplierTxAll : supplierTxAll.filter(t => t.type === txTypeFilter),
    [supplierTxAll, txTypeFilter],
  );

  const liveSupplier = useMemo(
    () => !selectedSupplier ? null : (suppliers.find(s => s.id === selectedSupplier.id) ?? selectedSupplier),
    [suppliers, selectedSupplier],
  );

  // ── ALL supplied goods — flatten every invoice's line items ──
  const allSuppliedGoods = useMemo(() => {
    if (!selectedSupplier) return [];
    // Each entry: the item + which invoice it came from
    const rows: Array<SupplierInvoiceItem & { invoiceRef: string; invoiceDate: string; invoiceId: string }> = [];
    supplierTxAll
      .filter(t => t.type === 'INVOICE' && t.invoiceItems?.length)
      .forEach(t => {
        (t.invoiceItems ?? []).forEach(item => {
          rows.push({ ...item, invoiceRef: t.reference, invoiceDate: t.transactionDate, invoiceId: t.id });
        });
      });
    return rows;
  }, [supplierTxAll, selectedSupplier]);

  // all units that appear across goods (for the filter dropdown)
  const goodsUnits = useMemo(() => {
    const units = new Set(allSuppliedGoods.map(g => g.unit).filter(Boolean));
    return ['all', ...Array.from(units).sort()];
  }, [allSuppliedGoods]);

  // filtered + searched goods
  const filteredGoods = useMemo(() => {
    const term = goodsSearch.toLowerCase().trim();
    return allSuppliedGoods.filter(g => {
      const matchSearch = !term
        || g.productName.toLowerCase().includes(term)
        || g.sku.toLowerCase().includes(term)
        || g.invoiceRef.toLowerCase().includes(term);
      const matchUnit = goodsUnitFilter === 'all' || g.unit === goodsUnitFilter;
      return matchSearch && matchUnit;
    });
  }, [allSuppliedGoods, goodsSearch, goodsUnitFilter]);

  // aggregated by product (for the summary view)
  const goodsSummary = useMemo(() => {
    const map = new Map<string, { productName: string; sku: string; unit: string; totalQty: number; totalCost: number; lastDate: string; count: number }>();
    filteredGoods.forEach(g => {
      const key = g.productId ?? g.sku ?? g.productName;
      const existing = map.get(key);
      if (existing) {
        existing.totalQty  += g.quantity;
        existing.totalCost += g.subtotal;
        existing.count     += 1;
        if (g.invoiceDate > existing.lastDate) existing.lastDate = g.invoiceDate;
      } else {
        map.set(key, { productName: g.productName, sku: g.sku, unit: g.unit, totalQty: g.quantity, totalCost: g.subtotal, lastDate: g.invoiceDate, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [filteredGoods]);

  // invoice draft for the add-tx form
  const invoiceDraft = useMemo(() => {
    if (txForm.type !== 'INVOICE') return null;
    const validLines = txForm.lines.filter(l => l.productName.trim() && parseFloat(l.quantity) > 0 && parseFloat(l.unitCost) > 0);
    const items: SupplierInvoiceItem[] = validLines.map(l => ({
      productId: l.productId, productName: l.productName.trim(),
      sku: l.sku.trim(), unit: l.unit, unitId: l.unitId,
      quantity: parseFloat(l.quantity), unitCost: parseFloat(l.unitCost),
      subtotal: parseFloat(l.quantity) * parseFloat(l.unitCost),
    }));
    const taxRate = parseFloat(txForm.taxRate) || 0;
    return { items, ...computeInvoiceTotals(items, taxRate) };
  }, [txForm]);

  // product suggestions for line item search
  const productSuggestions = useMemo(() => {
    if (!lineSearch.trim()) return [];
    const t = lineSearch.toLowerCase();
    return products.filter(p => p.isActive && (p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t))).slice(0, 8);
  }, [products, lineSearch]);

  // ── handlers ──────────────────────────────────────────────────────────────
  function openDetail(s: SupplierRecord) {
    setSelectedSupplier(s); setTxTypeFilter('all');
    setDetailTab('transactions'); setGoodsSearch(''); setGoodsUnitFilter('all');
    setDetailOpen(true);
  }
  function closeDetail() { setDetailOpen(false); setSelectedSupplier(null); }

  function confirmDelete(s: SupplierRecord) {
    const snap = { ...s }; setDetailOpen(false); setSelectedSupplier(null);
    requestAnimationFrame(() => setDeleteTarget(snap));
  }
  function handleDelete() { if (!deleteTarget) return; deleteSupplier(deleteTarget.id); setDeleteTarget(null); }

  function handleAddSupplier() {
    if (!formData.name.trim() || !formData.code.trim()) return;
    // Local write first (instant feedback)
    addSupplier({ ...formData, creditLimit: Number(formData.creditLimit) || 0, creditDays: Number(formData.creditDays) || 0, isActive: true, branchId: stampBranch });
    // Also persist to backend if connected
    if (!isLocalSession()) {
      void suppliersService.createSupplier({
        name:           formData.name.trim(),
        code:           formData.code.trim(),
        supplier_type:  formData.supplierType,
        contact_person: formData.contactPerson,
        phone:          formData.phone,
        email:          formData.email,
        address:        formData.address,
        city:           formData.city,
        country:        formData.country,
        tin:            formData.tin,
        credit_limit:   Number(formData.creditLimit) || 0,
        credit_days:    Number(formData.creditDays)  || 0,
        is_active:      true,
      }).then((apiRecord) => syncSuppliersFromApi([apiRecord]))
        .catch(() => { /* already saved locally — silently ignore */ });
    }
    setFormData({ name: '', code: '', supplierType: 'LOCAL', contactPerson: '', phone: '', email: '', address: '', city: '', country: 'Ghana', tin: '', creditLimit: '', creditDays: '', isActive: true });
    setAddModalOpen(false);
  }

  function handleAddTransaction() {
    const sup = liveSupplier ?? selectedSupplier;
    if (!sup) return;
    if (!txForm.reference.trim()) { setTxFormErr('Reference is required.'); return; }
    if (!txForm.transactionDate)  { setTxFormErr('Date is required.'); return; }

    if (txForm.type === 'INVOICE') {
      if (!invoiceDraft || invoiceDraft.items.length === 0) { setTxFormErr('Add at least one product line item.'); return; }
      const taxRate = parseFloat(txForm.taxRate) || 0;

      // ── Resolve products: matched → increment stock; unmatched → create new product then increment ──
      const resolvedItems: SupplierInvoiceItem[] = invoiceDraft.items.map(it => {
        if (it.productId) {
          // already in catalog — just increment stock below
          incrementStock(it.productId, it.quantity);
          return it;
        }
        // not in catalog — auto-create the product now
        const newProduct = addProduct({
          name:              it.productName,
          sku:               it.sku || `SUP-${Date.now()}-${Math.random().toString(36).slice(2,6).toUpperCase()}`,
          description:       `Added from supplier invoice ${txForm.reference.trim()}`,
          price:             it.unitCost,   // use supplier cost as initial selling price (can be updated later)
          cost:              it.unitCost,
          stockQuantity:     it.quantity,   // start with what was just received
          lowStockThreshold: 5,
          categoryId:        'other',
          unitId:            it.unitId,
          isActive:          true,
        });
        // return the item with the newly created product's ID so the invoice record links correctly
        return { ...it, productId: newProduct.id };
      });

      addTransaction({
        supplierId: sup.id, supplierName: sup.name, type: 'INVOICE',
        reference: txForm.reference.trim(), amount: invoiceDraft.total,
        balanceAfter: sup.balance + invoiceDraft.total,
        transactionDate: txForm.transactionDate, notes: txForm.notes.trim(),
        taxRate, invoiceItems: resolvedItems,
        attachments: txForm.attachments.length > 0 ? txForm.attachments : undefined,
      });
    } else {
      const rawAmt = parseFloat(txForm.amount);
      if (isNaN(rawAmt) || rawAmt === 0) { setTxFormErr('Enter a valid non-zero amount.'); return; }
      const signed = (['PAYMENT', 'REFUND', 'CREDIT_NOTE'] as TransactionType[]).includes(txForm.type) ? -Math.abs(rawAmt) : Math.abs(rawAmt);
      addTransaction({
        supplierId: sup.id, supplierName: sup.name, type: txForm.type,
        reference: txForm.reference.trim(), amount: signed,
        balanceAfter: sup.balance + signed,
        transactionDate: txForm.transactionDate, notes: txForm.notes.trim(),
        attachments: txForm.attachments.length > 0 ? txForm.attachments : undefined,
      });
    }
    setTxFormErr(''); setTxForm(emptyTxForm()); setAddTxOpen(false);
  }

  function updateLine(idx: number, patch: Partial<LineItemDraft>) {
    setTxForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));
  }
  function removeLine(idx: number) { setTxForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) })); }
  function addLine()               { setTxForm(f => ({ ...f, lines: [...f.lines, emptyLine()] })); }
  function pickProduct(li: number, pid: string) {
    const p = products.find(x => x.id === pid);
    if (!p) return;
    // find the matching unit record so we can store unitId too
    const matchedUnit = p.unitId ? units.find(u => u.id === p.unitId) : undefined;
    updateLine(li, {
      productId:   p.id,
      productName: p.name,
      sku:         p.sku,
      unitCost:    String(p.cost ?? p.price),
      unitId:      matchedUnit?.id,
      unit:        matchedUnit?.name ?? '',
    });
    setLineSearch(''); setLineSearchIdx(null);
  }
  function addAttachmentsToForm(atts: SupplierAttachment[]) { setTxForm(f => ({ ...f, attachments: [...f.attachments, ...atts] })); }
  function removeAttachment(i: number) { setTxForm(f => ({ ...f, attachments: f.attachments.filter((_, j) => j !== i) })); }

  // ─── JSX ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — supplier list</>
              : 'All branches — supplier list'}
          </p>
          <p className="text-sm text-muted-500 mt-0.5">Manage vendor relationships and purchase invoices</p>
        </div>
        <button onClick={() => setAddModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
          <Plus className="h-4 w-4" /> Add Supplier
        </button>
      </div>

      {/* ── stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          { label: 'Total Suppliers', value: stats.total.toString(),               icon: Factory,    color: 'bg-blue-50 text-blue-600',      ring: 'ring-blue-100'    },
          { label: 'Active',          value: stats.active.toString(),              icon: TrendingUp, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Total Owed',      value: formatCurrency(stats.totalOwed),      icon: CreditCard, color: 'bg-rose-50 text-rose-600',      ring: 'ring-rose-100'    },
          { label: 'Total Purchases', value: formatCurrency(stats.totalPurchases), icon: Package,    color: 'bg-purple-50 text-purple-600',  ring: 'ring-purple-100'  },
        ] as const).map(({ label, value, icon: Icon, color, ring }) => (
          <div key={label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-500 truncate">{label}</p>
                <p className="text-xl sm:text-2xl font-bold text-[#1E293B] mt-1 truncate">{value}</p>
              </div>
              <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4', color, ring)}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── list filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search name, code, city…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {supplierTypeFilters.map(f => (
            <button key={f.value} onClick={() => setTypeFilter(f.value)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                typeFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── supplier table ── */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">Supplier</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Contact</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Type</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Purchases</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3">Balance</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Credit Days</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const tc = supplierTypeConfig[s.supplierType] ?? supplierTypeConfig.LOCAL;
                return (
                  <tr key={s.id} onClick={() => openDetail(s)} className="border-b border-muted-50 hover:bg-muted-50/60 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1E293B]/10 text-[#1E293B] shrink-0"><Factory className="h-4 w-4" /></div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1E293B] text-sm truncate">{s.name}</p>
                          <p className="text-xs text-muted-400">{s.code} · {s.city}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-xs text-muted-600 flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" />{s.phone || '—'}</p>
                      <p className="text-xs text-muted-400 mt-0.5">{s.contactPerson || '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', tc.color)}>{tc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right hidden lg:table-cell font-semibold text-[#1E293B]">{formatCurrency(s.totalPurchases)}</td>
                    <td className="px-4 py-3 text-right">
                      {s.balance > 0
                        ? <span className="font-semibold text-rose-600">{formatCurrency(s.balance)}</span>
                        : <span className="text-emerald-600 font-medium text-xs">Settled</span>}
                    </td>
                    <td className="px-4 py-3 text-center hidden md:table-cell text-muted-600 text-sm">{s.creditDays}d</td>
                    <td className="px-4 py-3 text-center"><ChevronRight className="h-4 w-4 text-muted-300" /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-14 text-center">
                  <Factory className="h-10 w-10 mx-auto mb-3 text-muted-200" />
                  <p className="text-sm font-medium text-muted-400">No suppliers found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════
          DETAIL SLIDE-OVER
      ════════════════════════════════════════════════════ */}
      {detailOpen && liveSupplier && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeDetail} />
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col animate-slide-in-right">

            {/* sticky header */}
            <div className="shrink-0 border-b border-muted-100 px-5 py-4 flex items-center justify-between bg-white z-10">
              <h2 className="text-lg font-bold text-[#1E293B]">Supplier Details</h2>
              <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-muted-100 transition-colors"><X className="h-5 w-5 text-muted-500" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* identity */}
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#1E293B]/10 text-[#1E293B]"><Factory className="h-7 w-7" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-bold text-[#1E293B] truncate">{liveSupplier.name}</h3>
                    <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold shrink-0',
                      liveSupplier.isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-muted-100 text-muted-500 border border-muted-200')}>
                      {liveSupplier.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-400 mt-0.5 flex items-center gap-1">
                    <Hash className="h-3 w-3" />{liveSupplier.code}&nbsp;·&nbsp;
                    <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', (supplierTypeConfig[liveSupplier.supplierType] ?? supplierTypeConfig.LOCAL).color)}>
                      {(supplierTypeConfig[liveSupplier.supplierType] ?? supplierTypeConfig.LOCAL).label}
                    </span>
                  </p>
                </div>
              </div>

              {/* contact */}
              <div className="bg-muted-50 rounded-2xl p-4 grid grid-cols-2 gap-3">
                {[
                  { icon: User,   label: 'Contact',  value: liveSupplier.contactPerson },
                  { icon: Phone,  label: 'Phone',    value: liveSupplier.phone         },
                  { icon: Mail,   label: 'Email',    value: liveSupplier.email         },
                  { icon: MapPin, label: 'Location', value: [liveSupplier.city, liveSupplier.country].filter(Boolean).join(', ') },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-start gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-400 uppercase tracking-wide font-semibold">{label}</p>
                      <p className="font-semibold text-[#1E293B] text-xs mt-0.5">{value || '—'}</p>
                    </div>
                  </div>
                ))}
                {liveSupplier.tin && (
                  <div className="flex items-start gap-2 col-span-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-400 mt-0.5 shrink-0" />
                    <div><p className="text-[10px] text-muted-400 uppercase tracking-wide font-semibold">TIN</p><p className="font-semibold text-[#1E293B] text-xs mt-0.5">{liveSupplier.tin}</p></div>
                  </div>
                )}
              </div>

              {/* balance */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Purchases', value: formatCurrency(liveSupplier.totalPurchases), cls: 'text-[#1E293B]',    bg: 'bg-white border border-muted-100'           },
                  { label: 'Paid',      value: formatCurrency(liveSupplier.totalPaid),      cls: 'text-emerald-600', bg: 'bg-white border border-muted-100'           },
                  { label: 'Balance',   value: liveSupplier.balance > 0 ? formatCurrency(liveSupplier.balance) : 'Settled',
                    cls: liveSupplier.balance > 0 ? 'text-rose-600' : 'text-emerald-600',
                    bg:  liveSupplier.balance > 0 ? 'bg-rose-50 border border-rose-200' : 'bg-emerald-50 border border-emerald-200' },
                ].map(({ label, value, cls, bg }) => (
                  <div key={label} className={clsx('rounded-xl p-3 text-center shadow-sm', bg)}>
                    <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">{label}</p>
                    <p className={clsx('text-sm font-bold mt-1', cls)}>{value}</p>
                  </div>
                ))}
              </div>

              {/* credit terms */}
              <div className="flex items-center gap-4 text-xs text-muted-500 bg-muted-50 rounded-xl px-4 py-2.5">
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-muted-400" />Credit limit: <strong className="text-[#1E293B] ml-1">{formatCurrency(liveSupplier.creditLimit)}</strong></span>
                <span className="w-px h-4 bg-muted-200" />
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-muted-400" />Terms: <strong className="text-[#1E293B] ml-1">{liveSupplier.creditDays} days</strong></span>
              </div>

              {/* ── TAB BAR ── */}
              <div className="flex rounded-xl bg-muted-100 p-1 gap-1">
                <button onClick={() => setDetailTab('transactions')}
                  className={clsx('flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all',
                    detailTab === 'transactions' ? 'bg-white text-[#1E293B] shadow-sm' : 'text-muted-500 hover:text-muted-700')}>
                  <Receipt className="h-3.5 w-3.5" /> Transactions
                  {supplierTxAll.length > 0 && <span className="rounded-full bg-muted-200 px-1.5 text-[10px] font-bold">{supplierTxAll.length}</span>}
                </button>
                <button onClick={() => setDetailTab('goods')}
                  className={clsx('flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all',
                    detailTab === 'goods' ? 'bg-white text-[#1E293B] shadow-sm' : 'text-muted-500 hover:text-muted-700')}>
                  <Layers className="h-3.5 w-3.5" /> Supplied Goods
                  {allSuppliedGoods.length > 0 && <span className="rounded-full bg-muted-200 px-1.5 text-[10px] font-bold">{allSuppliedGoods.length}</span>}
                </button>
              </div>

              {/* ══════════ TRANSACTIONS TAB ══════════ */}
              {detailTab === 'transactions' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-[#1E293B] flex items-center gap-1.5">
                      <Receipt className="h-4 w-4 text-muted-400" />All Transactions
                    </h4>
                    <button onClick={() => { setTxForm(emptyTxForm()); setTxFormErr(''); setAddTxOpen(true); }}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#1E293B] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-[#334155] transition-colors">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  </div>

                  {supplierTxAll.length > 0 && (
                    <div className="flex gap-1 overflow-x-auto scrollbar-none pb-0.5">
                      {txTypeFilters.map(f => (
                        <button key={f.value} onClick={() => setTxTypeFilter(f.value)}
                          className={clsx('rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-all shrink-0',
                            txTypeFilter === f.value ? 'bg-[#1E293B] text-white' : 'bg-muted-100 text-muted-500 hover:bg-muted-200')}>
                          {f.label}
                          {f.value !== 'all' && <span className="ml-1 opacity-60">({supplierTxAll.filter(t => t.type === f.value).length})</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    {supplierTxFiltered.map(t => {
                      const cfg = txTypeConfig[t.type];
                      const TxIcon = cfg.icon;
                      return (
                        <button key={t.id} onClick={() => setSelectedTx(t)}
                          className="w-full text-left flex items-center gap-3 bg-white border border-muted-100 hover:border-[#1E293B]/20 hover:bg-muted-50/60 rounded-xl px-3 py-2.5 transition-all group cursor-pointer">
                          <div className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', cfg.color)}><TxIcon className="h-4 w-4" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-[#1E293B] truncate">{t.reference}</p>
                              <span className={clsx('shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', cfg.color)}>{cfg.label}</span>
                              {(t.invoiceItems?.length ?? 0) > 0 && (
                                <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-muted-500 bg-muted-100 rounded-full px-1.5 py-0.5">
                                  <ShoppingBag className="h-2.5 w-2.5" />{t.invoiceItems!.length}
                                </span>
                              )}
                              {(t.attachments?.length ?? 0) > 0 && (
                                <span className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold text-muted-500 bg-muted-100 rounded-full px-1.5 py-0.5">
                                  <Paperclip className="h-2.5 w-2.5" />{t.attachments!.length}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-400 flex items-center gap-1 mt-0.5">
                              <CalendarDays className="h-3 w-3 shrink-0" />
                              {new Date(t.transactionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {t.notes && <span className="ml-1 truncate opacity-70">· {t.notes}</span>}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={clsx('text-sm font-bold', cfg.amountColor)}>{t.amount > 0 ? '+' : ''}{formatCurrency(t.amount)}</p>
                            <p className="text-[10px] text-muted-400 mt-0.5">Bal: {formatCurrency(t.balanceAfter)}</p>
                          </div>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-300 group-hover:text-muted-500 shrink-0 transition-colors" />
                        </button>
                      );
                    })}
                    {supplierTxFiltered.length === 0 && (
                      <div className="text-center py-8 rounded-xl border border-dashed border-muted-200 bg-muted-50/50">
                        <Receipt className="h-8 w-8 mx-auto mb-2 text-muted-200" />
                        <p className="text-sm text-muted-400 font-medium">
                          {txTypeFilter === 'all' ? 'No transactions yet' : `No ${txTypeConfig[txTypeFilter as TransactionType]?.label ?? ''} transactions`}
                        </p>
                        {txTypeFilter === 'all' && (
                          <button onClick={() => { setTxForm(emptyTxForm()); setTxFormErr(''); setAddTxOpen(true); }} className="mt-2 text-xs font-semibold text-[#1E293B] hover:underline">
                            Record first transaction →
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════ SUPPLIED GOODS TAB ══════════ */}
              {detailTab === 'goods' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-[#1E293B] flex items-center gap-1.5 shrink-0">
                      <Layers className="h-4 w-4 text-muted-400" />All Supplied Goods
                    </h4>
                  </div>

                  {/* search + unit filter */}
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-400" />
                      <input type="text" placeholder="Search product, SKU, invoice…" value={goodsSearch}
                        onChange={e => setGoodsSearch(e.target.value)}
                        className="w-full h-9 pl-8 pr-3 rounded-lg bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                    </div>
                    {goodsUnits.length > 2 && (
                      <div className="relative shrink-0">
                        <Filter className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-400 pointer-events-none" />
                        <select value={goodsUnitFilter} onChange={e => setGoodsUnitFilter(e.target.value)}
                          className="h-9 pl-6 pr-7 rounded-lg bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 appearance-none">
                          {goodsUnits.map(u => <option key={u} value={u}>{u === 'all' ? 'All units' : u}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {allSuppliedGoods.length === 0 ? (
                    <div className="text-center py-10 rounded-xl border border-dashed border-muted-200 bg-muted-50/50">
                      <BoxSelect className="h-8 w-8 mx-auto mb-2 text-muted-200" />
                      <p className="text-sm text-muted-400 font-medium">No goods recorded yet</p>
                      <button onClick={() => { setDetailTab('transactions'); setTxForm(emptyTxForm()); setTxFormErr(''); setAddTxOpen(true); }}
                        className="mt-2 text-xs font-semibold text-[#1E293B] hover:underline">Add first invoice →</button>
                    </div>
                  ) : goodsSummary.length === 0 ? (
                    <div className="text-center py-8 rounded-xl border border-dashed border-muted-200 bg-muted-50/50">
                      <Search className="h-8 w-8 mx-auto mb-2 text-muted-200" />
                      <p className="text-sm text-muted-400 font-medium">No goods match your search</p>
                    </div>
                  ) : (
                    <>
                      {/* summary stats */}
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-muted-50 rounded-xl p-2.5 text-center">
                          <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">Products</p>
                          <p className="text-sm font-bold text-[#1E293B] mt-0.5">{goodsSummary.length}</p>
                        </div>
                        <div className="bg-muted-50 rounded-xl p-2.5 text-center">
                          <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">Total Units</p>
                          <p className="text-sm font-bold text-[#1E293B] mt-0.5">{goodsSummary.reduce((a, g) => a + g.totalQty, 0).toLocaleString()}</p>
                        </div>
                        <div className="bg-muted-50 rounded-xl p-2.5 text-center">
                          <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">Total Value</p>
                          <p className="text-sm font-bold text-[#1E293B] mt-0.5">{formatCurrency(goodsSummary.reduce((a, g) => a + g.totalCost, 0))}</p>
                        </div>
                      </div>

                      {/* goods table */}
                      <div className="rounded-2xl border border-muted-100 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-muted-100 bg-muted-50/50">
                                <th className="text-left font-semibold text-muted-500 px-3 py-2.5">Product</th>
                                <th className="text-center font-semibold text-muted-500 px-2 py-2.5">Unit</th>
                                <th className="text-center font-semibold text-muted-500 px-2 py-2.5">Total Qty</th>
                                <th className="text-right font-semibold text-muted-500 px-3 py-2.5">Total Cost</th>
                                <th className="text-right font-semibold text-muted-500 px-3 py-2.5 hidden sm:table-cell">Last Supply</th>
                              </tr>
                            </thead>
                            <tbody>
                              {goodsSummary.map((g, i) => (
                                <tr key={i} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                                  <td className="px-3 py-2.5">
                                    <p className="font-semibold text-[#1E293B] truncate max-w-[140px]">{g.productName}</p>
                                    <p className="text-muted-400 mt-0.5">{g.sku} {g.count > 1 && <span className="text-muted-300">· {g.count} deliveries</span>}</p>
                                  </td>
                                  <td className="px-2 py-2.5 text-center text-muted-500">{g.unit || '—'}</td>
                                  <td className="px-2 py-2.5 text-center font-bold text-[#1E293B]">{g.totalQty.toLocaleString()}</td>
                                  <td className="px-3 py-2.5 text-right font-semibold text-[#1E293B]">{formatCurrency(g.totalCost)}</td>
                                  <td className="px-3 py-2.5 text-right text-muted-500 hidden sm:table-cell">
                                    {new Date(g.lastDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* raw delivery log */}
                      <details className="group">
                        <summary className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-muted-500 hover:text-[#1E293B] transition-colors list-none py-1">
                          <ChevronR className="h-3.5 w-3.5 group-open:rotate-90 transition-transform" />
                          View full delivery log ({filteredGoods.length} line{filteredGoods.length !== 1 ? 's' : ''})
                        </summary>
                        <div className="mt-2 rounded-xl border border-muted-100 overflow-hidden">
                          <div className="overflow-x-auto max-h-64">
                            <table className="w-full text-xs">
                              <thead className="sticky top-0 bg-muted-50 z-10">
                                <tr className="border-b border-muted-100">
                                  <th className="text-left font-semibold text-muted-500 px-3 py-2">Invoice</th>
                                  <th className="text-left font-semibold text-muted-500 px-2 py-2">Date</th>
                                  <th className="text-left font-semibold text-muted-500 px-2 py-2">Product</th>
                                  <th className="text-center font-semibold text-muted-500 px-2 py-2">Unit</th>
                                  <th className="text-center font-semibold text-muted-500 px-2 py-2">Qty</th>
                                  <th className="text-right font-semibold text-muted-500 px-3 py-2">Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredGoods.map((g, i) => (
                                  <tr key={i} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer"
                                    onClick={() => { const tx = supplierTxAll.find(t => t.id === g.invoiceId); if (tx) setSelectedTx(tx); }}>
                                    <td className="px-3 py-2 font-semibold text-[#1E293B]">{g.invoiceRef}</td>
                                    <td className="px-2 py-2 text-muted-500 whitespace-nowrap">{new Date(g.invoiceDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
                                    <td className="px-2 py-2">
                                      <p className="font-medium text-[#1E293B] truncate max-w-[120px]">{g.productName}</p>
                                      <p className="text-muted-400">{g.sku}</p>
                                    </td>
                                    <td className="px-2 py-2 text-center text-muted-500">{g.unit || '—'}</td>
                                    <td className="px-2 py-2 text-center font-semibold text-[#1E293B]">{g.quantity}</td>
                                    <td className="px-3 py-2 text-right font-semibold text-[#1E293B]">{formatCurrency(g.subtotal)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </details>
                    </>
                  )}
                </div>
              )}

              {/* delete */}
              <div className="pt-2 border-t border-muted-100">
                <button onClick={() => confirmDelete(liveSupplier)}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 text-rose-600 px-4 py-2.5 text-sm font-semibold hover:bg-rose-50 transition-colors">
                  <Trash2 className="h-4 w-4" /> Delete Supplier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          TRANSACTION DETAIL MODAL
      ════════════════════════════════════════════════════ */}
      {selectedTx && (() => {
        const cfg = txTypeConfig[selectedTx.type];
        const TxIcon = cfg.icon;
        const isInvoice = selectedTx.type === 'INVOICE' && (selectedTx.invoiceItems?.length ?? 0) > 0;
        const txSupplier = suppliers.find(s => s.id === selectedTx.supplierId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTx(null)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden">
              <div className="shrink-0 border-b border-muted-100 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl', cfg.color)}><TxIcon className="h-5 w-5" /></div>
                  <div>
                    <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">{cfg.label}</p>
                    <p className="text-base font-bold text-[#1E293B] leading-tight">{selectedTx.reference}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isInvoice && <button onClick={() => window.print()} className="p-2 rounded-lg hover:bg-muted-100 transition-colors text-muted-500" title="Print"><Printer className="h-4 w-4" /></button>}
                  <button onClick={() => setSelectedTx(null)} className="p-2 rounded-lg hover:bg-muted-100 transition-colors"><X className="h-5 w-5 text-muted-500" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5 pt-4">
                {isInvoice ? (
                  <InvoiceView tx={selectedTx} supplier={txSupplier} onViewAttachment={i => { setLightboxTx(selectedTx); setLightboxIndex(i); }} />
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Supplier', value: selectedTx.supplierName },
                        { label: 'Date',     value: new Date(selectedTx.transactionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) },
                        { label: 'Amount',   value: `${selectedTx.amount > 0 ? '+' : ''}${formatCurrency(selectedTx.amount)}`, valueClass: cfg.amountColor + ' font-bold' },
                        { label: 'Balance After', value: formatCurrency(selectedTx.balanceAfter) },
                      ].map(({ label, value, valueClass }) => (
                        <div key={label} className="bg-muted-50 rounded-xl px-3 py-2.5">
                          <p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">{label}</p>
                          <p className={clsx('text-sm font-semibold text-[#1E293B] mt-0.5 truncate', valueClass)}>{value}</p>
                        </div>
                      ))}
                    </div>
                    {selectedTx.notes && <div className="bg-muted-50 rounded-xl px-3 py-2.5"><p className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide mb-1">Notes</p><p className="text-sm text-[#1E293B] leading-relaxed">{selectedTx.notes}</p></div>}
                    {(selectedTx.attachments?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-xs font-bold text-[#1E293B] mb-2 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5 text-muted-400" />Documents</p>
                        <div className="grid grid-cols-3 gap-2">
                          {selectedTx.attachments!.map((a, i) => <AttachmentThumb key={i} att={a} onClick={() => { setLightboxTx(selectedTx); setLightboxIndex(i); }} />)}
                        </div>
                      </div>
                    )}
                    <button onClick={() => setSelectedTx(null)} className="w-full rounded-xl bg-[#1E293B] py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">Close</button>
                  </div>
                )}
                {isInvoice && <button onClick={() => setSelectedTx(null)} className="mt-4 w-full rounded-xl bg-[#1E293B] py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">Close</button>}
              </div>
            </div>
          </div>
        );
      })()}

      {/* lightbox */}
      {lightboxTx && (lightboxTx.attachments?.length ?? 0) > 0 && (
        <Lightbox attachments={lightboxTx.attachments!} startIndex={lightboxIndex} onClose={() => setLightboxTx(null)} />
      )}

      {/* ════════════════════════════════════════════════════
          ADD TRANSACTION MODAL
      ════════════════════════════════════════════════════ */}
      {addTxOpen && liveSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAddTxOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[94vh] flex flex-col overflow-hidden">
            <div className="shrink-0 border-b border-muted-100 px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Add Transaction</h3>
                <p className="text-xs text-muted-400 mt-0.5">{liveSupplier.name}</p>
              </div>
              <button onClick={() => setAddTxOpen(false)} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5 text-muted-500" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {txFormErr && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0" />
                  <p className="text-xs font-medium text-rose-700">{txFormErr}</p>
                </div>
              )}

              {/* ── OUTSTANDING BALANCE BANNER ── */}
              {liveSupplier.balance > 0 && (
                <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-amber-800">
                      Outstanding balance: {formatCurrency(liveSupplier.balance)}
                    </p>
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      {liveSupplier.name} still has an unpaid balance. This new transaction will be added on top of the existing balance.
                    </p>
                  </div>
                  {txForm.type !== 'PAYMENT' && (
                    <button type="button"
                      onClick={() => setTxForm(f => ({ ...f, type: 'PAYMENT', amount: String(liveSupplier.balance) }))}
                      className="shrink-0 text-[10px] font-bold text-amber-700 border border-amber-300 rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors whitespace-nowrap">
                      Record Payment
                    </button>
                  )}
                </div>
              )}

              {/* type selector */}
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Transaction Type</label>
                <div className="grid grid-cols-5 gap-2">
                  {(Object.entries(txTypeConfig) as [TransactionType, typeof txTypeConfig[TransactionType]][]).map(([k, v]) => {
                    const TIcon = v.icon;
                    return (
                      <button key={k} type="button"
                        onClick={() => { setTxForm(f => ({ ...f, type: k })); setTxFormErr(''); }}
                        className={clsx('flex flex-col items-center gap-1 rounded-xl py-2.5 px-2 text-[10px] font-semibold border transition-all',
                          txForm.type === k ? `${v.color} ring-2 ring-offset-1 ring-[#1E293B]/30` : 'border-muted-200 text-muted-500 hover:bg-muted-50')}>
                        <TIcon className="h-4 w-4" />{v.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* reference + date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Reference *</label>
                  <input value={txForm.reference} onChange={e => { setTxForm(f => ({ ...f, reference: e.target.value })); setTxFormErr(''); }}
                    placeholder="INV-2024-001"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Date *</label>
                  <input type="date" value={txForm.transactionDate} onChange={e => setTxForm(f => ({ ...f, transactionDate: e.target.value }))}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
              </div>

              {/* ── INVOICE: line items ── */}
              {txForm.type === 'INVOICE' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-600 flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5" /> Products Received *
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-muted-500 flex items-center gap-1"><Percent className="h-3 w-3" /> Tax %</label>
                      <input type="number" min="0" max="100" step="0.5" value={txForm.taxRate}
                        onChange={e => setTxForm(f => ({ ...f, taxRate: e.target.value }))}
                        className="w-16 h-8 px-2 rounded-lg bg-white border border-muted-200 text-xs text-center focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                    </div>
                  </div>

                  {/* column headers — now includes Unit */}
                  <div className="grid grid-cols-[1fr_70px_80px_90px_76px_32px] gap-1.5 px-1">
                    {['Product', 'Unit', 'Qty', 'Unit Cost', 'Subtotal', ''].map(h => (
                      <p key={h} className="text-[10px] font-semibold text-muted-400 uppercase tracking-wide">{h}</p>
                    ))}
                  </div>

                  {/* line rows */}
                  <div className="space-y-2">
                    {txForm.lines.map((line, li) => {
                      const sub = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitCost) || 0);
                      return (
                        <div key={li} className="grid grid-cols-[1fr_70px_80px_90px_76px_32px] gap-1.5 items-center">
                          {/* product search */}
                          <div className="relative">
                            <input
                              value={lineSearchIdx === li ? lineSearch : line.productName}
                              onChange={e => { setLineSearch(e.target.value); setLineSearchIdx(li); updateLine(li, { productName: e.target.value, productId: undefined }); }}
                              onFocus={() => { setLineSearch(line.productName); setLineSearchIdx(li); }}
                              onBlur={() => setTimeout(() => { if (lineSearchIdx === li) setLineSearchIdx(null); }, 150)}
                              placeholder="Product or SKU"
                              className="w-full h-9 px-2.5 rounded-lg bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                            />
                            {lineSearchIdx === li && productSuggestions.length > 0 && (
                              <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-muted-200 shadow-xl z-[60] overflow-hidden max-h-48 overflow-y-auto">
                                {productSuggestions.map(p => (
                                  <button key={p.id} type="button" onMouseDown={() => pickProduct(li, p.id)}
                                    className="w-full text-left flex items-center justify-between px-3 py-2 hover:bg-muted-50 transition-colors">
                                    <div>
                                      <p className="text-xs font-semibold text-[#1E293B]">{p.name}</p>
                                      <p className="text-[10px] text-muted-400">{p.sku} · Stock: {p.stockQuantity}</p>
                                    </div>
                                    <p className="text-xs font-semibold text-muted-600 ml-2 shrink-0">{formatCurrency(p.cost ?? p.price)}</p>
                                  </button>
                                ))}
                              </div>
                            )}
                            {line.productId && <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-emerald-500 pointer-events-none" />}
                          </div>

                          {/* unit dropdown — from system unit store */}
                          <select
                            value={line.unitId ?? ''}
                            onChange={e => {
                              const picked = units.find(u => u.id === e.target.value);
                              updateLine(li, { unitId: picked?.id, unit: picked?.name ?? '' });
                            }}
                            className="h-9 px-1.5 rounded-lg bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                            <option value="">Unit…</option>
                            {units.filter(u => u.isActive).map(u => (
                              <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                            ))}
                          </select>

                          {/* qty */}
                          <input type="number" min="1" step="1" value={line.quantity}
                            onChange={e => updateLine(li, { quantity: e.target.value })}
                            placeholder="Qty"
                            className="w-full h-9 px-2.5 rounded-lg bg-white border border-muted-200 text-xs text-center focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />

                          {/* unit cost */}
                          <input type="number" min="0" step="0.01" value={line.unitCost}
                            onChange={e => updateLine(li, { unitCost: e.target.value })}
                            placeholder="0.00"
                            className="w-full h-9 px-2.5 rounded-lg bg-white border border-muted-200 text-xs text-right focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />

                          {/* subtotal read-only */}
                          <div className="h-9 flex items-center justify-end px-2 rounded-lg bg-muted-50 border border-muted-100">
                            <p className="text-xs font-semibold text-[#1E293B]">{sub > 0 ? formatCurrency(sub) : '—'}</p>
                          </div>

                          {/* remove */}
                          <button type="button" onClick={() => removeLine(li)} disabled={txForm.lines.length === 1}
                            className="h-9 w-8 flex items-center justify-center rounded-lg hover:bg-rose-50 text-muted-300 hover:text-rose-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button type="button" onClick={addLine}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E293B] hover:text-[#334155] transition-colors">
                      <PlusCircle className="h-4 w-4" /> Add line item
                    </button>
                    {invoiceDraft && invoiceDraft.items.length > 0 && (
                      <div className="text-right space-y-0.5">
                        <p className="text-[10px] text-muted-500">Subtotal: <span className="font-semibold text-[#1E293B]">{formatCurrency(invoiceDraft.subtotal)}</span></p>
                        {(parseFloat(txForm.taxRate) || 0) > 0 && <p className="text-[10px] text-muted-500">Tax ({txForm.taxRate}%): <span className="font-semibold text-amber-600">{formatCurrency(invoiceDraft.taxAmt)}</span></p>}
                        <p className="text-sm font-bold text-[#1E293B]">Total: {formatCurrency(invoiceDraft.total)}</p>
                        {liveSupplier.balance > 0 && (
                          <p className="text-[10px] text-rose-500 font-semibold">
                            New balance: {formatCurrency(liveSupplier.balance + invoiceDraft.total)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* non-INVOICE amount */}
              {txForm.type !== 'INVOICE' && (
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Amount (GHS) *</label>
                  <input type="number" min="0.01" step="0.01" value={txForm.amount}
                    onChange={e => { setTxForm(f => ({ ...f, amount: e.target.value })); setTxFormErr(''); }}
                    placeholder="0.00"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-[10px] text-muted-400">
                      {(['PAYMENT', 'REFUND', 'CREDIT_NOTE'] as TransactionType[]).includes(txForm.type) ? '↓ Will reduce balance' : '↑ Will increase balance'}
                    </p>
                    {liveSupplier.balance > 0 && txForm.amount && (
                      <p className="text-[10px] font-semibold text-muted-500">
                        New balance: {formatCurrency(Math.max(0,
                          (['PAYMENT', 'REFUND', 'CREDIT_NOTE'] as TransactionType[]).includes(txForm.type)
                            ? liveSupplier.balance - Math.abs(parseFloat(txForm.amount) || 0)
                            : liveSupplier.balance + Math.abs(parseFloat(txForm.amount) || 0)
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* notes */}
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1 block">Notes</label>
                <textarea rows={2} value={txForm.notes} onChange={e => setTxForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional description…"
                  className="w-full px-3 py-2 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none" />
              </div>

              {/* file upload */}
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />Attach Supplier Document <span className="font-normal text-muted-400">(optional)</span>
                </label>
                {txForm.attachments.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {txForm.attachments.map((att, i) => (
                      <AttachmentThumb key={i} att={att} onRemove={() => removeAttachment(i)}
                        onClick={() => { setLightboxTx({ id: '__preview__', supplierId: '', supplierName: '', type: txForm.type, reference: txForm.reference || 'Preview', amount: 0, balanceAfter: 0, transactionDate: txForm.transactionDate, notes: txForm.notes, attachments: txForm.attachments }); setLightboxIndex(i); }} />
                    ))}
                  </div>
                )}
                <FileDropZone onFiles={addAttachmentsToForm} />
              </div>

              {/* summary banner */}
              {txForm.type === 'INVOICE' && invoiceDraft && invoiceDraft.items.length > 0 && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-emerald-800">{invoiceDraft.items.length} product{invoiceDraft.items.length !== 1 ? 's' : ''} · Total {formatCurrency(invoiceDraft.total)}</p>
                    <p className="text-[10px] text-emerald-600 mt-0.5">
                      {(() => {
                        const matched   = invoiceDraft.items.filter(it => it.productId).length;
                        const newItems  = invoiceDraft.items.length - matched;
                        const parts: string[] = [];
                        if (matched  > 0) parts.push(`${matched} existing product${matched > 1 ? 's' : ''} stock updated`);
                        if (newItems > 0) parts.push(`${newItems} new product${newItems > 1 ? 's' : ''} will be added to catalog`);
                        return parts.join(' · ');
                      })()}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button onClick={() => setAddTxOpen(false)} className="flex-1 rounded-xl border border-muted-200 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">Cancel</button>
                <button onClick={handleAddTransaction} className="flex-1 rounded-xl bg-[#1E293B] py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">Save Transaction</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          DELETE CONFIRMATION
      ════════════════════════════════════════════════════ */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 shrink-0"><AlertTriangle className="h-5 w-5 text-rose-600" /></div>
              <div><h3 className="text-base font-bold text-[#1E293B]">Delete Supplier</h3><p className="text-sm text-muted-500">This action cannot be undone.</p></div>
            </div>
            <p className="text-sm text-muted-600">
              Delete <span className="font-semibold text-[#1E293B]">{deleteTarget.name}</span>?
              {(() => { const n = transactions.filter(t => t.supplierId === deleteTarget.id).length; return n > 0 ? <span className="block mt-1 text-rose-600 font-medium">{n} transaction{n > 1 ? 's' : ''} will also be deleted.</span> : null; })()}
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">Cancel</button>
              <button onClick={handleDelete} className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════
          ADD SUPPLIER MODAL
      ════════════════════════════════════════════════════ */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-[#1E293B]">Add Supplier</h2>
              <button onClick={() => setAddModalOpen(false)} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {([
                  { label: 'Supplier Name *', key: 'name',          placeholder: 'Accra Wholesale Ltd' },
                  { label: 'Code *',          key: 'code',          placeholder: 'SUP-001'             },
                  { label: 'Contact Person',  key: 'contactPerson', placeholder: 'Full name'           },
                  { label: 'Phone',           key: 'phone',         placeholder: '024 000 0000'        },
                  { label: 'Email',           key: 'email',         placeholder: 'vendor@example.com'  },
                  { label: 'City',            key: 'city',          placeholder: 'Accra'               },
                  { label: 'TIN',             key: 'tin',           placeholder: 'C0011223344'         },
                ] as const).map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-muted-600 mb-1 block">{label}</label>
                    <input value={formData[key]} onChange={e => setFormData(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                      className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                  </div>
                ))}
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Type</label>
                  <select value={formData.supplierType} onChange={e => setFormData(f => ({ ...f, supplierType: e.target.value as SupplierType }))}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                    {Object.entries(supplierTypeConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Credit Limit (GHS)</label>
                  <input type="number" min="0" value={formData.creditLimit} onChange={e => setFormData(f => ({ ...f, creditLimit: e.target.value }))} placeholder="0"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Credit Days</label>
                  <input type="number" min="0" value={formData.creditDays} onChange={e => setFormData(f => ({ ...f, creditDays: e.target.value }))} placeholder="30"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setAddModalOpen(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-600 hover:bg-muted-100 transition-colors">Cancel</button>
                <button onClick={handleAddSupplier} disabled={!formData.name.trim() || !formData.code.trim()}
                  className="rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  Add Supplier
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slide-in-right { from{transform:translateX(100%);opacity:0} to{transform:translateX(0);opacity:1} }
        .animate-slide-in-right { animation: slide-in-right 0.22s cubic-bezier(.25,.46,.45,.94) both }
      `}</style>
    </div>
  );
}
