/**
 * SyncStatusIndicator
 * ====================
 * Compact sync status widget for the MainLayout header.
 *
 * States:
 *  🔴 Offline              — no internet, no sync possible
 *  🟡 Online — Syncing…    — upload in progress
 *  🟠 Online — X pending   — items waiting to sync
 *  🔴 Online — X failed    — items that failed and need retry
 *  🟢 Online — Synced      — all clear
 *  🟠 X conflicts          — items in conflict (needs resolution)
 *
 * Clicking opens a small panel with:
 *  - Status summary
 *  - Last sync time
 *  - "Sync Now" button
 *  - "Retry failed" button (when there are failures)
 *  - Log of last 5 sync operations
 */

import { useState, useRef, useEffect } from 'react';
import {
  Wifi, WifiOff, RefreshCw, CheckCircle, AlertTriangle,
  Clock, Upload, AlertCircle, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useSync } from '@/hooks/useSync';
import { useSyncStore } from '@/stores/sync.store';
import { formatDate } from '@/utils/format';

export function SyncStatusIndicator() {
  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const {
    isOnline, isSyncing, pendingCount, failedCount, conflictCount,
    lastSyncAt, syncNow, requeueFailed,
  } = useSync();

  const log = useSyncStore((s) => s.log.slice(0, 5));

  // Close panel on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Determine display state ─────────────────────────────────────────────
  type SyncState = 'offline' | 'syncing' | 'pending' | 'failed' | 'conflict' | 'synced';

  const syncState: SyncState = !isOnline
    ? 'offline'
    : isSyncing
    ? 'syncing'
    : failedCount > 0
    ? 'failed'
    : conflictCount > 0
    ? 'conflict'
    : pendingCount > 0
    ? 'pending'
    : 'synced';

  const stateConfig: Record<SyncState, {
    dot: string; label: string; sublabel?: string;
    icon: typeof Wifi; iconClass: string;
  }> = {
    offline:  { dot: 'bg-red-500',    label: 'Offline',        icon: WifiOff,      iconClass: 'text-red-500'    },
    syncing:  { dot: 'bg-amber-400 animate-pulse', label: 'Syncing…', icon: RefreshCw, iconClass: 'text-amber-500 animate-spin' },
    pending:  { dot: 'bg-amber-400',  label: `${pendingCount} pending`, icon: Upload,  iconClass: 'text-amber-500'  },
    failed:   { dot: 'bg-rose-500',   label: `${failedCount} failed`,   icon: AlertTriangle, iconClass: 'text-rose-500' },
    conflict: { dot: 'bg-orange-500', label: `${conflictCount} conflict${conflictCount !== 1 ? 's' : ''}`, icon: AlertCircle, iconClass: 'text-orange-500' },
    synced:   { dot: 'bg-emerald-500', label: 'Synced',        icon: CheckCircle,  iconClass: 'text-emerald-500' },
  };

  const cfg  = stateConfig[syncState];
  const Icon = cfg.icon;

  return (
    <div ref={panelRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        title={`Sync: ${cfg.label}${lastSyncAt ? ` · Last sync: ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}`}
        className="relative inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-page-secondary hover:text-mint-500 transition-all duration-150 text-xs font-medium"
        style={{ background: 'transparent' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Status dot */}
        <span className={clsx('h-2 w-2 rounded-full shrink-0', cfg.dot)} />
        {/* Icon */}
        <Icon className={clsx('h-3.5 w-3.5 shrink-0', cfg.iconClass)} />
        {/* Label — hidden on mobile */}
        <span className="hidden sm:inline text-[11px] font-semibold whitespace-nowrap">{cfg.label}</span>
      </button>

      {/* Panel */}
      {panelOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-72 rounded-2xl shadow-modal border z-50 overflow-hidden animate-scale-in"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-base)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-card)' }}>
            <div className="flex items-center gap-2">
              <span className={clsx('h-2.5 w-2.5 rounded-full', cfg.dot)} />
              <p className="text-sm font-bold text-page-primary">Synchronization</p>
            </div>
            <button onClick={() => setPanelOpen(false)} className="text-page-muted hover:text-page-primary">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Stats */}
          <div className="px-4 py-3 space-y-2">
            {/* Network */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-page-muted flex items-center gap-1.5">
                {isOnline ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-red-500" />}
                Network
              </span>
              <span className={clsx('font-semibold', isOnline ? 'text-emerald-600' : 'text-red-600')}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            {/* Pending */}
            {pendingCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-page-muted flex items-center gap-1.5"><Upload className="h-3.5 w-3.5 text-amber-500" />Pending</span>
                <span className="font-semibold text-amber-600">{pendingCount}</span>
              </div>
            )}

            {/* Failed */}
            {failedCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-page-muted flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-rose-500" />Failed</span>
                <span className="font-semibold text-rose-600">{failedCount}</span>
              </div>
            )}

            {/* Conflicts */}
            {conflictCount > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-page-muted flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5 text-orange-500" />Conflicts</span>
                <span className="font-semibold text-orange-600">{conflictCount}</span>
              </div>
            )}

            {/* Last sync */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-page-muted flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />Last sync</span>
              <span className="font-semibold text-page-primary text-right">
                {lastSyncAt
                  ? formatDate(lastSyncAt, 'DD MMM, HH:mm')
                  : 'Not yet synced'}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 pb-3 flex gap-2"
            style={{ borderTop: '1px solid var(--border-card)', paddingTop: 12 }}>
            <button
              onClick={() => { void syncNow(); setPanelOpen(false); }}
              disabled={isSyncing || !isOnline}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl text-white text-xs font-semibold py-2 transition-colors disabled:opacity-40"
              style={{ background: 'var(--mint)' }}
            >
              <RefreshCw className={clsx('h-3.5 w-3.5', isSyncing && 'animate-spin')} />
              {isSyncing ? 'Syncing…' : 'Sync Now'}
            </button>
            {failedCount > 0 && (
              <button
                onClick={() => { requeueFailed(); void syncNow(); setPanelOpen(false); }}
                disabled={!isOnline}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 text-rose-600 text-xs font-semibold py-2 hover:bg-rose-50 transition-colors disabled:opacity-40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry Failed
              </button>
            )}
          </div>

          {/* Recent log */}
          {log.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border-card)' }}>
              <p className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-page-muted"
                style={{ background: 'var(--bg-page)' }}>
                Recent Activity
              </p>
              {log.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2 px-4 py-2 text-[11px]"
                  style={{ borderTop: '1px solid var(--border-card)' }}>
                  <span className={clsx('h-1.5 w-1.5 rounded-full shrink-0',
                    entry.status === 'success' ? 'bg-emerald-500' :
                    entry.status === 'partial' ? 'bg-amber-500' : 'bg-red-500')} />
                  <span className="text-page-muted flex-1 truncate">
                    ↑{entry.itemsUploaded} ↓{entry.itemsDownloaded}
                    {entry.errors > 0 && <span className="text-red-500"> · {entry.errors} err</span>}
                  </span>
                  <span className="text-page-muted shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Offline mode notice */}
          {!isOnline && (
            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--border-card)', background: 'var(--bg-page)' }}>
              <p className="text-[11px] text-page-muted leading-relaxed">
                Working offline. All transactions are saved locally and will sync automatically when connectivity is restored.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SyncStatusIndicator;
