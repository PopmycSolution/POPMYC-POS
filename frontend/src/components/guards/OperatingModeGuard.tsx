/**
 * OperatingModeGuard
 * ===================
 * Renders a clear "unavailable in current operating mode" message
 * when a page is accessed that the current business mode doesn't support,
 * instead of silently rendering the page in a broken state.
 *
 * Usage:
 *   import { OperatingModeGuard } from '@/components/guards/OperatingModeGuard';
 *
 *   // At the top of PosPage:
 *   if (!posEnabled) return <OperatingModeGuard requiredMode="pos" />;
 *
 *   // At the top of InventoryPage:
 *   if (!inventoryEnabled) return <OperatingModeGuard requiredMode="inventory" />;
 */

import { Link } from 'react-router-dom';
import { Settings, Warehouse, ShoppingCart } from 'lucide-react';
import { useSettingsStore } from '@/stores/settings.store';

interface Props {
  /** Which capability this page requires */
  requiredMode: 'pos' | 'inventory';
}

export function OperatingModeGuard({ requiredMode }: Props) {
  const operatingMode = useSettingsStore((s) => s.operatingMode);

  const isPosPage = requiredMode === 'pos';

  const title = isPosPage
    ? 'POS Unavailable in Inventory Only Mode'
    : 'Inventory Management Unavailable in POS Only Mode';

  const body = isPosPage
    ? (
      <>
        This business is currently set to <strong>Inventory Only</strong> mode.
        New sales and POS checkout are disabled. Historical sales can still be viewed on the{' '}
        <Link to="/sales" className="font-semibold underline">Sales</Link> page.
        <br /><br />
        To enable the POS, go to <strong>Settings → Inventory / Operating Mode</strong> and switch to
        <strong> Full POS + Inventory</strong> or <strong>POS Only</strong>.
      </>
    )
    : (
      <>
        This business is currently set to <strong>POS Only</strong> mode.
        Inventory management workflows are hidden.
        <br /><br />
        To enable inventory management, go to <strong>Settings → Inventory / Operating Mode</strong> and switch to
        <strong> Full POS + Inventory</strong> or <strong>Inventory Only</strong>.
      </>
    );

  const Icon = isPosPage ? ShoppingCart : Warehouse;
  const iconBg = isPosPage ? 'bg-amber-100' : 'bg-blue-100';
  const iconColor = isPosPage ? 'text-amber-600' : 'text-blue-600';

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className={`flex h-20 w-20 items-center justify-center rounded-3xl ${iconBg} mb-6`}>
        <Icon className={`h-9 w-9 ${iconColor}`} />
      </div>

      <h2 className="text-xl font-bold text-page-primary tracking-tight max-w-sm">
        {title}
      </h2>

      <p className="mt-3 text-sm text-page-secondary max-w-sm leading-relaxed">
        {body}
      </p>

      <div className="mt-8 flex items-center gap-3">
        <Link to="/settings"
          className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors">
          <Settings className="h-4 w-4" />
          Go to Settings
        </Link>
        <Link to="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-muted-200 px-5 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors">
          Back to Dashboard
        </Link>
      </div>

      <p className="mt-6 text-[11px] text-muted-400">
        Current mode: <span className="font-semibold">{operatingMode}</span>
        {' · '}Only Admin and Super Admin can change the operating mode.
      </p>
    </div>
  );
}

export default OperatingModeGuard;
