import { useState, useMemo, useRef } from 'react';
import {
  HardDrive, Download, Upload, Check, AlertTriangle,
  Clock, Trash2, RefreshCw, Info, Package,
  Users, ShoppingCart, FileText, Database,
} from 'lucide-react';
import { clsx } from 'clsx';

// All localStorage keys that belong to this POS app
const APP_STORE_KEYS = [
  { key: 'popmyc-products',      label: 'Products',       icon: Package      },
  { key: 'popmyc-sales',         label: 'Sales',          icon: ShoppingCart },
  { key: 'popmyc-customers',     label: 'Customers',      icon: Users        },
  { key: 'popmyc-suppliers',     label: 'Suppliers',      icon: FileText     },
  { key: 'popmyc-purchases',     label: 'Purchases',      icon: FileText     },
  { key: 'popmyc-expenses',      label: 'Expenses',       icon: FileText     },
  { key: 'popmyc-categories',    label: 'Categories',     icon: FileText     },
  { key: 'popmyc-brands',        label: 'Brands',         icon: FileText     },
  { key: 'popmyc-users',         label: 'Users',          icon: Users        },
  { key: 'popmyc-settings',      label: 'Settings',       icon: Database     },
  { key: 'popmyc-pos',           label: 'POS State',      icon: ShoppingCart },
  { key: 'popmyc-inventory',     label: 'Inventory',      icon: Package      },
];

interface BackupEntry {
  id: string;
  createdAt: string;
  label: string;
  sizeKB: string;
  storeCount: number;
  data: Record<string, unknown>;
}

const BACKUP_LIST_KEY = 'popmyc-backups-index';

function loadBackups(): BackupEntry[] {
  try {
    const s = localStorage.getItem(BACKUP_LIST_KEY);
    if (s) return JSON.parse(s) as BackupEntry[];
  } catch { /* noop */ }
  return [];
}

function saveBackups(list: BackupEntry[]) {
  // Store only metadata — actual data blobs stored separately
  localStorage.setItem(BACKUP_LIST_KEY, JSON.stringify(list.map((b) => ({ ...b, data: {} }))));
}

