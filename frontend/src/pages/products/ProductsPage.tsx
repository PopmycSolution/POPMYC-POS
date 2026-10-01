import { useState, useMemo, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  Grid3X3,
  List,
  Package,
  X,
  Check,
  Upload,
  Download,
  FileSpreadsheet,
  Info,
  AlertCircle,
  XCircle,
  ImageIcon,
  Link,
  Camera,
  CalendarClock,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import type { Product } from '@/types';
import { getExpiryStatus, daysUntilExpiry } from '@/types';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { formatCurrency } from '@/utils/format';
import { useProductStore } from '@/stores/product.store';
import { useCategoryStore } from '@/stores/category.store';
import { useBrandStore } from '@/stores/brand.store';
import { useUnitStore } from '@/stores/unit.store';
import { useBranchInventoryStore } from '@/stores/branchInventory.store';
import { useBranchStore } from '@/stores/branch.store';
import { useSettingsStore } from '@/stores/settings.store';
import { NEGOTIABLE_BUSINESS_CATEGORIES } from '@/types';
import type { PricingType } from '@/types';

// ── Fallback gradient map for unknown category IDs ───────────────────────────
const FALLBACK_GRAD = { bg: 'from-emerald-100 to-teal-100', accent: 'text-emerald-700' };
const PRESET_GRADS: Record<string, { bg: string; accent: string }> = {
  beverages:      { bg: 'from-blue-100 to-cyan-100',     accent: 'text-blue-600'   },
  food:           { bg: 'from-amber-100 to-yellow-100',  accent: 'text-amber-700'  },
  household:      { bg: 'from-sky-100 to-blue-100',      accent: 'text-sky-700'    },
  toiletries:     { bg: 'from-violet-100 to-fuchsia-100',accent: 'text-violet-700' },
  dairy:          { bg: 'from-rose-100 to-pink-100',     accent: 'text-rose-700'   },
  prescription:   { bg: 'from-blue-100 to-indigo-100',   accent: 'text-blue-700'   },
  smartphones:    { bg: 'from-indigo-100 to-purple-100', accent: 'text-indigo-700' },
  accessories:    { bg: 'from-purple-100 to-fuchsia-100',accent: 'text-purple-700' },
  makeup:         { bg: 'from-pink-100 to-rose-100',     accent: 'text-pink-700'   },
  skincare:       { bg: 'from-rose-100 to-orange-100',   accent: 'text-rose-600'   },
  starters:       { bg: 'from-amber-100 to-orange-100',  accent: 'text-amber-700'  },
  mains:          { bg: 'from-orange-100 to-red-100',    accent: 'text-orange-700' },
  other:          { bg: 'from-emerald-100 to-teal-100',  accent: 'text-emerald-700'},
};

const productSchema = z.object({
  name: z.string().min(2, 'Name required').max(100),
  sku: z.string().min(2, 'SKU required').max(50),
  description: z.string().max(500).optional(),
  modelNumber: z.string().max(100).optional(),
  price: z.coerce.number().min(0.01, 'Price must be > 0'),
  wholesalePrice: z.coerce.number().min(0).optional(),
  cost: z.coerce.number().min(0).optional(),
  stockQuantity: z.coerce.number().int().min(0, 'Stock must be >= 0'),
  lowStockThreshold: z.coerce.number().int().min(0).default(10),
  categoryId: z.string().min(1, 'Category required'),
  brandId: z.string().optional(),
  unitId: z.string().optional(),
  barcode: z.string().max(50).optional(),
  isActive: z.boolean().default(true),
  pricingType: z.enum(['FIXED', 'NEGOTIABLE']).default('FIXED'),
  expiryDate: z.string().optional(),          // YYYY-MM-DD or empty string
  expiryAlertDays: z.coerce.number().int().min(0).default(30),
});

type ProductFormData = z.infer<typeof productSchema>;

function getStockBadge(stock: number, threshold: number = 10) {
  if (stock === 0) return <Badge variant="danger" dot>Out of Stock</Badge>;
  if (stock <= Math.max(1, Math.floor(threshold / 2))) return <Badge variant="danger" dot>Critical</Badge>;
  if (stock <= threshold) return <Badge variant="warning" dot>Low Stock</Badge>;
  return <Badge variant="success" dot>In Stock</Badge>;
}

/** Small inline badge shown on product cards / list rows for expiry status */
function ExpiryBadge({ product }: { product: Product }) {
  const status = getExpiryStatus(product);
  const days   = daysUntilExpiry(product);
  if (status === 'none') return null;

  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 text-red-700 border border-red-200 text-[10px] font-bold px-2 py-0.5">
        <XCircle className="h-3 w-3 shrink-0" /> Expired
      </span>
    );
  }
  if (status === 'expiring_soon') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-bold px-2 py-0.5">
        <Clock className="h-3 w-3 shrink-0" />
        {days === 0 ? 'Expires today' : days === 1 ? 'Expires tomorrow' : `${days}d left`}
      </span>
    );
  }
  // 'ok' — show a subtle green date only in list view (callers can decide)
  return null;
}

type ModalMode = 'add' | 'edit';
interface ImportResult { success: number; errors: string[] }

// ── Image upload panel ────────────────────────────────────────────────────────
interface ImagePickerProps {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}

