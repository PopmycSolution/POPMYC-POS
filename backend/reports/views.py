import csv
import io
from datetime import datetime, timedelta
from decimal import Decimal

from django.db.models import Sum, Count, Avg, Q, F, Value as V, Min, Max
from django.db.models.functions import Coalesce, TruncDay, TruncWeek, TruncMonth, ExtractHour
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_date_range(request):
    date_from = request.query_params.get("date_from")
    date_to = request.query_params.get("date_to")
    preset = request.query_params.get("period", "custom")
    today = timezone.now().date()

    if preset == "today":
        date_from = today
        date_to = today
    elif preset == "yesterday":
        date_from = today - timedelta(days=1)
        date_to = today - timedelta(days=1)
    elif preset == "this_week":
        date_from = today - timedelta(days=today.weekday())
        date_to = today
    elif preset == "last_week":
        start_prev = today - timedelta(days=today.weekday() + 7)
        date_from = start_prev
        date_to = start_prev + timedelta(days=6)
    elif preset == "this_month":
        date_from = today.replace(day=1)
        date_to = today
    elif preset == "last_month":
        first_day_current = today.replace(day=1)
        last_day_prev = first_day_current - timedelta(days=1)
        date_from = last_day_prev.replace(day=1)
        date_to = last_day_prev

    return date_from, date_to


def resolve_business(request):
    """
    Return (business_obj_or_None, business_id_or_None, error_response_or_None).

    Rules:
      - Superusers: trust the ?business= query param if supplied; otherwise None (all).
      - Regular users: always use their assigned business, ignore query param.
      - Regular users with no business: return a 403 error response.
    """
    user = request.user
    if user.is_superuser:
        biz_id = request.query_params.get("business")
        return None, biz_id, None  # business object not needed for superuser path
    if not user.business_id:
        err = Response({"detail": "No business assigned to your account."}, status=403)
        return None, None, err
    return user.business, str(user.business_id), None


def apply_filters(queryset, request, filters=None):
    if filters is None:
        filters = []
    for f in filters:
        val = request.query_params.get(f)
        if val:
            queryset = queryset.filter(**{f: val})
    return queryset


def csv_response(rows, headers, filename):
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = f'attachment; filename="{filename}.csv"'
    writer = csv.writer(response)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)
    return response


def excel_response(rows, headers, filename):
    try:
        from openpyxl import Workbook
        output = io.BytesIO()
        wb = Workbook()
        ws = wb.active
        ws.title = "Report"
        ws.append(headers)
        for row in rows:
            ws.append([str(v) for v in row])
        wb.save(output)
        output.seek(0)
        response = HttpResponse(
            output.getvalue(),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}.xlsx"'
        return response
    except ImportError:
        return csv_response(rows, headers, filename)


def html_response(title, headers, rows, filename):
    html = f"""
    <!DOCTYPE html>
    <html><head><title>{title}</title>
    <style>body{{font-family:sans-serif}}table{{border-collapse:collapse;width:100%}}
    th,td{{border:1px solid #ccc;padding:8px;text-align:left}}th{{background:#f5f5f5}}
    h1{{color:#333}}</style></head><body>
    <h1>{title}</h1>
    <p>Generated: {timezone.now()}</p>
    <table><thead><tr>{"".join(f"<th>{h}</th>" for h in headers)}</tr></thead>
    <tbody>{"".join(f"<tr>{''.join(f'<td>{v}</td>' for v in row)}</tr>" for row in rows)}</tbody>
    </table></body></html>
    """
    return HttpResponse(html)


# ---------------------------------------------------------------------------
# Report views
# ---------------------------------------------------------------------------

class SalesReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        fmt = request.query_params.get("format")
        date_from, date_to = parse_date_range(request)

        from sales.models import Sale, SaleItem

        qs = Sale.objects.all()
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        qs = apply_filters(qs, request, ["branch", "cashier"])

        paid = qs.filter(status="COMPLETED")
        summary = paid.aggregate(
            total_sales     = Coalesce(Sum("grand_total"),    Decimal("0.00")),
            total_items     = Coalesce(Count("items"),        0),
            avg_order_value = Coalesce(Avg("grand_total"),    Decimal("0.00")),
            total_discount  = Coalesce(Sum("total_discount"), Decimal("0.00")),
            total_tax       = Coalesce(Sum("total_tax"),      Decimal("0.00")),
        )
        summary["net_sales"] = summary["total_sales"] - summary["total_discount"]

        items_qs = SaleItem.objects.filter(sale__in=paid)
        by_product = (
            items_qs.values("product__id", "product__name")
            .annotate(qty=Sum("qty"), total=Sum("total_line"))
            .order_by("-total")[:20]
        )
        by_category = (
            items_qs.values("product__category__name")
            .annotate(total=Sum("total_line"))
            .order_by("-total")
        )
        by_cashier = (
            paid.values("cashier__username")
            .annotate(total=Sum("grand_total"), count=Count("id"))
            .order_by("-total")
        )
        by_hour = (
            paid.annotate(hour=ExtractHour("created_at"))
            .values("hour")
            .annotate(total=Sum("grand_total"))
            .order_by("hour")
        )
        from sales.models import SalePayment
        payment_breakdown = (
            SalePayment.objects.filter(sale__in=paid)
            .values("method_code")
            .annotate(total=Sum("amount"), count=Count("id"))
            .order_by("-total")
        )
        top_sellers = by_product[:5]

        result = {
            "period": {"from": date_from, "to": date_to},
            "summary": summary,
            "by_product": list(by_product),
            "by_category": list(by_category),
            "by_cashier": list(by_cashier),
            "by_hour": list(by_hour),
            "payment_method_breakdown": list(payment_breakdown),
            "top_sellers": list(top_sellers),
        }

        if fmt == "csv":
            headers = ["Metric", "Value"]
            rows = [
                ["Total Sales", summary["total_sales"]],
                ["Total Items", summary["total_items"]],
                ["Avg Order Value", summary["avg_order_value"]],
                ["Total Discount", summary["total_discount"]],
                ["Total Tax", summary["total_tax"]],
                ["Net Sales", summary["net_sales"]],
            ]
            return csv_response(rows, headers, "sales_report")
        if fmt in ["excel", "xlsx"]:
            headers = ["Metric", "Value"]
            rows = [
                ["Total Sales", summary["total_sales"]],
                ["Total Items", summary["total_items"]],
            ]
            return excel_response(rows, headers, "sales_report")
        if fmt == "pdf":
            headers = ["Metric", "Value"]
            rows = [[k, v] for k, v in summary.items()]
            return html_response("Sales Report", headers, rows, "sales_report")
        return Response(result)


