/**
 * useUpdater.ts
 * =============
 * React hook that tracks the Electron auto-updater state.
 * Safe to call in web/browser mode — returns idle state when
 * window.popmycDesktop is not available.
 *
 * Usage:
 *   const { state, updateVersion, checkNow, download, install } = useUpdater();
 */

import { useCallback, useEffect, useState } from 'react';

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

  const desktop = typeof window !== 'undefined' ? window.popmycDesktop : undefined;

  // Bootstrap: fetch current state on mount
  useEffect(() => {
    if (!desktop) return;
    void desktop.updaterGetState().then((s: Partial<UpdaterInfo>) => {
      setInfo(prev => ({ ...prev, ...s }));
    }).catch(() => { /* silently ignore */ });

    // Listen for pushed updates from Electron main process
    desktop.onUpdaterState?.((data: Partial<UpdaterInfo> & { progress?: UpdaterInfo['progress'] }) => {
      setInfo(prev => ({ ...prev, ...data }));
    });
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
