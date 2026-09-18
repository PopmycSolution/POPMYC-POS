import { useState, useMemo } from 'react';
import {
  Shield, ShieldCheck, ShieldAlert, UserCheck, Users,
  Check, X, Info, Lock, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { type AppRole } from '@/utils/permissions';

// ── Feature definitions ───────────────────────────────────────────────────────
interface Feature {
  id: string;
  group: string;
  label: string;
  description: string;
}

const FEATURE_GROUPS: { id: string; label: string }[] = [
  { id: 'dashboard',   label: 'Dashboard & Analytics'    },
  { id: 'pos',         label: 'Point of Sale'            },
  { id: 'products',    label: 'Products & Catalog'       },
  { id: 'inventory',   label: 'Inventory Management'     },
  { id: 'sales',       label: 'Sales & Transactions'     },
  { id: 'customers',   label: 'Customer Management'      },
  { id: 'suppliers',   label: 'Suppliers & Vendors'      },
  { id: 'expenses',    label: 'Expenses'                 },
  { id: 'purchases',   label: 'Purchases & Receiving'    },
  { id: 'reports',     label: 'Reports'                  },
  { id: 'users',       label: 'User Management'          },
  { id: 'branches',    label: 'Branch Management'        },
  { id: 'settings',    label: 'Settings'                 },
  { id: 'system',      label: 'System Administration'    },
  { id: 'debt',        label: 'Debt & Credit Management' },
];

const FEATURES: Feature[] = [
  // Dashboard
  { id: 'view_dashboard',          group: 'dashboard',  label: 'View Dashboard',                  description: 'See the main dashboard overview' },
  { id: 'view_analytics',          group: 'dashboard',  label: 'View Analytics',                  description: 'Access revenue and performance charts' },
  // POS
  { id: 'use_pos',                 group: 'pos',        label: 'Use POS Terminal',                description: 'Open and operate the POS screen' },
  { id: 'create_sales',            group: 'pos',        label: 'Create Sales',                    description: 'Process new sales transactions' },
  { id: 'apply_discounts',         group: 'pos',        label: 'Apply Discounts',                 description: 'Apply manual discounts at checkout' },
  { id: 'process_payments',        group: 'pos',        label: 'Process Payments',                description: 'Accept cash, mobile money, card payments' },
  { id: 'print_receipts',          group: 'pos',        label: 'Print / Download Receipts',       description: 'Print or export receipts' },
  { id: 'hold_sales',              group: 'pos',        label: 'Hold & Resume Sales',             description: 'Put orders on hold and retrieve them' },
  { id: 'void_sales',              group: 'pos',        label: 'Void Transactions',               description: 'Cancel completed transactions' },
  // Products
  { id: 'view_products',           group: 'products',   label: 'View Products',                   description: 'Browse the product catalog' },
  { id: 'add_products',            group: 'products',   label: 'Add Products',                    description: 'Create new products' },
  { id: 'edit_products',           group: 'products',   label: 'Edit Products',                   description: 'Modify existing product details' },
  { id: 'delete_products',         group: 'products',   label: 'Delete Products',                 description: 'Permanently remove products' },
  { id: 'manage_categories',       group: 'products',   label: 'Manage Categories',               description: 'Add, edit, delete product categories' },
  { id: 'manage_brands',           group: 'products',   label: 'Manage Brands',                   description: 'Add, edit, delete product brands' },
  { id: 'import_products',         group: 'products',   label: 'Import Products (CSV/Excel)',      description: 'Bulk import products from files' },
  { id: 'manage_product_images',   group: 'products',   label: 'Manage Product Images',           description: 'Upload and remove product photos' },
  // Inventory
  { id: 'view_inventory',          group: 'inventory',  label: 'View Inventory',                  description: 'See stock levels and movements' },
  { id: 'stock_in',                group: 'inventory',  label: 'Stock In',                        description: 'Record incoming stock' },
  { id: 'stock_out',               group: 'inventory',  label: 'Stock Out',                       description: 'Record outgoing stock' },
  { id: 'stock_adjustments',       group: 'inventory',  label: 'Stock Adjustments',               description: 'Create damage, expiry, loss, correction and found-stock adjustments' },
  { id: 'approve_adjustments',     group: 'inventory',  label: 'Approve / Post Adjustments',      description: 'Post high-risk adjustment types (Theft, Internal Use, Supplier Return)' },
  { id: 'manage_transfers',        group: 'inventory',  label: 'Branch Transfers',                description: 'Create and manage stock transfers between branches' },
  { id: 'approve_transfers',       group: 'inventory',  label: 'Approve & Dispatch Transfers',    description: 'Approve transfer requests and mark stock as dispatched' },
  { id: 'resolve_discrepancies',   group: 'inventory',  label: 'Resolve Transfer Discrepancies',  description: 'Resolve quantity mismatches on received transfers' },
  { id: 'view_stock_alerts',       group: 'inventory',  label: 'View Stock Alerts',               description: 'See low-stock and out-of-stock alerts' },
  // Sales
  { id: 'view_sales',              group: 'sales',      label: 'View All Sales',                  description: 'Browse full sales history' },
  { id: 'view_own_sales',          group: 'sales',      label: 'View Own Sales',                  description: 'See only their own transactions' },
  { id: 'refund_sales',            group: 'sales',      label: 'Process Refunds',                 description: 'Issue refunds on completed sales' },
  // Customers
  { id: 'view_customers',          group: 'customers',  label: 'View Customers',                  description: 'Browse the customer list' },
  { id: 'add_customers',           group: 'customers',  label: 'Add Customers',                   description: 'Create new customer records' },
  { id: 'edit_customers',          group: 'customers',  label: 'Edit Customers',                  description: 'Modify customer information' },
  { id: 'delete_customers',        group: 'customers',  label: 'Delete Customers',                description: 'Remove customer records' },
  // Suppliers
  { id: 'view_suppliers',          group: 'suppliers',  label: 'View Suppliers',                  description: 'Browse supplier list' },
  { id: 'manage_suppliers',        group: 'suppliers',  label: 'Manage Suppliers',                description: 'Add, edit, delete suppliers' },
  // Expenses
  { id: 'view_expenses',           group: 'expenses',   label: 'View Expenses',                   description: 'See expense records' },
  { id: 'manage_expenses',         group: 'expenses',   label: 'Manage Expenses',                 description: 'Add and categorise expenses' },
  { id: 'approve_expenses',        group: 'expenses',   label: 'Approve Expenses',                description: 'Approve or reject expense submissions' },
  // Purchases
  { id: 'view_purchases',          group: 'purchases',  label: 'View Purchases',                  description: 'See purchase orders' },
  { id: 'create_purchases',        group: 'purchases',  label: 'Create Purchase Orders',          description: 'Raise new POs' },
  { id: 'receive_stock',           group: 'purchases',  label: 'Receive Stock',                   description: 'Mark POs as received and update branch stock' },
  // Reports
  { id: 'view_sales_reports',      group: 'reports',    label: 'Sales Reports',                   description: 'View revenue and transaction reports' },
  { id: 'view_stock_reports',      group: 'reports',    label: 'Stock Reports',                   description: 'View inventory reports' },
  { id: 'view_staff_reports',      group: 'reports',    label: 'Staff Performance',               description: 'View per-cashier performance reports' },
  { id: 'view_financial_reports',  group: 'reports',    label: 'Financial Reports',               description: 'Sensitive revenue and profit reports' },
  // Users
  { id: 'view_users',              group: 'users',      label: 'View Users',                      description: 'Browse user list' },
  { id: 'manage_users',            group: 'users',      label: 'Manage Users',                    description: 'Add, edit, deactivate users' },
  { id: 'manage_super_admins',     group: 'users',      label: 'Manage Super Admins',             description: 'Create or modify Super Admin accounts' },
  { id: 'manage_roles',            group: 'users',      label: 'Manage Roles & Permissions',      description: 'Edit role permission sets' },
  // Branches
  { id: 'manage_branches',         group: 'branches',   label: 'Manage Branches',                 description: 'View, add, edit, and deactivate business branches' },
  // Settings
  { id: 'view_settings',           group: 'settings',   label: 'View Settings',                   description: 'View business settings' },
  { id: 'edit_business_settings',  group: 'settings',   label: 'Edit Business Settings',          description: 'Change business name, logo, currency, etc.' },
  { id: 'edit_tax_settings',       group: 'settings',   label: 'Edit Tax Settings',               description: 'Configure VAT rates' },
  { id: 'edit_receipt_settings',   group: 'settings',   label: 'Edit Receipt Settings',           description: 'Customise receipt layout' },
  { id: 'edit_inventory_settings', group: 'settings',   label: 'Edit Inventory Mode',             description: 'Switch between Stock Enabled and Sales Only mode' },
  { id: 'edit_pricing_settings',   group: 'settings',   label: 'Edit Pricing Mode',               description: 'Configure Fixed / Bargaining / Both pricing modes' },
  // System
  { id: 'view_audit_logs',         group: 'system',     label: 'View Audit Logs',                 description: 'See who did what and when' },
  { id: 'system_settings',         group: 'system',     label: 'System Settings',                 description: 'App-level config, maintenance mode' },
  { id: 'backup_restore',          group: 'system',     label: 'Backup & Restore',                description: 'Export/import data backups' },
  // Debt & Credit
  { id: 'view_debts',              group: 'debt',       label: 'View Debts',                      description: 'See all outstanding credit/debt records' },
  { id: 'create_debt_sales',       group: 'debt',       label: 'Create Credit Sales',             description: 'Process sales on credit (customer owes)' },
  { id: 'record_debt_payments',    group: 'debt',       label: 'Record Debt Payments',            description: 'Log partial or full payments against debts' },
  { id: 'write_off_debts',         group: 'debt',       label: 'Write Off Debts',                 description: 'Mark uncollectable debts as written off' },
];

// ── Static permission matrix ──────────────────────────────────────────────────
type Access = boolean;

const DEFAULT_MATRIX: Record<AppRole, Record<string, Access>> = {
  SUPER_ADMIN: Object.fromEntries(FEATURES.map((f) => [f.id, true])),

  ADMIN: Object.fromEntries(FEATURES.map((f) => [
    f.id,
    !['manage_super_admins', 'system_settings', 'backup_restore'].includes(f.id),
  ])),

  MANAGER: Object.fromEntries(FEATURES.map((f) => [
    f.id,
    [
      'view_dashboard', 'view_analytics',
      'use_pos', 'create_sales', 'apply_discounts', 'process_payments',
      'print_receipts', 'hold_sales', 'void_sales',
      'view_products',
      'view_inventory', 'stock_adjustments', 'approve_adjustments',
      'manage_transfers', 'approve_transfers', 'resolve_discrepancies',
      'view_stock_alerts',
      'view_sales', 'refund_sales',
      'view_customers', 'add_customers', 'edit_customers',
      'view_suppliers',
      'view_expenses', 'manage_expenses', 'approve_expenses',
      'view_purchases', 'create_purchases', 'receive_stock',
      'view_sales_reports', 'view_stock_reports', 'view_staff_reports', 'view_financial_reports',
      'view_users',
      'view_settings', 'edit_inventory_settings', 'edit_pricing_settings',
      'view_debts', 'record_debt_payments', 'write_off_debts',
    ].includes(f.id),
  ])),

  CASHIER: Object.fromEntries(FEATURES.map((f) => [
    f.id,
    [
      'use_pos', 'create_sales', 'process_payments', 'print_receipts',
      'hold_sales', 'view_own_sales',
      'view_customers', 'add_customers',
      'create_debt_sales',
    ].includes(f.id),
  ])),

  INVENTORY_CLERK: Object.fromEntries(FEATURES.map((f) => [
    f.id,
    [
      'view_products', 'add_products', 'edit_products',
      'manage_categories', 'manage_brands', 'import_products', 'manage_product_images',
      'view_inventory', 'stock_in', 'stock_out',
      'stock_adjustments', 'approve_adjustments',
      'manage_transfers', 'approve_transfers',
      'view_stock_alerts',
      'view_suppliers', 'manage_suppliers',
      'view_purchases', 'create_purchases', 'receive_stock',
      'view_stock_reports',
    ].includes(f.id),
  ])),
};

const ROLE_META: Record<AppRole, { label: string; icon: typeof Shield; color: string; badgeColor: string }> = {
  SUPER_ADMIN:     { label: 'Super Admin',     icon: ShieldAlert, color: 'text-rose-600',    badgeColor: 'bg-rose-100 text-rose-700 border-rose-200'        },
  ADMIN:           { label: 'Admin',           icon: ShieldCheck, color: 'text-purple-600',  badgeColor: 'bg-purple-100 text-purple-700 border-purple-200'  },
  MANAGER:         { label: 'Manager',         icon: Shield,      color: 'text-blue-600',    badgeColor: 'bg-blue-100 text-blue-700 border-blue-200'        },
  CASHIER:         { label: 'Cashier',         icon: UserCheck,   color: 'text-emerald-600', badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'},
  INVENTORY_CLERK: { label: 'Inventory Clerk', icon: Users,       color: 'text-amber-600',   badgeColor: 'bg-amber-100 text-amber-700 border-amber-200'    },
};

const ROLES: AppRole[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'INVENTORY_CLERK'];

const STORAGE_KEY    = 'popmyc-role-matrix';
// Bump whenever new features are added — forces stale saved matrices to re-merge with new defaults
const MATRIX_VERSION = 3;

function loadMatrix(): Record<AppRole, Record<string, Access>> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown> & { __version?: number };
      if (typeof parsed === 'object' && 'SUPER_ADMIN' in parsed) {
        // Merge stored custom overrides ON TOP of new defaults so custom changes survive upgrades
        const merged: Record<AppRole, Record<string, Access>> = {} as Record<AppRole, Record<string, Access>>;
        for (const role of ROLES) {
          const saved = { ...((parsed[role] as Record<string, Access>) ?? {}) };
          merged[role] = { ...DEFAULT_MATRIX[role], ...saved };
        }
        const version = (parsed as { __version?: number }).__version ?? 0;
        if (version < MATRIX_VERSION) {
          // Re-save with bumped version so next load is clean
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...merged, __version: MATRIX_VERSION }));
        }
        return merged;
      }
    }
  } catch { /* noop */ }
  return DEFAULT_MATRIX;
}

