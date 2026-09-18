import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Barcode,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  User,
  Receipt,
  Package as PackageIcon,
  X,
  Printer,
  Calculator,
  CheckCircle,
  Banknote,
  Wallet,
  CreditCard,
  Building2,
  Check,
  XCircle,
  Grid3X3,
  List,
  Search,
  ChevronDown,
  UserPlus,
  AlertTriangle,
  Tags,
  DollarSign,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { formatCurrency } from '@/utils/format';
import { PAYMENT_METHODS, APP_NAME } from '@/utils/constants';
import { usePosStore } from '@/stores/pos.store';
import { useProductStore } from '@/stores/product.store';
import { useCategoryStore } from '@/stores/category.store';
import { useCustomerStore } from '@/stores/customer.store';
import { useSalesStore } from '@/stores/sales.store';
import { useDebtStore } from '@/stores/debt.store';
import { useAuthStore } from '@/stores/auth.store';
import { useUserStore } from '@/stores/user.store';
import { useUnitStore } from '@/stores/unit.store';
import { useBranchStore } from '@/stores/branch.store';
import { useBranchInventoryStore } from '@/stores/branchInventory.store';
import { printReceipt, type ReceiptData } from '@/components/Receipt';
import { useSettingsStore } from '@/stores/settings.store';
import type { Product, CartItem } from '@/types';
import { NEGOTIABLE_BUSINESS_CATEGORIES } from '@/types';
import { OperatingModeGuard } from '@/components/guards/OperatingModeGuard';

const FALLBACK_GRADS: Record<string, { bg: string; accent: string }> = {
  beverages: { bg: 'from-blue-100 to-cyan-100',      accent: 'text-blue-600'   },
  food:      { bg: 'from-amber-100 to-yellow-100',   accent: 'text-amber-700'  },
  household: { bg: 'from-sky-100 to-blue-100',       accent: 'text-sky-700'    },
  toiletries:{ bg: 'from-violet-100 to-fuchsia-100', accent: 'text-violet-700' },
  dairy:     { bg: 'from-rose-100 to-pink-100',      accent: 'text-rose-700'   },
  other:     { bg: 'from-emerald-100 to-teal-100',   accent: 'text-emerald-700'},
};

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  CASH: Banknote,
  MOBILE_MONEY: Wallet,
  CARD: CreditCard,
  BANK_TRANSFER: Building2,
  CHEQUE: Receipt,
  CREDIT: CreditCard,
};

