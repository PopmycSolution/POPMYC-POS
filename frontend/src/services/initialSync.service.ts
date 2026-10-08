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
import api from './api';
import { useSyncStore } from '@/stores/sync.store';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
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

// ── Settings helper (reads from settings store for business registration) ─────
function useSettingsStoreForSync() {
  const s = useSettingsStore.getState();
  return {
    businessName:     s.business.name,
    businessCategory: s.business.businessCategory,
    address:          s.business.address,
    phone:            s.business.phone,
    email:            s.business.email,
    currency:         s.business.currency,
    currencySymbol:   s.business.currencySymbol,
    branchName:       (s as unknown as Record<string, unknown>).activeBranchName as string | undefined,
  };
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function isInitialSyncDone(): boolean {
  return localStorage.getItem(FLAG_KEY) === 'true';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getAuthContext(): { businessId: string | null; branchId: string | null } {
  // The business UUID is stored in the sync queue items and also in the
  // popmyc-auth-storage state under user.business (set by the backend login response).
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    const parsed = stored
      ? (JSON.parse(stored) as { state?: { user?: { business?: string; branch?: string } } })
      : undefined;
    const business = parsed?.state?.user?.business ?? null;
    const branch   = parsed?.state?.user?.branch   ?? null;
    if (business) return { businessId: business, branchId: branch };
  } catch { /* noop */ }
  // Secondary fallback: check the auth store in memory
  const user = useAuthStore.getState().user;
  const branchId = user?.branch ?? null;
  // business field may not be on the User type but may be present at runtime
  // (the backend login response includes it)
  const businessId = (user as unknown as Record<string, unknown>)?.['business'] as string | null ?? null;
  return { businessId, branchId };
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
): Promise<number> {
  let pushed = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const result = await uploadBatch(batch, deviceId);
      pushed += result.accepted.length + result.duplicates.length;
    } catch (err: unknown) {
      const isAxiosErr = (e: unknown): e is { response?: { status?: number } } =>
        typeof e === 'object' && e !== null && 'response' in e;

      if (isAxiosErr(err)) {
        const status = err.response?.status ?? 0;
        if (status >= 400 && status < 500) {
          // 4xx (conflict/validation) — skip this batch and continue with the next
          continue;
        }
      }
      // Genuine network error or 5xx — rethrow so caller can skip done-flag
      throw err;
    }
  }
  return pushed;
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
export async function runInitialCloudSync(): Promise<number> {
  // Guards
  if (IS_PWA) return 0;
  if (isInitialSyncDone()) return 0;
  if (isLocalSession()) return 0;

  const { businessId, branchId } = getAuthContext();
  const deviceId = useSyncStore.getState().deviceId;

  // ── Step 0: Register the business on the cloud ────────────────────────────
  // This ensures the Business, Branch, and admin user exist on Render before
  // we push products/customers. Idempotent — safe to call multiple times.
  try {
    const settings = useSettingsStoreForSync();
    if (settings.businessName && businessId) {
      await api.post('/cloud/trial/register-business/', {
        business_id:       businessId,
        name:              settings.businessName,
        business_category: settings.businessCategory ?? 'GENERAL_RETAIL',
        address:           settings.address ?? '',
        phone:             settings.phone ?? '',
        email:             settings.email ?? '',
        currency:          settings.currency ?? 'GHS',
        currency_symbol:   settings.currencySymbol ?? 'GH₵',
        branch_id:         branchId ?? undefined,
        branch_name:       settings.branchName ?? 'Main Branch',
        branch_code:       'HQ',
        admin_username:    useAuthStore.getState().user?.email ?? '',
        admin_email:       useAuthStore.getState().user?.email ?? '',
        admin_first_name:  useAuthStore.getState().user?.firstName ?? '',
        admin_last_name:   useAuthStore.getState().user?.lastName ?? '',
      });
      console.info(LOG_PREFIX, 'business registered on cloud');
    }
  } catch {
    // Non-fatal — business may already exist (409) or cloud may be down
    // Products/customers sync will still work if business already exists
  }

  // Register device before first batch (same pattern as useSync.ts)
  try {
    await registerDevice({ device_id: deviceId, business_id: businessId, branch_id: branchId });
  } catch (err: unknown) {
    console.warn(LOG_PREFIX, 'device registration failed — aborting initial sync', err);
    return 0;
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

  // Guard: require a business ID — without it records would be uploaded
  // without business association and be invisible to the user.
  if (!businessId) {
    console.warn(LOG_PREFIX, 'no businessId found — skipping initial sync (will retry on next login)');
    return 0;
  }

  try {
    let totalPushed = 0;
    for (const { records, appLabel, modelName } of entities) {
      if (records.length === 0) continue;
      const items = records.map((r) =>
        toQueueItem(r, appLabel, modelName, businessId, branchId),
      );
      totalPushed += await pushBatches(items, deviceId);
    }
    localStorage.setItem(FLAG_KEY, 'true');
    console.info(LOG_PREFIX, `initial sync complete — ${totalPushed} records pushed`);
    return totalPushed;
  } catch (err) {
    console.warn(LOG_PREFIX, 'initial sync failed — will retry on next login', err);
    return 0;
  }
}
