/**
 * UpdateToast.tsx
 * ===============
 * Global in-app update notification — mounted once in App.tsx.
 *
 * Works alongside the native OS dialog in main.js:
 *   - Native dialog shows immediately when update is found (main process)
 *   - This component shows an in-app banner as a persistent reminder
 *
 * Flow (autoDownload = false):
 *   1. 'available'   → slim green banner slides in bottom-right
 *                      "Update Now" starts download, "Later" dismisses banner
 *   2. 'downloading' → banner shows live progress bar + % + MB transferred
 *                      cannot be dismissed until complete
 *   3. 'ready'       → full modal pops up asking to Restart & Install or Later
 *                      if "Later" is clicked, banner stays as reminder
 *
 * The native dialog in main.js handles v1.0.0 customers (no React toast).
 * This component handles v1.0.2+ customers who have the React layer.
 */

import { useState, useEffect } from 'react';
import { Download, RefreshCw, X, Zap, CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useUpdater } from '@/hooks/useUpdater';

export default function UpdateToast() {
  const updater = useUpdater();
  const [dismissed,  setDismissed]  = useState(false);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [visible,    setVisible]    = useState(false); // animation gate

  // Re-surface on new update; auto-open modal when ready
  useEffect(() => {
    if (updater.state === 'available' || updater.state === 'downloading') {
      setDismissed(false);
    }
    if (updater.state === 'ready') {
      setDismissed(false);
      setModalOpen(true);
    }
    if (updater.state === 'no-update' || updater.state === 'idle') {
      setDismissed(true); // hide banner when no update
    }
  }, [updater.state]);

  // Slide-in with short delay
  useEffect(() => {
    const active = !dismissed && ['available', 'downloading', 'ready'].includes(updater.state);
    if (active) {
      const t = setTimeout(() => setVisible(true), 300);
      return () => clearTimeout(t);
    }
    setVisible(false);
  }, [updater.state, dismissed]);

  if (!updater.isDesktop) return null;

  const showBanner = !dismissed && ['available', 'downloading', 'ready'].includes(updater.state);
  if (!showBanner && !modalOpen) return null;

  const pct        = Math.round(updater.progress?.percent ?? 0);
  const transferred = ((updater.progress?.transferred ?? 0) / 1024 / 1024).toFixed(0);
  const total       = ((updater.progress?.total       ?? 0) / 1024 / 1024).toFixed(0);

  // ── Ready-to-install full modal ────────────────────────────────────────────
  const Modal = () => (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setModalOpen(false)}
      />
      <div
        className="relative w-full max-w-[420px] rounded-2xl bg-white shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Gradient accent */}
        <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, #004D40 0%, #00897B 50%, #4ECCA3 100%)' }} />

        <div className="px-6 pt-6 pb-6 space-y-5">
          {/* Icon + title */}
          <div className="flex items-start gap-4">
            <div
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #004D40, #00897B)' }}
            >
              <Zap className="h-7 w-7 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-800 leading-tight">
                POPMYC POS {updater.updateVersion ? `v${updater.updateVersion}` : 'Update'} is ready
              </p>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                Downloaded and ready to install. Takes about 30 seconds.
              </p>
            </div>
          </div>

          {/* Safety note */}
          <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
            <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
            <p className="text-xs text-emerald-700 font-medium">
              Your business data is never affected by updates.
            </p>
          </div>

          {/* Version change */}
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5">
            <span className="text-xs font-semibold text-slate-500">v{updater.version}</span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <span className="text-xs font-bold text-emerald-700">v{updater.updateVersion ?? '...'}</span>
            <span className="ml-auto text-[10px] text-slate-400">Stable release</span>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setModalOpen(false)}
              className="flex-1 h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => { setModalOpen(false); updater.install(); }}
              className="flex-1 h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: 'linear-gradient(135deg, #004D40, #00897B)' }}
            >
              <RefreshCw className="h-4 w-4" />
              Restart &amp; Install
            </button>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            App closes, installs, and reopens automatically.
          </p>
        </div>
      </div>
    </div>
  );

  // ── Slide-in banner ────────────────────────────────────────────────────────
  const Banner = () => (
    <div
      className={clsx(
        'fixed bottom-5 right-5 z-[9998] w-[360px] rounded-2xl shadow-2xl overflow-hidden',
        'transition-all duration-500 ease-out',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none',
        updater.state === 'ready'       && 'border border-[#00897B]',
        updater.state === 'downloading' && 'bg-white border border-slate-200',
        updater.state === 'available'   && 'bg-white border border-slate-200',
        updater.state === 'ready'       && 'bg-[#003D35]',
      )}
    >
      {/* Progress bar (downloading) */}
      {updater.state === 'downloading' && (
        <div className="h-1 w-full bg-slate-100 overflow-hidden">
          <div
            className="h-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }}
          />
        </div>
      )}
      {/* Accent bar (ready) */}
      {updater.state === 'ready' && (
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #4ECCA3, #00FFAA)' }} />
      )}
      {/* Accent bar (available) */}
      {updater.state === 'available' && (
        <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }} />
      )}

      <div className="px-4 py-3.5 flex items-center gap-3">
        {/* Icon */}
        <div className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          updater.state === 'available'   && 'bg-teal-50',
          updater.state === 'downloading' && 'bg-teal-50',
          updater.state === 'ready'       && 'bg-white/10',
        )}>
          {updater.state === 'available'   && <Download    className="h-5 w-5 text-[#00897B]" />}
          {updater.state === 'downloading' && <Loader2     className="h-5 w-5 text-[#00897B] animate-spin" />}
          {updater.state === 'ready'       && <CheckCircle className="h-5 w-5 text-[#4ECCA3]" />}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={clsx(
            'text-sm font-bold leading-tight',
            updater.state === 'ready' ? 'text-white' : 'text-slate-800',
          )}>
            {updater.state === 'available'   && `Update available — v${updater.updateVersion ?? '...'}`}
            {updater.state === 'downloading' && `Downloading v${updater.updateVersion ?? '...'}…`}
            {updater.state === 'ready'       && `v${updater.updateVersion ?? '...'} ready to install`}
          </p>
          <p className={clsx(
            'text-xs mt-0.5 leading-tight',
            updater.state === 'ready' ? 'text-white/70' : 'text-slate-500',
          )}>
            {updater.state === 'available'   && 'New features and bug fixes are available.'}
            {updater.state === 'downloading' && `${pct}%  ·  ${transferred} / ${total} MB`}
            {updater.state === 'ready'       && 'Click Install to apply — takes ~30 seconds.'}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {updater.state === 'available' && (
            <button
              onClick={() => void updater.download()}
              className="h-8 px-3 rounded-lg text-xs font-bold text-white transition-colors hover:opacity-90"
              style={{ background: '#00897B' }}
            >
              Update
            </button>
          )}
          {updater.state === 'ready' && (
            <button
              onClick={() => setModalOpen(true)}
              className="h-8 px-3 rounded-lg text-xs font-bold transition-colors"
              style={{ background: '#4ECCA3', color: '#003D35' }}
            >
              Install
            </button>
          )}
          {/* X dismiss — not shown while actively downloading */}
          {updater.state !== 'downloading' && (
            <button
              onClick={() => setDismissed(true)}
              className={clsx(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                updater.state === 'ready'
                  ? 'text-white/50 hover:bg-white/10 hover:text-white'
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
      {modalOpen && updater.state === 'ready' && <Modal />}
      {showBanner && <Banner />}
    </>
  );
}
