/**
 * UpdateToast.tsx
 * ===============
 * In-app update notification — mirrors Kiro IDE behaviour exactly:
 *
 *   - Update found     → download starts automatically, NO banner yet
 *   - Downloading      → slim progress bar at top of screen (subtle)
 *   - Download ready   → ONE notification banner slides in bottom-right
 *                        "Restart & Update" or "Later"
 *   - "Restart & Update" → app closes silently, installs, relaunches
 *   - "Later"          → banner stays; installs on next app close
 *
 * The native OS dialog in main.js handles the same flow for any version
 * that doesn't have this React component (e.g. v1.0.0 → v1.0.6 upgrade).
 */

import { useState, useEffect } from 'react';
import { RefreshCw, Zap, CheckCircle, Loader2, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { useUpdater } from '@/hooks/useUpdater';

export default function UpdateToast() {
  const updater = useUpdater();
  const [dismissed, setDismissed] = useState(false);
  const [visible,   setVisible]   = useState(false); // slide-in gate

  // Re-surface the banner if user dismissed and a new version comes in
  useEffect(() => {
    if (updater.state === 'ready') {
      setDismissed(false);
    }
    // Hide banner when no longer relevant
    if (['no-update', 'idle', 'checking'].includes(updater.state)) {
      setVisible(false);
    }
  }, [updater.state]);

  // Slide in with a short delay when ready
  useEffect(() => {
    if (!dismissed && updater.state === 'ready') {
      const t = setTimeout(() => setVisible(true), 500);
      return () => clearTimeout(t);
    }
    if (dismissed || updater.state !== 'ready') {
      setVisible(false);
    }
  }, [updater.state, dismissed]);

  if (!updater.isDesktop) return null;

  // ── Subtle top progress bar while downloading (no banner, just a thin line) ──
  const showProgressBar = updater.state === 'downloading' && updater.progress;
  const pct = Math.round(updater.progress?.percent ?? 0);

  // ── Main banner — only when ready ──────────────────────────────────────────
  const showBanner = updater.state === 'ready' && !dismissed;

  return (
    <>
      {/* Thin progress bar at very top of screen — downloading, non-intrusive */}
      {showProgressBar && (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5">
          <div
            className="h-full transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #00897B, #4ECCA3)' }}
          />
        </div>
      )}

      {/* The one notification banner — only when update is ready */}
      {showBanner && (
        <div
          className={clsx(
            'fixed bottom-5 right-5 z-[9998] w-[360px] rounded-2xl overflow-hidden shadow-2xl',
            'transition-all duration-500 ease-out',
            visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none',
          )}
          style={{ background: '#003D35', border: '1px solid rgba(78,204,163,0.3)' }}
        >
          {/* Top accent line */}
          <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, #4ECCA3, #00FFAA)' }} />

          <div className="px-4 py-4 flex items-start gap-3">
            {/* Icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
              <Zap className="h-5 w-5 text-[#4ECCA3]" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white leading-tight">
                Update ready — {updater.updateVersion ? `v${updater.updateVersion}` : 'new version'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-white/50">v{updater.version}</span>
                <ArrowRight className="h-3 w-3 text-white/30 shrink-0" />
                <span className="text-xs font-semibold text-[#4ECCA3]">
                  v{updater.updateVersion ?? '...'}
                </span>
              </div>
              <p className="text-[11px] text-white/60 mt-1 leading-relaxed">
                Downloaded in the background. Restart to apply.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={() => setDismissed(true)}
              className="flex-1 h-9 rounded-xl text-xs font-semibold text-white/60 border border-white/10 hover:bg-white/5 transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => updater.install()}
              className="flex-1 h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors hover:opacity-90"
              style={{ background: '#4ECCA3', color: '#003D35' }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Restart &amp; Update
            </button>
          </div>
        </div>
      )}

      {/* After dismissed: tiny pill in corner so user can still act on it */}
      {dismissed && updater.state === 'ready' && (
        <button
          onClick={() => setDismissed(false)}
          className="fixed bottom-5 right-5 z-[9998] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold shadow-lg transition-all hover:scale-105"
          style={{ background: '#003D35', color: '#4ECCA3', border: '1px solid rgba(78,204,163,0.4)' }}
          title="Update ready — click to install"
        >
          <CheckCircle className="h-3.5 w-3.5" />
          Update ready
        </button>
      )}

      {/* Downloading pill — tiny, non-intrusive */}
      {updater.state === 'downloading' && updater.progress && (
        <div
          className="fixed bottom-5 right-5 z-[9997] flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg"
          style={{ background: 'rgba(0,61,53,0.95)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(78,204,163,0.2)' }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: '#4ECCA3' }} />
          Downloading update {pct}%
        </div>
      )}
    </>
  );
}
