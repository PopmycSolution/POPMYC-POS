import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Truck, Search, X, Package, Check, Clock,
  XCircle, ChevronRight, CalendarDays, CreditCard,
  TrendingUp, FileText, ShoppingCart, Plus, Trash2,
  Upload, Download, AlertCircle, Info, Loader2,
  BarChart2, CheckCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatCurrency, formatDate } from '@/utils/format';
import { usePurchaseStore, type PurchaseOrder, type PurchaseItem } from '@/stores/purchase.store';
import { useBranchFilter } from '@/hooks/useBranchFilter';
import { useBranchStore } from '@/stores/branch.store';
import { useProductStore } from '@/stores/product.store';
import { useSupplierStore } from '@/stores/supplier.store';
import api from '@/services/api';
import * as purchasesService from '@/services/purchases.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Config ────────────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; color: string; icon: typeof Check }> = {
  DRAFT:            { label: 'Draft',    color: 'bg-muted-100 text-muted-600',       icon: FileText  },
  ORDERED:          { label: 'Ordered',  color: 'bg-blue-100 text-blue-700',         icon: Truck     },
  PARTIAL_RECEIVED: { label: 'Partial',  color: 'bg-amber-100 text-amber-700',       icon: Clock     },
  RECEIVED:         { label: 'Received', color: 'bg-emerald-50 text-emerald-600',    icon: Check     },
  CANCELLED:        { label: 'Cancelled',color: 'bg-rose-100 text-rose-600',         icon: XCircle   },
};

const paymentStatusConfig: Record<string, { label: string; color: string }> = {
  UNPAID:  { label: 'Unpaid',  color: 'bg-rose-100 text-rose-600'      },
  PARTIAL: { label: 'Partial', color: 'bg-amber-100 text-amber-700'    },
  PAID:    { label: 'Paid',    color: 'bg-emerald-50 text-emerald-600' },
};

const statusFilters = [
  { value: 'all',              label: 'All Orders' },
  { value: 'DRAFT',            label: 'Draft'      },
  { value: 'ORDERED',          label: 'Ordered'    },
  { value: 'PARTIAL_RECEIVED', label: 'Partial'    },
  { value: 'RECEIVED',         label: 'Received'   },
  { value: 'CANCELLED',        label: 'Cancelled'  },
];

// ── Types ─────────────────────────────────────────────────────────────────────

function blankItem(): Omit<PurchaseItem, 'id' | 'subtotal' | 'receivedQty'> {
  return { productId: undefined, productName: '', sku: '', quantity: 1, unitPrice: 0, expiryDate: null };
}

type DraftItem = Omit<PurchaseItem, 'id' | 'subtotal' | 'receivedQty'>;