function ImagePicker({ value, onChange }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [urlDraft, setUrlDraft] = useState(value?.startsWith('http') ? value : '');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onChange(reader.result);
    };
    reader.readAsDataURL(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleUrlApply = () => {
    const trimmed = urlDraft.trim();
    onChange(trimmed || undefined);
  };

  const clearImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    setUrlDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-muted-700 flex items-center gap-1.5">
        <ImageIcon className="h-4 w-4 text-muted-400" /> Product Image <span className="text-muted-400 font-normal">(optional)</span>
      </label>

      {/* Preview */}
      {value ? (
        <div className="relative w-full aspect-[4/3] max-h-40 rounded-xl overflow-hidden bg-muted-100 border border-muted-200">
          <img src={value} alt="Product" className="w-full h-full object-contain" />
          <button
            type="button"
            onClick={clearImage}
            className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center rounded-full bg-white/90 shadow text-muted-600 hover:text-rose-600 transition-colors"
            aria-label="Remove image"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="w-full aspect-[4/3] max-h-40 rounded-xl bg-muted-50 border-2 border-dashed border-muted-200 flex items-center justify-center">
          <Package className="h-10 w-10 text-muted-300" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex rounded-xl bg-muted-100 p-1 gap-1">
        <button type="button" onClick={() => setTab('upload')}
          className={clsx('flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
            tab === 'upload' ? 'bg-white shadow-sm text-[#1E293B]' : 'text-muted-500 hover:text-muted-700')}>
          <Camera className="h-3.5 w-3.5" /> Upload File
        </button>
        <button type="button" onClick={() => setTab('url')}
          className={clsx('flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all',
            tab === 'url' ? 'bg-white shadow-sm text-[#1E293B]' : 'text-muted-500 hover:text-muted-700')}>
          <Link className="h-3.5 w-3.5" /> Paste URL
        </button>
      </div>

      {tab === 'upload' && (
        <>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <button type="button" onClick={() => inputRef.current?.click()}
            className="w-full rounded-xl border border-muted-200 bg-white py-2.5 text-xs font-semibold text-muted-600 hover:bg-muted-50 hover:border-muted-300 transition-all flex items-center justify-center gap-2">
            <Upload className="h-3.5 w-3.5" /> {value ? 'Replace Image' : 'Choose Image'}
          </button>
          <p className="text-[11px] text-muted-400 text-center">PNG, JPG, WEBP up to 5 MB</p>
        </>
      )}

      {tab === 'url' && (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleUrlApply(); } }}
            placeholder="https://example.com/image.jpg"
            className="flex-1 h-9 px-3 rounded-xl bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
          />
          <button type="button" onClick={handleUrlApply}
            className="h-9 px-3 rounded-xl bg-[#1E293B] text-white text-xs font-semibold hover:bg-[#334155] transition-colors shrink-0">
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const { products, addProduct, updateProduct, deleteProduct, bulkImportProducts } = useProductStore();
  const categories = useCategoryStore((s) => s.categories);
  const brands     = useBrandStore((s) => s.brands);
  const units      = useUnitStore((s) => s.units);

  // ── Branch-scoped stock ──────────────────────────────────────────────────────
  const activeBranchId    = useBranchStore((s) => s.activeBranchId);
  const branches          = useBranchStore((s) => s.branches);
  const branchStockSlice  = useBranchInventoryStore(
    (s) => activeBranchId ? s.stock[activeBranchId] : undefined
  );
  const sumAcrossBranches = useBranchInventoryStore((s) => s.sumAcrossBranches);
  const setBranchStock    = useBranchInventoryStore((s) => s.setStock);

  /** Returns branch qty. All Branches = SUM. Branch view = branch-only, 0 if not stocked. */
  const branchQty = (p: Product): number => {
    if (!activeBranchId) {
      const sum = sumAcrossBranches(p.id);
      return sum > 0 ? sum : p.stockQuantity;
    }
    return branchStockSlice?.[p.id]?.qty ?? 0;
  };


  // Build dynamic options from category store
  const categoryOptions = useMemo(() => [
    { value: 'all', label: 'All Categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ], [categories]);

  const formCategoryOptions = useMemo(() =>
    categories.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` }))
  , [categories]);

  // Gradient lookup: first check category store (by color class), then presets, then fallback
  const getCategoryGrad = (catId?: string) => {
    const cat = categories.find((c) => c.id === catId);
    if (cat) {
      // Convert stored color to gradient-compatible class
      const bgBase = cat.color.replace('bg-', '');
      return { bg: `from-${bgBase} to-${bgBase}`, accent: cat.accent };
    }
    return PRESET_GRADS[catId ?? 'other'] ?? FALLBACK_GRAD;
  };

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importFileName, setImportFileName] = useState<string>('');
  const [productImage, setProductImage] = useState<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesSearch = q === '' ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q);
      const matchesCategory = categoryFilter === 'all' || p.categoryId === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, categoryFilter]);

  const productCount = products.length;

  const defaultValues: ProductFormData = {
    name: '', sku: '', description: '', modelNumber: '',
    price: 0, wholesalePrice: 0, cost: 0,
    stockQuantity: 0, lowStockThreshold: 10,
    categoryId: categories[0]?.id ?? 'other',
    brandId: '', unitId: '',
    barcode: '', isActive: true, pricingType: 'FIXED',
    expiryDate: '', expiryAlertDays: 30,
  };

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues,
  });

  const isActiveValue = watch('isActive');
  const pricingTypeValue = watch('pricingType');

  // Does the current business type allow negotiable pricing?
  const businessCategory  = useSettingsStore((s) => s.business.businessCategory);
  const supportsNegotiable = NEGOTIABLE_BUSINESS_CATEGORIES.includes(businessCategory);

  useEffect(() => {
    if (!modalOpen) return;
    if (modalMode === 'edit' && editingId) {
      const p = products.find((x) => x.id === editingId);
      if (p) {
        setValue('name', p.name);
        setValue('sku', p.sku);
        setValue('description', p.description ?? '');
        setValue('modelNumber', p.modelNumber ?? '');
        setValue('price', p.price);
        setValue('wholesalePrice', p.wholesalePrice ?? 0);
        setValue('cost', p.cost ?? 0);
        setValue('stockQuantity', p.stockQuantity);
        setValue('lowStockThreshold', p.lowStockThreshold ?? 10);
        setValue('categoryId', p.categoryId ?? (categories[0]?.id ?? 'other'));
        setValue('brandId', p.brandId ?? '');
        setValue('unitId', p.unitId ?? '');
        setValue('barcode', p.barcode ?? '');
        setValue('isActive', p.isActive);
        setValue('pricingType', (p.pricingType as 'FIXED' | 'NEGOTIABLE') ?? 'FIXED');
        setValue('expiryDate', p.expiryDate ?? '');
        setValue('expiryAlertDays', p.expiryAlertDays ?? 30);
        setProductImage(p.imageUrl);
      }
    } else {
      reset(defaultValues);
      setProductImage(undefined);
    }
  }, [modalOpen, modalMode, editingId, products, setValue, reset, categories]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setModalOpen(false); setImportModalOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openAdd = () => { setModalMode('add'); setEditingId(null); setModalOpen(true); };
  const openEdit = (id: string) => { setModalMode('edit'); setEditingId(id); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditingId(null); setProductImage(undefined); };

  const onSubmit = (data: ProductFormData) => {
    const input = {
      name: data.name, sku: data.sku,
      description: data.description || undefined,
      modelNumber: data.modelNumber || undefined,
      price: data.price,
      wholesalePrice: data.wholesalePrice || undefined,
      cost: data.cost || undefined,
      stockQuantity: data.stockQuantity, lowStockThreshold: data.lowStockThreshold,
      categoryId: data.categoryId,
      brandId: data.brandId || undefined,
      unitId: data.unitId || undefined,
      barcode: data.barcode || undefined,
      imageUrl: productImage,
      isActive: data.isActive,
      pricingType: data.pricingType as PricingType,
      expiryDate: data.expiryDate?.trim() || null,
      expiryAlertDays: data.expiryAlertDays ?? 30,
    };

    if (modalMode === 'edit' && editingId) {
      updateProduct(editingId, input);
    } else {
      // Add product to catalog
      const newProduct = addProduct(input);

      // Auto-stock the Head Office branch if quantity > 0
      if (data.stockQuantity > 0) {
        const headOffice = branches.find((b) => b.isHeadOffice && b.isActive);
        const targetBranchId = headOffice?.id ?? 'branch-1'; // fallback to branch-1
        setBranchStock(
          targetBranchId,
          newProduct.id,
          data.stockQuantity,
          data.lowStockThreshold ?? 10,
        );
      }
    }
    closeModal();
  };

  const confirmDelete = (id: string) => { deleteProduct(id); setConfirmingDeleteId(null); };
  const toggleDeleteConfirm = (id: string | null) => setConfirmingDeleteId(id);

  const categoryLabel = (catId?: string) => {
    const found = categories.find((c) => c.id === catId);
    return found ? found.name : catId ?? 'Other';
  };

  const brandLabel = (brandId?: string) => {
    if (!brandId) return null;
    const found = brands.find((b) => b.id === brandId);
    return found ? found.name : null;
  };

  const unitLabel = (unitId?: string) => {
    if (!unitId) return null;
    const found = units.find((u) => u.id === unitId);
    return found ? found.abbreviation : null;
  };

  // ── Import helpers (unchanged logic) ──────────────────────────────────────
  const parseCsvLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
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
  };

  const parseCsv = (text: string): Array<Record<string, string>> => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return [];
    const headers = parseCsvLine(lines[0]).map((h) =>
      h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
    return lines.slice(1).map((l) => {
      const values = parseCsvLine(l);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { if (h) row[h] = values[idx] ?? ''; });
      return row;
    });
  };

  const parseXlsx = async (file: File): Promise<Array<Record<string, string>>> => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];
    return (XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false })).map((obj) =>
      Object.fromEntries(Object.entries(obj).map(([k, v]) => [
        k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        String(v ?? '').trim(),
      ]))
    );
  };

  const handleFileSelected = async (file: File) => {
    setImportFileName(file.name);
    setImportResult(null);
    const nameLower = file.name.toLowerCase();
    let rows: Array<Record<string, string>> = [];
    try {
      if (nameLower.endsWith('.csv')) rows = parseCsv(await file.text());
      else if (nameLower.endsWith('.json')) {
        const parsed = JSON.parse(await file.text());
        if (Array.isArray(parsed)) rows = parsed.map((obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), String(v ?? '')])));
        else { setImportResult({ success: 0, errors: ['Invalid JSON file.'] }); return; }
      } else if (nameLower.endsWith('.tsv')) {
        const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length > 0) {
          const headers = lines[0].split('\t').map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
          rows = lines.slice(1).map((l) => { const vals = l.split('\t'); const row: Record<string, string> = {}; headers.forEach((h, i) => { if (h) row[h] = (vals[i] ?? '').trim(); }); return row; });
        }
      } else if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
        try { rows = await parseXlsx(file); }
        catch { setImportResult({ success: 0, errors: ['Could not read Excel file.'] }); return; }
      } else { setImportResult({ success: 0, errors: ['Unsupported file format.'] }); return; }
    } catch { setImportResult({ success: 0, errors: ['Failed to read the file.'] }); return; }

    const errors: string[] = [];
    const validItems: Array<Partial<Product> & { name: string; sku: string; price: number; stockQuantity: number }> = [];
    rows.forEach((row, idx) => {
      const lineNum = idx + 2;
      const name = row.name || row.product_name || row.productname || row.item || '';
      const sku = row.sku || row.code || row.product_sku || row.productcode || '';
      const priceRaw = row.price ?? row.selling_price ?? row.sellingprice ?? row.sale_price ?? row.unit_price ?? row.rate ?? '0';
      const stockRaw = row.stock ?? row.stock_quantity ?? row.stockquantity ?? row.quantity ?? row.qty ?? row.inventory ?? '0';
      const costRaw = row.cost ?? row.cost_price ?? row.costprice ?? row.purchase_price ?? undefined;
      const categoryId = row.category ?? row.category_id ?? row.categoryid ?? row.type ?? undefined;
      const barcode = row.barcode ?? row.bar_code ?? row.barcode_main ?? row.upc ?? row.ean ?? undefined;
      const lowStockThreshold = row.low_stock_threshold ?? row.lowstock ?? row.reorder_level ?? undefined;
      const description = row.description ?? row.desc ?? row.details ?? undefined;
      const modelNumber = row.model_number ?? row.model ?? row.modelnumber ?? row.part_number ?? undefined;
      const expiryDate  = row.expiry_date  ?? row.expirydate  ?? row.expiry ?? row.expires_on ?? row.best_before ?? undefined;
      if (!name) { errors.push(`Row ${lineNum}: name is required.`); return; }
      if (!sku) { errors.push(`Row ${lineNum}: sku is required.`); return; }
      const price = Number(priceRaw);
      if (isNaN(price) || price <= 0) { errors.push(`Row ${lineNum}: price must be a valid positive number.`); return; }
      const stockQuantity = Number(stockRaw);
      if (isNaN(stockQuantity) || stockQuantity < 0 || !Number.isInteger(stockQuantity)) { errors.push(`Row ${lineNum}: stockQuantity must be a valid non-negative integer.`); return; }
      validItems.push({ name: String(name), sku: String(sku), price, stockQuantity, cost: costRaw !== undefined ? Number(costRaw) : undefined, categoryId: categoryId ? String(categoryId) : (categories[0]?.id ?? 'other'), barcode: barcode ? String(barcode) : undefined, lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : 10, description: description ? String(description) : undefined, modelNumber: modelNumber ? String(modelNumber) : undefined, expiryDate: expiryDate ? String(expiryDate) : undefined, isActive: true });
    });
    if (validItems.length > 0) bulkImportProducts(validItems);
    setImportResult({ success: validItems.length, errors });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFileSelected(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadSampleCsv = () => {
    const lines = [
      'name,sku,category,price,cost,stockQuantity,lowStockThreshold,barcode,model_number,expiry_date,description',
      'Sample Product,SP-001,beverages,10.00,6.50,100,20,6009999,,2027-06-30,Sample description',
      'Phone Model,PM-001,smartphones,1200.00,900.00,10,5,,,,"Samsung Galaxy A55 5G 128GB"',
      'Medicine 50mg,MD-001,prescription,45.00,30.00,50,15,,,2026-12-31,Paracetamol tablet',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.setAttribute('download', 'products-sample.csv');
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const closeImportModal = () => { setImportModalOpen(false); setImportResult(null); setImportFileName(''); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between w-full min-w-0">
        <div className="min-w-0 flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl truncate">Products</h1>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#1E293B]/[0.06] text-[#1E293B] text-xs font-semibold px-3 py-1">
            {productCount} items
          </span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto min-w-0">
          <div className="w-full sm:w-64 shrink-0 min-w-0">
            <Input type="search" placeholder="Search products..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />} className="w-full rounded-xl bg-muted-50" />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto min-w-0">
            <Button variant="outline" size="md" onClick={() => setImportModalOpen(true)} className="rounded-xl">
              <Upload className="h-4 w-4 shrink-0" /><span className="hidden xs:inline">Import</span>
            </Button>
            <button type="button" onClick={openAdd}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] text-white text-sm font-semibold px-4 py-2.5 hover:bg-[#334155] active:scale-[0.98] transition-all shadow-sm w-full sm:w-auto">
              <Plus className="h-4 w-4 shrink-0" /> Add Product
            </button>
          </div>
        </div>
      </div>

      {/* Category Pills + View Toggle */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none w-full min-w-0">
        {categoryOptions.map((cat) => {
          const isActive = categoryFilter === cat.value;
          const catRecord = categories.find((c) => c.id === cat.value);
          return (
            <button key={cat.value} type="button" onClick={() => setCategoryFilter(cat.value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
                isActive ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:border-muted-300 hover:text-muted-900'
              )}>
              {catRecord && <span>{catRecord.icon}</span>}
              {cat.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 shrink-0 pl-3">
          <span className="text-[11px] font-semibold text-muted-400 whitespace-nowrap">
            {filteredProducts.length} of {productCount}
          </span>
          <div className="flex items-center gap-1 rounded-xl bg-muted-100 p-1">
            <button type="button" onClick={() => setViewMode('grid')}
              className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                viewMode === 'grid' ? 'bg-white text-muted-900 shadow-sm' : 'text-muted-400 hover:text-muted-700')}>
              <Grid3X3 className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setViewMode('list')}
              className={clsx('inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                viewMode === 'list' ? 'bg-white text-muted-900 shadow-sm' : 'text-muted-400 hover:text-muted-700')}>
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Grid View ── */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 sm:gap-4 w-full min-w-0">
          {filteredProducts.map((p) => {
            const grad = getCategoryGrad(p.categoryId);
            const isConfirming = confirmingDeleteId === p.id;
            const outOfStock = branchQty(p) === 0;
            const lowStock = branchQty(p) > 0 && branchQty(p) <= (p.lowStockThreshold ?? 10);
            return (
              <div key={p.id} className="min-w-0 flex flex-col bg-white rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.10)] transition-all duration-200">
                {/* Thumbnail */}
                <div className={clsx('aspect-[4/3] flex items-center justify-center relative overflow-hidden',
                  p.imageUrl ? 'bg-muted-50' : `bg-gradient-to-br ${grad.bg}`)}>
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className={`h-10 w-10 sm:h-12 sm:w-12 ${grad.accent} opacity-70`} />
                  )}
                  <div className="absolute top-2.5 left-2.5">
                    {outOfStock ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-danger-500 text-white text-[10px] font-bold px-2.5 py-1 shadow-sm">
                        <XCircle className="h-3 w-3" /> Out of Stock
                      </span>
                    ) : lowStock ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2.5 py-1 border border-amber-200">
                        {branchQty(p)} left
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2.5 py-1 border border-emerald-200">
                        <Check className="h-3 w-3" /> {branchQty(p)} in stock
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-3 sm:p-3.5 flex-1 flex flex-col gap-1.5 min-w-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#1E293B] leading-tight">{p.name}</p>
                    <p className="truncate text-[11px] text-muted-400 font-mono mt-0.5">{p.sku}</p>
                    {p.modelNumber && (
                      <p className="truncate text-[11px] text-blue-600 font-medium mt-0.5" title="Model number">
                        {p.modelNumber}
                      </p>
                    )}
                  </div>
                  {/* Stock quantity — prominent, branch-aware */}
                  <div className={clsx(
                    'flex items-center gap-1.5 rounded-lg px-2 py-1 self-start',
                    outOfStock ? 'bg-red-50 border border-red-200' :
                    lowStock   ? 'bg-amber-50 border border-amber-200' :
                                 'bg-emerald-50 border border-emerald-200',
                  )}>
                    <span className={clsx(
                      'text-xs font-bold',
                      outOfStock ? 'text-red-600' : lowStock ? 'text-amber-700' : 'text-emerald-700',
                    )}>
                      {branchQty(p).toLocaleString()}
                    </span>
                    <span className={clsx(
                      'text-[10px] font-medium',
                      outOfStock ? 'text-red-500' : lowStock ? 'text-amber-600' : 'text-emerald-600',
                    )}>
                      {outOfStock ? 'out of stock' : 'in stock'}
                    </span>
                  </div>
                  <span className="inline-flex items-center self-start rounded-full bg-muted-100 text-muted-600 text-[10px] font-semibold px-2 py-0.5">
                    {categoryLabel(p.categoryId)}
                  </span>
                  {brandLabel(p.brandId) && (
                    <span className="inline-flex items-center self-start rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-semibold px-2 py-0.5">
                      {brandLabel(p.brandId)}
                    </span>
                  )}
                  {unitLabel(p.unitId) && (
                    <span className="inline-flex items-center self-start rounded-full bg-purple-50 text-purple-600 border border-purple-100 text-[10px] font-semibold px-2 py-0.5 font-mono">
                      {unitLabel(p.unitId)}
                    </span>
                  )}
                  <ExpiryBadge product={p} />
                  <div className="mt-auto pt-1 flex items-center justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm sm:text-base font-bold text-[#1E293B] leading-none">{formatCurrency(p.price)}</span>
                      {p.wholesalePrice ? (
                        <span className="text-[10px] font-semibold text-amber-600 leading-none">
                          WS: {formatCurrency(p.wholesalePrice)}
                        </span>
                      ) : null}
                      {p.pricingType === 'NEGOTIABLE' && (
                        <span className="text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 w-fit">
                          Negotiable
                        </span>
                      )}
                    </div>
                    {!isConfirming ? (
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => openEdit(p.id)}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-muted-100 transition-colors">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => toggleDeleteConfirm(p.id)}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-muted-300 hover:text-danger-500 hover:bg-danger-50 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => toggleDeleteConfirm(null)}
                          className="h-7 px-2 inline-flex items-center justify-center rounded-lg text-xs font-semibold text-muted-600 border border-muted-200 hover:bg-muted-50 transition-colors">
                          Cancel
                        </button>
                        <button type="button" onClick={() => confirmDelete(p.id)}
                          className="h-7 px-2 inline-flex items-center justify-center gap-1 rounded-lg text-xs font-semibold bg-danger-500 text-white hover:bg-danger-600 transition-colors">
                          <Check className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && (
            <div className="col-span-full">
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 text-center">
                <Package className="h-12 w-12 text-muted-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-muted-700">No products found</p>
                <p className="mt-1 text-xs text-muted-500">Try adjusting your search or filters.</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── List View ── */}
      {viewMode === 'list' && (
        <Card className="min-w-0 overflow-hidden">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-muted-200 bg-muted-50/50">
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600">Product</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600">Name</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600">SKU</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600">Category</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600 hidden lg:table-cell">Brand</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600 hidden xl:table-cell">Unit</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-right font-semibold text-muted-600">Price</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-left font-semibold text-muted-600">Stock</th>
                  <th className="whitespace-nowrap px-4 sm:px-6 py-3 text-right font-semibold text-muted-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((p) => {
                  const grad = getCategoryGrad(p.categoryId);
                  const isConfirming = confirmingDeleteId === p.id;
                  return (
                    <tr key={p.id} className="border-b border-muted-100 transition-colors last:border-0 hover:bg-muted-50/60">
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3">
                        <div className={clsx('h-10 w-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center',
                          p.imageUrl ? 'bg-muted-50' : `bg-gradient-to-br ${grad.bg}`)}>
                          {p.imageUrl
                            ? <img src={p.imageUrl} alt={p.name} className="h-10 w-10 object-cover" />
                            : <Package className={`h-5 w-5 ${grad.accent}`} />}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3 min-w-0">
                        <div className="min-w-0 max-w-[200px]">
                          <p className="truncate text-sm font-semibold text-muted-900">{p.name}</p>
                          {p.modelNumber && (
                            <p className="truncate text-[11px] text-blue-600 font-medium">{p.modelNumber}</p>
                          )}
                          {p.barcode && <p className="truncate text-[11px] text-muted-400 font-mono">#{p.barcode}</p>}
                          <ExpiryBadge product={p} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3 font-mono text-xs text-muted-600">{p.sku}</td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3">
                        <Badge variant="outline">{categoryLabel(p.categoryId)}</Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3 hidden lg:table-cell">
                        {brandLabel(p.brandId) ? (
                          <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[11px] font-semibold px-2.5 py-0.5">
                            {brandLabel(p.brandId)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3 hidden xl:table-cell">
                        {unitLabel(p.unitId) ? (
                          <span className="inline-flex items-center rounded-full bg-purple-50 text-purple-600 border border-purple-100 text-[11px] font-semibold px-2.5 py-0.5 font-mono">
                            {unitLabel(p.unitId)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-300">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3 text-right">
                        <p className="font-semibold text-primary-700">{formatCurrency(p.price)}</p>
                        {p.wholesalePrice ? (
                          <p className="text-[11px] text-amber-600 font-semibold mt-0.5">WS: {formatCurrency(p.wholesalePrice)}</p>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-muted-700">{branchQty(p).toLocaleString()}</span>
                          {getStockBadge(branchQty(p), p.lowStockThreshold ?? 10)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 sm:px-6 py-3">
                        {!isConfirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p.id)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-danger-600 hover:bg-danger-50 hover:text-danger-700" onClick={() => toggleDeleteConfirm(p.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button variant="outline" size="sm" onClick={() => toggleDeleteConfirm(null)}>Cancel</Button>
                            <Button variant="danger" size="sm" onClick={() => confirmDelete(p.id)}>
                              <Check className="h-3.5 w-3.5" /> Confirm
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredProducts.length === 0 && (
              <div className="p-8 text-center">
                <Package className="h-12 w-12 text-muted-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-muted-700">No products found</p>
              </div>
            )}
          </div>

          {/* Mobile list */}
          <div className="divide-y divide-muted-100 md:hidden">
            {filteredProducts.map((p) => {
              const grad = getCategoryGrad(p.categoryId);
              const isConfirming = confirmingDeleteId === p.id;
              return (
                <div key={p.id} className="p-4 transition-colors hover:bg-muted-50/60 min-w-0">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={clsx('h-14 w-14 rounded-xl overflow-hidden shrink-0 flex items-center justify-center',
                      p.imageUrl ? 'bg-muted-50' : `bg-gradient-to-br ${grad.bg}`)}>
                      {p.imageUrl
                        ? <img src={p.imageUrl} alt={p.name} className="h-14 w-14 object-cover" />
                        : <Package className={`h-6 w-6 ${grad.accent}`} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-muted-900">{p.name}</p>
                      <p className="truncate text-[11px] text-muted-500 font-mono">{p.sku}</p>
                      {p.modelNumber && (
                        <p className="truncate text-[11px] text-blue-600 font-medium">{p.modelNumber}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-[10px] h-5 px-2">{categoryLabel(p.categoryId)}</Badge>
                        {brandLabel(p.brandId) && (
                          <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[10px] font-semibold px-2 py-0.5">
                            {brandLabel(p.brandId)}
                          </span>
                        )}
                        {unitLabel(p.unitId) && (
                          <span className="inline-flex items-center rounded-full bg-purple-50 text-purple-600 border border-purple-100 text-[10px] font-semibold px-2 py-0.5 font-mono">
                            {unitLabel(p.unitId)}
                          </span>
                        )}
                        {getStockBadge(branchQty(p), p.lowStockThreshold ?? 10)}
                        <ExpiryBadge product={p} />
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div><p className="text-muted-500">Price</p>
                      <p className="mt-0.5 font-bold text-primary-700">{formatCurrency(p.price)}</p>
                      {p.wholesalePrice ? (
                        <p className="text-[10px] font-semibold text-amber-600 mt-0.5">WS: {formatCurrency(p.wholesalePrice)}</p>
                      ) : null}
                    </div>
                    <div><p className="text-muted-500">Stock</p><p className="mt-0.5 font-medium text-muted-700">{branchQty(p).toLocaleString()} units</p></div>
                  </div>
                  {!isConfirming ? (
                    <div className="mt-3 flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p.id)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                      <Button variant="ghost" size="sm" className="text-danger-600 hover:bg-danger-50 hover:text-danger-700" onClick={() => toggleDeleteConfirm(p.id)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => toggleDeleteConfirm(null)}>Cancel</Button>
                      <Button variant="danger" size="sm" onClick={() => confirmDelete(p.id)}><Check className="h-3.5 w-3.5" />Confirm</Button>
                    </div>
                  )}
                </div>
              );
            })}
            {filteredProducts.length === 0 && (
              <div className="p-8 text-center">
                <Package className="h-12 w-12 text-muted-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-muted-700">No products found</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Add/Edit Product Modal ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted-900/50 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-full bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden max-h-[92vh] flex flex-col max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-200 shrink-0">
              <div>
                <h2 className="text-lg font-semibold text-muted-900 tracking-tight">
                  {modalMode === 'edit' ? 'Edit Product' : 'Add New Product'}
                </h2>
                <p className="text-xs text-muted-500 mt-0.5">
                  {modalMode === 'edit' ? 'Update product information' : 'Fill in product details below'}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={closeModal}><X className="h-4 w-4" /></Button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto">
              <div className="px-5 py-5 space-y-5">
                {/* Two-column layout on desktop: image left, fields right */}
                <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
                  {/* Image picker */}
                  <div>
                    <ImagePicker value={productImage} onChange={setProductImage} />
                  </div>

                  {/* Core fields */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Input label="Product Name" placeholder="e.g. Coca-Cola 500ml"
                        error={errors.name?.message} {...register('name')} />
                    </div>
                    <div>
                      <Input label="SKU" placeholder="e.g. CC-500"
                        error={errors.sku?.message} {...register('sku')} />
                    </div>
                    <div>
                      <Select label="Category" options={formCategoryOptions} placeholder="Select category"
                        error={errors.categoryId?.message} {...register('categoryId')} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-700 mb-1.5 block">Brand <span className="text-muted-400 font-normal text-xs">(optional)</span></label>
                      <select
                        {...register('brandId')}
                        className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow"
                      >
                        <option value="">— No brand —</option>
                        {brands.filter((b) => b.isActive).map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-700 mb-1.5 block">Unit <span className="text-muted-400 font-normal text-xs">(optional)</span></label>
                      <select
                        {...register('unitId')}
                        className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow"
                      >
                        <option value="">— No unit —</option>
                        {units.filter((u) => u.isActive).map((u) => (
                          <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Input label="Selling Price (GH₵)" type="number" step="0.01" min="0" placeholder="0.00"
                        error={errors.price?.message} {...register('price')} />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-muted-700 mb-1.5 block">
                        Wholesale Price (GH₵) <span className="text-muted-400 font-normal text-xs">(optional)</span>
                      </label>
                      <Input type="number" step="0.01" min="0" placeholder="0.00"
                        error={errors.wholesalePrice?.message} {...register('wholesalePrice')} />
                    </div>
                    <div>
                      <Input label="Unit Cost (GH₵)" type="number" step="0.01" min="0" placeholder="0.00"
                        error={errors.cost?.message} {...register('cost')} />
                    </div>
                    <div>
                      <Input label="Stock Quantity" type="number" step="1" min="0" placeholder="0"
                        error={errors.stockQuantity?.message} {...register('stockQuantity')} />
                    </div>
                    <div>
                      <Input label="Low Stock Threshold" type="number" step="1" min="0" placeholder="10"
                        error={errors.lowStockThreshold?.message} {...register('lowStockThreshold')} />
                    </div>
                    <div className="sm:col-span-2">
                      <Input label="Barcode (optional)" placeholder="e.g. 6001002"
                        error={errors.barcode?.message} {...register('barcode')} />
                    </div>
                    {/* Model Number — hidden for grocery/supermarket/general retail (no model variants) */}
                    {!['PROVISION_GROCERY', 'SUPERMARKET', 'GENERAL_RETAIL'].includes(businessCategory) && (
                      <div className="sm:col-span-2">
                        <Input
                          label="Model Number (optional)"
                          placeholder="e.g. iPhone 15 Pro 256GB, Samsung A55 5G"
                          error={errors.modelNumber?.message}
                          {...register('modelNumber')}
                        />
                        <p className="mt-1 text-[11px] text-muted-400">For phones, electronics and similar — helps identify exact variants.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="flex flex-col space-y-1.5">
                  <label className="text-sm font-medium text-muted-700">Description (optional)</label>
                  <textarea className={clsx('input-base min-h-[80px] resize-y',
                    errors.description && 'border-danger-300 focus:border-danger-500 focus:ring-danger-500/20')}
                    placeholder="Short product description..." rows={3} {...register('description')} />
                  {errors.description?.message && <p className="text-xs text-danger-600">{errors.description.message}</p>}
                </div>

                {/* Expiry Date */}
                <div className="rounded-xl border border-muted-200 bg-muted-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <CalendarClock className="h-4 w-4 text-muted-400" />
                    <span className="text-sm font-semibold text-muted-700">Expiry Date</span>
                    <span className="text-[11px] text-muted-400 font-normal">(optional — for perishables, medicines, food)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted-600 mb-1 block">Expiry Date</label>
                      <input
                        type="date"
                        {...register('expiryDate')}
                        className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow"
                      />
                      <p className="mt-1 text-[11px] text-muted-400">Leave blank if product does not expire.</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-600 mb-1 block">Alert N days before expiry</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        {...register('expiryAlertDays')}
                        className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow"
                      />
                      <p className="mt-1 text-[11px] text-muted-400">Show "expiring soon" warning this many days before the date. Default: 30.</p>
                    </div>
                  </div>
                </div>

                {/* Pricing Type — shown only when business supports negotiable pricing */}
                {supportsNegotiable && (
                  <div className="flex flex-col space-y-2">
                    <label className="text-sm font-medium text-muted-700">Pricing Type</label>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Fixed */}
                      <button
                        type="button"
                        onClick={() => setValue('pricingType', 'FIXED', { shouldValidate: true })}
                        className={clsx(
                          'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                          pricingTypeValue === 'FIXED'
                            ? 'border-[#1E293B] bg-[#1E293B]/5'
                            : 'border-muted-200 bg-white hover:border-muted-300',
                        )}
                      >
                        <span className={clsx('text-sm font-semibold',
                          pricingTypeValue === 'FIXED' ? 'text-[#1E293B]' : 'text-muted-600')}>
                          Fixed Price
                        </span>
                        <span className="text-[11px] text-muted-400 leading-snug">
                          Sell at stated price. No negotiation.
                        </span>
                      </button>

                      {/* Negotiable */}
                      <button
                        type="button"
                        onClick={() => setValue('pricingType', 'NEGOTIABLE', { shouldValidate: true })}
                        className={clsx(
                          'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition-all',
                          pricingTypeValue === 'NEGOTIABLE'
                            ? 'border-amber-500 bg-amber-50'
                            : 'border-muted-200 bg-white hover:border-amber-300',
                        )}
                      >
                        <span className={clsx('text-sm font-semibold',
                          pricingTypeValue === 'NEGOTIABLE' ? 'text-amber-700' : 'text-muted-600')}>
                          Negotiable
                        </span>
                        <span className="text-[11px] text-muted-400 leading-snug">
                          Authorised staff may agree a price at checkout.
                        </span>
                      </button>
                    </div>
                    {pricingTypeValue === 'NEGOTIABLE' && (
                      <p className="text-[11px] text-amber-600 font-medium flex items-center gap-1.5">
                        <span>⚠</span>
                        Base price is preserved — the negotiated price is only recorded on the sale receipt.
                      </p>
                    )}
                  </div>
                )}

                {/* Status */}
                <div className="flex flex-col space-y-1.5">
                  <label className="text-sm font-medium text-muted-700">Product Status</label>
                  <div className="inline-flex w-fit rounded-lg bg-muted-100 p-1">
                    <button type="button" onClick={() => setValue('isActive', true, { shouldValidate: true })}
                      className={clsx('inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-all',
                        isActiveValue ? 'bg-white text-success-700 shadow-sm' : 'text-muted-500 hover:text-muted-700')}>
                      <Check className="h-4 w-4" /> Active
                    </button>
                    <button type="button" onClick={() => setValue('isActive', false, { shouldValidate: true })}
                      className={clsx('inline-flex h-9 items-center gap-1.5 rounded-md px-4 text-sm font-medium transition-all',
                        !isActiveValue ? 'bg-white text-danger-700 shadow-sm' : 'text-muted-500 hover:text-muted-700')}>
                      <X className="h-4 w-4" /> Inactive
                    </button>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 border-t border-muted-100 bg-muted-50/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 shrink-0">
                <Button type="button" variant="outline" size="md" onClick={closeModal} className="w-full sm:w-auto">Cancel</Button>
                <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto">
                  {modalMode === 'edit' ? 'Save Changes' : 'Create Product'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Import Modal ── */}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted-900/50 backdrop-blur-sm" onClick={closeImportModal}>
          <div className="w-full bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden max-h-[90vh] flex flex-col max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="h-4 w-4 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-muted-900 tracking-tight">Import Products</h2>
                  <p className="text-xs text-muted-500 mt-0.5">Upload Excel, CSV, TSV, or JSON file</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={closeImportModal}><X className="h-4 w-4" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <Alert variant="info">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2 text-xs">
                    <p>Required columns: <strong>name</strong>, <strong>sku</strong>, <strong>price</strong>, <strong>stockQuantity</strong></p>
                    <p>Optional: category, cost, lowStockThreshold, barcode, description</p>
                  </div>
                </div>
              </Alert>
              <Button variant="outline" size="sm" onClick={downloadSampleCsv} className="w-full">
                <Download className="h-3.5 w-3.5 shrink-0" /> Download Sample CSV
              </Button>
              <div>
                <input ref={fileInputRef} type="file"
                  accept=".csv,.tsv,.json,.xlsx,.xls,text/csv,text/tab-separated-values,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={handleFileInputChange} className="hidden" />
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className={clsx('w-full border-2 border-dashed rounded-xl px-4 py-8 transition-all flex flex-col items-center justify-center text-center gap-2',
                    importFileName ? 'border-primary-300 bg-primary-50/50' : 'border-muted-300 bg-muted-50 hover:border-primary-400 hover:bg-primary-50/30')}>
                  <div className="h-12 w-12 rounded-xl bg-muted-100 flex items-center justify-center">
                    <Upload className="h-6 w-6 text-muted-500" />
                  </div>
                  {importFileName ? (
                    <><p className="text-sm font-semibold text-muted-900">{importFileName}</p><p className="text-xs text-muted-500">Click to choose a different file</p></>
                  ) : (
                    <><p className="text-sm font-semibold text-muted-800">Click to upload or drag & drop</p><p className="text-xs text-muted-500">Supports Excel, CSV, TSV, JSON</p></>
                  )}
                </button>
              </div>
              {importResult && (
                <div className="space-y-2">
                  {importResult.success > 0 && (
                    <Alert variant="success">
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 shrink-0" />
                        <span className="text-sm font-medium">Successfully imported {importResult.success} product{importResult.success === 1 ? '' : 's'}</span>
                      </div>
                    </Alert>
                  )}
                  {importResult.errors.length > 0 && (
                    <div className="rounded-xl border border-danger-200 bg-danger-50 p-4 space-y-1.5">
                      <div className="flex items-center gap-2 mb-1">
                        <AlertCircle className="h-4 w-4 text-danger-600 shrink-0" />
                        <span className="text-sm font-semibold text-danger-800">{importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}</span>
                      </div>
                      <ul className="text-xs text-danger-700 space-y-0.5 max-h-32 overflow-y-auto list-disc list-inside">
                        {importResult.errors.slice(0, 20).map((err, i) => <li key={i}>{err}</li>)}
                        {importResult.errors.length > 20 && <li>... and {importResult.errors.length - 20} more</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-muted-100 bg-muted-50/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 shrink-0">
              <Button type="button" variant="outline" size="md" onClick={closeImportModal} className="w-full sm:w-auto">
                {importResult?.success ? 'Done' : 'Cancel'}
              </Button>
              {!importResult?.success && (
                <Button type="button" variant="primary" size="md" onClick={() => fileInputRef.current?.click()} className="w-full sm:w-auto">
                  <Upload className="h-4 w-4 shrink-0" /> Choose File
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductsPage;