export function PosPage() {
  // ── Operating mode — must be the very first hook ──────────────────────────
  const posEnabled = useSettingsStore((s) => s.posEnabled);

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [wholesaleMode, setWholesaleMode] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [creditModalOpen, setCreditModalOpen] = useState(false);
  const [creditUpfront, setCreditUpfront] = useState('0');
  const [localAmountPaid, setLocalAmountPaid] = useState<string>('');
  const [paymentCompleteOpen, setPaymentCompleteOpen] = useState(false);
  const [completedSaleData, setCompletedSaleData] = useState<ReceiptData | null>(null);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // Negotiated-price state: itemId → raw string input (empty = no negotiation)
  const [negotiatedPrices, setNegotiatedPrices] = useState<Record<string, string>>({});
  // Which cart item has the price-negotiation dialog open
  const [negotiatePriceTarget, setNegotiatePriceTarget] = useState<CartItem | null>(null);
  const [negotiatePriceDraft, setNegotiatePriceDraft] = useState<string>('');

  // Customer selector state
  const [customerSearch,   setCustomerSearch]   = useState('');
  const [customerDropOpen, setCustomerDropOpen] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState('Walk-in Customer');
  const customerDropRef = useRef<HTMLDivElement>(null);

  const products = useProductStore((s) => s.products);
  const decrementStock = useProductStore((s) => s.decrementStock);
  const units = useUnitStore((s) => s.units);
  const categories = useCategoryStore((s) => s.categories);
  const allCustomers = useCustomerStore((s) => s.customers);
  const updateCustomer = useCustomerStore((s) => s.updateCustomer);
  const addSale = useSalesStore((s) => s.addSale);
  const addDebt = useDebtStore((s) => s.addDebt);
  const { user } = useAuthStore();
  // Super Admins and Admins can VIEW the POS but cannot process sales.
  // Only CASHIER, MANAGER, INVENTORY_CLERK roles can sell.
  const userRole   = user?.role ?? 'CASHIER';
  const isViewOnly = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
  // Also read from user.store — it has branch as a name string and is updated live
  const userRecords = useUserStore((s) => s.users);

  // ── Branch-scoped stock ──────────────────────────────────────────────────────
  const activeBranchId   = useBranchStore((s) => s.activeBranchId);
  const branches         = useBranchStore((s) => s.branches);

  // Settings — business info for receipt
  const settingsBusiness  = useSettingsStore((s) => s.business);
  const settingsReceipt   = useSettingsStore((s) => s.receipt);

  // ── Negotiation permission ────────────────────────────────────────────────────
  // All authenticated users can set a negotiated price for NEGOTIABLE products.
  // No approval required — any cashier can agree a price with the customer.

  /** Every cart item with pricingType NEGOTIABLE is always approved for price entry. */
  const canNegotiateItem = (_itemId: string) => true;

  // Does the current business type support negotiable pricing at all?
  const businessSupportsNegotiable = NEGOTIABLE_BUSINESS_CATEGORIES.includes(
    settingsBusiness.businessCategory
  );
  // Select only the active branch's stock slice for reactive updates
  const branchStockSlice = useBranchInventoryStore(
    (s) => activeBranchId ? s.stock[activeBranchId] : undefined
  );
  const sumAcrossBranches = useBranchInventoryStore((s) => s.sumAcrossBranches);
  const fetchBranchStock  = useBranchInventoryStore((s) => s.fetchBranchStock);

  // Fetch backend stock for the active branch when it changes
  useEffect(() => {
    if (activeBranchId) {
      void fetchBranchStock(activeBranchId);
    }
  }, [activeBranchId, fetchBranchStock]);

  /**
   * Resolve the branch ID for stock checks.
   * Super Admin: respects activeBranchId exactly — null = "All Branches" aggregate view.
   * Other roles: auto-resolve from user.branch / UserRecord if activeBranchId not set.
   */
  const effectiveBranchId: string | null = (() => {
    const isSuperAdminRole = userRole === 'SUPER_ADMIN';

    // Super Admin: use ONLY activeBranchId — null means they chose "All Branches"
    // Never fall through to user.branch or UserRecord for Super Admin
    if (isSuperAdminRole) return activeBranchId;

    // Non-Super-Admin: activeBranchId should already be set by MainLayout auto-set,
    // but fall back through user.branch and UserRecord just in case.
    if (activeBranchId) return activeBranchId;

    // Source 2: user.branch from auth store (UUID or name)
    const authBranch = user?.branch;
    if (authBranch) {
      const byId   = branches.find((b) => b.id   === authBranch);
      if (byId)   return byId.id;
      const byName = branches.find((b) => b.name.toLowerCase() === authBranch.toLowerCase());
      if (byName) return byName.id;
    }

    // Source 3: UserRecord from user.store
    const record = userRecords.find(
      (u) => u.email === user?.email || u.id === user?.id
    );
    if (record?.branch) {
      const byName = branches.find(
        (b) => b.name.toLowerCase() === record.branch.toLowerCase()
      );
      if (byName) return byName.id;
    }

    return null;
  })();

  /**
   * Returns the branch-specific stock qty for a product.
   * When a branch is active: ONLY that branch's qty — 0 means out of stock at that branch.
   * When "All Branches" (Super Admin view, no branch selected): shows global stockQuantity.
   * NEVER falls back to global when a branch is set — that would let one branch sell another's stock.
   */
  const posStock = (p: Product): number => {
    if (!effectiveBranchId) {
      // All Branches: sum across all branches, fall back to catalog qty for
      // user-added products that don't have branch stock entries yet.
      const sum = sumAcrossBranches(p.id);
      return sum > 0 ? sum : p.stockQuantity;
    }
    return branchStockSlice?.[p.id]?.qty ?? 0;
  };

  const {
    cartItems,
    addItem,
    updateQty,
    removeItem,
    clearCart,
    paymentMethod,
    setPaymentMethod,
    taxRate,
    discountRate,
    setAmountPaid,
    amountPaid,
    changeAmount,
  } = usePosStore();

  useEffect(() => {
    if (!paymentMethod) {
      setPaymentMethod('CASH');
    }
  }, [paymentMethod, setPaymentMethod]);

  // Close customer dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (customerDropRef.current && !customerDropRef.current.contains(e.target as Node)) {
        setCustomerDropOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filtered customers for the dropdown — scoped to active branch
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase();
    // Filter to branch first, then search within
    const branchCustomers = effectiveBranchId
      ? allCustomers.filter((c) => c.isActive && c.branchId === effectiveBranchId)
      : allCustomers.filter((c) => c.isActive);

    if (!q) return branchCustomers.slice(0, 12);
    return branchCustomers
      .filter((c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.company ?? '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [allCustomers, customerSearch, effectiveBranchId]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.isActive),
    [products]
  );

  // Stock counts for filter badges
  const stockCounts = useMemo(() => {
    const ap = products.filter((p) => p.isActive);
    return {
      inStock:   ap.filter((p) => posStock(p) > (p.lowStockThreshold ?? 10)).length,
      lowStock:  ap.filter((p) => posStock(p) > 0 && posStock(p) <= (p.lowStockThreshold ?? 10)).length,
      outStock:  ap.filter((p) => posStock(p) === 0).length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, branchStockSlice, effectiveBranchId]);

  const filteredProducts = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return activeProducts.filter((product: Product) => {
      const matchesSearch =
        searchTerm === '' ||
        product.name.toLowerCase().includes(term) ||
        product.sku.toLowerCase().includes(term) ||
        (product.barcode ?? '').toLowerCase().includes(term);
      const matchesCategory =
        selectedCategory === 'all' || product.categoryId === selectedCategory;
      // Stock filter
      const qty = posStock(product);
      const threshold = product.lowStockThreshold ?? 10;
      const matchesStock =
        stockFilter === 'all'        ? true :
        stockFilter === 'out_of_stock' ? qty === 0 :
        stockFilter === 'low_stock'  ? qty > 0 && qty <= threshold :
        /* in_stock */                 qty > threshold;
      return matchesSearch && matchesCategory && matchesStock;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, selectedCategory, activeProducts, stockFilter, branchStockSlice, effectiveBranchId]);

  const getGradient = (cat?: string) => {
    // Try category store first (dynamic categories)
    const stored = categories.find((c) => c.id === cat);
    if (stored) {
      const base = stored.color.replace('bg-', '');
      return { bg: `from-${base} to-${base}`, accent: stored.accent };
    }
    return FALLBACK_GRADS[cat ?? 'other'] ?? FALLBACK_GRADS.other;
  };

  const addItemToCart = (p: Product) => {
    if (isViewOnly) return;   // Admin/Super Admin cannot add to cart
    if (posStock(p) <= 0) return;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `cart-${Date.now()}-${Math.random()}`;
    const existing = cartItems.find((c) => c.productId === p.id);
    const currentQtyInCart = existing ? existing.quantity : 0;
    if (currentQtyInCart + 1 > posStock(p)) return;
    const unit = p.unitId ? units.find((u) => u.id === p.unitId) : undefined;
    // Use wholesale price when wholesale mode is active (falls back to retail if not set)
    const effectivePrice = wholesaleMode && p.wholesalePrice ? p.wholesalePrice : p.price;
    addItem({
      id,
      productId: p.id,
      name: p.name,
      sku: p.sku,
      price: effectivePrice,
      quantity: 1,
      unitAbbrev: unit?.abbreviation,
      pricingType: p.pricingType ?? 'FIXED',
    });
  };

  const totalQty = cartItems.reduce((s, i) => s + i.quantity, 0);
  // When a negotiated price is entered for a NEGOTIABLE item, use it for subtotal.
  // The product's base price is NEVER changed — we only record the negotiated price on the sale.
  const resolvedPrice = (item: CartItem): number => {
    const raw = negotiatedPrices[item.id];
    if (item.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && canNegotiateItem(item.id) && raw) {
      const parsed = parseFloat(raw);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return item.price;
  };
  const subtotal = cartItems.reduce((s, i) => s + resolvedPrice(i) * i.quantity, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const discountAmount = subtotal * (discountRate / 100);
  const totalAmount = subtotal + taxAmount - discountAmount;
  const remainingBalance = Math.max(0, totalAmount - amountPaid);
  const isPaymentSufficient = paymentMethod === 'CREDIT' || (amountPaid >= totalAmount && totalAmount > 0);

  const openPaymentModal = () => {
    if (cartItems.length === 0 || !paymentMethod) return;
    if (paymentMethod === 'CREDIT') {
      // Show the credit modal so cashier can enter any upfront amount (0 is fine)
      setCreditUpfront('0');
      setCreditModalOpen(true);
      return;
    }
    setLocalAmountPaid(totalAmount.toFixed(2));
    setAmountPaid(totalAmount);
    setPaymentModalOpen(true);
  };

  const applyLocalAmount = (val: string) => {
    setLocalAmountPaid(val);
    const num = Number(val);
    if (!isNaN(num)) setAmountPaid(num);
    else setAmountPaid(0);
  };

  const quickAmount = (amt: number) => {
    applyLocalAmount(amt.toFixed(2));
  };

  useEffect(() => {
    if (paymentModalOpen) {
      setLocalAmountPaid(totalAmount.toFixed(2));
      setAmountPaid(totalAmount);
    }
  }, [totalAmount, paymentModalOpen, setAmountPaid]);

  const handleCheckout = (creditUpfrontAmt?: number) => {
    if (cartItems.length === 0 || !paymentMethod) return;
    if (paymentMethod !== 'CREDIT' && !isPaymentSufficient) return;

    const isCredit = paymentMethod === 'CREDIT';
    // For credit: upfront can be 0 or any partial amount the debtor pays now
    const upfront = isCredit ? Math.max(0, Math.min(creditUpfrontAmt ?? 0, totalAmount)) : amountPaid;

    cartItems.forEach((item: CartItem) => {
      decrementStock(item.productId, item.quantity, effectiveBranchId ?? undefined);
    });

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const seq = String(Math.floor(Math.random() * 9000) + 1000);
    const reference = `SL-${dateStr}-${seq}`;
    const yearShort = now.toISOString().slice(2, 10).replace(/-/g, '');
    const invoiceNumber = `INV-${yearShort}-${seq}`;
    const cashierName = user ? `${user.firstName} ${user.lastName}` : 'Cashier';

    // Resolve branch details for receipt
    const activeBranch = branches.find((b) => b.id === effectiveBranchId) ?? null;
    const branchPhone  = activeBranch?.phone ?? '';
    const branchName   = activeBranch?.name ?? '';

    const receiptData: ReceiptData = {
      reference,
      customerName: selectedCustomerName,
      items: cartItems.map((ci) => {
        const raw = negotiatedPrices[ci.id];
        const negotiated = (ci.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && canNegotiateItem(ci.id) && raw)
          ? parseFloat(raw) : undefined;
        const validNeg = negotiated && !isNaN(negotiated) && negotiated > 0 ? negotiated : undefined;
        return {
          ...ci,
          // Use negotiated price as the effective price for the receipt line
          price: validNeg ?? ci.price,
          subtotal: (validNeg ?? ci.price) * ci.quantity,
          // Preserve the original base price for audit
          originalPrice: validNeg ? ci.price : undefined,
          negotiatedPrice: validNeg,
        };
      }),
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      paymentMethod,
      amountPaid: isCredit ? upfront : amountPaid,
      changeAmount: isCredit ? 0 : changeAmount,
      amountOwed: isCredit ? Math.max(0, totalAmount - upfront) : 0,
      cashierName,
      timestamp: now.toISOString(),
      businessName:    settingsReceipt.showBusinessName ? (settingsBusiness.name || APP_NAME) : APP_NAME,
      businessAddress: settingsReceipt.showAddress      ? settingsBusiness.address : '',
      businessPhone:   settingsReceipt.showPhone        ? settingsBusiness.phone   : '',
      branchName,
      branchPhone,
    };

    // ── Write to useSalesStore so SalesPage and customer history both see it ──
    addSale({
      reference,
      invoiceNumber,
      customerName: selectedCustomerName,
      cashierName,
      items: cartItems.map((ci) => {
        const raw = negotiatedPrices[ci.id];
        const negotiated = (ci.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && canNegotiateItem(ci.id) && raw)
          ? parseFloat(raw) : undefined;
        const validNeg = negotiated && !isNaN(negotiated) && negotiated > 0 ? negotiated : undefined;
        return {
          ...ci,
          price: validNeg ?? ci.price,
          subtotal: (validNeg ?? ci.price) * ci.quantity,
          originalPrice: validNeg ? ci.price : undefined,
          negotiatedPrice: validNeg,
        };
      }),
      subtotal,
      taxAmount,
      discountAmount,
      totalAmount,
      paymentMethod,
      amountPaid: isCredit ? upfront : amountPaid,
      changeAmount: isCredit ? 0 : changeAmount,
      amountOwed: isCredit ? Math.max(0, totalAmount - upfront) : 0,
      status: 'COMPLETED',
      paymentStatus: isCredit ? (upfront >= totalAmount ? 'PAID' : upfront > 0 ? 'PARTIAL' : 'CREDIT') : 'PAID',
      totalQty: cartItems.reduce((s, i) => s + i.quantity, 0),
      notes: isCredit ? `Credit sale. Upfront paid: ${upfront.toFixed(2)}` : '',
      branchId: effectiveBranchId ?? null,
    });

    // ── If credit sale → create a debt record ──────────────────────────────
    if (isCredit) {
      const matchedCustomer = allCustomers.find(
        (c) => `${c.firstName} ${c.lastName}` === selectedCustomerName
      );
      const owedAmount = totalAmount - upfront;
      if (owedAmount > 0) {
        addDebt({
          invoiceNumber,
          reference,
          customerName: selectedCustomerName,
          customerPhone: matchedCustomer?.phone,
          cashierName,
          items: cartItems.map((ci) => ({ ...ci })),
          subtotal,
          taxAmount,
          discountAmount,
          totalAmount,
          amountPaid: upfront,
          notes: upfront > 0
            ? `Partial payment of ${formatCurrency(upfront)} received upfront.`
            : 'Full credit — no payment at time of sale.',
          branchId: effectiveBranchId ?? null,
        });
        // Update customer creditBalance with only the owed portion
        if (matchedCustomer) {
          updateCustomer(matchedCustomer.id, {
            creditBalance:     matchedCustomer.creditBalance + owedAmount,
            totalPurchases:    matchedCustomer.totalPurchases + totalAmount,
            totalTransactions: matchedCustomer.totalTransactions + 1,
          });
        }
      } else {
        // Fully paid upfront even though credit method — just update stats
        if (matchedCustomer) {
          updateCustomer(matchedCustomer.id, {
            totalPurchases:    matchedCustomer.totalPurchases + totalAmount,
            totalTransactions: matchedCustomer.totalTransactions + 1,
          });
        }
      }
    } else {
      // ── Update customer stats for regular sale ─────────────────────────────
      if (selectedCustomerName !== 'Walk-in Customer') {
        const matchedCustomer = allCustomers.find(
          (c) => `${c.firstName} ${c.lastName}` === selectedCustomerName
        );
        if (matchedCustomer) {
          updateCustomer(matchedCustomer.id, {
            totalPurchases:    matchedCustomer.totalPurchases + totalAmount,
            totalTransactions: matchedCustomer.totalTransactions + 1,
          });
        }
      }
    }

    setPaymentModalOpen(false);
    setCreditModalOpen(false);
    setCompletedSaleData(receiptData);
    setPaymentCompleteOpen(true);
    setMobileCartOpen(false);

    try {
      printReceipt(receiptData);
    } catch {
      // noop
    }
  };

  const closeCompleteAndClear = () => {
    setPaymentCompleteOpen(false);
    setCompletedSaleData(null);
    clearCart();
    setNegotiatedPrices({});
    setNegotiatePriceTarget(null);
    setNegotiatePriceDraft('');
    setLocalAmountPaid('');
    setMobileCartOpen(false);
    setSelectedCustomerName('Walk-in Customer');
    setCustomerSearch('');
  };

  const reprintReceipt = () => {
    if (completedSaleData) {
      try {
        printReceipt(completedSaleData);
      } catch {
        // noop
      }
    }
  };

  const reference =
    cartItems.length > 0
      ? `SL-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(
          Math.floor(Math.random() * 9000) + 1000
        )}`
      : 'SL-20250908-0000';

  // ── Operating mode guard ──────────────────────────────────────────────────
  if (!posEnabled) {
    return <OperatingModeGuard requiredMode="pos" />;
  }

  return (
    <div className="h-[calc(100vh-4rem)] -mx-4 sm:-mx-6 lg:-mx-8 min-w-0">
      <div className="h-full flex flex-col lg:flex-row min-w-0">
        <div className="flex-1 flex flex-col overflow-hidden bg-[#F8FAFC] lg:border-r border-muted-200 min-w-0">
          <div className="px-3 sm:px-5 lg:px-6 py-3 sm:py-4 border-b border-muted-200 bg-white shrink-0 space-y-3">
            {/* View-only banner for Super Admin / Admin */}
            {isViewOnly && (
              <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 mb-1">
                <span className="text-lg">👁</span>
                <div>
                  <p className="text-xs font-bold text-amber-800">View-Only Mode</p>
                  <p className="text-[11px] text-amber-600">
                    You can browse products but cannot process sales. Assign a Cashier role to sell.
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {/* Row 1: Search + view toggles + wholesale */}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="relative min-w-0 flex-1 sm:max-w-xs md:max-w-sm">
                  <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400 shrink-0" />
                  <Input
                    type="search"
                    placeholder="Scan barcode or search..."
                    className="h-10 pl-10 w-full text-sm rounded-xl bg-muted-50 border-muted-200"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* View toggle */}
                <div className="flex items-center gap-1 rounded-xl bg-muted-100 p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={clsx(
                      'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                      viewMode === 'grid' ? 'bg-white text-muted-900 shadow-sm' : 'text-muted-400 hover:text-muted-700'
                    )}
                    aria-label="Grid view"
                  >
                    <Grid3X3 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    className={clsx(
                      'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                      viewMode === 'list' ? 'bg-white text-muted-900 shadow-sm' : 'text-muted-400 hover:text-muted-700'
                    )}
                    aria-label="List view"
                  >
                    <List className="h-4 w-4" />
                  </button>
                </div>

                {/* Wholesale mode toggle */}
                <button
                  type="button"
                  onClick={() => setWholesaleMode((v) => !v)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 h-10 px-3 rounded-xl text-xs font-semibold border transition-all duration-200 whitespace-nowrap',
                    wholesaleMode
                      ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                      : 'bg-white text-muted-600 border-muted-200 hover:border-amber-300 hover:text-amber-700'
                  )}
                  title={wholesaleMode ? 'Switch to Retail Prices' : 'Switch to Wholesale Prices'}
                >
                  <Tags className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{wholesaleMode ? 'Wholesale' : 'Retail'}</span>
                </button>
              </div>

              {/* Row 2 (full width): Stock filter pills */}
              <div className="w-full flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                {([
                  { value: 'all',          label: 'All',      count: null,                activeCls: 'bg-[#1E293B] text-white',           inactiveCls: 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50' },
                  { value: 'in_stock',     label: 'In Stock', count: stockCounts.inStock,  activeCls: 'bg-emerald-500 text-white',          inactiveCls: 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50' },
                  { value: 'low_stock',    label: 'Low',      count: stockCounts.lowStock, activeCls: 'bg-amber-500 text-white',            inactiveCls: 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50' },
                  { value: 'out_of_stock', label: 'Out',      count: stockCounts.outStock, activeCls: 'bg-rose-500 text-white',             inactiveCls: 'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50' },
                ] as const).map(({ value, label, count, activeCls, inactiveCls }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStockFilter(value)}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all shrink-0',
                      stockFilter === value ? activeCls : inactiveCls
                    )}
                  >
                    {label}
                    {count !== null && (
                      <span className={clsx(
                        'inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[16px] h-4 px-1',
                        stockFilter === value ? 'bg-white/25 text-white' : 'bg-muted-100 text-muted-600'
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {/* "All" pill */}
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
                  selectedCategory === 'all'
                    ? 'bg-[#1E293B] text-white shadow-sm'
                    : 'bg-white text-muted-600 border border-muted-200 hover:border-muted-300 hover:text-muted-900'
                )}
              >
                All Categories
              </button>
              {categories.map((cat) => {
                const isActive = selectedCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0',
                      isActive
                        ? 'bg-[#1E293B] text-white shadow-sm'
                        : 'bg-white text-muted-600 border border-muted-200 hover:border-muted-300 hover:text-muted-900'
                    )}
                  >
                    <span>{cat.icon}</span>{cat.name}
                  </button>
                );
              })}
              <div className="ml-auto shrink-0 pl-2">
                <span className="text-[11px] font-semibold text-muted-400">
                  {filteredProducts.length} items
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5">
            {/* Wholesale mode banner */}
            {wholesaleMode && (
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5">
                <Tags className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-xs font-semibold text-amber-700">
                  Wholesale mode active — prices shown at wholesale rates where available
                </p>
                <button
                  type="button"
                  onClick={() => setWholesaleMode(false)}
                  className="ml-auto text-amber-500 hover:text-amber-700 transition-colors"
                  title="Switch back to retail"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4">
                {filteredProducts.map((product: Product) => {
                  const lowStock = posStock(product) <= (product.lowStockThreshold ?? 20);
                  const outOfStock = posStock(product) === 0;
                  const grad = getGradient(product.categoryId);
                  return (
                    <div
                      key={product.id}
                      className={clsx(
                        'group relative flex flex-col bg-white rounded-2xl overflow-hidden transition-all duration-200 min-w-0',
                        'shadow-[0_2px_8px_rgba(0,0,0,0.06)]',
                        outOfStock
                          ? 'opacity-55 cursor-not-allowed'
                          : isViewOnly
                            ? 'cursor-default opacity-80'
                            : 'hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.10)] cursor-pointer'
                      )}
                    >
                      {/* Image area */}
                      <div
                        className={clsx(
                          'aspect-[4/3] flex items-center justify-center relative overflow-hidden',
                          product.imageUrl ? 'bg-muted-50' : `bg-gradient-to-br ${grad.bg}`
                        )}
                        onClick={() => !outOfStock && addItemToCart(product)}
                      >
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <PackageIcon
                            className={`h-10 w-10 sm:h-12 sm:w-12 ${grad.accent} opacity-70 group-hover:scale-110 transition-transform duration-300 shrink-0`}
                          />
                        )}

                        {/* Status badge — now on card content with stock count */}
                        <div className="absolute top-2.5 left-2.5">
                          {outOfStock ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-500 text-white text-[10px] font-bold px-2.5 py-1 shadow-sm">
                              <XCircle className="h-3 w-3" />
                              Out of Stock
                            </span>
                          ) : lowStock ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2.5 py-1 border border-amber-200">
                              {posStock(product)} left
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2.5 py-1 border border-emerald-200">
                              <Check className="h-3 w-3" />
                              {posStock(product)} in stock
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card content */}
                      <div className="p-3 sm:p-3.5 flex-1 flex flex-col gap-1 min-w-0">
                        <p className="text-sm font-bold text-[#1E293B] line-clamp-1 leading-tight truncate">
                          {product.name}
                        </p>
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          <div className="flex flex-col min-w-0">
                            <span className={clsx(
                              'text-sm sm:text-base font-bold leading-none whitespace-nowrap',
                              wholesaleMode && product.wholesalePrice ? 'text-amber-600' : 'text-[#1E293B]'
                            )}>
                              {wholesaleMode && product.wholesalePrice
                                ? formatCurrency(product.wholesalePrice)
                                : formatCurrency(product.price)}
                            </span>
                            {wholesaleMode && product.wholesalePrice && (
                              <span className="text-[9px] text-muted-400 leading-none mt-0.5">
                                Retail: {formatCurrency(product.price)}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-muted-400 truncate">
                            {product.sku}
                          </span>
                        </div>
                        {(() => { const u = product.unitId ? units.find((u) => u.id === product.unitId) : undefined; return u ? (
                          <span className="inline-flex items-center self-start rounded-full bg-purple-50 text-purple-600 border border-purple-100 text-[10px] font-semibold px-2 py-0.5 font-mono">
                            {u.abbreviation}
                          </span>
                        ) : null; })()}
                      </div>

                      {/* Add to Cart button */}
                      {!outOfStock && (
                        <div className="px-3 pb-3 sm:px-3.5 sm:pb-3.5">
                          <button
                            type="button"
                            onClick={() => addItemToCart(product)}
                            className="w-full h-9 rounded-xl bg-[#1E293B] text-white text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[#334155] active:scale-[0.98] transition-all duration-150 shadow-sm"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add to Cart
                          </button>
                        </div>
                      )}
                      {outOfStock && (
                        <div className="px-3 pb-3 sm:px-3.5 sm:pb-3.5">
                          <div className="w-full h-9 rounded-xl bg-muted-100 text-muted-400 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-not-allowed">
                            <XCircle className="h-3.5 w-3.5" />
                            Not Available
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <div className="col-span-full">
                    <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                      <div className="relative mb-4">
                        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted-100 border-2 border-dashed border-muted-300">
                          <PackageIcon className="h-9 w-9 text-muted-400" />
                        </div>
                      </div>
                      <h3 className="text-base font-semibold text-muted-900">
                        No products match
                      </h3>
                      <p className="text-sm text-muted-500 mt-1.5 max-w-[260px]">
                        Try adjusting your search or category filter.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:gap-3">
                {filteredProducts.map((product: Product) => {
                  const lowStock = posStock(product) <= (product.lowStockThreshold ?? 20);
                  const outOfStock = posStock(product) === 0;
                  const grad = getGradient(product.categoryId);
                  return (
                    <div
                      key={product.id}
                      onClick={() => !outOfStock && addItemToCart(product)}
                      className={clsx(
                        'group relative flex flex-row bg-white rounded-xl border shadow-sm overflow-hidden transition-all duration-200 cursor-pointer min-w-0',
                        outOfStock
                          ? 'border-muted-200 opacity-60 cursor-not-allowed hover:shadow-sm'
                          : 'border-muted-200 hover:shadow-md hover:border-primary-300'
                      )}
                    >
                      <div
                        className={clsx(
                          'aspect-square flex items-center justify-center relative shrink-0 h-full w-[80px] sm:w-[100px] lg:w-[110px] max-w-[120px] overflow-hidden',
                          product.imageUrl ? 'bg-muted-50' : `bg-gradient-to-br ${grad.bg}`
                        )}
                      >
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <PackageIcon
                            className={`h-7 w-7 sm:h-9 sm:w-9 lg:h-10 lg:w-10 ${grad.accent} opacity-80 group-hover:scale-105 transition-transform shrink-0`}
                          />
                        )}
                        {outOfStock ? (
                          <div className="absolute top-2 left-2">
                            <Badge variant="danger" dot>Out</Badge>
                          </div>
                        ) : lowStock ? (
                          <div className="absolute top-2 left-2">
                            <Badge variant="warning" dot>{posStock(product)} left</Badge>
                          </div>
                        ) : null}
                      </div>
                      <div className="p-2.5 sm:p-3 flex-1 flex items-center justify-between gap-2 sm:gap-3 min-w-0">
                        <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-semibold text-muted-900 line-clamp-1 leading-tight truncate">
                            {product.name}
                          </p>
                          <span className="text-[10px] sm:text-xs text-muted-500 font-mono truncate">
                            {product.sku} · {posStock(product)} in stock
                          </span>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                          <div className="flex flex-col items-end">
                            <span className={clsx(
                              'text-xs sm:text-base font-bold leading-none whitespace-nowrap',
                              wholesaleMode && product.wholesalePrice ? 'text-amber-600' : 'text-primary-700'
                            )}>
                              {wholesaleMode && product.wholesalePrice
                                ? formatCurrency(product.wholesalePrice)
                                : formatCurrency(product.price)}
                            </span>
                            {wholesaleMode && product.wholesalePrice && (
                              <span className="text-[9px] text-muted-400 leading-none mt-0.5">
                                Retail: {formatCurrency(product.price)}
                              </span>
                            )}
                          </div>
                          {!outOfStock && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addItemToCart(product);
                              }}
                              className="h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600 hover:bg-primary-600 hover:text-white transition-all duration-200 flex"
                              aria-label="Add to cart"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredProducts.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
                    <div className="relative mb-4">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-muted-100 border-2 border-dashed border-muted-300">
                        <PackageIcon className="h-9 w-9 text-muted-400" />
                      </div>
                    </div>
                    <h3 className="text-base font-semibold text-muted-900">
                      No products match
                    </h3>
                    <p className="text-sm text-muted-500 mt-1.5 max-w-[260px]">
                      Try adjusting your search or category filter.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Mobile Cart Backdrop */}
        {mobileCartOpen && (
          <div
            className="fixed inset-0 z-40 bg-muted-900/50 backdrop-blur-sm lg:hidden animate-fade-in"
            onClick={() => setMobileCartOpen(false)}
          />
        )}

        <aside
          className={clsx(
            // Mobile: fixed overlay drawer, hidden by default
            'fixed inset-x-0 bottom-0 z-50 lg:z-auto lg:static',
            !mobileCartOpen && 'hidden',
            mobileCartOpen && 'flex animate-slide-up',
            'lg:!flex lg:animate-none',
            // Sizing & layout
            'lg:w-[340px] xl:w-[380px] 2xl:w-[420px] flex-col bg-white',
            'border-t lg:border-t-0 lg:border-l border-muted-200',
            'shadow-[0_-4px_20px_rgba(0,0,0,0.08)] lg:shadow-none',
            'max-h-[88vh] lg:max-h-none',
            'h-auto lg:h-auto flex-1 lg:flex-none min-w-0',
            'rounded-t-2xl lg:rounded-none'
          )}
        >
          {/* Mobile drag handle */}
          <div className="lg:hidden flex justify-center pt-2 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-300" />
          </div>

          {/* Order Summary Header */}
          <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-muted-200 shrink-0">
            <div className="flex flex-col min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-[#1E293B] leading-tight">
                Order Summary
              </h2>
              <span className="text-[11px] text-muted-400 font-mono mt-0.5">
                #{reference}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={clearCart}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-400 hover:text-danger-600 hover:bg-danger-50 transition-colors"
                title="Clear cart"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              {/* Mobile close button */}
              <button
                type="button"
                className="lg:hidden inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted-400 hover:text-muted-900 hover:bg-muted-100 transition-colors"
                onClick={() => setMobileCartOpen(false)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Customer Picker */}
          <div ref={customerDropRef} className="px-4 sm:px-5 py-2.5 border-b border-muted-100 bg-[#F8FAFC] shrink-0 relative">
            <button
              type="button"
              onClick={() => { setCustomerDropOpen((v) => !v); setCustomerSearch(''); }}
              className="w-full flex items-center gap-2.5 min-w-0 group"
            >
              {/* Avatar */}
              <div className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-full shrink-0 text-xs font-bold ring-2 ring-white shadow-sm',
                selectedCustomerName === 'Walk-in Customer'
                  ? 'bg-muted-200 text-muted-500'
                  : 'bg-[#1E293B] text-white'
              )}>
                {selectedCustomerName === 'Walk-in Customer'
                  ? <User className="h-4 w-4" />
                  : selectedCustomerName.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)}
              </div>

              <div className="flex-1 min-w-0 text-left">
                <p className={clsx('text-xs font-semibold truncate',
                  selectedCustomerName === 'Walk-in Customer' ? 'text-muted-500' : 'text-[#1E293B]')}>
                  {selectedCustomerName}
                </p>
                <p className="text-[10px] text-muted-400">
                  {selectedCustomerName === 'Walk-in Customer' ? 'Tap to select customer' : 'Customer selected'}
                </p>
              </div>

              <ChevronDown className={clsx('h-4 w-4 text-muted-400 shrink-0 transition-transform',
                customerDropOpen && 'rotate-180')} />
            </button>

            {/* Dropdown */}
            {customerDropOpen && (
              <div className="absolute left-0 right-0 top-full z-50 bg-white border border-muted-200 shadow-xl rounded-b-2xl overflow-hidden max-h-72 flex flex-col">
                {/* Search input */}
                <div className="px-3 py-2.5 border-b border-muted-100 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-400" />
                    <input
                      autoFocus
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Search customers…"
                      className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted-50 border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                    />
                  </div>
                </div>

                <div className="overflow-y-auto flex-1">
                  {/* Walk-in option */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomerName('Walk-in Customer');
                      setCustomerDropOpen(false);
                    }}
                    className={clsx(
                      'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted-50 transition-colors text-left border-b border-muted-50',
                      selectedCustomerName === 'Walk-in Customer' && 'bg-muted-50'
                    )}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted-100 shrink-0">
                      <UserPlus className="h-4 w-4 text-muted-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#1E293B]">Walk-in Customer</p>
                      <p className="text-[10px] text-muted-400">No account needed</p>
                    </div>
                    {selectedCustomerName === 'Walk-in Customer' && (
                      <Check className="h-3.5 w-3.5 text-emerald-600 ml-auto shrink-0" />
                    )}
                  </button>

                  {/* Customer list */}
                  {filteredCustomers.length === 0 ? (
                    <p className="px-4 py-6 text-center text-xs text-muted-400">No customers found</p>
                  ) : (
                    filteredCustomers.map((c) => {
                      const fullName = `${c.firstName} ${c.lastName}`;
                      const initials = `${c.firstName[0] ?? ''}${c.lastName[0] ?? ''}`.toUpperCase();
                      const isSelected = selectedCustomerName === fullName;
                      const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-rose-500', 'bg-amber-500'];
                      const avatarColor = colors[(c.firstName.charCodeAt(0) + c.lastName.charCodeAt(0)) % colors.length];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedCustomerName(fullName);
                            setCustomerDropOpen(false);
                          }}
                          className={clsx(
                            'w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted-50 transition-colors text-left',
                            isSelected && 'bg-muted-50'
                          )}
                        >
                          <div className={clsx('flex h-8 w-8 items-center justify-center rounded-full text-white text-[10px] font-bold shrink-0', avatarColor)}>
                            {initials}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-[#1E293B] truncate">{fullName}</p>
                            <p className="text-[10px] text-muted-400 truncate">
                              {c.phone}{c.company ? ` · ${c.company}` : ''}
                            </p>
                          </div>
                          {isSelected && <Check className="h-3.5 w-3.5 text-emerald-600 ml-auto shrink-0" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4 min-h-0">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-4 sm:py-8">
                <div className="relative mb-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted-100 border-2 border-dashed border-muted-200">
                    <ShoppingCart className="h-7 w-7 text-muted-300" />
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-muted-700">
                  No items yet
                </h3>
                <p className="text-xs text-muted-400 mt-1 max-w-[220px]">
                  Click on products or scan barcodes to add items to this order.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {cartItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-1.5 p-2.5 rounded-xl border border-muted-100 bg-white hover:border-muted-200 transition-colors"
                  >
                    {/* ── Top row: name + qty controls + subtotal + remove ── */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-bold text-[#1E293B] truncate line-clamp-1 block">
                          {item.name}
                          {item.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && (
                            <span className="ml-1.5 inline-flex items-center text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                              Negotiable
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-muted-400 font-mono mt-0.5 block">
                          {item.sku} · {formatCurrency(item.price)} {item.unitAbbrev ? `/ ${item.unitAbbrev}` : 'ea'}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => updateQty(item.id, item.quantity - 1)}
                          className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-muted-100 text-muted-600 hover:bg-muted-200 active:bg-muted-300 transition-colors"
                          aria-label="Decrease quantity"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="min-w-[1.5rem] text-center text-xs font-bold text-[#1E293B]">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.id, item.quantity + 1)}
                          className="h-6 w-6 inline-flex items-center justify-center rounded-md bg-muted-100 text-muted-600 hover:bg-muted-200 active:bg-muted-300 transition-colors"
                          aria-label="Increase quantity"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <span className="text-xs font-bold text-[#1E293B] whitespace-nowrap shrink-0 min-w-[3.5rem] text-right">
                        {formatCurrency(resolvedPrice(item) * item.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          removeItem(item.id);
                          setNegotiatedPrices((prev) => {
                            const next = { ...prev };
                            delete next[item.id];
                            return next;
                          });
                        }}
                        className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-300 hover:text-danger-500 hover:bg-danger-50 transition-colors shrink-0"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    {/* ── Negotiable row: Set Price button (authorised) ── */}
                    {item.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && canNegotiateItem(item.id) && (
                      <div className="flex items-center gap-2 pt-1 border-t border-amber-100">
                        {negotiatedPrices[item.id] && parseFloat(negotiatedPrices[item.id]) > 0 ? (
                          /* Applied state — show negotiated price + original + edit button */
                          <>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">
                                  Negotiated
                                </span>
                                <span className="text-xs font-bold text-amber-700">
                                  {formatCurrency(parseFloat(negotiatedPrices[item.id]))}
                                </span>
                                <span className="text-[10px] text-muted-400 line-through">
                                  {formatCurrency(item.price)}
                                </span>
                                <span className="text-[10px] font-semibold text-amber-600">
                                  −{formatCurrency(item.price - parseFloat(negotiatedPrices[item.id]))}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setNegotiatePriceTarget(item);
                                setNegotiatePriceDraft(negotiatedPrices[item.id] ?? '');
                              }}
                              className="shrink-0 h-6 px-2 rounded-md text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setNegotiatedPrices((prev) => {
                                  const next = { ...prev };
                                  delete next[item.id];
                                  return next;
                                })
                              }
                              className="shrink-0 h-6 px-2 rounded-md text-[10px] font-semibold text-muted-500 border border-muted-200 hover:bg-muted-50 transition-colors"
                            >
                              Reset
                            </button>
                          </>
                        ) : (
                          /* No negotiated price yet — show Set Price button */
                          <>
                            <DollarSign className="h-3 w-3 text-amber-500 shrink-0" />
                            <span className="text-[10px] text-amber-600 font-medium flex-1">
                              Negotiable price — tap to set
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setNegotiatePriceTarget(item);
                                setNegotiatePriceDraft('');
                              }}
                              className="shrink-0 h-7 px-3 rounded-lg text-xs font-bold text-amber-700 bg-amber-50 border border-amber-300 hover:bg-amber-100 active:scale-95 transition-all"
                            >
                              Set Price
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    {/* Info strip — only shown if somehow business doesn't support negotiable */}
                    {item.pricingType === 'NEGOTIABLE' && businessSupportsNegotiable && !canNegotiateItem(item.id) && (
                      <div className="flex items-center gap-1.5 pt-1 border-t border-amber-100">
                        <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                        <span className="text-[10px] text-amber-500 flex-1">
                          Negotiable — contact your administrator.
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pricing & Checkout */}
          <div className="border-t border-muted-200 bg-white shrink-0">
            <div className="px-4 sm:px-5 py-3 space-y-2 bg-[#F8FAFC] border-b border-muted-100">
              <div className="flex items-center justify-between text-xs min-w-0 gap-2">
                <span className="text-muted-500 font-medium shrink-0">Subtotal</span>
                <span className="font-semibold text-[#1E293B] whitespace-nowrap">
                  {formatCurrency(subtotal)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs min-w-0 gap-2">
                <span className="text-muted-500 font-medium flex items-center gap-1 shrink-0">
                  Taxes
                  {taxRate === 0 && (
                    <span className="text-[9px] bg-muted-100 text-muted-500 rounded px-1 py-0.5">Exempt</span>
                  )}
                </span>
                <span className="font-semibold text-[#1E293B] whitespace-nowrap">
                  {formatCurrency(taxAmount)}
                </span>
              </div>
              {discountRate > 0 && (
                <div className="flex items-center justify-between text-xs min-w-0 gap-2">
                  <span className="text-muted-500 font-medium shrink-0">Discount</span>
                  <span className="font-semibold text-emerald-600 whitespace-nowrap">
                    -{formatCurrency(discountAmount)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-muted-200 min-w-0 gap-2">
                <span className="font-bold text-[#1E293B] text-sm shrink-0">Total Payment</span>
                <span className="text-lg font-bold text-[#1E293B] tracking-tight whitespace-nowrap">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>

            <div className="px-4 sm:px-5 py-3 space-y-3">
              {/* Payment Method */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold text-muted-500 uppercase tracking-wider">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    ...PAYMENT_METHODS,
                    { value: 'CREDIT', label: 'Credit', icon: 'CreditCard' },
                  ].map((method) => {
                    const isSelected = paymentMethod === method.value;
                    const Icon = PAYMENT_ICONS[method.value] || Banknote;
                    const isCredit = method.value === 'CREDIT';
                    return (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setPaymentMethod(method.value as any)}
                        className={clsx(
                          'flex flex-col items-center justify-center gap-1 rounded-xl border transition-all duration-200 py-2 px-1',
                          isSelected
                            ? isCredit
                              ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-400/30'
                              : 'border-[#1E293B] bg-[#1E293B]/[0.04] ring-1 ring-[#1E293B]/20'
                            : 'border-muted-200 bg-white hover:border-muted-300'
                        )}
                        title={method.label}
                      >
                        <div
                          className={clsx(
                            'h-6 w-6 rounded-lg flex items-center justify-center shrink-0',
                            isSelected
                              ? isCredit ? 'bg-amber-500 text-white' : 'bg-[#1E293B] text-white'
                              : 'bg-muted-100 text-muted-500'
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </div>
                        <span
                          className={clsx(
                            'text-[9px] font-semibold leading-tight text-center truncate w-full',
                            isSelected
                              ? isCredit ? 'text-amber-600' : 'text-[#1E293B]'
                              : 'text-muted-500'
                          )}
                        >
                          {method.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Credit warning */}
                {paymentMethod === 'CREDIT' && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      <strong>Credit sale</strong> — customer owes the full amount. A debt record will be created automatically. Select a customer above to link the debt.
                    </p>
                  </div>
                )}
              </div>

              {/* Confirm Payment Button */}
              {isViewOnly ? (
                <div className="w-full rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-center">
                  <p className="text-xs font-bold text-amber-700">👁 View Only</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    {userRole === 'SUPER_ADMIN' ? 'Super Admins' : 'Admins'} cannot process sales.
                    Only Cashiers can sell.
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openPaymentModal}
                  disabled={cartItems.length === 0 || !paymentMethod}
                  className={clsx(
                    'w-full h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200',
                    cartItems.length > 0 && paymentMethod
                      ? 'bg-[#1E293B] text-white hover:bg-[#334155] active:scale-[0.98] shadow-lg shadow-[#1E293B]/20'
                      : 'bg-muted-200 text-muted-400 cursor-not-allowed'
                  )}
                >
                  Confirm Payment
                  <span className="font-mono text-xs font-bold bg-white/15 px-2 py-0.5 rounded-md">
                    {formatCurrency(totalAmount)}
                  </span>
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* Floating Cart Button - Mobile Only */}
      {!mobileCartOpen && (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="lg:hidden fixed bottom-5 right-5 z-30 flex items-center gap-2.5 h-14 pl-4 pr-5 rounded-full bg-[#1E293B] text-white shadow-xl shadow-black/20 hover:bg-[#334155] active:scale-95 transition-all duration-200"
        >
          <div className="relative">
            <ShoppingCart className="h-5 w-5" />
            {totalQty > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-danger-500 text-white text-[10px] font-bold px-1 ring-2 ring-primary-600">
                {totalQty}
              </span>
            )}
          </div>
          <div className="flex flex-col items-start">
            <span className="text-xs font-semibold leading-tight">
              {totalQty > 0 ? 'View Cart' : 'Cart'}
            </span>
            {totalQty > 0 && (
              <span className="text-[10px] font-bold text-white/80 leading-tight">
                {formatCurrency(totalAmount)}
              </span>
            )}
          </div>
        </button>
      )}

      {/* ── Negotiate Price Modal ── */}
      {negotiatePriceTarget && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-muted-900/60 backdrop-blur-sm"
          onClick={() => setNegotiatePriceTarget(null)}
        >
          <div
            className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 border border-amber-200 shrink-0">
                  <DollarSign className="h-4.5 w-4.5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#1E293B] leading-tight truncate max-w-[200px]">
                    {negotiatePriceTarget.name}
                  </p>
                  <p className="text-[10px] text-muted-400 font-mono mt-0.5">
                    {negotiatePriceTarget.sku}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setNegotiatePriceTarget(null)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-400 hover:text-muted-700 hover:bg-muted-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">
              {/* Original price display */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted-50 border border-muted-100">
                <span className="text-xs font-semibold text-muted-600">Original Price</span>
                <span className="text-base font-bold text-[#1E293B]">
                  {formatCurrency(negotiatePriceTarget.price)}
                </span>
              </div>

              {/* Negotiated price input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-700 flex items-center gap-1">
                  Negotiated Price
                  <span className="text-[10px] text-muted-400 font-normal">(agreed with customer)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-amber-700 pointer-events-none">
                    {settingsBusiness.currencySymbol || 'GH₵'}
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    autoFocus
                    value={negotiatePriceDraft}
                    onChange={(e) => setNegotiatePriceDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = parseFloat(negotiatePriceDraft);
                        if (!isNaN(val) && val > 0) {
                          setNegotiatedPrices((prev) => ({ ...prev, [negotiatePriceTarget.id]: negotiatePriceDraft }));
                          setNegotiatePriceTarget(null);
                        }
                      }
                      if (e.key === 'Escape') setNegotiatePriceTarget(null);
                    }}
                    placeholder={negotiatePriceTarget.price.toFixed(2)}
                    className="w-full h-12 pl-12 pr-4 rounded-xl bg-amber-50 border-2 border-amber-300 text-lg font-bold text-amber-800 placeholder:text-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 transition-all"
                  />
                </div>

                {/* Live difference indicator */}
                {negotiatePriceDraft && parseFloat(negotiatePriceDraft) > 0 && (
                  <div className={clsx(
                    'flex items-center gap-1.5 text-xs font-semibold',
                    parseFloat(negotiatePriceDraft) < negotiatePriceTarget.price
                      ? 'text-emerald-600'
                      : parseFloat(negotiatePriceDraft) > negotiatePriceTarget.price
                        ? 'text-rose-500'
                        : 'text-muted-500',
                  )}>
                    {parseFloat(negotiatePriceDraft) < negotiatePriceTarget.price && (
                      <><span>↓</span><span>Price reduced by {formatCurrency(negotiatePriceTarget.price - parseFloat(negotiatePriceDraft))}</span></>
                    )}
                    {parseFloat(negotiatePriceDraft) > negotiatePriceTarget.price && (
                      <><span>↑</span><span>Price above original by {formatCurrency(parseFloat(negotiatePriceDraft) - negotiatePriceTarget.price)}</span></>
                    )}
                    {parseFloat(negotiatePriceDraft) === negotiatePriceTarget.price && (
                      <span className="text-muted-400">Same as original price</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Footer buttons */}
            <div className="px-5 py-4 border-t border-muted-100 flex gap-3">
              <button
                type="button"
                onClick={() => setNegotiatePriceTarget(null)}
                className="flex-1 h-10 rounded-xl border border-muted-200 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!negotiatePriceDraft || parseFloat(negotiatePriceDraft) <= 0 || isNaN(parseFloat(negotiatePriceDraft))}
                onClick={() => {
                  const val = parseFloat(negotiatePriceDraft);
                  if (!isNaN(val) && val > 0) {
                    setNegotiatedPrices((prev) => ({ ...prev, [negotiatePriceTarget.id]: negotiatePriceDraft }));
                    setNegotiatePriceTarget(null);
                  }
                }}
                className="flex-1 h-10 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
              >
                <Check className="h-4 w-4" />
                Apply Price
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Credit Sale Modal ── */}
      {creditModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted-900/50 backdrop-blur-sm"
          onClick={() => setCreditModalOpen(false)}
        >
          <div
            className="w-full bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden max-h-[90vh] flex flex-col max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-muted-900 tracking-tight">Credit Sale</h2>
                  <p className="text-xs text-muted-500 mt-0.5">Enter any upfront payment (GH₵0 is allowed)</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setCreditModalOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {/* Total due banner */}
              <div className="rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 p-5">
                <p className="text-[10px] text-amber-600 font-semibold uppercase tracking-wider">Total Invoice Amount</p>
                <p className="text-3xl font-bold text-amber-700 mt-1 tracking-tight">{formatCurrency(totalAmount)}</p>
                <p className="text-xs text-muted-500 mt-1">{totalQty} item{totalQty === 1 ? '' : 's'} · {selectedCustomerName}</p>
              </div>

              {/* Upfront payment input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-700 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" />
                  Upfront Payment (enter 0 if nothing paid now)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={totalAmount}
                  autoFocus
                  placeholder="0.00"
                  value={creditUpfront}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCreditUpfront(val);
                  }}
                  className="h-12 text-lg font-bold text-right"
                />
                {/* Quick amount buttons */}
                <div className="flex flex-wrap gap-2">
                  {[0, totalAmount / 2, totalAmount * 0.75, totalAmount]
                    .map((v) => Math.round(v * 100) / 100)
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => setCreditUpfront(amt.toFixed(2))}
                        className={clsx(
                          'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all',
                          Math.abs(parseFloat(creditUpfront || '0') - amt) < 0.01
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'bg-white text-muted-700 border-muted-200 hover:border-amber-300 hover:bg-amber-50'
                        )}
                      >
                        {amt === 0 ? 'Nothing' : amt === totalAmount ? 'Full' : formatCurrency(amt)}
                      </button>
                    ))}
                </div>
              </div>

              {/* Debt summary */}
              <div className="rounded-xl border border-muted-200 overflow-hidden divide-y divide-muted-100">
                <div className="flex items-center justify-between px-4 py-3 text-sm bg-muted-50/50">
                  <span className="text-muted-600">Total Invoice</span>
                  <span className="font-semibold">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-muted-600">Paid Upfront</span>
                  <span className="font-semibold text-emerald-600">
                    {formatCurrency(parseFloat(creditUpfront || '0'))}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-rose-50/60">
                  <span className="text-rose-700 text-sm font-bold">Outstanding Debt</span>
                  <span className="font-bold text-rose-700 text-lg">
                    {formatCurrency(Math.max(0, totalAmount - parseFloat(creditUpfront || '0')))}
                  </span>
                </div>
              </div>

              {/* Warning note */}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  A <strong>debt record</strong> will be created for the outstanding balance.
                  The customer can pay it later from the <strong>Debts & Credit</strong> page.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-muted-100 bg-muted-50/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 shrink-0">
              <Button type="button" variant="outline" size="md" className="w-full sm:w-auto"
                onClick={() => setCreditModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700"
                onClick={() => {
                  const upfrontAmt = Math.max(0, parseFloat(creditUpfront || '0'));
                  handleCheckout(upfrontAmt);
                }}
              >
                <CheckCircle className="h-4 w-4 shrink-0" />
                Confirm Credit Sale
              </Button>
            </div>
          </div>
        </div>
      )}

      {paymentModalOpen && (        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted-900/50 backdrop-blur-sm"
          onClick={() => setPaymentModalOpen(false)}
        >
          <div
            className="w-full bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden max-h-[90vh] flex flex-col max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-200 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                  <Calculator className="h-4.5 w-4.5 text-primary-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-muted-900 tracking-tight">
                    Process Payment
                  </h2>
                  <p className="text-xs text-muted-500 mt-0.5">
                    {PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label || 'Payment'}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setPaymentModalOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              <div className="rounded-xl bg-gradient-to-br from-primary-50 to-secondary-50 border border-primary-200 p-5">
                <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">
                  Total Amount Due
                </p>
                <p className="text-3xl font-bold text-primary-700 mt-1 tracking-tight">
                  {formatCurrency(totalAmount)}
                </p>
                <p className="text-xs text-muted-500 mt-1">
                  {totalQty} item{totalQty === 1 ? '' : 's'} · {reference}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-700 flex items-center gap-1.5">
                  <Banknote className="h-3.5 w-3.5" />
                  Amount Paid
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  autoFocus
                  placeholder="0.00"
                  value={localAmountPaid}
                  onChange={(e) => applyLocalAmount(e.target.value)}
                  className="h-12 text-lg font-bold text-right focus:ring-primary-500/30 focus:border-primary-500"
                />
                <div className="flex flex-wrap gap-2">
                  {[totalAmount, Math.ceil(totalAmount / 10) * 10, Math.ceil(totalAmount / 50) * 50, Math.ceil(totalAmount / 100) * 100]
                    .filter((v, i, arr) => arr.indexOf(v) === i)
                    .map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => quickAmount(amt)}
                        className={clsx(
                          'px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all',
                          Math.abs(Number(localAmountPaid) - amt) < 0.001
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white text-muted-700 border-muted-200 hover:border-primary-300 hover:bg-primary-50'
                        )}
                      >
                        {formatCurrency(amt)}
                      </button>
                    ))}
                </div>
              </div>

              <div className="rounded-xl border border-muted-200 overflow-hidden divide-y divide-muted-100">
                <div className="flex items-center justify-between px-4 py-3 text-sm bg-muted-50/50">
                  <span className="text-muted-600">Subtotal</span>
                  <span className="font-semibold text-muted-900">{formatCurrency(subtotal)}</span>
                </div>
                {taxAmount > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="text-muted-600">VAT ({taxRate}%)</span>
                    <span className="font-semibold text-muted-900">{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="text-muted-600">Discount</span>
                    <span className="font-semibold text-success-700">-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="font-bold text-muted-900">Total Due</span>
                  <span className="font-bold text-primary-700 text-base">{formatCurrency(totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3 bg-muted-50/50">
                  <span className="text-muted-600 text-sm">Amount Paid</span>
                  <span
                    className={clsx(
                      'font-semibold text-sm',
                      isPaymentSufficient ? 'text-success-700' : 'text-danger-700'
                    )}
                  >
                    {formatCurrency(amountPaid)}
                  </span>
                </div>
                {changeAmount > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-success-50/60">
                    <span className="text-success-700 text-sm font-semibold">Change</span>
                    <span className="font-bold text-success-700 text-lg">
                      {formatCurrency(changeAmount)}
                    </span>
                  </div>
                )}
                {remainingBalance > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 bg-danger-50/60">
                    <span className="text-danger-700 text-sm font-semibold">Balance Remaining</span>
                    <span className="font-bold text-danger-700 text-lg">
                      {formatCurrency(remainingBalance)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-muted-100 bg-muted-50/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => setPaymentModalOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={!isPaymentSufficient}
                onClick={() => handleCheckout()}
                className="w-full sm:w-auto"
              >
                <CheckCircle className="h-4 w-4 shrink-0" />
                Confirm Payment
              </Button>
            </div>
          </div>
        </div>
      )}

      {paymentCompleteOpen && completedSaleData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-muted-900/50 backdrop-blur-sm"
          onClick={closeCompleteAndClear}
        >
          <div
            className="w-full bg-white rounded-2xl shadow-2xl border border-muted-200 overflow-hidden max-h-[90vh] flex flex-col max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {completedSaleData.paymentMethod === 'CREDIT' ? (
              /* ── Credit sale success ── */
              <>
                <div className="px-5 pt-8 pb-5 text-center bg-gradient-to-b from-amber-50 to-white">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 bg-amber-200 rounded-full blur-xl opacity-40" />
                    <div className="relative h-20 w-20 rounded-full bg-amber-100 border-4 border-amber-200 flex items-center justify-center">
                      <AlertTriangle className="h-11 w-11 text-amber-600" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-muted-900 tracking-tight mt-5">
                    Credit Invoice Created
                  </h2>
                  <p className="text-sm text-muted-500 mt-1.5">{completedSaleData.reference}</p>
                  <div className="mt-5 inline-flex items-center justify-center rounded-2xl bg-white border border-muted-200 px-6 py-4 shadow-sm gap-5">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Total Invoice</p>
                      <p className="text-2xl font-bold text-amber-700 tracking-tight">
                        {formatCurrency(completedSaleData.totalAmount)}
                      </p>
                    </div>
                    <div className="w-px h-12 bg-muted-200" />
                    <div className="text-center">
                      <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Debt Owed</p>
                      <p className="text-2xl font-bold text-rose-600 tracking-tight">
                        {formatCurrency(Math.max(0, completedSaleData.totalAmount - completedSaleData.amountPaid))}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-2 border-y border-muted-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Customer</span>
                    <span className="font-semibold text-muted-900">{completedSaleData.customerName}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Paid Upfront</span>
                    <span className="font-semibold text-emerald-600">{formatCurrency(completedSaleData.amountPaid)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Outstanding</span>
                    <span className="font-semibold text-rose-600">
                      {formatCurrency(Math.max(0, completedSaleData.totalAmount - completedSaleData.amountPaid))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Cashier</span>
                    <span className="font-semibold text-muted-900">{completedSaleData.cashierName}</span>
                  </div>
                </div>
                <div className="rounded-xl mx-5 my-3 bg-amber-50 border border-amber-200 px-4 py-2.5 flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700">Debt recorded. Go to <strong>Debts & Credit</strong> to track payment.</p>
                </div>
                <div className="px-5 py-4 bg-muted-50/60 flex flex-col xs:flex-row items-stretch xs:items-center justify-between gap-2 shrink-0">
                  <Button type="button" variant="outline" size="md" onClick={reprintReceipt} className="w-full xs:w-auto">
                    <Printer className="h-4 w-4 shrink-0" /> Print Invoice
                  </Button>
                  <Button type="button" variant="primary" size="md" onClick={closeCompleteAndClear} className="w-full xs:w-auto">
                    <ShoppingCart className="h-4 w-4 shrink-0" /> New Sale
                  </Button>
                </div>
              </>
            ) : (
              /* ── Regular sale success ── */
              <>
                <div className="px-5 pt-8 pb-5 text-center bg-gradient-to-b from-success-50 to-white">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 bg-success-200 rounded-full blur-xl opacity-40" />
                    <div className="relative h-20 w-20 rounded-full bg-success-100 border-4 border-success-200 flex items-center justify-center">
                      <CheckCircle className="h-11 w-11 text-success-600" strokeWidth={2.5} />
                    </div>
                  </div>
                  <h2 className="text-2xl font-bold text-muted-900 tracking-tight mt-5">Payment Successful</h2>
                  <p className="text-sm text-muted-500 mt-1.5">Sale {completedSaleData.reference}</p>
                  <div className="mt-5 inline-flex items-center justify-center rounded-2xl bg-white border border-muted-200 px-6 py-4 shadow-sm">
                    <div className="text-right">
                      <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Total Paid</p>
                      <p className="text-2xl font-bold text-primary-700 tracking-tight">{formatCurrency(completedSaleData.totalAmount)}</p>
                    </div>
                    {completedSaleData.changeAmount > 0 && (
                      <>
                        <div className="w-px h-12 bg-muted-200 mx-5" />
                        <div className="text-left">
                          <p className="text-[10px] text-muted-500 font-semibold uppercase tracking-wider">Change Due</p>
                          <p className="text-2xl font-bold text-success-700 tracking-tight">{formatCurrency(completedSaleData.changeAmount)}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div className="px-5 py-4 space-y-2 border-y border-muted-100">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Customer</span>
                    <span className="font-semibold text-muted-900">{completedSaleData.customerName}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Payment Method</span>
                    <span className="font-semibold text-muted-900">
                      {PAYMENT_METHODS.find((m) => m.value === completedSaleData.paymentMethod)?.label || completedSaleData.paymentMethod}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Items</span>
                    <span className="font-semibold text-muted-900">{completedSaleData.items.length}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-600">Cashier</span>
                    <span className="font-semibold text-muted-900">{completedSaleData.cashierName}</span>
                  </div>
                </div>
                <div className="px-5 py-4 bg-muted-50/60 flex flex-col xs:flex-row items-stretch xs:items-center justify-between gap-2 shrink-0">
                  <Button type="button" variant="outline" size="md" onClick={reprintReceipt} className="w-full xs:w-auto">
                    <Printer className="h-4 w-4 shrink-0" /> Reprint Receipt
                  </Button>
                  <Button type="button" variant="primary" size="md" onClick={closeCompleteAndClear} className="w-full xs:w-auto">
                    <ShoppingCart className="h-4 w-4 shrink-0" /> New Sale
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default PosPage;
