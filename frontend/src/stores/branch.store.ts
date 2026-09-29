/**
 * Branch Store — local-first with optional backend sync
 *
 * Uses Zustand `persist` as the single storage mechanism (key: 'popmyc-branches').
 * main.tsx wipes stale entries before React mounts, so no duplicate IIFE here.
 *
 * activeBranchId:
 *   null  → "All Branches"  (Super Admin aggregate view)
 *   <id>  → scoped to that specific branch
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Branch } from '@/types';
import * as branchService from '@/services/branch.service';

// ── Helpers ───────────────────────────────────────────────────────────────────
function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `branch-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}
function nowIso(): string { return new Date().toISOString(); }

// ── Seed data — used on first run / after store wipe ─────────────────────────
// No seed branches — branches are loaded from the backend after login.
export const SEED_BRANCHES: Branch[] = [];

// ── Detect local/demo session (no real backend) ───────────────────────────────
function isLocalSession(): boolean {
  try {
    const raw = localStorage.getItem('access_token') ?? '';
    if (raw.startsWith('local-session-')) return true;
    const stored = localStorage.getItem('popmyc-auth-storage');
    if (stored) {
      const p = JSON.parse(stored) as { state?: { accessToken?: string } };
      if ((p?.state?.accessToken ?? '').startsWith('local-session-')) return true;
    }
  } catch { /* noop */ }
  return false;
}

// ── Store shape ───────────────────────────────────────────────────────────────
interface BranchStore {
  branches: Branch[];
  activeBranchId: string | null;
  loading: boolean;
  error: string | null;

  fetchBranches: () => Promise<void>;
  setActiveBranch: (id: string | null) => void;

  /** Local-first: optimistic add, then tries API */
  addBranch: (payload: branchService.BranchPayload) => Promise<Branch>;
  /** Local-first: optimistic edit, then tries API */
  editBranch: (id: string, payload: Partial<branchService.BranchPayload>) => Promise<Branch>;
  /** Local-first: toggles isActive optimistically, then tries API */
  toggleActive: (id: string) => Promise<void>;
  /** Local-first: removes optimistically, then tries API */
  removeBranch: (id: string) => Promise<void>;

  getBranchById: (id: string) => Branch | undefined;
}

// ── Store ─────────────────────────────────────────────────────────────────────
export const useBranchStore = create<BranchStore>()(
  persist(
    (set, get) => ({
      branches:       [],
      activeBranchId: null,
      loading:        false,
      error:          null,

      // ── FETCH ────────────────────────────────────────────────────────────────
      fetchBranches: async () => {
        if (isLocalSession()) { set({ loading: false }); return; }
        set({ loading: true, error: null });
        try {
          const branches = await branchService.getBranches();
          set({ branches, loading: false });
        } catch {
          set({ loading: false });
        }
      },

      setActiveBranch: (id) => set({ activeBranchId: id }),

      // ── ADD ──────────────────────────────────────────────────────────────────
      addBranch: async (payload) => {
        const local: Branch = {
          id:           genId(),
          business:     payload.business,
          name:         payload.name,
          code:         payload.code.toUpperCase(),
          address:      payload.address      ?? '',
          phone:        payload.phone        ?? '',
          isHeadOffice: payload.is_head_office ?? false,
          isActive:     payload.is_active      ?? true,
          createdAt:    nowIso(),
          updatedAt:    nowIso(),
        };

        set((s) => ({ branches: [local, ...s.branches] }));

        try {
          const saved = await branchService.createBranch(payload);
          set((s) => ({ branches: s.branches.map((b) => b.id === local.id ? saved : b) }));
          return saved;
        } catch {
          return local;
        }
      },

      // ── EDIT ─────────────────────────────────────────────────────────────────
      editBranch: async (id, payload) => {
        const existing = get().branches.find((b) => b.id === id);
        if (!existing) throw new Error('Branch not found');

        const optimistic: Branch = {
          ...existing,
          name:         payload.name              ?? existing.name,
          code:         payload.code?.toUpperCase() ?? existing.code,
          address:      payload.address           ?? existing.address,
          phone:        payload.phone             ?? existing.phone,
          isHeadOffice: payload.is_head_office     ?? existing.isHeadOffice,
          isActive:     payload.is_active          ?? existing.isActive,
          updatedAt:    nowIso(),
        };

        set((s) => ({ branches: s.branches.map((b) => b.id === id ? optimistic : b) }));

        try {
          const saved = await branchService.updateBranch(id, payload);
          set((s) => ({ branches: s.branches.map((b) => b.id === id ? saved : b) }));
          return saved;
        } catch {
          return optimistic;
        }
      },

      // ── TOGGLE ACTIVE ────────────────────────────────────────────────────────
      toggleActive: async (id) => {
        const branch = get().branches.find((b) => b.id === id);
        if (!branch) return;

        const toggled: Branch = { ...branch, isActive: !branch.isActive, updatedAt: nowIso() };
        set((s) => ({ branches: s.branches.map((b) => b.id === id ? toggled : b) }));

        try {
          const saved = toggled.isActive
            ? await branchService.activateBranch(id)
            : await branchService.deactivateBranch(id);
          set((s) => ({ branches: s.branches.map((b) => b.id === id ? saved : b) }));
        } catch { /* optimistic change stands */ }
      },

      // ── REMOVE ───────────────────────────────────────────────────────────────
      removeBranch: async (id) => {
        set((s) => ({
          branches:       s.branches.filter((b) => b.id !== id),
          activeBranchId: s.activeBranchId === id ? null : s.activeBranchId,
        }));
        try { await branchService.deleteBranch(id); } catch { /* optimistic removal stands */ }
      },

      getBranchById: (id) => get().branches.find((b) => b.id === id),
    }),
    {
      name: 'popmyc-branches',
      partialize: (s) => ({
        branches:       s.branches,
        activeBranchId: s.activeBranchId,
      }),
    },
  ),
);
