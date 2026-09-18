/**
 * global.d.ts
 * ===========
 * Global type declarations for APIs injected by the Electron preload script.
 * When running in a browser (non-desktop), window.popmycDesktop is undefined.
 */

interface PgCheckResult {
  success: boolean;
  action?: string;
  pg_installed?: boolean;
  pg_running?: boolean;
  db_exists?: boolean;
  db_accessible?: boolean;
  pg_version?: string | null;
  pg_port?: number;
  db_name?: string;
  db_host?: string;
  message: string;
  error_code: string | null;
  next_step?: string;
}

interface UpdaterStatePayload {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'no-update' | 'error';
  version: string;
  updateVersion: string | null;
  releaseNotes?: string | null;
  progress?: {
    percent: number;
    bytesPerSecond: number;
    total: number;
    transferred: number;
  } | null;
}

interface PopmycDesktop {
  /** True when running inside the Electron desktop wrapper */
  isDesktop: true;

  // ── App info ──────────────────────────────────────────────────────────────
  getVersion:  () => Promise<string>;
  getDataDir:  () => Promise<string>;
  openDataDir: () => Promise<void>;
  isOnline:    () => Promise<boolean>;

  // ── PostgreSQL setup ──────────────────────────────────────────────────────
  pgCheck:         ()          => Promise<PgCheckResult>;
  pgCreate:        (pwd: string) => Promise<PgCheckResult>;
  pgSetupComplete: ()          => Promise<{ ok: boolean }>;
  pgRetry:         ()          => Promise<PgCheckResult>;
  pgOpenDownload:  ()          => Promise<void>;
  onPgCheckResult: (cb: (result: PgCheckResult) => void) => void;

  // ── Auto-updater ──────────────────────────────────────────────────────────
  updaterGetState: ()           => Promise<UpdaterStatePayload>;
  updaterCheckNow: ()           => Promise<UpdaterStatePayload>;
  updaterDownload: ()           => Promise<{ ok: boolean; error?: string }>;
  updaterInstall:  ()           => void;
  onUpdaterState:  (cb: (data: UpdaterStatePayload) => void) => void;
}

declare global {
  interface Window {
    /** Injected by Electron preload.js. undefined in browser mode. */
    popmycDesktop?: PopmycDesktop;
  }
}

export {};