class ProfitReportView(APIView):
    """
    GET /api/v1/reports/profit/

    Full Profit & Loss report using real transaction data.

    P&L structure:
      Gross Sales          = sum(grand_total) on COMPLETED sales
      − Discounts          = sum(total_discount) on same sales
      − Returns/Refunds    = sum(net_refund_amount) on COMPLETED SaleReturns
      = Net Sales

      COGS                 = sum(cost_price_snapshot * qty) on SaleItems of COMPLETED sales
      = Gross Profit       = Net Sales − COGS

      Operating Expenses   = sum(total_amount) on Expenses with status APPROVED or PAID
      = Net Profit/Loss    = Gross Profit − Operating Expenses

    Stock Losses (Damage/Expired/Lost/Theft/Internal Use) are reported separately
    with their cost value for inventory-loss tracking. They are NOT subtracted from
    revenue (they are not sales) but are surfaced as a line for management review.

    Query params:
      period       : today | yesterday | this_week | last_week | this_month |
                     last_month | this_year | custom
      date_from    : YYYY-MM-DD  (for custom period)
      date_to      : YYYY-MM-DD  (for custom period)
      branch       : UUID  (optional — omit for business-wide)
      business     : UUID  (superuser only)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)
        branch_id = request.query_params.get("branch")

        from sales.models import Sale, SaleItem, SaleReturn
        from expenses.models import Expense
        from inventory.models import StockMovement

        # ── Base querysets ────────────────────────────────────────────────────
        # Revenue: COMPLETED sales only (excludes VOIDED/HELD/DRAFT/PENDING_SYNC)
        sales_qs = Sale.objects.filter(status="COMPLETED")
        if biz_id:
            sales_qs = sales_qs.filter(business_id=biz_id)
        if branch_id:
            sales_qs = sales_qs.filter(branch_id=branch_id)
        if date_from:
            sales_qs = sales_qs.filter(created_at__date__gte=date_from)
        if date_to:
            sales_qs = sales_qs.filter(created_at__date__lte=date_to)

        # ── 1. Revenue ────────────────────────────────────────────────────────
        revenue_agg = sales_qs.aggregate(
            gross_sales     = Coalesce(Sum("grand_total"),    Decimal("0.00")),
            total_discounts = Coalesce(Sum("total_discount"), Decimal("0.00")),
            total_tax       = Coalesce(Sum("total_tax"),      Decimal("0.00")),
            sale_count      = Count("id"),
        )
        gross_sales      = revenue_agg["gross_sales"]
        total_discounts  = revenue_agg["total_discounts"]
        total_tax        = revenue_agg["total_tax"]

        # Returns / Refunds (COMPLETED SaleReturns in the same period)
        returns_qs = SaleReturn.objects.filter(
            status="COMPLETED",
            original_sale__in=sales_qs,
        )
        if date_from:
            returns_qs = returns_qs.filter(created_at__date__gte=date_from)
        if date_to:
            returns_qs = returns_qs.filter(created_at__date__lte=date_to)

        total_returns = returns_qs.aggregate(
            t=Coalesce(Sum("net_refund_amount"), Decimal("0.00"))
        )["t"]

        net_sales = gross_sales - total_discounts - total_returns

        # ── 2. COGS from cost_price_snapshot ─────────────────────────────────
        items_qs = SaleItem.objects.filter(sale__in=sales_qs)
        cogs_agg = items_qs.aggregate(
            cogs=Coalesce(
                Sum(F("cost_price_snapshot") * F("qty")),
                Decimal("0.00"),
            )
        )
        cogs = cogs_agg["cogs"]

        # ── 3. Gross Profit ───────────────────────────────────────────────────
        gross_profit        = net_sales - cogs
        gross_margin_pct    = (
            round(float(gross_profit / net_sales) * 100, 2)
            if net_sales > 0 else 0.0
        )

        # ── 4. Operating Expenses (APPROVED or PAID) ──────────────────────────
        exp_qs = Expense.objects.filter(status__in=["APPROVED", "PAID"])
        if biz_id:
            exp_qs = exp_qs.filter(business_id=biz_id)
        if branch_id:
            exp_qs = exp_qs.filter(branch_id=branch_id)
        if date_from:
            exp_qs = exp_qs.filter(expense_date__gte=date_from)
        if date_to:
            exp_qs = exp_qs.filter(expense_date__lte=date_to)

        exp_totals = exp_qs.aggregate(
            total      = Coalesce(Sum("total_amount"), Decimal("0.00")),
            operating  = Coalesce(
                Sum("total_amount", filter=Q(category__type="OPERATING")),
                Decimal("0.00"),
            ),
            tax_exp    = Coalesce(
                Sum("total_amount", filter=Q(category__type="TAX")),
                Decimal("0.00"),
            ),
            capex      = Coalesce(
                Sum("total_amount", filter=Q(category__type="CAPEX")),
                Decimal("0.00"),
            ),
        )
        total_expenses = exp_totals["total"]

        expenses_by_category = list(
            exp_qs.values("category__name", "category__type")
            .annotate(total=Coalesce(Sum("total_amount"), Decimal("0.00")))
            .order_by("-total")
        )

        # ── 5. Net Profit / Loss ──────────────────────────────────────────────
        net_profit      = gross_profit - total_expenses
        net_margin_pct  = (
            round(float(net_profit / net_sales) * 100, 2)
            if net_sales > 0 else 0.0
        )

        # ── 6. Stock losses (informational — NOT subtracted from revenue) ─────
        # Loss movement types that carry a cost impact
        LOSS_TYPES = ("DAMAGED", "EXPIRED", "LOST", "THEFT", "INTERNAL_USE", "SUPPLIER_RETURN")
        loss_qs = StockMovement.objects.filter(
            type__in=LOSS_TYPES,
            qty_delta__lt=0,
        )
        if biz_id:
            loss_qs = loss_qs.filter(business_id=biz_id)
        if branch_id:
            loss_qs = loss_qs.filter(branch_id=branch_id)
        if date_from:
            loss_qs = loss_qs.filter(created_at__date__gte=date_from)
        if date_to:
            loss_qs = loss_qs.filter(created_at__date__lte=date_to)

        stock_loss_value = loss_qs.aggregate(
            v=Coalesce(
                Sum(F("unit_cost") * (F("qty_delta") * -1)),
                Decimal("0.00"),
            )
        )["v"]

        stock_losses_by_type = list(
            loss_qs.values("type")
            .annotate(
                units_lost = Coalesce(Sum(F("qty_delta") * -1), 0),
                cost_value = Coalesce(Sum(F("unit_cost") * (F("qty_delta") * -1)), Decimal("0.00")),
            )
            .order_by("-cost_value")
        )

        # ── 7. Revenue trend (daily/monthly for charting) ─────────────────────
        trend = list(
            sales_qs
            .annotate(day=TruncDay("created_at"))
            .values("day")
            .annotate(
                revenue   = Coalesce(Sum("grand_total"),    Decimal("0.00")),
                discounts = Coalesce(Sum("total_discount"), Decimal("0.00")),
                count     = Count("id"),
            )
            .order_by("day")
        )

        # ── 8. COGS & gross profit by product category ────────────────────────
        by_category = list(
            items_qs
            .values("product__category__name")
            .annotate(
                revenue  = Coalesce(Sum("total_line"),                                  Decimal("0.00")),
                cogs     = Coalesce(Sum(F("cost_price_snapshot") * F("qty")),           Decimal("0.00")),
                discount = Coalesce(Sum("line_discount_amt"),                            Decimal("0.00")),
                qty_sold = Coalesce(Sum("qty"),                                          Decimal("0.00")),
            )
            .order_by("-revenue")
        )
        for cat in by_category:
            rev = cat["revenue"] or Decimal("0.00")
            cg  = cat["cogs"]    or Decimal("0.00")
            cat["gross_profit"] = rev - cg
            cat["margin_pct"]   = round(float((rev - cg) / rev) * 100, 2) if rev > 0 else 0.0

        # ── Response ──────────────────────────────────────────────────────────
        return Response(
            {
                "period":         {"from": str(date_from) if date_from else None,
                                   "to":   str(date_to)   if date_to   else None},
                "branch_id":      branch_id,
                # Revenue section
                "revenue": {
                    "gross_sales":      gross_sales,
                    "total_discounts":  total_discounts,
                    "total_returns":    total_returns,
                    "total_tax":        total_tax,
                    "net_sales":        net_sales,
                    "sale_count":       revenue_agg["sale_count"],
                },
                # COGS
                "cogs":             cogs,
                # Gross profit
                "gross_profit":     gross_profit,
                "gross_margin_pct": gross_margin_pct,
                # Expenses
                "expenses": {
                    "total":           total_expenses,
                    "operating":       exp_totals["operating"],
                    "tax":             exp_totals["tax_exp"],
                    "capex":           exp_totals["capex"],
                    "by_category":     expenses_by_category,
                },
                # Net profit
                "net_profit":       net_profit,
                "net_margin_pct":   net_margin_pct,
                # Stock losses (informational)
                "stock_losses": {
                    "total_cost_value": stock_loss_value,
                    "by_type":          stock_losses_by_type,
                },
                # Charting data
                "trend":        trend,
                "by_category":  by_category,
            }
        )


class RevenueReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)
        group = request.query_params.get("group", "daily")

        from sales.models import Sale
        qs = Sale.objects.filter(status="COMPLETED")
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        branch = request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)

        trunc = TruncDay if group == "daily" else (TruncWeek if group == "weekly" else TruncMonth)
        trend = (
            qs.annotate(period=trunc("created_at"))
            .values("period")
            .annotate(
                total    = Coalesce(Sum("grand_total"),    Decimal("0.00")),
                discount = Coalesce(Sum("total_discount"), Decimal("0.00")),
                count    = Count("id"),
            )
            .order_by("period")
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to, "group": group},
                "trend":  list(trend),
                "total":  sum(t["total"] for t in trend),
            }
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to, "group": group},
                "trend": list(trend),
                "total": sum(t["total"] for t in trend),
            }
        )


class ExpenseReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from expenses.models import Expense
        qs = Expense.objects.all()
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(expense_date__gte=date_from)
        if date_to:
            qs = qs.filter(expense_date__lte=date_to)
        branch = request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        category = request.query_params.get("category")
        if category:
            qs = qs.filter(category_id=category)

        totals = qs.aggregate(
            total=Coalesce(Sum("total_amount"), Decimal("0.00")),
            tax=Coalesce(Sum("tax_amount"), Decimal("0.00")),
            count=Count("id"),
        )

        by_category = (
            qs.values("category__id", "category__name")
            .annotate(total=Sum("total_amount"), count=Count("id"))
            .order_by("-total")
        )
        by_branch = (
            qs.values("branch__id", "branch__name")
            .annotate(total=Sum("total_amount"), count=Count("id"))
            .order_by("-total")
        )
        by_date = (
            qs.values("expense_date")
            .annotate(total=Sum("total_amount"))
            .order_by("expense_date")
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "totals": totals,
                "by_category": list(by_category),
                "by_branch": list(by_branch),
                "by_date": list(by_date),
            }
        )


class InventoryReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        from products.models import ProductStockLevel, Batch

        branch = request.query_params.get("branch")

        stock_qs = ProductStockLevel.objects.all()
        if biz_id:
            stock_qs = stock_qs.filter(business_id=biz_id)
        if branch:
            stock_qs = stock_qs.filter(branch_id=branch)

        stock_value = stock_qs.aggregate(
            v=Coalesce(
                Sum(F("qty_on_hand") * F("product__cost_price")),
                Decimal("0.00"),
            )
        )["v"] or Decimal("0.00")

        low_stock = list(
            stock_qs.filter(
                qty_available__gt=0,
                qty_available__lte=F("reorder_level"),
            ).values(
                "product__name", "qty_available", "reorder_level", "branch__name",
            )[:50]
        )
        out_of_stock = list(
            stock_qs.filter(qty_available__lte=0)
            .values("product__name", "branch__name")[:50]
        )

        today = timezone.now().date()
        expired_qs = Batch.objects.filter(expiry_date__lt=today)
        if biz_id:
            expired_qs = expired_qs.filter(business_id=biz_id)
        expired = list(
            expired_qs.filter(qty_remaining__gt=0)
            .values(
                "product__name", "batch_number", "expiry_date", "qty_remaining",
            )[:50]
        )

        return Response(
            {
                "stock_value": stock_value,
                "stock_movement_summary": {"in": 0, "out": 0, "adjustments": 0},
                "low_stock_items":  low_stock,
                "out_of_stock":     out_of_stock,
                "expired_items_list": expired,
                "best_sellers":  [],
                "slow_movers":   [],
                "dead_stock":    [],
                "fast_sellers":  [],
            }
        )


class StockValueReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        from products.models import ProductStockLevel

        branch    = request.query_params.get("branch")
        warehouse = request.query_params.get("warehouse")

        qs = ProductStockLevel.objects.all()
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if branch:
            qs = qs.filter(branch_id=branch)
        if warehouse:
            qs = qs.filter(warehouse_id=warehouse)

        total = qs.aggregate(
            v=Coalesce(Sum(F("qty_on_hand") * F("product__cost_price")), Decimal("0.00"))
        )["v"] or Decimal("0.00")

        by_branch = (
            qs.values("branch__id", "branch__name")
            .annotate(value=Coalesce(Sum(F("qty_on_hand") * F("product__cost_price")), Decimal("0.00")))
            .order_by("-value")
        )
        by_warehouse = (
            qs.values("warehouse__id", "warehouse__name")
            .annotate(value=Coalesce(Sum(F("qty_on_hand") * F("product__cost_price")), Decimal("0.00")))
            .order_by("-value")
        )
        by_category = (
            qs.values("product__category__id", "product__category__name")
            .annotate(value=Coalesce(Sum(F("qty_on_hand") * F("product__cost_price")), Decimal("0.00")))
            .order_by("-value")
        )

        return Response(
            {
                "total_stock_value": total,
                "by_branch":    list(by_branch),
                "by_warehouse": list(by_warehouse),
                "by_category":  list(by_category),
                "method": "cost_price",
            }
        )


class CustomerReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from customers.models import Customer
        qs = Customer.objects.all()
        if biz_id:
            qs = qs.filter(business_id=biz_id)

        new_customers = 0
        if date_from:
            new_customers = qs.filter(
                created_at__date__gte=date_from,
                created_at__date__lte=date_to or timezone.now().date(),
            ).count()

        from sales.models import Sale
        sale_qs = Sale.objects.filter(status="COMPLETED")
        if biz_id:
            sale_qs = sale_qs.filter(business_id=biz_id)
        top_customers = (
            sale_qs.filter(customer__isnull=False)
            .values("customer__id", "customer__name")
            .annotate(total=Sum("grand_total"), count=Count("id"))
            .order_by("-total")[:10]
        )

        ageing = {
            "0-30": Decimal("0"),
            "31-60": Decimal("0"),
            "61-90": Decimal("0"),
            "90+": Decimal("0"),
        }
        stats = {
            "total_customers": qs.count(),
            "active_customers": sale_qs.values("customer").distinct().count(),
        }

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "new_customers": new_customers,
                "top_customers_by_sales": list(top_customers),
                "customer_debt_summary": {"total_outstanding": Decimal("0"), "overdue": Decimal("0")},
                "ageing_report": ageing,
                "customer_statistics": stats,
            }
        )


class CustomerDebtReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        return Response(
            {
                "customers": [],
                "total_outstanding": Decimal("0.00"),
                "total_overdue": Decimal("0.00"),
            }
        )


class SupplierReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from suppliers.models import Supplier

        suppliers = Supplier.objects.all()
        if biz_id:
            suppliers = suppliers.filter(business_id=biz_id)

        from purchases.models import PurchaseOrder as Purchase

        purchases = Purchase.objects.all()
        if biz_id:
            purchases = purchases.filter(business_id=biz_id)
        if date_from:
            purchases = purchases.filter(order_date__gte=date_from)
        if date_to:
            purchases = purchases.filter(order_date__lte=date_to)

        top_suppliers = (
            purchases.filter(supplier__isnull=False)
            .values("supplier__id", "supplier__name")
            .annotate(total=Sum("total_amount"), count=Count("id"))
            .order_by("-total")[:10]
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "total_suppliers": suppliers.count(),
                "top_suppliers_by_purchase": list(top_suppliers),
                "supplier_balances": [],
                "purchase_history_total": purchases.aggregate(t=Sum("total_amount"))["t"] or Decimal("0.00"),
            }
        )


class PurchaseReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from purchases.models import PurchaseOrder as Purchase

        qs = Purchase.objects.all()
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(order_date__gte=date_from)
        if date_to:
            qs = qs.filter(order_date__lte=date_to)

        total = qs.aggregate(
            total=Coalesce(Sum("total_amount"), Decimal("0.00")),
            count=Count("id"),
        )

        by_supplier = (
            qs.filter(supplier__isnull=False)
            .values("supplier__id", "supplier__name")
            .annotate(total=Sum("total_amount"), count=Count("id"))
            .order_by("-total")
        )

        by_status = list(
            qs.values("status").annotate(total=Sum("total_amount"), count=Count("id"))
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "purchases_total": total,
                "by_supplier": list(by_supplier),
                "by_product": [],
                "payment_status": by_status,
            }
        )


class CashierPerformanceReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from sales.models import Sale

        qs = Sale.objects.filter(status="COMPLETED")
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        per_cashier = (
            qs.filter(cashier__isnull=False)
            .values("cashier__id", "cashier__username")
            .annotate(
                sales_count    = Count("id"),
                total_amount   = Coalesce(Sum("grand_total"),    Decimal("0.00")),
                avg_sale       = Coalesce(Avg("grand_total"),    Decimal("0.00")),
                discount_amount= Coalesce(Sum("total_discount"), Decimal("0.00")),
            )
            .order_by("-total_amount")
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "cashiers": list(per_cashier),
            }
        )


class BranchPerformanceReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from sales.models import Sale
        from expenses.models import Expense
        from products.models import ProductStockLevel
        from branches.models import Branch

        branches = Branch.objects.all()
        if biz_id:
            branches = branches.filter(business_id=biz_id)

        sales_qs = Sale.objects.filter(status="COMPLETED")
        exp_qs = Expense.objects.filter(status__in=["APPROVED", "PAID"])
        if biz_id:
            sales_qs = sales_qs.filter(business_id=biz_id)
            exp_qs = exp_qs.filter(business_id=biz_id)
        if date_from:
            sales_qs = sales_qs.filter(created_at__date__gte=date_from)
            exp_qs = exp_qs.filter(expense_date__gte=date_from)
        if date_to:
            sales_qs = sales_qs.filter(created_at__date__lte=date_to)
            exp_qs = exp_qs.filter(expense_date__lte=date_to)

        from products.models import ProductStockLevel
        stock_qs = ProductStockLevel.objects.all()
        if biz_id:
            stock_qs = stock_qs.filter(business_id=biz_id)

        branch_sales = dict(
            sales_qs.values("branch__id").annotate(s=Sum("grand_total")).values_list("branch__id", "s")
        )
        branch_exp = dict(
            exp_qs.values("branch__id").annotate(e=Sum("total_amount")).values_list("branch__id", "e")
        )
        branch_stock = dict(
            stock_qs.values("branch__id")
            .annotate(v=Sum(F("qty_on_hand") * F("product__cost_price")))
            .values_list("branch__id", "v")
        )

        result = []
        for b in branches:
            s = branch_sales.get(b.id, Decimal("0.00")) or Decimal("0.00")
            e = branch_exp.get(b.id, Decimal("0.00")) or Decimal("0.00")
            result.append(
                {
                    "branch_id": b.id,
                    "branch_name": b.name,
                    "sales": s,
                    "expenses": e,
                    "profit": s - e,
                    "inventory_value": branch_stock.get(b.id, Decimal("0.00")) or Decimal("0.00"),
                }
            )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "branches": result,
            }
        )


class TaxReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from sales.models import Sale
        qs = Sale.objects.filter(status="COMPLETED")
        if biz_id:
            qs = qs.filter(business_id=biz_id)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        totals = qs.aggregate(
            vat=Coalesce(Sum("total_tax"), Decimal("0.00")),
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "vat_collected": totals["vat"],
                "nhil": Decimal("0.00"),
                "getfund": Decimal("0.00"),
                "total_tax": totals["vat"],
                "tax_rate_breakdown": [],
            }
        )


class PaymentReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)

        from sales.models import SalePayment
        qs = SalePayment.objects.all()
        if biz_id:
            qs = qs.filter(sale__business_id=biz_id)
        if date_from:
            qs = qs.filter(payment_date__date__gte=date_from)
        if date_to:
            qs = qs.filter(payment_date__date__lte=date_to)

        by_method = (
            qs.values("method_code")
            .annotate(
                total=Coalesce(Sum("amount"), Decimal("0.00")),
                count=Count("id"),
            )
            .order_by("-total")
        )

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "by_method": list(by_method),
                "grand_total": sum(m["total"] for m in by_method),
            }
        )


class ShiftReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        shift = request.query_params.get("shift")
        return Response(
            {
                "shift_summary": {
                    "shift_id": shift,
                    "sales_total": Decimal("0.00"),
                    "refunds_total": Decimal("0.00"),
                    "expected_cash": Decimal("0.00"),
                    "actual_cash": Decimal("0.00"),
                    "variance": Decimal("0.00"),
                },
                "payment_breakdown": [],
                "sales": [],
                "refunds": [],
            }
        )


class FinancialReportsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        date_from, date_to = parse_date_range(request)
        as_of_date = request.query_params.get("date") or date_to

        from accounting.views import ReportViews

        class R:
            def __init__(self, qp):
                self.query_params = qp

        tb = ReportViews.trial_balance(R({
            "period": request.query_params.get("period"),
            "business": biz_id,
            "from": date_from,
            "to": date_to,
        })).data
        pl = ReportViews.profit_loss(R({
            "from": date_from,
            "to": date_to,
            "business": biz_id,
        })).data
        bs = ReportViews.balance_sheet(R({
            "date": as_of_date,
            "business": biz_id,
        })).data

        cash_flow = {
            "operating_activities": {"inflow": Decimal("0"), "outflow": Decimal("0"), "net": Decimal("0")},
            "investing_activities": {"inflow": Decimal("0"), "outflow": Decimal("0"), "net": Decimal("0")},
            "financing_activities": {"inflow": Decimal("0"), "outflow": Decimal("0"), "net": Decimal("0")},
            "net_increase": Decimal("0"),
        }

        return Response(
            {
                "period": {"from": date_from, "to": date_to},
                "trial_balance": tb,
                "profit_loss": pl,
                "balance_sheet": bs,
                "cash_flow_statement": cash_flow,
            }
        )


class ExportReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, report_name):
        _biz, biz_id, err = resolve_business(request)
        if err:
            return err

        fmt = request.query_params.get("format", "csv")
        headers = ["Field", "Value"]
        rows = [["Report", report_name], ["Generated", str(timezone.now())]]
        fn = f"{report_name}_report"

        if fmt == "csv":
            return csv_response(rows, headers, fn)
        elif fmt in ["excel", "xlsx"]:
            return excel_response(rows, headers, fn)
        elif fmt == "pdf":
            return html_response(f"{report_name} Report", headers, rows, fn)
        return Response({"detail": "Invalid format"})
