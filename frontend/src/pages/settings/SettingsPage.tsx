import { useState, useRef, useEffect, useCallback } from 'react';import {
  Settings,
  Store,
  Receipt,
  Calculator,
  CreditCard,
  Save,
  Check,
  Image,
  Eye,
  Type,
  Globe,
  Hash,
  Phone,
  Mail,
  FileText,
  Bell,
  Clock,
  Server,
  Lock,
  Upload,
  X,
  Camera,
  Link as LinkIcon,
  Tag,
  ShoppingBag,
  Info,
  Package,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Calendar,
  Key,
  History,
  Zap,
  Warehouse,
  Download,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSettingsStore } from '@/stores/settings.store';
import { useCategoryStore } from '@/stores/category.store';
import { useBranchStore } from '@/stores/branch.store';
import api from '@/services/api';
import { BUSINESS_CATEGORY_LABELS, NEGOTIABLE_BUSINESS_CATEGORIES, type BusinessCategory } from '@/types';
import { useUpdater } from '@/hooks/useUpdater';

type SettingsSection = 'general' | 'receipt' | 'tax' | 'payments' | 'pricing' | 'inventory' | 'notifications' | 'subscription' | 'about' | 'backup';

const sections: { id: SettingsSection; label: string; icon: typeof Settings; description: string }[] = [
  { id: 'general',       label: 'General',          icon: Store,       description: 'Business info, logo & currency' },
  { id: 'receipt',       label: 'Receipt',           icon: Receipt,     description: 'Invoice layout & fields' },
  { id: 'tax',           label: 'Tax',               icon: Calculator,  description: 'VAT rates & settings' },
  { id: 'payments',      label: 'Payments',          icon: CreditCard,  description: 'Accepted payment types' },
  { id: 'pricing',       label: 'Pricing',           icon: Tag,         description: 'Business type & negotiation' },
  { id: 'inventory',     label: 'Inventory',         icon: Package,     description: 'Stock tracking mode' },
  { id: 'notifications', label: 'Email & Reports',   icon: Bell,        description: 'Daily reports & alerts' },
  { id: 'subscription',  label: 'Subscription',      icon: ShoppingBag, description: 'License & activation' },
  { id: 'backup',        label: 'Backup',            icon: Server,      description: 'Database backup & recovery' },
  { id: 'about',         label: 'About & Updates',   icon: Zap,         description: 'App version & updates' },
];

const BUSINESS_CATEGORY_OPTIONS = (Object.keys(BUSINESS_CATEGORY_LABELS) as BusinessCategory[]).map((k) => ({
  value: k,
  label: BUSINESS_CATEGORY_LABELS[k],
}));

const WEEK_DAYS = [
  { value: 'MON', label: 'Monday' },
  { value: 'TUE', label: 'Tuesday' },
  { value: 'WED', label: 'Wednesday' },
  { value: 'THU', label: 'Thursday' },
  { value: 'FRI', label: 'Friday' },
  { value: 'SAT', label: 'Saturday' },
  { value: 'SUN', label: 'Sunday' },
] as const;

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange}
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
      style={{ backgroundColor: enabled ? '#1E293B' : '#D1D5DB' }}>
      <span className={clsx('pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
        enabled ? 'translate-x-5' : 'translate-x-0')} />
    </button>
  );
}

function SettingField({ label, icon: Icon, hint, children }: { label: string; icon?: typeof Store; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-600 mb-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-400" />}
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-400 mt-1">{hint}</p>}
    </div>
  );
}

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow';
const textareaClass = 'w-full px-3 py-2.5 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none transition-shadow';

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">
      <Save className="h-4 w-4" /> Save Changes
    </button>
  );
}

// ─── Logo Picker ─────────────────────────────────────────────────────────────
interface LogoPickerProps {
  value: string;
  onChange: (v: string) => void;
}

