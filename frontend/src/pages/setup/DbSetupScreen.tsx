/**
 * DbSetupScreen.tsx
 * =================
 * Shown by Electron when PostgreSQL or the database is not ready.
 * Communicates with the Electron main process via window.popmycDesktop IPC.
 *
 * States handled:
 *   PG_NOT_INSTALLED  → show download link, retry button
 *   PG_NOT_RUNNING    → tell user to start the service, retry button
 *   DB_NOT_FOUND      → ask for PG admin password, create database
 *   AUTH_FAILED       → show error, allow password retry
 *   WRONG_ADMIN_PASSWORD
 *   done              → call pgSetupComplete() → main.js continues startup
 *
 * Never shown in web/browser mode — only inside the Electron desktop app.
 */

import { useEffect, useState } from 'react';
import {
  Database, Download, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Loader2, Eye, EyeOff, ChevronRight, ExternalLink, Server,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PgResult {
  success: boolean;
  action?: string;
  pg_installed?: boolean;
  pg_running?: boolean;
  db_exists?: boolean;
  db_accessible?: boolean;
  pg_version?: string | null;
  pg_port?: number;
  db_name?: string;
  db_host?: string;
  message: string;
  error_code: string | null;
  next_step?: string;
}

const TEAL = '#00897B';

// ── Main component ────────────────────────────────────────────────────────────

export default function DbSetupScreen() {
  const [pgStatus, setPgStatus]     = useState<PgResult | null>(null);
  const [checking, setChecking]     = useState(true);
  const [pgPassword, setPgPassword] = useState('');
  const [showPwd, setShowPwd]       = useState(false);
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState('');
  const [done, setDone]             = useState(false);

  const desktop = window.popmycDesktop;

  // ── On mount: either receive pushed result or poll ─────────────────────────
  useEffect(() => {
    if (!desktop) {
      // Running in browser — skip
      setChecking(false);
      return;
    }

    // Listen for result pushed from main.js on window load
    desktop.onPgCheckResult?.((result: PgResult) => {
      setPgStatus(result);
      setChecking(false);
    });

    // Also poll ourselves (in case the event fired before listener was ready)
    const timer = setTimeout(async () => {
      if (pgStatus !== null) return; // already got it
      try {
        const r = await desktop.pgCheck();
        setPgStatus(r);
      } catch {
        setPgStatus({
          success: false, message: 'Could not check database status.',
          error_code: 'CHECK_ERROR', next_step: 'enter_credentials',
        });
      }
      setChecking(false);
    }, 800);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRetry() {
    setChecking(true);
    setCreateError('');
    try {
      const r = await desktop!.pgRetry();
      setPgStatus(r);
      if (r.success) {
        setDone(true);
        setTimeout(() => desktop!.pgSetupComplete(), 1200);
      }
    } catch {
      setPgStatus({
        success: false, message: 'Check failed. Please try again.',
        error_code: 'CHECK_ERROR', next_step: 'enter_credentials',
      });
    }
    setChecking(false);
  }

  async function handleCreateDb() {
    if (!pgPassword.trim()) { setCreateError('Please enter the PostgreSQL password.'); return; }
    setCreating(true);
    setCreateError('');
    try {
      const r = await desktop!.pgCreate(pgPassword);
      if (r.success) {
        // Create succeeded — proceed directly without re-checking.
        // The re-check was causing a false AUTH_FAILED because the new
        // popmyc_app credentials in .env aren't always reflected instantly.
        setDone(true);
        setTimeout(() => desktop!.pgSetupComplete(), 1200);
      } else {
        setCreateError(r.message);
        if (r.error_code === 'WRONG_ADMIN_PASSWORD') {
          setPgPassword('');
        }
      }
    } catch {
      setCreateError('Database creation failed. Please try again.');
    }
    setCreating(false);
  }

  // ── No Electron — not shown ───────────────────────────────────────────────
  if (!desktop) return null;

  // ── Done ──────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <Screen>
        <div className="flex flex-col items-center text-center py-8">
          <CheckCircle2 className="h-16 w-16 text-emerald-500 mb-4" />
          <h2 className="text-xl font-bold text-slate-800">Database Ready</h2>
          <p className="text-sm text-slate-500 mt-2">Starting POPMYC POS…</p>
        </div>
      </Screen>
    );
  }

  // ── Checking ─────────────────────────────────────────────────────────────
  if (checking) {
    return (
      <Screen>
        <div className="flex flex-col items-center text-center py-8">
          <Loader2 className="h-12 w-12 text-teal-500 animate-spin mb-4" style={{ color: TEAL }} />
          <h2 className="text-lg font-bold text-slate-700">Checking database…</h2>
          <p className="text-sm text-slate-400 mt-1">This will only take a moment.</p>
        </div>
      </Screen>
    );
  }

  const err = pgStatus?.error_code;

  // ── PostgreSQL not installed ───────────────────────────────────────────────
  if (err === 'PG_NOT_INSTALLED') {
    return (
      <Screen title="PostgreSQL Required">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 mb-5">
          <AlertTriangle className="h-6 w-6 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">PostgreSQL is not installed</p>
            <p className="text-xs text-amber-700 mt-0.5">
              POPMYC POS stores your business data in PostgreSQL. It must be installed before you can continue.
            </p>
          </div>
        </div>

        <ol className="space-y-3 mb-6 text-sm">
          <Step n={1}>Click <strong>Download PostgreSQL</strong> below to open the official installer.</Step>
          <Step n={2}>Download the <strong>PostgreSQL 16 or 15</strong> Windows x86-64 installer.</Step>
          <Step n={3}>Run the installer. Use the default settings and remember the password you set.</Step>
          <Step n={4}>Once installed, click <strong>Check Again</strong>.</Step>
        </ol>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => desktop.pgOpenDownload()}
            className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-white"
            style={{ background: TEAL }}
          >
            <Download className="h-4 w-4" /> Download PostgreSQL
            <ExternalLink className="h-3.5 w-3.5 ml-1 opacity-70" />
          </button>
          <button onClick={handleRetry}
            className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            <RefreshCw className="h-4 w-4" /> Check Again
          </button>
        </div>
      </Screen>
    );
  }

  // ── PostgreSQL not running ─────────────────────────────────────────────────
  if (err === 'PG_NOT_RUNNING') {
    return (
      <Screen title="PostgreSQL Service Stopped">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 mb-5">
          <Server className="h-6 w-6 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">PostgreSQL service is not running</p>
            <p className="text-xs text-amber-700 mt-0.5">
              PostgreSQL is installed but not currently running.
            </p>
          </div>
        </div>

        <ol className="space-y-3 mb-6 text-sm">
          <Step n={1}>Press <strong>Windows + R</strong>, type <code className="bg-slate-100 px-1 rounded">services.msc</code>, press Enter.</Step>
          <Step n={2}>Find <strong>postgresql</strong> in the list and right-click → <strong>Start</strong>.</Step>
          <Step n={3}>Click <strong>Check Again</strong> below.</Step>
        </ol>

        <button onClick={handleRetry}
          className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold text-white"
          style={{ background: TEAL }}>
          <RefreshCw className="h-4 w-4" /> Check Again
        </button>
      </Screen>
    );
  }

  // ── Database missing — ask for PG admin password ───────────────────────────
  if (err === 'DB_NOT_FOUND' || err === 'AUTH_FAILED' || err === 'CONNECTION_ERROR' ||
      err === 'WRONG_ADMIN_PASSWORD' || pgStatus?.next_step === 'enter_credentials') {
    const dbName = pgStatus?.db_name ?? 'popmyc_pos';
    return (
      <Screen title="Create Database">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200 mb-5">
          <Database className="h-5 w-5 text-blue-500 shrink-0" />
          <p className="text-sm text-blue-800">
            PostgreSQL is running but the <strong>{dbName}</strong> database doesn't exist yet.
            Enter the PostgreSQL password to create it automatically.
          </p>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-semibold text-slate-600 mb-1.5">
            PostgreSQL Administrator Password
          </label>
          <div className="relative">
            <input
              type={showPwd ? 'text' : 'password'}
              value={pgPassword}
              onChange={e => { setPgPassword(e.target.value); setCreateError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateDb(); }}
              placeholder="Enter your PostgreSQL password"
              className="w-full h-11 px-3.5 pr-11 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:border-teal-500"
              style={{ '--tw-ring-color': `${TEAL}33` } as React.CSSProperties}
            />
            <button type="button" onClick={() => setShowPwd(p => !p)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {createError && (
            <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {createError}
            </p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            This is the password you set when installing PostgreSQL. It is used only to create the database and is not stored.
          </p>
        </div>

        <button
          onClick={handleCreateDb}
          disabled={creating}
          className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          style={{ background: TEAL }}
        >
          {creating
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating database…</>
            : <><Database className="h-4 w-4" /> Create Database <ChevronRight className="h-4 w-4" /></>
          }
        </button>
      </Screen>
    );
  }

  // ── Generic error ─────────────────────────────────────────────────────────
  return (
    <Screen title="Database Setup Error">
      <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200 mb-5">
        <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-800">Cannot connect to database</p>
          <p className="text-xs text-red-700 mt-1">{pgStatus?.message ?? 'Unknown error.'}</p>
        </div>
      </div>
      <button onClick={handleRetry}
        className="w-full h-11 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold text-white"
        style={{ background: TEAL }}>
        <RefreshCw className="h-4 w-4" /> Try Again
      </button>
    </Screen>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Screen({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-8"
         style={{ background: '#f0faf8' }}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border px-7 py-7"
           style={{ borderColor: '#e8f5f2' }}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl"
               style={{ background: '#e0f2ee' }}>
            <Database style={{ width: 20, height: 20, color: '#00897B' }} />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">POPMYC POS</p>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">
              {title ?? 'Database Setup'}
            </h1>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: '#00897B' }}>
        {n}
      </span>
      <span className="text-slate-600 leading-relaxed">{children}</span>
    </li>
  );
}
