import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { API_BASE_URL } from '@/utils/constants';
import { getAccessToken } from './auth.service';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Imperatively clears auth state and redirects to /login.
 * Only called when the refresh token itself is expired/invalid.
 * With 24h access + 90d refresh tokens, this should almost never happen
 * during normal POS usage.
 */
function forceLogout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  useAuthStore.getState().logout();
  const nav = (window as Window & { __navigate?: (path: string) => void }).__navigate;
  if (nav) {
    nav('/login');
  } else {
    window.location.replace('/login');
  }
}

/**
 * Silently refresh the access token using the stored refresh token.
 * Called proactively on app startup so the token is always fresh.
 * Never throws — failures are silently ignored (user keeps their session).
 */
export async function silentRefreshToken(): Promise<void> {
  if (isLocalDemoSession()) return;
  try {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return;
    // Only refresh if access token is within 2 hours of expiring
    const raw = localStorage.getItem('access_token') ?? '';
    if (raw) {
      try {
        const [, payload] = raw.split('.');
        const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number };
        const twoHoursFromNow = Date.now() / 1000 + 7200;
        if (exp > twoHoursFromNow) return; // still has plenty of time — skip
      } catch { /* can't decode — refresh anyway */ }
    }
    const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, { refresh: refreshToken });
    if (response.data?.access) {
      localStorage.setItem('access_token', response.data.access);
      if (response.data.refresh) localStorage.setItem('refresh_token', response.data.refresh);
    }
  } catch { /* silently ignore — user keeps existing token */ }
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
});

/**
 * Returns true when the app is running in local / demo mode.
 * loginWithLocalCredentials stores the token inside Zustand's persist key
 * ('popmyc-auth-storage'), NOT in the raw 'access_token' key.
 * We check both locations so detection is reliable.
 */
function isLocalDemoSession(): boolean {
  try {
    // 1. Raw key written by authService.setTokens (real backend login)
    const raw = localStorage.getItem('access_token') ?? '';
    if (raw.startsWith('local-session-')) return true;

    // 2. Zustand persist key written by loginWithLocalCredentials
    const stored = localStorage.getItem('popmyc-auth-storage');
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { accessToken?: string; refreshToken?: string } };
      const token = parsed?.state?.accessToken ?? '';
      if (token.startsWith('local-session-')) return true;
      const refresh = parsed?.state?.refreshToken ?? '';
      if (refresh.startsWith('local-refresh-')) return true;
    }
  } catch { /* noop */ }
  return false;
}

api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean; _skipAuthRedirect?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Local/demo sessions never expire — never redirect to login
      if (isLocalDemoSession()) {
        return Promise.reject(error);
      }

      // Non-critical background requests (e.g. avatar fetch) should not force-logout
      if (originalRequest._skipAuthRedirect) {
        return Promise.reject(error);
      }

      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (!refreshToken) {
          forceLogout();
          return Promise.reject(error);
        }

        const response = await axios.post(`${API_BASE_URL}/auth/refresh/`, {
          refresh: refreshToken,
        });

        if (response.data?.access) {
          localStorage.setItem('access_token', response.data.access);
          if (response.data.refresh) {
            localStorage.setItem('refresh_token', response.data.refresh);
          }
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${response.data.access}`;
          }
          return api(originalRequest);
        }
      } catch {
        // Only redirect if genuinely a real backend session
        if (!isLocalDemoSession()) {
          forceLogout();
        }
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
