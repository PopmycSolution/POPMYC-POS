import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, Lock, Eye, EyeOff,
  ShoppingCart, Package, Users, BarChart3, Shield, Wifi,
  ArrowRight, Info, Phone, X, CheckCircle, KeyRound, Loader2, RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuthStore } from '@/stores/auth.store';
import { useUserStore } from '@/stores/user.store';
import * as authService from '@/services/auth.service';
import api from '@/services/api';
import type { User } from '@/types';
import { isValidRole } from '@/utils/permissions';

// ─── Brand colours ────────────────────────────────────────────────────────────
const TEAL      = '#00897B';
const DARK_TEAL = '#004D40';

// ─── Feature strip data ───────────────────────────────────────────────────────
const FEATURES = [
  { icon: ShoppingCart, label: 'Sales &\nBilling'      },
  { icon: Package,      label: 'Inventory\nManagement' },
  { icon: Users,        label: 'Customer\nManagement'  },
  { icon: BarChart3,    label: 'Reports &\nAnalytics'  },
  { icon: Shield,       label: 'Secure &\nReliable'    },
  { icon: Wifi,         label: 'Offline\nSupport'      },
];

// ─────────────────────────────────────────────────────────────────────────────
// License Renewal Modal — shown when license is expired after login attempt
// ─────────────────────────────────────────────────────────────────────────────
interface LicenseRenewalModalProps {
  onSuccess: () => void;
}

