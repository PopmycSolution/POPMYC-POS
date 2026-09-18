/**
 * ProfilePictureModal
 * ====================
 * Upload / change / remove the authenticated user's own profile picture.
 *
 * In offline / demo mode (local-session-* token) the upload UI is hidden
 * entirely and a plain notice is shown instead — no API calls are made.
 */
import { useState, useRef, useCallback } from 'react';
import { X, Camera, Trash2, Upload, AlertTriangle, Check, User } from 'lucide-react';
import { clsx } from 'clsx';
import { uploadAvatar, removeAvatar } from '@/services/auth.service';
import { useAuthStore } from '@/stores/auth.store';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT   = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_BYTES     = 5 * 1024 * 1024;

interface Props {
  open: boolean;
  onClose: () => void;
  currentAvatarUrl?: string | null;
  initials: string;
}

export default function ProfilePictureModal({ open, onClose, currentAvatarUrl, initials }: Props) {
  const setAvatarUrl = useAuthStore((s) => s.setAvatarUrl);

  const [preview, setPreview] = useState<string | null>(null);
  const [file,    setFile]    = useState<File | null>(null);
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [isDrag,  setIsDrag]  = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // True when running in offline / local-demo mode — no real JWT available.
  const isDemo = (() => {
    const token = useAuthStore.getState().accessToken ?? '';
    return !token || token.startsWith('local-session-');
  })();

  function reset() {
    setPreview(null); setFile(null); setError('');
    setLoading(false); setSuccess(false);
  }

  function handleClose() { reset(); onClose(); }

  function validateAndStage(f: File) {
    setError('');
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_TYPES.includes(f.type) && !ALLOWED_EXT.includes(ext)) {
      setError('Unsupported format. Use JPG, PNG, or WEBP.'); return;
    }
    if (f.size > MAX_BYTES) {
      setError(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`); return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(f);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) validateAndStage(f);
    e.target.value = '';
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDrag(false);
    const f = e.dataTransfer.files?.[0];
    if (f) validateAndStage(f);
  }, []); // eslint-disable-line

  async function handleUpload() {
    if (!file || isDemo) return;
    setLoading(true); setError('');
    try {
      const res = await uploadAvatar(file);
      setAvatarUrl(res.profile_picture_url ?? null);
      setSuccess(true);
      setTimeout(() => { reset(); onClose(); }, 1600);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Upload failed. Please try again.');
    } finally { setLoading(false); }
  }

  async function handleRemove() {
    if (isDemo) return;
    setLoading(true); setError('');
    try {
      await removeAvatar();
      setAvatarUrl(null);
      setSuccess(true);
      setTimeout(() => { reset(); onClose(); }, 1200);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? 'Could not remove picture.');
    } finally { setLoading(false); }
  }

  if (!open) return null;

  const displayUrl = preview ?? currentAvatarUrl ?? null;

  /* ── Shared header ─────────────────────────────────────────────────────── */
  const header = (
    <div className="flex items-center justify-between px-5 py-4"
      style={{ borderBottom: '1px solid var(--border-card)' }}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: 'var(--mint-alpha)' }}>
          <Camera className="h-5 w-5" style={{ color: 'var(--mint)' }} />
        </div>
        <div>
          <h2 className="text-base font-bold text-page-primary">Profile Picture</h2>
          <p className="text-xs text-page-muted mt-0.5">JPG, PNG, WEBP · Max 5 MB</p>
        </div>
      </div>
      <button type="button" onClick={handleClose}
        className="p-2 rounded-lg text-page-muted hover:text-page-primary transition-colors"
        style={{ background: 'transparent' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--mint-alpha)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  /* ── Shared avatar circle ──────────────────────────────────────────────── */
  const avatarCircle = (interactive: boolean) => (
    <div className="flex flex-col items-center gap-3">
      <div
        className={clsx(
          'relative h-28 w-28 rounded-full overflow-hidden flex items-center justify-center text-2xl font-bold transition-all',
          interactive && isDrag ? 'ring-4 scale-105' : '',
        )}
        style={{
          background: displayUrl ? 'transparent' : 'var(--mint-alpha)',
          border: '3px solid var(--mint-glow)',
          color: 'var(--mint)',
        }}
        onDragOver={interactive ? (e) => { e.preventDefault(); setIsDrag(true); } : undefined}
        onDragLeave={interactive ? () => setIsDrag(false) : undefined}
        onDrop={interactive ? handleDrop : undefined}
      >
        {displayUrl
          ? <img src={displayUrl} alt="avatar preview" className="h-full w-full object-cover" />
          : initials
            ? <span>{initials}</span>
            : <User className="h-10 w-10" style={{ color: 'var(--mint)' }} />}

        {interactive && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
            style={{ background: 'rgba(0,0,0,.45)' }}
            onClick={() => inputRef.current?.click()}>
            <Camera className="h-7 w-7 text-white" />
          </div>
        )}
      </div>
      {interactive && (
        <p className="text-xs text-page-muted">Drag & drop or click the avatar to pick a file</p>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="relative w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-scale-in"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-base)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {header}

        {/* ── DEMO MODE — store avatar locally in Zustand (base64) ──── */}
        {isDemo ? (
          <div className="p-5 space-y-5">
            {avatarCircle(true)}

            {/* Subtle info strip — no warning, just an explanation */}
            <div className="flex items-start gap-2.5 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--mint-alpha)', border: '1px solid var(--mint-glow)' }}>
              <Camera className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--mint)' }} />
              <p className="text-xs font-medium" style={{ color: 'var(--mint)' }}>
                Offline mode — your picture is saved locally and will persist across logins.
              </p>
            </div>

            <input ref={inputRef} type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="hidden" onChange={handleFileInput} />

            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => inputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                style={{ background: 'var(--mint-alpha)', color: 'var(--mint)', border: '1px solid var(--mint-glow)' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                <Upload className="h-4 w-4" />
                {preview ? 'Choose different file' : 'Choose image'}
              </button>

              {/* Save locally — just write the base64 preview into the store */}
              {file && preview && !loading && (
                <button type="button" onClick={() => {
                  setAvatarUrl(preview);
                  setSuccess(true);
                  setTimeout(() => { reset(); onClose(); }, 1400);
                }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all"
                  style={{ background: 'var(--mint)', color: '#0a1628' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}>
                  <Check className="h-4 w-4" />
                  Save picture
                </button>
              )}
            </div>

            {/* Remove locally stored picture */}
            {currentAvatarUrl && !file && (
              <button type="button" onClick={() => {
                setAvatarUrl(null);
                setSuccess(true);
                setTimeout(() => { reset(); onClose(); }, 1200);
              }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-500 transition-colors"
                style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.25)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <Trash2 className="h-4 w-4" />
                Remove picture
              </button>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)' }}>
                <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-500 font-medium">{error}</p>
              </div>
            )}
          </div>
        ) : success ? (
          /* ── SUCCESS STATE ─────────────────────────────────────────────── */
          <div className="px-5 py-12 flex flex-col items-center text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: 'var(--mint-alpha)' }}>
              <Check className="h-7 w-7" style={{ color: 'var(--mint)' }} />
            </div>
            <p className="text-base font-bold text-page-primary">Done!</p>
            <p className="text-sm text-page-muted">
              {file ? 'Profile picture updated.' : 'Profile picture removed.'}
            </p>
          </div>
        ) : (
          /* ── LIVE MODE — full upload UI ───────────────────────────────── */
          <div className="p-5 space-y-5">
            {avatarCircle(true)}

            <input ref={inputRef} type="file"
              accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
              className="hidden" onChange={handleFileInput} />

            <div className="flex flex-col gap-2">
              {/* Choose file */}
              <button type="button" onClick={() => inputRef.current?.click()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all"
                style={{ background: 'var(--mint-alpha)', color: 'var(--mint)', border: '1px solid var(--mint-glow)' }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}>
                <Upload className="h-4 w-4" />
                {preview ? 'Choose different file' : 'Choose image'}
              </button>

              {/* Save — only when a file is staged */}
              {file && !loading && (
                <button type="button" onClick={handleUpload}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all"
                  style={{ background: 'var(--mint)', color: '#0a1628' }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.opacity = '0.85')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.opacity = '1')}>
                  <Check className="h-4 w-4" />
                  Save picture
                </button>
              )}

              {/* Spinner */}
              {loading && (
                <div className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                  style={{ background: 'var(--mint-alpha)', color: 'var(--mint)' }}>
                  <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Uploading…
                </div>
              )}
            </div>

            {/* Remove — only when a picture already exists and no new file staged */}
            {currentAvatarUrl && !file && !loading && (
              <button type="button" onClick={handleRemove}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-500 transition-colors"
                style={{ background: 'transparent', border: '1px solid rgba(239,68,68,.25)' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <Trash2 className="h-4 w-4" />
                Remove picture
              </button>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)' }}>
                <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-500 font-medium">{error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
