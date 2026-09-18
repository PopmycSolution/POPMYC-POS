/**
 * suppliers.service.ts
 * ====================
 * HTTP calls for the suppliers API.
 * Endpoint base: /api/v1/suppliers/
 *
 * Business isolation is enforced server-side via BusinessScopedMixin —
 * every request only returns/modifies data belonging to the authenticated
 * user's business.
 */
import api from './api';
import type {
  SupplierRecord,
  SupplierTransaction,
} from '@/stores/supplier.store';

// ── Raw backend shapes ──────────────────────────────────────────────────────

export interface RawSupplier {
  id: string;
  business: string;
  name: string;
  code: string;
  supplier_type: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  tin: string;
  credit_limit: string | number;
  credit_days: number;
  payment_terms: string;
  bank_name: string;
  bank_account: string;
  bank_branch: string;
  bank_swift: string;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Aggregated from SupplierBalance (joined in serializer if available)
  total_purchases?: string | number;
  total_paid?: string | number;
  balance?: string | number;
  last_purchase_date?: string | null;
}

export interface RawSupplierTransaction {
  id: string;
  supplier: string;
  business: string;
  type: string;
  reference: string;
  amount: string | number;
  balance_after: string | number;
  transaction_date: string;
  notes: string;
  created_at: string;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── Mapping helpers ──────────────────────────────────────────────────────────

export function mapSupplier(raw: RawSupplier): SupplierRecord {
  return {
    id:             raw.id,
    name:           raw.name,
    code:           raw.code,
    supplierType:   raw.supplier_type as SupplierRecord['supplierType'],
    contactPerson:  raw.contact_person ?? '',
    phone:          raw.phone ?? '',
    email:          raw.email ?? '',
    address:        raw.address ?? '',
    city:           raw.city ?? '',
    country:        raw.country ?? '',
    tin:            raw.tin ?? '',
    creditLimit:    Number(raw.credit_limit ?? 0),
    creditDays:     Number(raw.credit_days ?? 0),
    totalPurchases: Number(raw.total_purchases ?? 0),
    totalPaid:      Number(raw.total_paid ?? 0),
    balance:        Number(raw.balance ?? 0),
    isActive:       Boolean(raw.is_active),
    branchId:       null,
    createdAt:      raw.created_at,
  };
}

export function mapTransaction(raw: RawSupplierTransaction): SupplierTransaction {
  return {
    id:              raw.id,
    supplierId:      raw.supplier,
    supplierName:    '',          // enriched by the caller if needed
    type:            raw.type as SupplierTransaction['type'],
    reference:       raw.reference ?? '',
    amount:          Number(raw.amount ?? 0),
    balanceAfter:    Number(raw.balance_after ?? 0),
    transactionDate: raw.transaction_date,
    notes:           raw.notes ?? '',
  };
}

// ── API calls ────────────────────────────────────────────────────────────────

/** Fetch all suppliers for the authenticated business */
export async function fetchSuppliers(params?: Record<string, string>): Promise<SupplierRecord[]> {
  const res = await api.get<PaginatedResponse<RawSupplier> | RawSupplier[]>(
    '/suppliers/suppliers/',
    { params: { limit: 200, ordering: 'name', ...(params ?? {}) } },
  );
  const list = Array.isArray(res.data) ? res.data : res.data.results ?? [];
  return list.map(mapSupplier);
}

/** Create a new supplier */
export async function createSupplier(payload: {
  name: string;
  code?: string;
  supplier_type?: string;
  contact_person?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  country?: string;
  tin?: string;
  credit_limit?: number;
  credit_days?: number;
  notes?: string;
  is_active?: boolean;
}): Promise<SupplierRecord> {
  const res = await api.post<RawSupplier>('/suppliers/suppliers/', payload);
  return mapSupplier(res.data);
}

/** Update an existing supplier */
export async function updateSupplier(
  id: string,
  payload: Partial<Parameters<typeof createSupplier>[0]>,
): Promise<SupplierRecord> {
  const res = await api.patch<RawSupplier>(`/suppliers/suppliers/${id}/`, payload);
  return mapSupplier(res.data);
}

/** Deactivate (soft-delete) a supplier */
export async function deactivateSupplier(id: string): Promise<SupplierRecord> {
  return updateSupplier(id, { is_active: false });
}

/** Fetch transactions for a specific supplier */
export async function fetchTransactions(supplierId: string): Promise<SupplierTransaction[]> {
  const res = await api.get<PaginatedResponse<RawSupplierTransaction> | RawSupplierTransaction[]>(
    '/suppliers/supplier-transactions/',
    { params: { supplier: supplierId, ordering: '-transaction_date', limit: 200 } },
  );
  const list = Array.isArray(res.data) ? res.data : res.data.results ?? [];
  return list.map(mapTransaction);
}

/** Record a new supplier transaction (invoice / payment) */
export async function recordTransaction(payload: {
  supplier: string;
  type: string;
  reference?: string;
  amount: number;
  transaction_date: string;
  notes?: string;
}): Promise<SupplierTransaction> {
  const res = await api.post<RawSupplierTransaction>(
    '/suppliers/supplier-transactions/',
    payload,
  );
  return mapTransaction(res.data);
}