export default function BackupPage() {
  const [backups,    setBackups]    = useState<BackupEntry[]>(loadBackups);
  const [status,     setStatus]     = useState<'idle' | 'backing-up' | 'restoring' | 'success' | 'error'>('idle');
  const [statusMsg,  setStatusMsg]  = useState('');
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [backupLabel, setBackupLabel] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Estimate sizes
  const storeSizes = useMemo(() =>
    APP_STORE_KEYS.map((s) => {
      const raw = localStorage.getItem(s.key) ?? '';
      return { ...s, sizeKB: (raw.length / 1024).toFixed(1), hasData: raw.length > 0 };
    }),
  [status]); // re-run after backup/restore

  const totalKB = useMemo(() =>
    storeSizes.reduce((sum, s) => sum + Number(s.sizeKB), 0).toFixed(1),
  [storeSizes]);

  // ── Create backup ──────────────────────────────────────────────────────────
  function handleCreateBackup() {
    setStatus('backing-up');
    setStatusMsg('Collecting data…');

    setTimeout(() => {
      const snapshot: Record<string, unknown> = {};
      let count = 0;
      APP_STORE_KEYS.forEach(({ key }) => {
        const raw = localStorage.getItem(key);
        if (raw) { try { snapshot[key] = JSON.parse(raw); count++; } catch { snapshot[key] = raw; count++; } }
      });

      const size = (JSON.stringify(snapshot).length / 1024).toFixed(1);
      const entry: BackupEntry = {
        id:         `bk-${Date.now()}`,
        createdAt:  new Date().toISOString(),
        label:      backupLabel.trim() || `Backup ${new Date().toLocaleDateString('en-GB')}`,
        sizeKB:     size,
        storeCount: count,
        data:       snapshot,
      };

      // Download as JSON file
      const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `popmyc-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Keep in backup list (without the data blob to save space)
      const newList = [{ ...entry, data: {} }, ...backups].slice(0, 20);
      setBackups(newList);
      saveBackups(newList);
      setBackupLabel('');
      setStatus('success');
      setStatusMsg(`Backup created — ${count} stores, ${size} KB`);
      setTimeout(() => setStatus('idle'), 3000);
    }, 600);
  }

  // ── Restore from file ──────────────────────────────────────────────────────
  async function handleRestoreFile(file: File) {
    setStatus('restoring');
    setStatusMsg('Reading backup file…');
    try {
      const text = await file.text();
      const entry = JSON.parse(text) as BackupEntry;
      if (!entry.data || typeof entry.data !== 'object') throw new Error('Invalid backup format');

      let restored = 0;
      Object.entries(entry.data).forEach(([key, value]) => {
        if (APP_STORE_KEYS.some((s) => s.key === key)) {
          localStorage.setItem(key, JSON.stringify(value));
          restored++;
        }
      });

      setStatus('success');
      setStatusMsg(`Restored ${restored} stores from backup. Reload the page to see changes.`);
      setTimeout(() => setStatus('idle'), 5000);
    } catch (err) {
      setStatus('error');
      setStatusMsg('Failed to restore — invalid or corrupted backup file.');
      setTimeout(() => setStatus('idle'), 4000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleRestoreFile(f);
  }

  function handleDeleteBackup(id: string) {
    const next = backups.filter((b) => b.id !== id);
    setBackups(next);
    saveBackups(next);
    setConfirmId(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">Backup & Restore</h1>
        <p className="text-sm text-muted-500 mt-0.5">Export all data as a JSON file or restore from a previous backup</p>
      </div>

      {/* Status banner */}
      {status !== 'idle' && (
        <div className={clsx('flex items-center gap-3 rounded-xl px-4 py-3 border text-sm font-medium',
          status === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          status === 'error'   ? 'bg-rose-50 border-rose-200 text-rose-700' :
          'bg-blue-50 border-blue-200 text-blue-700')}>
          {status === 'success'   ? <Check className="h-4 w-4 shrink-0" /> :
           status === 'error'     ? <AlertTriangle className="h-4 w-4 shrink-0" /> :
           <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />}
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Create Backup ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Download className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Create Backup</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                Creates a snapshot of all local POS data and downloads it as a <strong>.json</strong> file.
                Store backups securely — they contain all sales, customer, and product records.
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Backup Label (optional)</label>
              <input value={backupLabel} onChange={(e) => setBackupLabel(e.target.value)}
                placeholder={`Backup ${new Date().toLocaleDateString('en-GB')}`}
                className="w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
            </div>

            {/* Store list */}
            <div>
              <p className="text-xs font-semibold text-muted-600 mb-2">Data stores included ({storeSizes.filter((s) => s.hasData).length}/{storeSizes.length})</p>
              <div className="grid grid-cols-2 gap-1.5">
                {storeSizes.map((s) => {
                  const Icon = s.icon;
                  return (
                    <div key={s.key} className={clsx('flex items-center gap-2 rounded-lg px-2.5 py-2',
                      s.hasData ? 'bg-emerald-50/60' : 'bg-muted-50')}>
                      <Icon className={clsx('h-3.5 w-3.5 shrink-0', s.hasData ? 'text-emerald-600' : 'text-muted-300')} />
                      <span className={clsx('text-xs font-medium truncate', s.hasData ? 'text-[#1E293B]' : 'text-muted-400')}>{s.label}</span>
                      <span className="ml-auto text-[10px] text-muted-400 font-mono shrink-0">{s.sizeKB}KB</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-400 mt-2 text-right">Total: ~{totalKB} KB</p>
            </div>

            <button onClick={handleCreateBackup} disabled={status === 'backing-up' || status === 'restoring'}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] px-5 py-3 text-sm font-semibold text-white hover:bg-[#334155] transition-colors disabled:opacity-40 shadow-sm">
              {status === 'backing-up'
                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Creating…</>
                : <><HardDrive className="h-4 w-4" /> Download Backup</>}
            </button>
          </div>
        </div>

        {/* ── Restore ── */}
        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-muted-100 flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Restore from Backup</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Restoring <strong>overwrites</strong> your current data. This cannot be undone.
                Back up the current state first if needed.
              </p>
            </div>

            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />

            <button onClick={() => fileInputRef.current?.click()}
              disabled={status === 'restoring' || status === 'backing-up'}
              className="w-full border-2 border-dashed border-muted-300 rounded-xl px-4 py-10 flex flex-col items-center gap-3 hover:border-[#1E293B] hover:bg-muted-50 transition-all disabled:opacity-40">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted-100">
                {status === 'restoring'
                  ? <RefreshCw className="h-7 w-7 text-blue-500 animate-spin" />
                  : <Upload className="h-7 w-7 text-muted-400" />}
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-[#1E293B]">
                  {status === 'restoring' ? 'Restoring…' : 'Choose backup file'}
                </p>
                <p className="text-xs text-muted-500 mt-0.5">Select a .json file exported by this system</p>
              </div>
            </button>

            <div className="flex items-center gap-2 rounded-xl bg-muted-50 border border-muted-100 px-4 py-3">
              <Database className="h-4 w-4 text-muted-400 shrink-0" />
              <p className="text-xs text-muted-500">After restore, <strong>reload the page</strong> to see updated data.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Backup History ── */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-muted-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-400" />
            <h2 className="text-sm font-bold text-[#1E293B]">Backup History</h2>
          </div>
          <span className="text-xs text-muted-400 bg-muted-100 rounded-full px-2.5 py-1">{backups.length} records</span>
        </div>

        {backups.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted-400">
            <HardDrive className="h-10 w-10 mx-auto mb-3 text-muted-300" />
            <p className="text-sm font-medium">No backups yet</p>
            <p className="text-xs mt-1">Create your first backup above</p>
          </div>
        ) : (
          <div className="divide-y divide-muted-50">
            {backups.map((b) => (
              <div key={b.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted-50/50 transition-colors">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1E293B]/5 shrink-0">
                  <HardDrive className="h-4 w-4 text-[#1E293B]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#1E293B] truncate">{b.label}</p>
                  <p className="text-[11px] text-muted-400 flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {new Date(b.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    &nbsp;·&nbsp;{b.sizeKB} KB · {b.storeCount} stores
                  </p>
                </div>
                {confirmId === b.id ? (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-500">Delete?</span>
                    <button onClick={() => setConfirmId(null)}
                      className="text-xs font-semibold text-muted-600 border border-muted-200 rounded-lg px-2.5 py-1 hover:bg-muted-50">Cancel</button>
                    <button onClick={() => handleDeleteBackup(b.id)}
                      className="text-xs font-semibold text-white bg-rose-600 rounded-lg px-2.5 py-1 hover:bg-rose-700">Delete</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmId(b.id)}
                    className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-300 hover:text-rose-500 hover:bg-rose-50 transition-colors shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
