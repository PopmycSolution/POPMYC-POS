/**
 * Role-Based Access Control configuration.
 *
 * Routes and capability flags are derived DYNAMICALLY from the saved feature
 * matrix in localStorage (key: 'popmyc-role-matrix').  This means any change
 * made on the Roles & Permissions page takes effect immediately — the sidebar,
 * route guard, and dashboard all reflect the live saved state.
 *
 * The static ROLE_CONFIG serves as the authoritative FALLBACK when nothing is
 * saved yet.
 */

export type AppRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'INVENTORY_CLERK';

// Every route in the app
export type AppRoute =
  | '/dashboard'
  | '/pos'
  | '/products'
  | '/categories'
  | '/brands'
  | '/units'
  | '/inventory'
  | '/inventory/adjustments'
  | '/inventory/transfers'
  | '/sales'
  | '/purchases'
  | '/customers'
  | '/suppliers'
  | '/expenses'
  | '/users'
  | '/roles'
  | '/branches'
  | '/reports'
  | '/settings'
  | '/audit'
  | '/system'
  | '/backup'
  | '/docs'
  | '/debt';

export interface RoleConfig {
  label: string;
  color: string;
  accent: string;
  routes: AppRoute[];
  canManageUsers: boolean;
  canManageRoles: boolean;
  canManageBranches: boolean;
  canViewReports: boolean;
  canAccessSettings: boolean;
  canAccessSystem: boolean;
  canViewAuditLogs: boolean;
  canBackupRestore: boolean;
  canManageSuperAdmins: boolean;
  canAccessPayments: boolean;
  canDeleteProducts: boolean;
  canAdjustStock: boolean;
  canTransferStock: boolean;
  canManageExpenses: boolean;
}

// ── Feature-ID → Route mapping ───────────────────────────────────────────────
// If a role has ANY of these feature IDs enabled, the corresponding route is
// added to their allowed list.
const FEATURE_ROUTE_MAP: Record<string, AppRoute[]> = {
  // Dashboard
  view_dashboard:         ['/dashboard'],
  view_analytics:         ['/dashboard'],
  // POS
  use_pos:                ['/pos'],
  create_sales:           ['/pos', '/sales'],
  apply_discounts:        ['/pos'],
  process_payments:       ['/pos'],
  print_receipts:         ['/pos', '/sales'],
  hold_sales:             ['/pos'],
  void_sales:             ['/pos', '/sales'],
  // Products & Catalog
  view_products:          ['/products'],
  add_products:           ['/products'],
  edit_products:          ['/products'],
  delete_products:        ['/products'],
  manage_categories:      ['/products', '/categories'],
  manage_brands:          ['/products', '/brands'],
  import_products:        ['/products'],
  manage_product_images:  ['/products'],
  // Inventory
  view_inventory:          ['/inventory'],
  stock_in:                ['/inventory'],
  stock_out:               ['/inventory'],
  stock_adjustments:       ['/inventory', '/inventory/adjustments'],
  approve_adjustments:     ['/inventory', '/inventory/adjustments'],
  manage_transfers:        ['/inventory', '/inventory/transfers'],
  approve_transfers:       ['/inventory', '/inventory/transfers'],
  resolve_discrepancies:   ['/inventory', '/inventory/transfers'],
  view_stock_alerts:       ['/inventory'],
  // Settings
  view_settings:           ['/settings'],
  edit_business_settings:  ['/settings'],
  edit_tax_settings:       ['/settings'],
  edit_receipt_settings:   ['/settings'],
  edit_inventory_settings: ['/settings'],
  edit_pricing_settings:   ['/settings'],
  // Sales
  view_sales:             ['/sales'],
  view_own_sales:         ['/sales'],
  refund_sales:           ['/sales'],
  // Customers
  view_customers:         ['/customers'],
  add_customers:          ['/customers'],
  edit_customers:         ['/customers'],
  delete_customers:       ['/customers'],
  // Suppliers
  view_suppliers:         ['/suppliers'],
  manage_suppliers:       ['/suppliers'],
  // Expenses
  view_expenses:          ['/expenses'],
  manage_expenses:        ['/expenses'],
  approve_expenses:       ['/expenses'],
  // Purchases
  view_purchases:         ['/purchases'],
  create_purchases:       ['/purchases'],
  receive_stock:          ['/purchases'],
  // Reports
  view_sales_reports:     ['/reports'],
  view_stock_reports:     ['/reports'],
  view_staff_reports:     ['/reports'],
  view_financial_reports: ['/reports'],
  // Users
  view_users:             ['/users'],
  manage_users:           ['/users'],
  manage_super_admins:    ['/users'],
  manage_roles:           ['/roles'],
  manage_branches:        ['/branches'],
  // Settings — handled above in the Inventory block
  // System
  view_audit_logs:        ['/audit'],
  system_settings:        ['/system'],
  backup_restore:         ['/backup'],
  // Debt
  view_debts:             ['/debt'],
  create_debt_sales:      ['/debt', '/pos'],
  record_debt_payments:   ['/debt'],
  write_off_debts:        ['/debt'],
};

