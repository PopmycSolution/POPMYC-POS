import { useState } from 'react';
import {
  Book,
  Phone,
  Mail,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  ShoppingCart,
  Package,
  Warehouse,
  Users,
  BarChart3,
  Settings,
  Shield,
  HardDrive,
  Tag,
  Truck,
  FileText,
  Receipt,
  Factory,
  ExternalLink,
  Info,
  Star,
  Zap,
  Globe,
} from 'lucide-react';
import { clsx } from 'clsx';
import { APP_NAME } from '@/utils/constants';

// ─── Owner / Support contact ────────────────────────────────────────────────
const SUPPORT = {
  company:  'POPMYC Solutions',
  phones:   ['0256251295', '0598610304'],
  email:    'popmychubsolution@gmail.com',
  website:  'https://popmyc.com',
  location: 'Accra, Ghana',
};

// ─── FAQ entries ────────────────────────────────────────────────────────────
interface FAQItem { q: string; a: string }
const FAQ_ITEMS: FAQItem[] = [
  {
    q: 'How do I sign in without an internet connection?',
    a: 'Use the "Quick Access" section on the login page. Select your role from the dropdown and click "Sign in as [Role]". This uses locally stored credentials saved in your browser — no server connection is needed.',
  },
  {
    q: 'How do I process a sale?',
    a: 'Go to the POS page from the sidebar or Dashboard. Search or browse products, click "Add to Cart", select a customer (or leave as Walk-in Customer), choose a payment method, then click "Confirm Payment". A receipt is automatically generated.',
  },
  {
    q: 'Can I add product images?',
    a: 'Yes. When adding or editing a product, use the image picker at the top of the form. You can either upload a file from your computer (stored as base64 in the browser) or paste an image URL.',
  },
  {
    q: 'How do I import products in bulk?',
    a: 'On the Products page, click "Import" in the top right. Upload a CSV, Excel (XLSX/XLS), TSV, or JSON file. Required columns are: name, sku, price, stockQuantity. Download the sample CSV template for reference.',
  },
  {
    q: 'How do I set up email reports?',
    a: 'Go to Settings → Email & Reports. Enter the owner\'s email address and configure SMTP credentials. You can enable daily reports, weekly summaries, and low-stock alerts. For Gmail, use an App Password (not your regular password).',
  },
  {
    q: 'Why does my dashboard show a different user name?',
    a: 'The dashboard reads from the currently signed-in session. If you used Quick Access, the name shown comes from the user record that matches your selected role. To see your real name, sign in with your actual email and password via the main login form.',
  },
  {
    q: 'How do I create a backup?',
    a: 'Go to Backup & Restore in the sidebar (Super Admin only). Click "Download Backup" to export all your data as a JSON file. Store this file safely. To restore, use the "Restore from Backup" section on the same page.',
  },
  {
    q: 'How do I manage roles and permissions?',
    a: 'Go to Roles & Permissions in the sidebar (Super Admin only). The matrix shows each feature and which roles have access. Click the green/red toggle for each role-feature combination to grant or revoke access, then click "Save Permissions".',
  },
  {
    q: 'How do I add a new user?',
    a: 'Go to Users in the sidebar. Click "Add User", fill in their details (name, email, phone, role, branch), then click "Register User". The user can then sign in with their credentials.',
  },
  {
    q: 'What payment methods are supported?',
    a: 'Cash, MTN Mobile Money, Telecel Cash, AirtelTigo Money, Card Payment, Bank Transfer, Cheque, and Customer Credit. You can enable or disable each one in Settings → Payment Methods.',
  },
];

// ─── Module guide entries ───────────────────────────────────────────────────
interface Module {
  icon: typeof ShoppingCart;
  name: string;
  path: string;
  description: string;
  features: string[];
  roles: string[];
}

