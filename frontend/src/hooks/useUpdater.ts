/**
 * useUpdater.ts
 * =============
 * React hook that tracks the Electron auto-updater state.
 * Safe to call in web/browser mode — returns idle state when
 * window.popmycDesktop is not available.
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
  const listenerAttached = useRef(false);

  const desktop = typeof window !== 'undefined' ? window.popmycDesktop : undefined;

  // Bootstrap: fetch current state on mount AND subscribe to future pushes.
  // Fetching on mount handles the race where the update check fired before
  // React mounted (e.g. fast machine, update check fires at 15s, React
  // mounts at 8s but finishes routing at 14s).
  useEffect(() => {
    if (!desktop) return;

    // 1. Pull current state immediately
    void desktop.updaterGetState().then((s: Partial<UpdaterInfo>) => {
      setInfo(prev => ({ ...prev, ...s }));
    }).catch(() => {});

    // 2. Also poll every 5s for the first 60s after mount — catches the
    //    initial update check result even if the push event was missed.
    let polls = 0;
    const pollId = setInterval(() => {
      polls++;
      if (polls > 12) { clearInterval(pollId); return; } // stop after 60s
      void desktop.updaterGetState().then((s: Partial<UpdaterInfo>) => {
        setInfo(prev => {
          // Only update if state actually changed — avoids re-renders
          if (s.state && s.state !== prev.state) return { ...prev, ...s };
          if (s.updateVersion && s.updateVersion !== prev.updateVersion) return { ...prev, ...s };
          return prev;
        });
      }).catch(() => {});
    }, 5_000);

    // 3. Subscribe to pushed state changes from main process
    if (!listenerAttached.current) {
      listenerAttached.current = true;
      desktop.onUpdaterState?.((data: Partial<UpdaterInfo>) => {
        setInfo(prev => ({ ...prev, ...data }));
      });
    }

    return () => clearInterval(pollId);
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
