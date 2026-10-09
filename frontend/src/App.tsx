import { Routes, Route, Navigate, useLocation, useNavigate, Link } from 'react-router-dom';
import { type ReactNode, useEffect, useState } from 'react';
import MainLayout from '@/layouts/MainLayout';
import { PWALayout } from '@/layouts/MainLayout';
import LoginPage from '@/pages/auth/LoginPage';
import SetupWizard from '@/pages/setup/SetupWizard';
import DbSetupScreen from '@/pages/setup/DbSetupScreen';
import DashboardPage from '@/pages/dashboard/DashboardPage';
import PosPage from '@/pages/pos/PosPage';
import ProductsPage from '@/pages/products/ProductsPage';
import CategoriesPage from '@/pages/categories/CategoriesPage';
import BrandsPage from '@/pages/brands/BrandsPage';
import UnitsPage from '@/pages/units/UnitsPage';
import InventoryPage from '@/pages/inventory/InventoryPage';
import StockAdjustmentsPage from '@/pages/inventory/StockAdjustmentsPage';
import BranchTransfersPage from '@/pages/inventory/BranchTransfersPage';
import SalesPage from '@/pages/sales/SalesPage';
import CustomersPage from '@/pages/customers/CustomersPage';
import ReportsPage from '@/pages/reports/ReportsPage';
import SettingsPage from '@/pages/settings/SettingsPage';
import SuppliersPage from '@/pages/suppliers/SuppliersPage';
import ExpensesPage from '@/pages/expenses/ExpensesPage';
import PurchasesPage from '@/pages/purchases/PurchasesPage';
import UsersPage from '@/pages/users/UsersPage';
import RolesPage from '@/pages/roles/RolesPage';
import AuditLogsPage from '@/pages/audit/AuditLogsPage';
import SystemSettingsPage from '@/pages/system/SystemSettingsPage';
import BackupPage from '@/pages/backup/BackupPage';
import DocumentationPage from '@/pages/docs/DocumentationPage';
import DebtPage from '@/pages/debt/DebtPage';
import BranchesPage from '@/pages/branches/BranchesPage';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useProductStore } from '@/stores/product.store';
import { Button } from '@/components/ui/Button';
import { APP_NAME } from '@/utils/constants';
import { Home, ArrowLeft } from 'lucide-react';
import { fetchSetupStatus } from '@/services/setup.service';
import { retryPendingCompletion } from '@/services/cloudLicense.service';
import { silentRefreshToken } from '@/services/api';
import UpdateToast from '@/components/updater/UpdateToast';
import PWAInstallPrompt from '@/components/pwa/PWAInstallPrompt';
import OfflineIndicator from '@/components/pwa/OfflineIndicator';
import { IS_PWA } from '@/utils/constants';
import { useInitialCloudSync } from '@/hooks/useInitialCloudSync';
import InitialSyncToast from '@/components/sync/InitialSyncToast';

// ── Setup guard — checks first-run state once on cold start ───────────────────
// On PWA mode we skip the setup check entirely: the business owner already has
// an account on the Render backend, so there's never a "needs setup" state.
// Going straight to login is both faster and avoids a spurious /setup redirect
// when the PWA can't reach the backend's setup/status/ endpoint.
function SetupGuard({ children }: { children: ReactNode }) {
  const [checked, setChecked]       = useState(IS_PWA); // PWA: already "checked"
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Skip the setup check entirely in PWA mode.
    if (IS_PWA) return;

    fetchSetupStatus()
      .then((s) => {
        setNeedsSetup(!s.setup_complete);
        setChecked(true);
      })
      .catch(() => {
        // If the health check itself fails (DB down, backend not started),
        // let the app render normally — the login page will surface the error.
        setChecked(true);
      });
  }, []);

  if (!checked) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: '#f0faf8' }}>
        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: '#00FFAA' }} />
      </div>
    );
  }

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

// ── Tiny full-screen splash shown during the ~5 ms rehydration window ─────────
function AuthLoadingSplash() {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg-page, #f8fafc)' }}
    >
      {/* A single pulsing dot — imperceptible, prevents any layout flash */}
      <span
        className="h-2 w-2 rounded-full animate-pulse"
        style={{ background: 'var(--mint, #00FFAA)' }}
      />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location        = useLocation();
  const navigate        = useNavigate();
  const _hasHydrated    = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken     = useAuthStore((s) => s.accessToken);
  const user            = useAuthStore((s) => s.user);
  const syncFromBackend = useSettingsStore((s) => s.syncFromBackend);
  const syncProductsFromBackend = useProductStore((s) => s.syncFromBackend);

  const authed = isAuthenticated || !!accessToken || !!user;

  const { status: initialSyncStatus } = useInitialCloudSync(_hasHydrated && authed);

  // Register navigate globally so the axios interceptor can redirect without
  // a hard page reload (which would blow away React state).
  useEffect(() => {
    (window as Window & { __navigate?: (path: string) => void }).__navigate = navigate;
    return () => {
      delete (window as Window & { __navigate?: (path: string) => void }).__navigate;
    };
  }, [navigate]);

  // Save intended destination so we can restore it after login
  useEffect(() => {
    if (_hasHydrated && !authed) {
      sessionStorage.setItem('redirectAfterLogin', location.pathname + location.search);
    }
  }, [authed, _hasHydrated, location]);

  // Sync business/settings data from the backend once authentication is established.
  // This ensures System Settings always shows the customer's real Business record
  // rather than localStorage defaults — critical after a fresh Setup Wizard completion.
  useEffect(() => {
    if (_hasHydrated && authed) {
      void syncFromBackend();
      void syncProductsFromBackend();
    }
  }, [_hasHydrated, authed, syncFromBackend, syncProductsFromBackend]);

  // Wait for Zustand rehydration — prevents the "blink" on page reload
  if (!_hasHydrated) return <AuthLoadingSplash />;

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <>
      {children}
      <InitialSyncToast status={initialSyncStatus} />
    </>
  );
}

