/**
 * initialSync.service.ts
 * ======================
 * One-shot background push of all existing local data to the cloud backend.
 *
 * Triggered once per installation (flagged in localStorage).
 * Only runs on the desktop app — PWA users are already on the cloud.
 * Local-demo sessions are skipped entirely.
 *
 * Uses the existing uploadBatch() / registerDevice() infrastructure so the
 * payload shape is identical to the normal sync queue.
 */

import { uploadBatch, registerDevice, isLocalSession } from './sync.service';
import { useSyncStore } from '@/stores/sync.store';
import { useProductStore } from '@/stores/product.store';
import { useCategoryStore } from '@/stores/category.store';
import { useBrandStore } from '@/stores/brand.store';
import { useUnitStore } from '@/stores/unit.store';
import { useCustomerStore } from '@/stores/customer.store';
import { useSupplierStore } from '@/stores/supplier.store';
import { IS_PWA } from '@/utils/constants';
import type { SyncQueueItem } from '@/stores/sync.store';

// ── Constants ─────────────────────────────────────────────────────────────────

const FLAG_KEY = 'popmyc-cloud-initial-sync-done';
const BATCH_SIZE = 25;
const LOG_PREFIX = '[POPMYC initial-sync]';

// ── Public helpers ────────────────────────────────────────────────────────────

export function isInitialSyncDone(): boolean {
  return localStorage.getItem(FLAG_KEY) === 'true';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const auth = stored
      ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } }).state
      : undefined;
    return {
      businessId: auth?.user?.business ?? null,
      branchId: auth?.user?.branch ?? null,
    };
  } catch {
    return { businessId: null, branchId: null };
  }
}

function toQueueItem(
  record: Record<string, unknown>,
  appLabel: string,
  modelName: string,
  businessId: string | null,
  branchId: string | null,
): SyncQueueItem {
  return {
    queueId: crypto.randomUUID(),
    offlineUuid: record.id as string,
    appLabel,
    modelName,
    action: 'create',
    payload: record,
    businessId,
    branchId,
    version: 1,
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
  };
}

async function pushBatches(
  items: SyncQueueItem[],
  deviceId: string,
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      await uploadBatch(batch, deviceId);
    } catch (err: unknown) {
      // Network error / 5xx — log and stop this entity group; do not set done flag
      const isAxiosErr = (e: unknown): e is { response?: { status?: number } } =>
        typeof e === 'object' && e !== null && 'response' in e;

      if (isAxiosErr(err)) {
        const status = err.response?.status ?? 0;
        if (status >= 400 && status < 500) {
          // 4xx (including 400/409 conflict) — swallow and continue
          return;
        }
      }
      // Genuine network error or 5xx — rethrow so caller can skip done-flag
      throw err;
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Push all local store data to the cloud backend.
 *
 * - Idempotent: guarded by localStorage flag; safe to call multiple times.
 * - Silent: 400/409/conflict responses are swallowed.
 * - Non-blocking: caller should `void` this call.
 * - Desktop only: IS_PWA guard skips the call immediately on web.
 */
export async function runInitialCloudSync(): Promise<void> {
  // Guards
  if (IS_PWA) return;
  if (isInitialSyncDone()) return;
  if (isLocalSession()) return;

  const { businessId, branchId } = getAuthContext();
  const deviceId = useSyncStore.getState().deviceId;

  // Register device before first batch (same pattern as useSync.ts)
  try {
    await registerDevice({ device_id: deviceId, business_id: businessId, branch_id: branchId });
  } catch (err: unknown) {
    console.warn(LOG_PREFIX, 'device registration failed — aborting initial sync', err);
    return;
  }

  // ── Entity groups (order matters: catalog before products) ────────────────

  const entities: Array<{
    records: Record<string, unknown>[];
    appLabel: string;
    modelName: string;
  }> = [
    {
      records: useCategoryStore.getState().categories as unknown as Record<string, unknown>[],
      appLabel: 'products',
      modelName: 'category',
    },
    {
      records: useBrandStore.getState().brands as unknown as Record<string, unknown>[],
      appLabel: 'products',
      modelName: 'brand',
    },
    {
      records: useUnitStore.getState().units as unknown as Record<string, unknown>[],
      appLabel: 'products',
      modelName: 'unitofmeasure',
    },
    {
      records: useProductStore.getState().products as unknown as Record<string, unknown>[],
      appLabel: 'products',
      modelName: 'product',
    },
    {
      records: useCustomerStore.getState().customers as unknown as Record<string, unknown>[],
      appLabel: 'customers',
      modelName: 'customer',
    },
    {
      records: useSupplierStore.getState().suppliers as unknown as Record<string, unknown>[],
      appLabel: 'suppliers',
      modelName: 'supplier',
    },
  ];

  try {
    for (const { records, appLabel, modelName } of entities) {
      if (records.length === 0) continue;

      const items = records.map((r) =>
        toQueueItem(r, appLabel, modelName, businessId, branchId),
      );

      await pushBatches(items, deviceId);
    }

    // All entities processed — set the done flag
    localStorage.setItem(FLAG_KEY, 'true');
  } catch (err) {
    // Transient error — do NOT set done flag so the next login retries
    console.warn(LOG_PREFIX, 'initial sync failed — will retry on next login', err);
  }
}
