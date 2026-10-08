/**
 * OfflineIndicator.tsx
 * ====================
 * Shows a top banner when the device is offline.
 * Reassures the user that offline sales will sync when reconnected.
 */
import { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { clsx } from 'clsx';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [visible,  setVisible]  = useState(!navigator.onLine);

  useEffect(() => {
    function onOnline() {
      setIsOnline(true);
      setVisible(true);
      // Hide "back online" banner after 3 seconds
      setTimeout(() => {
        setVisible(false);
      }, 3000);
    }
    function onOffline() {
      setIsOnline(false);
      setVisible(true);
    }
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={clsx(
        'fixed top-0 left-0 right-0 z-[9995] flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold transition-all',
        isOnline
          ? 'bg-emerald-600 text-white'
          : 'bg-amber-500 text-white',
      )}
    >
      {isOnline
        ? <><Wifi className="h-3.5 w-3.5 shrink-0" /> Back online — syncing your data…</>
        : <><WifiOff className="h-3.5 w-3.5 shrink-0" /> You're offline — sales will sync when reconnected</>}
    </div>
  );
}