function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const _hasHydrated    = useAuthStore((s) => s._hasHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessToken     = useAuthStore((s) => s.accessToken);
  const user            = useAuthStore((s) => s.user);

  // Wait for Zustand rehydration before deciding to redirect
  if (!_hasHydrated) return <AuthLoadingSplash />;

  const authed = isAuthenticated || !!accessToken || !!user;
  if (authed) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function NotFound() {
  return (
    <div className="min-h-screen bg-muted-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-primary-100 mb-6">
          <span className="text-4xl font-bold text-primary-600 tracking-tight">404</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-muted-900 tracking-tight">Page not found</h1>
        <p className="mt-3 text-sm text-muted-500 leading-relaxed">
          Sorry, we couldn't find the page you're looking for.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to="/dashboard">
            <Button size="lg" variant="primary"><Home className="h-4 w-4" />Back to Dashboard</Button>
          </Link>
          <Link to="/">
            <Button size="lg" variant="outline"><ArrowLeft className="h-4 w-4" />Go Home</Button>
          </Link>
        </div>
        <p className="mt-10 text-xs text-muted-400">{APP_NAME} · Retail POS System</p>
      </div>
    </div>
  );
}

export function App() {
  // ── Retry any pending cloud activation completion on startup ──────────────
  // This runs once when the app mounts. It checks localStorage for a pending
  // cloud TrialCode completion token left over from a previous activation that
  // failed due to a transient network error (e.g. Render cold-start timeout).
  //
  // Properties:
  //   - Non-blocking: runs in the background; never delays login or POS.
  //   - Offline-safe: if no token exists or Render is unreachable, does nothing.
  //   - Idempotent: retryPendingCompletion() removes the token on success and
  //     leaves it for the next startup on transient failure.
  //   - No effect on normal POS traffic: only contacts CLOUD_LICENSE_URL.
  useEffect(() => {
    retryPendingCompletion().catch(() => {});
    // Proactively refresh the JWT access token if it's within 2 hours of expiring.
    // This prevents mid-session logouts on the rare case the 24h token is about to expire.
    void silentRefreshToken();
  }, []); // empty deps — run exactly once on mount

  return (
    <>
      {/* Global auto-update toast — desktop only */}
      <UpdateToast />
      {/* PWA offline indicator — shown on web when no connection */}
      <OfflineIndicator />
      {/* PWA install prompt — shown on mobile browsers */}
      <PWAInstallPrompt />
      <Routes>
      {/* DB setup screen — shown by Electron when PostgreSQL/DB is missing */}
      <Route path="/db-setup" element={<DbSetupScreen />} />

      {/* First-run setup wizard — no auth required */}
      <Route path="/setup" element={<SetupWizard />} />

      {/* All other routes are guarded: setup must be complete first */}
      <Route
        path="/login"
        element={
          <SetupGuard>
            <RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>
          </SetupGuard>
        }
      />

      <Route
        path="/"
        element={
          <SetupGuard>
            <RequireAuth>{IS_PWA ? <PWALayout /> : <MainLayout />}</RequireAuth>
          </SetupGuard>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />

        {/* ── Core ── */}
        <Route path="dashboard"  element={<DashboardPage />} />
        <Route path="pos"        element={<PosPage />} />

        {/* ── Products & Catalog ── */}
        <Route path="products"   element={<ProductsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="brands"     element={<BrandsPage />} />
        <Route path="units"      element={<UnitsPage />} />
        <Route path="inventory"  element={<InventoryPage />} />
        <Route path="inventory/adjustments" element={<StockAdjustmentsPage />} />
        <Route path="inventory/transfers"   element={<BranchTransfersPage />} />

        {/* ── Sales & Commerce ── */}
        <Route path="sales"      element={<SalesPage />} />
        <Route path="purchases"  element={<PurchasesPage />} />
        <Route path="customers"  element={<CustomersPage />} />
        <Route path="suppliers"  element={<SuppliersPage />} />
        <Route path="expenses"   element={<ExpensesPage />} />

        {/* ── Analytics ── */}
        <Route path="reports"    element={<ReportsPage />} />

        {/* ── People & Access ── */}
        <Route path="users"      element={<UsersPage />} />
        <Route path="roles"      element={<RolesPage />} />
        <Route path="branches"   element={<BranchesPage />} />

        {/* ── Configuration ── */}
        <Route path="settings"   element={<SettingsPage />} />

        {/* ── Super Admin only ── */}
        <Route path="audit"      element={<AuditLogsPage />} />
        <Route path="system"     element={<SystemSettingsPage />} />
        <Route path="backup"     element={<BackupPage />} />
        <Route path="docs"       element={<DocumentationPage />} />
        <Route path="debt"       element={<DebtPage />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}

export default App;