// ── Page component ────────────────────────────────────────────────────────────
export default function RolesPage() {
  const [matrix,      setMatrix]      = useState<Record<AppRole, Record<string, Access>>>(loadMatrix);
  const [saved,       setSaved]       = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const visibleFeatures = useMemo(
    () => activeGroup ? FEATURES.filter((f) => f.group === activeGroup) : FEATURES,
    [activeGroup],
  );

  function toggle(role: AppRole, featureId: string) {
    if (role === 'SUPER_ADMIN') return;
    setMatrix((prev) => ({
      ...prev,
      [role]: { ...prev[role], [featureId]: !prev[role][featureId] },
    }));
  }

  function toggleGroup(role: AppRole, groupId: string, value: boolean) {
    if (role === 'SUPER_ADMIN') return;
    const ids = FEATURES.filter((f) => f.group === groupId).map((f) => f.id);
    setMatrix((prev) => ({
      ...prev,
      [role]: { ...prev[role], ...Object.fromEntries(ids.map((id) => [id, value])) },
    }));
  }

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...matrix, __version: MATRIX_VERSION }));
    // Broadcast to MainLayout's route guard and other tabs
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleReset() {
    setMatrix(DEFAULT_MATRIX);
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    setSaved(false);
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Roles & Permissions</h1>
          <p className="text-sm text-muted-500 mt-0.5">
            Configure what each role can access. Changes take effect immediately.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 px-3 py-1.5 text-xs font-semibold border border-emerald-200">
              <Check className="h-3.5 w-3.5" /> Saved & applied
            </span>
          )}
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors"
          >
            Reset Defaults
          </button>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm"
          >
            <Lock className="h-4 w-4" /> Save Permissions
          </button>
        </div>
      </div>

      {/* ── Role summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {ROLES.map((role) => {
          const meta    = ROLE_META[role];
          const Icon    = meta.icon;
          const allowed = FEATURES.filter((f) => !!matrix[role][f.id]).length;
          const pct     = Math.round((allowed / FEATURES.length) * 100);
          return (
            <div key={role} className="bg-white rounded-2xl border border-muted-100 p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={clsx('h-4 w-4 shrink-0', meta.color)} />
                <span className={clsx('text-[11px] font-bold rounded-full px-2 py-0.5 border', meta.badgeColor)}>
                  {meta.label}
                </span>
              </div>
              <p className="text-2xl font-bold text-[#1E293B]">{allowed}</p>
              <p className="text-[11px] text-muted-400">of {FEATURES.length} permissions</p>
              <div className="mt-2 h-1.5 rounded-full bg-muted-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#1E293B] transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* ── Group filter sidebar ── */}
        <div className="lg:w-56 shrink-0">
          <div className="bg-white rounded-2xl border border-muted-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-muted-100 bg-muted-50/50">
              <p className="text-xs font-bold text-muted-500 uppercase tracking-wider">Feature Groups</p>
            </div>
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => setActiveGroup(null)}
                className={clsx(
                  'w-full text-left rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  activeGroup === null ? 'bg-[#1E293B] text-white' : 'text-muted-600 hover:bg-muted-50',
                )}
              >
                All Features
                <span className="ml-1.5 text-[11px] opacity-50">({FEATURES.length})</span>
              </button>
              {FEATURE_GROUPS.map((g) => {
                const count = FEATURES.filter((f) => f.group === g.id).length;
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGroup(g.id)}
                    className={clsx(
                      'w-full text-left rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      activeGroup === g.id ? 'bg-[#1E293B] text-white' : 'text-muted-600 hover:bg-muted-50',
                    )}
                  >
                    {g.label}
                    <span className="ml-1.5 text-[11px] opacity-50">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Permission matrix table ── */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-muted-100 overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              {/* Sticky role header */}
              <thead className="sticky top-0 z-10 bg-white border-b border-muted-100">
                <tr>
                  <th className="text-left px-5 py-3 font-semibold text-muted-600 w-64">Permission</th>
                  {ROLES.map((role) => {
                    const meta = ROLE_META[role];
                    const Icon = meta.icon;
                    return (
                      <th key={role} className="text-center px-3 py-3 w-28">
                        <div className="flex flex-col items-center gap-1">
                          <Icon className={clsx('h-4 w-4', meta.color)} />
                          <span className="text-[11px] font-bold text-muted-700 whitespace-nowrap">{meta.label}</span>
                          {role === 'SUPER_ADMIN' && (
                            <span className="text-[9px] text-rose-400 font-medium">Full access</span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {FEATURE_GROUPS
                  .filter((g) => !activeGroup || g.id === activeGroup)
                  .map((group) => {
                    const groupFeatures = visibleFeatures.filter((f) => f.group === group.id);
                    if (groupFeatures.length === 0) return null;
                    return (
                      <>
                        {/* Group header row with bulk-toggle buttons */}
                        <tr key={`group-${group.id}`} className="bg-muted-50/70 border-y border-muted-100">
                          <td className="px-5 py-2">
                            <span className="text-[11px] font-bold text-muted-500 uppercase tracking-wider">
                              {group.label}
                            </span>
                          </td>
                          {ROLES.map((role) => {
                            if (role === 'SUPER_ADMIN') {
                              return <td key={role} className="text-center px-3 py-2" />;
                            }
                            const allOn  = groupFeatures.every((f) => !!matrix[role][f.id]);
                            const allOff = groupFeatures.every((f) => !matrix[role][f.id]);
                            return (
                              <td key={role} className="text-center px-3 py-2">
                                <button
                                  title={allOn
                                    ? `Remove all ${group.label} from ${ROLE_META[role].label}`
                                    : `Grant all ${group.label} to ${ROLE_META[role].label}`}
                                  onClick={() => toggleGroup(role, group.id, !allOn)}
                                  className={clsx(
                                    'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold transition-colors',
                                    allOn
                                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                      : allOff
                                      ? 'bg-muted-100 text-muted-400 hover:bg-muted-200'
                                      : 'bg-amber-50 text-amber-600 hover:bg-amber-100',
                                  )}
                                >
                                  {allOn ? 'All' : allOff ? 'None' : 'Mix'}
                                  <ChevronDown className="h-2.5 w-2.5" />
                                </button>
                              </td>
                            );
                          })}
                        </tr>

                        {/* Feature rows */}
                        {groupFeatures.map((feature) => (
                          <tr
                            key={feature.id}
                            className="border-b border-muted-50 hover:bg-muted-50/40 transition-colors"
                          >
                            <td className="px-5 py-3">
                              <p className="text-sm font-medium text-[#1E293B]">{feature.label}</p>
                              <p className="text-[11px] text-muted-400 mt-0.5">{feature.description}</p>
                            </td>
                            {ROLES.map((role) => {
                              const allowed  = !!matrix[role][feature.id];
                              const isLocked = role === 'SUPER_ADMIN';
                              return (
                                <td key={role} className="text-center px-3 py-3">
                                  <button
                                    onClick={() => toggle(role, feature.id)}
                                    disabled={isLocked}
                                    aria-label={`${allowed ? 'Revoke' : 'Grant'} ${feature.label} for ${ROLE_META[role].label}`}
                                    className={clsx(
                                      'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-all mx-auto',
                                      isLocked ? 'cursor-default opacity-100' : 'hover:scale-110 cursor-pointer',
                                      allowed
                                        ? isLocked
                                          ? 'bg-rose-100 text-rose-600'
                                          : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                        : 'bg-muted-100 text-muted-300 hover:bg-muted-200',
                                    )}
                                  >
                                    {allowed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="px-5 py-3 border-t border-muted-100 bg-muted-50/50 flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-500">
              Super Admin always has full access and cannot be restricted.
              Changes take effect <strong>immediately</strong> — no re-login required.
              Use the <strong>All / None / Mix</strong> group buttons to bulk-edit a role's access to an entire section.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
