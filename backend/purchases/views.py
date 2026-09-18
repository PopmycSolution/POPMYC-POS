from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter, OrderingFilter
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from common.mixins import BusinessScopedMixin
from purchases.models import (
    PurchaseOrder, PurchaseOrderItem,
    GoodsReceivedNote, GoodsReceivedItem,
    PurchaseReturn, PurchaseReturnItem,
    PurchasePayment,
)
from purchases.serializers import (
    PurchaseOrderSerializer, PurchaseOrderCreateSerializer,
    GoodsReceivedNoteSerializer, ReceiveGoodsSerializer,
    PurchaseReturnSerializer, PurchasePaymentSerializer,
)


# ─────────────────────────────────────────────────────────────────────────────
# PurchaseOrderViewSet
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseOrderViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = PurchaseOrder.objects.select_related(
        "supplier", "branch", "warehouse", "created_by"
    ).prefetch_related("items__product", "items__variant", "items__batch", "grns").all()
    serializer_class = PurchaseOrderSerializer
    filter_backends  = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "branch", "warehouse", "supplier",
        "status", "payment_status", "created_by",
    ]
    search_fields  = ["po_number", "reference", "notes"]
    ordering_fields = [
        "po_number", "order_date", "expected_date", "received_date",
        "total_amount", "amount_paid", "created_at",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(order_date__gte=date_from)
        if date_to:
            qs = qs.filter(order_date__lte=date_to)
        return qs

    # ── CREATE ────────────────────────────────────────────────────────────────
    def create(self, request, *args, **kwargs):
        ser = PurchaseOrderCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        data     = ser.validated_data
        user     = request.user
        business = getattr(user, "business", None)

        with transaction.atomic():
            # Build a sequential PO number
            today     = timezone.now().strftime("%Y%m%d")
            po_count  = PurchaseOrder.objects.filter(
                business=business,
                order_date=data["order_date"],
            ).count()
            po_number = f"PO-{today}-{po_count + 1:04d}"

            po = PurchaseOrder.objects.create(
                business      = business,
                supplier_id   = data["supplier"],
                branch_id     = data["branch"],
                warehouse_id  = data["warehouse"],
                po_number     = po_number,
                order_date    = data["order_date"],
                expected_date = data["expected_date"],
                reference     = data["reference"],
                notes         = data["notes"],
                status        = "DRAFT",
                payment_status= "UNPAID",
                created_by    = user,
            )

            subtotal = Decimal("0.00")
            for item_data in data["items"]:
                qty  = item_data["qty_ordered"]
                cost = Decimal(str(item_data.get("unit_cost", 0)))
                line = qty * cost
                PurchaseOrderItem.objects.create(
                    purchase_order = po,
                    product_id     = item_data["product"],
                    variant_id     = item_data.get("variant"),
                    qty_ordered    = qty,
                    qty_received   = 0,
                    unit_cost      = cost,
                    subtotal       = line,
                    expiry_date    = item_data.get("expiry_date"),
                    notes          = item_data.get("notes", ""),
                )
                subtotal += line

            po.subtotal      = subtotal
            po.total_amount  = subtotal  # tax calculated separately if needed
            po.save(update_fields=["subtotal", "total_amount"])

        return Response(
            PurchaseOrderSerializer(po).data,
            status=status.HTTP_201_CREATED,
        )

    # ── RECEIVE GOODS ─────────────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="receive_goods")
    def receive_goods(self, request, pk=None):
        """
        POST /api/v1/purchases/purchase-orders/{id}/receive_goods/

        Posts a GRN against this PO.  For each line:
          1. Creates/updates a products.Batch with full tracking fields.
          2. Updates products.ProductStockLevel (qty_on_hand, qty_available).
          3. Writes a permanent inventory.StockMovement (type=PURCHASE).
          4. Updates PurchaseOrderItem.qty_received.
          5. Updates PO status (PARTIAL_RECEIVED / RECEIVED).

        Inventory mode guard: If inventory_mode = SALES_ONLY, stock levels and
        movements are NOT updated (the GRN record is still saved for audit).
        """
        from inventory.models import StockMovement
        from products.models import Batch, ProductStockLevel

        po   = self.get_object()
        user = request.user
        business = getattr(user, "business", None)

        if po.status == "CANCELLED":
            return Response(
                {"error": "Cannot receive goods against a cancelled purchase order."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = ReceiveGoodsSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        data          = ser.validated_data
        received_date = data["received_date"]
        branch_id     = data["branch"]   or (po.branch_id   if po.branch_id   else None)
        warehouse_id  = data["warehouse"] or (po.warehouse_id if po.warehouse_id else None)
        notes         = data["notes"]
        items         = data["items"]

        # Determine whether stock tracking is active for this business
        track_stock = True
        try:
            from businesses.models import BusinessSettings
            settings_obj = BusinessSettings.objects.get(business=business)
            track_stock = settings_obj.inventory_enabled
        except Exception:
            pass  # no settings row → default safe: track stock

        # Build GRN number
        today     = timezone.now().strftime("%Y%m%d")
        grn_count = GoodsReceivedNote.objects.filter(
            business=business,
            created_at__date=timezone.now().date(),
        ).count()
        grn_number = f"GRN-{today}-{grn_count + 1:04d}"

        with transaction.atomic():
            grn = GoodsReceivedNote.objects.create(
                business       = business,
                purchase_order = po,
                branch_id      = branch_id,
                warehouse_id   = warehouse_id,
                grn_number     = grn_number,
                status         = "POSTED",
                received_date  = received_date,
                received_by    = user,
                notes          = notes,
                total_items    = len(items),
                posted_at      = timezone.now(),
            )

            total_value = Decimal("0.00")

            for item_data in items:
                product_id   = item_data["product"]
                variant_id   = item_data.get("variant")
                qty_received = item_data["qty_received"]
                unit_cost    = Decimal(str(item_data.get("unit_cost", 0)))
                expiry_date  = item_data.get("expiry_date")
                batch_number = item_data.get("batch_number", "").strip()
                item_notes   = item_data.get("notes", "")
                po_item_id   = item_data.get("purchase_order_item")
                line_value   = qty_received * unit_cost

                # ── 1. Resolve the PO item (to get qty_ordered) ───────────────
                po_item = None
                if po_item_id:
                    po_item = PurchaseOrderItem.objects.filter(
                        id=po_item_id, purchase_order=po
                    ).first()
                if not po_item:
                    po_item = PurchaseOrderItem.objects.filter(
                        purchase_order=po, product_id=product_id
                    ).first()

                qty_ordered = po_item.qty_ordered if po_item else qty_received

                # ── 2. Create / update Batch ──────────────────────────────────
                # Auto-generate a batch number if not provided
                if not batch_number:
                    existing = Batch.objects.filter(
                        business=business, product_id=product_id,
                    ).count()
                    pid_short    = str(product_id)[:8].upper()
                    batch_number = f"BATCH-{pid_short}-{existing + 1:04d}"

                batch, batch_created = Batch.objects.get_or_create(
                    business     = business,
                    product_id   = product_id,
                    batch_number = batch_number,
                    defaults={
                        "variant_id":    variant_id,
                        "supplier":      po.supplier,
                        "manufacture_date": None,
                        "expiry_date":   expiry_date,
                        "purchase_price": unit_cost,
                        # Tracking fields
                        "purchase_date": po.order_date,
                        "received_date": received_date,
                        "qty_purchased": qty_ordered,
                        "qty_received":  qty_received,
                        "qty_remaining": qty_received,
                        "stock_out_date": None,
                    },
                )
                if not batch_created:
                    # If batch already exists (same lot received in two shipments),
                    # add to existing quantities
                    batch.qty_received  = (batch.qty_received  or 0) + qty_received
                    batch.qty_remaining = (batch.qty_remaining or 0) + qty_received
                    batch.purchase_price = unit_cost
                    if expiry_date:
                        batch.expiry_date = expiry_date
                    if not batch.received_date:
                        batch.received_date = received_date
                    if not batch.purchase_date:
                        batch.purchase_date = po.order_date
                    batch.save(update_fields=[
                        "qty_received", "qty_remaining", "purchase_price",
                        "expiry_date", "received_date", "purchase_date", "updated_at",
                    ])

                # ── 3. Create GRN item ────────────────────────────────────────
                grn_item = GoodsReceivedItem.objects.create(
                    grn                 = grn,
                    purchase_order_item = po_item,
                    product_id          = product_id,
                    variant_id          = variant_id,
                    batch               = batch,
                    qty_received        = qty_received,
                    unit_cost           = unit_cost,
                    total_value         = line_value,
                    expiry_date         = expiry_date,
                    batch_number        = batch_number,
                    notes               = item_notes,
                )

                # ── 4. Update PO item qty_received ────────────────────────────
                if po_item:
                    po_item.qty_received = (po_item.qty_received or 0) + qty_received
                    po_item.batch        = batch
                    po_item.save(update_fields=["qty_received", "batch", "updated_at"])

                total_value += line_value

                # ── 5. Update stock & write movement (only if STOCK_ENABLED) ──
                if track_stock and branch_id and warehouse_id:
                    # Use select_for_update to prevent concurrent GRN races
                    sl = (
                        ProductStockLevel.objects
                        .select_for_update()
                        .filter(
                            product_id=product_id,
                            branch_id=branch_id,
                            warehouse_id=warehouse_id,
                            variant=None,
                        )
                        .first()
                    )
                    if sl is None:
                        sl, _ = ProductStockLevel.objects.get_or_create(
                            product_id=product_id,
                            branch_id=branch_id,
                            warehouse_id=warehouse_id,
                            variant=None,
                            defaults={
                                "business":      business,
                                "qty_on_hand":   0,
                                "qty_reserved":  0,
                                "qty_available": 0,
                                "reorder_level": 0,
                            },
                        )
                        sl = ProductStockLevel.objects.select_for_update().get(pk=sl.pk)
                    sl.qty_on_hand        += qty_received
                    sl.qty_available      += qty_received
                    # received_date is a plain date from the serializer; convert to
                    # a timezone-aware datetime before assigning to DateTimeField
                    # so Django's USE_TZ=True does not emit a RuntimeWarning.
                    from datetime import datetime as _dt
                    sl.last_received_date = timezone.make_aware(
                        _dt.combine(received_date, _dt.min.time())
                    )
                    sl.save(update_fields=[
                        "qty_on_hand", "qty_available", "last_received_date", "updated_at"
                    ])

                    StockMovement.objects.create(
                        business       = business,
                        product_id     = product_id,
                        variant_id     = variant_id,
                        branch_id      = branch_id,
                        warehouse_id   = warehouse_id,
                        qty_delta      = qty_received,
                        type           = "PURCHASE",
                        reference_type = "GoodsReceivedNote",
                        reference_id   = grn.id,
                        batch          = batch,
                        unit_cost      = unit_cost,
                        notes          = (
                            f"[GRN:{grn_number}] PO:{po.po_number}"
                            + (f" — {item_notes}" if item_notes else "")
                        ),
                        created_by     = user,
                    )

            # ── Update GRN totals ─────────────────────────────────────────────
            grn.total_value = total_value
            grn.save(update_fields=["total_value"])

            # ── Update PO status ──────────────────────────────────────────────
            po_items = po.items.all()
            all_received = all(
                (item.qty_received or 0) >= item.qty_ordered
                for item in po_items
            )
            any_received = any((item.qty_received or 0) > 0 for item in po_items)

            if all_received:
                po.status        = "RECEIVED"
                po.received_date = received_date
            elif any_received:
                po.status = "PARTIAL_RECEIVED"
            po.save(update_fields=["status", "received_date", "updated_at"])

        return Response(
            GoodsReceivedNoteSerializer(grn).data,
            status=status.HTTP_201_CREATED,
        )

    # ── CANCEL ────────────────────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel(self, request, pk=None):
        po = self.get_object()
        if po.status in ("RECEIVED", "PARTIAL_RECEIVED"):
            return Response(
                {"error": "Cannot cancel a PO that has already had goods received."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        po.status = "CANCELLED"
        po.save(update_fields=["status", "updated_at"])
        return Response(PurchaseOrderSerializer(po).data)

    # ── ADD PAYMENT ───────────────────────────────────────────────────────────
    @action(detail=True, methods=["post"], url_path="add_payment")
    def add_payment(self, request, pk=None):
        po      = self.get_object()
        user    = request.user
        amount  = Decimal(str(request.data.get("amount", 0)))
        method  = request.data.get("payment_method", "CASH")
        ref     = request.data.get("reference", "")
        pnotes  = request.data.get("notes", "")
        pdate   = request.data.get("payment_date") or timezone.now().date()

        if amount <= 0:
            return Response({"error": "Amount must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            PurchasePayment.objects.create(
                business       = getattr(user, "business", None),
                purchase_order = po,
                amount         = amount,
                payment_method = method,
                payment_date   = pdate,
                reference      = ref,
                notes          = pnotes,
                recorded_by    = user,
            )
            po.amount_paid = (po.amount_paid or Decimal("0")) + amount
            if po.amount_paid >= po.total_amount:
                po.payment_status = "PAID"
            else:
                po.payment_status = "PARTIAL"
            po.save(update_fields=["amount_paid", "payment_status", "updated_at"])

        return Response(PurchaseOrderSerializer(po).data)


# ─────────────────────────────────────────────────────────────────────────────
# GoodsReceivedNoteViewSet  (read-only — GRNs are created via receive_goods)
# ─────────────────────────────────────────────────────────────────────────────

class GoodsReceivedNoteViewSet(BusinessScopedMixin, viewsets.ReadOnlyModelViewSet):
    queryset = GoodsReceivedNote.objects.select_related(
        "purchase_order", "branch", "received_by"
    ).prefetch_related("items__product", "items__batch").all()
    serializer_class = GoodsReceivedNoteSerializer
    filter_backends  = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "purchase_order", "branch", "status", "received_by"]
    search_fields    = ["grn_number", "notes"]
    ordering_fields  = ["grn_number", "received_date", "total_value", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(received_date__gte=date_from)
        if date_to:
            qs = qs.filter(received_date__lte=date_to)
        return qs


# ─────────────────────────────────────────────────────────────────────────────
# PurchaseReturnViewSet
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseReturnViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = PurchaseReturn.objects.select_related(
        "purchase_order", "branch"
    ).prefetch_related("items__product").all()
    serializer_class = PurchaseReturnSerializer
    filter_backends  = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "purchase_order", "branch", "status"]
    search_fields    = ["return_number", "reason", "notes"]
    ordering_fields  = ["return_number", "return_date", "total_value", "created_at"]


# ─────────────────────────────────────────────────────────────────────────────
# PurchasePaymentViewSet
# ─────────────────────────────────────────────────────────────────────────────

class PurchasePaymentViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = PurchasePayment.objects.select_related("purchase_order").all()
    serializer_class = PurchasePaymentSerializer
    filter_backends  = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "purchase_order", "payment_method"]
    search_fields    = ["reference", "notes"]
    ordering_fields  = ["payment_date", "amount", "created_at"]
