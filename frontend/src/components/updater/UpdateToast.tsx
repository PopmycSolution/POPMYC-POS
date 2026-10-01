/**
 * UpdateToast.tsx
 * ===============
 * In-app update UI — mirrors the exact flow:
 *
 *   available   → native popup already shown by main.js (Accept or Later)
 *                 If user clicked Later → small reminder banner stays visible
 *   downloading → thin progress bar at top of screen
 *   ready       → header button (in MainLayout) is permanently shown
 *                 This component shows nothing extra when ready — the header
 *                 button is the CTA
 *
 * The "Accept" popup and actual install are handled by main.js native dialogs.
 * This file handles only the in-app visual feedback.
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Download, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useUpdater } from '@/hooks/useUpdater';

export default function UpdateToast() {
  const updater = useUpdater();
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [visible, setVisible] = useState(false);

  // Reset dismissal when a new update version arrives
  useEffect(() => {
    if (updater.state === 'available') {
      setReminderDismissed(false);
    }
  }, [updater.state, updater.updateVersion]);

  // Slide-in animation
  useEffect(() => {
    const show = updater.state === 'available' && !reminderDismissed;
    if (show) {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [updater.state, reminderDismissed]);

  if (!updater.isDesktop) return null;

  const pct = Math.round(updater.progress?.percent ?? 0);

  return (
    <>
      {/* ── Thin progress bar at top while downloading ── */}
      {updater.state === 'downloading' && (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-1">
          <div
            className="h-full transition-[width] duration-500 ease-out"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, #00897B, #4ECCA3, #00FFAA)',
            }}
          />
        </div>
      )}

      {/* ── "Available" reminder banner (if user dismissed the native popup) ── */}
      {updater.state === 'available' && !reminderDismissed && (
        <div
          className={clsx(
            'fixed bottom-5 right-5 z-[9998] w-[340px] rounded-2xl overflow-hidden shadow-2xl',
            'transition-all duration-500 ease-out',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none',
          )}
          style={{ background: 'white', border: '1px solid #e2e8f0' }}
        >
          <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }} />
          <div className="px-4 py-3.5 flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50">
              <Download className="h-4.5 w-4.5 text-[#00897B]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">
                Update available — v{updater.updateVersion ?? '...'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Click Accept to download in the background.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => void updater.download()}
                className="h-8 px-3 rounded-lg text-xs font-bold text-white"
                style={{ background: '#00897B' }}
              >
                Accept
              </button>
              <button
                onClick={() => setReminderDismissed(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Downloading progress pill (bottom-right, subtle) ── */}
      {updater.state === 'downloading' && (
        <div
          className="fixed bottom-5 right-5 z-[9998] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{
            background: 'rgba(0,61,53,0.95)',
            color: 'rgba(255,255,255,0.8)',
            border: '1px solid rgba(78,204,163,0.3)',
          }}
        >
          <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: '#4ECCA3' }} />
          Downloading update… {pct}%
        </div>
      )}

      {/* NOTE: When state='ready', the header button in MainLayout handles everything.
          No extra UI shown here — the header button is the single CTA. */}
    </>
  );
}
