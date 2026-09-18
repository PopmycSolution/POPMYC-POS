/**
 * cloudLicense.service.ts
 * =======================
 * Two-phase cloud TrialCode activation service.
 *
 * IMPORTANT — scope of this service
 * -----------------------------------
 * This file is used ONLY during the first-run Setup Wizard activation step.
 * It talks to the POPMYC Render cloud backend to validate and consume a
 * cloud-issued TrialCode.
 *
 * It NEVER replaces or intercepts normal POS API calls.
 * API_BASE_URL (local backend) is not touched here.
 * All endpoints used here point to CLOUD_LICENSE_URL.
 *
 * Phase 1 — validateTrialCode()
 *   POST <cloud>/api/v1/cloud/trial/validate/
 *   Checks that the TrialCode is PENDING on the cloud.
 *   Returns a short-lived reservation token (10 minutes).
 *   Does NOT consume the code.
 *
 * Phase 2 — completeTrialActivation()
 *   POST <cloud>/api/v1/cloud/trial/complete/
 *   Called AFTER the local setup has committed the TRIAL License.
 *   Atomically marks the cloud TrialCode as USED.
 *   Idempotent — safe to retry after network failure.
 *
 * Retry behaviour
 * ---------------
 * completeTrialActivation() stores the pending token in localStorage
 * under PENDING_COMPLETION_KEY so the app can retry on next startup
 * if the initial call fails due to a transient network error.
 *
 * Security
 * --------
 * - Never stores TrialCode raw value beyond the duration of the wizard step.
 * - Never exposes cloud DB credentials, SECRET_KEY, or Django internals.
 * - The reservation token is opaque to the frontend; it only passes it back.
 * - CLOUD_LICENSE_URL is never used for normal POS API calls.
 */

import axios, { AxiosError } from 'axios';
import { CLOUD_LICENSE_URL } from '@/utils/constants';

// ── localStorage key for pending completion retry ─────────────────────────────
export const PENDING_COMPLETION_KEY = 'popmyc_pending_activation_token';

