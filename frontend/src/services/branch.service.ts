import api from './api';
import type { Branch } from '@/types';

// ── API response shapes ──────────────────────────────────────────────────────

export interface BranchPayload {
  name: string;
  code: string;
  address?: string;
  phone?: string;
  is_head_office?: boolean;
  is_active?: boolean;
  business: string; // Business UUID — required by backend
}

// Django REST Framework returns paginated lists by default
interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Raw backend shape → frontend Branch ──────────────────────────────────────
function mapBranch(raw: Record<string, unknown>): Branch {
  return {
    id:          String(raw.id),
    business:    String(raw.business),
    name:        String(raw.name),
    code:        String(raw.code),
    address:     String(raw.address ?? ''),
    phone:       String(raw.phone ?? ''),
    isHeadOffice: Boolean(raw.is_head_office),
    isActive:    Boolean(raw.is_active),
    createdAt:   String(raw.created_at ?? ''),
    updatedAt:   String(raw.updated_at ?? ''),
  };
}

// ── Service calls ─────────────────────────────────────────────────────────────

/** Fetch all branches for the authenticated user's business. */
export async function getBranches(): Promise<Branch[]> {
  const res = await api.get<PaginatedResponse<Record<string, unknown>> | Record<string, unknown>[]>(
    '/branches/branches/',
    { params: { page_size: 200 } },
  );
  const data = res.data;
  // Handle both paginated and plain-array responses
  const raw = Array.isArray(data) ? data : (data as PaginatedResponse<Record<string, unknown>>).results ?? [];
  return raw.map(mapBranch);
}

/** Fetch a single branch by ID. */
export async function getBranch(id: string): Promise<Branch> {
  const res = await api.get<Record<string, unknown>>(`/branches/branches/${id}/`);
  return mapBranch(res.data);
}

/** Create a new branch. */
export async function createBranch(payload: BranchPayload): Promise<Branch> {
  const res = await api.post<Record<string, unknown>>('/branches/branches/', payload);
  return mapBranch(res.data);
}

/** Update an existing branch (PATCH — partial). */
export async function updateBranch(id: string, payload: Partial<BranchPayload>): Promise<Branch> {
  const res = await api.patch<Record<string, unknown>>(`/branches/branches/${id}/`, payload);
  return mapBranch(res.data);
}

/** Soft-delete a branch by marking it inactive. */
export async function deactivateBranch(id: string): Promise<Branch> {
  return updateBranch(id, { is_active: false });
}

/** Re-activate a branch. */
export async function activateBranch(id: string): Promise<Branch> {
  return updateBranch(id, { is_active: true });
}

/** Hard-delete a branch (use with caution). */
export async function deleteBranch(id: string): Promise<void> {
  await api.delete(`/branches/branches/${id}/`);
}
