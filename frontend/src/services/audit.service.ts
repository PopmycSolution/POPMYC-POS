/**
 * audit.service.ts
 * ================
 * HTTP calls for the audit log API.
 * Endpoint: GET /api/v1/audit/audit-logs/
 *
 * The backend AuditLogViewSet is ReadOnly, business-scoped, and supports:
 *   - filter: action, module, entity_type, user, business
 *   - search: reason, entity_type, module, ip_address
 *   - date range: start_date, end_date (YYYY-MM-DD)
 *   - ordering: -created_at (default)
 *   - pagination: limit / offset
 */
import api from './api';

// ── Raw backend shape ─────────────────────────────────────────────────────────

export interface RawAuditLog {
  id: string;
  business: string | null;
  user: string | null;           // UUID
  user_display?: string | null;  // may be annotated by viewset
  action: string;                // CREATE / UPDATE / DELETE / LOGIN / LOGOUT / etc.
  module: string;                // e.g. "Sale", "Product", "User"
  entity_type: string;           // e.g. "sale", "product"
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string;
  reason: string;
  created_at: string;            // ISO 8601
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userName: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string | null;
  description: string;
  ipAddress: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
}

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface FetchAuditParams {
  action?: string;
  module?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  count: number;
  entries: AuditLogEntry[];
}

// ── Mapping ───────────────────────────────────────────────────────────────────

export function mapAuditLog(raw: RawAuditLog): AuditLogEntry {
  // Build a human-readable description from available fields
  let description = raw.reason?.trim() || '';
  if (!description) {
    const action = raw.action.toLowerCase().replace(/_/g, ' ');
    description = `${action} on ${raw.entity_type || raw.module}`;
    if (raw.entity_id) description += ` (${raw.entity_id.slice(0, 8)}…)`;
  }

  // Derive a display name: prefer annotated user_display, fall back to "System"
  const userName = raw.user_display?.trim() || (raw.user ? `User ${raw.user.slice(0, 8)}…` : 'System');

  return {
    id:          raw.id,
    timestamp:   raw.created_at,
    userName,
    action:      raw.action,
    module:      raw.module || raw.entity_type || '—',
    entityType:  raw.entity_type,
    entityId:    raw.entity_id,
    description,
    ipAddress:   raw.ip_address ?? '—',
    oldValues:   raw.old_values ?? null,
    newValues:   raw.new_values ?? null,
  };
}

// ── API call ──────────────────────────────────────────────────────────────────

export async function fetchAuditLogs(params: FetchAuditParams = {}): Promise<AuditPage> {
  const res = await api.get<PaginatedResponse<RawAuditLog> | RawAuditLog[]>(
    '/audit/audit-logs/',
    {
      params: {
        limit:   params.limit   ?? 50,
        offset:  params.offset  ?? 0,
        ordering: '-created_at',
        ...(params.action     ? { action:     params.action     } : {}),
        ...(params.module     ? { module:     params.module     } : {}),
        ...(params.search     ? { search:     params.search     } : {}),
        ...(params.start_date ? { start_date: params.start_date } : {}),
        ...(params.end_date   ? { end_date:   params.end_date   } : {}),
      },
    }
  );

  if (Array.isArray(res.data)) {
    return { count: res.data.length, entries: res.data.map(mapAuditLog) };
  }
  const paged = res.data as PaginatedResponse<RawAuditLog>;
  return {
    count:   paged.count,
    entries: (paged.results ?? []).map(mapAuditLog),
  };
}