// ── Dedicated axios instance — never shares config with the local POS client ──
const cloudApi = axios.create({
  baseURL: CLOUD_LICENSE_URL,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  // Generous timeout — Render may be on a cold-start (free tier spins up slowly)
  timeout: 20_000,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActivationErrorCode =
  | 'missing_code'
  | 'invalid_code'
  | 'already_used'
  | 'revoked'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'cloud_unavailable';

export interface ValidateResult {
  success: true;
  reservationToken: string;
  expiresInSeconds: number;
  trialDays: number;
  message: string;
}

export interface ValidateFailure {
  success: false;
  errorCode: ActivationErrorCode;
  message: string;
}

export type ValidateTrialCodeResult = ValidateResult | ValidateFailure;

export interface CompleteResult {
  success: true;
  trialDays: number;
  message: string;
  /** true when the completion was already recorded (idempotent repeat) */
  wasAlreadyComplete?: boolean;
}

export interface CompleteFailure {
  success: false;
  errorCode: ActivationErrorCode | 'expired_reservation' | 'invalid_token';
  message: string;
  /**
   * true  → transient error; caller should save token to localStorage and retry
   * false → permanent failure; token is gone, restart activation
   */
  retry: boolean;
}

export type CompleteTrialActivationResult = CompleteResult | CompleteFailure;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _classifyAxiosError(err: unknown): { code: ActivationErrorCode; message: string } {
  if (!axios.isAxiosError(err)) {
    return {
      code: 'server_error',
      message: 'An unexpected error occurred. Please try again.',
    };
  }

  const ax = err as AxiosError<{
    valid?: boolean;
    error?: string;
    message?: string;
    completed?: boolean;
    detail?: string;
  }>;

  // No response at all — network or timeout
  if (!ax.response) {
    if (ax.code === 'ECONNABORTED' || ax.message?.includes('timeout')) {
      return {
        code: 'timeout',
        message:
          'The request timed out. Render may be starting up — please wait 30 seconds and try again.',
      };
    }
    return {
      code: 'network_error',
      message:
        'Cannot reach the POPMYC cloud service. Please check your internet connection.',
    };
  }

  const serverError = ax.response.data?.error ?? '';
  const serverMsg =
    ax.response.data?.message ??
    ax.response.data?.detail ??
    'An error occurred. Please try again.';

  if (ax.response.status === 503) {
    return { code: 'cloud_unavailable', message: 'Cloud service is temporarily unavailable.' };
  }

  if (serverError === 'already_used') return { code: 'already_used', message: serverMsg };
  if (serverError === 'revoked')      return { code: 'revoked',       message: serverMsg };
  if (serverError === 'invalid_code') return { code: 'invalid_code',  message: serverMsg };

  return { code: 'server_error', message: serverMsg };
}

// ── Phase 1 ───────────────────────────────────────────────────────────────────

/**
 * Validate a cloud-issued TrialCode.
 *
 * Calls POST <cloud>/api/v1/cloud/trial/validate/ and returns a short-lived
 * reservation token on success, or a structured error on failure.
 *
 * Does NOT consume the TrialCode.
 */
export async function validateTrialCode(
  activationCode: string,
): Promise<ValidateTrialCodeResult> {
  const normalised = activationCode.trim().toUpperCase();

  if (!normalised) {
    return {
      success: false,
      errorCode: 'missing_code',
      message: 'Please enter your activation code.',
    };
  }

  try {
    const res = await cloudApi.post<{
      valid: boolean;
      reservation_token: string;
      expires_in_seconds: number;
      trial_days: number;
      message: string;
      error?: string;
    }>('/api/v1/cloud/trial/validate/', { activation_code: normalised });

    const d = res.data;

    if (!d.valid) {
      const errCode = (d.error as ActivationErrorCode) ?? 'invalid_code';
      return {
        success: false,
        errorCode: errCode,
        message: d.message ?? 'The activation code is not valid.',
      };
    }

    return {
      success: true,
      reservationToken: d.reservation_token,
      expiresInSeconds: d.expires_in_seconds ?? 600,
      trialDays: d.trial_days ?? 7,
      message: d.message ?? 'Code validated.',
    };
  } catch (err) {
    // 400 responses from DRF come through the catch block
    if (axios.isAxiosError(err) && err.response?.status === 400) {
      const d = err.response.data as {
        valid?: boolean;
        error?: string;
        message?: string;
      };
      const errCode = (d.error as ActivationErrorCode) ?? 'invalid_code';
      return {
        success: false,
        errorCode: errCode,
        message: d.message ?? 'The activation code is not valid.',
      };
    }

    const { code, message } = _classifyAxiosError(err);
    return { success: false, errorCode: code, message };
  }
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

/**
 * Complete the trial activation by consuming the cloud TrialCode.
 *
 * Must be called AFTER the local setup has successfully committed the
 * TRIAL License.  The local license is NOT affected by the result of
 * this call — it is already active.
 *
 * On transient failure, the token is stored in localStorage under
 * PENDING_COMPLETION_KEY so the app can retry on next startup.
 *
 * On success the pending token is cleared from localStorage.
 */
export async function completeTrialActivation(
  reservationToken: string,
): Promise<CompleteTrialActivationResult> {
  try {
    const res = await cloudApi.post<{
      completed: boolean;
      trial_days: number;
      message: string;
      error?: string;
      retry?: boolean;
    }>('/api/v1/cloud/trial/complete/', { reservation_token: reservationToken });

    const d = res.data;

    if (d.completed) {
      // Clear any stored pending token — completion succeeded
      try { localStorage.removeItem(PENDING_COMPLETION_KEY); } catch { /* ignore */ }

      return {
        success: true,
        trialDays: d.trial_days ?? 7,
        message: d.message ?? 'Trial activation recorded.',
      };
    }

    // Completed=false in a 200 response is unusual but handle it
    return {
      success: false,
      errorCode: (d.error as CompleteFailure['errorCode']) ?? 'server_error',
      message: d.message ?? 'Activation could not be completed.',
      retry: d.retry ?? false,
    };
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError<{
        completed?: boolean;
        error?: string;
        message?: string;
        retry?: boolean;
      }>;

      // Idempotent 200 already handled above; 4xx = permanent failure
      if (ax.response?.status === 400 || ax.response?.status === 409) {
        const d = ax.response.data;
        const errCode =
          (d?.error as CompleteFailure['errorCode']) ?? 'invalid_token';
        return {
          success: false,
          errorCode: errCode,
          message:
            d?.message ??
            'The activation reservation is no longer valid. Please start activation again.',
          retry: false,
        };
      }

      // 5xx or network → transient; store for retry
      const { code, message } = _classifyAxiosError(err);
      const isTransient =
        code === 'network_error' || code === 'timeout' || ax.response?.status === 500;

      if (isTransient) {
        try {
          localStorage.setItem(PENDING_COMPLETION_KEY, reservationToken);
        } catch { /* ignore storage errors */ }
      }

      return {
        success: false,
        errorCode: code,
        message,
        retry: isTransient,
      };
    }

    // Unknown error — store for retry
    try { localStorage.setItem(PENDING_COMPLETION_KEY, reservationToken); } catch { /* ignore */ }

    return {
      success: false,
      errorCode: 'server_error',
      message: 'An unexpected error occurred. Your local license is still active.',
      retry: true,
    };
  }
}

// ── Startup retry ─────────────────────────────────────────────────────────────

/**
 * On app startup, check if there is a pending completion stored from a
 * previous activation that failed due to a transient network error.
 *
 * Call this once from App.tsx (or equivalent) after the app has loaded.
 * The result is informational only — the local license is already active
 * regardless of what this returns.
 */
export async function retryPendingCompletion(): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(PENDING_COMPLETION_KEY);
  } catch { return; }

  if (!token) return;

  const result = await completeTrialActivation(token);

  if (result.success) {
    // Cleared by completeTrialActivation on success
    console.info('[POPMYC] Pending cloud activation completion recorded successfully.');
  } else if (!result.retry) {
    // Permanent failure — clear the token so we don't retry forever
    try { localStorage.removeItem(PENDING_COMPLETION_KEY); } catch { /* ignore */ }
    console.warn('[POPMYC] Pending cloud activation could not be completed:', result.message);
  }
  // If retry=true we leave the token and try again next startup
}
