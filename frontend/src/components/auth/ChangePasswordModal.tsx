/**
 * ChangePasswordModal
 * ====================
 * Self-service password change for the currently authenticated user.
 *
 * Requires:
 *   - Current (old) password
 *   - New password
 *   - Confirm new password
 *
 * Calls POST /api/v1/accounts/me/password/ and clears the
 * mustChangePassword flag in the auth store on success.
 *
 * Can be rendered in two modes:
 *   forced={false}  — normal "change my password" from the profile menu
 *   forced={true}   — full-screen modal when must_change_password is True,
 *                     cannot be dismissed until password is changed
 */
import { useState } from 'react';
import { KeyRound, Eye, EyeOff, X, Check, AlertTriangle, Lock, Info } from 'lucide-react';
import { clsx } from 'clsx';
import { changePassword } from '@/services/auth.service';
import { useAuthStore } from '@/stores/auth.store';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When true the modal cannot be dismissed — user MUST change their password */
  forced?: boolean;
}

function pwdStrength(p: string) {
  if (!p) return null;
  if (p.length < 6)  return { label: 'Too short', color: 'bg-rose-500',    w: 'w-1/4' };
  if (p.length < 8)  return { label: 'Weak',      color: 'bg-orange-400',  w: 'w-2/4' };
  if (!/[A-Z]/.test(p) || !/[0-9]/.test(p))
                     return { label: 'Fair',       color: 'bg-amber-400',   w: 'w-3/4' };
  return             { label: 'Strong',            color: 'bg-emerald-500', w: 'w-full' };
}

const inputCls = 'w-full h-10 px-3 rounded-xl bg-white border border-muted-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#1E293B]/10 pr-10';

export default function ChangePasswordModal({ open, onClose, forced = false }: Props) {
  const setMustChangePassword = useAuthStore((s) => s.setMustChangePassword);

  const [oldPwd,     setOldPwd]     = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showOld,    setShowOld]    = useState(false);
  const [showNew,    setShowNew]    = useState(false);
  const [showConf,   setShowConf]   = useState(false);
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [success,    setSuccess]    = useState(false);

  const strength = pwdStrength(newPwd);

  if (!open) return null;

  function reset() {
    setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    setError(''); setSuccess(false); setLoading(false);
  }

  function handleClose() {
    if (forced) return; // forced mode — cannot dismiss
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!oldPwd || !newPwd || !confirmPwd) {
      setError('All fields are required.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (newPwd.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await changePassword({
        old_password:     oldPwd,
        new_password:     newPwd,
        confirm_password: confirmPwd,
      });
      setMustChangePassword(false);
      setSuccess(true);
      setTimeout(() => {
        reset();
        onClose();
      }, 1800);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string | string[] } } })
          ?.response?.data?.detail;
      if (Array.isArray(msg)) {
        setError(msg.join(' '));
      } else {
        setError(msg ?? 'Password change failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-muted-100">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1E293B]/[0.06] shrink-0">
              <KeyRound className="h-5 w-5 text-[#1E293B]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#1E293B]">
                {forced ? 'Create New Password' : 'Change Password'}
              </h2>
              <p className="text-xs text-muted-400 mt-0.5">
                {forced ? 'Your password must be updated before continuing.' : 'Enter your current and new password.'}
              </p>
            </div>
          </div>
          {!forced && (
            <button
              type="button"
              onClick={handleClose}
              className="p-2 rounded-lg hover:bg-muted-100 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 text-muted-400" />
            </button>
          )}
        </div>

        {/* Forced-change notice */}
        {forced && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
            <Lock className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 font-medium">
              An administrator has reset your password. You must create a new password to continue.
            </p>
          </div>
        )}

        {success ? (
          <div className="px-5 py-10 flex flex-col items-center text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Check className="h-7 w-7 text-emerald-600" />
            </div>
            <p className="text-base font-bold text-[#1E293B]">Password changed!</p>
            <p className="text-sm text-muted-500">Your password has been updated successfully.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {/* Current password */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">
                Current Password *
              </label>
              <div className="relative">
                <input
                  type={showOld ? 'text' : 'password'}
                  value={oldPwd}
                  onChange={(e) => { setOldPwd(e.target.value); setError(''); }}
                  placeholder="Your current password"
                  className={inputCls}
                  autoFocus
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowOld((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                  {showOld ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* New password */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">
                New Password *
              </label>
              <div className="relative">
                <input
                  type={showNew ? 'text' : 'password'}
                  value={newPwd}
                  onChange={(e) => { setNewPwd(e.target.value); setError(''); }}
                  placeholder="Min. 8 characters"
                  className={inputCls}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowNew((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
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

            {/* Confirm password */}
            <div>
              <label className="text-xs font-semibold text-muted-600 mb-1.5 block">
                Confirm New Password *
              </label>
              <div className="relative">
                <input
                  type={showConf ? 'text' : 'password'}
                  value={confirmPwd}
                  onChange={(e) => { setConfirmPwd(e.target.value); setError(''); }}
                  placeholder="Re-enter new password"
                  className={inputCls}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConf((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-400 hover:text-muted-600">
                  {showConf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {confirmPwd && newPwd && (
                <p className={clsx('text-[11px] font-medium mt-1',
                  confirmPwd === newPwd ? 'text-emerald-600' : 'text-rose-500')}>
                  {confirmPwd === newPwd ? '✓ Passwords match' : '✗ Passwords do not match'}
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2.5">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700 font-medium">{error}</p>
              </div>
            )}

            {/* Forgot password tip — only in non-forced mode */}
            {!forced && (
              <div className="flex items-start gap-2 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2.5">
                <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-blue-600">
                  <strong>Forgot your current password?</strong> Contact your Business Admin or
                  Super Admin — they can reset it for you.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className={clsx('flex gap-3 pt-1', forced ? '' : '')}>
              {!forced && (
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 rounded-xl border border-muted-200 px-4 py-2.5 text-sm font-semibold text-muted-600 hover:bg-muted-50 transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !oldPwd || !newPwd || !confirmPwd}
                className={clsx(
                  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#1E293B] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#334155] disabled:opacity-40 transition-colors',
                  forced ? 'w-full' : 'flex-1',
                )}
              >
                <KeyRound className="h-4 w-4" />
                {loading ? 'Saving…' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
