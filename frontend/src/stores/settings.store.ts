import { create } from 'zustand';
import type { BusinessCategory } from '@/types';
import { NEGOTIABLE_BUSINESS_CATEGORIES } from '@/types';
import api from '@/services/api';

export interface BusinessConfig {
  name: string;
  type: string;
  /** Stable machine-readable business category (matches backend BusinessCategory enum) */
  businessCategory: BusinessCategory;
  address: string;
  phone: string;
  email: string;
  tin: string;
  currency: string;
  currencySymbol: string;
  logoUrl: string;
}

export interface TaxConfig {
  enabled: boolean;
  name: string;
  rate: number;
  inclusive: boolean;
}

export interface ReceiptConfig {
  showLogo: boolean;
  showBusinessName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showTin: boolean;
  headerText: string;
  footerText: string;
  paperWidth: '58mm' | '80mm' | 'A4';
  showThankYou: boolean;
  thankYouMessage: string;
}

/** Pricing behaviour settings for the business. */
export interface PricingConfig {
  /**
   * When true, Cashiers may finalise a negotiated price without approval.
   * Default: false — only Admin/Manager can negotiate by default.
   */
  allowCashierPriceNegotiation: boolean;
}

export type InventoryMode =
  | 'FULL_POS'         // Full POS + Inventory (default)
  | 'INVENTORY_ONLY'   // Inventory / Stock Only — new sales blocked
  | 'POS_ONLY'         // POS / Sales Only — inventory management hidden
  // Legacy values mapped on the fly to the three canonical modes above
  | 'STOCK_ENABLED'    // treated as FULL_POS
  | 'SALES_ONLY';      // treated as POS_ONLY

/** Map legacy backend values to the canonical three-way mode */
export function resolveOperatingMode(mode: InventoryMode): 'FULL_POS' | 'INVENTORY_ONLY' | 'POS_ONLY' {
  if (mode === 'STOCK_ENABLED') return 'FULL_POS';
  if (mode === 'SALES_ONLY')    return 'POS_ONLY';
  return mode as 'FULL_POS' | 'INVENTORY_ONLY' | 'POS_ONLY';
}

/** Inventory / stock-tracking settings for the business. */
export interface InventoryConfig {
  /**
   * FULL_POS        : full POS checkout + inventory management (default).
   * INVENTORY_ONLY  : stock management only; new sales are blocked.
   * POS_ONLY        : sales/checkout only; inventory workflows are hidden.
   * Legacy STOCK_ENABLED → FULL_POS.  Legacy SALES_ONLY → POS_ONLY.
   */
  inventoryMode: InventoryMode;
}

/** Branch mode — controls whether branch management UI is shown. */
export type BranchMode = 'SINGLE' | 'MULTI';

export interface BranchConfig {
  /**
   * SINGLE: business has one fixed location — Branches nav item is hidden.
   * MULTI:  business has multiple locations — full branch management is shown.
   */
  branchMode: BranchMode;
}

export interface PaymentMethodConfig {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  type: 'CASH' | 'MOBILE_MONEY' | 'CARD' | 'BANK' | 'DIGITAL' | 'CREDIT';
}

export interface EmailNotificationConfig {
  ownerEmail: string;
  ownerName: string;
  dailyReportEnabled: boolean;
  dailyReportTime: string;
  weeklyReportEnabled: boolean;
  weeklyReportDay: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  lowStockAlertEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  smtpFromName: string;
  smtpFromEmail: string;
  smtpUseTls: boolean;
}

