/**
 * useBranchFilter
 *
 * Central hook for branch-based data isolation.
 *
 * Returns:
 *  - effectiveBranchId   — the resolved branch UUID for the current user
 *                          (null = Super Admin in "All Branches" view)
 *  - activeBranchName    — display name, or "All Branches"
 *  - isSuperAdmin        — true when the user has SUPER_ADMIN role
 *  - filterByBranch<T>   — filters any array of {branchId?: string|null} records
 *                          to only those matching effectiveBranchId
 *                          (Super Admin in "all" mode gets all records)
 *  - stampBranch         — returns the branchId to stamp onto new records
 */

import { useAuthStore }          from '@/stores/auth.store';
import { useUserStore }          from '@/stores/user.store';
import { useBranchStore }        from '@/stores/branch.store';

export function useBranchFilter() {
  const user        = useAuthStore((s) => s.user);
  const userRecords = useUserStore((s) => s.users);
  const activeBranchId = useBranchStore((s) => s.activeBranchId);
  const branches       = useBranchStore((s) => s.branches);

  const isSuperAdmin = (user?.role ?? '') === 'SUPER_ADMIN';

  // ── Resolve the effective branch ID ─────────────────────────────────────────
  const effectiveBranchId: string | null = (() => {
    // Super Admin: use ONLY activeBranchId from the BranchSwitcher.
    // null = they chose "All Branches". Never override with UserRecord fallback.
    if (isSuperAdmin) return activeBranchId;

    // Non-Super-Admin: use activeBranchId (auto-set by MainLayout on login)
    if (activeBranchId) return activeBranchId;

    // Fallback: auth store user.branch (UUID or name)
    const authBranch = user?.branch;
    if (authBranch) {
      const byId   = branches.find((b) => b.id   === authBranch);
      if (byId) return byId.id;
      const byName = branches.find((b) => b.name.toLowerCase() === authBranch.toLowerCase());
      if (byName) return byName.id;
    }

    // Fallback: UserRecord from user.store (always has up-to-date branch name)
    const record = userRecords.find((u) => u.email === user?.email || u.id === user?.id);
    if (record?.branch) {
      const byName = branches.find(
        (b) => b.name.toLowerCase() === record.branch.toLowerCase()
      );
      if (byName) return byName.id;
    }

    return null;
  })();

  const activeBranch     = effectiveBranchId
    ? branches.find((b) => b.id === effectiveBranchId) ?? null
    : null;
  const activeBranchName = activeBranch?.name ?? (isSuperAdmin ? 'All Branches' : 'My Branch');

  /**
   * Filters an array of records by branch.
   * - Super Admin with no effectiveBranchId (All Branches view) → returns all records
   * - effectiveBranchId set → returns records whose branchId matches OR branchId is null
   *   (null means "business-wide" — Suppliers, POs without a branch are shown to everyone)
   * - No branch resolved and not Super Admin → returns empty (safe — no data leakage)
   */
  function filterByBranch<T extends { branchId?: string | null }>(items: T[]): T[] {
    // Super Admin with "All Branches" selected → show everything
    if (isSuperAdmin && !effectiveBranchId) return items;
    // Branch selected (Super Admin scoping or regular user)
    if (effectiveBranchId) {
      return items.filter(
        (item) =>
          item.branchId === effectiveBranchId ||
          item.branchId === null ||
          item.branchId === undefined,
      );
    }
    // No branch resolved and not Super Admin → show nothing to avoid data leakage
    return [];
  }

  /** The branchId to stamp onto a new record created by the current user */
  const stampBranch: string | null = effectiveBranchId;

  return {
    effectiveBranchId,
    activeBranchName,
    activeBranch,
    isSuperAdmin,
    filterByBranch,
    stampBranch,
  };
}
