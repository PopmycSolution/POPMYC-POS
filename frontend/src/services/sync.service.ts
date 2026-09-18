/**
 * sync.service.ts
 * ===============
 * HTTP calls to the synchronization API.
 *
 * Endpoints (all at /api/sync/):
 *   POST  /api/sync/upload/   → upload queue items to cloud
 *   GET   /api/sync/download/ → download cloud changes
 *   POST  /api/sync/device/   → register / update device
 *   GET   /api/sync/status/   → quick queue summary
 *
 * All functions are idempotent-safe:
 *  - The server deduplicates by `id` (sync envelope UUID) and returns
 *    accepted/duplicates lists so the client can mark accordingly.
 *  - The client never retransmits a `synced` item.
 */

import api from './api';
import type { SyncQueueItem } from '@/stores/sync.store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadPayload {
  records: Array<{
    id:          string;   // sync envelope UUID (idempotency key = offlineUuid)
    record_id:   string;   // actual record UUID
    app_label:   string;
    model_name:  string;
    device_id:   string;
    business_id: string | null;
    branch_id:   string | null;
    action:      'create' | 'update' | 'delete';
    version:     number;
    payload:     Record<string, unknown>;
  }>;
}

export interface UploadResult {
  success:    boolean;
  accepted:   Array<{ id: string; record_id: string; version: number; action: string; status: string }>;
  duplicates: Array<{ id: string; record_id: string; reason: string }>;
  conflicts:  Array<{ id: string; record_id: string; reason: string }>;
  errors:     Array<{ record_id: string; error: string }>;
  summary: {
    received:   number;
    accepted:   number;
    duplicates: number;
    conflicts:  number;
    errors:     number;
  };
}

export interface DownloadRecord {
  id:         string;
  record_id:  string;
  app_label:  string;
  model_name: string;
  action:     string;
  status:     string;
  version:    number;
  payload:    Record<string, unknown>;
  updated_at: string;
  synced_at:  string | null;
}

export interface DownloadResult {
  success:     boolean;
  records:     DownloadRecord[];
  count:       number;
  server_time: string;
}

export interface DeviceRegistrationResult {
  success: boolean;
  created: boolean;
  device: {
    id:          string;
    device_id:   string;
    name:        string;
    business_id: string | null;
    branch_id:   string | null;
    last_sync_at: string | null;
    is_active:   boolean;
    created_at:  string;
    updated_at:  string;
  };
}

export interface SyncStatusResult {
  pending:     number;
  syncing:     number;
  synced:      number;
  failed:      number;
  conflict:    number;
  last_sync_at: string | null;
  server_time: string;
}

// ── Service calls ─────────────────────────────────────────────────────────────

/**
 * Upload a batch of pending queue items to the cloud.
 * The server processes each item idempotently.
 */
export async function uploadBatch(
  items:    SyncQueueItem[],
  deviceId: string,
): Promise<UploadResult> {
  const payload: UploadPayload = {
    records: items.map((item) => ({
      id:          item.offlineUuid,  // idempotency key = stable client UUID
      record_id:   item.payload.id as string ?? item.offlineUuid,
      app_label:   item.appLabel,
      model_name:  item.modelName,
      device_id:   deviceId,
      business_id: item.businessId,
      branch_id:   item.branchId,
      action:      item.action,
      version:     item.version,
      payload:     item.payload,
    })),
  };
  const res = await api.post<UploadResult>('/sync/upload/', payload);
  return res.data;
}

/**
 * Download cloud changes since a given timestamp.
 * Returns records that other devices have synced up.
 */
export async function downloadChanges(params: {
  since?:       string;
  device_id?:   string;
  business_id?: string;
  branch_id?:   string;
}): Promise<DownloadResult> {
  const res = await api.get<DownloadResult>('/sync/download/', { params });
  return res.data;
}

/**
 * Register or update the current device on the cloud.
 * Must be called before the first upload.
 */
export async function registerDevice(params: {
  device_id:   string;
  name?:       string;
  business_id?: string | null;
  branch_id?:  string | null;
}): Promise<DeviceRegistrationResult> {
  const res = await api.post<DeviceRegistrationResult>('/sync/device/', params);
  return res.data;
}

/**
 * Fetch a quick summary of the cloud sync queue for this device.
 */
export async function fetchSyncStatus(params: {
  device_id?:   string;
  business_id?: string;
}): Promise<SyncStatusResult> {
  const res = await api.get<SyncStatusResult>('/sync/status/', { params });
  return res.data;
}

// ── Exponential backoff helper ─────────────────────────────────────────────────

/**
 * Returns the delay in ms before the next retry, using exponential backoff
 * with jitter. Max 5 minutes.
 *
 * attempts 0 → 2s, 1 → 4s, 2 → 8s, 3 → 16s, 4 → 32s … max 300s
 */
export function retryDelayMs(attempts: number): number {
  const base  = 2000;                              // 2 seconds
  const cap   = 300_000;                           // 5 minutes
  const delay = Math.min(base * Math.pow(2, attempts), cap);
  // Add ±25% jitter to prevent thundering herd
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

// ── isLocalSession helper (re-used from other services) ──────────────────────

export function isLocalSession(): boolean {
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
}