interface SettingsStore {
  business: BusinessConfig;
  tax: TaxConfig;
  receipt: ReceiptConfig;
  pricing: PricingConfig;
  inventory: InventoryConfig;
  branchConfig: BranchConfig;
  paymentMethods: PaymentMethodConfig[];
  emailNotifications: EmailNotificationConfig;
  updateBusiness: (data: Partial<BusinessConfig>) => void;
  updateTax: (data: Partial<TaxConfig>) => void;
  updateReceipt: (data: Partial<ReceiptConfig>) => void;
  updatePricing: (data: Partial<PricingConfig>) => void;
  updateInventory: (data: Partial<InventoryConfig>) => void;
  updateBranchConfig: (data: Partial<BranchConfig>) => void;
  togglePaymentMethod: (id: string) => void;
  updateEmailNotifications: (data: Partial<EmailNotificationConfig>) => void;
  /**
   * Fetch real business/settings data from the backend and merge it into
   * the store.  Called after login so System Settings always reflects
   * the customer's actual Business record — not the localStorage defaults.
   */
  syncFromBackend: () => Promise<void>;
  /** Computed: does the current business track stock quantities? */
  readonly stockEnabled: boolean;
  /** Computed: canonical three-way operating mode */
  readonly operatingMode: 'FULL_POS' | 'INVENTORY_ONLY' | 'POS_ONLY';
  /** Computed: can the current business create POS sales? */
  readonly posEnabled: boolean;
  /** Computed: can the current business manage inventory/stock? */
  readonly inventoryEnabled: boolean;
  /** Computed: does the current business category support negotiable pricing? */
  readonly supportsNegotiablePricing: boolean;
  /** Computed: is this a single-branch business (branch nav hidden)? */
  readonly isSingleBranch: boolean;
}

const STORAGE_KEY = 'popmyc-settings';

const defaultBusiness: BusinessConfig = {
  // These are intentional empty/generic defaults for a fresh installation.
  // Real values are loaded from the backend after login via syncFromBackend().
  // DO NOT put developer names, addresses, phone numbers, or emails here.
  name: '',
  type: 'general',
  businessCategory: 'GENERAL_RETAIL',
  address: '',
  phone: '',
  email: '',
  tin: '',
  currency: 'GHS',
  currencySymbol: 'GH₵',
  logoUrl: '',
};

const defaultTax: TaxConfig = {
  enabled: true,
  name: 'VAT',
  rate: 15,
  inclusive: true,
};

const defaultReceipt: ReceiptConfig = {
  showLogo: true,
  showBusinessName: true,
  showAddress: true,
  showPhone: true,
  showTin: true,
  headerText: '',
  footerText: 'Thank you for your purchase!',
  paperWidth: '80mm',
  showThankYou: true,
  thankYouMessage: 'Thank you for shopping with us! We appreciate your business.',
};

const defaultPricing: PricingConfig = {
  allowCashierPriceNegotiation: false,
};

const defaultInventory: InventoryConfig = {
  inventoryMode: 'FULL_POS',
};

const defaultBranchConfig: BranchConfig = {
  branchMode: 'SINGLE',
};

const defaultPaymentMethods: PaymentMethodConfig[] = [
  { id: 'pm1', name: 'Cash',            code: 'CASH',         enabled: true,  type: 'CASH'         },
  { id: 'pm2', name: 'MTN Mobile Money',code: 'MTN_MOMO',     enabled: true,  type: 'MOBILE_MONEY' },
  { id: 'pm3', name: 'Telecel Cash',    code: 'TELECEL_CASH', enabled: true,  type: 'MOBILE_MONEY' },
  { id: 'pm4', name: 'AirtelTigo Money',code: 'AT_MONEY',     enabled: false, type: 'MOBILE_MONEY' },
  { id: 'pm5', name: 'Card Payment',    code: 'CARD',         enabled: true,  type: 'CARD'         },
  { id: 'pm6', name: 'Bank Transfer',   code: 'BANK_TRANSFER',enabled: true,  type: 'BANK'         },
  { id: 'pm7', name: 'Cheque',          code: 'CHEQUE',       enabled: false, type: 'BANK'         },
  { id: 'pm8', name: 'Customer Credit', code: 'CREDIT',       enabled: true,  type: 'CREDIT'       },
];

const defaultEmailNotifications: EmailNotificationConfig = {
  ownerEmail: '',
  ownerName: '',
  dailyReportEnabled: false,
  dailyReportTime: '20:00',
  weeklyReportEnabled: false,
  weeklyReportDay: 'MON',
  lowStockAlertEnabled: false,
  smtpHost: '',
  smtpPort: 587,
  smtpUsername: '',
  smtpPassword: '',
  smtpFromName: '',
  smtpFromEmail: '',
  smtpUseTls: true,
};

interface StoredState {
  business: BusinessConfig;
  tax: TaxConfig;
  receipt: ReceiptConfig;
  pricing?: PricingConfig;
  inventory?: InventoryConfig;
  branchConfig?: BranchConfig;
  paymentMethods: PaymentMethodConfig[];
  emailNotifications?: EmailNotificationConfig;
}

