export const APP_NAME: string = 'POPMYC Retail POS';
export const APP_VERSION: string = '1.1.7';
export const DEFAULT_CURRENCY: string = 'GHS';
export const DEFAULT_CURRENCY_SYMBOL: string = 'GH₵';
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string) || '/api/v1';

/**
 * True when running as a PWA (web deployment) rather than the Electron desktop app.
 * Used to hide Electron-only features (update notifications, service management, etc.)
 */
export const IS_PWA: boolean =
  !!(import.meta.env.VITE_IS_PWA as string) ||
  // Also detect by checking if we're NOT in Electron
  (typeof window !== 'undefined' && !('popmycDesktop' in window) && !window.location.href.startsWith('http://127.0.0.1'));

/**
 * Cloud backend URL.
 */
export const CLOUD_LICENSE_URL: string =
  (import.meta.env.VITE_CLOUD_LICENSE_URL as string) ||
  'https://popmyc-pos.onrender.com';

export const ROLES = [
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'INVENTORY_CLERK', label: 'Inventory Clerk' },
] as const;

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash', icon: 'Banknote' },
  { value: 'MOBILE_MONEY', label: 'Mobile Money', icon: 'Smartphone' },
  { value: 'CARD', label: 'Card', icon: 'CreditCard' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer', icon: 'Building2' },
  { value: 'CHEQUE', label: 'Cheque', icon: 'CheckSquare' },
] as const;

export const MOBILE_MONEY_PROVIDERS = [
  { value: 'MTN_MOMO', label: 'MTN Mobile Money' },
  { value: 'VODAFONE_CASH', label: 'Vodafone Cash' },
  { value: 'AIRTELTIGO_MONEY', label: 'AirtelTigo Money' },
] as const;

export const productCategories = [
  { value: 'all', label: 'All Categories' },
  { value: 'beverages', label: 'Beverages' },
  { value: 'food', label: 'Food & Snacks' },
  { value: 'household', label: 'Household' },
  { value: 'toiletries', label: 'Toiletries' },
  { value: 'dairy', label: 'Dairy & Eggs' },
] as const;
