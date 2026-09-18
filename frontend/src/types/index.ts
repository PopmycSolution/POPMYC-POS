import type { AppRole } from '@/utils/permissions';

// ─── Branch ───────────────────────────────────────────────────────────────────
export interface Branch {
  id: string;
  business: string;          // Business UUID
  name: string;
  code: string;
  address: string;
  phone: string;
  isHeadOffice: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  role: AppRole;
  /** UUID of the branch this user belongs to (null = not assigned) */
  branch?: string | null;
  /** When true the user must set a new password before continuing */
  mustChangePassword?: boolean;
  /** Absolute URL to the user's profile picture, or null/undefined if not set */
  avatarUrl?: string | null;
}

export type BusinessCategory =
  | 'PROVISION_GROCERY' | 'SUPERMARKET' | 'GENERAL_RETAIL' | 'COSMETICS'
  | 'PHARMACY' | 'ELECTRONICS' | 'PHONE_ACCESSORIES' | 'FASHION_CLOTHING'
  | 'SHOES' | 'SERVICE' | 'OTHER';

/** Business types that allow products to be marked NEGOTIABLE */
export const NEGOTIABLE_BUSINESS_CATEGORIES: BusinessCategory[] = [
  'PHONE_ACCESSORIES', 'FASHION_CLOTHING', 'SHOES',
];

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  PROVISION_GROCERY: 'Provision / Grocery',
  SUPERMARKET:       'Supermarket',
  GENERAL_RETAIL:    'General Retail',
  COSMETICS:         'Cosmetics',
  PHARMACY:          'Pharmacy',
  ELECTRONICS:       'Electronics',
  PHONE_ACCESSORIES: 'Phone & Accessories',
  FASHION_CLOTHING:  'Fashion / Clothing',
  SHOES:             'Shoes',
  SERVICE:           'Service',
  OTHER:             'Other',
};

export interface Business {
  id: string;
  name: string;
  address: string;
  phone: string;
  tin: string;
  currency: string;
  businessCategory?: BusinessCategory;
  supportsNegotiablePricing?: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Record<string, string[]>;
  timestamp: string;
  statusCode: number;
}

export type PricingType = 'FIXED' | 'NEGOTIABLE';

export interface Product {
  id: string;
  name: string;
  sku: string;
  description?: string;
  /**
   * Model / part number — used by phone shops, electronics, etc.
   * e.g. "iPhone 15 Pro Max 256GB Natural Titanium" or "Samsung Galaxy A55 5G".
   * Optional; hidden for businesses that don't need it.
   */
  modelNumber?: string;
  price: number;           // retail selling price (base — never overwritten by negotiation)
  wholesalePrice?: number; // optional wholesale / bulk price
  cost?: number;
  stockQuantity: number;
  lowStockThreshold?: number;
  categoryId?: string;
  brandId?: string;
  unitId?: string;
  barcode?: string;
  imageUrl?: string;
  isActive: boolean;
  /** FIXED: sell at stated price. NEGOTIABLE: staff may agree a different price at checkout. */
  pricingType?: PricingType;
  /**
   * ISO date string (YYYY-MM-DD) — the date this product expires.
   * Only relevant for perishable goods, pharmaceuticals, food, cosmetics, etc.
   * Null / undefined = product does not expire.
   */
  expiryDate?: string | null;
  /**
   * How many days before expiryDate to start showing the "expiring soon" warning.
   * Defaults to 30 if not set. Set to 0 to disable warnings for this product.
   */
  expiryAlertDays?: number;
  createdAt: string;
  updatedAt: string;
}

/** Computed expiry status for a product */
export type ExpiryStatus = 'expired' | 'expiring_soon' | 'ok' | 'none';

/**
 * Compute the expiry status of a product relative to today.
 * Returns 'none' when the product has no expiry date.
 */
export function getExpiryStatus(product: Product, today?: Date): ExpiryStatus {
  if (!product.expiryDate) return 'none';
  const now  = today ?? new Date();
  const exp  = new Date(product.expiryDate);
  // Normalize both to midnight local time for day-accurate comparison
  now.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  if (exp < now) return 'expired';
  const alertDays = product.expiryAlertDays ?? 30;
  const msPerDay  = 1000 * 60 * 60 * 24;
  const daysLeft  = Math.round((exp.getTime() - now.getTime()) / msPerDay);
  if (daysLeft <= alertDays) return 'expiring_soon';
  return 'ok';
}

/** Number of days until expiry (negative = already expired). undefined if no expiry date. */
export function daysUntilExpiry(product: Product, today?: Date): number | undefined {
  if (!product.expiryDate) return undefined;
  const now = today ?? new Date();
  const exp = new Date(product.expiryDate);
  now.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((exp.getTime() - now.getTime()) / msPerDay);
}

export interface Customer {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber: string;
  address?: string;
  loyaltyPoints?: number;
  createdAt: string;
}

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: number;            // base selling price (never changed)
  quantity: number;
  subtotal: number;
  imageUrl?: string;
  unitAbbrev?: string;      // e.g. "pcs", "kg" — displayed in cart and receipts
  pricingType?: PricingType;
  /** When set, this item was sold at a negotiated price (NEGOTIABLE products only). */
  negotiatedPrice?: number;
  /** Original base price snapshot — preserved for audit when negotiatedPrice is set. */
  originalPrice?: number;
}

export interface Sale {
  id: string;
  reference: string;
  customerId?: string;
  customerName?: string;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount?: number;
  totalAmount: number;
  paymentMethod: string;
  amountPaid?: number;
  changeAmount?: number;
  status: string;
  cashierId: string;
  cashierName?: string;
  notes?: string;
  createdAt: string;
}
