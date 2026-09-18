import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// ─── Startup migrations ───────────────────────────────────────────────────────
(function runStartupMigrations() {
  // Role-matrix migration: only wipe if version < 2 (predates manage_branches).
  // Do NOT wipe on every load — that forces a full rebuild each time and can
  // conflict with a user's saved customisations.
  try {
    const raw = localStorage.getItem('popmyc-role-matrix');
    if (raw) {
      const parsed = JSON.parse(raw) as { __version?: number };
      const ver = typeof parsed.__version === 'number' ? parsed.__version : 0;
      if (ver < 2) localStorage.removeItem('popmyc-role-matrix');
    }
  } catch {
    localStorage.removeItem('popmyc-role-matrix');
  }

  // Branch store migration — wipe malformed Zustand entry (missing branches array).
  // Also wipe the old raw-data key ('popmyc-branches-data') that was used by a
  // previous dual-storage pattern; Zustand persist ('popmyc-branches') is now
  // the single source of truth.
  try {
    const raw = localStorage.getItem('popmyc-branches');
    if (raw) {
      const wrapper = JSON.parse(raw) as { state?: { branches?: unknown } };
      if (!Array.isArray(wrapper?.state?.branches)) {
        localStorage.removeItem('popmyc-branches');
      }
    }
  } catch {
    localStorage.removeItem('popmyc-branches');
  }
  localStorage.removeItem('popmyc-branches-data');   // remove old dual-storage key

  // Branch inventory migration — only wipe once when upgrading from the old
  // %-based seed (which had no __inv_version stamp).
  // After first load the corrected per-branch seed is saved with version 1,
  // so subsequent page loads skip this and preserve all user-added stock.
  try {
    const raw = localStorage.getItem('popmyc-branch-inventory');
    if (raw) {
      const wrapper = JSON.parse(raw) as { state?: { __inv_version?: number; stock?: unknown } };
      const ver = wrapper?.state?.__inv_version ?? 0;
      if (ver < 1) {
        localStorage.removeItem('popmyc-branch-inventory');
      }
    }
    // If no entry exists at all, the store will initialise from SEED_STOCK (correct)
  } catch {
    localStorage.removeItem('popmyc-branch-inventory');
  }
})();
// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