// Routes that are always accessible regardless of features (navigation essentials)
const ALWAYS_ALLOWED: AppRoute[] = ['/dashboard', '/docs'];
// Super Admin always has every route
const ALL_ROUTES: AppRoute[] = [
  '/dashboard', '/pos', '/products', '/categories', '/brands', '/units', '/inventory',
  '/inventory/adjustments', '/inventory/transfers',
  '/sales', '/purchases', '/customers', '/suppliers', '/expenses',
  '/users', '/roles', '/branches', '/reports', '/settings', '/audit', '/system', '/backup', '/docs', '/debt',
];

// ── Static fallback route sets (used when no saved matrix exists) ────────────
const SUPER_ADMIN_ROUTES: AppRoute[] = ALL_ROUTES;
const ADMIN_ROUTES: AppRoute[] = [
  '/dashboard', '/pos', '/products', '/categories', '/brands', '/units', '/inventory',
  '/inventory/adjustments', '/inventory/transfers',
  '/sales', '/purchases', '/customers', '/suppliers', '/expenses',
  '/users', '/branches', '/reports', '/settings', '/audit', '/docs', '/debt',
];
const MANAGER_ROUTES: AppRoute[] = [
  '/dashboard', '/pos', '/products', '/categories', '/units', '/inventory',
  '/inventory/adjustments', '/inventory/transfers',
  '/sales', '/purchases', '/customers', '/suppliers', '/expenses', '/reports', '/docs', '/debt',
  '/branches',
];
const CASHIER_ROUTES: AppRoute[] = ['/dashboard', '/pos', '/sales', '/customers', '/docs'];
const INVENTORY_ROUTES: AppRoute[] = [
  '/dashboard', '/products', '/categories', '/brands', '/units', '/inventory',
  '/inventory/adjustments', '/inventory/transfers',
  '/purchases', '/suppliers', '/docs',
];

// ── Static capability config (styling + fallback flags) ──────────────────────
const ROLE_META: Record<AppRole, Pick<RoleConfig, 'label' | 'color' | 'accent'>> = {
  SUPER_ADMIN:     { label: 'Super Admin',     color: 'bg-rose-100 border border-rose-200',     accent: 'text-rose-700'    },
  ADMIN:           { label: 'Admin',           color: 'bg-purple-100 border border-purple-200', accent: 'text-purple-700'  },
  MANAGER:         { label: 'Manager',         color: 'bg-blue-100 border border-blue-200',     accent: 'text-blue-700'    },
  CASHIER:         { label: 'Cashier',         color: 'bg-emerald-50 border border-emerald-200',accent: 'text-emerald-700' },
  INVENTORY_CLERK: { label: 'Inventory Clerk', color: 'bg-amber-100 border border-amber-200',   accent: 'text-amber-700'   },
};

export const ROLE_CONFIG: Record<AppRole, RoleConfig> = {
  SUPER_ADMIN: {
    ...ROLE_META.SUPER_ADMIN, routes: SUPER_ADMIN_ROUTES,
    canManageUsers: true, canManageRoles: true, canManageBranches: true, canViewReports: true,
    canAccessSettings: true, canAccessSystem: true, canViewAuditLogs: true,
    canBackupRestore: true, canManageSuperAdmins: true, canAccessPayments: true,
    canDeleteProducts: true, canAdjustStock: true, canTransferStock: true, canManageExpenses: true,
  },
  ADMIN: {
    ...ROLE_META.ADMIN, routes: ADMIN_ROUTES,
    canManageUsers: true, canManageRoles: false, canManageBranches: true, canViewReports: true,
    canAccessSettings: true, canAccessSystem: false, canViewAuditLogs: true,
    canBackupRestore: false, canManageSuperAdmins: false, canAccessPayments: true,
    canDeleteProducts: true, canAdjustStock: true, canTransferStock: true, canManageExpenses: true,
  },
  MANAGER: {
    ...ROLE_META.MANAGER, routes: MANAGER_ROUTES,
    canManageUsers: false, canManageRoles: false, canManageBranches: false, canViewReports: true,
    canAccessSettings: false, canAccessSystem: false, canViewAuditLogs: false,
    canBackupRestore: false, canManageSuperAdmins: false, canAccessPayments: false,
    canDeleteProducts: false, canAdjustStock: true, canTransferStock: true, canManageExpenses: true,
  },
  CASHIER: {
    ...ROLE_META.CASHIER, routes: CASHIER_ROUTES,
    canManageUsers: false, canManageRoles: false, canManageBranches: false, canViewReports: false,
    canAccessSettings: false, canAccessSystem: false, canViewAuditLogs: false,
    canBackupRestore: false, canManageSuperAdmins: false, canAccessPayments: true,
    canDeleteProducts: false, canAdjustStock: false, canTransferStock: false, canManageExpenses: false,
  },
  INVENTORY_CLERK: {
    ...ROLE_META.INVENTORY_CLERK, routes: INVENTORY_ROUTES,
    canManageUsers: false, canManageRoles: false, canManageBranches: false, canViewReports: false,
    canAccessSettings: false, canAccessSystem: false, canViewAuditLogs: false,
    canBackupRestore: false, canManageSuperAdmins: false, canAccessPayments: false,
    canDeleteProducts: false, canAdjustStock: true, canTransferStock: true, canManageExpenses: false,
  },
};