function loadState(): StoredState & { pricing: PricingConfig; inventory: InventoryConfig; branchConfig: BranchConfig; emailNotifications: EmailNotificationConfig } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredState;
      if (parsed?.business) {
        return {
          ...parsed,
          business: {
            ...defaultBusiness,
            ...parsed.business,
            businessCategory: parsed.business.businessCategory ?? 'GENERAL_RETAIL',
          },
          pricing:      { ...defaultPricing,      ...(parsed.pricing      ?? {}) },
          inventory:    { ...defaultInventory,    ...(parsed.inventory    ?? {}) },
          branchConfig: { ...defaultBranchConfig, ...(parsed.branchConfig ?? {}) },
          emailNotifications: { ...defaultEmailNotifications, ...(parsed.emailNotifications ?? {}) },
        };
      }
    }
  } catch { /* noop */ }
  const initial = {
    business:           defaultBusiness,
    tax:                defaultTax,
    receipt:            defaultReceipt,
    pricing:            defaultPricing,
    inventory:          defaultInventory,
    branchConfig:       defaultBranchConfig,
    paymentMethods:     defaultPaymentMethods,
    emailNotifications: defaultEmailNotifications,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

function persist(state: StoredState & { pricing: PricingConfig; inventory: InventoryConfig; branchConfig: BranchConfig; emailNotifications: EmailNotificationConfig }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const initial = loadState();
  return {
    business:           initial.business,
    tax:                initial.tax,
    receipt:            initial.receipt,
    pricing:            initial.pricing,
    inventory:          initial.inventory,
    branchConfig:       initial.branchConfig,
    paymentMethods:     initial.paymentMethods,
    emailNotifications: initial.emailNotifications,

    get stockEnabled() {
      const mode = resolveOperatingMode(get().inventory.inventoryMode);
      return mode === 'FULL_POS' || mode === 'INVENTORY_ONLY';
    },

    get operatingMode() {
      return resolveOperatingMode(get().inventory.inventoryMode);
    },

    get posEnabled() {
      const mode = resolveOperatingMode(get().inventory.inventoryMode);
      return mode === 'FULL_POS' || mode === 'POS_ONLY';
    },

    get inventoryEnabled() {
      const mode = resolveOperatingMode(get().inventory.inventoryMode);
      return mode === 'FULL_POS' || mode === 'INVENTORY_ONLY';
    },

    get supportsNegotiablePricing() {
      return NEGOTIABLE_BUSINESS_CATEGORIES.includes(get().business.businessCategory);
    },

    get isSingleBranch() {
      return get().branchConfig.branchMode === 'SINGLE';
    },

    updateBranchConfig: (data) => {
      set((state) => {
        const next = { ...state, branchConfig: { ...state.branchConfig, ...data } };
        persist(next);
        return { branchConfig: next.branchConfig };
      });
    },

    updateBusiness: (data) => {
      set((state) => {
        const next = { ...state, business: { ...state.business, ...data } };
        persist(next);
        return { business: next.business };
      });
    },

    updateTax: (data) => {
      set((state) => {
        const next = { ...state, tax: { ...state.tax, ...data } };
        persist(next);
        return { tax: next.tax };
      });
    },

    updateReceipt: (data) => {
      set((state) => {
        const next = { ...state, receipt: { ...state.receipt, ...data } };
        persist(next);
        return { receipt: next.receipt };
      });
    },

    updatePricing: (data) => {
      set((state) => {
        const next = { ...state, pricing: { ...state.pricing, ...data } };
        persist(next);
        return { pricing: next.pricing };
      });
    },

    updateInventory: (data) => {
      set((state) => {
        const next = { ...state, inventory: { ...state.inventory, ...data } };
        persist(next);
        return { inventory: next.inventory };
      });
    },

    togglePaymentMethod: (id) => {
      set((state) => {
        const next = {
          ...state,
          paymentMethods: state.paymentMethods.map((pm) =>
            pm.id === id ? { ...pm, enabled: !pm.enabled } : pm
          ),
        };
        persist(next);
        return { paymentMethods: next.paymentMethods };
      });
    },

    updateEmailNotifications: (data) => {
      set((state) => {
        const next = { ...state, emailNotifications: { ...state.emailNotifications, ...data } };
        persist(next);
        return { emailNotifications: next.emailNotifications };
      });
    },

    syncFromBackend: async () => {
      // Fetch the authenticated user's Business from the backend and merge
      // it into the settings store so System Settings always shows the
      // customer's real data rather than localStorage defaults.
      //
      // This is intentionally fire-and-forget from the caller's perspective:
      // if the network request fails (offline) the store keeps whatever it
      // had from localStorage.  On next successful request it will sync again.
      try {
        // GET /api/v1/businesses/ — returns the user's own business (scoped by auth)
        type BizResponse = {
          results?: BusinessRecord[];
          id?: string;
          name?: string;
          business_category?: string;
          address?: string;
          phone?: string;
          email?: string;
          currency?: string;
          currency_symbol?: string;
          tin?: string;
          logo?: string;
        };
        type BusinessRecord = {
          id: string;
          name: string;
          business_category?: string;
          address?: string;
          phone?: string;
          email?: string;
          currency?: string;
          currency_symbol?: string;
          tin?: string;
          logo?: string;
        };

        const bizRes = await api.get<BizResponse>('/businesses/');
        const list: BusinessRecord[] = Array.isArray(bizRes.data)
          ? (bizRes.data as unknown as BusinessRecord[])
          : (bizRes.data as { results?: BusinessRecord[] }).results ?? [];
        const biz = list[0];

        if (biz) {
          const update: Partial<BusinessConfig> = {};
          if (biz.name)              update.name             = biz.name;
          if (biz.business_category) update.businessCategory = biz.business_category as BusinessCategory;
          if (biz.address != null)   update.address          = biz.address;
          if (biz.phone != null)     update.phone            = biz.phone;
          if (biz.email != null)     update.email            = biz.email;
          if (biz.currency)          update.currency         = biz.currency;
          if (biz.currency_symbol)   update.currencySymbol   = biz.currency_symbol;
          if (biz.tin != null)       update.tin              = biz.tin;
          // logo is a URL string when the backend has it; empty string clears the logo
          if (biz.logo != null)      update.logoUrl          = biz.logo ?? '';

          set((state) => {
            const next = { ...state, business: { ...state.business, ...update } };
            persist(next);
            return { business: next.business };
          });
        }

        // Also fetch business settings (inventory mode, pricing config)
        const settingsRes = await api.get<{
          inventory_mode?: string;
          allow_cashier_price_negotiation?: boolean;
          branch_mode?: string;
          tax_config?: {
            enabled?: boolean;
            name?: string;
            rate?: number;
            inclusive?: boolean;
          };
        }>('/businesses/settings/my-settings/');

        const sData = settingsRes.data;
        if (sData) {
          if (sData.inventory_mode) {
            set((state) => {
              const next = { ...state, inventory: { ...state.inventory, inventoryMode: sData.inventory_mode as InventoryMode } };
              persist(next);
              return { inventory: next.inventory };
            });
          }
          if (typeof sData.allow_cashier_price_negotiation === 'boolean') {
            set((state) => {
              const next = { ...state, pricing: { ...state.pricing, allowCashierPriceNegotiation: sData.allow_cashier_price_negotiation as boolean } };
              persist(next);
              return { pricing: next.pricing };
            });
          }
          if (sData.branch_mode) {
            const bm = (sData.branch_mode as string).toUpperCase();
            if (bm === 'SINGLE' || bm === 'MULTI') {
              set((state) => {
                const next = { ...state, branchConfig: { branchMode: bm as BranchMode } };
                persist(next);
                return { branchConfig: next.branchConfig };
              });
            }
          }
          if (sData.tax_config) {
            const tc = sData.tax_config;
            const taxUpdate: Partial<TaxConfig> = {};
            if (typeof tc.enabled  === 'boolean') taxUpdate.enabled  = tc.enabled;
            if (tc.name)                           taxUpdate.name     = tc.name;
            if (typeof tc.rate     === 'number')   taxUpdate.rate     = tc.rate;
            if (typeof tc.inclusive === 'boolean') taxUpdate.inclusive = tc.inclusive;
            set((state) => {
              const next = { ...state, tax: { ...state.tax, ...taxUpdate } };
              persist(next);
              return { tax: next.tax };
            });
          }
        }
      } catch {
        // Offline or unauthenticated — keep existing store values.
        // Will sync on next successful authenticated request.
      }
    },
  };
});
