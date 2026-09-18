/**
 * sync.store.ts
 * =============
 * Offline-first synchronization state for POPMYC POS.
 *
 * Responsibilities:
 *  - Maintain an outbox queue of pending sync items (persisted to localStorage)
 *  - Track per-item sync lifecycle: pending → syncing → synced / failed / conflict
 *  - Track retry count, last attempt, and error per item
 *  - Maintain a conflict log for items requiring manual resolution
 *  - Expose aggregate stats for the SyncStatusIndicator
 *  - Store the device UUID (stable, generated once per browser)
 *  - Track last successful sync timestamp
 *
 * The sync engine (useSync hook) reads from this store and drives state changes.
 * Business logic stores (sales, expenses, etc.) enqueue items here.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SyncItemStatus =
  | 'pending'    // created locally, not yet attempted
  | 'syncing'    // currently being uploaded
  | 'synced'     // confirmed by server
  | 'failed'     // upload attempted but failed (will retry)
  | 'conflict';  // server reported a conflict (requires resolution)

export type SyncDirection = 'upload' | 'download';

export interface SyncQueueItem {
  /** Unique ID of this queue entry (distinct from the record's own ID) */
  queueId:      string;
  /** Globally unique identifier for the actual record — used as idempotency key */
  offlineUuid:  string;
  /** Django app label, e.g. "sales" */
  appLabel:     string;
  /** Django model name, e.g. "Sale" */
  modelName:    string;
  /** sync action */
  action:       'create' | 'update' | 'delete';
  /** Full record payload to upload */
  payload:      Record<string, unknown>;
  /** Business UUID */
  businessId:   string | null;
  /** Branch UUID */
  branchId:     string | null;
  /** Version counter (incremented on each update to the same record) */
  version:      number;
  /** Current sync lifecycle state */
  status:       SyncItemStatus;
  /** Number of upload attempts */
  attempts:     number;
  /** ISO timestamp of last attempt */
  lastAttemptAt: string | null;
  /** Last error message */
  lastError:    string | null;
  /** ISO timestamp when created locally */
  createdAt:    string;
  /** ISO timestamp when successfully confirmed by server */
  syncedAt:     string | null;
}

export interface SyncConflict {
  queueId:      string;
  offlineUuid:  string;
  appLabel:     string;
  modelName:    string;
  serverReason: string;
  localPayload: Record<string, unknown>;
  detectedAt:   string;
  resolvedAt:   string | null;
  resolution:   'keep_local' | 'keep_server' | null;
}

export interface SyncLogEntry {
  id:          string;
  direction:   SyncDirection;
  status:      'success' | 'partial' | 'failed';
  itemsUploaded:   number;
  itemsDownloaded: number;
  errors:      number;
  timestamp:   string;
  errorDetail?: string;
}

interface SyncStore {
  /** Stable device UUID — generated once and persisted */
  deviceId: string;
  /** ISO timestamp of last fully successful sync cycle */
  lastSyncAt: string | null;
  /** Whether a sync cycle is currently running */
  isSyncing: boolean;
  /** The outbox queue */
  queue: SyncQueueItem[];
  /** Conflict log */
  conflicts: SyncConflict[];
  /** Sync history (last 50 entries) */
  log: SyncLogEntry[];

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Add a new item to the outbox queue (idempotent — skips if offlineUuid already queued) */
  enqueue: (item: Omit<SyncQueueItem, 'queueId' | 'status' | 'attempts' | 'lastAttemptAt' | 'lastError' | 'createdAt' | 'syncedAt'>) => void;
  /** Mark an item as currently syncing */
  markSyncing: (queueId: string) => void;
  /** Mark an item as successfully synced */
  markSynced: (queueId: string, syncedAt?: string) => void;
  /** Mark an item as failed with an error */
  markFailed: (queueId: string, error: string) => void;
  /** Mark an item as a conflict and add to conflict log */
  markConflict: (queueId: string, serverReason: string) => void;
  /** Remove synced items older than 24h from queue to keep it trim */
  pruneQueue: () => void;
  /** Resolve a conflict */
  resolveConflict: (queueId: string, resolution: SyncConflict['resolution']) => void;
  /** Set the isSyncing flag */
  setIsSyncing: (v: boolean) => void;
  /** Update last sync timestamp */
  setLastSyncAt: (ts: string) => void;
  /** Append a log entry (keeps last 50) */
  appendLog: (entry: Omit<SyncLogEntry, 'id' | 'timestamp'>) => void;
  /** Reset all failed items back to pending for retry */
  requeueFailed: () => void;

