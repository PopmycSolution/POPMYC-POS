/**
 * PWAInstallPrompt.tsx
 * ====================
 * Shows a bottom banner prompting mobile users to install the PWA.
 * Only shown on supported browsers (Chrome, Edge) when:
 *   - The app is NOT already installed
 *   - The user hasn't dismissed it in this session
 *   - Running on a mobile/tablet device
 */
import { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Listen for the browser's install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Only show on mobile/tablet or if they haven't dismissed recently
      const dismissed = sessionStorage.getItem('pwa-prompt-dismissed');
      if (!dismissed) {
        setVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    // If already installed as PWA, hide
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setVisible(false);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setVisible(false);
      }
    } catch { /* ignore */ }
    setDeferredPrompt(null);
    setInstalling(false);
  }

  function handleDismiss() {
    sessionStorage.setItem('pwa-prompt-dismissed', '1');
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9990] safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div
        className="mx-3 mb-3 rounded-2xl shadow-2xl border overflow-hidden"
        style={{ background: '#003D35', border: '1px solid rgba(78,204,163,0.3)' }}
      >
        <div className="px-4 py-4 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10">
            <Smartphone className="h-5 w-5 text-[#4ECCA3]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Install POPMYC POS</p>
            <p className="text-xs text-white/60 mt-0.5">
              Add to your home screen for the best experience
            </p>
          </div>
          <button
            onClick={() => void handleInstall()}
            disabled={installing}
            className="shrink-0 flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors"
            style={{ background: '#4ECCA3', color: '#003D35' }}
          >
            <Download className="h-3.5 w-3.5" />
            {installing ? 'Installing…' : 'Install'}
          </button>
          <button
            onClick={handleDismiss}
            className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