function LogoPicker({ value, onChange }: LogoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<'upload' | 'url'>('upload');
  const [urlDraft, setUrlDraft] = useState(value?.startsWith('http') ? value : '');

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') onChange(reader.result); };
    reader.readAsDataURL(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      {/* Preview + clear */}
      <div className="flex items-center gap-4">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-muted-100 border-2 border-dashed border-muted-300 shrink-0 overflow-hidden">
          {value ? (
            <>
              <img src={value} alt="Logo" className="h-full w-full object-contain rounded-xl" />
              <button
                type="button"
                onClick={() => { onChange(''); setUrlDraft(''); }}
                className="absolute top-1 right-1 h-5 w-5 flex items-center justify-center rounded-full bg-white/90 shadow text-muted-500 hover:text-rose-600 transition-colors"
                aria-label="Remove logo"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <Image className="h-7 w-7 text-muted-400" />
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex-1 space-y-2">
          <div className="flex rounded-xl bg-muted-100 p-1 gap-1 w-fit">
            <button type="button" onClick={() => setTab('upload')}
              className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                tab === 'upload' ? 'bg-white shadow-sm text-[#1E293B]' : 'text-muted-500 hover:text-muted-700')}>
              <Camera className="h-3.5 w-3.5" /> Upload File
            </button>
            <button type="button" onClick={() => setTab('url')}
              className={clsx('inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                tab === 'url' ? 'bg-white shadow-sm text-[#1E293B]' : 'text-muted-500 hover:text-muted-700')}>
              <LinkIcon className="h-3.5 w-3.5" /> Paste URL
            </button>
          </div>

          {tab === 'upload' && (
            <>
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
              <button type="button" onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-4 py-2 text-xs font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                <Upload className="h-3.5 w-3.5" /> {value ? 'Replace Logo' : 'Choose Image'}
              </button>
              <p className="text-[11px] text-muted-400">PNG, JPG, WEBP — stored locally as base64</p>
            </>
          )}

          {tab === 'url' && (
            <div className="flex gap-2">
              <input type="url" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onChange(urlDraft.trim()); } }}
                placeholder="https://example.com/logo.png"
                className="flex-1 h-9 px-3 rounded-xl bg-white border border-muted-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
              <button type="button" onClick={() => onChange(urlDraft.trim())}
                className="h-9 px-3 rounded-xl bg-[#1E293B] text-white text-xs font-semibold hover:bg-[#334155] transition-colors shrink-0">
                Apply
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [saved, setSaved] = useState(false);

  // ── Subscription state ────────────────────────────────────────────────────
  const isLocalSession = (() => {
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
  })();

  interface LicenseStatus {
    is_active: boolean;
    status: string;
    license_type: string | null;
    days_remaining: number | null;
    expiry_date: string | null;
    start_date: string | null;
    activated_at: string | null;
    activation_code?: string;
    detail?: string;
  }
  interface RenewalLog {
    id: string;
    action: string;
    code_used: string;
    previous_expiry: string | null;
    new_expiry: string | null;
    duration_days: number;
    performed_by: string | null;
    created_at: string;
  }

  const [licenseData,    setLicenseData]    = useState<LicenseStatus | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const [licenseError,   setLicenseError]   = useState('');
  const [activateCode,   setActivateCode]   = useState('');
  const [renewCode,      setRenewCode]      = useState('');
  const [actionSaving,   setActionSaving]   = useState(false);
  const [actionSuccess,  setActionSuccess]  = useState('');
  const [actionError,    setActionError]    = useState('');
  const [renewalLogs,    setRenewalLogs]    = useState<RenewalLog[]>([]);
  const [logsLoading,    setLogsLoading]    = useState(false);
  const [licenseId,      setLicenseId]      = useState<string | null>(null);

  const fetchLicense = useCallback(async () => {
    if (isLocalSession) return;
    setLicenseLoading(true);
    setLicenseError('');
    try {
      const res = await api.get<LicenseStatus>('/licensing/licenses/status/');
      setLicenseData(res.data);
      // Also fetch the license id for logs
      const listRes = await api.get<{ results?: { id: string }[]; } | { id: string }[]>('/licensing/licenses/');
      const list = Array.isArray(listRes.data) ? listRes.data : (listRes.data as { results?: { id: string }[] }).results ?? [];
      if (list[0]?.id) setLicenseId(list[0].id);
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setLicenseError(ae.response?.data?.detail ?? 'Could not load license information.');
    } finally {
      setLicenseLoading(false);
    }
  }, [isLocalSession]);

  const fetchLogs = useCallback(async () => {
    if (!licenseId || isLocalSession) return;
    setLogsLoading(true);
    try {
      const res = await api.get<RenewalLog[]>(`/licensing/licenses/${licenseId}/logs/`);
      setRenewalLogs(Array.isArray(res.data) ? res.data : []);
    } catch { /* silently ignore */ }
    finally { setLogsLoading(false); }
  }, [licenseId, isLocalSession]);

  useEffect(() => {
    if (activeSection === 'subscription') void fetchLicense();
  }, [activeSection, fetchLicense]);

  useEffect(() => {
    if (licenseId) void fetchLogs();
  }, [licenseId, fetchLogs]);

  async function handleActivate() {
    if (!activateCode.trim()) { setActionError('Enter an activation code.'); return; }
    setActionSaving(true); setActionError(''); setActionSuccess('');
    try {
      const res = await api.post<{ detail: string; license: LicenseStatus }>(
        '/licensing/licenses/activate/', { activation_code: activateCode.trim().toUpperCase() }
      );
      setLicenseData(res.data.license);
      setActivateCode('');
      setActionSuccess('License activated successfully!');
      void fetchLogs();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setActionError(ae.response?.data?.detail ?? 'Activation failed. Check your code and try again.');
    } finally { setActionSaving(false); }
  }

  async function handleRenew() {
    if (!renewCode.trim()) { setActionError('Enter a renewal code.'); return; }
    setActionSaving(true); setActionError(''); setActionSuccess('');
    try {
      const res = await api.post<{ detail: string; license: LicenseStatus }>(
        '/licensing/licenses/renew/', { activation_code: renewCode.trim().toUpperCase() }
      );
      setLicenseData(res.data.license);
      setRenewCode('');
      setActionSuccess('License renewed successfully!');
      void fetchLogs();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setActionError(ae.response?.data?.detail ?? 'Renewal failed. Check your code and try again.');
    } finally { setActionSaving(false); }
  }

  // Settings store
  const business            = useSettingsStore((s) => s.business);
  const tax                 = useSettingsStore((s) => s.tax);
  const receipt             = useSettingsStore((s) => s.receipt);
  const pricing             = useSettingsStore((s) => s.pricing);
  const inventory           = useSettingsStore((s) => s.inventory);
  const paymentMethods      = useSettingsStore((s) => s.paymentMethods);
  const emailNotifications  = useSettingsStore((s) => s.emailNotifications);
  const updateBusiness      = useSettingsStore((s) => s.updateBusiness);
  const updateTax           = useSettingsStore((s) => s.updateTax);
  const updateReceipt       = useSettingsStore((s) => s.updateReceipt);
  const updatePricing       = useSettingsStore((s) => s.updatePricing);
  const updateInventory     = useSettingsStore((s) => s.updateInventory);
  const togglePaymentMethod = useSettingsStore((s) => s.togglePaymentMethod);
  const updateEmail         = useSettingsStore((s) => s.updateEmailNotifications);
  const seedCategories      = useCategoryStore((s) => s.seedForBusinessType);

  // ── Updater (desktop only — web returns idle) ─────────────────────────────
  const updater = useUpdater();

  // Derived: does current business category support negotiable pricing?
  const supportsNegotiable  = NEGOTIABLE_BUSINESS_CATEGORIES.includes(business.businessCategory);

  // Active branch — for receipt preview branch phone line
  const activeBranchId  = useBranchStore((s) => s.activeBranchId);
  const branches        = useBranchStore((s) => s.branches);
  const activeBranch    = branches.find((b) => b.id === activeBranchId) ?? branches.find((b) => b.isHeadOffice) ?? branches[0] ?? null;
  const previewBranchPhone = activeBranch?.phone ?? '';
  const previewBranchName  = activeBranch?.name  ?? '';

  function showSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Settings</h1>
          <p className="text-sm text-muted-500 mt-0.5">Configure your POS system</p>
        </div>
        {saved && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 px-3 py-1.5 text-xs font-semibold border border-emerald-200">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sub-navigation */}
        <div className="lg:w-56 shrink-0">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto scrollbar-none lg:overflow-visible lg:sticky lg:top-24">
            {sections.map((s) => {
              const Icon = s.icon;
              const isActive = activeSection === s.id;
              return (
                <button key={s.id} onClick={() => setActiveSection(s.id)}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all whitespace-nowrap lg:w-full text-left',
                    isActive ? 'bg-[#1E293B] text-white shadow-sm' : 'text-muted-600 hover:bg-muted-100 hover:text-[#1E293B]'
                  )}>
                  <Icon className={clsx('h-4 w-4 shrink-0', isActive ? 'text-white/70' : 'text-muted-400')} />
                  <div className="hidden lg:block min-w-0">
                    <p className="truncate">{s.label}</p>
                    <p className={clsx('text-[10px] truncate', isActive ? 'text-white/50' : 'text-muted-400')}>{s.description}</p>
                  </div>
                  <span className="lg:hidden">{s.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── General ── */}
          {activeSection === 'general' && (
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                <Store className="h-5 w-5 text-muted-400" />
                <h2 className="text-sm font-bold text-[#1E293B]">Business Information</h2>
              </div>
              <div className="p-5 space-y-5">
                {/* Logo */}
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-600 mb-2">
                    <Image className="h-3.5 w-3.5 text-muted-400" /> Business Logo
                  </label>
                  <LogoPicker value={business.logoUrl} onChange={(v) => updateBusiness({ logoUrl: v })} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SettingField label="Business Name" icon={Type}>
                    <input value={business.name} onChange={(e) => updateBusiness({ name: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="Business Category" icon={Store}
                    hint="Controls pricing behaviour — e.g. Phone & Accessories enables negotiable pricing. Changing this will update default product categories.">
                    <select
                      value={business.businessCategory}
                      onChange={(e) => {
                        const cat = e.target.value as BusinessCategory;
                        updateBusiness({ businessCategory: cat });
                        // Swap product categories to match the new business type
                        seedCategories(cat);
                      }}
                      className={inputClass}
                    >
                      {BUSINESS_CATEGORY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </SettingField>
                  <SettingField label="Phone" icon={Phone}>
                    <input value={business.phone} onChange={(e) => updateBusiness({ phone: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="Email" icon={Mail}>
                    <input value={business.email} onChange={(e) => updateBusiness({ email: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="Address">
                    <input value={business.address} onChange={(e) => updateBusiness({ address: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="TIN (Tax ID)" icon={Hash}>
                    <input value={business.tin} onChange={(e) => updateBusiness({ tin: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="Currency" icon={Globe}>
                    <input value={business.currency} onChange={(e) => updateBusiness({ currency: e.target.value })} className={inputClass} />
                  </SettingField>
                  <SettingField label="Currency Symbol">
                    <input value={business.currencySymbol} onChange={(e) => updateBusiness({ currencySymbol: e.target.value })} className={inputClass} />
                  </SettingField>
                </div>
                <div className="flex justify-end pt-2"><SaveButton onClick={showSaved} /></div>
              </div>
            </div>
          )}

          {/* ── Receipt ── */}
          {activeSection === 'receipt' && (
            <div className="space-y-4">
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Receipt Configuration</h2>
                </div>
                <div className="p-5 space-y-5">
                  <SettingField label="Paper Width">
                    <div className="flex gap-2">
                      {(['58mm', '80mm', 'A4'] as const).map((w) => (
                        <button key={w} onClick={() => updateReceipt({ paperWidth: w })}
                          className={clsx('rounded-xl px-4 py-2 text-sm font-medium border transition-all',
                            receipt.paperWidth === w ? 'bg-[#1E293B] text-white border-[#1E293B]' : 'bg-white text-muted-600 border-muted-200 hover:bg-muted-50')}>
                          {w}
                        </button>
                      ))}
                    </div>
                  </SettingField>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {([
                      { key: 'showLogo' as const,         label: 'Show Logo' },
                      { key: 'showBusinessName' as const,  label: 'Business Name' },
                      { key: 'showAddress' as const,       label: 'Address' },
                      { key: 'showPhone' as const,         label: 'Phone Number' },
                      { key: 'showTin' as const,           label: 'TIN Number' },
                      { key: 'showThankYou' as const,      label: 'Thank You Message' },
                    ]).map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-muted-50 border border-muted-100">
                        <span className="text-sm text-muted-700">{label}</span>
                        <Toggle enabled={receipt[key]} onChange={() => updateReceipt({ [key]: !receipt[key] })} />
                      </div>
                    ))}
                  </div>
                  <SettingField label="Header Text (optional)">
                    <textarea value={receipt.headerText} onChange={(e) => updateReceipt({ headerText: e.target.value })} rows={2} placeholder="Custom text at top of receipts..." className={textareaClass} />
                  </SettingField>
                  <SettingField label="Footer Text">
                    <textarea value={receipt.footerText} onChange={(e) => updateReceipt({ footerText: e.target.value })} rows={2} className={textareaClass} />
                  </SettingField>
                  {receipt.showThankYou && (
                    <SettingField label="Thank You Message">
                      <textarea value={receipt.thankYouMessage} onChange={(e) => updateReceipt({ thankYouMessage: e.target.value })} rows={2} className={textareaClass} />
                    </SettingField>
                  )}
                  <div className="flex justify-end pt-2"><SaveButton onClick={showSaved} /></div>
                </div>
              </div>

              {/* Receipt Preview */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Eye className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Receipt Preview</h2>
                  <span className="ml-auto text-[10px] text-muted-400 font-medium">
                    Live preview — reflects your settings above
                  </span>
                </div>
                <div className="p-5 flex justify-center">
                  <div className={clsx(
                    'bg-white border border-muted-200 rounded-lg p-4 font-mono text-xs leading-relaxed text-muted-700 shadow-sm',
                    receipt.paperWidth === 'A4' ? 'w-64' : receipt.paperWidth === '58mm' ? 'w-40' : 'w-52',
                  )}>
                    {/* ── Header ── */}
                    {receipt.showLogo && business.logoUrl && (
                      <div className="text-center mb-2">
                        <img src={business.logoUrl} alt="logo" className="h-8 mx-auto object-contain rounded" />
                      </div>
                    )}
                    {receipt.showBusinessName && (
                      <p className="text-center font-bold text-sm text-[#1E293B]">{business.name}</p>
                    )}
                    {receipt.showAddress && business.address && (
                      <p className="text-center text-[10px]">{business.address}</p>
                    )}
                    {/* Branch name — always shown in preview when a branch is selected */}
                    {previewBranchName && (
                      <p className="text-center text-[10px] font-semibold">{previewBranchName}</p>
                    )}
                    {/* Phone: branch phone takes priority, falls back to business phone */}
                    {receipt.showPhone && (previewBranchPhone || business.phone) && (
                      <p className="text-center text-[10px]">
                        Tel: {previewBranchPhone || business.phone}
                      </p>
                    )}
                    {/* Show main business phone too if branch phone is different */}
                    {receipt.showPhone && previewBranchPhone && business.phone && previewBranchPhone !== business.phone && (
                      <p className="text-center text-[10px] text-muted-500">Main: {business.phone}</p>
                    )}
                    {receipt.showTin && business.tin && (
                      <p className="text-center text-[10px]">TIN: {business.tin}</p>
                    )}
                    {receipt.headerText && (
                      <p className="text-center text-[10px] mt-1 italic">{receipt.headerText}</p>
                    )}

                    <div className="border-t border-dashed border-muted-300 my-2" />

                    {/* ── Meta ── */}
                    <div className="flex justify-between text-[10px]">
                      <span>Receipt #:</span><span className="font-semibold">INV-260909-0042</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Date:</span><span>09/09/2026 14:30</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Cashier:</span><span>Daniel</span>
                    </div>

                    <div className="border-t border-dashed border-muted-300 my-2" />

                    {/* ── Items ── */}
                    <div className="text-[10px] space-y-1">
                      <div className="flex justify-between">
                        <span>Rice Bag 5kg</span><span>{business.currencySymbol}95.00</span>
                      </div>
                      <div className="text-[9px] text-muted-400">1 x {business.currencySymbol}95.00</div>
                      <div className="flex justify-between mt-1">
                        <span>Cooking Oil 1L</span><span>{business.currencySymbol}55.00</span>
                      </div>
                      <div className="text-[9px] text-muted-400">1 x {business.currencySymbol}55.00</div>
                    </div>

                    <div className="border-t border-dashed border-muted-300 my-2" />

                    {/* ── Totals ── */}
                    <div className="text-[10px] space-y-0.5">
                      <div className="flex justify-between">
                        <span>Items (2):</span><span>{business.currencySymbol}150.00</span>
                      </div>
                      <div className="flex justify-between font-bold text-[11px] pt-1 border-t border-dotted border-muted-300">
                        <span>TOTAL:</span><span>{business.currencySymbol}150.00</span>
                      </div>
                    </div>

                    <div className="border-t border-dashed border-muted-300 my-2" />

                    {/* ── Payment ── */}
                    <div className="text-[10px] space-y-0.5">
                      <div className="flex justify-between">
                        <span>Payment:</span><span>Cash</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Amount Paid:</span><span>{business.currencySymbol}150.00</span>
                      </div>
                    </div>

                    <div className="border-t border-dashed border-muted-300 my-2" />

                    {/* ── Footer ── */}
                    {receipt.showThankYou && receipt.thankYouMessage && (
                      <p className="text-center text-[10px] font-semibold italic">{receipt.thankYouMessage}</p>
                    )}
                    {receipt.footerText && (
                      <p className="text-center text-[10px] mt-1 italic">{receipt.footerText}</p>
                    )}
                    <p className="text-center text-[9px] mt-2 text-muted-400">
                      {business.name} © {new Date().getFullYear()}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Tax ── */}
          {activeSection === 'tax' && (
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                <Calculator className="h-5 w-5 text-muted-400" />
                <h2 className="text-sm font-bold text-[#1E293B]">Tax Settings</h2>
              </div>
              <div className="p-5 space-y-5">
                <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
                  <div>
                    <p className="text-sm font-semibold text-[#1E293B]">Enable Tax</p>
                    <p className="text-xs text-muted-500 mt-0.5">Apply tax to taxable items at checkout</p>
                  </div>
                  <Toggle enabled={tax.enabled} onChange={() => updateTax({ enabled: !tax.enabled })} />
                </div>
                {tax.enabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SettingField label="Tax Name">
                      <input value={tax.name} onChange={(e) => updateTax({ name: e.target.value })} className={inputClass} />
                    </SettingField>
                    <SettingField label="Tax Rate (%)">
                      <input type="number" value={tax.rate} onChange={(e) => updateTax({ rate: Number(e.target.value) })} className={inputClass} min={0} max={100} step={0.5} />
                    </SettingField>
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
                        <div>
                          <p className="text-sm font-semibold text-[#1E293B]">Tax-Inclusive Pricing</p>
                          <p className="text-xs text-muted-500 mt-0.5">Product prices already include tax</p>
                        </div>
                        <Toggle enabled={tax.inclusive} onChange={() => updateTax({ inclusive: !tax.inclusive })} />
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex justify-end pt-2"><SaveButton onClick={showSaved} /></div>
              </div>
            </div>
          )}

          {/* ── Pricing ── */}
          {activeSection === 'pricing' && (
            <div className="space-y-4">
              {/* Business Type info card */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Business Type</h2>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-muted-50 border border-muted-100">
                    <Info className="h-4 w-4 text-muted-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-[#1E293B]">
                        Current: {BUSINESS_CATEGORY_LABELS[business.businessCategory] ?? business.businessCategory}
                      </p>
                      <p className="text-xs text-muted-500 mt-1">
                        {supportsNegotiable
                          ? '✅ This business type supports Negotiable pricing. Products can be individually marked as negotiable.'
                          : '🔒 This business type uses Fixed pricing only. All products are sold at their stated price.'}
                      </p>
                      <p className="text-xs text-muted-400 mt-1">
                        To change, go to <strong>General → Business Category</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Summary of negotiable-capable types */}
                  <div className="rounded-xl border border-muted-100 overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted-50 border-b border-muted-100">
                      <p className="text-xs font-semibold text-muted-600">Negotiable Pricing Business Types</p>
                    </div>
                    <div className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {NEGOTIABLE_BUSINESS_CATEGORIES.map((cat) => (
                          <span
                            key={cat}
                            className={clsx(
                              'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border',
                              business.businessCategory === cat
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-muted-50 text-muted-600 border-muted-200',
                            )}
                          >
                            {BUSINESS_CATEGORY_LABELS[cat]}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-400 mt-3">
                        All other business types are Fixed-price only.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cashier Negotiation Permission */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Lock className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Pricing Permissions</h2>
                </div>
                <div className="p-5 space-y-4">
                  {/* Cashier negotiation toggle */}
                  <div className={clsx(
                    'flex items-start justify-between gap-4 p-4 rounded-xl border',
                    supportsNegotiable ? 'bg-muted-50 border-muted-100' : 'bg-muted-50/50 border-muted-100 opacity-60',
                  )}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1E293B]">
                        Allow Cashier Price Negotiation
                      </p>
                      <p className="text-xs text-muted-500 mt-1 leading-relaxed">
                        When <strong>ON</strong>, Cashiers can finalise a negotiated price at checkout without
                        manager approval. When <strong>OFF</strong> (default), only Admins and Managers may negotiate.
                      </p>
                      {!supportsNegotiable && (
                        <p className="text-[11px] text-amber-600 mt-1.5 font-medium">
                          ⚠ Not applicable — your business type uses Fixed pricing only.
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 pt-0.5">
                      <Toggle
                        enabled={pricing.allowCashierPriceNegotiation}
                        onChange={() => {
                          if (supportsNegotiable) {
                            updatePricing({ allowCashierPriceNegotiation: !pricing.allowCashierPriceNegotiation });
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Role summary */}
                  <div className="rounded-xl border border-muted-100 overflow-hidden">
                    <div className="px-4 py-2.5 bg-muted-50 border-b border-muted-100">
                      <p className="text-xs font-semibold text-muted-600">Who Can Negotiate Prices</p>
                    </div>
                    <div className="divide-y divide-muted-50">
                      {[
                        { role: 'Super Admin', can: true,  note: 'Always' },
                        { role: 'Admin',       can: true,  note: 'Always' },
                        { role: 'Manager',     can: true,  note: 'Always' },
                        { role: 'Cashier',     can: pricing.allowCashierPriceNegotiation,
                          note: pricing.allowCashierPriceNegotiation ? 'Enabled by this setting' : 'Requires manager approval' },
                        { role: 'Inventory Clerk', can: false, note: 'Never — stock management only' },
                      ].map(({ role, can, note }) => (
                        <div key={role} className="flex items-center justify-between px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-[#1E293B]">{role}</p>
                            <p className="text-[11px] text-muted-400 mt-0.5">{note}</p>
                          </div>
                          <span className={clsx(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold',
                            can ? 'bg-emerald-50 text-emerald-700' : 'bg-muted-100 text-muted-500',
                          )}>
                            {can ? '✓ Can Negotiate' : '✗ Cannot'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end pt-2"><SaveButton onClick={showSaved} /></div>
                </div>
              </div>
            </div>
          )}

          {/* ── Inventory / Operating Mode ── */}
          {activeSection === 'inventory' && (
            <div className="space-y-4">
              {/* Operating mode selector */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Package className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Operating Mode</h2>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-xs text-muted-500 leading-relaxed">
                    Choose how this business operates. You can switch modes at any time — existing data is <strong>never deleted</strong>.
                  </p>

                  {/* Three-way selector */}
                  {(() => {
                    const mode = inventory.inventoryMode;
                    const isFull  = mode === 'FULL_POS'       || mode === 'STOCK_ENABLED';
                    const isInv   = mode === 'INVENTORY_ONLY';
                    const isPos   = mode === 'POS_ONLY'        || mode === 'SALES_ONLY';

                    const opts = [
                      {
                        value:   'FULL_POS' as const,
                        label:   'Full POS + Inventory',
                        icon:    Package,
                        active:  isFull,
                        color:   'emerald',
                        bullets: [
                          '✔ Full POS checkout',
                          '✔ Sales & payments',
                          '✔ Inventory & stock tracking',
                          '✔ Purchases & stock-in',
                          '✔ Low-stock alerts',
                        ],
                      },
                      {
                        value:   'INVENTORY_ONLY' as const,
                        label:   'Inventory / Stock Only',
                        icon:    Warehouse,
                        active:  isInv,
                        color:   'blue',
                        bullets: [
                          '✔ Full inventory management',
                          '✔ Purchases & stock-in',
                          '✔ Stock adjustments & transfers',
                          '✘ POS checkout disabled',
                          '✘ New sales blocked',
                        ],
                      },
                      {
                        value:   'POS_ONLY' as const,
                        label:   'POS Only',
                        icon:    ShoppingBag,
                        active:  isPos,
                        color:   'amber',
                        bullets: [
                          '✔ Full POS checkout',
                          '✔ Sales & customers',
                          '✔ Product catalogue',
                          '✘ Inventory workflows hidden',
                          '✘ Stock tracking hidden',
                        ],
                      },
                    ] as const;

                    const colorMap = {
                      emerald: {
                        border: 'border-emerald-500 bg-emerald-50',
                        icon:   'bg-emerald-100',
                        iconFg: 'text-emerald-600',
                        title:  'text-emerald-800',
                        badge:  'text-[10px] font-bold text-emerald-600',
                      },
                      blue: {
                        border: 'border-blue-500 bg-blue-50',
                        icon:   'bg-blue-100',
                        iconFg: 'text-blue-600',
                        title:  'text-blue-800',
                        badge:  'text-[10px] font-bold text-blue-600',
                      },
                      amber: {
                        border: 'border-amber-500 bg-amber-50',
                        icon:   'bg-amber-100',
                        iconFg: 'text-amber-600',
                        title:  'text-amber-800',
                        badge:  'text-[10px] font-bold text-amber-600',
                      },
                    };

                    return (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {opts.map(({ value, label, icon: Icon, active, color, bullets }) => {
                          const c = colorMap[color];
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => updateInventory({ inventoryMode: value })}
                              className={clsx(
                                'flex flex-col items-start gap-2 rounded-2xl border-2 p-4 text-left transition-all',
                                active
                                  ? c.border
                                  : 'border-muted-200 bg-white hover:border-muted-300',
                              )}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl shrink-0', active ? c.icon : 'bg-muted-100')}>
                                  <Icon className={clsx('h-4 w-4', active ? c.iconFg : 'text-muted-400')} />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={clsx('text-sm font-bold', active ? c.title : 'text-muted-600')}>{label}</p>
                                  {active && <span className={c.badge}>✓ Currently active</span>}
                                </div>
                              </div>
                              <ul className="text-[11px] text-muted-500 space-y-0.5 leading-relaxed">
                                {bullets.map((b) => <li key={b}>{b}</li>)}
                              </ul>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Status banner */}
                  {(() => {
                    const mode = inventory.inventoryMode;
                    const isFull = mode === 'FULL_POS' || mode === 'STOCK_ENABLED';
                    const isInv  = mode === 'INVENTORY_ONLY';
                    const cfg = isFull
                      ? { bg: 'bg-emerald-50 border-emerald-200', ic: 'text-emerald-600', tc: 'text-emerald-800', ts: 'text-emerald-700',
                          title: 'Full POS + Inventory is active', body: 'All POS and inventory features are available.' }
                      : isInv
                      ? { bg: 'bg-blue-50 border-blue-200',       ic: 'text-blue-600',    tc: 'text-blue-800',    ts: 'text-blue-700',
                          title: 'Inventory Only mode is active', body: 'Stock management is enabled. New POS sales are blocked.' }
                      : { bg: 'bg-amber-50 border-amber-200',     ic: 'text-amber-600',   tc: 'text-amber-800',   ts: 'text-amber-700',
                          title: 'POS Only mode is active', body: 'Checkout and sales are enabled. Inventory management is hidden.' };
                    return (
                      <div className={clsx('flex items-start gap-3 p-4 rounded-xl border', cfg.bg)}>
                        <Info className={clsx('h-4 w-4 shrink-0 mt-0.5', cfg.ic)} />
                        <div>
                          <p className={clsx('text-sm font-semibold', cfg.tc)}>{cfg.title}</p>
                          <p className={clsx('text-xs mt-0.5 leading-relaxed', cfg.ts)}>{cfg.body}</p>
                        </div>
                      </div>
                    );
                  })()}

                  <div className="flex justify-end pt-2"><SaveButton onClick={showSaved} /></div>
                </div>
              </div>

              {/* Feature availability table */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Info className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Feature Availability by Mode</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted-50 border-b border-muted-100">
                        <th className="text-left px-4 py-2.5 font-semibold text-muted-600">Feature</th>
                        <th className="text-center px-4 py-2.5 font-semibold text-emerald-700">Full POS</th>
                        <th className="text-center px-4 py-2.5 font-semibold text-blue-700">Inv. Only</th>
                        <th className="text-center px-4 py-2.5 font-semibold text-amber-700">POS Only</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-muted-50">
                      {([
                        ['POS checkout / new sales',   true,  false, true ],
                        ['Sales history (read)',        true,  true,  true ],
                        ['Products & catalogue',        true,  true,  true ],
                        ['Customers',                   true,  false, true ],
                        ['Purchase orders',             true,  true,  false],
                        ['Stock-in / receiving',        true,  true,  false],
                        ['Inventory levels',            true,  true,  false],
                        ['Low-stock alerts',            true,  true,  false],
                        ['Stock adjustments',           true,  true,  false],
                        ['Branch transfers',            true,  true,  false],
                        ['Stock movements history',     true,  true,  false],
                        ['Suppliers',                   true,  true,  false],
                        ['Reports',                     true,  true,  true ],
                      ] as const).map(([label, full, inv, pos]) => (
                        <tr key={label} className="hover:bg-muted-50/50">
                          <td className="px-4 py-2.5 text-muted-700">{label}</td>
                          {[full, inv, pos].map((v, i) => (
                            <td key={i} className="px-4 py-2.5 text-center">
                              {v ? <span className="text-emerald-600 font-bold">✓</span> : <span className="text-muted-300">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {/* ── Payments ── */}
          {activeSection === 'payments' && (
            <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-muted-400" />
                <h2 className="text-sm font-bold text-[#1E293B]">Payment Methods</h2>
              </div>
              <div className="p-5 space-y-2">
                <p className="text-xs text-muted-500 mb-3">Enable or disable payment methods available at checkout</p>
                {paymentMethods.map((pm) => (
                  <div key={pm.id} className="flex items-center justify-between p-3.5 rounded-xl border border-muted-100 hover:bg-muted-50/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={clsx('flex h-9 w-9 items-center justify-center rounded-xl', pm.enabled ? 'bg-emerald-50' : 'bg-muted-100')}>
                        {pm.type === 'CASH' ? <FileText className={clsx('h-4 w-4', pm.enabled ? 'text-emerald-600' : 'text-muted-400')} /> :
                         pm.type === 'MOBILE_MONEY' ? <Phone className={clsx('h-4 w-4', pm.enabled ? 'text-emerald-600' : 'text-muted-400')} /> :
                         <CreditCard className={clsx('h-4 w-4', pm.enabled ? 'text-emerald-600' : 'text-muted-400')} />}
                      </div>
                      <div>
                        <p className={clsx('text-sm font-semibold', pm.enabled ? 'text-[#1E293B]' : 'text-muted-400')}>{pm.name}</p>
                        <p className="text-[11px] text-muted-400">{pm.code} · {pm.type.replace('_', ' ')}</p>
                      </div>
                    </div>
                    <Toggle enabled={pm.enabled} onChange={() => togglePaymentMethod(pm.id)} />
                  </div>
                ))}
                <div className="flex justify-end pt-4"><SaveButton onClick={showSaved} /></div>
              </div>
            </div>
          )}

          {/* ── Email & Reports ── */}
          {activeSection === 'notifications' && (
            <div className="space-y-4">
              {/* Recipient */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Mail className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Report Recipient</h2>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-xs text-muted-500">Reports and alerts will be sent to this address.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SettingField label="Owner Name" icon={Type}>
                      <input value={emailNotifications.ownerName}
                        onChange={(e) => updateEmail({ ownerName: e.target.value })}
                        placeholder="e.g. Kwame Mensah" className={inputClass} />
                    </SettingField>
                    <SettingField label="Owner Email" icon={Mail}>
                      <input type="email" value={emailNotifications.ownerEmail}
                        onChange={(e) => updateEmail({ ownerEmail: e.target.value })}
                        placeholder="owner@yourbusiness.com" className={inputClass} />
                    </SettingField>
                  </div>
                </div>
              </div>

              {/* Report schedule */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">Report Schedule</h2>
                </div>
                <div className="p-5 space-y-4">
                  {/* Daily report */}
                  <div className="rounded-xl border border-muted-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-muted-50/60">
                      <div>
                        <p className="text-sm font-semibold text-[#1E293B]">Daily Sales Report</p>
                        <p className="text-xs text-muted-500 mt-0.5">Summary of sales, revenue and top products</p>
                      </div>
                      <Toggle enabled={emailNotifications.dailyReportEnabled}
                        onChange={() => updateEmail({ dailyReportEnabled: !emailNotifications.dailyReportEnabled })} />
                    </div>
                    {emailNotifications.dailyReportEnabled && (
                      <div className="px-4 py-3 border-t border-muted-100">
                        <SettingField label="Send Time" icon={Clock}>
                          <input type="time" value={emailNotifications.dailyReportTime}
                            onChange={(e) => updateEmail({ dailyReportTime: e.target.value })}
                            className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 w-36" />
                        </SettingField>
                      </div>
                    )}
                  </div>

                  {/* Weekly report */}
                  <div className="rounded-xl border border-muted-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-muted-50/60">
                      <div>
                        <p className="text-sm font-semibold text-[#1E293B]">Weekly Summary</p>
                        <p className="text-xs text-muted-500 mt-0.5">7-day performance overview each week</p>
                      </div>
                      <Toggle enabled={emailNotifications.weeklyReportEnabled}
                        onChange={() => updateEmail({ weeklyReportEnabled: !emailNotifications.weeklyReportEnabled })} />
                    </div>
                    {emailNotifications.weeklyReportEnabled && (
                      <div className="px-4 py-3 border-t border-muted-100">
                        <SettingField label="Send On" icon={Clock}>
                          <select value={emailNotifications.weeklyReportDay}
                            onChange={(e) => updateEmail({ weeklyReportDay: e.target.value as typeof emailNotifications.weeklyReportDay })}
                            className="h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 w-44">
                            {WEEK_DAYS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                          </select>
                        </SettingField>
                      </div>
                    )}
                  </div>

                  {/* Low stock alerts */}
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-muted-50/60 border border-muted-100">
                    <div>
                      <p className="text-sm font-semibold text-[#1E293B]">Low Stock Alerts</p>
                      <p className="text-xs text-muted-500 mt-0.5">Get notified when products fall below threshold</p>
                    </div>
                    <Toggle enabled={emailNotifications.lowStockAlertEnabled}
                      onChange={() => updateEmail({ lowStockAlertEnabled: !emailNotifications.lowStockAlertEnabled })} />
                  </div>
                </div>
              </div>

              {/* SMTP Configuration */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-muted-400" />
                    <h2 className="text-sm font-bold text-[#1E293B]">SMTP Configuration</h2>
                  </div>
                  <span className="text-[11px] font-semibold text-muted-400 bg-muted-100 rounded-full px-2.5 py-1">
                    Required to send emails
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <SettingField label="SMTP Host" icon={Server}
                      hint="e.g. smtp.gmail.com or mail.yourdomain.com">
                      <input value={emailNotifications.smtpHost}
                        onChange={(e) => updateEmail({ smtpHost: e.target.value })}
                        placeholder="smtp.gmail.com" className={inputClass} />
                    </SettingField>
                    <SettingField label="SMTP Port" icon={Hash}>
                      <input type="number" value={emailNotifications.smtpPort}
                        onChange={(e) => updateEmail({ smtpPort: Number(e.target.value) })}
                        placeholder="587" className={inputClass} />
                    </SettingField>
                    <SettingField label="Username / Email" icon={Mail}>
                      <input type="email" value={emailNotifications.smtpUsername}
                        onChange={(e) => updateEmail({ smtpUsername: e.target.value })}
                        placeholder="you@gmail.com" className={inputClass} />
                    </SettingField>
                    <SettingField label="Password / App Password" icon={Lock}>
                      <input type="password" value={emailNotifications.smtpPassword}
                        onChange={(e) => updateEmail({ smtpPassword: e.target.value })}
                        placeholder="••••••••••••" className={inputClass} />
                    </SettingField>
                    <SettingField label="From Name" icon={Type}
                      hint="Appears as the sender name in emails">
                      <input value={emailNotifications.smtpFromName}
                        onChange={(e) => updateEmail({ smtpFromName: e.target.value })}
                        placeholder="POPMYC POS" className={inputClass} />
                    </SettingField>
                    <SettingField label="From Email" icon={Mail}>
                      <input type="email" value={emailNotifications.smtpFromEmail}
                        onChange={(e) => updateEmail({ smtpFromEmail: e.target.value })}
                        placeholder="reports@yourbusiness.com" className={inputClass} />
                    </SettingField>
                  </div>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
                    <div>
                      <p className="text-sm font-semibold text-[#1E293B]">Use TLS Encryption</p>
                      <p className="text-xs text-muted-500 mt-0.5">Recommended for most SMTP providers (port 587)</p>
                    </div>
                    <Toggle enabled={emailNotifications.smtpUseTls}
                      onChange={() => updateEmail({ smtpUseTls: !emailNotifications.smtpUseTls })} />
                  </div>

                  {/* Help note */}
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
                    <p className="text-xs font-semibold text-blue-700 mb-1">Gmail tip</p>
                    <p className="text-[11px] text-blue-600 leading-relaxed">
                      If you use Gmail, enable 2-Step Verification and create an <strong>App Password</strong> at
                      myaccount.google.com/apppasswords. Use that as your password above with port 587 and TLS enabled.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <SaveButton onClick={showSaved} />
              </div>
            </div>
          )}

          {/* ── Subscription ── */}
          {activeSection === 'subscription' && (
            <div className="space-y-5">

              {/* Local/demo mode notice */}
              {isLocalSession && (
                <div className="flex items-start gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-5 py-4">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Demo / Offline Mode</p>
                    <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                      Subscription management requires a live backend connection.
                      Log in with real credentials to view and manage your license.
                    </p>
                  </div>
                </div>
              )}

              {/* Loading state */}
              {!isLocalSession && licenseLoading && (
                <div className="flex items-center justify-center py-16 gap-3 text-muted-400">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-sm">Loading license…</span>
                </div>
              )}

              {/* Error state */}
              {!isLocalSession && licenseError && !licenseLoading && (
                <div className="flex items-start gap-3 rounded-2xl bg-rose-50 border border-rose-200 px-5 py-4">
                  <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-rose-800">Could not load license</p>
                    <p className="text-xs text-rose-700 mt-0.5">{licenseError}</p>
                  </div>
                  <button onClick={() => void fetchLicense()}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900">
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </button>
                </div>
              )}

              {/* License status card */}
              {!isLocalSession && licenseData && !licenseLoading && (() => {
                const lic    = licenseData;
                const isActive  = lic.is_active;
                const isExpired = lic.status === 'EXPIRED';
                const isPending = lic.status === 'PENDING' || lic.status === 'NO_LICENSE';
                const isSuspended = lic.status === 'SUSPENDED' || lic.status === 'REVOKED';
                const isLifetime = lic.license_type === 'LIFETIME';
                const daysLeft   = lic.days_remaining ?? 0;
                const urgentDays = daysLeft <= 7 && !isLifetime && isActive;
                const warnDays   = daysLeft <= 30 && daysLeft > 7 && !isLifetime && isActive;

                const statusMeta = isActive
                  ? { label: 'Active',    color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', icon: CheckCircle }
                  : isExpired
                  ? { label: 'Expired',   color: 'text-rose-700',    bg: 'bg-rose-50 border-rose-200',       icon: AlertTriangle }
                  : isPending
                  ? { label: 'Pending',   color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',     icon: Clock }
                  : isSuspended
                  ? { label: 'Suspended', color: 'text-red-700',     bg: 'bg-red-50 border-red-200',         icon: Lock }
                  : { label: lic.status,  color: 'text-muted-700',   bg: 'bg-muted-50 border-muted-200',     icon: Info };

                const StatusIcon = statusMeta.icon;

                return (
                  <>
                    {/* Main status banner */}
                    <div className={clsx('rounded-2xl border p-5', statusMeta.bg)}>
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                        <div className="flex items-start gap-4">
                          <div className={clsx('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', isActive ? 'bg-emerald-100' : isExpired ? 'bg-rose-100' : 'bg-amber-100')}>
                            <Zap className={clsx('h-6 w-6', statusMeta.color)} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className={clsx('text-lg font-bold', statusMeta.color)}>
                                {isLifetime ? 'Lifetime License' : 'Subscription License'}
                              </h3>
                              <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold', statusMeta.bg, statusMeta.color)}>
                                <StatusIcon className="h-3 w-3" />
                                {statusMeta.label}
                              </span>
                            </div>
                            <p className={clsx('text-sm mt-0.5', statusMeta.color, 'opacity-80')}>
                              {lic.detail ?? (isLifetime ? 'Your license is permanent and does not expire.' : isActive ? 'Your POPMYC POS subscription is active.' : 'Contact POPMYC support for assistance.')}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => void fetchLicense()}
                          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-muted-200 bg-white px-3 py-1.5 text-xs font-medium text-muted-600 hover:bg-muted-50 transition-colors self-start">
                          <RefreshCw className="h-3.5 w-3.5" /> Refresh
                        </button>
                      </div>

                      {/* Key/value grid */}
                      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { icon: Zap,      label: 'Type',           value: isLifetime ? 'Lifetime' : 'Subscription' },
                          { icon: Calendar, label: 'Active Since',   value: lic.start_date ? new Date(lic.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                          { icon: Calendar, label: 'Expires',        value: isLifetime ? 'Never' : lic.expiry_date ? new Date(lic.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                          { icon: Clock,    label: 'Days Remaining', value: isLifetime ? '∞' : isActive ? String(daysLeft) + ' days' : isExpired ? 'Expired' : '—' },
                        ].map(({ icon: Icon, label, value }) => (
                          <div key={label} className="bg-white/60 rounded-xl px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <Icon className="h-3 w-3 text-muted-400" />
                              <span className="text-[10px] font-semibold text-muted-500 uppercase tracking-wider">{label}</span>
                            </div>
                            <p className={clsx('text-sm font-bold',
                              label === 'Days Remaining' && urgentDays ? 'text-rose-600' :
                              label === 'Days Remaining' && warnDays ? 'text-amber-600' :
                              statusMeta.color
                            )}>{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Expiry urgency banners */}
                      {urgentDays && (
                        <div className="mt-3 flex items-center gap-2 rounded-xl bg-rose-100 border border-rose-300 px-3 py-2">
                          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                          <p className="text-xs font-semibold text-rose-700">
                            Your license expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}. Renew now to avoid interruption.
                          </p>
                        </div>
                      )}
                      {warnDays && (
                        <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-100 border border-amber-300 px-3 py-2">
                          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                          <p className="text-xs font-semibold text-amber-700">
                            Your license expires in {daysLeft} days.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action feedback */}
                    {actionSuccess && (
                      <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                        <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                        <p className="text-sm font-semibold text-emerald-700">{actionSuccess}</p>
                        <button onClick={() => setActionSuccess('')} className="ml-auto text-emerald-500"><X className="h-4 w-4" /></button>
                      </div>
                    )}
                    {actionError && (
                      <div className="flex items-center gap-3 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3">
                        <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
                        <p className="text-sm font-semibold text-rose-700">{actionError}</p>
                        <button onClick={() => setActionError('')} className="ml-auto text-rose-500"><X className="h-4 w-4" /></button>
                      </div>
                    )}

                    {/* Activate section — show when PENDING or NO_LICENSE */}
                    {(isPending || !isActive) && !isExpired && (
                      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                        <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                          <Key className="h-4 w-4 text-muted-500" />
                          <h3 className="text-sm font-bold text-[#1E293B]">Activate License</h3>
                        </div>
                        <div className="p-5 space-y-4">
                          <p className="text-sm text-muted-600">Enter the activation code provided by POPMYC to activate your subscription.</p>
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={activateCode}
                              onChange={(e) => setActivateCode(e.target.value.toUpperCase())}
                              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                              maxLength={29}
                              className="flex-1 h-10 px-3 rounded-xl border border-muted-200 bg-white text-sm font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                            />
                            <button
                              onClick={() => void handleActivate()}
                              disabled={actionSaving || !activateCode.trim()}
                              className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] text-white px-4 py-2 text-sm font-semibold hover:bg-[#334155] transition-colors disabled:opacity-50 shrink-0"
                            >
                              {actionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                              {actionSaving ? 'Activating…' : 'Activate'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Renew section — show when ACTIVE or EXPIRED subscription */}
                    {!isLifetime && (isActive || isExpired) && (
                      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                        <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                          <RefreshCw className="h-4 w-4 text-muted-500" />
                          <h3 className="text-sm font-bold text-[#1E293B]">Renew Subscription</h3>
                          {isExpired && (
                            <span className="ml-auto text-[11px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-0.5">
                              Expired — renewal required
                            </span>
                          )}
                        </div>
                        <div className="p-5 space-y-4">
                          <p className="text-sm text-muted-600">
                            Enter your new renewal code. Your subscription will be extended from{' '}
                            {isExpired ? 'today' : 'your current expiry date'}.
                          </p>
                          <div className="flex gap-3">
                            <input
                              type="text"
                              value={renewCode}
                              onChange={(e) => setRenewCode(e.target.value.toUpperCase())}
                              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                              maxLength={29}
                              className="flex-1 h-10 px-3 rounded-xl border border-muted-200 bg-white text-sm font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10"
                            />
                            <button
                              onClick={() => void handleRenew()}
                              disabled={actionSaving || !renewCode.trim()}
                              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 shrink-0"
                            >
                              {actionSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              {actionSaving ? 'Renewing…' : 'Renew'}
                            </button>
                          </div>
                          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
                            <p className="text-[11px] text-blue-700 leading-relaxed">
                              Renewal codes are single-use. Once used, a new code will be generated for your next renewal.
                              Contact <strong>POPMYC support</strong> to purchase a renewal code.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Renewal history */}
                    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                      <div className="px-5 py-4 border-b border-muted-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <History className="h-4 w-4 text-muted-500" />
                          <h3 className="text-sm font-bold text-[#1E293B]">Renewal History</h3>
                        </div>
                        {logsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-400" />}
                      </div>
                      {renewalLogs.length === 0 ? (
                        <div className="px-5 py-8 text-center text-muted-400">
                          <History className="h-8 w-8 mx-auto mb-2 text-muted-300" />
                          <p className="text-sm font-medium">No renewal history yet</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-muted-50">
                          {renewalLogs.map((log) => (
                            <div key={log.id} className="flex items-start gap-4 px-5 py-3.5">
                              <div className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl mt-0.5', log.action === 'RENEWAL' ? 'bg-emerald-50' : 'bg-blue-50')}>
                                {log.action === 'RENEWAL'
                                  ? <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
                                  : <Zap className="h-3.5 w-3.5 text-blue-600" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-[#1E293B]">
                                    {log.action === 'RENEWAL' ? 'Renewed' : 'Activated'}
                                  </p>
                                  {log.performed_by && (
                                    <span className="text-xs text-muted-400">by {log.performed_by}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-muted-500">
                                  {log.new_expiry && (
                                    <span>
                                      New expiry: <strong className="text-[#1E293B]">
                                        {new Date(log.new_expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      </strong>
                                    </span>
                                  )}
                                  <span>Duration: {log.duration_days} days</span>
                                  <span className="font-mono bg-muted-100 rounded px-1.5 py-0.5 text-[10px]">
                                    Code: {log.code_used.slice(0, 9)}…
                                  </span>
                                </div>
                              </div>
                              <span className="text-[11px] text-muted-400 shrink-0 mt-0.5">
                                {new Date(log.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Support info */}
                    <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1E293B]">
                          <Zap className="h-5 w-5 text-[#00FFAA]" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[#1E293B]">POPMYC Support</p>
                          <p className="text-xs text-muted-500 mt-0.5 leading-relaxed">
                            To purchase a new subscription or renewal code, contact POPMYC support.
                            Activation codes are single-use and tied to your business account.
                          </p>
                          <div className="flex flex-wrap gap-3 mt-3">
                            <a href="mailto:support@popmyc.com"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700">
                              <Mail className="h-3.5 w-3.5" /> support@popmyc.com
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

            </div>
          )}

          {/* ── Backup ── */}
          {activeSection === 'backup' && (
            <BackupSection />
          )}

          {/* ── About & Updates ── */}
          {activeSection === 'about' && (
            <div className="space-y-4">
              {/* App version card */}
              <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                  <Zap className="h-5 w-5 text-muted-400" />
                  <h2 className="text-sm font-bold text-[#1E293B]">About POPMYC POS</h2>
                </div>
                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Application', value: 'POPMYC POS' },
                      { label: 'Version',     value: updater.version && updater.version !== '—' ? `v${updater.version}` : 'v1.0.0' },
                      { label: 'Publisher',   value: 'POPMyC Solutions' },
                      { label: 'Support',     value: '0256251295 / 0598610304' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl bg-muted-50 border border-muted-100 px-4 py-3">
                        <p className="text-[10px] text-muted-400 font-semibold uppercase tracking-widest">{label}</p>
                        <p className="text-sm font-semibold text-[#1E293B] mt-0.5">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Update status card */}
              {updater.isDesktop && (
                <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
                  <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-muted-400" />
                    <h2 className="text-sm font-bold text-[#1E293B]">Application Updates</h2>
                  </div>
                  <div className="p-5 space-y-4">
                    {/* Status row */}
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-muted-50 border border-muted-100">
                      {updater.state === 'checking'    && <Loader2 className="h-5 w-5 text-muted-400 animate-spin shrink-0" />}
                      {updater.state === 'available'   && <CheckCircle className="h-5 w-5 text-blue-500 shrink-0" />}
                      {updater.state === 'downloading' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin shrink-0" />}
                      {updater.state === 'ready'       && <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />}
                      {updater.state === 'no-update'   && <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />}
                      {updater.state === 'error'       && <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />}
                      {updater.state === 'idle'        && <RefreshCw className="h-5 w-5 text-muted-400 shrink-0" />}
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-[#1E293B]">
                          {updater.state === 'checking'    ? 'Checking for updates…'                    :
                           updater.state === 'available'   ? `Update available: v${updater.updateVersion}` :
                           updater.state === 'downloading' ? 'Downloading update…'                      :
                           updater.state === 'ready'       ? `v${updater.updateVersion} ready to install` :
                           updater.state === 'no-update'   ? 'POPMYC POS is up to date'                 :
                           updater.state === 'error'       ? 'Update check failed'                      :
                                                             'Update check not started'}
                        </p>
                        {updater.state === 'downloading' && updater.progress && (
                          <div className="mt-1.5">
                            <div className="h-1.5 bg-muted-200 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full transition-all"
                                   style={{ width: `${Math.round(updater.progress.percent ?? 0)}%` }} />
                            </div>
                            <p className="text-[11px] text-muted-400 mt-1">
                              {Math.round(updater.progress.percent ?? 0)}%
                            </p>
                          </div>
                        )}
                        {updater.state === 'error' && (
                          <p className="text-xs text-muted-500 mt-0.5">This does not affect normal POS operation.</p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2">
                      {(updater.state === 'idle' || updater.state === 'no-update' || updater.state === 'error') && (
                        <button onClick={() => void updater.checkNow()}
                          className="inline-flex items-center gap-2 rounded-xl border border-muted-200 bg-white px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
                          <RefreshCw className="h-4 w-4" /> Check for Updates
                        </button>
                      )}
                      {updater.state === 'available' && (
                        <button onClick={() => void updater.download()}
                          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors"
                          style={{ background: '#00897B' }}>
                          <Download className="h-4 w-4" /> Download Update
                        </button>
                      )}
                      {updater.state === 'ready' && (
                        <button onClick={() => updater.install()}
                          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-colors"
                          style={{ background: '#00897B' }}>
                          <Zap className="h-4 w-4" /> Install & Restart
                        </button>
                      )}
                    </div>

                    <p className="text-[11px] text-muted-400">
                      Updates are downloaded in the background and do not interrupt the POS.
                      Your data is preserved across all updates.
                    </p>
                  </div>
                </div>
              )}

              {!updater.isDesktop && (
                <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 p-5">
                  <p className="text-sm text-muted-500">
                    Automatic updates are available in the POPMYC POS desktop application.
                    In browser mode, updates are applied when the server is upgraded.
                  </p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Backup section component ─────────────────────────────────────────────────
// Full implementation: list, create, validate, restore, export, import, delete

type BackupFile = { filename: string; size_mb: number; created_at: string; size_bytes: number };
type RestoreStep = 'idle' | 'confirm' | 'working' | 'done' | 'failed';

function BackupSection() {
  const [backups, setBackups]       = useState<BackupFile[]>([]);
  const [loading, setLoading]       = useState(false);
  const [creating, setCreating]     = useState(false);
  const [backupDir, setBackupDir]   = useState('');
  const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null);

  // Restore state
  const [restoreFile, setRestoreFile]   = useState<string | null>(null);
  const [restoreStep, setRestoreStep]   = useState<RestoreStep>('idle');
  const [restoreLog, setRestoreLog]     = useState('');

  // Import state
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function fetchBackups() {
    setLoading(true);
    try {
      const res = await api.get<{ backups: BackupFile[]; backup_dir: string }>('/backups/list/');
      setBackups(res.data.backups ?? []);
      setBackupDir(res.data.backup_dir ?? '');
    } catch { /* silently ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { void fetchBackups(); }, []);

  async function handleCreate() {
    setCreating(true); setMsg(null);
    try {
      await api.post('/backups/create/');
      setMsg({ ok: true, text: 'Backup created successfully.' });
      void fetchBackups();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setMsg({ ok: false, text: ae.response?.data?.detail ?? 'Backup failed. Check PostgreSQL is running.' });
    } finally { setCreating(false); }
  }

  async function handleDelete(filename: string) {
    if (!window.confirm(`Delete backup ${filename}?\n\nThis cannot be undone.`)) return;
    try {
      await api.delete(`/backups/file/${filename}/`);
      void fetchBackups();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setMsg({ ok: false, text: ae.response?.data?.detail ?? 'Delete failed.' });
    }
  }

  async function handleExport(filename: string) {
    try {
      const res = await api.post('/backups/export/', { filename }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data as BlobPart]));
      const a   = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      setMsg({ ok: false, text: 'Export failed.' });
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.sql.gz')) {
      setMsg({ ok: false, text: 'Only .sql.gz backup files are accepted.' });
      return;
    }
    setImporting(true); setMsg(null);
    const form = new FormData();
    form.append('backup_file', file);
    try {
      await api.post('/backups/import/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setMsg({ ok: true, text: `Imported ${file.name} successfully.` });
      void fetchBackups();
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { detail?: string } } };
      setMsg({ ok: false, text: ae.response?.data?.detail ?? 'Import failed.' });
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  }

  function startRestore(filename: string) {
    setRestoreFile(filename);
    setRestoreStep('confirm');
    setRestoreLog('');
    setMsg(null);
  }

  async function confirmRestore() {
    if (!restoreFile) return;
    setRestoreStep('working');
    setRestoreLog('Creating safety backup...');
    try {
      const res = await api.post<{
        success: boolean;
        message: string;
        recovery?: string;
        safety_backup?: string;
        action_required?: string;
      }>('/backups/restore/', { filename: restoreFile, confirmed: true }, { timeout: 900000 });

      if (res.data.success) {
        setRestoreStep('done');
        setRestoreLog(`Restored from ${restoreFile}.\nSafety backup: ${res.data.message}`);
        setMsg({ ok: true, text: 'Restore successful. Refreshing...' });
        setTimeout(() => window.location.reload(), 2500);
      } else {
        setRestoreStep('failed');
        setRestoreLog([
          res.data.message,
          res.data.recovery ? `Recovery: ${res.data.recovery}` : '',
          res.data.action_required ?? '',
        ].filter(Boolean).join('\n'));
        setMsg({ ok: false, text: res.data.message });
      }
    } catch (err: unknown) {
      const ae = err as { response?: { data?: { message?: string; detail?: string } } };
      const errMsg = ae.response?.data?.message ?? ae.response?.data?.detail ?? 'Restore failed.';
      setRestoreStep('failed');
      setRestoreLog(errMsg);
      setMsg({ ok: false, text: errMsg });
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-muted-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Database Backup &amp; Restore</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Import */}
            <input ref={importRef} type="file" accept=".sql.gz" className="hidden"
                   onChange={handleImport} />
            <button
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-muted-200 bg-white px-3 py-2 text-xs font-semibold text-muted-600 hover:bg-muted-50 disabled:opacity-50 transition-colors">
              {importing
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</>
                : <><Upload className="h-3.5 w-3.5" /> Import</>}
            </button>
            {/* Create */}
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#1E293B] px-4 py-2 text-xs font-bold text-white hover:bg-[#334155] disabled:opacity-50 transition-colors">
              {creating
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                : <><Save className="h-3.5 w-3.5" /> Create Backup</>}
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Message banner */}
          {msg && (
            <div className={clsx(
              'flex items-center gap-2 rounded-xl px-4 py-3 text-sm',
              msg.ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                     : 'bg-red-50 border border-red-200 text-red-700',
            )}>
              {msg.ok ? <CheckCircle className="h-4 w-4 shrink-0" />
                      : <AlertTriangle className="h-4 w-4 shrink-0" />}
              {msg.text}
            </div>
          )}

          {/* Backup dir info */}
          <div className="flex items-start gap-3 p-4 rounded-xl bg-muted-50 border border-muted-100 text-xs text-muted-600">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-400" />
            <div>
              <p className="font-semibold text-muted-700">Backup location (preserved on updates)</p>
              <p className="mt-0.5 font-mono break-all">{backupDir || '%APPDATA%\\POPMYC POS\\backups\\'}</p>
            </div>
          </div>

          {/* Backup list */}
          {loading ? (
            <div className="flex items-center gap-2 text-muted-400 py-4">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : backups.length === 0 ? (
            <p className="text-sm text-muted-400 py-2">No backups yet. Click <strong>Create Backup</strong> to create your first one.</p>
          ) : (
            <div className="rounded-xl border border-muted-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted-50 border-b border-muted-100">
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-600">Filename</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-600">Size</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-600">Created</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.filename} className="border-b border-muted-50 last:border-0 hover:bg-muted-50/60">
                      <td className="px-4 py-2.5 font-mono text-muted-700 max-w-xs truncate">{b.filename}</td>
                      <td className="px-4 py-2.5 text-right text-muted-600 whitespace-nowrap">{b.size_mb.toFixed(1)} MB</td>
                      <td className="px-4 py-2.5 text-right text-muted-500 whitespace-nowrap">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => handleExport(b.filename)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-muted-600 hover:bg-muted-100 transition-colors"
                            title="Export">
                            <Download className="h-3 w-3" /> Export
                          </button>
                          <button
                            onClick={() => startRestore(b.filename)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
                            title="Restore">
                            <RefreshCw className="h-3 w-3" /> Restore
                          </button>
                          <button
                            onClick={() => handleDelete(b.filename)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete">
                            <X className="h-3 w-3" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Restore confirmation modal ── */}
      {restoreFile && restoreStep !== 'idle' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
             onClick={() => restoreStep === 'confirm' && setRestoreStep('idle')}>
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-muted-200 overflow-hidden"
               onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-muted-100 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
                <RefreshCw className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Restore Database</h3>
                <p className="text-xs text-muted-500">This will replace your current database</p>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4">
              {restoreStep === 'confirm' && (
                <>
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-2">
                    <p className="font-bold flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" /> Warning — this is a destructive operation
                    </p>
                    <p>Restoring will <strong>replace all current data</strong> with the selected backup.</p>
                    <p className="text-xs">Before restoring, a safety backup of your current database will be created automatically.</p>
                  </div>
                  <div className="rounded-xl bg-muted-50 border border-muted-100 px-4 py-3 text-xs text-muted-700">
                    <p className="font-semibold mb-1">Restore flow:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-600">
                      <li>Create safety backup of current database</li>
                      <li>Validate selected backup file</li>
                      <li>Drop and recreate database</li>
                      <li>Load backup data</li>
                      <li>Verify restored database</li>
                    </ol>
                  </div>
                  <p className="text-xs text-muted-500">
                    Selected: <span className="font-mono">{restoreFile}</span>
                  </p>
                  <div className="flex gap-3">
                    <button onClick={() => setRestoreStep('idle')}
                      className="flex-1 h-10 rounded-xl border border-muted-200 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                      Cancel
                    </button>
                    <button onClick={confirmRestore}
                      className="flex-1 h-10 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 transition-colors">
                      Restore Now
                    </button>
                  </div>
                </>
              )}

              {restoreStep === 'working' && (
                <div className="flex flex-col items-center py-6 gap-4">
                  <Loader2 className="h-10 w-10 text-amber-500 animate-spin" />
                  <p className="text-sm font-semibold text-slate-700">Restoring database…</p>
                  <p className="text-xs text-muted-500 text-center">{restoreLog || 'Please wait. Do not close this window.'}</p>
                </div>
              )}

              {restoreStep === 'done' && (
                <div className="flex flex-col items-center py-6 gap-3">
                  <CheckCircle className="h-10 w-10 text-emerald-500" />
                  <p className="text-sm font-bold text-emerald-700">Restore successful!</p>
                  <p className="text-xs text-muted-500 text-center">The page will refresh automatically.</p>
                </div>
              )}

              {restoreStep === 'failed' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-4">
                    <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-bold text-red-700">Restore failed</p>
                      <p className="text-xs text-red-600 mt-1 whitespace-pre-wrap">{restoreLog}</p>
                    </div>
                  </div>
                  <button onClick={() => { setRestoreStep('idle'); setRestoreFile(null); }}
                    className="w-full h-10 rounded-xl border border-muted-200 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