  // ── Computed helpers ──────────────────────────────────────────────────────
  pendingCount:   () => number;
  failedCount:    () => number;
  conflictCount:  () => number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function genUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `dev-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function genDeviceId(): string {
  // Derive a stable device ID from browser fingerprint + random
  const nav  = navigator.userAgent + navigator.language + screen.width + screen.height;
  let hash   = 0;
  for (let i = 0; i < nav.length; i++) hash = (hash * 31 + nav.charCodeAt(i)) | 0;
  return `device-${Math.abs(hash).toString(16)}-${Date.now().toString(16)}`;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSyncStore = create<SyncStore>()(
  persist(
    (set, get) => ({
      deviceId:   genDeviceId(),
      lastSyncAt: null,
      isSyncing:  false,
      queue:      [],
      conflicts:  [],
      log:        [],

      enqueue: (item) => {
        // Idempotent: skip if this offlineUuid is already in the queue with pending/syncing/failed
        const existing = get().queue.find(
          (q) => q.offlineUuid === item.offlineUuid && q.appLabel === item.appLabel && q.modelName === item.modelName
        );
        if (existing && existing.status !== 'synced') return;

        const entry: SyncQueueItem = {
          ...item,
          queueId:       genUuid(),
          status:        'pending',
          attempts:      0,
          lastAttemptAt: null,
          lastError:     null,
          createdAt:     new Date().toISOString(),
          syncedAt:      null,
        };
        set((s) => ({ queue: [...s.queue, entry] }));
      },

      markSyncing: (queueId) => {
        set((s) => ({
          queue: s.queue.map((q) =>
            q.queueId === queueId
              ? { ...q, status: 'syncing', lastAttemptAt: new Date().toISOString() }
              : q
          ),
        }));
      },

      markSynced: (queueId, syncedAt) => {
        const ts = syncedAt ?? new Date().toISOString();
        set((s) => ({
          queue: s.queue.map((q) =>
            q.queueId === queueId
              ? { ...q, status: 'synced', syncedAt: ts, lastError: null }
              : q
          ),
        }));
      },

      markFailed: (queueId, error) => {
        set((s) => ({
          queue: s.queue.map((q) =>
            q.queueId === queueId
              ? { ...q, status: 'failed', attempts: q.attempts + 1, lastError: error, lastAttemptAt: new Date().toISOString() }
              : q
          ),
        }));
      },

      markConflict: (queueId, serverReason) => {
        const item = get().queue.find((q) => q.queueId === queueId);
        if (!item) return;
        const conflict: SyncConflict = {
          queueId,
          offlineUuid:  item.offlineUuid,
          appLabel:     item.appLabel,
          modelName:    item.modelName,
          serverReason,
          localPayload: item.payload,
          detectedAt:   new Date().toISOString(),
          resolvedAt:   null,
          resolution:   null,
        };
        set((s) => ({
          queue:     s.queue.map((q) => q.queueId === queueId ? { ...q, status: 'conflict' } : q),
          conflicts: [conflict, ...s.conflicts].slice(0, 200),
        }));
      },

      pruneQueue: () => {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
        set((s) => ({
          queue: s.queue.filter(
            (q) => q.status !== 'synced' || new Date(q.syncedAt ?? 0).getTime() > cutoff
          ),
        }));
      },

      resolveConflict: (queueId, resolution) => {
        set((s) => ({
          conflicts: s.conflicts.map((c) =>
            c.queueId === queueId
              ? { ...c, resolution, resolvedAt: new Date().toISOString() }
              : c
          ),
          queue: resolution === 'keep_local'
            ? s.queue.map((q) => q.queueId === queueId ? { ...q, status: 'pending' } : q)
            : s.queue.map((q) => q.queueId === queueId ? { ...q, status: 'synced', syncedAt: new Date().toISOString() } : q),
        }));
      },

      setIsSyncing: (v) => set(() => ({ isSyncing: v })),

      setLastSyncAt: (ts) => set(() => ({ lastSyncAt: ts })),

      appendLog: (entry) => {
        const full: SyncLogEntry = {
          ...entry,
          id:        genUuid(),
          timestamp: new Date().toISOString(),
        };
        set((s) => ({ log: [full, ...s.log].slice(0, 50) }));
      },

      requeueFailed: () => {
        set((s) => ({
          queue: s.queue.map((q) =>
            q.status === 'failed' ? { ...q, status: 'pending' } : q
          ),
        }));
      },

      pendingCount:  () => get().queue.filter((q) => q.status === 'pending' || q.status === 'syncing').length,
      failedCount:   () => get().queue.filter((q) => q.status === 'failed').length,
      conflictCount: () => get().queue.filter((q) => q.status === 'conflict').length,
    }),
    {
      name: 'popmyc-sync-store',
      // Only persist the queue, conflicts and log — NOT isSyncing (reset on boot)
      partialize: (s) => ({
        deviceId:   s.deviceId,
        lastSyncAt: s.lastSyncAt,
        queue:      s.queue,
        conflicts:  s.conflicts,
        log:        s.log,
      }),
    }
  )
);
