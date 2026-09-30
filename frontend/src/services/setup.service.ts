/**
 * setup.service.ts
 * ================
 * HTTP calls to the first-run setup API.
 * These endpoints are pre-auth (no JWT required).
 *
 * GET  /api/v1/setup/status/ — check whether setup is complete
 * POST /api/v1/setup/run/    — execute the one-shot atomic setup
 */

import axios from 'axios';
import { API_BASE_URL } from '@/utils/constants';

// Use a plain axios instance (no JWT interceptors — setup is pre-auth)
const setupApi = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  timeout: 30000,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SetupStatus {
  setup_complete: boolean;
  has_business: boolean;
  has_branch: boolean;
  has_admin: boolean;
  has_license: boolean;
}

export interface SetupPayload {
  business: {
    name: string;
    business_category: string;
    address: string;
    phone: string;
    email: string;
    currency: string;
    currency_symbol: string;
    /** Operating mode set during wizard — locked post-setup (except by cloud admin) */
    inventory_mode?: 'FULL_POS' | 'INVENTORY_ONLY' | 'POS_ONLY';
  };
  branch: {
    name: string;
    code: string;
    /** SINGLE = one location, no branch management; MULTI = multiple branches */
    branch_mode?: 'SINGLE' | 'MULTI';
  };
  admin: {
    first_name: string;
    last_name: string;
    email: string;
    username: string;
    password: string;
  };
  license: {
    activation_code: string;
    /** Optional cloud reservation token from Phase 1 cloud validation. */
    cloud_activation_token?: string;
  };
}

export interface SetupResult {
  success: boolean;
  business_id?: string;
  branch_id?: string;
  admin_username?: string;
  license?: {
    status: string;
    license_type: string;
    expiry_date: string | null;
    days_remaining: number | null;
    is_active: boolean;
  };
  error?: string;
  errors?: Record<string, Record<string, string | string[]>>;
}

// ── API calls ─────────────────────────────────────────────────────────────────

/** Poll this on cold-start to decide: show setup wizard or login page. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  const res = await setupApi.get<SetupStatus>('/setup/status/');
  return res.data;
}

/** Execute the one-shot atomic setup. Returns success or structured errors. */
export async function runSetup(payload: SetupPayload): Promise<SetupResult> {
  try {
    const res = await setupApi.post<SetupResult>('/setup/run/', payload);
    return res.data;
  } catch (err: unknown) {
    const ax = err as { response?: { data?: SetupResult; status?: number } };
    if (ax.response?.data) return ax.response.data;
    return { success: false, error: 'Network unavailable. Please check your connection.' };
  }
}
