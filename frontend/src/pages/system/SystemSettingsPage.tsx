import { useState } from 'react';
import {
  Server, Cpu, Database, Globe, Shield,
  AlertTriangle, Check, RefreshCw, Trash2,
  Info, Zap, Clock, HardDrive, Wifi, Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { APP_NAME } from '@/utils/constants';

const STORAGE_KEY = 'popmyc-system-settings';

interface SystemConfig {
  maintenanceMode: boolean;
  debugMode: boolean;
  apiBaseUrl: string;
  sessionTimeoutMinutes: number;
  maxLoginAttempts: number;
  enableAutoBackup: boolean;
  autoBackupIntervalHours: number;
  enableCors: boolean;
  allowedOrigins: string;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
}

function loadConfig(): SystemConfig {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s) as SystemConfig;
  } catch { /* noop */ }
  return {
    maintenanceMode: false,
    debugMode: false,
    apiBaseUrl: '/api/v1',
    sessionTimeoutMinutes: 480,
    maxLoginAttempts: 5,
    enableAutoBackup: true,
    autoBackupIntervalHours: 24,
    enableCors: true,
    allowedOrigins: 'http://localhost:5173,http://localhost:3000',
    cacheEnabled: true,
    cacheTtlSeconds: 300,
  };
}

function Toggle({ enabled, onChange, disabled = false }: { enabled: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onChange} disabled={disabled}
      className={clsx('relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
      style={{ backgroundColor: enabled ? '#1E293B' : '#D1D5DB' }}>
      <span className={clsx('inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
        enabled ? 'translate-x-5' : 'translate-x-0')} />
    </button>
  );
}

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 transition-shadow';

const VERSION = '1.0.0';

export default function SystemSettingsPage() {
  const [config,  setConfig]  = useState<SystemConfig>(loadConfig);
  const [saved,   setSaved]   = useState(false);
  const [cleared, setCleared] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  function updateConfig(patch: Partial<SystemConfig>) {
    setConfig((prev) => ({ ...prev, ...patch }));
  }

  function handleSave() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function handleClearCache() {
    // Flush transient caches (not persistent stores)
    sessionStorage.clear();
    setCleared(true);
    setTimeout(() => setCleared(false), 2500);
  }

  function handleFactoryReset() {
    const keysToKeep = ['popmyc-auth-storage'];
    const allKeys = Object.keys(localStorage);
    allKeys.forEach((k) => { if (!keysToKeep.includes(k)) localStorage.removeItem(k); });
    setConfirmReset(false);
    window.location.reload();
  }

  // Gather basic system info
  const storageUsedKB = useMemo(() => {
    let total = 0;
    for (const key of Object.keys(localStorage)) {
      total += (localStorage.getItem(key) ?? '').length;
    }
    return (total / 1024).toFixed(1);
  }, []);

  function useMemo<T>(fn: () => T, _deps: unknown[]): T { return fn(); }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">System Settings</h1>
          <p className="text-sm text-muted-500 mt-0.5">Application-level configuration and maintenance controls</p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 text-emerald-600 px-3 py-1.5 text-xs font-semibold border border-emerald-200">
              <Check className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button onClick={handleSave}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
            <Server className="h-4 w-4" /> Save Config
          </button>
        </div>
      </div>

      {/* System info cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Cpu,       label: 'Version',       value: VERSION,          sub: 'Retail Edition'    },
          { icon: HardDrive, label: 'Local Storage',  value: `${storageUsedKB} KB`, sub: 'Used'      },
          { icon: Wifi,      label: 'API Base URL',   value: config.apiBaseUrl, sub: 'Endpoint'        },
          { icon: Clock,     label: 'Session Timeout',value: `${config.sessionTimeoutMinutes} min`, sub: 'Idle limit' },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-4 w-4 text-muted-400" />
                <p className="text-xs font-medium text-muted-500">{s.label}</p>
              </div>
              <p className="text-base font-bold text-[#1E293B] truncate">{s.value}</p>
              <p className="text-[11px] text-muted-400">{s.sub}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Application Mode ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Application Mode</h2>
          </div>
          <div className="p-5 space-y-4">
            {/* Maintenance */}
            <div className={clsx('flex items-center justify-between p-4 rounded-xl border transition-colors',
              config.maintenanceMode ? 'bg-amber-50 border-amber-200' : 'bg-muted-50 border-muted-100')}>
              <div>
                <p className="text-sm font-semibold text-[#1E293B] flex items-center gap-1.5">
                  {config.maintenanceMode && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                  Maintenance Mode
                </p>
                <p className="text-xs text-muted-500 mt-0.5">Disables non-admin access to the POS</p>
              </div>
              <Toggle enabled={config.maintenanceMode} onChange={() => updateConfig({ maintenanceMode: !config.maintenanceMode })} />
            </div>

            {/* Debug */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
              <div>
                <p className="text-sm font-semibold text-[#1E293B]">Debug Mode</p>
                <p className="text-xs text-muted-500 mt-0.5">Verbose logging and error details in console</p>
              </div>
              <Toggle enabled={config.debugMode} onChange={() => updateConfig({ debugMode: !config.debugMode })} />
            </div>

            {/* API URL */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-muted-400" /> API Base URL
              </label>
              <input value={config.apiBaseUrl} onChange={(e) => updateConfig({ apiBaseUrl: e.target.value })}
                className={inputClass} placeholder="/api/v1" />
            </div>
          </div>
        </div>

        {/* ── Security ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Security</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Session Timeout (min)</label>
                <input type="number" value={config.sessionTimeoutMinutes} min={5}
                  onChange={(e) => updateConfig({ sessionTimeoutMinutes: Number(e.target.value) })}
                  className={inputClass} />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Max Login Attempts</label>
                <input type="number" value={config.maxLoginAttempts} min={1} max={20}
                  onChange={(e) => updateConfig({ maxLoginAttempts: Number(e.target.value) })}
                  className={inputClass} />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
              <div>
                <p className="text-sm font-semibold text-[#1E293B]">CORS Enabled</p>
                <p className="text-xs text-muted-500 mt-0.5">Allow cross-origin API requests</p>
              </div>
              <Toggle enabled={config.enableCors} onChange={() => updateConfig({ enableCors: !config.enableCors })} />
            </div>

            {config.enableCors && (
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-muted-400" /> Allowed Origins (comma-separated)
                </label>
                <textarea value={config.allowedOrigins} rows={2}
                  onChange={(e) => updateConfig({ allowedOrigins: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 resize-none" />
              </div>
            )}
          </div>
        </div>

        {/* ── Cache ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Cache & Performance</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-xl bg-muted-50 border border-muted-100">
              <div>
                <p className="text-sm font-semibold text-[#1E293B]">Enable Cache</p>
                <p className="text-xs text-muted-500 mt-0.5">Cache API responses for faster page loads</p>
              </div>
              <Toggle enabled={config.cacheEnabled} onChange={() => updateConfig({ cacheEnabled: !config.cacheEnabled })} />
            </div>
            {config.cacheEnabled && (
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Cache TTL (seconds)</label>
                <input type="number" value={config.cacheTtlSeconds} min={30}
                  onChange={(e) => updateConfig({ cacheTtlSeconds: Number(e.target.value) })}
                  className={inputClass} />
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-700">Clear Session Cache</p>
                <p className="text-xs text-muted-400">Flushes sessionStorage without affecting stored data</p>
              </div>
              <button onClick={handleClearCache}
                className={clsx('inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition-colors',
                  cleared ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-muted-100 text-muted-600 hover:bg-muted-200 border border-muted-200')}>
                {cleared ? <><Check className="h-3.5 w-3.5" /> Cleared</> : <><RefreshCw className="h-3.5 w-3.5" /> Clear Cache</>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Danger Zone ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-rose-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-rose-100 flex items-center gap-2 bg-rose-50/50">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <h2 className="text-sm font-bold text-rose-700">Danger Zone</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                The following actions are <strong>irreversible</strong> and will delete all locally stored data.
                Make a backup before proceeding.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl border border-rose-100 bg-rose-50/30">
                <div>
                  <p className="text-sm font-semibold text-[#1E293B]">Factory Reset</p>
                  <p className="text-xs text-muted-500 mt-0.5">Deletes all local data and reloads the app</p>
                </div>
                {!confirmReset ? (
                  <button onClick={() => setConfirmReset(true)}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 text-rose-600 px-4 py-2 text-xs font-semibold hover:bg-rose-50 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Reset
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setConfirmReset(false)}
                      className="rounded-lg border border-muted-200 px-3 py-1.5 text-xs font-semibold text-muted-600 hover:bg-muted-50">Cancel</button>
                    <button onClick={handleFactoryReset}
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700">Confirm Reset</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* App info footer */}
      <div className="bg-white rounded-2xl border border-muted-100 p-4 flex items-center justify-between text-xs text-muted-400">
        <span><span className="font-semibold text-muted-600">{APP_NAME}</span> · v{VERSION} · Retail Edition</span>
        <span>Frontend: React + Vite · Backend: Django REST Framework</span>
      </div>
    </div>
  );
}
