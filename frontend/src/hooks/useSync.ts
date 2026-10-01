/**
 * useSync.ts
 * ==========
 * Drives the offline-first synchronization engine for POPMYC POS.
 *
 * Responsibilities:
 *  - Detect online/offline status via navigator.onLine + events
 *  - Auto-trigger sync when connectivity is restored
 *  - Process the pending outbox queue in batches
 *  - Handle exponential backoff for failed items
 *  - Register the device on first sync
 *  - Expose: isOnline, isSyncing, pendingCount, failedCount, lastSyncAt, syncNow
 *
 * Design decisions:
 *  - Does NOT block the POS — sync runs fully in the background
 *  - Idempotency guaranteed by offlineUuid (server deduplicates)
 *  - Conflict items are quarantined and surfaced to the UI
 *  - Token expiry: if API returns 401, sync pauses (no data loss) until re-auth
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSyncStore }       from '@/stores/sync.store';
import { useAuthStore }       from '@/stores/auth.store';
import { useSalesStore }      from '@/stores/sales.store';
import { useSettingsStore }   from '@/stores/settings.store';
import * as syncService       from '@/services/sync.service';

const BATCH_SIZE        = 25;    // records per upload batch
const MIN_SYNC_INTERVAL = 30_000; // don't sync more often than 30s automatically

export interface UseSyncReturn {
  isOnline:     boolean;
  isSyncing:    boolean;
  pendingCount: number;
  failedCount:  number;
  conflictCount:number;
  lastSyncAt:   string | null;
  syncNow:      () => Promise<void>;
  requeueFailed:() => void;
}

export function useSync(): UseSyncReturn {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const lastAutoSyncRef         = useRef<number>(0);
  const syncRunningRef          = useRef<boolean>(false);

  // Store bindings
  const deviceId      = useSyncStore((s) => s.deviceId);
  const isSyncing     = useSyncStore((s) => s.isSyncing);
  const lastSyncAt    = useSyncStore((s) => s.lastSyncAt);
  const queue         = useSyncStore((s) => s.queue);

  const enqueue       = useSyncStore((s) => s.enqueue);
  const markSyncing   = useSyncStore((s) => s.markSyncing);
  const markSynced    = useSyncStore((s) => s.markSynced);
  const markFailed    = useSyncStore((s) => s.markFailed);
  const markConflict  = useSyncStore((s) => s.markConflict);
  const pruneQueue    = useSyncStore((s) => s.pruneQueue);
  const setIsSyncing  = useSyncStore((s) => s.setIsSyncing);
  const setLastSyncAt = useSyncStore((s) => s.setLastSyncAt);
  const appendLog     = useSyncStore((s) => s.appendLog);
  const requeueFailed = useSyncStore((s) => s.requeueFailed);

  const updateSaleSync = useSalesStore((s) => s.updateSaleSync);
  const syncSettingsFromBackend = useSettingsStore((s) => s.syncFromBackend);
  const { accessToken } = useAuthStore();

  const pendingCount  = useSyncStore((s) => s.pendingCount());
  const failedCount   = useSyncStore((s) => s.failedCount());
  const conflictCount = useSyncStore((s) => s.conflictCount());

  // ── Online / offline detection ─────────────────────────────────────────────
  useEffect(() => {
    function onOnline()  { setIsOnline(true);  }
    function onOffline() { setIsOnline(false); }
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // ── Enqueue pending sales that haven't been queued yet ─────────────────────
  // This runs whenever the sales store changes — picks up any 'pending' sales
  // that haven't been added to the sync outbox yet.
  useEffect(() => {
    const sales = useSalesStore.getState().sales;
    const { businessId, branchId } = (() => {
      try {
        const stored = localStorage.getItem('popmyc-auth-storage');
        const auth   = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
        return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
      } catch { return { businessId: null, branchId: null }; }
    })();

    for (const sale of sales) {
      if (sale.syncStatus === 'pending' || sale.syncStatus === 'failed') {
        enqueue({
          offlineUuid:  sale.offlineUuid,
          appLabel:     'sales',
          modelName:    'sale',
          action:       'create',
          payload:      sale as unknown as Record<string, unknown>,
          businessId,
          branchId:     sale.branchId ?? branchId,
          version:      1,
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Core sync function ─────────────────────────────────────────────────────
  const syncNow = useCallback(async () => {
    // Abort if: demo mode, no token, already running, or offline
    if (syncService.isLocalSession()) return;
    if (!accessToken || accessToken.startsWith('local-session-')) return;
    if (syncRunningRef.current) return;
    if (!navigator.onLine) return;

    syncRunningRef.current = true;
    setIsSyncing(true);

    let uploaded   = 0;
    let downloaded = 0;
    let errors     = 0;

    try {
      // ── 1. Register device (idempotent — server upserts) ──────────────────
      try {
        const { businessId, branchId } = (() => {
          try {
            const stored = localStorage.getItem('popmyc-auth-storage');
            const auth   = stored ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state : undefined;
            return { businessId: auth?.user?.business ?? null, branchId: auth?.user?.branch ?? null };
          } catch { return { businessId: null, branchId: null }; }
        })();
        await syncService.registerDevice({
          device_id:   deviceId,
          name:        `POPMYC POS — ${navigator.userAgent.slice(0, 40)}`,
          business_id: businessId,
          branch_id:   branchId,
        });
      } catch { /* device registration failing is non-fatal */ }

      // ── 2. Upload pending items in batches ────────────────────────────────
      const pending = queue.filter((q) => q.status === 'pending');

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);

        // Mark all in batch as syncing
        for (const item of batch) markSyncing(item.queueId);

        try {
          const result = await syncService.uploadBatch(batch, deviceId);

          // Process accepted
          for (const acc of result.accepted) {
            const item = batch.find((b) => b.offlineUuid === acc.id);
            if (item) {
              markSynced(item.queueId);
              // Propagate sync status back to the originating store
              if (item.appLabel === 'sales') {
                updateSaleSync(item.offlineUuid, { syncStatus: 'synced', syncedAt: new Date().toISOString() });
              }
              uploaded++;
            }
          }

          // Process duplicates (server already has it — treat as synced)
          for (const dup of result.duplicates) {
            const item = batch.find((b) => b.offlineUuid === dup.id);
            if (item) {
              markSynced(item.queueId, new Date().toISOString());
              if (item.appLabel === 'sales') {
                updateSaleSync(item.offlineUuid, { syncStatus: 'synced', syncedAt: new Date().toISOString() });
              }
              uploaded++;
            }
          }

          // Process conflicts
          for (const conflict of result.conflicts) {
            const item = batch.find((b) => b.offlineUuid === conflict.id);
            if (item) {
              markConflict(item.queueId, conflict.reason ?? 'Server conflict');
              if (item.appLabel === 'sales') {
                updateSaleSync(item.offlineUuid, { syncStatus: 'conflict' });
              }
            }
          }

          // Process errors — mark as failed for retry
          for (const err of result.errors) {
            const item = batch.find((b) => (b.payload.id as string) === err.record_id || b.offlineUuid === err.record_id);
            if (item) {
              markFailed(item.queueId, err.error);
              if (item.appLabel === 'sales') {
                updateSaleSync(item.offlineUuid, { syncStatus: 'failed', syncError: err.error });
              }
              errors++;
            }
          }

        } catch (err: unknown) {
          // Network / auth error — mark all in batch as failed
          const msg = (err as { message?: string }).message ?? 'Network error';
          // 401 = token expired — pause sync, don't spam
          const status = (err as { response?: { status?: number } }).response?.status;
          if (status === 401) {
            for (const item of batch) markFailed(item.queueId, 'Authentication expired — re-login required');
            break; // stop the whole cycle
          }
          for (const item of batch) {
            markFailed(item.queueId, msg);
            if (item.appLabel === 'sales') updateSaleSync(item.offlineUuid, { syncStatus: 'failed', syncError: msg });
            errors++;
          }
        }
      }

      // ── 3. Download cloud changes ─────────────────────────────────────────
      try {
        const dlResult = await syncService.downloadChanges({
          device_id: deviceId,
          since:     lastSyncAt ?? undefined,
        });
        downloaded = dlResult.count;
        // If the server returned any records (business/settings/license changes
        // made by the POPMYC admin), re-fetch business settings from the backend
        // so the local store reflects the latest values immediately.
        if (downloaded > 0) {
          void syncSettingsFromBackend();
        }
      } catch { /* download failing is non-fatal — will retry next cycle */ }

      // ── 4. Update cursor ──────────────────────────────────────────────────
      const ts = new Date().toISOString();
      setLastSyncAt(ts);

      // ── 5. Prune old synced items ─────────────────────────────────────────
      pruneQueue();

      // ── 6. Log ────────────────────────────────────────────────────────────
      appendLog({
        direction:       'upload',
        status:          errors > 0 ? 'partial' : 'success',
        itemsUploaded:   uploaded,
        itemsDownloaded: downloaded,
        errors,
      });

      lastAutoSyncRef.current = Date.now();

    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Unexpected sync error';
      appendLog({ direction: 'upload', status: 'failed', itemsUploaded: 0, itemsDownloaded: 0, errors: 1, errorDetail: msg });
    } finally {
      setIsSyncing(false);
      syncRunningRef.current = false;
    }
  }, [queue, deviceId, lastSyncAt, accessToken, markSyncing, markSynced, markFailed, markConflict, setIsSyncing, setLastSyncAt, pruneQueue, appendLog, updateSaleSync, syncSettingsFromBackend]);

  // ── Auto-sync when coming back online ─────────────────────────────────────
  useEffect(() => {
    if (!isOnline) return;
    const timeSinceLastSync = Date.now() - lastAutoSyncRef.current;
    if (timeSinceLastSync < MIN_SYNC_INTERVAL) return;
    void syncNow();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // ── Periodic sync every 30s when online — always, not just when pending ──
  // This ensures business_category / inventory_mode / license changes made
  // by the POPMYC admin in the cloud Django panel are downloaded promptly.
  useEffect(() => {
    const iv = setInterval(() => {
      if (!isOnline || syncRunningRef.current) return;
      void syncNow();
    }, 30_000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    failedCount,
    conflictCount,
    lastSyncAt,
    syncNow,
    requeueFailed,
  };
}
