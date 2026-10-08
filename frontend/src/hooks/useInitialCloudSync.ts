/**
 * useInitialCloudSync.ts
 * ======================
 * Thin React hook that drives runInitialCloudSync() and returns a status
 * value suitable for passing to InitialSyncToast.
 *
 * Runs at most once per session (guarded by both the localStorage flag and
 * a React ref so React StrictMode double-invocation is harmless).
 */

import { useState, useEffect, useRef } from 'react';
import { runInitialCloudSync, isInitialSyncDone } from '@/services/initialSync.service';
import { isLocalSession } from '@/services/sync.service';
import { IS_PWA } from '@/utils/constants';
import type { InitialSyncStatus } from '@/components/sync/InitialSyncToast';

export function useInitialCloudSync(enabled: boolean): { status: InitialSyncStatus } {
  const [status, setStatus] = useState<InitialSyncStatus>('idle');
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    // Skip immediately if any guard condition is true
    if (IS_PWA) return;
    if (isInitialSyncDone()) return;
    if (isLocalSession()) return;

    setStatus('syncing');
    void runInitialCloudSync()
      .then(() => {
        setStatus('done');
        setTimeout(() => setStatus('idle'), 3000);
      })
      .catch(() => {
        // Errors already logged inside runInitialCloudSync
        setStatus('idle');
      });
  }, [enabled]);

  return { status };
}
