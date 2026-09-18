import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

/**
 * avatarsByUserId  — per-user avatar map, keyed by user.id
 *
 * Stored separately from `user` so that:
 *  - logout (which nulls `user`) does NOT erase anyone's avatar
 *  - login re-attaches only THAT user's own avatar
 *  - different users each have their own independent picture
 *  - works for both offline (base64 data URL) and live (server URL) modes
 */

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /** Per-user avatar store: { [userId]: url } */
  avatarsByUserId: Record<string, string | null>;
  /**
   * True once Zustand persist has rehydrated from localStorage.
   * Components must wait for this before rendering auth-gated routes
   * to avoid the flash-of-unauthenticated-content blink on reload.
   * Initialized synchronously to true when localStorage already has data
   * so that the very first render is already correct.
   */
  _hasHydrated: boolean;

  setAuth: (data: { user: User; accessToken: string; refreshToken: string; mustChangePassword?: boolean }) => void;
  setUser: (user: User) => void;
  setMustChangePassword: (value: boolean) => void;
  /** Set the current user's avatar URL */
  setAvatarUrl: (url: string | null) => void;
  loginWithLocalCredentials: (user: User) => void;
  /** @deprecated use loginWithLocalCredentials */
  loginAsDemo: (user: User) => void;
  logout: () => void;
  /** Called by the onRehydrateStorage callback — do not call manually */
  setHasHydrated: (v: boolean) => void;
}

/** Read avatar for a given user id from the per-user map */
function pickAvatar(map: Record<string, string | null>, userId: string, backendUrl?: string | null): string | null {
  // Backend-returned URL always wins over locally stored one
  if (backendUrl) return backendUrl;
  return map[userId] ?? null;
}

/**
 * Synchronously check if localStorage already has auth data.
 * When it does, we can start with _hasHydrated=true so the very first
 * render never sees a false → true transition (eliminating the blink entirely).
 */
function readHydratedFromStorage(): boolean {
  try {
    const raw = localStorage.getItem('popmyc-auth-storage');
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: { isAuthenticated?: boolean; accessToken?: string } };
    return (
      parsed?.state?.isAuthenticated === true ||
      (typeof parsed?.state?.accessToken === 'string' && parsed.state.accessToken.length > 0)
    );
  } catch {
    return false;
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      avatarsByUserId: {},
      // Synchronously true when localStorage already has auth — eliminates the
      // false→true transition on page reload that caused the blink/loop.
      _hasHydrated: readHydratedFromStorage(),

      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setAuth: ({ user, accessToken, refreshToken, mustChangePassword }) => {
        const map = get().avatarsByUserId;
        const avatarUrl = pickAvatar(map, user.id, user.avatarUrl);
        // Update the map with whatever we resolved
        const updatedMap = { ...map, [user.id]: avatarUrl };
        set({
          avatarsByUserId: updatedMap,
          user: {
            ...user,
            mustChangePassword: mustChangePassword ?? user.mustChangePassword ?? false,
            avatarUrl,
          },
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
      },

      setUser: (user) => {
        set({ user });
      },

      setMustChangePassword: (value) => {
        set((state) => ({
          user: state.user ? { ...state.user, mustChangePassword: value } : state.user,
        }));
      },

      setAvatarUrl: (url) => {
        set((state) => {
          if (!state.user) return {};
          const updatedMap = { ...state.avatarsByUserId, [state.user.id]: url };
          return {
            avatarsByUserId: updatedMap,
            user: { ...state.user, avatarUrl: url },
          };
        });
      },

      loginWithLocalCredentials: (user) => {
        const map = get().avatarsByUserId;
        // Only restore THIS user's own avatar — never another user's
        const avatarUrl = pickAvatar(map, user.id, user.avatarUrl);
        const updatedMap = { ...map, [user.id]: avatarUrl };
        set({
          avatarsByUserId: updatedMap,
          user: { ...user, avatarUrl },
          accessToken:  `local-session-${user.id}`,
          refreshToken: `local-refresh-${user.id}`,
          isAuthenticated: true,
        });
      },

      loginAsDemo: (user) => {
        const map = get().avatarsByUserId;
        const avatarUrl = pickAvatar(map, user.id, user.avatarUrl);
        const updatedMap = { ...map, [user.id]: avatarUrl };
        set({
          avatarsByUserId: updatedMap,
          user: { ...user, avatarUrl },
          accessToken:  `local-session-${user.id}`,
          refreshToken: `local-refresh-${user.id}`,
          isAuthenticated: true,
        });
      },

      logout: () => {
        // Clear session — avatarsByUserId map intentionally preserved for next login.
        // _hasHydrated stays true: the store IS hydrated, we just have no session.
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          _hasHydrated: true,
        });
      },
    }),
    {
      name: 'popmyc-auth-storage',
      partialize: (state) => ({
        user:            state.user,
        accessToken:     state.accessToken,
        refreshToken:    state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        avatarsByUserId: state.avatarsByUserId,   // persisted per-user map
        // _hasHydrated is intentionally NOT persisted — it's runtime only
      }),
      onRehydrateStorage: () => (state) => {
        // Called by Zustand once localStorage has been read and merged.
        // Setting _hasHydrated to true signals that auth state is now stable
        // and route guards can render without a blink.
        if (state) state.setHasHydrated(true);
      },
    }
  )
);
