import { useState, useMemo } from 'react';
import {
  Users, Search, Plus, X, Shield, ShieldCheck, ShieldAlert,
  UserCheck, Clock, Mail, Phone, MapPin, Trash2, AlertTriangle,
  KeyRound, Eye, EyeOff, Check, Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Avatar } from '@/components/ui/Avatar';
import { formatDate } from '@/utils/format';
import { useUserStore, type UserRecord, type UserRole, type UserStatus } from '@/stores/user.store';
import { useAuthStore } from '@/stores/auth.store';
import { useBranchStore } from '@/stores/branch.store';
import { useSettingsStore } from '@/stores/settings.store';
import ChangePasswordModal from '@/components/auth/ChangePasswordModal';
import { adminResetPassword } from '@/services/auth.service';

const roleConfig: Record<string, { label: string; color: string; icon: typeof Shield }> = {
  SUPER_ADMIN:     { label: 'Super Admin',     color: 'bg-rose-100 text-rose-700 border border-rose-200',     icon: ShieldAlert  },
  ADMIN:           { label: 'Admin',           color: 'bg-purple-100 text-purple-700 border border-purple-200', icon: ShieldCheck },
  MANAGER:         { label: 'Manager',         color: 'bg-blue-100 text-blue-700 border border-blue-200',      icon: Shield       },
  CASHIER:         { label: 'Cashier',         color: 'bg-emerald-50 text-emerald-600 border border-emerald-200', icon: UserCheck  },
  INVENTORY_CLERK: { label: 'Inventory',       color: 'bg-amber-100 text-amber-700 border border-amber-200',   icon: Users        },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  ACTIVE:    { label: 'Active',    color: 'bg-emerald-50 text-emerald-600' },
  INACTIVE:  { label: 'Inactive',  color: 'bg-muted-100 text-muted-500'   },
  SUSPENDED: { label: 'Suspended', color: 'bg-rose-100 text-rose-600'     },
};

const roleFilters = [
  { value: 'all',             label: 'All Roles'  },
  { value: 'SUPER_ADMIN',     label: 'Super Admin'},
  { value: 'ADMIN',           label: 'Admin'      },
  { value: 'MANAGER',         label: 'Manager'    },
  { value: 'CASHIER',         label: 'Cashier'    },
  { value: 'INVENTORY_CLERK', label: 'Inventory'  },
];

const roleOptions = [
  { value: 'SUPER_ADMIN',     label: 'Super Admin'     },
  { value: 'ADMIN',           label: 'Admin'           },
  { value: 'MANAGER',         label: 'Manager'         },
  { value: 'CASHIER',         label: 'Cashier'         },
  { value: 'INVENTORY_CLERK', label: 'Inventory Clerk' },
];

const inputClass = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10';

