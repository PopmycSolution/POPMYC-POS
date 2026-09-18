/**
 * reports.service.ts
 * ==================
 * HTTP calls for the reports API.
 * Endpoint base: /api/v1/reports/
 *
 * The P&L endpoint returns data calculated entirely from real backend
 * transactions — Sale.grand_total, SaleItem.cost_price_snapshot,
 * SaleReturn.net_refund_amount, and Expense.total_amount.
 */
import api from './api';

// ── P&L types ────────────────────────────────────────────────────────────────

export interface PLRevenue {
  gross_sales:     number;
  total_discounts: number;
  total_returns:   number;
  total_tax:       number;
  net_sales:       number;
  sale_count:      number;
}

export interface PLExpenses {
  total:       number;
  operating:   number;
  tax:         number;
  capex:       number;
  by_category: Array<{ category__name: string; category__type: string; total: number }>;
}

export interface PLStockLosses {
  total_cost_value: number;
  by_type: Array<{ type: string; units_lost: number; cost_value: number }>;
}

export interface PLTrendPoint {
  day:       string;
  revenue:   number;
  discounts: number;
  count:     number;
}

export interface PLCategory {
  product__category__name: string;
  revenue:      number;
  cogs:         number;
  discount:     number;
  qty_sold:     number;
  gross_profit: number;
  margin_pct:   number;
}

export interface PLReport {
  period:           { from: string | null; to: string | null };
  branch_id:        string | null;
  revenue:          PLRevenue;
  cogs:             number;
  gross_profit:     number;
  gross_margin_pct: number;
  expenses:         PLExpenses;
  net_profit:       number;
  net_margin_pct:   number;
  stock_losses:     PLStockLosses;
  trend:            PLTrendPoint[];
  by_category:      PLCategory[];
}

/** Fetch the full P&L report from the backend */
export async function fetchPLReport(params: {
  period?:    string;
  date_from?: string;
  date_to?:   string;
  branch?:    string;
}): Promise<PLReport> {
  const res = await api.get<PLReport>('/reports/profit/', { params });
  const d   = res.data;
  // Coerce all Decimal strings to numbers
  return {
    ...d,
    cogs:             Number(d.cogs),
    gross_profit:     Number(d.gross_profit),
    gross_margin_pct: Number(d.gross_margin_pct),
    net_profit:       Number(d.net_profit),
    net_margin_pct:   Number(d.net_margin_pct),
    revenue: {
      gross_sales:     Number(d.revenue?.gross_sales     ?? 0),
      total_discounts: Number(d.revenue?.total_discounts ?? 0),
      total_returns:   Number(d.revenue?.total_returns   ?? 0),
      total_tax:       Number(d.revenue?.total_tax       ?? 0),
      net_sales:       Number(d.revenue?.net_sales       ?? 0),
      sale_count:      Number(d.revenue?.sale_count      ?? 0),
    },
    expenses: {
      total:       Number(d.expenses?.total     ?? 0),
      operating:   Number(d.expenses?.operating ?? 0),
      tax:         Number(d.expenses?.tax       ?? 0),
      capex:       Number(d.expenses?.capex     ?? 0),
      by_category: (d.expenses?.by_category ?? []).map((c) => ({
        ...c, total: Number(c.total),
      })),
    },
    stock_losses: {
      total_cost_value: Number(d.stock_losses?.total_cost_value ?? 0),
      by_type: (d.stock_losses?.by_type ?? []).map((t) => ({
        ...t,
        units_lost: Number(t.units_lost),
        cost_value: Number(t.cost_value),
      })),
    },
    trend: (d.trend ?? []).map((t) => ({
      ...t,
      revenue:   Number(t.revenue),
      discounts: Number(t.discounts),
      count:     Number(t.count),
    })),
    by_category: (d.by_category ?? []).map((c) => ({
      ...c,
      revenue:      Number(c.revenue),
      cogs:         Number(c.cogs),
      discount:     Number(c.discount),
      qty_sold:     Number(c.qty_sold),
      gross_profit: Number(c.gross_profit),
      margin_pct:   Number(c.margin_pct),
    })),
  };
}

/** Build a local P&L summary from Zustand store data (used in demo/offline mode) */
export function buildLocalPL(
  sales: Array<{ status: string; totalAmount: number; discountAmount: number; taxAmount: number; createdAt: string; branchId?: string | null }>,
  expenses: Array<{ status: string; totalAmount: number; expenseDate: string; branchId?: string | null }>,
  dateFrom?: string,
  dateTo?:   string,
  branchId?: string,
): PLReport {
  const inRange = (d: string) => {
    const day = d.slice(0, 10);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo   && day > dateTo  ) return false;
    return true;
  };

  const completedSales = sales.filter((s) =>
    s.status === 'COMPLETED' &&
    inRange(s.createdAt) &&
    (!branchId || s.branchId === branchId)
  );

  const gross_sales     = completedSales.reduce((a, s) => a + s.totalAmount,    0);
  const total_discounts = completedSales.reduce((a, s) => a + s.discountAmount, 0);
  const total_tax       = completedSales.reduce((a, s) => a + s.taxAmount,      0);
  const net_sales       = gross_sales - total_discounts;

  const paidExpenses = expenses.filter((e) =>
    ['APPROVED', 'PAID'].includes(e.status) &&
    inRange(e.expenseDate) &&
    (!branchId || e.branchId === branchId)
  );
  const total_expenses = paidExpenses.reduce((a, e) => a + e.totalAmount, 0);

  // No cost_price_snapshot in local store — COGS is 0 in offline mode
  const cogs         = 0;
  const gross_profit = net_sales - cogs;
  const net_profit   = gross_profit - total_expenses;

  return {
    period:           { from: dateFrom ?? null, to: dateTo ?? null },
    branch_id:        branchId ?? null,
    revenue:          { gross_sales, total_discounts, total_returns: 0, total_tax, net_sales, sale_count: completedSales.length },
    cogs,
    gross_profit,
    gross_margin_pct: net_sales > 0 ? Math.round((gross_profit / net_sales) * 100 * 100) / 100 : 0,
    expenses:         { total: total_expenses, operating: total_expenses, tax: 0, capex: 0, by_category: [] },
    net_profit,
    net_margin_pct:   net_sales > 0 ? Math.round((net_profit   / net_sales) * 100 * 100) / 100 : 0,
    stock_losses:     { total_cost_value: 0, by_type: [] },
    trend:            [],
    by_category:      [],
  };
}
