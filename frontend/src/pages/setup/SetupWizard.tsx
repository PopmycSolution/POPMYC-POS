/**
 * SetupWizard.tsx
 * ===============
 * First-run installation wizard for POPMYC POS Desktop.
 *
 * Flow:
 *   Step 1 — Welcome / DB ready check
 *   Step 2 — Business details
 *   Step 3 — Branch details
 *   Step 4 — Administrator account
 *   Step 5 — License activation
 *   → Setup complete → redirect to /login
 *
 * Design: matches the existing POPMYC POS visual style (dark teal palette,
 * rounded-xl cards, same font + colour variables). Does NOT import or depend
 * on any UI components that require authentication.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Check, ChevronRight, Eye, EyeOff,
  Building2, GitBranch, User, Key, AlertCircle, Loader2,
  Wifi, WifiOff, CheckCircle2, XCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { fetchSetupStatus, runSetup } from '@/services/setup.service';
import type { SetupPayload } from '@/services/setup.service';
import { BUSINESS_CATEGORY_LABELS, type BusinessCategory } from '@/types';

// ── Palette (matches LoginPage) ────────────────────────────────────────────────
const TEAL = '#00897B';

// ── Step definitions ──────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Welcome',   icon: ShoppingCart },
  { id: 2, label: 'Business',  icon: Building2    },
  { id: 3, label: 'Branch',    icon: GitBranch    },
  { id: 4, label: 'Admin',     icon: User         },
  { id: 5, label: 'License',   icon: Key          },
];

type LicenseState = 'idle' | 'activating' | 'success' | 'invalid' | 'expired' | 'network' | 'server';

// ── Helpers ───────────────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string | string[] }) {
  if (!msg) return null;
  const text = Array.isArray(msg) ? msg.join(' ') : msg;
  return (
    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
      <AlertCircle className="h-3 w-3 shrink-0" /> {text}
    </p>
  );
}

function inputCls(error?: string | string[]) {
  return clsx(
    'w-full h-11 px-3.5 rounded-xl border text-sm transition-all',
    'bg-white focus:outline-none focus:ring-2',
    error
      ? 'border-red-300 focus:border-red-500 focus:ring-red-500/20'
      : 'border-slate-200 focus:border-teal-500 focus:ring-teal-500/20',
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep]             = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState('');

  // Step 1 — DB check
  const [dbReady, setDbReady]       = useState<boolean | null>(null);

  // Step 2 — Business
  const [bizName, setBizName]           = useState('');
  const [bizCategory, setBizCategory]   = useState<BusinessCategory>('GENERAL_RETAIL');
  const [bizAddress, setBizAddress]     = useState('');
  const [bizPhone, setBizPhone]         = useState('');
  const [bizEmail, setBizEmail]         = useState('');
  const [bizCurrency, setBizCurrency]   = useState('GHS');
  const [bizCurrSymbol, setBizCurrSymbol] = useState('GH₵');

  // Step 3 — Branch
  const [branchName, setBranchName] = useState('Main Branch');
  const [branchCode, setBranchCode] = useState('MAIN');

  // Step 4 — Admin
  const [adminFirst, setAdminFirst]   = useState('');
  const [adminLast, setAdminLast]     = useState('');
  const [adminEmail, setAdminEmail]   = useState('');
  const [adminUser, setAdminUser]     = useState('admin');
  const [adminPass, setAdminPass]     = useState('');
  const [adminPass2, setAdminPass2]   = useState('');
  const [showPass, setShowPass]       = useState(false);

  // Step 5 — License
  const [licCode, setLicCode]         = useState('');
  const [licState, setLicState]       = useState<LicenseState>('idle');
  const [licMessage, setLicMessage]   = useState('');

  // Per-field server errors (returned from /setup/run/)
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});

  // ── Step 1: verify DB on mount ─────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    fetchSetupStatus()
      .then((s) => {
        if (!alive) return;
        // If setup is already done, skip the wizard
        if (s.setup_complete) { navigate('/login', { replace: true }); return; }
        setDbReady(true);
      })
      .catch(() => { if (alive) setDbReady(false); });
    return () => { alive = false; };
  }, [navigate]);

  // ── Step navigation helpers ───────────────────────────────────────────────

  function nextStep() {
    setGlobalError('');
    setFieldErrors({});
    setStep((s) => s + 1);
  }

  // ── Inline validation before advancing ────────────────────────────────────

  function validateStep2() {
    if (!bizName.trim()) { setGlobalError('Business name is required.'); return false; }
    return true;
  }

  function validateStep3() {
    if (!branchName.trim()) { setGlobalError('Branch name is required.'); return false; }
    if (!branchCode.trim()) { setGlobalError('Branch code is required.'); return false; }
    return true;
  }

  function validateStep4() {
    if (!adminFirst.trim() || !adminLast.trim()) {
      setGlobalError('First and last name are required.'); return false;
    }
    if (!adminEmail.trim()) { setGlobalError('Email address is required.'); return false; }
    if (!adminUser.trim())  { setGlobalError('Username is required.'); return false; }
    if (adminPass.length < 8) { setGlobalError('Password must be at least 8 characters.'); return false; }
    if (adminPass !== adminPass2) { setGlobalError('Passwords do not match.'); return false; }
    return true;
  }

  // ── Final submit (step 5) ─────────────────────────────────────────────────

  async function handleActivate() {
    if (!licCode.trim()) { setLicState('invalid'); setLicMessage('Please enter your license key.'); return; }
    setLicState('activating');
    setLicMessage('');
    setSubmitting(true);

    const payload: SetupPayload = {
      business: {
        name: bizName.trim(),
        business_category: bizCategory,
        address: bizAddress.trim(),
        phone: bizPhone.trim(),
        email: bizEmail.trim(),
        currency: bizCurrency.trim() || 'GHS',
        currency_symbol: bizCurrSymbol.trim() || 'GH₵',
      },
      branch: {
        name: branchName.trim(),
        code: branchCode.trim().toUpperCase(),
      },
      admin: {
        first_name: adminFirst.trim(),
        last_name:  adminLast.trim(),
        email:      adminEmail.trim(),
        username:   adminUser.trim(),
        password:   adminPass,
      },
      license: {
        activation_code: licCode.trim().toUpperCase(),
      },
    };

    const result = await runSetup(payload);
    setSubmitting(false);

    if (result.success) {
      setLicState('success');
      setLicMessage('License activated! Redirecting to login…');
      setTimeout(() => navigate('/login', { replace: true }), 2200);
      return;
    }

    // Map server errors to UI states
    if (result.errors) {
      // Build flat fieldErrors map for the form
      const flat: Record<string, Record<string, string>> = {};
      for (const [section, errs] of Object.entries(result.errors)) {
        flat[section] = {};
        for (const [field, msg] of Object.entries(errs)) {
          flat[section][field] = Array.isArray(msg) ? msg.join(' ') : String(msg);
        }
      }
      setFieldErrors(flat);

      // If the error is specifically about the license code, stay on step 5
      if (result.errors.license?.activation_code) {
        const msg = flat.license.activation_code.toLowerCase();
        if (msg.includes('expired')) { setLicState('expired'); }
        else if (msg.includes('invalid') || msg.includes('not found')) { setLicState('invalid'); }
        else { setLicState('server'); }
        setLicMessage(flat.license.activation_code);
      } else {
        // Errors in earlier steps — go back to that step
        if (result.errors.admin)     { setStep(4); setLicState('idle'); }
        else if (result.errors.branch)   { setStep(3); setLicState('idle'); }
        else if (result.errors.business) { setStep(2); setLicState('idle'); }
      }
      return;
    }

    // Generic / network errors
    const errMsg = (result.error ?? '').toLowerCase();
    if (errMsg.includes('network') || errMsg.includes('unavailable')) {
      setLicState('network');
      setLicMessage('Cannot reach the server. Check your connection and try again.');
    } else if (errMsg.includes('already complete')) {
      setLicState('success');
      setLicMessage('Setup is already complete. Redirecting…');
      setTimeout(() => navigate('/login', { replace: true }), 1500);
    } else {
      setLicState('server');
      setLicMessage(result.error ?? 'An unexpected error occurred. Please try again.');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex" style={{ background: '#f0faf8' }}>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex lg:w-[42%] flex-col items-center justify-center px-10 py-12"
        style={{ background: 'linear-gradient(160deg, #004D40 0%, #00897B 100%)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
               style={{ background: 'rgba(255,255,255,0.15)', border: '2px solid rgba(255,255,255,0.25)' }}>
            <ShoppingCart className="text-white" style={{ width: 24, height: 24 }} />
          </div>
          <div>
            <p className="text-xl font-extrabold text-white tracking-wide leading-tight">POPMYC POS</p>
            <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.55)' }}>Smart Retail. Better Business.</p>
          </div>
        </div>

        <h2 className="text-3xl font-extrabold text-white text-center leading-tight mb-3">
          Welcome to<br />POPMYC POS
        </h2>
        <p className="text-center text-sm mb-10" style={{ color: 'rgba(255,255,255,0.75)', maxWidth: 280 }}>
          Let's get your business up and running. This only takes a few minutes.
        </p>

        {/* Step tracker */}
        <div className="flex flex-col gap-3 w-full max-w-[240px]">
          {STEPS.map(({ id, label, icon: Icon }) => {
            const done    = step > id;
            const current = step === id;
            return (
              <div key={id} className="flex items-center gap-3">
                <div className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all',
                  done    ? 'bg-[#4ECCA3]'                         :
                  current ? 'bg-white'                              :
                            'border border-white/30 bg-transparent',
                )}>
                  {done
                    ? <Check className="h-4 w-4 text-[#004D40]" />
                    : <Icon className={clsx('h-4 w-4', current ? 'text-[#004D40]' : 'text-white/50')} />
                  }
                </div>
                <span className={clsx(
                  'text-sm font-semibold',
                  done    ? 'text-[#4ECCA3]' :
                  current ? 'text-white'      :
                            'text-white/40',
                )}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 overflow-y-auto">
        <div
          className="w-full max-w-[480px] rounded-2xl bg-white shadow-xl border px-8 py-8"
          style={{ borderColor: '#e8f5f2' }}
        >

          {/* ── STEP 1: Welcome + DB check ── */}
          {step === 1 && (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5"
                   style={{ background: '#e0f2ee' }}>
                <ShoppingCart style={{ width: 32, height: 32, color: TEAL }} />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 mb-2">Set up POPMYC POS</h1>
              <p className="text-sm text-slate-500 mb-8 max-w-[340px]">
                We'll guide you through configuring your business, creating your admin account,
                and activating your license.
              </p>

              {/* DB status */}
              <div className={clsx(
                'flex items-center gap-3 w-full rounded-xl px-4 py-3 mb-6',
                dbReady === null ? 'bg-slate-50 border border-slate-200' :
                dbReady         ? 'bg-emerald-50 border border-emerald-200' :
                                  'bg-red-50 border border-red-200',
              )}>
                {dbReady === null && <Loader2 className="h-5 w-5 text-slate-400 animate-spin shrink-0" />}
                {dbReady === true  && <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />}
                {dbReady === false && <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
                <div className="text-left">
                  <p className={clsx(
                    'text-sm font-semibold',
                    dbReady === null ? 'text-slate-600' :
                    dbReady         ? 'text-emerald-700' :
                                      'text-red-700',
                  )}>
                    {dbReady === null ? 'Checking database…' :
                     dbReady         ? 'Database connected' :
                                       'Cannot reach database'}
                  </p>
                  {dbReady === false && (
                    <p className="text-xs text-red-600 mt-0.5">
                      Ensure PostgreSQL is running, then&nbsp;
                      <button
                        type="button"
                        className="underline font-medium"
                        onClick={() => { setDbReady(null); fetchSetupStatus().then(() => setDbReady(true)).catch(() => setDbReady(false)); }}
                      >retry</button>.
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={!dbReady}
                onClick={nextStep}
                className="w-full h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: TEAL }}
              >
                Get Started <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── STEP 2: Business details ── */}
          {step === 2 && (
            <div>
              <StepHeader icon={<Building2 style={{ width: 28, height: 28, color: TEAL }} />}
                title="Business Details" subtitle="Tell us about your business" />
              {globalError && <ErrorBanner msg={globalError} />}

              <div className="space-y-4">
                <div>
                  <label className="label">Business Name <Req /></label>
                  <input className={inputCls(fieldErrors.business?.name)} value={bizName}
                         onChange={e => setBizName(e.target.value)} placeholder="e.g. Kofi Stores Ltd" />
                  <FieldError msg={fieldErrors.business?.name} />
                </div>

                <div>
                  <label className="label">Business Type</label>
                  <select className={inputCls()} value={bizCategory}
                          onChange={e => setBizCategory(e.target.value as BusinessCategory)}>
                    {Object.entries(BUSINESS_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Phone</label>
                    <input className={inputCls()} value={bizPhone}
                           onChange={e => setBizPhone(e.target.value)} placeholder="+233 24 123 4567" />
                  </div>
                  <div>
                    <label className="label">Email</label>
                    <input className={inputCls()} type="email" value={bizEmail}
                           onChange={e => setBizEmail(e.target.value)} placeholder="info@business.com" />
                  </div>
                </div>

                <div>
                  <label className="label">Address</label>
                  <input className={inputCls()} value={bizAddress}
                         onChange={e => setBizAddress(e.target.value)} placeholder="123 Main Street, Accra" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Currency Code</label>
                    <input className={inputCls()} value={bizCurrency}
                           onChange={e => setBizCurrency(e.target.value)} placeholder="GHS" maxLength={10} />
                  </div>
                  <div>
                    <label className="label">Symbol</label>
                    <input className={inputCls()} value={bizCurrSymbol}
                           onChange={e => setBizCurrSymbol(e.target.value)} placeholder="GH₵" maxLength={5} />
                  </div>
                </div>
              </div>

              <StepActions onBack={() => setStep(1)}
                onNext={() => { if (validateStep2()) nextStep(); }} />
            </div>
          )}

          {/* ── STEP 3: Branch ── */}
          {step === 3 && (
            <div>
              <StepHeader icon={<GitBranch style={{ width: 28, height: 28, color: TEAL }} />}
                title="Main Branch" subtitle="Your primary business location" />
              {globalError && <ErrorBanner msg={globalError} />}

              <div className="space-y-4">
                <div>
                  <label className="label">Branch Name <Req /></label>
                  <input className={inputCls(fieldErrors.branch?.name)} value={branchName}
                         onChange={e => setBranchName(e.target.value)} placeholder="e.g. Head Office" />
                  <FieldError msg={fieldErrors.branch?.name} />
                </div>
                <div>
                  <label className="label">Branch Code <Req /></label>
                  <input className={inputCls(fieldErrors.branch?.code)} value={branchCode}
                         onChange={e => setBranchCode(e.target.value.toUpperCase())}
                         placeholder="e.g. MAIN" maxLength={10} />
                  <FieldError msg={fieldErrors.branch?.code} />
                  <p className="mt-1 text-[11px] text-slate-400">Short unique identifier, e.g. HQ, MAIN, ACCRA1</p>
                </div>
              </div>

              <StepActions onBack={() => setStep(2)}
                onNext={() => { if (validateStep3()) nextStep(); }} />
            </div>
          )}

          {/* ── STEP 4: Admin account ── */}
          {step === 4 && (
            <div>
              <StepHeader icon={<User style={{ width: 28, height: 28, color: TEAL }} />}
                title="Administrator Account" subtitle="This will be your main login" />
              {globalError && <ErrorBanner msg={globalError} />}

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">First Name <Req /></label>
                    <input className={inputCls(fieldErrors.admin?.first_name)} value={adminFirst}
                           onChange={e => setAdminFirst(e.target.value)} placeholder="Kofi" />
                    <FieldError msg={fieldErrors.admin?.first_name} />
                  </div>
                  <div>
                    <label className="label">Last Name <Req /></label>
                    <input className={inputCls(fieldErrors.admin?.last_name)} value={adminLast}
                           onChange={e => setAdminLast(e.target.value)} placeholder="Mensah" />
                    <FieldError msg={fieldErrors.admin?.last_name} />
                  </div>
                </div>

                <div>
                  <label className="label">Email <Req /></label>
                  <input className={inputCls(fieldErrors.admin?.email)} type="email" value={adminEmail}
                         onChange={e => setAdminEmail(e.target.value)} placeholder="kofi@example.com" />
                  <FieldError msg={fieldErrors.admin?.email} />
                </div>

                <div>
                  <label className="label">Username <Req /></label>
                  <input className={inputCls(fieldErrors.admin?.username)} value={adminUser}
                         onChange={e => setAdminUser(e.target.value.toLowerCase().replace(/\s/g, ''))}
                         placeholder="admin" autoComplete="username" />
                  <FieldError msg={fieldErrors.admin?.username} />
                </div>

                <div>
                  <label className="label">Password <Req /></label>
                  <div className="relative">
                    <input
                      className={inputCls(fieldErrors.admin?.password)}
                      type={showPass ? 'text' : 'password'}
                      value={adminPass}
                      onChange={e => setAdminPass(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                    />
                    <button type="button" onClick={() => setShowPass(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <FieldError msg={fieldErrors.admin?.password} />
                </div>

                <div>
                  <label className="label">Confirm Password <Req /></label>
                  <input
                    className={inputCls(adminPass2 && adminPass !== adminPass2 ? 'mismatch' : undefined)}
                    type={showPass ? 'text' : 'password'}
                    value={adminPass2}
                    onChange={e => setAdminPass2(e.target.value)}
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                  />
                  {adminPass2 && adminPass !== adminPass2 && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" /> Passwords do not match
                    </p>
                  )}
                </div>
              </div>

              <StepActions onBack={() => setStep(3)}
                onNext={() => { if (validateStep4()) nextStep(); }} />
            </div>
          )}

          {/* ── STEP 5: License activation ── */}
          {step === 5 && (
            <div>
              <StepHeader icon={<Key style={{ width: 28, height: 28, color: TEAL }} />}
                title="License Activation"
                subtitle="Enter the activation code provided by POPMYC" />

              {/* License key input */}
              <div className="mb-5">
                <label className="label">License Key <Req /></label>
                <input
                  className={clsx(
                    inputCls(licState === 'invalid' || licState === 'expired' || licState === 'server' ? 'err' : undefined),
                    'font-mono tracking-widest text-center text-sm uppercase',
                  )}
                  value={licCode}
                  onChange={e => {
                    setLicCode(e.target.value.toUpperCase());
                    setLicState('idle');
                    setLicMessage('');
                  }}
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                  maxLength={30}
                  disabled={licState === 'activating' || licState === 'success'}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Contact POPMYC support if you don't have a license key.
                </p>
              </div>

              {/* Status feedback */}
              {licState !== 'idle' && (
                <div className={clsx(
                  'flex items-start gap-3 rounded-xl px-4 py-3 mb-5 text-sm',
                  licState === 'activating' ? 'bg-slate-50 border border-slate-200'                 :
                  licState === 'success'    ? 'bg-emerald-50 border border-emerald-200'              :
                  licState === 'network'    ? 'bg-amber-50 border border-amber-200'                  :
                                             'bg-red-50 border border-red-200',
                )}>
                  {licState === 'activating' && <Loader2 className="h-5 w-5 text-slate-400 animate-spin shrink-0 mt-0.5" />}
                  {licState === 'success'    && <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />}
                  {licState === 'network'    && <WifiOff className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />}
                  {(licState === 'invalid' || licState === 'expired' || licState === 'server') &&
                    <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />}

                  <div>
                    <p className={clsx(
                      'font-semibold',
                      licState === 'activating' ? 'text-slate-700'    :
                      licState === 'success'    ? 'text-emerald-700'  :
                      licState === 'network'    ? 'text-amber-700'    :
                                                 'text-red-700',
                    )}>
                      {licState === 'activating' ? 'Activating license…'         :
                       licState === 'success'    ? 'License activated!'           :
                       licState === 'invalid'    ? 'Invalid license key'          :
                       licState === 'expired'    ? 'License has expired'          :
                       licState === 'network'    ? 'Network unavailable'          :
                                                  'Activation failed'}
                    </p>
                    {licMessage && (
                      <p className={clsx(
                        'text-xs mt-0.5',
                        licState === 'activating' ? 'text-slate-500'  :
                        licState === 'success'    ? 'text-emerald-600':
                        licState === 'network'    ? 'text-amber-600'  :
                                                   'text-red-600',
                      )}>
                        {licMessage}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Activate button */}
              <button
                type="button"
                disabled={submitting || licState === 'success'}
                onClick={handleActivate}
                className="w-full h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-3"
                style={{ background: TEAL }}
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Activating…</>
                  : <><Key className="h-4 w-4" /> Activate License</>
                }
              </button>

              {/* Offline notice */}
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] text-slate-500">
                <Wifi className="h-4 w-4 shrink-0 text-slate-400" />
                <span>
                  Internet is required for initial activation.
                  Once activated, POPMYC POS works fully offline.
                </span>
              </div>

              <button type="button" onClick={() => setStep(4)}
                className="mt-3 w-full h-9 rounded-xl text-xs font-semibold text-slate-500 hover:bg-slate-100 transition-colors">
                ← Back
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-6 text-[11px] text-slate-400">
          © 2025 POPMyC Solutions · <a href="mailto:popmycsolution@gmail.com" className="underline">Support</a>
        </p>
      </div>

      {/* Inline styles for label class */}
      <style>{`
        .label { display: block; font-size: 0.8125rem; font-weight: 600; color: #475569; margin-bottom: 6px; }
      `}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepHeader({
  icon, title, subtitle,
}: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
           style={{ background: '#e0f2ee' }}>
        {icon}
      </div>
      <div>
        <h2 className="text-xl font-bold text-slate-800 leading-tight">{title}</h2>
        <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function StepActions({
  onBack, onNext, nextLabel = 'Continue',
}: { onBack: () => void; onNext: () => void; nextLabel?: string }) {
  return (
    <div className="flex gap-3 mt-7">
      <button type="button" onClick={onBack}
        className="flex-1 h-11 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
        Back
      </button>
      <button type="button" onClick={onNext}
        className="flex-1 h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all"
        style={{ background: '#00897B' }}>
        {nextLabel} <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 mb-4">
      <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
      <p className="text-xs font-medium text-red-700">{msg}</p>
    </div>
  );
}

function Req() {
  return <span className="text-red-500 ml-0.5">*</span>;
}