interface ReceiveLineItem {
  purchaseOrderItemId?: string;
  productId?: string;
  productName: string;
  sku: string;
  qtyOrdered: number;
  qtyAlreadyReceived: number;
  qtyToReceive: number;
  unitCost: number;
  expiryDate: string;
  batchNumber: string;
  notes: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Batch tracking card shown inside the detail panel */
function BatchTrackingCard({ item }: { item: PurchaseItem }) {
  if (!item.batchReceivedDate && item.batchQtyRemaining == null) return null;
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-2">
      <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1.5">
        <BarChart2 className="h-3.5 w-3.5" /> Batch Tracking
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {item.batchPurchaseDate && (
          <>
            <span className="text-muted-500">Purchase date</span>
            <span className="font-semibold text-[#1E293B]">{formatDate(item.batchPurchaseDate, 'DD MMM YYYY')}</span>
          </>
        )}
        {item.batchReceivedDate && (
          <>
            <span className="text-muted-500">Received date</span>
            <span className="font-semibold text-[#1E293B]">{formatDate(item.batchReceivedDate, 'DD MMM YYYY')}</span>
          </>
        )}
        {item.batchQtyPurchased != null && (
          <>
            <span className="text-muted-500">Qty purchased</span>
            <span className="font-semibold text-[#1E293B]">{item.batchQtyPurchased}</span>
          </>
        )}
        {item.batchQtyRemaining != null && (
          <>
            <span className="text-muted-500">Remaining</span>
            <span className={clsx('font-bold', item.batchQtyRemaining === 0 ? 'text-red-600' : 'text-emerald-600')}>
              {item.batchQtyRemaining === 0 ? '0 — Sold Out' : item.batchQtyRemaining}
            </span>
          </>
        )}
        {item.batchStockOutDate ? (
          <>
            <span className="text-muted-500">Stock-out date</span>
            <span className="font-semibold text-red-600">{formatDate(item.batchStockOutDate, 'DD MMM YYYY')}</span>
          </>
        ) : (
          <>
            <span className="text-muted-500">Stock status</span>
            <span className="font-semibold text-emerald-600">Still in stock</span>
          </>
        )}
        {item.batchDaysToSell != null && (
          <>
            <span className="text-muted-500">Days to sell out</span>
            <span className="font-semibold text-[#1E293B]">{item.batchDaysToSell} days</span>
          </>
        )}
        {item.batchDaysInStock != null && !item.batchIsSoldOut && (
          <>
            <span className="text-muted-500">Days in stock</span>
            <span className="font-semibold text-[#1E293B]">{item.batchDaysInStock} days</span>
          </>
        )}
        {item.expiryDate && (
          <>
            <span className="text-muted-500">Expiry date</span>
            <span className="font-semibold text-amber-700">{formatDate(item.expiryDate, 'DD MMM YYYY')}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function PurchasesPage() {
  const [searchTerm,   setSearchTerm]   = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [detailOpen,   setDetailOpen]   = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [apiError,     setApiError]     = useState('');

  // New Purchase modal state
  const [addModalOpen,    setAddModalOpen]    = useState(false);
  const [formSupplier,    setFormSupplier]    = useState('');
  const [formSupplierId,  setFormSupplierId]  = useState('');
  const [formOrderDate,   setFormOrderDate]   = useState(() => new Date().toISOString().slice(0, 10));
  const [formExpectedDate,setFormExpectedDate]= useState('');
  const [formStatus,      setFormStatus]      = useState<'DRAFT' | 'ORDERED'>('DRAFT');
  const [formNotes,       setFormNotes]       = useState('');
  const [formItems,       setFormItems]       = useState<DraftItem[]>([blankItem()]);
  const [formSaving,      setFormSaving]      = useState(false);
  const [formError,       setFormError]       = useState('');

  // Receive Goods modal state
  const [receiveModalOpen,   setReceiveModalOpen]   = useState(false);
  const [receiveTargetOrder, setReceiveTargetOrder] = useState<PurchaseOrder | null>(null);
  const [receiveDate,        setReceiveDate]        = useState(() => new Date().toISOString().slice(0, 10));
  const [receiveNotes,       setReceiveNotes]       = useState('');
  const [receiveItems,       setReceiveItems]       = useState<ReceiveLineItem[]>([]);
  const [receiveSaving,      setReceiveSaving]      = useState(false);
  const [receiveError,       setReceiveError]       = useState('');

  // Import state
  const [importErrors,    setImportErrors]    = useState<string[]>([]);
  const [importSuccess,   setImportSuccess]   = useState<number>(0);
  const [showImportResult,setShowImportResult]= useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const orders         = usePurchaseStore((s) => s.orders);
  const addOrderLocal  = usePurchaseStore((s) => s.addOrder);
  const syncFromApi    = usePurchaseStore((s) => s.syncFromApi);
  const cancelOrderLocal = usePurchaseStore((s) => s.cancelOrder);

  const activeBranchId = useBranchStore((s) => s.activeBranchId);

  // Product + supplier stores — used for UUID resolution when creating POs
  const allProducts  = useProductStore((s) => s.products);
  const allSuppliers = useSupplierStore((s) => s.suppliers);

  // ── Product/supplier search suggestions for the PO form ────────────────────
  const [productSearchIdx,  setProductSearchIdx]  = useState<number | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [supplierSearch,    setSupplierSearch]    = useState('');
  const [supplierSugOpen,   setSupplierSugOpen]   = useState(false);

  const productSuggestions = useMemo(() => {
    if (productSearchIdx === null || !productSearchTerm.trim()) return [];
    const t = productSearchTerm.toLowerCase();
    return allProducts
      .filter((p) => p.isActive && (p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)))
      .slice(0, 8);
  }, [allProducts, productSearchTerm, productSearchIdx]);

  const supplierSuggestions = useMemo(() => {
    if (!supplierSearch.trim()) return allSuppliers.filter((s) => s.isActive).slice(0, 8);
    const t = supplierSearch.toLowerCase();
    return allSuppliers
      .filter((s) => s.isActive && (s.name.toLowerCase().includes(t) || s.code.toLowerCase().includes(t)))
      .slice(0, 8);
  }, [allSuppliers, supplierSearch]);

  // ── Branch filter ───────────────────────────────────────────────────────────
  const { filterByBranch, stampBranch, activeBranchName, effectiveBranchId } = useBranchFilter();
  const branchOrders = filterByBranch(orders);

  // ── Fetch from API on mount ─────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (isLocalSession()) return;
    setLoading(true);
    setApiError('');
    try {
      const apiOrders = await purchasesService.fetchOrders();
      apiOrders.forEach((o) => syncFromApi(o as unknown as Record<string, unknown>));
    } catch {
      setApiError('Could not load purchase orders from the server. Showing local data.');
    } finally {
      setLoading(false);
    }
  }, [syncFromApi]);

  useEffect(() => { void fetchOrders(); }, [fetchOrders]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total       = branchOrders.length;
    const pending     = branchOrders.filter((o) => o.status === 'ORDERED' || o.status === 'PARTIAL_RECEIVED').length;
    const totalValue  = branchOrders.reduce((s, o) => s + o.totalAmount, 0);
    const outstanding = branchOrders
      .filter((o) => o.paymentStatus !== 'PAID')
      .reduce((s, o) => s + (o.totalAmount - o.amountPaid), 0);
    return { total, pending, totalValue, outstanding };
  }, [branchOrders, effectiveBranchId]); // eslint-disable-line

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return branchOrders.filter((o) => {
      const matchSearch = !term ||
        o.poNumber.toLowerCase().includes(term) ||
        o.supplierName.toLowerCase().includes(term);
      const matchStatus = statusFilter === 'all' || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [branchOrders, searchTerm, statusFilter, effectiveBranchId]); // eslint-disable-line

  function openDetail(o: PurchaseOrder) { setSelectedOrder(o); setDetailOpen(true); }
  function closeDetail() { setDetailOpen(false); setSelectedOrder(null); }

  // ── Item helpers (new PO form) ──────────────────────────────────────────────
  function updateItem(index: number, field: keyof DraftItem, value: string | number | null | undefined) {
    setFormItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, [field]: (field === 'productName' || field === 'sku' || field === 'expiryDate' || field === 'productId') ? value : Number(value) }
          : item
      )
    );
  }

  function pickProduct(index: number, product: { id: string; name: string; sku: string; price: number }) {
    setFormItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, productId: product.id, productName: product.name, sku: product.sku, unitPrice: item.unitPrice || product.price }
          : item
      )
    );
    setProductSearchIdx(null);
    setProductSearchTerm('');
  }

  const addItem    = () => setFormItems((p) => [...p, blankItem()]);
  const removeItem = (i: number) => setFormItems((p) => p.filter((_, idx) => idx !== i));

  // ── CSV/Excel import ────────────────────────────────────────────────────────
  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = ''; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') { if (line[i + 1] === '"') { current += '"'; i++; } else inQuotes = false; }
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function rowsToDraftItems(rows: Array<Record<string, string>>): { items: DraftItem[]; errors: string[] } {
    const errors: string[] = [];
    const items: DraftItem[] = [];
    rows.forEach((row, idx) => {
      const lineNum    = idx + 2;
      const productName = row.product_name ?? row.productname ?? row.name ?? row.product ?? row.item ?? row.description ?? '';
      const sku         = row.sku ?? row.code ?? row.item_code ?? row.product_code ?? '';
      const qtyRaw      = row.quantity ?? row.qty ?? row.units ?? '1';
      const priceRaw    = row.unit_price ?? row.unitprice ?? row.price ?? row.cost ?? row.unit_cost ?? row.rate ?? '0';
      const expiryRaw   = row.expiry_date ?? row.expiry ?? row.best_before ?? '';

      if (!productName.trim()) { errors.push(`Row ${lineNum}: product name is required.`); return; }
      const quantity  = Number(qtyRaw);
      if (isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
        errors.push(`Row ${lineNum}: quantity must be a positive integer.`); return;
      }
      const unitPrice = Number(priceRaw);
      if (isNaN(unitPrice) || unitPrice < 0) {
        errors.push(`Row ${lineNum}: unit price must be a valid number.`); return;
      }
      items.push({ productName: productName.trim(), sku: sku.trim(), quantity, unitPrice, expiryDate: expiryRaw || null });
    });
    return { items, errors };
  }

  async function handleImportFile(file: File) {
    setShowImportResult(false); setImportErrors([]); setImportSuccess(0);
    const nameLower = file.name.toLowerCase();
    let rows: Array<Record<string, string>> = [];
    try {
      if (nameLower.endsWith('.csv') || nameLower.endsWith('.tsv')) {
        const text = await file.text();
        const sep  = nameLower.endsWith('.tsv') ? '\t' : ',';
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) { setImportErrors(['File has no data rows.']); setShowImportResult(true); return; }
        const headers = (sep === '\t' ? lines[0].split('\t') : parseCsvLine(lines[0])).map((h) =>
          h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        );
        rows = lines.slice(1).map((line) => {
          const vals = sep === '\t' ? line.split('\t') : parseCsvLine(line);
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { if (h) obj[h] = (vals[i] ?? '').trim(); });
          return obj;
        });
      } else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb  = XLSX.read(buf, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { setImportErrors(['Could not read sheet from file.']); setShowImportResult(true); return; }
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
        rows = jsonRows.map((obj) =>
          Object.fromEntries(Object.entries(obj).map(([k, v]) => [
            k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
            String(v ?? '').trim(),
          ]))
        );
      } else {
        setImportErrors(['Unsupported file type. Use CSV, TSV, XLSX, or XLS.']);
        setShowImportResult(true); return;
      }
    } catch {
      setImportErrors(['Failed to read file. Please check the format and try again.']);
      setShowImportResult(true); return;
    }
    const { items, errors } = rowsToDraftItems(rows);
    setImportErrors(errors); setImportSuccess(items.length); setShowImportResult(true);
    if (items.length > 0) {
      const hasRealItems = formItems.some((i) => i.productName.trim() !== '');
      setFormItems(hasRealItems ? [...formItems, ...items] : items);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function downloadSampleCsv() {
    const lines = [
      'product_name,sku,quantity,unit_price,expiry_date',
      'Rice Bag 5kg,RC-5KG,50,72.00,',
      'Milo Tin 400g,ML-400,80,38.00,2027-06-01',
      'Paracetamol 500mg,PCM-500,200,1.20,2026-12-31',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.setAttribute('download', 'purchase-items-sample.csv');
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  const draftSubtotal = useMemo(
    () => formItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [formItems],
  );

  function openAddModal() {
    setFormSupplier(''); setFormSupplierId('');
    setSupplierSearch(''); setSupplierSugOpen(false);
    setFormOrderDate(new Date().toISOString().slice(0, 10));
    setFormExpectedDate(''); setFormStatus('DRAFT'); setFormNotes('');
    setFormItems([blankItem()]);
    setProductSearchIdx(null); setProductSearchTerm('');
    setImportErrors([]); setImportSuccess(0); setShowImportResult(false);
    setFormError('');
    setAddModalOpen(true);
  }

  // ── Create PO ───────────────────────────────────────────────────────────────
  async function handleAddOrder() {
    if (!formSupplier.trim()) return;
    const validItems = formItems.filter((i) => i.productName.trim() !== '');
    if (validItems.length === 0) return;
    setFormSaving(true); setFormError('');

    if (isLocalSession()) {
      // Local mode — store only
      const builtItems: PurchaseItem[] = validItems.map((i) => ({
        id: crypto.randomUUID ? crypto.randomUUID() : `pi-${Date.now()}-${Math.random()}`,
        productName: i.productName, sku: i.sku,
        quantity: i.quantity, unitPrice: i.unitPrice,
        receivedQty: 0, subtotal: i.quantity * i.unitPrice,
        expiryDate: i.expiryDate ?? null,
      }));
      const subtotal = builtItems.reduce((s, i) => s + i.subtotal, 0);
      addOrderLocal({
        poNumber: genPONumber(orders.length),
        supplierName: formSupplier.trim(),
        supplierId: formSupplierId.trim() || `sup-${Date.now()}`,
        items: builtItems, subtotal, taxAmount: 0, totalAmount: subtotal,
        status: formStatus, paymentStatus: 'UNPAID', amountPaid: 0,
        orderDate: formOrderDate, expectedDate: formExpectedDate || formOrderDate,
        notes: formNotes.trim(), createdBy: 'Admin', branchId: stampBranch,
      });
      setFormSaving(false); setAddModalOpen(false); return;
    }

    // Real API mode
    try {
      // Resolve first warehouse for branch
      let warehouseId: string | null = null;
      try {
        const wRes = await api.get<{ results?: { id: string }[] } | { id: string }[]>(
          '/branches/warehouses/', { params: { branch: activeBranchId, limit: 1 } }
        );
        const wList = Array.isArray(wRes.data) ? wRes.data : (wRes.data as { results?: { id: string }[] }).results ?? [];
        warehouseId = wList[0]?.id ?? null;
      } catch { /* no warehouse — proceed without */ }

      // Resolve product UUIDs: use productId if already set (from autocomplete),
      // otherwise look up by SKU or name in the product store, then try backend search.
      const resolvedItems = await Promise.all(
        validItems.map(async (i) => {
          let productUuid = i.productId;
          if (!productUuid) {
            // Try local store first
            const match = allProducts.find(
              (p) => (i.sku && p.sku === i.sku) || p.name.toLowerCase() === i.productName.toLowerCase()
            );
            if (match) {
              productUuid = match.id;
            } else if (i.sku) {
              // Try backend search by SKU
              try {
                const r = await api.get<{ results?: { id: string }[] } | { id: string }[]>(
                  '/products/', { params: { search: i.sku, limit: 1 } }
                );
                const list = Array.isArray(r.data) ? r.data : (r.data as { results?: { id: string }[] }).results ?? [];
                if (list[0]?.id) productUuid = list[0].id;
              } catch { /* not found — will fail validation below */ }
            }
          }
          return { ...i, productId: productUuid };
        })
      );

      const itemsWithUUIDs = resolvedItems.filter((i) => i.productId);
      if (itemsWithUUIDs.length === 0) {
        setFormError('No products could be matched to catalog items. Please search and select products from your catalog.');
        setFormSaving(false);
        return;
      }
      if (itemsWithUUIDs.length < resolvedItems.length) {
        setFormError(`Warning: ${resolvedItems.length - itemsWithUUIDs.length} item(s) not found in catalog and were skipped.`);
      }

      const newOrder = await purchasesService.createOrder({
        supplier:      formSupplierId || null,
        branch:        activeBranchId ?? null,
        warehouse:     warehouseId,
        order_date:    formOrderDate,
        expected_date: formExpectedDate || null,
        notes:         formNotes.trim(),
        items: itemsWithUUIDs.map((i) => ({
          product:     i.productId!,   // now a real UUID ✓
          qty_ordered: i.quantity,
          unit_cost:   i.unitPrice,
          expiry_date: i.expiryDate ?? null,
        })),
      });
      syncFromApi(newOrder as unknown as Record<string, unknown>);
      setAddModalOpen(false);
    } catch (err: unknown) {
      const ae = err as { response?: { data?: unknown } };
      const d  = ae.response?.data;
      if (d && typeof d === 'object') {
        const first = Object.values(d as Record<string, string | string[]>)[0];
        setFormError(Array.isArray(first) ? first[0] : String(first));
      } else {
        // Fall back to local-only storage with a warning
        setFormError('Server unavailable — order saved locally only.');
        const builtItems: PurchaseItem[] = validItems.map((i) => ({
          id: crypto.randomUUID ? crypto.randomUUID() : `pi-${Date.now()}-${Math.random()}`,
          productName: i.productName, sku: i.sku,
          quantity: i.quantity, unitPrice: i.unitPrice,
          receivedQty: 0, subtotal: i.quantity * i.unitPrice,
          expiryDate: i.expiryDate ?? null,
        }));
        const subtotal = builtItems.reduce((s, i) => s + i.subtotal, 0);
        addOrderLocal({
          poNumber: genPONumber(orders.length),
          supplierName: formSupplier.trim(),
          supplierId: formSupplierId || `sup-${Date.now()}`,
          items: builtItems, subtotal, taxAmount: 0, totalAmount: subtotal,
          status: formStatus, paymentStatus: 'UNPAID', amountPaid: 0,
          orderDate: formOrderDate, expectedDate: formExpectedDate || formOrderDate,
          notes: formNotes.trim(), createdBy: 'Admin', branchId: stampBranch,
        });
        setTimeout(() => setAddModalOpen(false), 1800);
      }
    } finally {
      setFormSaving(false);
    }
  }

  // ── Open Receive Goods modal ────────────────────────────────────────────────
  function openReceiveModal(order: PurchaseOrder) {
    setReceiveTargetOrder(order);
    setReceiveDate(new Date().toISOString().slice(0, 10));
    setReceiveNotes('');
    setReceiveError('');
    setReceiveItems(order.items.map((item) => ({
      purchaseOrderItemId: item.id,
      productId:           item.productId,   // carry UUID from mapItem
      productName:         item.productName,
      sku:                 item.sku,
      qtyOrdered:          item.quantity,
      qtyAlreadyReceived:  item.receivedQty,
      qtyToReceive:        Math.max(0, item.quantity - item.receivedQty),
      unitCost:            item.unitPrice,
      expiryDate:          item.expiryDate ?? '',
      batchNumber:         item.batchNumber ?? '',
      notes:               '',
    })));
    setReceiveModalOpen(true);
  }

  // ── Submit Receive Goods ────────────────────────────────────────────────────
  async function handleReceiveGoods() {
    if (!receiveTargetOrder) return;
    setReceiveSaving(true); setReceiveError('');

    const itemsToSend = receiveItems.filter((i) => i.qtyToReceive > 0);
    if (itemsToSend.length === 0) {
      setReceiveError('Enter at least one item with quantity > 0.');
      setReceiveSaving(false); return;
    }

    if (isLocalSession()) {
      // Local mode: just mark as received
      const updated: PurchaseOrder = {
        ...receiveTargetOrder,
        status: 'RECEIVED',
        paymentStatus: 'PAID',
        receivedDate: receiveDate,
        amountPaid: receiveTargetOrder.totalAmount,
        items: receiveTargetOrder.items.map((item) => {
          const ri = receiveItems.find((r) => r.purchaseOrderItemId === item.id);
          return ri ? { ...item, receivedQty: item.receivedQty + ri.qtyToReceive } : item;
        }),
      };
      syncFromApi(updated as unknown as Record<string, unknown>);
      setReceiveModalOpen(false);
      if (selectedOrder?.id === receiveTargetOrder.id) setSelectedOrder(updated);
      setReceiveSaving(false); return;
    }

    // Real API mode
    try {
      let warehouseId: string | null = null;
      try {
        const wRes = await api.get<{ results?: { id: string }[] } | { id: string }[]>(
          '/branches/warehouses/', { params: { branch: activeBranchId, limit: 1 } }
        );
        const wList = Array.isArray(wRes.data) ? wRes.data : (wRes.data as { results?: { id: string }[] }).results ?? [];
        warehouseId = wList[0]?.id ?? null;
      } catch { /* no warehouse */ }

      await purchasesService.receiveGoods(receiveTargetOrder.id, {
        received_date: receiveDate,
        branch:        activeBranchId ?? null,
        warehouse:     warehouseId,
        notes:         receiveNotes,
        items: itemsToSend.map((i) => ({
          purchase_order_item: i.purchaseOrderItemId ?? null,
          product:             i.productId ?? (i.sku || i.productName),  // prefer UUID
          qty_received:        i.qtyToReceive,
          unit_cost:           i.unitCost,
          expiry_date:         i.expiryDate || null,
          batch_number:        i.batchNumber || undefined,
          notes:               i.notes,
        })),
      });
      // Re-fetch the updated PO to get batch tracking data
      await fetchOrders();
      setReceiveModalOpen(false);
      closeDetail();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { error?: string } } };
      setReceiveError(ae.response?.data?.error ?? 'Failed to record receipt. Please try again.');
    } finally {
      setReceiveSaving(false);
    }
  }

  // ── Cancel PO ───────────────────────────────────────────────────────────────
  async function handleCancel(order: PurchaseOrder) {
    if (isLocalSession()) { cancelOrderLocal(order.id); closeDetail(); return; }
    try {
      const updated = await purchasesService.cancelOrder(order.id);
      syncFromApi(updated as unknown as Record<string, unknown>);
    } catch { cancelOrderLocal(order.id); }
    closeDetail();
  }

  const canSubmit = formSupplier.trim() !== '' && formItems.some((i) => i.productName.trim() !== '');

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Purchases</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            {activeBranchName !== 'All Branches'
              ? <><span className="font-semibold text-teal-700">{activeBranchName}</span> — purchase orders</>
              : 'All branches — purchase orders'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-400" />}
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" /> New Purchase
          </button>
        </div>
      </div>

      {/* API error banner */}
      {apiError && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700">{apiError}</p>
          <button onClick={() => setApiError('')} className="ml-auto text-amber-500"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Orders', value: stats.total.toString(),          icon: ShoppingCart, color: 'bg-blue-50 text-blue-600',    ring: 'ring-blue-100'   },
          { label: 'Pending',      value: stats.pending.toString(),         icon: Clock,        color: 'bg-amber-50 text-amber-600',  ring: 'ring-amber-100'  },
          { label: 'Total Value',  value: formatCurrency(stats.totalValue), icon: TrendingUp,   color: 'bg-purple-50 text-purple-600',ring: 'ring-purple-100' },
          { label: 'Outstanding',  value: formatCurrency(stats.outstanding),icon: CreditCard,   color: 'bg-rose-50 text-rose-600',    ring: 'ring-rose-100'   },
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
          <input
            type="text" placeholder="Search PO number, supplier..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
          />
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

      {/* PO Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">PO Number</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Supplier</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Items</th>
                <th className="text-right font-semibold text-muted-600 px-4 py-3">Total</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Status</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Payment</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Order Date</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => {
                const sc = statusConfig[o.status] || statusConfig.DRAFT;
                const ps = paymentStatusConfig[o.paymentStatus] || paymentStatusConfig.UNPAID;
                return (
                  <tr key={o.id} onClick={() => openDetail(o)}
                    className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#1E293B] text-sm">{o.poNumber}</p>
                      <p className="text-xs text-muted-400">{o.createdBy}</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <p className="text-sm font-medium text-[#1E293B]">{o.supplierName}</p>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className="inline-flex items-center justify-center h-6 min-w-[24px] rounded-full bg-muted-100 text-xs font-semibold text-muted-700 px-2">
                        {o.items.length}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[#1E293B]">{formatCurrency(o.totalAmount)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', sc.color)}>
                        <sc.icon className="h-3 w-3" />{sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden md:table-cell">
                      <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', ps.color)}>{ps.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-500 text-xs">
                      {new Date(o.orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-center"><ChevronRight className="h-4 w-4 text-muted-300" /></td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-400">
                  <Truck className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No purchase orders found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════ NEW PURCHASE MODAL ══════════ */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-[#1E293B]" />
                <h2 className="text-lg font-bold text-[#1E293B]">New Purchase Order</h2>
              </div>
              <button onClick={() => setAddModalOpen(false)} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Supplier search dropdown */}
                <div className="sm:col-span-2 relative">
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Supplier *</label>
                  <input
                    value={supplierSearch || formSupplier}
                    onChange={(e) => {
                      setSupplierSearch(e.target.value);
                      setFormSupplier(e.target.value);
                      setFormSupplierId('');
                      setSupplierSugOpen(true);
                    }}
                    onFocus={() => setSupplierSugOpen(true)}
                    onBlur={() => setTimeout(() => setSupplierSugOpen(false), 150)}
                    placeholder="Search or type supplier name…"
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                  />
                  {formSupplierId && (
                    <span className="absolute right-3 top-8 text-[10px] font-semibold text-emerald-600">✓ linked</span>
                  )}
                  {supplierSugOpen && supplierSuggestions.length > 0 && (
                    <div className="absolute z-50 left-0 top-full mt-1 w-full bg-white border border-muted-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                      {supplierSuggestions.map((s) => (
                        <button
                          key={s.id} type="button"
                          onMouseDown={() => {
                            setFormSupplier(s.name);
                            setFormSupplierId(s.id);
                            setSupplierSearch(s.name);
                            setSupplierSugOpen(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted-50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-[#1E293B] truncate">{s.name}</p>
                            <p className="text-[11px] text-muted-400">{s.code} · {s.supplierType}</p>
                          </div>
                        </button>
                      ))}
                      {!allSuppliers.some((s) => s.name.toLowerCase() === formSupplier.toLowerCase()) && formSupplier.trim() && (
                        <div className="px-3 py-2 border-t border-muted-100">
                          <p className="text-[11px] text-muted-400">No match — PO will use entered name without backend link</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Order Date</label>
                  <input type="date" value={formOrderDate} onChange={(e) => setFormOrderDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Expected Delivery</label>
                  <input type="date" value={formExpectedDate} onChange={(e) => setFormExpectedDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Status</label>
                  <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as 'DRAFT' | 'ORDERED')}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10">
                    <option value="DRAFT">Draft</option>
                    <option value="ORDERED">Ordered</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Notes</label>
                  <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="Optional notes..."
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
              </div>

              {/* Items */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-[#1E293B] flex items-center gap-2">
                    <Package className="h-4 w-4" /> Purchase Items *
                  </h3>
                  <div className="flex items-center gap-2">
                    <input ref={fileInputRef} type="file"
                      accept=".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
                    <button type="button" onClick={downloadSampleCsv}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-500 bg-muted-100 hover:bg-muted-200 rounded-lg px-2.5 py-1.5 transition-colors">
                      <Download className="h-3.5 w-3.5" /> Sample
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-2.5 py-1.5 transition-colors border border-blue-200">
                      <Upload className="h-3.5 w-3.5" /> Import CSV/Excel
                    </button>
                    <button onClick={addItem}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E293B] bg-muted-100 hover:bg-muted-200 rounded-lg px-3 py-1.5 transition-colors">
                      <Plus className="h-3.5 w-3.5" /> Add Row
                    </button>
                  </div>
                </div>

                {showImportResult && (
                  <div className="mb-3 space-y-2">
                    {importSuccess > 0 && (
                      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
                        <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                        <span className="text-xs font-semibold text-emerald-700">
                          {importSuccess} item{importSuccess !== 1 ? 's' : ''} imported
                          {importErrors.length > 0 ? ` (${importErrors.length} skipped)` : ''}
                        </span>
                      </div>
                    )}
                    {importErrors.length > 0 && importSuccess === 0 && (
                      <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                          <span className="text-xs font-semibold text-rose-700">Import failed</span>
                        </div>
                        <ul className="list-disc list-inside max-h-20 overflow-y-auto">
                          {importErrors.slice(0, 5).map((e, i) => <li key={i} className="text-[11px] text-rose-600">{e}</li>)}
                          {importErrors.length > 5 && <li className="text-[11px] text-rose-500">…and {importErrors.length - 5} more</li>}
                        </ul>
                      </div>
                    )}
                    <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2">
                      <Info className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-blue-600">
                        Required: <strong>product_name</strong>, <strong>quantity</strong>, <strong>unit_price</strong>.
                        Optional: <strong>sku</strong>, <strong>expiry_date</strong>.
                      </p>
                    </div>
                  </div>
                )}

                <div className="hidden sm:grid grid-cols-[1fr_90px_100px_110px_36px] gap-2 mb-1.5 px-1">
                  <span className="text-[11px] font-semibold text-muted-500">Product / SKU</span>
                  <span className="text-[11px] font-semibold text-muted-500 text-center">Qty</span>
                  <span className="text-[11px] font-semibold text-muted-500 text-right">Unit Price</span>
                  <span className="text-[11px] font-semibold text-muted-500">Expiry Date</span>
                  <span />
                </div>

                <div className="space-y-2">
                  {formItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_100px_110px_36px] gap-2 items-start bg-muted-50/60 rounded-xl p-3 sm:p-0 sm:bg-transparent">
                      {/* Product search column */}
                      <div className="relative flex flex-col gap-1.5">
                        <div className="relative">
                          <input
                            value={productSearchIdx === index ? productSearchTerm : item.productName}
                            onChange={(e) => {
                              setProductSearchIdx(index);
                              setProductSearchTerm(e.target.value);
                              updateItem(index, 'productName', e.target.value);
                              updateItem(index, 'productId', undefined);
                            }}
                            onFocus={() => { setProductSearchIdx(index); setProductSearchTerm(item.productName); }}
                            onBlur={() => setTimeout(() => { if (productSearchIdx === index) setProductSearchIdx(null); }, 200)}
                            placeholder="Search product *"
                            className="w-full h-9 px-3 rounded-lg bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                          />
                          {item.productId && (
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-600">✓</span>
                          )}
                        </div>
                        {/* SKU read-only when product is linked */}
                        <input
                          value={item.sku}
                          onChange={(e) => updateItem(index, 'sku', e.target.value)}
                          readOnly={!!item.productId}
                          placeholder="SKU (optional)"
                          className="w-full h-8 px-3 rounded-lg bg-white border border-muted-200 text-xs text-muted-500 focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                        />
                        {/* Product suggestions dropdown */}
                        {productSearchIdx === index && productSuggestions.length > 0 && (
                          <div className="absolute z-50 left-0 top-9 w-full bg-white border border-muted-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                            {productSuggestions.map((p) => (
                              <button
                                key={p.id} type="button"
                                onMouseDown={() => pickProduct(index, p)}
                                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted-50 transition-colors"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-[#1E293B] truncate">{p.name}</p>
                                  <p className="text-[11px] text-muted-400 font-mono">{p.sku}</p>
                                </div>
                                <span className="text-xs text-muted-500 shrink-0">{formatCurrency(p.price)}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {productSearchIdx === index && productSearchTerm.trim() && productSuggestions.length === 0 && (
                          <div className="absolute z-50 left-0 top-9 w-full bg-white border border-muted-200 rounded-xl shadow-sm px-3 py-2">
                            <p className="text-[11px] text-muted-400">No products match — item will be saved by name only</p>
                          </div>
                        )}
                      </div>
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                        className="h-9 px-3 rounded-lg bg-white border border-muted-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 w-full" />
                      <input type="number" min="0" step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                        className="h-9 px-3 rounded-lg bg-white border border-muted-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 w-full" />
                      <input type="date" value={item.expiryDate ?? ''} onChange={(e) => updateItem(index, 'expiryDate', e.target.value || null)}
                        className="h-9 px-3 rounded-lg bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 w-full" />
                      <button onClick={() => removeItem(index)} disabled={formItems.length === 1}
                        className="flex items-center justify-center h-9 w-9 rounded-lg text-muted-400 hover:text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex justify-end">
                  <div className="bg-muted-50 rounded-xl px-4 py-3 min-w-[200px] space-y-1.5">
                    <div className="flex justify-between text-sm"><span className="text-muted-500">Subtotal</span><span className="font-semibold">{formatCurrency(draftSubtotal)}</span></div>
                    <div className="flex justify-between text-sm border-t border-muted-200 pt-1.5"><span className="font-bold">Total</span><span className="font-bold">{formatCurrency(draftSubtotal)}</span></div>
                  </div>
                </div>
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
                  <p className="text-xs text-rose-700">{formError}</p>
                </div>
              )}
            </div>

            <div className="border-t border-muted-100 px-5 py-4 flex justify-end gap-3">
              <button onClick={() => setAddModalOpen(false)}
                className="rounded-xl border border-muted-200 px-5 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void handleAddOrder()} disabled={!canSubmit || formSaving}
                className="rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm inline-flex items-center gap-2">
                {formSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : 'Create Order'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ RECEIVE GOODS MODAL ══════════ */}
      {receiveModalOpen && receiveTargetOrder && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setReceiveModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl my-6">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <div>
                <h2 className="text-lg font-bold text-[#1E293B]">Receive Goods</h2>
                <p className="text-xs text-muted-500">{receiveTargetOrder.poNumber} — {receiveTargetOrder.supplierName}</p>
              </div>
              <button onClick={() => setReceiveModalOpen(false)} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Date + notes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Received Date *</label>
                  <input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Notes</label>
                  <input value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)}
                    placeholder="Optional notes..."
                    className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                </div>
              </div>

              {/* Per-item receipt */}
              <div>
                <p className="text-xs font-bold text-muted-500 uppercase tracking-wider mb-2">Items to Receive</p>
                <div className="space-y-3">
                  {receiveItems.map((ri, idx) => (
                    <div key={idx} className="rounded-2xl border border-muted-200 bg-muted-50/50 p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[#1E293B]">{ri.productName}</p>
                          <p className="text-[11px] text-muted-400 font-mono">{ri.sku}</p>
                        </div>
                        <span className="text-xs text-muted-500 shrink-0">
                          Ordered: <strong>{ri.qtyOrdered}</strong>
                          {ri.qtyAlreadyReceived > 0 && <> · Previously received: <strong>{ri.qtyAlreadyReceived}</strong></>}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Qty Received *</label>
                          <input type="number" min="0" value={ri.qtyToReceive}
                            onChange={(e) => setReceiveItems((prev) =>
                              prev.map((r, i) => i === idx ? { ...r, qtyToReceive: Math.max(0, parseInt(e.target.value, 10) || 0) } : r))}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Unit Cost</label>
                          <input type="number" min="0" step="0.01" value={ri.unitCost}
                            onChange={(e) => setReceiveItems((prev) =>
                              prev.map((r, i) => i === idx ? { ...r, unitCost: parseFloat(e.target.value) || 0 } : r))}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Expiry Date</label>
                          <input type="date" value={ri.expiryDate}
                            onChange={(e) => setReceiveItems((prev) =>
                              prev.map((r, i) => i === idx ? { ...r, expiryDate: e.target.value } : r))}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                        </div>
                        <div>
                          <label className="text-[11px] font-semibold text-muted-500 block mb-1">Batch / Lot No.</label>
                          <input type="text" placeholder="auto-generated" value={ri.batchNumber}
                            onChange={(e) => setReceiveItems((prev) =>
                              prev.map((r, i) => i === idx ? { ...r, batchNumber: e.target.value } : r))}
                            className="w-full h-9 rounded-lg border border-muted-200 bg-white px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {receiveError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-xs text-red-700">{receiveError}</p>
                </div>
              )}
            </div>
            <div className="border-t border-muted-100 px-5 py-4 flex justify-end gap-3">
              <button onClick={() => setReceiveModalOpen(false)}
                className="rounded-xl border border-muted-200 px-5 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                Cancel
              </button>
              <button onClick={() => void handleReceiveGoods()} disabled={receiveSaving}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 inline-flex items-center gap-2">
                {receiveSaving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><CheckCircle className="h-4 w-4" /> Confirm Receipt</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ DETAIL SLIDE-OVER ══════════ */}
      {detailOpen && selectedOrder && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeDetail} />
          <div className="relative w-full max-w-lg bg-white h-full shadow-2xl animate-slide-in-right overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between z-10">
              <h2 className="text-lg font-bold text-[#1E293B]">{selectedOrder.poNumber}</h2>
              <button onClick={closeDetail} className="p-2 rounded-lg hover:bg-muted-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-5 space-y-5">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-xs text-muted-500">Supplier</p><p className="font-semibold text-[#1E293B]">{selectedOrder.supplierName}</p></div>
                <div><p className="text-xs text-muted-500">Created By</p><p className="font-semibold text-[#1E293B]">{selectedOrder.createdBy}</p></div>
                <div><p className="text-xs text-muted-500">Order Date</p>
                  <p className="font-semibold text-[#1E293B] flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {new Date(selectedOrder.orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div><p className="text-xs text-muted-500">Expected</p>
                  <p className="font-semibold text-[#1E293B] flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {new Date(selectedOrder.expectedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                {selectedOrder.receivedDate && (
                  <div><p className="text-xs text-muted-500">Received Date</p>
                    <p className="font-semibold text-emerald-600 flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {new Date(selectedOrder.receivedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-500">Status</p>
                  <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', statusConfig[selectedOrder.status]?.color)}>
                    {statusConfig[selectedOrder.status]?.label}
                  </span>
                </div>
              </div>

              {/* Items with batch tracking */}
              <div>
                <h4 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Order Items
                </h4>
                <div className="space-y-3">
                  {selectedOrder.items.map((item) => (
                    <div key={item.id} className="space-y-2">
                      <div className="flex items-center justify-between bg-muted-50 rounded-xl px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#1E293B] truncate">{item.productName}</p>
                          <p className="text-[11px] text-muted-400">{item.sku} · {formatCurrency(item.unitPrice)} each</p>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <p className="text-sm font-bold text-[#1E293B]">{formatCurrency(item.subtotal)}</p>
                          <p className="text-[11px] text-muted-400">{item.receivedQty}/{item.quantity} received</p>
                        </div>
                      </div>
                      <BatchTrackingCard item={item} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="bg-muted-50 rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-muted-500">Subtotal</span><span className="font-semibold">{formatCurrency(selectedOrder.subtotal)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-500">Tax</span><span className="font-semibold">{formatCurrency(selectedOrder.taxAmount)}</span></div>
                <div className="flex justify-between text-sm border-t border-muted-200 pt-2"><span className="font-bold">Total</span><span className="font-bold">{formatCurrency(selectedOrder.totalAmount)}</span></div>
                <div className="flex justify-between text-sm"><span className="text-muted-500">Paid</span><span className="font-semibold text-emerald-600">{formatCurrency(selectedOrder.amountPaid)}</span></div>
                {selectedOrder.totalAmount - selectedOrder.amountPaid > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-500">Balance Due</span><span className="font-bold text-rose-600">{formatCurrency(selectedOrder.totalAmount - selectedOrder.amountPaid)}</span></div>
                )}
              </div>

              {selectedOrder.notes && (
                <div><p className="text-xs text-muted-500 mb-1">Notes</p><p className="text-sm text-muted-700">{selectedOrder.notes}</p></div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                {(selectedOrder.status === 'ORDERED' || selectedOrder.status === 'PARTIAL_RECEIVED') && (
                  <button onClick={() => openReceiveModal(selectedOrder)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors">
                    <Check className="h-4 w-4" /> Receive Goods
                  </button>
                )}
                {(selectedOrder.status === 'DRAFT' || selectedOrder.status === 'ORDERED') && (
                  <button onClick={() => void handleCancel(selectedOrder)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 text-rose-600 px-4 py-2.5 text-sm font-semibold hover:bg-rose-50 transition-colors">
                    <XCircle className="h-4 w-4" /> Cancel Order
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Util ──────────────────────────────────────────────────────────────────────
function genPONumber(existingCount: number): string {
  const now = new Date();
  const yy  = String(now.getFullYear()).slice(2);
  const mm  = String(now.getMonth() + 1).padStart(2, '0');
  const dd  = String(now.getDate()).padStart(2, '0');
  const seq = String(existingCount + 1).padStart(3, '0');
  return `PO-${yy}${mm}${dd}-${seq}`;
}
