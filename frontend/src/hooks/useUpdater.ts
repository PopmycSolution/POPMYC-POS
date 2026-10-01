/**
 * useUpdater.ts
 * =============
 * React hook that tracks Electron auto-updater state.
 * Safe in web/browser mode — returns idle when window.popmycDesktop is absent.
 *
 * Flow (Kiro-style):
 *   app starts → check (3s) → download automatically → state='ready'
 *   → UpdateToast shows banner → user clicks Restart & Update → done
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'no-update'
  | 'error';

export interface UpdaterInfo {
  state: UpdaterState;
  version: string;
  updateVersion: string | null;
  releaseNotes: string | null;
  progress: { percent: number; bytesPerSecond: number; total: number; transferred: number } | null;
}

const DEFAULT: UpdaterInfo = {
  state: 'idle',
  version: '—',
  updateVersion: null,
  releaseNotes: null,
  progress: null,
};

export function useUpdater() {
  const [info, setInfo] = useState<UpdaterInfo>(DEFAULT);
  const listenerRef    = useRef(false);
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);

  const desktop = typeof window !== 'undefined' ? window.popmycDesktop : undefined;

  useEffect(() => {
    if (!desktop) return;

    // 1. Fetch current state immediately on mount
    void desktop.updaterGetState().then((s: Partial<UpdaterInfo>) => {
      setInfo(prev => ({ ...prev, ...s }));
    }).catch(() => {});

    // 2. Subscribe to pushed state changes from main process (one-time)
    if (!listenerRef.current) {
      listenerRef.current = true;
      desktop.onUpdaterState?.((data: Partial<UpdaterInfo>) => {
        setInfo(prev => ({ ...prev, ...data }));
      });
    }

    // 3. Poll every 3s for the first 30s to catch state emitted before React
    //    finished mounting (race condition on first launch).
    //    After 30s stop — the push listener handles everything from there.
    let polls = 0;
    pollRef.current = setInterval(() => {
      polls++;
      if (polls >= 10) {
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      void desktop.updaterGetState().then((s: Partial<UpdaterInfo>) => {
        setInfo(prev => {
          if (!s.state) return prev;
          if (s.state === prev.state && s.updateVersion === prev.updateVersion) return prev;
          return { ...prev, ...s };
        });
      }).catch(() => {});
    }, 3_000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkNow = useCallback(async () => {
    if (!desktop) return;
    try {
      const s = await desktop.updaterCheckNow();
      setInfo(prev => ({ ...prev, ...s }));
    } catch { /* ignore */ }
  }, [desktop]);

  const download = useCallback(async () => {
    if (!desktop) return;
    await desktop.updaterDownload?.().catch(() => {});
  }, [desktop]);

  const install = useCallback(() => {
    if (!desktop) return;
    desktop.updaterInstall?.();
  }, [desktop]);

  return { ...info, checkNow, download, install, isDesktop: !!desktop };
}
