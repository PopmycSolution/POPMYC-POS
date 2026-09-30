/**
 * UpdateToast.tsx
 * ===============
 * Global auto-update notification component — mounts once in App.tsx.
 *
 * Behaviour mirrors how Kiro (and VS Code) handles updates:
 *
 *   1. "Update available"  → slim banner slides in from bottom-right.
 *      "Download" button starts the download.
 *
 *   2. "Downloading"       → banner shows live progress bar + percentage.
 *      Cannot be dismissed until download finishes.
 *
 *   3. "Ready to install"  → modal takes focus (cannot be fully ignored).
 *      "Restart & Install" installs immediately.
 *      "Later" dismisses the modal but the banner stays in the corner.
 *
 * The component re-uses the existing useUpdater() hook so no new IPC or
 * backend changes are needed.
 */

import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Zap, CheckCircle, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useUpdater } from '@/hooks/useUpdater';

export default function UpdateToast() {
  const updater = useUpdater();
  const [dismissed,    setDismissed]    = useState(false);  // user clicked "Later"
  const [modalOpen,    setModalOpen]    = useState(false);  // full ready-to-install modal
  const [showBanner,   setShowBanner]   = useState(false);  // slide-in animation gate

  // Re-surface if a new update comes in after the user dismissed a previous one
  useEffect(() => {
    if (updater.state === 'available' || updater.state === 'downloading') {
      setDismissed(false);
    }
    // When download completes → open the modal automatically
    if (updater.state === 'ready') {
      setDismissed(false);
      setModalOpen(true);
    }
  }, [updater.state]);

  // Slide-in animation: slight delay so it doesn't flash immediately on startup
  useEffect(() => {
    if (
      !dismissed &&
      (updater.state === 'available' ||
       updater.state === 'downloading' ||
       updater.state === 'ready')
    ) {
      const t = setTimeout(() => setShowBanner(true), 400);
      return () => clearTimeout(t);
    } else {
      setShowBanner(false);
    }
  }, [updater.state, dismissed]);

  // Don't render anything if not desktop or no active update
  if (!updater.isDesktop) return null;
  if (!['available', 'downloading', 'ready'].includes(updater.state)) return null;
  if (dismissed && updater.state !== 'ready') return null;

  const pct = Math.round(updater.progress?.percent ?? 0);

  // ── Ready-to-install modal ─────────────────────────────────────────────────
  const ReadyModal = () => (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => setModalOpen(false)}
      />
      {/* Card */}
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Top accent bar */}
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }} />

        <div className="px-6 pt-6 pb-5 space-y-5">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                 style={{ background: 'linear-gradient(135deg, #004D40, #00897B)' }}>
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-slate-800">
                POPMYC POS {updater.updateVersion ? `v${updater.updateVersion}` : 'update'} is ready
              </p>
              <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                The update has been downloaded and is ready to install. Restart now to apply improvements and fixes.
              </p>
            </div>
          </div>

          {/* What's new pill */}
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-700 font-medium">
              Your data is safe — update only replaces app files, never your business data.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => updater.install()}
              className="flex-1 h-10 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-colors"
              style={{ background: 'linear-gradient(135deg, #004D40, #00897B)' }}
            >
              <RefreshCw className="h-4 w-4" />
              Restart &amp; Install
            </button>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            The app will close, update, and reopen automatically (≈ 30 seconds).
          </p>
        </div>
      </div>
    </div>
  );

  // ── Slide-in banner (available / downloading / ready but modal dismissed) ──
  const Banner = () => (
    <div
      className={clsx(
        'fixed bottom-5 right-5 z-[9998] w-[340px] rounded-2xl shadow-2xl border overflow-hidden',
        'transition-all duration-500 ease-out',
        showBanner ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        updater.state === 'ready'
          ? 'bg-[#004D40] border-[#006655]'
          : 'bg-white border-slate-200',
      )}
    >
      {/* Downloading: animated progress bar at top */}
      {updater.state === 'downloading' && (
        <div className="h-1 w-full bg-slate-100 overflow-hidden">
          <div
            className="h-full transition-all duration-300 ease-out"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }}
          />
        </div>
      )}

      {/* Ready: accent bar */}
      {updater.state === 'ready' && (
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #4ECCA3, #00FFAA)' }} />
      )}

      <div className="px-4 py-3.5 flex items-start gap-3">
        {/* Icon */}
        <div className={clsx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          updater.state === 'available'   && 'bg-blue-50',
          updater.state === 'downloading' && 'bg-teal-50',
          updater.state === 'ready'       && 'bg-white/10',
        )}>
          {updater.state === 'available'   && <Download   className="h-4 w-4 text-blue-600" />}
          {updater.state === 'downloading' && <Loader2    className="h-4 w-4 text-teal-600 animate-spin" />}
          {updater.state === 'ready'       && <CheckCircle className="h-4 w-4 text-[#4ECCA3]" />}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={clsx(
            'text-sm font-bold truncate',
            updater.state === 'ready' ? 'text-white' : 'text-slate-800',
          )}>
            {updater.state === 'available'   && `Update available — v${updater.updateVersion ?? '...'}`}
            {updater.state === 'downloading' && `Downloading v${updater.updateVersion ?? '...'}  ${pct}%`}
            {updater.state === 'ready'       && `v${updater.updateVersion ?? '...'} ready to install`}
          </p>
          <p className={clsx(
            'text-xs mt-0.5',
            updater.state === 'ready' ? 'text-white/70' : 'text-slate-500',
          )}>
            {updater.state === 'available'   && 'Bug fixes and improvements are available.'}
            {updater.state === 'downloading' && `${((updater.progress?.transferred ?? 0) / 1024 / 1024).toFixed(0)} / ${((updater.progress?.total ?? 0) / 1024 / 1024).toFixed(0)} MB`}
            {updater.state === 'ready'       && 'Restart the app to apply the update.'}
          </p>
        </div>

        {/* Action button / close */}
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          {updater.state === 'available' && (
            <button
              onClick={() => void updater.download()}
              className="h-7 px-3 rounded-lg text-xs font-bold text-white transition-colors"
              style={{ background: '#00897B' }}
            >
              Download
            </button>
          )}
          {updater.state === 'ready' && (
            <button
              onClick={() => setModalOpen(true)}
              className="h-7 px-3 rounded-lg text-xs font-bold text-[#004D40] bg-[#4ECCA3] hover:bg-[#5EDDB3] transition-colors"
            >
              Install
            </button>
          )}
          {/* Dismiss — not shown while downloading */}
          {updater.state !== 'downloading' && (
            <button
              onClick={() => setDismissed(true)}
              className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                updater.state === 'ready'
                  ? 'text-white/60 hover:bg-white/10 hover:text-white'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
              )}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {modalOpen && updater.state === 'ready' && <ReadyModal />}
      <Banner />
    </>
  );
}
