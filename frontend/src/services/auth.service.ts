import type { User } from '@/types';
import api from './api';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';
const USER_KEY = 'user';

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface LoginResponseData {
  access: string;
  refresh: string;
  user: User;
}

export function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
}

export function getAccessToken(): string | null {
  // 1. Real backend login stores the token here via setTokens()
  const raw = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (raw) return raw;

  // 2. Local / offline login (loginWithLocalCredentials) stores it inside
  //    the Zustand persist key — fall back to that so API calls still get
  //    an Authorization header in offline/demo mode.
  try {
    const stored = localStorage.getItem('popmyc-auth-storage');
    if (stored) {
      const parsed = JSON.parse(stored) as { state?: { accessToken?: string } };
      const token = parsed?.state?.accessToken;
      if (token) return token;
    }
  } catch { /* noop */ }

  return null;
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): User | null {
  const userStr = localStorage.getItem(USER_KEY);

  if (!userStr) return null;

  try {
    return JSON.parse(userStr) as User;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();

  if (!token) return false;

  try {
    const base64Url = token.split('.')[1];

    if (!base64Url) return false;

    const base64 = base64Url
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const payload = JSON.parse(window.atob(base64));
    const exp = payload.exp;

    if (exp && Date.now() >= exp * 1000) {
      return false;
    }

    return true;
  } catch {
    return true;
  }
}

export async function login(
  credentials: LoginCredentials
): Promise<LoginResponseData> {
  const response = await api.post<LoginResponseData>(
    '/auth/login/',
    {
      // Send under 'username' so the backend LoginSerializer can match directly
      // by username without relying on EmailField validation.
      // The backend also accepts 'email' as a fallback, so both paths work.
      username: credentials.email,
      password: credentials.password,
    }
  );

  const data = response.data;

  // Save authentication data immediately
  setTokens({
    access: data.access,
    refresh: data.refresh,
  });

  setUser(data.user);

  return data;
}

export function logout(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ── Password management ────────────────────────────────────────────────────────

export interface ChangePasswordPayload {
  old_password: string;
  new_password: string;
  confirm_password: string;
}

export interface ChangePasswordResponse {
  detail: string;
  must_change_password: boolean;
}

/**
 * Self-service: authenticated user changes their own password.
 * Requires old_password, new_password, confirm_password.
 * POST /api/v1/accounts/me/password/
 */
export async function changePassword(
  payload: ChangePasswordPayload
): Promise<ChangePasswordResponse> {
  const response = await api.post<ChangePasswordResponse>(
    '/accounts/me/password/',
    payload
  );
  return response.data;
}

export interface AdminResetPasswordPayload {
  new_password?: string;
}

export interface AdminResetPasswordResponse {
  detail: string;
  must_change_password: boolean;
  temporary_password: string;
}

/**
 * Admin-only: reset another user's password.
 * Business isolation is enforced server-side.
 * POST /api/v1/accounts/users/{userId}/reset-password/
 */
export async function adminResetPassword(
  userId: string,
  payload: AdminResetPasswordPayload = {}
): Promise<AdminResetPasswordResponse> {
  const response = await api.post<AdminResetPasswordResponse>(
    `/accounts/users/${userId}/reset-password/`,
    payload
  );
  return response.data;
}

// ── Profile picture ────────────────────────────────────────────────────────────

export interface AvatarUploadResponse {
  detail: string;
  profile_picture_url: string | null;
}

/**
 * Upload or replace the authenticated user's profile picture.
 * Sends multipart/form-data with field name "avatar".
 * POST /api/v1/accounts/me/avatar/
 */
export async function uploadAvatar(file: File): Promise<AvatarUploadResponse> {
  const form = new FormData();
  form.append('avatar', file);
  const response = await api.post<AvatarUploadResponse>(
    '/accounts/me/avatar/',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data;
}

/**
 * Remove the authenticated user's profile picture.
 * DELETE /api/v1/accounts/me/avatar/
 */
export async function removeAvatar(): Promise<AvatarUploadResponse> {
  const response = await api.delete<AvatarUploadResponse>('/accounts/me/avatar/');
  return response.data;
}