// ── Live matrix reader ────────────────────────────────────────────────────────
const MATRIX_KEY = 'popmyc-role-matrix';

type SavedMatrix = Record<AppRole, Record<string, boolean>>;

function readSavedMatrix(): SavedMatrix | null {
  try {
    const raw = localStorage.getItem(MATRIX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedMatrix & { __version?: number };
    if (parsed && typeof parsed === 'object' && 'SUPER_ADMIN' in parsed) {
      // Strip the version key before returning so it doesn't pollute role lookups
      const { __version: _, ...roles } = parsed as { __version?: number } & SavedMatrix;
      return roles as SavedMatrix;
    }
  } catch { /* noop */ }
  return null;
}

/** Build a live RoleConfig from the saved feature matrix for one role */
function buildConfigFromMatrix(role: AppRole, featureMap: Record<string, boolean>): RoleConfig {
  // Super Admin always gets everything regardless of matrix
  if (role === 'SUPER_ADMIN') return ROLE_CONFIG.SUPER_ADMIN;

  // Derive routes from enabled features
  const routeSet = new Set<AppRoute>(ALWAYS_ALLOWED);
  for (const [featureId, allowed] of Object.entries(featureMap)) {
    if (allowed) {
      const routes = FEATURE_ROUTE_MAP[featureId];
      if (routes) routes.forEach((r) => routeSet.add(r));
    }
  }

  // Structural routes always available regardless of saved matrix version
  // (these were added after the initial matrix may have been saved)
  routeSet.add('/branches');

  // If stock_adjustments is enabled, also grant the dedicated page route
  if (featureMap['stock_adjustments']) {
    routeSet.add('/inventory/adjustments');
  }
  // If manage_transfers is enabled, also grant the transfers page route
  if (featureMap['manage_transfers']) {
    routeSet.add('/inventory/transfers');
  }

  const has = (id: string) => !!featureMap[id];

  return {
    ...ROLE_META[role],
    routes: Array.from(routeSet),
    canManageUsers:        has('manage_users') || has('view_users'),
    canManageRoles:        has('manage_roles'),
    canManageBranches:     has('manage_branches'),
    canViewReports:        has('view_sales_reports') || has('view_stock_reports') ||
                           has('view_staff_reports') || has('view_financial_reports'),
    canAccessSettings:     has('view_settings') || has('edit_business_settings'),
    canAccessSystem:       has('system_settings'),
    canViewAuditLogs:      has('view_audit_logs'),
    canBackupRestore:      has('backup_restore'),
    canManageSuperAdmins:  has('manage_super_admins'),
    canAccessPayments:     has('process_payments'),
    canDeleteProducts:     has('delete_products'),
    canAdjustStock:        has('stock_adjustments'),
    canTransferStock:      has('manage_transfers'),
    canManageExpenses:     has('manage_expenses'),
  };
}

/** Returns the live RoleConfig for a role — reads saved matrix every call */
export function getRoleConfig(role: string | undefined): RoleConfig {
  if (!role) return ROLE_CONFIG.CASHIER;
  const appRole = role as AppRole;
  if (!(appRole in ROLE_CONFIG)) return ROLE_CONFIG.CASHIER;

  const saved = readSavedMatrix();
  if (!saved || !saved[appRole]) return ROLE_CONFIG[appRole];

  return buildConfigFromMatrix(appRole, saved[appRole] as Record<string, boolean>);
}

/** Returns true if the role can access the given route — reads saved matrix every call */
export function canAccess(role: string | undefined, route: AppRoute): boolean {
  if (!role) return false;
  // SUPER_ADMIN always has access — check case-insensitively to be safe
  if (role.toUpperCase() === 'SUPER_ADMIN') return true;
  const cfg = getRoleConfig(role);
  return cfg.routes.includes(route);
}

/** Type-guard: is the string a valid AppRole? */
export function isValidRole(role: string | undefined): role is AppRole {
  if (!role) return false;
  return role in ROLE_CONFIG;
}