function LicenseRenewalModal({ onSuccess }: LicenseRenewalModalProps) {
  const [code,     setCode]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState(false);

  async function handleRenew(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError('Please enter your license code.'); return; }

    setLoading(true);
    setError('');
    try {
      // Try renew first, fall back to activate
      let res;
      try {
        res = await api.post('/licensing/licenses/renew/', { activation_code: trimmed });
      } catch {
        res = await api.post('/licensing/licenses/activate/', { activation_code: trimmed });
      }
      if (res.data) {
        setSuccess(true);
        setTimeout(() => onSuccess(), 1500);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string; non_field_errors?: string[] } } };
      setError(
        e.response?.data?.detail ??
        e.response?.data?.non_field_errors?.[0] ??
        'Invalid code. Please check and try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="w-full max-w-[400px] rounded-3xl overflow-hidden shadow-2xl animate-about-in"
        style={{ background: '#1a1a2e' }}
      >
        {/* Icon area */}
        <div className="flex flex-col items-center pt-10 pb-6 px-8">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl mb-6"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.12)' }}
          >
            {success
              ? <CheckCircle className="h-10 w-10 text-emerald-400" />
              : <KeyRound className="h-10 w-10" style={{ color: '#4ECCA3' }} />}
          </div>

          <h2 className="text-2xl font-bold text-white text-center mb-2">
            {success ? 'License Renewed!' : 'License Expired'}
          </h2>
          <p className="text-sm text-center leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
            {success
              ? 'Your license has been activated. Redirecting you in…'
              : 'Your POPMYC POS license has expired. Enter your renewal code below to continue using the app.'}
          </p>
        </div>

        {/* Form */}
        {!success && (
          <form onSubmit={handleRenew} className="px-8 pb-10 space-y-4">
            {/* Code input */}
            <div>
              <input
                type="text"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                className="w-full h-14 px-4 rounded-2xl text-sm font-mono text-center tracking-widest text-white placeholder:tracking-normal placeholder:font-sans outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: error ? '1.5px solid #f87171' : '1.5px solid rgba(255,255,255,0.12)',
                  caretColor: '#4ECCA3',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#4ECCA3'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = error ? '#f87171' : 'rgba(255,255,255,0.12)'; }}
                autoFocus
                disabled={loading}
              />
              {error && (
                <p className="mt-2 text-xs text-center text-red-400">{error}</p>
              )}
            </div>

            {/* Activate button */}
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl font-bold text-sm transition-all disabled:opacity-50"
              style={{ background: loading ? '#00695C' : '#00897B', color: '#fff' }}
            >
              {loading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Activating…</>
                : <><RefreshCw className="h-4 w-4" /> Activate License</>}
            </button>

            {/* Contact note */}
            <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Need a renewal code?{' '}
              <a
                href="tel:0256251295"
                className="underline underline-offset-2"
                style={{ color: '#4ECCA3' }}
              >
                Call 0256251295
              </a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function LoginPage() {
  const navigate                               = useNavigate();
  const { setAuth, loginWithLocalCredentials } = useAuthStore();
  const users                                  = useUserStore((s) => s.users);

  const [mounted,     setMounted]     = useState(false);
  const [showAbout,   setShowAbout]   = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  // ── form state ──
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [showPwd,    setShowPwd]    = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [signingIn,  setSigningIn]  = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showRenew,  setShowRenew]  = useState(false);

  // ── submit: try local users first, fall back to server ──
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const id  = email.trim().toLowerCase();
    const pwd = password;

    if (!id)  { setError('Please enter your email or username.'); return; }
    if (!pwd) { setError('Please enter your password.');          return; }

    // ── 1. local match (offline users only) ──────────────────────────────────
    // Only use the local store for a user that has a PLAIN-TEXT matching
    // password stored.  If the stored password is empty or doesn't match
    // the plaintext input, fall through to the server — never block.
    const match = users.find(
      (u) => (u.email.toLowerCase() === id || u.username.toLowerCase() === id) && u.isActive,
    );
    if (match) {
      const storedPwd = match.password ?? '';
      if (storedPwd && storedPwd === pwd) {
        // Exact plain-text match in local store — allow offline login
        setSigningIn(true);
        const safeRole = isValidRole(match.role) ? match.role : 'CASHIER';
        loginWithLocalCredentials({
          id: match.id, email: match.email,
          firstName: match.firstName, lastName: match.lastName,
          phoneNumber: match.phone, role: safeRole,
          branch: match.branch || null,
        });
        setTimeout(() => { setSigningIn(false); navigate('/dashboard', { replace: true }); }, 500);
        return;
      }
      // Stored password absent or doesn't match plaintext → fall through to server
    }

    // ── 2. server login ───────────────────────────────────────────────────────
    setSigningIn(true);
    try {
      const res = await authService.login({ email: id, password: pwd, rememberMe });
      if (res?.access && res?.refresh && res?.user) {
        const rawRole  = String(res.user.role ?? '').toUpperCase();
        const safeRole = isValidRole(rawRole) ? rawRole : 'CASHIER';
        const rawUser  = res.user as User & { profile_picture_url?: string | null };
        const u: User  = {
          ...rawUser,
          role: safeRole,
          avatarUrl: rawUser.avatarUrl ?? rawUser.profile_picture_url ?? null,
        };
        authService.setTokens({ access: res.access, refresh: res.refresh });
        authService.setUser(u);
        setAuth({ user: u, accessToken: res.access, refreshToken: res.refresh });

        // Check license status before navigating — show renewal modal if expired
        try {
          const licRes = await api.get<{ status?: string; license_type?: string }>(
            '/licensing/licenses/status/',
            { headers: { Authorization: `Bearer ${res.access}` } }
          );
          const licStatus = licRes.data?.status ?? '';
          const licType   = licRes.data?.license_type ?? '';
          if (licStatus === 'EXPIRED' && licType !== 'LIFETIME') {
            setShowRenew(true);
            setSigningIn(false);
            return;
          }
        } catch {
          // License check failed — let them through, middleware will block if needed
        }

        navigate('/dashboard', { replace: true });
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } catch (err: unknown) {
      // Extract the actual error message from the backend response
      const axiosErr = err as {
        response?: {
          status?: number;
          data?: {
            non_field_errors?: string[];
            detail?: string;
            email?: string[];
            password?: string[];
          };
        };
        message?: string;
      };

      const status = axiosErr.response?.status;
      const data   = axiosErr.response?.data;

      if (data) {
        // Backend validation error — show the first meaningful message
        const msg =
          data.non_field_errors?.[0] ??
          data.detail ??
          data.email?.[0] ??
          data.password?.[0] ??
          'Invalid credentials. Please try again.';
        setError(msg);
      } else if (status === 0 || !axiosErr.response) {
        // Network error — no response received
        setError('Cannot reach the server. Check your connection and try again.');
      } else {
        setError('Login failed. Please check your credentials.');
      }
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="min-h-screen flex overflow-hidden" style={{ background: '#f0faf8' }}>

      {/* License renewal modal — blocks entry when license expired */}
      {showRenew && (
        <LicenseRenewalModal
          onSuccess={() => {
            setShowRenew(false);
            navigate('/dashboard', { replace: true });
          }}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════
          LEFT PANEL — General.png background, text top, image bottom
          ══════════════════════════════════════════════════════════════ */}
      <div
        className={clsx(
          'relative hidden lg:flex lg:w-[52%] xl:w-[54%] flex-col overflow-hidden',
          'transition-opacity duration-700',
          mounted ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: '#0a5c4a' }}
      >
        {/* ── Full-cover background photo (vivid, no tint) ── */}
        <img
          src="/General.png"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover object-center"
        />

        {/* ── Top gradient: dark at top so text is readable, fades to transparent mid-way ── */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(to bottom, rgba(4,44,32,0.88) 0%, rgba(4,44,32,0.60) 28%, rgba(4,44,32,0.10) 55%, transparent 75%)',
          }}
        />

        {/* ── Bottom gradient: dark strip for feature bar ── */}
        <div
          className="absolute bottom-0 left-0 right-0 pointer-events-none"
          style={{ height: '80px', background: 'rgba(0,0,0,0.50)' }}
        />

        {/* ── Top bar ── */}
        <div className="relative z-10 flex items-center justify-between px-8 pt-7 pb-2 shrink-0">
          {/* Cart logo — click opens About Us */}
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            className="flex items-center gap-3 group lp-anim"
            style={{ animationDelay: '0.05s' }}
            aria-label="About POPMyC POS"
          >
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl transition-colors group-hover:bg-white/25"
              style={{ background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.30)' }}
            >
              <ShoppingCart className="text-white" style={{ width: 20, height: 20 }} />
            </div>
            <div className="text-left">
              <p className="text-[15px] font-extrabold text-white leading-tight tracking-wide">POPMYC POS</p>
              <p className="text-[10px] leading-none" style={{ color: 'rgba(255,255,255,0.60)' }}>Smart Retail. Better Business.</p>
            </div>
          </button>

          {/* Offline Ready pill */}
          <span
            className="flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-semibold lp-anim"
            style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', animationDelay: '0.15s' }}
          >
            <Wifi style={{ width: 12, height: 12 }} /> Offline Ready
          </span>
        </div>

        {/* ── Hero text — top-left, just below top bar ── */}
        <div className="relative z-10 px-8 pt-5 pb-4 shrink-0">
          <h1
            className="text-[2.6rem] xl:text-5xl font-extrabold text-white leading-tight tracking-tight lp-anim"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.40)', animationDelay: '0.28s' }}
          >
            Simplify Your
          </h1>
          <h1
            className="text-[2.6rem] xl:text-5xl font-extrabold leading-tight tracking-tight lp-anim"
            style={{ color: '#4ECCA3', textShadow: '0 2px 8px rgba(0,0,0,0.35)', animationDelay: '0.40s' }}
          >
            Retail Business
          </h1>
          <p
            className="mt-3 text-[14px] font-semibold lp-anim"
            style={{ color: 'rgba(255,255,255,0.90)', textShadow: '0 1px 6px rgba(0,0,0,0.40)', animationDelay: '0.52s' }}
          >
            Fast &nbsp;•&nbsp; Reliable &nbsp;•&nbsp; Secure
          </p>
          <p
            className="mt-2 text-[13px] max-w-[300px] leading-relaxed lp-anim"
            style={{ color: 'rgba(255,255,255,0.72)', textShadow: '0 1px 4px rgba(0,0,0,0.40)', animationDelay: '0.62s' }}
          >
            Manage your sales, inventory, customers<br />
            and reports — all in one powerful POS system.
          </p>
        </div>

        {/* ── Spacer — image shows through here (the vivid store scene) ── */}
        <div className="flex-1" />

        {/* ── Wave divider before feature strip ── */}
        <div className="relative z-10 shrink-0 -mb-1" style={{ lineHeight: 0 }}>
          <svg viewBox="0 0 600 28" preserveAspectRatio="none" className="w-full" style={{ height: 28 }}>
            <path
              d="M0,16 C100,28 200,4 300,16 C400,28 500,4 600,16 L600,28 L0,28 Z"
              fill="rgba(0,0,0,0.30)"
            />
          </svg>
        </div>

        {/* ── Feature strip ── */}
        <div
          className="relative z-10 shrink-0 grid grid-cols-6"
          style={{ background: 'rgba(0,0,0,0.42)' }}
        >
          {FEATURES.map(({ icon: Icon, label }, i) => (
            <div
              key={i}
              className={clsx(
                'flex flex-col items-center justify-center gap-2 py-4 px-1 text-center lp-anim',
                i < 5 && 'border-r border-white/10',
              )}
              style={{ animationDelay: `${0.70 + i * 0.07}s` }}
            >
              <Icon style={{ width: 22, height: 22, color: '#4ECCA3' }} />
              <p className="text-[10px] font-semibold text-white/80 leading-tight whitespace-pre-line">
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          RIGHT PANEL — white, login form
          ══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col relative bg-white overflow-y-auto">

        {/* Decorative circle — top right */}
        <div
          className="absolute top-0 right-0 w-36 h-36 rounded-full pointer-events-none"
          style={{ border: '32px solid', borderColor: '#e6f7f4', transform: 'translate(45%, -45%)' }}
        />
        {/* Decorative circle — bottom right */}
        <div
          className="absolute bottom-0 right-0 w-44 h-44 rounded-full pointer-events-none"
          style={{ border: '36px solid', borderColor: '#e6f7f4', transform: 'translate(45%, 45%)' }}
        />

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-end px-8 pt-6 pb-2 shrink-0">
          <p className="text-sm text-slate-500">
            Don't have an account?{' '}
            <button
              type="button"
              onClick={() => setShowForgot((v) => !v)}
              className="font-semibold underline-offset-2 hover:underline transition-colors"
              style={{ color: TEAL }}
            >
              Contact Admin
            </button>
          </p>
        </div>

        {/* ── Centered card ── */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-8 pb-8 pt-2">
          <div
            className={clsx(
              'w-full max-w-[420px] rounded-2xl bg-white px-8 py-8 shadow-xl transition-all duration-700',
              mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6',
            )}
            style={{ border: '1px solid #e8f5f2' }}
          >
            {/* Card logo — also opens About Us */}
            <button
              type="button"
              onClick={() => setShowAbout(true)}
              className="flex items-center gap-2.5 mb-6 group rp-anim"
              style={{ animationDelay: '0.10s' }}
              aria-label="About POPMyC POS"
            >
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl transition-opacity group-hover:opacity-80"
                style={{ background: TEAL }}
              >
                <ShoppingCart className="text-white" style={{ width: 18, height: 18 }} />
              </div>
              <span className="text-lg font-bold" style={{ color: DARK_TEAL }}>POPMYC POS</span>
            </button>

            <h2 className="text-2xl font-bold text-slate-800 rp-anim" style={{ animationDelay: '0.22s' }}>
              Welcome Back <span>👋</span>
            </h2>
            <p className="mt-1 text-sm text-slate-500 mb-6 rp-anim" style={{ animationDelay: '0.32s' }}>
              Sign in to your POPMYC POS account to continue
            </p>

            {/* ── Error banner ── */}
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 animate-fade-in">
                <X className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs font-medium text-red-700">{error}</p>
              </div>
            )}

            {/* ── Login form ── */}
            <form onSubmit={handleLogin} className="space-y-4">

              {/* Email */}
              <div className="rp-anim" style={{ animationDelay: '0.42s' }}>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Username or Email
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ width: 16, height: 16, color: '#94a3b8' }}
                  />
                  <input
                    type="text"
                    placeholder="username or email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    className="w-full h-12 pl-10 pr-4 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all"
                    style={{ '--tw-ring-color': `${TEAL}33` } as React.CSSProperties}
                    onFocus={(e) => { e.currentTarget.style.borderColor = TEAL; }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                </div>
              </div>

              {/* Password */}
              <div className="rp-anim" style={{ animationDelay: '0.52s' }}>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ width: 16, height: 16, color: '#94a3b8' }}
                  />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    className="w-full h-12 pl-10 pr-11 rounded-xl border border-slate-200 bg-white text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-all"
                    onFocus={(e) => { e.currentTarget.style.borderColor = TEAL; }}
                    onBlur={(e)  => { e.currentTarget.style.borderColor = '#e2e8f0'; }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPwd((p) => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPwd ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                  </button>
                </div>
              </div>

              {/* Remember + Forgot */}
              <div className="flex items-center justify-between rp-anim" style={{ animationDelay: '0.60s' }}>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                    style={{ accentColor: TEAL }}
                  />
                  <span className="text-sm text-slate-600">Keep me logged in</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowForgot((v) => !v)}
                  className="text-sm font-semibold hover:underline underline-offset-2 transition-colors"
                  style={{ color: TEAL }}
                >
                  Forgot password?
                </button>
              </div>

              {/* Forgot panel */}
              {showForgot && (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 animate-fade-in">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-blue-800">
                          Contact your Super Admin for a password reset
                        </p>
                        <div className="mt-1.5 space-y-1">
                          <div className="flex items-center gap-1.5 text-[11px] text-blue-700">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span><strong>0256251295</strong> or <strong>0598610304</strong></span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-blue-700">
                            <Mail className="h-3 w-3 shrink-0" />
                            <strong>popmychubsolution@gmail.com</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowForgot(false)}
                      className="p-1 rounded text-blue-400 hover:text-blue-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {/* Login button */}
              <button
                type="submit"
                disabled={signingIn}
                className={clsx(
                  'w-full h-12 flex items-center justify-center gap-2 rounded-xl rp-anim',
                  'text-sm font-bold text-white shadow-md active:scale-[0.98]',
                  'transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed',
                )}
                style={{ background: signingIn ? '#4DB6AC' : TEAL, animationDelay: '0.68s' }}
              >
                {signingIn ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    <ArrowRight style={{ width: 16, height: 16 }} />
                    Login
                  </>
                )}
              </button>
            </form>

            {/* Safety note */}
            <div className="mt-5 flex items-center justify-center gap-1.5 rp-anim" style={{ animationDelay: '0.76s' }}>
              <CheckCircle style={{ width: 14, height: 14, color: TEAL }} />
              <span className="text-[11px] text-slate-400">Your data is safe with us</span>
            </div>
          </div>
        </div>

        {/* Copyright */}
        <p className="relative z-10 text-center text-[11px] text-slate-400 pb-5 shrink-0">
          © 2025 POPMYC POS. All rights reserved.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          ABOUT US MODAL
          ══════════════════════════════════════════════════════════════ */}
      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setShowAbout(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden animate-about-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header band */}
            <div
              className="px-7 pt-7 pb-6"
              style={{ background: 'linear-gradient(135deg, #004D40 0%, #00897B 100%)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ background: 'rgba(255,255,255,0.18)', border: '1.5px solid rgba(255,255,255,0.30)' }}
                  >
                    <ShoppingCart className="text-white" style={{ width: 22, height: 22 }} />
                  </div>
                  <div>
                    <p className="text-[17px] font-extrabold text-white leading-tight">POPMYC POS</p>
                    <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.65)' }}>Smart Retail. Better Business.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAbout(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                  style={{ background: 'rgba(255,255,255,0.15)' }}
                  aria-label="Close"
                >
                  <X className="text-white" style={{ width: 16, height: 16 }} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="px-7 py-6 space-y-5">
              {/* About blurb */}
              <div>
                <h3 className="text-base font-bold mb-1.5" style={{ color: DARK_TEAL }}>About Us</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  <strong className="text-slate-800">POPMyC Solutions</strong> is a Ghanaian retail-technology company dedicated to simplifying business operations for small and medium enterprises. Our POPMYC POS system empowers retailers with fast, reliable, and offline-capable point-of-sale tools — helping you sell smarter, track inventory in real time, and grow your business with confidence.
                </p>
              </div>

              {/* Feature highlights */}
              <div className="grid grid-cols-3 gap-3">
                {FEATURES.map(({ icon: Icon, label }, i) => (
                  <div
                    key={i}
                    className="flex flex-col items-center gap-1.5 rounded-xl py-3 px-2 text-center"
                    style={{ background: '#f0faf8', border: '1px solid #d0f0eb' }}
                  >
                    <Icon style={{ width: 20, height: 20, color: TEAL }} />
                    <p className="text-[10px] font-semibold leading-tight whitespace-pre-line" style={{ color: DARK_TEAL }}>
                      {label}
                    </p>
                  </div>
                ))}
              </div>

              {/* Contact */}
              <div
                className="rounded-xl p-4 space-y-2"
                style={{ background: '#f8fbff', border: '1px solid #dbeafe' }}
              >
                <p className="text-xs font-bold text-slate-700 mb-2">Contact Us</p>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Phone className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL }} />
                  <span><strong>0256251295</strong> &nbsp;/&nbsp; <strong>0598610304</strong></span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <Mail className="h-3.5 w-3.5 shrink-0" style={{ color: TEAL }} />
                  <strong>popmychubsolution@gmail.com</strong>
                </div>
              </div>

              {/* Footer */}
              <p className="text-center text-[11px] text-slate-400 pt-1">
                © 2025 POPMyC Solutions. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      )}

      <style>{`
        /* ── Left panel text: slide up + fade in ── */
        @keyframes lp-slide-up {
          from { opacity: 0; transform: translateY(22px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .lp-anim {
          opacity: 0;
          animation: lp-slide-up 0.55s cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }

        /* ── Right panel elements: slide up + fade in (shorter travel) ── */
        @keyframes rp-slide-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0);    }
        }
        .rp-anim {
          opacity: 0;
          animation: rp-slide-up 0.50s cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }

        /* ── Misc ── */
        @keyframes fade-in   { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes about-in  { from { opacity:0; transform:scale(0.95) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes spin      { to   { transform: rotate(360deg); } }
        .animate-fade-in    { animation: fade-in  0.20s ease both; }
        .animate-about-in   { animation: about-in 0.25s ease both; }
        .animate-spin       { animation: spin     0.75s linear infinite; }
      `}</style>
    </div>
  );
}

export default LoginPage;
