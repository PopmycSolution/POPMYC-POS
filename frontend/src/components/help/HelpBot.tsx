/**
 * HelpBot — floating help widget
 *
 * Features:
 * - Floating ? button fixed to bottom-right
 * - Page-aware tips based on current route (including sub-routes)
 * - Offline-capable Q&A chatbot (rule-based, no internet needed)
 * - Smooth slide-up panel, mobile-friendly
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  HelpCircle, X, MessageCircle, BookOpen, ChevronRight,
  Send, Bot, User, RotateCcw, Sparkles,
} from 'lucide-react';
import { clsx } from 'clsx';

// ── Page-specific tips ────────────────────────────────────────────────────────
const PAGE_TIPS: Record<string, { title: string; tips: string[] }> = {
  '/dashboard': {
    title: 'Dashboard Tips',
    tips: [
      "Today's Revenue shows sales for your current branch only.",
      'Click any stat card to jump to the relevant page.',
      'Use the branch switcher (top bar) to view a specific branch.',
      'The notification bell shows real-time low-stock alerts.',
      'The dark/light mode toggle is in the top-right toolbar.',
      'Super Admin sees aggregate data across all branches when no branch is selected.',
    ],
  },
  '/pos': {
    title: 'POS Tips',
    tips: [
      'Scan a barcode or type a product name to add it to the cart.',
      'Use the stock filter pills (All / In Stock / Low / Out) to find available products quickly.',
      'Select a customer before checkout to track purchase history.',
      'Switch to Wholesale mode using the Retail/Wholesale toggle for bulk pricing.',
      'Tap the cart icon on mobile to view and confirm your order.',
      'Credit sales record a debt — the customer pays later. Find debts on the Debts page.',
      'Cashiers can negotiate prices if the business allows cashier price negotiation (set in Settings).',
      'Hold a sale to park it while you serve another customer, then resume it later.',
    ],
  },
  '/products': {
    title: 'Products Tips',
    tips: [
      'Stock quantity shown is for your selected branch.',
      'Set a low-stock threshold so you get alerted before running out.',
      'Use the bulk import (Excel/CSV) to add many products at once.',
      'Products marked as Track Stock will be affected by purchases, sales and adjustments.',
      'You can set Retail or Negotiable pricing per product.',
      'Add multiple barcodes to a product for different packaging sizes.',
      'Product images help staff identify items quickly at the POS.',
    ],
  },
  '/categories': {
    title: 'Categories Tips',
    tips: [
      'Categories help organise products in the POS and reports.',
      'You can nest categories using the Parent Category field.',
      'Deactivating a category hides it from dropdowns but does not delete products.',
      'Use short, clear category names for faster filtering at the POS.',
    ],
  },
  '/brands': {
    title: 'Brands Tips',
    tips: [
      'Brands are shared across your whole business, not per branch.',
      'Assigning a brand to a product helps with filtered reporting.',
      'You can add a website URL and logo to a brand for reference.',
    ],
  },
  '/units': {
    title: 'Units of Measure Tips',
    tips: [
      'Set separate purchase and sale units — e.g. buy in cartons, sell in pieces.',
      'Enable fractional quantities for items sold by weight or volume.',
      'Mark a unit as the Base Unit to define your primary measurement.',
    ],
  },
  '/inventory': {
    title: 'Inventory Tips',
    tips: [
      "Select a branch in the top bar to see that branch's stock levels.",
      'Use "Stock In" to add received goods to a branch.',
      'The Movements tab shows a full, permanent history of all stock changes.',
      'The Alerts tab flags low-stock and out-of-stock items.',
      'The Adjustments tab shows a summary of posted stock corrections.',
      'Stock is tracked per branch and per warehouse within a branch.',
    ],
  },
  '/inventory/adjustments': {
    title: 'Stock Adjustments Tips',
    tips: [
      'Stock Adjustments are only available when Inventory Mode = Stock Enabled.',
      'Select the adjustment type carefully — it determines how stock moves.',
      'Damage, Expired, Lost, Theft, Internal Use and Supplier Return all DECREASE stock.',
      'Found Stock and Stock Correction can INCREASE or CORRECT stock.',
      'Theft, Internal Use and Supplier Return are restricted to Inventory Clerk, Manager, Admin and Super Admin.',
      'Every adjustment creates a permanent stock movement record — it cannot be deleted.',
      'For phones/electronics, enter the IMEI or serial number in the Serial field.',
      'Add clear notes explaining the reason — this appears in the audit history.',
      'You can adjust multiple products in a single adjustment by adding more line items.',
    ],
  },
  '/inventory/transfers': {
    title: 'Branch Transfers Tips',
    tips: [
      'Branch Transfers are only available when Inventory Mode = Stock Enabled.',
      'You cannot transfer stock from a branch to itself.',
      'Physical Collection: the receiving branch\'s staff come and collect. Stock moves in one step when confirmed.',
      'Delivery/Dispatch: follows Requested → Approved → In Transit → Received → Completed.',
      'Only Managers and Admins can approve a transfer.',
      'Stock is deducted from the sending branch when Dispatch is confirmed.',
      'Stock is added to the receiving branch only when receipt is confirmed.',
      'If sent quantity ≠ received quantity, the transfer is flagged with a Discrepancy.',
      'A Manager must resolve discrepancies before the transfer is marked Completed.',
      'For phones/electronics, enter the IMEI and condition per item.',
      'All transfer records are permanent and cannot be deleted.',
    ],
  },
  '/sales': {
    title: 'Sales Tips',
    tips: [
      'Use the period filter (Today / This Week / This Month) to narrow results.',
      'Click any sale row to see the full receipt details.',
      "Today's Revenue reflects only your current branch.",
      'Voided sales are excluded from revenue totals.',
      'Credit sales show a balance owed — record payments on the Debts page.',
      'You can reprint a receipt from any completed sale.',
    ],
  },
  '/purchases': {
    title: 'Purchases Tips',
    tips: [
      'Create a Draft PO first, then change status to Ordered when sent to the supplier.',
      'Mark as Received when goods arrive — this updates branch inventory automatically.',
      'Partial receipts update stock only for received quantities.',
      'Attach the supplier invoice reference for easy tracking.',
      'Received purchases increase stock at the selected branch and warehouse.',
      'Only authorised roles (Inventory Clerk, Manager, Admin, Super Admin) can receive stock.',
    ],
  },
  '/customers': {
    title: 'Customers Tips',
    tips: [
      'Customers are linked to your branch — each branch manages its own.',
      'Credit balance shows how much a customer owes from credit sales.',
      'VIP and Wholesale groups can unlock special pricing at the POS.',
      'Loyalty points are tracked per customer automatically.',
      'You can view full purchase history and outstanding debts per customer.',
    ],
  },
  '/suppliers': {
    title: 'Suppliers Tips',
    tips: [
      'Link suppliers to purchase orders for full procurement tracking.',
      'Track supplier balances — how much you owe per supplier.',
      'Supplier Return adjustments can be created from Stock Adjustments.',
      'Add bank account details to a supplier for payment reference.',
    ],
  },
  '/expenses': {
    title: 'Expenses Tips',
    tips: [
      'Expenses are scoped to your active branch.',
      'Set status to Approved before marking as Paid.',
      'Tax-deductible expenses are separated in financial reports.',
      'Use categories to review spending by type.',
      'Only Managers and above can approve expenses.',
    ],
  },
  '/debt': {
    title: 'Debts Tips',
    tips: [
      'Debts come from Credit sales made at the POS.',
      'Record a payment when the customer pays off part or all of their balance.',
      'Write Off clears the debt if it becomes uncollectable.',
      'All debt records are scoped to your branch.',
      "You can see a customer's total outstanding balance on their profile.",
    ],
  },
  '/reports': {
    title: 'Reports Tips',
    tips: [
      'Reports are scoped to your selected branch.',
      'Top Products shows best-selling items by revenue.',
      'Payment Methods breakdown helps plan cash handling and float.',
      'Use the date range selector to compare different periods.',
      'Stock reports require Inventory Mode = Stock Enabled.',
      'You can email reports directly to management from this page.',
      'Financial reports show profit margins per product category.',
    ],
  },
  '/users': {
    title: 'Users Tips',
    tips: [
      'Assign users to a branch so they only see that branch\'s data.',
      'Set a temporary password — the user is prompted to change it on first login.',
      'Super Admin has access to everything — assign this role very carefully.',
      'Deactivating a user prevents them from logging in immediately.',
      'Each user can set their own profile picture — stored securely per user.',
      'Users assigned the Cashier role can only access POS, Sales and Customers.',
    ],
  },
  '/roles': {
    title: 'Roles & Permissions Tips',
    tips: [
      'Roles control exactly what each user can see and do in the system.',
      'Changes to a role take effect immediately for all users with that role.',
      'You can create custom roles with granular permission combinations.',
      'The stock_adjustments permission grants access to the Stock Adjustments page.',
      'The manage_transfers permission grants access to Branch Transfers.',
      'Never remove all permissions from the Super Admin role.',
      'Test a new role by assigning it to a test user before rolling out to staff.',
    ],
  },
  '/branches': {
    title: 'Branches Tips',
    tips: [
      'Mark exactly one branch as Head Office — new products stock here by default.',
      'Deactivating a branch hides it from the branch switcher and transfers.',
      'Each branch has its own inventory, sales, customers and expenses.',
      'Only Super Admin and Admin can create or edit branches.',
      'Each branch can have one or more warehouses for detailed stock location tracking.',
    ],
  },
  '/settings': {
    title: 'Settings Tips',
    tips: [
      'Update your business name, logo, address and contact details here.',
      'Configure tax rates (VAT) for automatic calculation at the POS.',
      'Customise your receipt layout, paper size, logo and footer message.',
      'Payment methods control what options appear at POS checkout.',
      'Inventory Mode: Stock Enabled = full stock tracking. Sales Only = no stock quantities required.',
      'Pricing Mode: Fixed, Bargaining, or Both — controls price negotiation at the POS.',
      'Business Type determines which features and categories are shown.',
      'Email notifications can send daily and weekly reports automatically.',
    ],
  },
  '/audit': {
    title: 'Audit Logs Tips',
    tips: [
      'Audit Logs record every significant action performed in the system.',
      'Logs include the user, action, date/time and IP address.',
      'Logs cannot be edited or deleted — they are a permanent record.',
      'Use the module and action filters to find specific events quickly.',
      'Password changes, login attempts and data modifications are all logged.',
    ],
  },
  '/system': {
    title: 'System Settings Tips',
    tips: [
      'System Settings are only accessible to Super Admin.',
      'Configure email (SMTP) settings for notifications and reports.',
      'Database and storage settings are managed here.',
      'Always test SMTP settings before enabling email notifications.',
    ],
  },
  '/backup': {
    title: 'Backup & Restore Tips',
    tips: [
      'Schedule automatic backups to protect your business data.',
      'Download a manual backup before making major system changes.',
      'Backups are encrypted and stored securely.',
      'Only Super Admin can perform a restore.',
    ],
  },
};

// ── Offline chatbot Q&A rules ─────────────────────────────────────────────────
interface QA { keywords: string[]; answer: string }

const QA_RULES: QA[] = [
  // ── Getting started ──
  { keywords: ['hello', 'hi', 'help', 'what can you do', 'start'],
    answer: "Hi! I'm the POPMYC POS assistant 🤖. Ask me anything about using the system — sales, stock, transfers, adjustments, customers, reports, branches, users or settings. Or browse the 💡 Tips tab for page-specific hints." },

  // ── POS & Sales ──
  { keywords: ['sale', 'sell', 'checkout', 'complete sale', 'pos', 'billing'],
    answer: 'To make a sale: open POS → search or scan products → add to cart → select a customer (optional) → choose payment method → click Confirm Payment. The sale is recorded and stock decremented automatically.' },
  { keywords: ['credit', 'debt', 'owe', 'credit sale', 'pay later'],
    answer: 'For credit sales: at POS checkout select "Credit" as payment method. Enter any upfront amount (can be 0). The balance is recorded as a debt on the Debts page. Record payments there when the customer pays.' },
  { keywords: ['bargain', 'negotiate', 'change price', 'cashier price'],
    answer: 'Price negotiation is controlled per business. If allowed (Settings → Pricing Mode), cashiers can enter a negotiated price at the POS. Managers can always override prices.' },
  { keywords: ['hold', 'park sale', 'suspend', 'hold sale'],
    answer: 'To hold a sale: click the Hold button in the POS toolbar. The sale is parked. Resume it later from the held sales list while serving another customer.' },
  { keywords: ['barcode', 'scan', 'scanner'],
    answer: 'At the POS, click the search box and scan with a USB or Bluetooth scanner. You can also type the product name or SKU. Multiple barcodes can be assigned to a single product.' },
  { keywords: ['wholesale', 'retail', 'pricing mode', 'price mode'],
    answer: 'Switch between Retail and Wholesale pricing at the POS using the Retail/Wholesale toggle. Wholesale prices must be set on each product. If Bargaining is enabled, cashiers can also enter a custom price.' },
  { keywords: ['print', 'receipt', 'printer', 'thermal'],
    answer: 'After a sale completes a receipt is shown. Click the print icon to print it. Customise layout, paper size (58mm / 80mm / A4), logo and footer in Settings → Receipt Settings.' },

  // ── Stock & Inventory ──
  { keywords: ['stock', 'add stock', 'stock in', 'restock', 'receive stock'],
    answer: 'To add stock: go to Purchases → create a Purchase Order → mark it as Received when goods arrive. This updates branch stock automatically. For quick manual additions, use Inventory → Stock In, or create a Stock Adjustment (Found Stock type).' },
  { keywords: ['stock adjust', 'adjustment', 'stock correction', 'damage', 'damaged', 'expired', 'lost', 'theft', 'internal use', 'supplier return', 'found stock'],
    answer: 'Stock Adjustments (Inventory → Stock Adjustments): choose a type — Damaged, Expired, Lost, Theft, Internal Use, Stock Correction, Supplier Return or Found Stock. Select branch and products, enter quantities, add notes, then Post Adjustment. A permanent stock movement record is created. Theft, Internal Use and Supplier Return require Inventory Clerk or above.' },
  { keywords: ['transfer', 'transfer stock', 'branch transfer', 'move stock', 'send stock between'],
    answer: 'Branch Transfers (Inventory → Branch Transfers): choose Physical Collection or Delivery. Physical Collection: approve then confirm collection in one step. Delivery: Requested → Approved (Manager) → Dispatch (deducts from sender) → Record Receipt (credits receiver). Quantity discrepancies are flagged for Manager resolution.' },
  { keywords: ['discrepancy', 'transfer discrepancy', 'sent received difference'],
    answer: "If a transfer's received quantity differs from sent, the system flags a discrepancy. The transfer stays RECEIVED until a Manager reviews it and clicks \"Resolve Discrepancy\" with an explanation. Stock is credited only for what was actually received." },
  { keywords: ['stock movement', 'movement history', 'stock history', 'audit trail stock'],
    answer: 'Every stock change creates a permanent StockMovement record — purchases, sales, adjustments, transfers, openings and returns. View them in Inventory → Movements tab. Records can never be deleted.' },
  { keywords: ['imei', 'serial number', 'serialised', 'phone stock', 'electronics stock'],
    answer: 'For serialised products (phones, electronics): when creating a Stock Adjustment or Branch Transfer, enter the IMEI or serial number in the Serial/IMEI field per line item. This tracks exactly which unit was adjusted or transferred.' },
  { keywords: ['inventory mode', 'stock enabled', 'sales only', 'stock disabled'],
    answer: 'Inventory Mode (Settings → Inventory): "Stock Enabled" = full tracking — purchases increase stock, sales decrease it, adjustments and transfers work. "Sales Only" = products sell freely with no stock quantities — stock features, adjustments and transfers are hidden.' },
  { keywords: ['low stock', 'out of stock', 'stock alert', 'reorder'],
    answer: 'Set a low-stock threshold on each product. When branch stock falls at or below the threshold, a stock alert fires in the notification bell and the Inventory → Alerts tab.' },

  // ── Purchases ──
  { keywords: ['purchase order', 'po', 'order stock', 'order from supplier', 'purchase'],
    answer: 'To create a Purchase Order: go to Purchases → "+ New PO" → select supplier and branch → add products and quantities. Save as Draft, then Ordered when sent. When goods arrive, mark as Received — stock is added to the branch automatically.' },

  // ── Customers & Debts ──
  { keywords: ['customer', 'add customer', 'new customer', 'customer group'],
    answer: 'To add a customer: go to Customers → "+ Add Customer" → fill in name, phone and group (Regular, VIP, Wholesale). Customers are linked to your active branch. VIP and Wholesale groups can unlock special pricing at the POS.' },
  { keywords: ['debt', 'record payment', 'pay debt', 'clear debt', 'write off'],
    answer: 'To manage debts: go to Debts page. Click a debt to record a payment (partial or full). Use "Write Off" to clear uncollectable debts. All debt history is permanent.' },

  // ── Users & Permissions ──
  { keywords: ['role', 'permission', 'access level', 'what can cashier', 'what can manager'],
    answer: 'Roles: SUPER_ADMIN (full access), ADMIN (operations + users + settings), MANAGER (approvals + reports + transfers), INVENTORY_CLERK (full stock management), CASHIER (POS + sales + customers only). Roles are fully customisable on the Roles & Permissions page.' },
  { keywords: ['add user', 'create user', 'new user', 'staff'],
    answer: 'To add a user: go to Users → "+ Add User" → enter name, email, role and branch. Set a temporary password — the user will be prompted to change it on first login.' },
  { keywords: ['password', 'reset password', 'change password', 'forgot password'],
    answer: 'Self-service: click your avatar in the sidebar → "Change Password". Admin reset: go to Users → click the 🔑 key icon next to the user. A temporary password is generated and the user must change it on next login.' },
  { keywords: ['profile picture', 'avatar', 'profile photo', 'change photo'],
    answer: 'To change your profile picture: click your avatar in the bottom-left of the sidebar → "Change Picture". Upload a JPG, PNG or WEBP up to 5 MB. Each user has their own independent picture — it persists across logins and is never shared with other users.' },

  // ── Branches ──
  { keywords: ['branch', 'create branch', 'new branch', 'add branch', 'warehouse'],
    answer: 'To add a branch: go to Branches → "+ Add Branch" → fill in name, code and address. Mark one branch as Head Office. Each branch can have warehouses for detailed stock location tracking. Only Super Admin and Admin can manage branches.' },

  // ── Reports ──
  { keywords: ['report', 'revenue', 'sales report', 'top products', 'financial'],
    answer: 'Reports page shows: Sales Summary, Top Products by revenue, Top Customers, Payment Methods breakdown, and Stock Reports (when Stock Enabled). All reports are scoped to your selected branch. Use the date range selector to compare periods.' },

  // ── Settings ──
  { keywords: ['settings', 'business settings', 'tax', 'vat', 'receipt settings'],
    answer: 'Settings covers: Business Info (name, logo, address), Tax (VAT rate), Receipt (layout, paper size, footer), Inventory Mode (Stock Enabled / Sales Only), Pricing Mode (Fixed / Bargaining / Both), Payment Methods, and Email Notifications.' },

  // ── Offline / Sync ──
  { keywords: ['offline', 'no internet', 'internet connection', 'sync', 'demo mode'],
    answer: 'POPMYC POS works offline. All data is saved locally. When internet is restored, data syncs automatically. In demo/offline mode profile pictures are also saved locally. The system detects your mode automatically.' },
];

function findAnswer(query: string): string {
  const q = query.toLowerCase();
  for (const rule of QA_RULES) {
    if (rule.keywords.some((kw) => q.includes(kw))) return rule.answer;
  }
  return "I'm not sure about that specific question. Try asking about: stock adjustments, branch transfers, making a sale, adding stock, user roles, inventory mode, profile pictures, purchase orders, or reports. You can also browse the 💡 Tips tab for page-specific help.";
}

// ── Message type ──────────────────────────────────────────────────────────────
interface Msg { id: string; role: 'user' | 'bot'; text: string; ts: Date }

// ── Tip item — click to expand full content ───────────────────────────────────
function TipItem({ tip }: { tip: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className={clsx(
        'w-full flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all duration-200 cursor-pointer',
        expanded
          ? 'bg-teal-100 border-teal-400 shadow-sm'
          : 'bg-teal-50 border-teal-100 hover:bg-teal-100 hover:border-teal-300 active:scale-[0.99]',
      )}
    >
      <ChevronRight
        className={clsx(
          'h-3.5 w-3.5 shrink-0 mt-0.5 transition-transform duration-200 text-teal-600',
          expanded ? 'rotate-90' : '',
        )}
      />
      <div className="min-w-0 flex-1">
        {!expanded && (
          <p className="text-xs text-slate-700 leading-relaxed line-clamp-1">{tip}</p>
        )}
        {expanded && (
          <p className="text-xs text-teal-800 leading-relaxed font-medium">{tip}</p>
        )}
      </div>
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export function HelpBot() {
  const location = useLocation();
  const [open,     setOpen]     = useState(false);
  const [tab,      setTab]      = useState<'tips' | 'chat'>('tips');
  const [input,    setInput]    = useState('');
  const [messages, setMessages] = useState<Msg[]>([
    { id: '0', role: 'bot', text: "Hi! I'm your POPMYC POS assistant 🤖. Ask me anything about the system — stock adjustments, branch transfers, sales, users, reports and more. Or browse the 💡 Tips tab for page-specific hints.", ts: new Date() },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  // Current page tips — handles two-segment routes like /inventory/adjustments
  const route = useMemo(() => {
    const full = location.pathname;
    if (PAGE_TIPS[full]) return full;          // exact two-segment match first
    return '/' + full.split('/')[1];           // fall back to first segment
  }, [location.pathname]);

  const pageTips = useMemo(() => PAGE_TIPS[route] ?? PAGE_TIPS['/dashboard'], [route]);

  // Auto-scroll chat
  useEffect(() => {
    if (tab === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tab]);

  // Focus input when chat tab opens
  useEffect(() => {
    if (open && tab === 'chat') setTimeout(() => inputRef.current?.focus(), 100);
  }, [open, tab]);

  function sendMessage() {
    const text = input.trim();
    if (!text) return;
    const userMsg: Msg = { id: Date.now().toString(),       role: 'user', text,              ts: new Date() };
    const botMsg:  Msg = { id: (Date.now() + 1).toString(), role: 'bot',  text: findAnswer(text), ts: new Date() };
    setMessages((prev) => [...prev, userMsg, botMsg]);
    setInput('');
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function clearChat() {
    setMessages([{ id: '0', role: 'bot', text: 'Chat cleared! Ask me anything about POPMYC POS — stock, transfers, sales, users, reports and more.', ts: new Date() }]);
  }

  return (
    <>
      {/* ── Panel ── */}
      {open && (
        <div
          className="fixed bottom-20 right-4 sm:right-6 z-[100] w-[calc(100vw-2rem)] sm:w-[380px] max-h-[70vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
          style={{ animation: 'helpSlideUp 0.22s cubic-bezier(0.22,0.61,0.36,1) both' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-teal-600 to-teal-700 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/20">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white leading-tight">POPMYC Assistant</p>
                <p className="text-[10px] text-white/70">Works offline · Always available</p>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/20 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-100 shrink-0">
            <button type="button" onClick={() => setTab('tips')}
              className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors',
                tab === 'tips' ? 'text-teal-700 border-b-2 border-teal-600' : 'text-slate-500 hover:text-slate-700')}>
              <BookOpen className="h-3.5 w-3.5" /> Page Tips
            </button>
            <button type="button" onClick={() => setTab('chat')}
              className={clsx('flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors',
                tab === 'chat' ? 'text-teal-700 border-b-2 border-teal-600' : 'text-slate-500 hover:text-slate-700')}>
              <MessageCircle className="h-3.5 w-3.5" /> Ask a Question
            </button>
          </div>

          {/* Tips tab */}
          {tab === 'tips' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                <p className="text-xs font-bold text-slate-700">{pageTips.title}</p>
              </div>
              {pageTips.tips.map((tip, i) => (
                <TipItem key={i} tip={tip} />
              ))}
              <button type="button" onClick={() => setTab('chat')}
                className="w-full mt-2 rounded-xl bg-teal-600 text-white text-xs font-semibold py-2.5 hover:bg-teal-700 transition-colors flex items-center justify-center gap-1.5">
                <MessageCircle className="h-3.5 w-3.5" /> Ask a specific question
              </button>
            </div>
          )}

          {/* Chat tab */}
          {tab === 'chat' && (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {messages.map((m) => (
                  <div key={m.id} className={clsx('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    {m.role === 'bot' && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 mt-0.5">
                        <Bot className="h-3.5 w-3.5 text-teal-700" />
                      </div>
                    )}
                    <div className={clsx(
                      'max-w-[82%] rounded-2xl px-3 py-2 text-xs leading-relaxed',
                      m.role === 'user'
                        ? 'bg-teal-600 text-white rounded-tr-sm'
                        : 'bg-slate-100 text-slate-700 rounded-tl-sm',
                    )}>
                      {m.text}
                    </div>
                    {m.role === 'user' && (
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 mt-0.5">
                        <User className="h-3.5 w-3.5 text-slate-600" />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {/* Input */}
              <div className="px-3 pb-3 pt-2 border-t border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Ask about adjustments, transfers, stock…"
                    className="flex-1 h-9 px-3 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-teal-500 transition-colors bg-slate-50"
                  />
                  <button type="button" onClick={sendMessage} disabled={!input.trim()}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 transition-colors shrink-0">
                    <Send className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={clearChat} title="Clear chat"
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors shrink-0">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] text-slate-400 text-center">Offline AI · No internet needed</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Floating trigger button ── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'fixed bottom-5 right-4 sm:right-6 z-[100] flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200 active:scale-95',
          open
            ? 'bg-slate-800 text-white shadow-slate-900/30'
            : 'bg-teal-600 text-white shadow-teal-600/40 hover:bg-teal-700 hover:scale-105',
        )}
        aria-label="Help"
      >
        {open ? <X className="h-5 w-5" /> : <HelpCircle className="h-5 w-5" />}
      </button>

      <style>{`
        @keyframes helpSlideUp {
          from { opacity:0; transform:translateY(16px) scale(0.97); }
          to   { opacity:1; transform:translateY(0)    scale(1);    }
        }
      `}</style>
    </>
  );
}

export default HelpBot;
