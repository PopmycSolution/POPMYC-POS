/**
 * InitialSyncToast.tsx
 * ====================
 * Non-blocking toast that shows while the one-shot initial cloud sync runs.
 *
 * Visual language matches UpdateToast.tsx:
 *   - bottom-right, z-[9997] (one below UpdateToast's 9998)
 *   - rounded-2xl card, white background, teal gradient top bar
 *   - slide-in animation
 *
 * Auto-dismisses 3 seconds after status changes to 'done'.
 * Never renders when status is 'idle'.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';

export type InitialSyncStatus = 'idle' | 'syncing' | 'done';

interface InitialSyncToastProps {
  status: InitialSyncStatus;
}

export default function InitialSyncToast({ status }: InitialSyncToastProps) {
  const [visible, setVisible] = useState(false);

  // Slide-in when status becomes active; slide-out when idle
  useEffect(() => {
    if (status === 'idle') {
      setVisible(false);
      return;
    }
    // Small delay so the animation is perceptible
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, [status]);

  if (status === 'idle') return null;

  const isSyncing = status === 'syncing';

  return (
    <div
      className={clsx(
        'fixed bottom-5 right-5 z-[9997] w-[320px] rounded-2xl overflow-hidden shadow-2xl',
        'transition-all duration-500 ease-out',
        visible
          ? 'translate-y-0 opacity-100'
          : 'translate-y-6 opacity-0 pointer-events-none',
      )}
      style={{ background: 'white', border: '1px solid #e2e8f0' }}
      role="status"
      aria-live="polite"
    >
      {/* Teal gradient bar */}
      <div
        className="h-0.5 w-full"
        style={{ background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }}
      />

      <div className="px-4 py-3.5 flex items-center gap-3">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50">
          {isSyncing ? (
            <RefreshCw className="h-4 w-4 text-[#00897B] animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#00897B]" />
          )}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800 truncate">
            {isSyncing ? 'Syncing your data to the cloud…' : 'Data synced to cloud ✓'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {isSyncing
              ? 'Running in the background — keep using the app.'
              : 'All set! Your data is now on the cloud.'}
          </p>
        </div>
      </div>
    </div>
  );
}