const MODULES: Module[] = [
  {
    icon: ShoppingCart,
    name: 'Point of Sale (POS)',
    path: '/pos',
    description: 'The main sales terminal for processing customer transactions.',
    features: ['Browse and search products by category', 'Scan barcodes', 'Select customer (Walk-in or from list)', 'Apply discounts', 'Multiple payment methods', 'Print / download receipts', 'Hold and resume sales'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Cashier'],
  },
  {
    icon: Package,
    name: 'Products',
    path: '/products',
    description: 'Manage your full product catalog with images, pricing, and stock info.',
    features: ['Add, edit, delete products', 'Upload product images or paste URLs', 'Assign category and brand', 'Bulk import via CSV / Excel / JSON', 'Stock quantity and threshold management'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Inventory Clerk'],
  },
  {
    icon: Tag,
    name: 'Categories & Brands',
    path: '/categories',
    description: 'Organise products into categories and brands for easier browsing.',
    features: ['Create colour-coded categories with emoji icons', 'Preset categories based on business type', 'Add and delete product brands', 'Link brands to products when adding/editing'],
    roles: ['Super Admin', 'Admin', 'Inventory Clerk'],
  },
  {
    icon: Warehouse,
    name: 'Inventory',
    path: '/inventory',
    description: 'Track stock levels, movements, and adjustments across your store.',
    features: ['Real-time stock overview', 'Stock-in and stock-out records', 'Manual stock adjustments with reason', 'Low-stock and out-of-stock alerts', 'Movement history log'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Inventory Clerk'],
  },
  {
    icon: Receipt,
    name: 'Sales',
    path: '/sales',
    description: 'View and manage the full history of all transactions.',
    features: ['Filter by status (Completed, Voided, Refunded)', 'Detailed sale breakdown with items and payments', 'Send receipt by email', 'Void and refund support'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Cashier (own sales)'],
  },
  {
    icon: Truck,
    name: 'Purchases',
    path: '/purchases',
    description: 'Manage purchase orders from suppliers.',
    features: ['Create and track purchase orders', 'Add line items manually or import from CSV/Excel', 'Status workflow: Draft → Ordered → Received', 'Mark orders as received to update stock'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Inventory Clerk'],
  },
  {
    icon: Users,
    name: 'Customers',
    path: '/customers',
    description: 'Maintain a database of your customers and track their purchasing history.',
    features: ['Customer groups: VIP, Wholesale, Regular, Walk-in', 'Credit limits and loyalty points', 'Purchase history and transaction count', 'Add, edit, delete customers'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Cashier'],
  },
  {
    icon: Factory,
    name: 'Suppliers',
    path: '/suppliers',
    description: 'Manage vendor relationships and track outstanding balances.',
    features: ['Supplier profiles with contact details', 'Credit limits and payment terms', 'Transaction history', 'Balance tracking'],
    roles: ['Super Admin', 'Admin', 'Manager', 'Inventory Clerk'],
  },
  {
    icon: FileText,
    name: 'Expenses',
    path: '/expenses',
    description: 'Record and categorise business expenses.',
    features: ['Multiple expense categories', 'Approval workflow', 'Payment method tracking', 'Tax amount recording'],
    roles: ['Super Admin', 'Admin', 'Manager'],
  },
  {
    icon: BarChart3,
    name: 'Reports',
    path: '/reports',
    description: 'Analyse your business performance with detailed reports.',
    features: ['Daily sales breakdown (click a day to see all transactions)', 'Top selling products', 'Top customers by revenue', 'Payment method breakdown', 'Send reports by email'],
    roles: ['Super Admin', 'Admin', 'Manager'],
  },
  {
    icon: Users,
    name: 'Users',
    path: '/users',
    description: 'Manage staff accounts and their access roles.',
    features: ['Add, edit, deactivate, delete users', 'Assign roles per user', 'Per-branch assignment', 'Last login tracking'],
    roles: ['Super Admin', 'Admin'],
  },
  {
    icon: Shield,
    name: 'Roles & Permissions',
    path: '/roles',
    description: 'Configure what each role can access across the system.',
    features: ['56-feature permission matrix', 'Toggle access per role and feature', 'Super Admin always has full access', 'Changes take effect on next login'],
    roles: ['Super Admin only'],
  },
  {
    icon: Settings,
    name: 'Settings',
    path: '/settings',
    description: 'Configure your business profile, receipt layout, tax, and payment methods.',
    features: ['Business logo (upload file or URL)', 'Business type and currency', 'Receipt paper size and fields', 'VAT rate and inclusive pricing', 'Enable/disable payment methods', 'Email & reports schedule (SMTP config)'],
    roles: ['Super Admin', 'Admin'],
  },
  {
    icon: HardDrive,
    name: 'Backup & Restore',
    path: '/backup',
    description: 'Export and restore all your POS data.',
    features: ['Download full data backup as JSON', 'Restore from a previous backup file', 'Backup history with date and size', 'Factory reset option'],
    roles: ['Super Admin only'],
  },
];

// ─── FAQ accordion item ──────────────────────────────────────────────────────
function FAQAccordion({ items }: { items: FAQItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={idx} className="rounded-xl border border-muted-100 overflow-hidden">
          <button
            type="button"
            onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
            className="w-full flex items-start justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted-50 transition-colors"
          >
            <span className="text-sm font-semibold text-[#1E293B]">{item.q}</span>
            <ChevronDown className={clsx('h-4 w-4 text-muted-400 shrink-0 mt-0.5 transition-transform', openIdx === idx && 'rotate-180')} />
          </button>
          {openIdx === idx && (
            <div className="px-4 pb-4 pt-1 border-t border-muted-100 bg-muted-50/40">
              <p className="text-sm text-muted-600 leading-relaxed">{item.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
type DocTab = 'overview' | 'modules' | 'roles' | 'faq' | 'contact';

const tabs: { id: DocTab; label: string; icon: typeof Book }[] = [
  { id: 'overview', label: 'Overview',    icon: Book         },
  { id: 'modules',  label: 'Modules',     icon: Zap          },
  { id: 'roles',    label: 'Access Roles',icon: Shield       },
  { id: 'faq',      label: 'FAQ',         icon: Info         },
  { id: 'contact',  label: 'Contact',     icon: MessageCircle},
];

export default function DocumentationPage() {
  const [activeTab,    setActiveTab]    = useState<DocTab>('overview');
  const [moduleSearch, setModuleSearch] = useState('');
  const [expandedMod,  setExpandedMod]  = useState<string | null>(null);

  const filteredModules = MODULES.filter((m) =>
    moduleSearch === '' ||
    m.name.toLowerCase().includes(moduleSearch.toLowerCase()) ||
    m.description.toLowerCase().includes(moduleSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight flex items-center gap-3">
          <Book className="h-6 w-6 text-muted-400" />
          Documentation
        </h1>
        <p className="text-sm text-muted-500 mt-0.5">
          User guide, module reference, and support contacts for {APP_NAME}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Tab nav */}
        <div className="lg:w-52 shrink-0">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto scrollbar-none lg:overflow-visible lg:sticky lg:top-24">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button key={t.id} onClick={() => setActiveTab(t.id)}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap lg:w-full text-left',
                    isActive ? 'bg-[#1E293B] text-white shadow-sm' : 'text-muted-600 hover:bg-muted-100 hover:text-[#1E293B]'
                  )}>
                  <Icon className={clsx('h-4 w-4 shrink-0', isActive ? 'text-white/70' : 'text-muted-400')} />
                  <span className="lg:block">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Hero card */}
              <div className="bg-gradient-to-br from-[#0F172A] to-[#1E293B] rounded-2xl p-6 sm:p-8 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-red via-brand-gold to-brand-green shadow-lg">
                    <ShoppingCart className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{APP_NAME}</h2>
                    <p className="text-white/60 text-xs">v1.0.0 Retail Edition</p>
                  </div>
                </div>
                <p className="text-white/80 text-sm leading-relaxed max-w-2xl">
                  A complete point-of-sale system built for Ghanaian retailers. Manage sales, inventory,
                  customers, suppliers, expenses, and reports — all from one place.
                  Works fully offline using local browser storage, and syncs to the backend server when available.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {[
                    { label: 'GH₵ Currency',     icon: Globe      },
                    { label: 'VAT Support',       icon: Receipt    },
                    { label: 'Mobile Money',      icon: ShoppingCart },
                    { label: 'Multi-role Access', icon: Shield     },
                    { label: 'Offline-capable',   icon: HardDrive  },
                    { label: 'Report Emails',     icon: Mail       },
                  ].map((f) => {
                    const Icon = f.icon;
                    return (
                      <span key={f.label} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80">
                        <Icon className="h-3.5 w-3.5" /> {f.label}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Quick start */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100">
                  <h2 className="text-sm font-bold text-[#1E293B]">Quick Start Guide</h2>
                </div>
                <div className="p-5 space-y-4">
                  {[
                    { step: '1', title: 'Sign In',         desc: 'Use your email & password, or use Quick Access to select a role for local sign-in.' },
                    { step: '2', title: 'Add Products',    desc: 'Go to Products → Add Product. Fill in name, SKU, price, stock, category, and optional brand/image.' },
                    { step: '3', title: 'Make a Sale',     desc: 'Open POS, add items to cart, choose a customer, select payment method, and confirm.' },
                    { step: '4', title: 'Check Reports',   desc: 'Go to Reports to view daily revenue, top products, and customer rankings.' },
                    { step: '5', title: 'Configure Settings', desc: 'Go to Settings to set your business name, logo, tax rate, receipt layout, and email reports.' },
                    { step: '6', title: 'Backup Your Data', desc: 'Go to Backup & Restore (Super Admin) regularly to download a JSON backup of all your data.' },
                  ].map((item) => (
                    <div key={item.step} className="flex items-start gap-4">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1E293B] text-white text-sm font-bold shrink-0">
                        {item.step}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1E293B]">{item.title}</p>
                        <p className="text-xs text-muted-500 mt-0.5 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* System requirements */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100">
                  <h2 className="text-sm font-bold text-[#1E293B]">System Requirements</h2>
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: 'Browser',   value: 'Chrome 90+, Firefox 90+, Edge 90+, Safari 14+' },
                    { label: 'Screen',    value: 'Minimum 360px width (mobile-friendly)' },
                    { label: 'Internet',  value: 'Required for backend sync; works offline for local sessions' },
                    { label: 'Backend',   value: 'Django REST Framework · PostgreSQL · Redis (optional)' },
                  ].map((r) => (
                    <div key={r.label} className="rounded-xl bg-muted-50 border border-muted-100 p-3.5">
                      <p className="text-[11px] font-bold text-muted-400 uppercase tracking-wider mb-1">{r.label}</p>
                      <p className="text-sm text-[#1E293B]">{r.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Modules ── */}
          {activeTab === 'modules' && (
            <div className="space-y-4">
              <div className="relative">
                <ChevronRight className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
                <input
                  type="search"
                  placeholder="Search modules…"
                  value={moduleSearch}
                  onChange={(e) => setModuleSearch(e.target.value)}
                  className="w-full h-10 pl-9 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                />
              </div>

              <div className="space-y-3">
                {filteredModules.map((mod) => {
                  const Icon = mod.icon;
                  const isOpen = expandedMod === mod.name;
                  return (
                    <div key={mod.name} className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-muted-100 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedMod(isOpen ? null : mod.name)}
                        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted-50 transition-colors"
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E293B]/[0.06] shrink-0">
                          <Icon className="h-5 w-5 text-[#1E293B]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-[#1E293B]">{mod.name}</p>
                            <span className="text-[10px] font-mono text-muted-400 bg-muted-100 rounded-full px-2 py-0.5">{mod.path}</span>
                          </div>
                          <p className="text-xs text-muted-500 mt-0.5 truncate">{mod.description}</p>
                        </div>
                        <ChevronDown className={clsx('h-4 w-4 text-muted-400 shrink-0 transition-transform', isOpen && 'rotate-180')} />
                      </button>

                      {isOpen && (
                        <div className="px-5 pb-5 border-t border-muted-100 pt-4 space-y-4">
                          <p className="text-sm text-muted-600 leading-relaxed">{mod.description}</p>
                          <div>
                            <p className="text-xs font-bold text-muted-500 uppercase tracking-wider mb-2">Features</p>
                            <ul className="space-y-1.5">
                              {mod.features.map((f) => (
                                <li key={f} className="flex items-start gap-2 text-sm text-muted-700">
                                  <Star className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-muted-500 uppercase tracking-wider mb-2">Who can access</p>
                            <div className="flex flex-wrap gap-1.5">
                              {mod.roles.map((r) => (
                                <span key={r} className="inline-flex items-center rounded-full bg-[#1E293B]/[0.06] text-[#1E293B] text-[11px] font-semibold px-2.5 py-1">
                                  {r}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Roles ── */}
          {activeTab === 'roles' && (
            <div className="space-y-4">
              {[
                {
                  role: 'Super Admin',
                  color: 'bg-rose-100 text-rose-700 border-rose-200',
                  dot: 'bg-rose-500',
                  desc: 'Complete system access. Can manage all settings, users, roles, backup/restore, and audit logs.',
                  can: ['Everything in the system', 'Manage Super Admin accounts', 'System settings & maintenance', 'Backup and restore data', 'View audit logs', 'Manage roles & permissions'],
                  cannot: [],
                },
                {
                  role: 'Admin',
                  color: 'bg-purple-100 text-purple-700 border-purple-200',
                  dot: 'bg-purple-500',
                  desc: 'Full operational access for business management. Cannot manage Super Admin accounts or system settings.',
                  can: ['Products, inventory, sales', 'Customers & suppliers', 'Reports & expenses', 'User management', 'Business settings', 'Audit logs'],
                  cannot: ['Manage Super Admin accounts', 'System settings', 'Backup & restore', 'Roles & permissions editing'],
                },
                {
                  role: 'Manager',
                  color: 'bg-blue-100 text-blue-700 border-blue-200',
                  dot: 'bg-blue-500',
                  desc: 'Operational management — daily business activities, stock, sales, and reports.',
                  can: ['POS / make sales', 'Products & inventory', 'Customers & suppliers', 'Expenses', 'Business reports'],
                  cannot: ['User management', 'System/security settings', 'Backup & restore', 'Roles management'],
                },
                {
                  role: 'Cashier',
                  color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
                  dot: 'bg-emerald-500',
                  desc: 'Front-desk sales operations only. Limited to POS, own transactions, and customer management.',
                  can: ['POS terminal', 'Create & process sales', 'Process payments', 'Print/download receipts', 'View & add customers', 'View own transactions'],
                  cannot: ['Delete products', 'Stock adjustments', 'Expenses', 'User management', 'Sensitive financial reports'],
                },
                {
                  role: 'Inventory Clerk',
                  color: 'bg-amber-100 text-amber-700 border-amber-200',
                  dot: 'bg-amber-500',
                  desc: 'Stock and catalog management. No access to sales, payments, or user management.',
                  can: ['Products & catalog', 'Categories & brands', 'Inventory & stock adjustments', 'Stock-in & stock-out', 'Purchases & receiving', 'Suppliers', 'Product images'],
                  cannot: ['POS / sales', 'Payment management', 'Expenses', 'User management', 'Financial reports'],
                },
              ].map((r) => (
                <div key={r.role} className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-muted-100 overflow-hidden">
                  <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-3">
                    <div className={clsx('h-2.5 w-2.5 rounded-full shrink-0', r.dot)} />
                    <span className={clsx('inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold', r.color)}>{r.role}</span>
                    <p className="text-xs text-muted-500 flex-1 min-w-0 truncate">{r.desc}</p>
                  </div>
                  <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2">✓ Can Access</p>
                      <ul className="space-y-1">
                        {r.can.map((c) => (
                          <li key={c} className="text-sm text-muted-700 flex items-start gap-2">
                            <span className="text-emerald-500 font-bold shrink-0">✓</span>{c}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {r.cannot.length > 0 && (
                      <div>
                        <p className="text-xs font-bold text-rose-600 uppercase tracking-wider mb-2">✗ No Access</p>
                        <ul className="space-y-1">
                          {r.cannot.map((c) => (
                            <li key={c} className="text-sm text-muted-700 flex items-start gap-2">
                              <span className="text-rose-400 font-bold shrink-0">✗</span>{c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── FAQ ── */}
          {activeTab === 'faq' && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4">
                <p className="text-sm text-blue-700">
                  Can't find your answer below?{' '}
                  <button type="button" onClick={() => setActiveTab('contact')}
                    className="font-bold underline hover:no-underline">
                    Contact our support team →
                  </button>
                </p>
              </div>
              <FAQAccordion items={FAQ_ITEMS} />
            </div>
          )}

          {/* ── Contact ── */}
          {activeTab === 'contact' && (
            <div className="space-y-5">
              {/* Main contact card */}
              <div className="bg-gradient-to-br from-[#0F172A] to-[#1E293B] rounded-2xl p-6 sm:p-8 text-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-red via-brand-gold to-brand-green shadow-lg shrink-0">
                    <ShoppingCart className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{SUPPORT.company}</h2>
                    <p className="text-white/60 text-xs">{SUPPORT.location}</p>
                  </div>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">
                  We're here to help you get the most out of your POPMYC POS system.
                  Reach out via phone, email, or WhatsApp for technical support,
                  training, or custom feature requests.
                </p>
              </div>

              {/* Contact details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Phone numbers */}
                {SUPPORT.phones.map((phone) => (
                  <a
                    key={phone}
                    href={`tel:+233${phone.replace(/^0/, '')}`}
                    className="group flex items-center gap-4 bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 hover:border-[#1E293B]/30 hover:shadow-md transition-all"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-100 shrink-0 group-hover:bg-emerald-100 transition-colors">
                      <Phone className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-400 uppercase tracking-wider">Phone / WhatsApp</p>
                      <p className="text-base font-bold text-[#1E293B] mt-0.5">{phone}</p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-300 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </a>
                ))}

                {/* Email */}
                <a
                  href={`mailto:${SUPPORT.email}`}
                  className="group flex items-center gap-4 bg-white rounded-2xl p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 hover:border-[#1E293B]/30 hover:shadow-md transition-all sm:col-span-2"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 border border-blue-100 shrink-0 group-hover:bg-blue-100 transition-colors">
                    <Mail className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted-400 uppercase tracking-wider">Email Support</p>
                    <p className="text-base font-bold text-[#1E293B] mt-0.5">{SUPPORT.email}</p>
                    <p className="text-xs text-muted-400 mt-0.5">We respond within 24 hours on business days</p>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-300 ml-auto shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </a>
              </div>

              {/* Support hours */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
                <h3 className="text-sm font-bold text-[#1E293B] mb-3 flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-muted-400" /> Support Hours
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { day: 'Monday – Friday',  hours: '8:00 AM – 6:00 PM' },
                    { day: 'Saturday',         hours: '9:00 AM – 4:00 PM' },
                    { day: 'Sunday',           hours: 'Emergency only'     },
                    { day: 'Public Holidays',  hours: 'Limited support'    },
                  ].map((r) => (
                    <div key={r.day} className="rounded-xl bg-muted-50 border border-muted-100 p-3">
                      <p className="text-[11px] font-semibold text-muted-400">{r.day}</p>
                      <p className="text-sm font-bold text-[#1E293B] mt-0.5">{r.hours}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tip */}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 flex items-start gap-3">
                <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700">
                  For faster support, have your business name, the version number (v1.0.0), and a description
                  of the issue ready when you contact us. Screenshots are very helpful.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