export default function UsersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);

  // Password modal state
  const [pwdTarget,     setPwdTarget]     = useState<UserRecord | null>(null);
  const [newPwd,        setNewPwd]        = useState('');
  const [confirmPwd,    setConfirmPwd]    = useState('');
  const [showNew,       setShowNew]       = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);
  const [pwdSuccess,    setPwdSuccess]    = useState(false);
  const [pwdError,      setPwdError]      = useState('');

  // Self-service change-password modal (for current user)
  const [changePwdOpen, setChangePwdOpen] = useState(false);
  const [formData, setFormData] = useState<{
    firstName: string; lastName: string; username: string;
    email: string; phone: string; role: UserRole;
    branch: string; status: UserStatus; isActive: boolean;
    password: string; confirmPassword: string;
  }>({
    firstName: '', lastName: '', username: '', email: '', phone: '',
    role: 'CASHIER', branch: '', status: 'ACTIVE', isActive: true,
    password: '', confirmPassword: '',
  });

  // Live branch list — drives the branch dropdown in the Add User form
  const branches = useBranchStore((s) => s.branches);
  // Active branches for the dropdown; fall back to all if none active
  const activeBranches = useMemo(
    () => branches.filter((b) => b.isActive).length > 0
      ? branches.filter((b) => b.isActive)
      : branches,
    [branches],
  );
  // Resolve the currently selected branch name (default to first active branch)
  const defaultBranch = activeBranches[0]?.name ?? 'Main Branch';
  const [showAddPwd,     setShowAddPwd]     = useState(false);
  const [showAddConfirm, setShowAddConfirm] = useState(false);
  const [addPwdError,    setAddPwdError]    = useState('');

  const users          = useUserStore((s) => s.users);
  const addUser        = useUserStore((s) => s.addUser);
  const setPassword    = useUserStore((s) => s.setPassword);
  const deactivateUser = useUserStore((s) => s.deactivateUser);
  const activateUser   = useUserStore((s) => s.activateUser);
  const deleteUser     = useUserStore((s) => s.deleteUser);

  // Current user's role — determines whether password management is visible
  const { user: currentUser } = useAuthStore();
  const currentUserRole = currentUser?.role ?? 'CASHIER';
  const canManagePasswords = currentUserRole === 'SUPER_ADMIN' || currentUserRole === 'ADMIN';
  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
  const isSingleBranch = useSettingsStore((s) => s.isSingleBranch);

  // Role options available when adding a new user — Admin cannot create Admin/SuperAdmin
  const availableRoleOptions = useMemo(() => {
    if (isSuperAdmin) return roleOptions; // Super Admin can create any role
    // Admin can only create Manager, Cashier, Inventory Clerk
    return roleOptions.filter((r) => !['SUPER_ADMIN', 'ADMIN'].includes(r.value));
  }, [isSuperAdmin]);

  const stats = useMemo(() => {
    const total    = users.length;
    const active   = users.filter((u) => u.isActive).length;
    const admins   = users.filter((u) => u.role === 'SUPER_ADMIN' || u.role === 'ADMIN').length;
    const cashiers = users.filter((u) => u.role === 'CASHIER').length;
    return { total, active, admins, cashiers };
  }, [users]);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return users.filter((u) => {
      const matchSearch = searchTerm === '' ||
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(term) ||
        u.username.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        u.phone.includes(term);
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      return matchSearch && matchRole;
    });
  }, [users, searchTerm, roleFilter]);

  // ── Add User ──────────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!formData.firstName || !formData.username) return;
    setAddPwdError('');
    if (formData.password && formData.password !== formData.confirmPassword) {
      setAddPwdError('Passwords do not match.');
      return;
    }

    // Add to local store immediately for offline-first UX
    addUser({
      firstName: formData.firstName, lastName: formData.lastName,
      username:  formData.username,  email:     formData.email,
      phone:     formData.phone,     role:      formData.role,
      branch:    formData.branch || defaultBranch,
      status:    'ACTIVE',
      isActive:  true,
      password:  formData.password || undefined,
    });

    // Also create on the backend so the user exists in the database
    // and gets synced to the cloud admin (for Admin/SuperAdmin roles).
    const token = useAuthStore.getState().accessToken ?? '';
    if (token && !token.startsWith('local-session-')) {
      try {
        const { default: api } = await import('@/services/api');
        // Map role to is_staff / is_superuser flags
        const isStaff      = formData.role === 'ADMIN';
        const isSuperuser  = formData.role === 'SUPER_ADMIN';
        // Look up the branch id from the branch store
        const branchRecord = branches.find(
          (b) => b.name === (formData.branch || defaultBranch)
        );

        // Step 1: create user in local backend DB
        const createRes = await api.post<{
          id?: string; username?: string; email?: string;
          first_name?: string; last_name?: string;
        }>('/accounts/users/', {
          username:     formData.username,
          first_name:   formData.firstName,
          last_name:    formData.lastName,
          email:        formData.email       || '',
          phone_number: formData.phone       || '',
          is_staff:     isStaff,
          is_superuser: isSuperuser,
          is_active:    true,
          branch:       branchRecord?.id ?? null,
          ...(formData.password ? { password: formData.password } : {}),
        });

        // Step 2: for Admin/SuperAdmin — also push to cloud so Django admin shows them
        if ((isStaff || isSuperuser) && createRes.data?.id) {
          const newUser = createRes.data;
          // Read business info from settings store for the cloud payload
          const { useSettingsStore } = await import('@/stores/settings.store');
          const businessState = useSettingsStore.getState().business;

          // Get business UUID from backend
          const bizRes = await api.get<{ results?: { id: string }[] } | { id: string }[]>('/businesses/');
          const bizList = Array.isArray(bizRes.data)
            ? (bizRes.data as { id: string }[])
            : ((bizRes.data as { results?: { id: string }[] }).results ?? []);
          const bizId = bizList[0]?.id;

          if (bizId) {
            // Push to Render cloud registration endpoint (same one used during setup)
            // This is fire-and-forget — failure doesn't block the UI
            const CLOUD_URL = (import.meta.env.VITE_CLOUD_URL as string | undefined)
              || 'https://popmyc-pos.onrender.com';
            fetch(`${CLOUD_URL}/api/v1/cloud/trial/register-business/`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                business_id:    bizId,
                name:           businessState.name,
                business_category: businessState.businessCategory,
                admin_id:       newUser.id,
                admin_username: newUser.username ?? formData.username,
                admin_email:    newUser.email    ?? formData.email,
                admin_first_name: newUser.first_name ?? formData.firstName,
                admin_last_name:  newUser.last_name  ?? formData.lastName,
              }),
            }).catch(() => { /* non-fatal — cloud sync is best-effort */ });
          }
        }
      } catch {
        // Backend creation failed (offline / permission) — local store still has the user.
      }
    }

    setFormData({
      firstName: '', lastName: '', username: '', email: '', phone: '',
      role: 'CASHIER', branch: '', status: 'ACTIVE', isActive: true,
      password: '', confirmPassword: '',
    });
    setAddPwdError('');
    setAddModalOpen(false);
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  function handleDelete() {
    if (deleteTarget) { deleteUser(deleteTarget.id); setDeleteTarget(null); }
  }

  // ── Set Password ─────────────────────────────────────────────────────────
  function openPwdModal(u: UserRecord) {
    setPwdTarget(u);
    setNewPwd('');
    setConfirmPwd('');
    setShowNew(false);
    setShowConfirm(false);
    setPwdSuccess(false);
    setPwdError('');
  }

  function handleSetPassword() {
    if (!pwdTarget) return;
    setPwdError('');
    if (!newPwd || newPwd.length < 6) {
      setPwdError('Password must be at least 6 characters.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('Passwords do not match.');
      return;
    }

    // Try real API first (non-local session)
    const token = useAuthStore.getState().accessToken ?? '';
    const isLocal = token.startsWith('local-session-');

    if (!isLocal) {
      // The local store ID may not match the backend UUID.
      // Look up the real user by username first, then reset.
      import('axios').then(({ default: axios }) => { void axios; }); // preload
      import('@/services/api').then(({ default: api }) => {
        // Find the backend user record by username
        api.get<{ results?: { id: string; username: string }[]; id?: string; username?: string }[]>(
          `/accounts/users/?search=${encodeURIComponent(pwdTarget.username)}`
        ).then((res) => {
          const list = Array.isArray(res.data)
            ? (res.data as { id: string; username: string }[])
            : ((res.data as { results?: { id: string; username: string }[] }).results ?? []);
          const match = list.find((u) => u.username === pwdTarget.username);
          const backendId = match?.id ?? pwdTarget.id;
          return adminResetPassword(backendId, { new_password: newPwd });
        }).then(() => {
          setPassword(pwdTarget.id, newPwd);
          setPwdSuccess(true);
          setTimeout(() => { setPwdTarget(null); setPwdSuccess(false); }, 1800);
        }).catch((err: unknown) => {
          const msg =
            (err as { response?: { data?: { detail?: string | string[] } } })
              ?.response?.data?.detail;
          if (Array.isArray(msg)) setPwdError(msg.join(' '));
          else setPwdError(msg ?? 'Password reset failed.');
        });
      });
    } else {
      // Offline / local-only mode — update local store
      setPassword(pwdTarget.id, newPwd);
      setPwdSuccess(true);
      setTimeout(() => { setPwdTarget(null); setPwdSuccess(false); }, 1800);
    }
  }

  function getInitials(u: UserRecord) {
    return `${u.firstName[0] || ''}${u.lastName[0] || ''}`.toUpperCase();
  }

  function getAvatarColor(u: UserRecord) {
    const colors = ['bg-blue-500','bg-emerald-500','bg-purple-500','bg-rose-500','bg-amber-500','bg-sky-500','bg-indigo-500'];
    const idx = (u.firstName.charCodeAt(0) + u.lastName.charCodeAt(0)) % colors.length;
    return colors[idx];
  }

  const pwdStrength = (p: string) => {
    if (!p) return null;
    if (p.length < 6)  return { label: 'Too short', color: 'bg-rose-500', w: 'w-1/4' };
    if (p.length < 8)  return { label: 'Weak',      color: 'bg-orange-400', w: 'w-2/4' };
    if (!/[A-Z]/.test(p) || !/[0-9]/.test(p)) return { label: 'Fair', color: 'bg-amber-400', w: 'w-3/4' };
    return { label: 'Strong', color: 'bg-emerald-500', w: 'w-full' };
  };
  const strength = pwdStrength(newPwd);

  return (
    <div className="space-y-6">
      {/* Forced password-change modal — shown when admin reset requires new password */}
      <ChangePasswordModal
        open={currentUser?.mustChangePassword === true}
        onClose={() => {/* forced — cannot dismiss */}}
        forced
      />

      {/* Self-service change-password modal */}
      <ChangePasswordModal
        open={changePwdOpen}
        onClose={() => setChangePwdOpen(false)}
      />

      {/* must_change_password banner */}
      {currentUser?.mustChangePassword && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <Lock className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-700 font-medium flex-1">
            Your password was reset by an administrator. Please create a new password.
          </p>
          <button
            onClick={() => setChangePwdOpen(true)}
            className="rounded-xl bg-amber-600 text-white text-xs font-semibold px-3 py-1.5 hover:bg-amber-700 transition-colors shrink-0"
          >
            Change Now
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E293B] tracking-tight">User Management</h1>
          <p className="text-sm text-muted-500 mt-0.5">Manage system users, roles, and access</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Change my own password */}
          <button
            onClick={() => setChangePwdOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-700 hover:bg-muted-50 transition-colors"
            title="Change your own password"
          >
            <KeyRound className="h-4 w-4" /> My Password
          </button>
          <button onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] transition-colors shadow-sm">
            <Plus className="h-4 w-4" /> Add User
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: stats.total.toString(),    icon: Users,     color: 'bg-blue-50 text-blue-600',    ring: 'ring-blue-100'    },
          { label: 'Active',      value: stats.active.toString(),   icon: UserCheck, color: 'bg-emerald-50 text-emerald-600', ring: 'ring-emerald-100' },
          { label: 'Admins',      value: stats.admins.toString(),   icon: ShieldCheck, color: 'bg-purple-50 text-purple-600', ring: 'ring-purple-100' },
          { label: 'Cashiers',    value: stats.cashiers.toString(), icon: UserCheck, color: 'bg-amber-50 text-amber-600',   ring: 'ring-amber-100'   },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-500 truncate">{s.label}</p>
                  <p className="text-xl sm:text-2xl font-bold text-[#1E293B] mt-1 truncate">{s.value}</p>
                </div>
                <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4', s.color, s.ring)}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-400" />
          <input type="text" placeholder="Search name, username, email..."
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10" />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
          {roleFilters.map((f) => (
            <button key={f.value} onClick={() => setRoleFilter(f.value)}
              className={clsx('rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-all',
                roleFilter === f.value ? 'bg-[#1E293B] text-white shadow-sm' : 'bg-white text-muted-600 border border-muted-200 hover:bg-muted-50')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* User Table */}
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] border border-muted-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-muted-100 bg-muted-50/50">
                <th className="text-left font-semibold text-muted-600 px-4 py-3">User</th>
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden md:table-cell">Contact</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Role</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3 hidden sm:table-cell">Status</th>
                {!isSingleBranch && <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Branch</th>}
                <th className="text-left font-semibold text-muted-600 px-4 py-3 hidden lg:table-cell">Last Login</th>
                <th className="text-center font-semibold text-muted-600 px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const rc = roleConfig[u.role] || roleConfig.CASHIER;
                const sc = statusConfig[u.status] || statusConfig.INACTIVE;
                const RoleIcon = rc.icon;
                // Super Admin can only be managed by another Super Admin
                const canEditThis = isSuperAdmin || u.role !== 'SUPER_ADMIN';
                return (
                  <tr key={u.id} className="border-b border-muted-50 hover:bg-muted-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          size="sm"
                          initials={getInitials(u)}
                          className={clsx('shrink-0 ring-2 ring-white text-white text-xs font-bold', getAvatarColor(u))}
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1E293B] text-sm truncate">{u.firstName} {u.lastName}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-xs text-muted-400">@{u.username}</p>
                            {u.password && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">
                                <KeyRound className="h-2.5 w-2.5" /> Password set
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="space-y-0.5">
                        <p className="text-xs text-muted-600 flex items-center gap-1"><Phone className="h-3 w-3" />{u.phone}</p>
                        {u.email && <p className="text-xs text-muted-400 flex items-center gap-1"><Mail className="h-3 w-3" />{u.email}</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold', rc.color)}>
                        <RoleIcon className="h-3 w-3" />{rc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center hidden sm:table-cell">
                      <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', sc.color)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {!isSingleBranch && <span className="text-xs text-muted-600 flex items-center gap-1"><MapPin className="h-3 w-3" />{u.branch}</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {u.lastLogin ? (
                        <span className="text-xs text-muted-500 flex items-center gap-1"><Clock className="h-3 w-3" />{formatDate(u.lastLogin, 'DD MMM, HH:mm')}</span>
                      ) : (
                        <span className="text-xs text-muted-400">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        {/* Activate / Deactivate */}
                        {canEditThis && (
                          u.isActive ? (
                            <button onClick={() => deactivateUser(u.id)}
                              className="text-xs font-semibold text-rose-600 hover:text-rose-800 whitespace-nowrap">
                              Deactivate
                            </button>
                          ) : (
                            <button onClick={() => activateUser(u.id)}
                              className="text-xs font-semibold text-emerald-600 hover:text-emerald-800 whitespace-nowrap">
                              Activate
                            </button>
                          )
                        )}

                        {/* Set Password — Super Admin or Admin only */}
                        {canManagePasswords && canEditThis && (
                          <button
                            onClick={() => openPwdModal(u)}
                            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-400 hover:text-[#1E293B] hover:bg-blue-50 transition-colors"
                            title="Set / Change Password"
                            aria-label="Set password"
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Delete */}
                        {canEditThis && (
                          <button
                            onClick={() => setDeleteTarget(u)}
                            className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            aria-label="Delete user"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-400">
                  <Users className="h-10 w-10 mx-auto mb-3 text-muted-300" />
                  <p className="text-sm font-medium">No users found</p>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Set / Change Password Modal ── */}
      {pwdTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E293B]/[0.06] shrink-0">
                  <KeyRound className="h-5 w-5 text-[#1E293B]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#1E293B]">
                    {pwdTarget.password ? 'Change Password' : 'Set Password'}
                  </h2>
                  <p className="text-xs text-muted-400 mt-0.5">
                    {pwdTarget.firstName} {pwdTarget.lastName} · @{pwdTarget.username}
                  </p>
                </div>
              </div>
              <button onClick={() => setPwdTarget(null)} className="p-2 rounded-lg hover:bg-muted-100">
                <X className="h-5 w-5 text-muted-400" />
              </button>
            </div>

            {pwdSuccess ? (
              <div className="px-5 py-10 flex flex-col items-center text-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
                  <Check className="h-7 w-7 text-emerald-600" />
                </div>
                <p className="text-base font-bold text-[#1E293B]">Password updated!</p>
                <p className="text-sm text-muted-500">
                  Password for <strong>{pwdTarget.firstName}</strong> has been set successfully.
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                {/* New Password */}
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1.5 block">New Password *</label>
                  <div className="relative">
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPwd}
                      onChange={(e) => { setNewPwd(e.target.value); setPwdError(''); }}
                      placeholder="Min. 6 characters"
                      className={clsx(inputClass, 'pr-10')}
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowNew((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                      {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Strength bar */}
                  {newPwd && strength && (
                    <div className="mt-2 space-y-1">
                      <div className="h-1.5 w-full bg-muted-100 rounded-full overflow-hidden">
                        <div className={clsx('h-full rounded-full transition-all', strength.color, strength.w)} />
                      </div>
                      <p className={clsx('text-[11px] font-medium',
                        strength.label === 'Strong' ? 'text-emerald-600' :
                        strength.label === 'Fair'   ? 'text-amber-500'   :
                        strength.label === 'Weak'   ? 'text-orange-500'  : 'text-rose-500')}>
                        {strength.label}
                      </p>
                    </div>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1.5 block">Confirm Password *</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPwd}
                      onChange={(e) => { setConfirmPwd(e.target.value); setPwdError(''); }}
                      placeholder="Re-enter new password"
                      className={clsx(inputClass, 'pr-10')}
                    />
                    <button type="button" onClick={() => setShowConfirm((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Match indicator */}
                  {confirmPwd && newPwd && (
                    <p className={clsx('text-[11px] font-medium mt-1', confirmPwd === newPwd ? 'text-emerald-600' : 'text-rose-500')}>
                      {confirmPwd === newPwd ? '✓ Passwords match' : '✗ Passwords do not match'}
                    </p>
                  )}
                </div>

                {/* Error */}
                {pwdError && (
                  <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-rose-700 font-medium">{pwdError}</p>
                  </div>
                )}

                {/* Tip */}
                <div className="rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5">
                  <p className="text-[11px] text-blue-600">
                    💡 A <strong>temporary password</strong> set here forces the user to create a new
                    password on their next login. Use a mix of uppercase, lowercase, numbers and symbols.
                  </p>
                  <p className="text-[11px] text-muted-500 mt-1">
                    If a user has forgotten their password, use the 🔑 key button here to reset it,
                    then share the temporary password with them securely.
                  </p>
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setPwdTarget(null)}
                    className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                    Cancel
                  </button>
                  <button
                    onClick={handleSetPassword}
                    disabled={!newPwd || !confirmPwd}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-40">
                    <KeyRound className="h-4 w-4" />
                    {pwdTarget.password ? 'Change Password' : 'Set Password'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 shrink-0">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1E293B]">Delete User</h3>
                <p className="text-sm text-muted-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-muted-600">
              Delete <span className="font-semibold text-[#1E293B]">{deleteTarget.firstName} {deleteTarget.lastName}</span>{' '}
              (@{deleteTarget.username})?
            </p>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add User Modal ── */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setAddModalOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-muted-100 px-5 py-4 flex items-center justify-between rounded-t-2xl z-10">
              <h2 className="text-lg font-bold text-[#1E293B]">Register New User</h2>
              <button onClick={() => setAddModalOpen(false)} className="p-2 rounded-lg hover:bg-muted-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">First Name *</label>
                  <input value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Last Name</label>
                  <input value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} className={inputClass} />
                </div>
              </div>

              {/* Username */}
              <div>
                <label className="text-xs font-semibold text-muted-600 mb-1 block">Username *</label>
                <input value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className={inputClass} />
              </div>

              {/* Contact */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Phone</label>
                  <input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className={inputClass} />
                </div>
              </div>

              {/* Role & Branch */}
              <div className={isSingleBranch ? '' : 'grid grid-cols-2 gap-4'}>
                <div>
                  <label className="text-xs font-semibold text-muted-600 mb-1 block">Role</label>
                  <select value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })} className={inputClass}>
                    {availableRoleOptions.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                {!isSingleBranch && (
                  <div>
                    <label className="text-xs font-semibold text-muted-600 mb-1 block">Branch</label>
                    <select
                      value={formData.branch || defaultBranch}
                      onChange={(e) => setFormData({ ...formData, branch: e.target.value })}
                      className={inputClass}
                    >
                      {activeBranches.map((b) => (
                        <option key={b.id} value={b.name}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Password section */}
              <div className="space-y-3 rounded-xl bg-muted-50 border border-muted-100 p-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-muted-400 shrink-0" />
                  <p className="text-xs font-semibold text-muted-600">Set Login Password <span className="font-normal text-muted-400">(optional — can be set later)</span></p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-600 mb-1 block">Password</label>
                    <div className="relative">
                      <input
                        type={showAddPwd ? 'text' : 'password'}
                        value={formData.password}
                        onChange={(e) => { setFormData({ ...formData, password: e.target.value }); setAddPwdError(''); }}
                        placeholder="Min. 6 chars"
                        className={clsx(inputClass, 'pr-9')}
                      />
                      <button type="button" onClick={() => setShowAddPwd((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                        {showAddPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-600 mb-1 block">Confirm</label>
                    <div className="relative">
                      <input
                        type={showAddConfirm ? 'text' : 'password'}
                        value={formData.confirmPassword}
                        onChange={(e) => { setFormData({ ...formData, confirmPassword: e.target.value }); setAddPwdError(''); }}
                        placeholder="Repeat"
                        className={clsx(inputClass, 'pr-9')}
                      />
                      <button type="button" onClick={() => setShowAddConfirm((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                        {showAddConfirm ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
                {formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword && (
                  <p className="text-[11px] text-rose-600 font-medium">✗ Passwords do not match</p>
                )}
                {formData.password && formData.confirmPassword && formData.password === formData.confirmPassword && (
                  <p className="text-[11px] text-emerald-600 font-medium">✓ Passwords match</p>
                )}
                {addPwdError && <p className="text-[11px] text-rose-600 font-medium">{addPwdError}</p>}
              </div>

              {/* Role hint */}
              <div className="bg-muted-50 rounded-xl p-4 border border-muted-100">
                <p className="text-xs font-semibold text-muted-600 mb-1.5">Role Permissions</p>
                <p className="text-xs text-muted-500">
                  {formData.role === 'SUPER_ADMIN'     && 'Full system access including user management, settings, and all modules'}
                  {formData.role === 'ADMIN'           && 'Full access to all business modules except system settings'}
                  {formData.role === 'MANAGER'         && 'Access to reports, inventory, sales oversight, and staff management'}
                  {formData.role === 'CASHIER'         && 'Access to POS terminal, sales processing, and cash drawer'}
                  {formData.role === 'INVENTORY_CLERK' && 'Access to inventory management, stock movements, and purchase orders'}
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setAddModalOpen(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-muted-600 hover:bg-muted-100">
                  Cancel
                </button>
                <button
                  onClick={() => void handleAdd()}
                  disabled={!formData.firstName || !formData.username ||
                    (!!formData.password && formData.password !== formData.confirmPassword)}
                  className="rounded-xl bg-[#1E293B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-40">
                  Register User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
