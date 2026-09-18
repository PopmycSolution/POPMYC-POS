from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin
from inventory.models import (
    StockMovement, OpeningStock, OpeningStockItem,
    StockAdjustment, StockAdjustmentItem,
    StockTransfer, StockTransferItem,
    StockCount, StockCountItem,
    DamagedStock, ExpiredStock, StockAlert,
)
from inventory.serializers import (
    StockMovementSerializer, OpeningStockSerializer, OpeningStockItemSerializer,
    StockAdjustmentSerializer, StockAdjustmentItemSerializer,
    StockAdjustmentCreateSerializer,
    StockTransferSerializer, StockTransferItemSerializer,
    StockTransferCreateSerializer, StockTransferReceiveSerializer,
    StockCountSerializer, StockCountItemSerializer,
    DamagedStockSerializer, ExpiredStockSerializer, StockAlertSerializer,
)

class StockMovementViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = StockMovement.objects.select_related(
        "product", "branch", "warehouse", "created_by"
    ).all()
    serializer_class = StockMovementSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "product", "variant", "branch", "warehouse",
        "type", "batch", "created_by", "reference_type",
    ]
    search_fields = ["notes", "reference_type"]
    ordering_fields = ["qty_delta", "unit_cost", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    @action(detail=False, methods=["get"], url_path="branch-movements")
    def branch_movements(self, request):
        """
        GET /api/v1/inventory/movements/branch-movements/?branch=<uuid>&limit=50

        Returns the most recent stock movements for a branch.
        """
        branch_id = request.query_params.get("branch")
        limit     = min(int(request.query_params.get("limit", 100)), 500)

        if not branch_id:
            return Response(
                {"error": "branch query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = self.get_queryset().filter(branch_id=branch_id)[:limit]
        serializer = StockMovementSerializer(qs, many=True)
        return Response({"branch_id": branch_id, "movements": serializer.data})


class OpeningStockViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = OpeningStock.objects.all()
    serializer_class = OpeningStockSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "warehouse", "status", "created_by"]
    search_fields = ["reference_number", "notes"]
    ordering_fields = ["reference_number", "total_items", "total_value", "posted_at", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class OpeningStockItemViewSet(viewsets.ModelViewSet):
    queryset = OpeningStockItem.objects.all()
    serializer_class = OpeningStockItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["opening_stock", "product", "variant", "batch"]
    ordering_fields = ["qty", "unit_cost", "total_value", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(opening_stock__business=user.business)
        return qs.none()


class StockAdjustmentViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = StockAdjustment.objects.select_related(
        "branch", "warehouse", "created_by"
    ).prefetch_related("items__product", "items__variant").all()
    serializer_class = StockAdjustmentSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "warehouse", "reason", "status", "created_by"]
    search_fields = ["reference_number", "notes"]
    ordering_fields = ["reference_number", "total_items", "total_value_change", "posted_at", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    # ── Reason-to-StockMovement-type mapping ──────────────────────────────────
    _REASON_TO_MOVE_TYPE = {
        "DAMAGED":          "DAMAGED",
        "EXPIRED":          "EXPIRED",
        "LOST":             "LOST",
        "THEFT":            "THEFT",
        "INTERNAL_USE":     "INTERNAL_USE",
        "STOCK_CORRECTION": "STOCK_CORRECTION",
        "SUPPLIER_RETURN":  "SUPPLIER_RETURN",
        "FOUND":            "FOUND_STOCK",
        "WRONG_ENTRY":      "STOCK_CORRECTION",
        "OTHER":            "ADJUSTMENT",
    }

    # Reasons that INCREASE stock (positive delta)
    _POSITIVE_REASONS = {"FOUND", "STOCK_CORRECTION", "WRONG_ENTRY"}

    # Roles permitted to post high-risk adjustments without a manager
    _HIGH_RISK_REASONS = {"THEFT", "INTERNAL_USE", "SUPPLIER_RETURN"}
    _HIGH_RISK_ROLES   = {"SUPER_ADMIN", "ADMIN", "MANAGER", "INVENTORY_CLERK"}

    @action(detail=False, methods=["post"], url_path="post_adjustment")
    def post_adjustment(self, request):
        """
        POST /api/v1/inventory/stock-adjustments/post_adjustment/

        Creates a StockAdjustment header + items, updates ProductStockLevel per
        item, and writes a permanent StockMovement record for each item.

        Requires Inventory Mode = STOCK_ENABLED on the business settings.
        """
        from django.db import transaction
        from django.utils import timezone
        from decimal import Decimal
        from products.models import ProductStockLevel

        user     = request.user
        business = getattr(user, "business", None)

        # ── Guard: inventory mode must be STOCK_ENABLED ───────────────────────
        if business:
            try:
                settings = business.settings
                if getattr(settings, "inventory_mode", "STOCK_ENABLED") != "STOCK_ENABLED":
                    return Response(
                        {"error": "Stock Adjustments are not available when Inventory Mode is set to Sales Only."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            except Exception:
                pass  # no settings object yet — allow through

        # ── Permission: high-risk reasons restricted to senior roles ──────────
        role   = getattr(user, "role", "CASHIER") or "CASHIER"
        reason = request.data.get("reason", "")
        if reason in self._HIGH_RISK_REASONS and role.upper() not in self._HIGH_RISK_ROLES:
            return Response(
                {"error": f"Your role ({role}) is not authorised to post '{reason}' adjustments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Validate payload ──────────────────────────────────────────────────
        ser = StockAdjustmentCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        data      = ser.validated_data
        branch_id    = data["branch"]
        warehouse_id = data["warehouse"]
        notes        = data["notes"]
        items        = data["items"]

        # ── Build reference number ────────────────────────────────────────────
        today = timezone.now().strftime("%Y%m%d")
        count = StockAdjustment.objects.filter(
            business=business,
            created_at__date=timezone.now().date(),
        ).count()
        reference_number = f"ADJ-{today}-{count + 1:04d}"

        move_type = self._REASON_TO_MOVE_TYPE.get(reason, "ADJUSTMENT")

        with transaction.atomic():
            # Create the header
            adjustment = StockAdjustment.objects.create(
                business=business,
                branch_id=branch_id,
                warehouse_id=warehouse_id,
                reference_number=reference_number,
                reason=reason,
                status="POSTED",
                notes=notes,
                posted_at=timezone.now(),
                created_by=user,
                total_items=len(items),
            )

            total_value_change = Decimal("0.00")

            for item_data in items:
                product_id    = item_data["product"]
                variant_id    = item_data.get("variant")
                batch_id      = item_data.get("batch")
                qty           = item_data["qty"]
                unit_cost     = item_data.get("unit_cost", Decimal("0.00"))
                serial_number = item_data.get("serial_number", "")
                item_notes    = item_data.get("notes", "") or notes

                # Positive reasons ADD stock; all others REMOVE stock
                is_positive = reason in self._POSITIVE_REASONS
                delta       = qty if is_positive else -qty
                value_delta = Decimal(str(unit_cost)) * delta

                # Create the adjustment item record
                StockAdjustmentItem.objects.create(
                    adjustment=adjustment,
                    product_id=product_id,
                    variant_id=variant_id,
                    batch_id=batch_id,
                    qty_expected=0,          # not a count — N/A
                    qty_actual=qty,
                    qty_delta=delta,
                    unit_cost=unit_cost,
                    value_delta=value_delta,
                    serial_number=serial_number,
                )

                # Update ProductStockLevel (create if absent).
                # Use select_for_update to prevent concurrent races on qty_on_hand.
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
                            "business": business,
                            "qty_on_hand":   0,
                            "qty_reserved":  0,
                            "qty_available": 0,
                            "reorder_level":  0,
                        },
                    )
                    # Re-acquire lock after the row exists
                    sl = ProductStockLevel.objects.select_for_update().get(pk=sl.pk)
                sl.qty_on_hand   = max(0, sl.qty_on_hand   + delta)
                sl.qty_available = max(0, sl.qty_available + delta)
                sl.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

                # Write permanent StockMovement record
                StockMovement.objects.create(
                    business=business,
                    product_id=product_id,
                    variant_id=variant_id,
                    branch_id=branch_id,
                    warehouse_id=warehouse_id,
                    qty_delta=delta,
                    type=move_type,
                    reference_type="StockAdjustment",
                    reference_id=adjustment.id,
                    unit_cost=unit_cost,
                    notes=f"[{reason}] {item_notes}" if item_notes else f"[{reason}]",
                    created_by=user,
                )

                total_value_change += value_delta

            # Update header totals
            adjustment.total_value_change = total_value_change
            adjustment.save(update_fields=["total_value_change"])

        return Response(
            StockAdjustmentSerializer(adjustment).data,
            status=status.HTTP_201_CREATED,
        )


class StockAdjustmentItemViewSet(viewsets.ModelViewSet):
    queryset = StockAdjustmentItem.objects.all()
    serializer_class = StockAdjustmentItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["adjustment", "product", "variant", "batch", "restock"]
    ordering_fields = ["qty_expected", "qty_actual", "qty_delta", "unit_cost", "value_delta", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(adjustment__business=user.business)
        return qs.none()


class StockTransferViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = StockTransfer.objects.select_related(
        "from_branch", "to_branch", "from_warehouse", "to_warehouse",
        "created_by", "approved_by", "released_by", "received_by",
        "discrepancy_resolved_by",
    ).prefetch_related("items__product", "items__variant").all()
    serializer_class = StockTransferSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "from_branch", "to_branch",
        "from_warehouse", "to_warehouse", "status",
        "transfer_method", "has_discrepancy",
        "created_by", "approved_by", "received_by",
    ]
    search_fields = ["reference_number", "notes"]
    ordering_fields = [
        "reference_number", "total_items", "total_value",
        "sent_at", "received_at", "created_at",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_ref(business, prefix="TRF"):
        from django.utils import timezone
        today = timezone.now().strftime("%Y%m%d")
        count = StockTransfer.objects.filter(
            business=business,
            created_at__date=timezone.now().date(),
        ).count()
        return f"{prefix}-{today}-{count + 1:04d}"

    @staticmethod
    def _stock_enabled(business):
        """Return False only when inventory_mode is explicitly SALES_ONLY."""
        try:
            return getattr(business.settings, "inventory_mode", "STOCK_ENABLED") == "STOCK_ENABLED"
        except Exception:
            return True

    @staticmethod
    def _get_or_create_stock_level(business, product_id, variant_id, branch_id, warehouse_id):
        """
        Get (with SELECT FOR UPDATE lock) or create a ProductStockLevel row.
        The lock prevents two concurrent transfers from racing on the same row.
        Must be called inside a transaction.atomic() block.
        """
        from products.models import ProductStockLevel
        # Try to lock the existing row first
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
                    "business": business,
                    "qty_on_hand": 0, "qty_reserved": 0,
                    "qty_available": 0, "reorder_level": 0,
                },
            )
            # Acquire lock on the row that now exists
            sl = ProductStockLevel.objects.select_for_update().get(pk=sl.pk)
        return sl

    # ── CREATE TRANSFER ───────────────────────────────────────────────────────

    @action(detail=False, methods=["post"], url_path="create_transfer")
    def create_transfer(self, request):
        """
        POST /api/v1/inventory/stock-transfers/create_transfer/

        Validates payload, creates the StockTransfer header + items in REQUESTED
        status. Does NOT yet move stock (stock moves when IN_TRANSIT for Delivery
        or on COMPLETED for Physical Collection).
        """
        from django.db import transaction
        from django.utils import timezone

        user     = request.user
        business = getattr(user, "business", None)

        if not self._stock_enabled(business):
            return Response(
                {"error": "Branch Transfers are not available when Inventory Mode is Sales Only."},
                status=status.HTTP_403_FORBIDDEN,
            )

        ser = StockTransferCreateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        data            = ser.validated_data
        transfer_method = data["transfer_method"]
        items           = data["items"]

        with transaction.atomic():
            transfer = StockTransfer.objects.create(
                business=business,
                from_branch_id=data["from_branch"],
                to_branch_id=data["to_branch"],
                from_warehouse_id=data["from_warehouse"],
                to_warehouse_id=data["to_warehouse"],
                reference_number=self._build_ref(business),
                transfer_method=transfer_method,
                status="REQUESTED",
                notes=data["notes"],
                total_items=len(items),
                created_by=user,
            )
            total_value = 0
            for item_data in items:
                unit_cost = float(item_data.get("unit_cost", 0))
                qty       = item_data["qty"]
                StockTransferItem.objects.create(
                    transfer=transfer,
                    product_id=item_data["product"],
                    variant_id=item_data.get("variant"),
                    batch_id=item_data.get("batch"),
                    qty_sent=qty,
                    qty_received=0,
                    unit_cost=unit_cost,
                    total_value=unit_cost * qty,
                    serial_number=item_data.get("serial_number", ""),
                    condition=item_data.get("condition", ""),
                )
                total_value += unit_cost * qty
            transfer.total_value = total_value
            transfer.save(update_fields=["total_value"])

        return Response(
            StockTransferSerializer(transfer).data,
            status=status.HTTP_201_CREATED,
        )

    # ── APPROVE ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="approve_transfer")
    def approve_transfer(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/approve_transfer/

        Manager/Admin approves a REQUESTED transfer → APPROVED.
        Allowed roles: MANAGER, ADMIN, SUPER_ADMIN.
        """
        from django.utils import timezone

        transfer = self.get_object()
        role = (getattr(request.user, "role", "") or "").upper()

        if role not in {"MANAGER", "ADMIN", "SUPER_ADMIN"}:
            return Response(
                {"error": "Only Managers and Admins can approve transfers."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if transfer.status not in ("REQUESTED", "DRAFT"):
            return Response(
                {"error": f"Cannot approve a transfer with status '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transfer.status      = "APPROVED"
        transfer.approved_by = request.user
        transfer.approved_at = timezone.now()
        transfer.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        return Response(StockTransferSerializer(transfer).data)

    # ── SEND / DISPATCH ───────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="send_transfer")
    def send_transfer(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/send_transfer/

        Marks transfer as IN_TRANSIT and deducts stock from the sending branch.
        For PHYSICAL_COLLECTION this step is skipped — stock moves on completion.

        Body (optional): { "notes": "...", "released_by_note": "..." }
        """
        from django.db import transaction
        from django.utils import timezone

        transfer = self.get_object()
        user     = request.user
        business = getattr(user, "business", None)

        if transfer.status not in ("APPROVED", "REQUESTED", "DRAFT"):
            return Response(
                {"error": f"Cannot dispatch a transfer with status '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            for item in transfer.items.select_related("product").all():
                # Deduct from sending branch
                sl = self._get_or_create_stock_level(
                    business,
                    item.product_id, item.variant_id,
                    transfer.from_branch_id, transfer.from_warehouse_id,
                )
                sl.qty_on_hand   = max(0, sl.qty_on_hand   - item.qty_sent)
                sl.qty_available = max(0, sl.qty_available - item.qty_sent)
                sl.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

                # TRANSFER_OUT movement on sending branch
                StockMovement.objects.create(
                    business=business,
                    product_id=item.product_id,
                    variant_id=item.variant_id,
                    branch_id=transfer.from_branch_id,
                    warehouse_id=transfer.from_warehouse_id,
                    qty_delta=-item.qty_sent,
                    type="TRANSFER_OUT",
                    reference_type="StockTransfer",
                    reference_id=transfer.id,
                    unit_cost=item.unit_cost,
                    notes=f"[TRANSFER_OUT → {transfer.to_branch.name}] {transfer.reference_number}",
                    created_by=user,
                )

            transfer.status      = "IN_TRANSIT"
            transfer.released_by = user
            transfer.sent_at     = timezone.now()
            notes = request.data.get("notes", "")
            if notes:
                transfer.notes = (transfer.notes + "\n" + notes).strip()
            transfer.save(update_fields=["status", "released_by", "sent_at", "notes", "updated_at"])

        return Response(StockTransferSerializer(transfer).data)

    # ── RECEIVE ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="receive_transfer")
    def receive_transfer(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/receive_transfer/

        Records what was actually received. Adds stock to receiving branch.
        If qty_received < qty_sent for any item → marks transfer as having
        a discrepancy, leaves status as RECEIVED (not COMPLETED) until resolved.

        Body:
        {
            "notes": "...",
            "items": [
                {"transfer_item_id": "<uuid>", "qty_received": 4}
            ]
        }
        """
        from django.db import transaction
        from django.utils import timezone

        transfer = self.get_object()
        user     = request.user
        business = getattr(user, "business", None)

        if transfer.status not in ("IN_TRANSIT", "APPROVED", "SENT"):
            return Response(
                {"error": f"Cannot receive a transfer with status '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = StockTransferReceiveSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        data = ser.validated_data
        item_map = {
            str(entry["transfer_item_id"]): int(entry["qty_received"])
            for entry in data["items"]
        }

        has_discrepancy = False
        discrepancy_details = []

        with transaction.atomic():
            for item in transfer.items.select_related("product").all():
                item_id_str  = str(item.id)
                qty_received = item_map.get(item_id_str, item.qty_sent)
                qty_received = max(0, qty_received)

                item.qty_received = qty_received
                item.save(update_fields=["qty_received", "updated_at"])

                # Add stock to receiving branch
                sl = self._get_or_create_stock_level(
                    business,
                    item.product_id, item.variant_id,
                    transfer.to_branch_id, transfer.to_warehouse_id,
                )
                sl.qty_on_hand   = sl.qty_on_hand   + qty_received
                sl.qty_available = sl.qty_available + qty_received
                sl.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

                # TRANSFER_IN movement on receiving branch
                StockMovement.objects.create(
                    business=business,
                    product_id=item.product_id,
                    variant_id=item.variant_id,
                    branch_id=transfer.to_branch_id,
                    warehouse_id=transfer.to_warehouse_id,
                    qty_delta=qty_received,
                    type="TRANSFER_IN",
                    reference_type="StockTransfer",
                    reference_id=transfer.id,
                    unit_cost=item.unit_cost,
                    notes=f"[TRANSFER_IN ← {transfer.from_branch.name}] {transfer.reference_number}",
                    created_by=user,
                )

                # Check for discrepancy
                diff = item.qty_sent - qty_received
                if diff != 0:
                    has_discrepancy = True
                    discrepancy_details.append(
                        f"{item.product.name}: sent={item.qty_sent}, received={qty_received}, diff={diff:+d}"
                    )

            transfer.received_by  = user
            transfer.received_at  = timezone.now()
            transfer.has_discrepancy = has_discrepancy
            notes = data.get("notes", "")
            if notes:
                transfer.notes = (transfer.notes + "\n" + notes).strip()

            if has_discrepancy:
                transfer.discrepancy_notes = "; ".join(discrepancy_details)
                transfer.status = "RECEIVED"   # stays here until resolved
            else:
                transfer.status      = "COMPLETED"
                transfer.completed_at = timezone.now()

            transfer.save(update_fields=[
                "status", "received_by", "received_at", "has_discrepancy",
                "discrepancy_notes", "notes", "completed_at", "updated_at",
            ])

        return Response(StockTransferSerializer(transfer).data)

    # ── COMPLETE PHYSICAL COLLECTION ──────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="complete_collection")
    def complete_collection(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/complete_collection/

        For PHYSICAL_COLLECTION transfers: collecting branch confirms receipt.
        Simultaneously deducts from sender and credits receiver, marks COMPLETED.
        Body: { "notes": "..." }
        """
        from django.db import transaction
        from django.utils import timezone

        transfer = self.get_object()
        user     = request.user
        business = getattr(user, "business", None)

        if transfer.transfer_method != "PHYSICAL_COLLECTION":
            return Response(
                {"error": "complete_collection is only for Physical Collection transfers."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if transfer.status not in ("APPROVED", "REQUESTED", "DRAFT"):
            return Response(
                {"error": f"Cannot complete a transfer with status '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            for item in transfer.items.select_related("product").all():
                qty = item.qty_sent

                # Deduct from sender
                sl_from = self._get_or_create_stock_level(
                    business, item.product_id, item.variant_id,
                    transfer.from_branch_id, transfer.from_warehouse_id,
                )
                sl_from.qty_on_hand   = max(0, sl_from.qty_on_hand   - qty)
                sl_from.qty_available = max(0, sl_from.qty_available - qty)
                sl_from.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

                StockMovement.objects.create(
                    business=business,
                    product_id=item.product_id,
                    variant_id=item.variant_id,
                    branch_id=transfer.from_branch_id,
                    warehouse_id=transfer.from_warehouse_id,
                    qty_delta=-qty,
                    type="TRANSFER_OUT",
                    reference_type="StockTransfer",
                    reference_id=transfer.id,
                    unit_cost=item.unit_cost,
                    notes=f"[PHYSICAL_COLLECTION OUT → {transfer.to_branch.name}] {transfer.reference_number}",
                    created_by=user,
                )

                # Credit receiver
                sl_to = self._get_or_create_stock_level(
                    business, item.product_id, item.variant_id,
                    transfer.to_branch_id, transfer.to_warehouse_id,
                )
                sl_to.qty_on_hand   = sl_to.qty_on_hand   + qty
                sl_to.qty_available = sl_to.qty_available + qty
                sl_to.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

                StockMovement.objects.create(
                    business=business,
                    product_id=item.product_id,
                    variant_id=item.variant_id,
                    branch_id=transfer.to_branch_id,
                    warehouse_id=transfer.to_warehouse_id,
                    qty_delta=qty,
                    type="TRANSFER_IN",
                    reference_type="StockTransfer",
                    reference_id=transfer.id,
                    unit_cost=item.unit_cost,
                    notes=f"[PHYSICAL_COLLECTION IN ← {transfer.from_branch.name}] {transfer.reference_number}",
                    created_by=user,
                )

                item.qty_received = qty
                item.save(update_fields=["qty_received", "updated_at"])

            transfer.status       = "COMPLETED"
            transfer.released_by  = user
            transfer.received_by  = user
            transfer.sent_at      = timezone.now()
            transfer.received_at  = timezone.now()
            transfer.completed_at = timezone.now()
            notes = request.data.get("notes", "")
            if notes:
                transfer.notes = (transfer.notes + "\n" + notes).strip()
            transfer.save(update_fields=[
                "status", "released_by", "received_by",
                "sent_at", "received_at", "completed_at", "notes", "updated_at",
            ])

        return Response(StockTransferSerializer(transfer).data)

    # ── CANCEL ────────────────────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="cancel_transfer")
    def cancel_transfer(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/cancel_transfer/

        Cancels a transfer that hasn't yet been sent (IN_TRANSIT or later
        cannot be cancelled — must be resolved).
        Body: { "notes": "..." }
        """
        from django.db import transaction

        transfer = self.get_object()

        if transfer.status in ("IN_TRANSIT", "RECEIVED", "COMPLETED"):
            return Response(
                {"error": f"Cannot cancel a transfer that is already '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if transfer.status == "CANCELLED":
            return Response({"error": "Transfer is already cancelled."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            transfer.status = "CANCELLED"
            notes = request.data.get("notes", "")
            if notes:
                transfer.notes = (transfer.notes + "\n" + notes).strip()
            transfer.save(update_fields=["status", "notes", "updated_at"])

        return Response(StockTransferSerializer(transfer).data)

    # ── RESOLVE DISCREPANCY ───────────────────────────────────────────────────

    @action(detail=True, methods=["post"], url_path="resolve_discrepancy")
    def resolve_discrepancy(self, request, pk=None):
        """
        POST /api/v1/inventory/stock-transfers/{id}/resolve_discrepancy/

        Manager/Admin resolves a discrepancy and marks the transfer COMPLETED.
        Does NOT reverse stock — the stock that was actually received stays.
        Body: { "notes": "Resolution explanation" }
        """
        from django.utils import timezone

        transfer = self.get_object()
        role = (getattr(request.user, "role", "") or "").upper()

        if role not in {"MANAGER", "ADMIN", "SUPER_ADMIN"}:
            return Response(
                {"error": "Only Managers and Admins can resolve transfer discrepancies."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not transfer.has_discrepancy:
            return Response({"error": "This transfer has no discrepancy to resolve."}, status=status.HTTP_400_BAD_REQUEST)
        if transfer.status != "RECEIVED":
            return Response(
                {"error": f"Cannot resolve discrepancy on a transfer with status '{transfer.status}'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        transfer.discrepancy_resolved    = True
        transfer.discrepancy_resolved_by = request.user
        transfer.discrepancy_resolved_at = timezone.now()
        transfer.status                  = "COMPLETED"
        transfer.completed_at            = timezone.now()
        resolution_note = request.data.get("notes", "")
        if resolution_note:
            transfer.discrepancy_notes = (
                transfer.discrepancy_notes + "\nResolution: " + resolution_note
            ).strip()
        transfer.save(update_fields=[
            "discrepancy_resolved", "discrepancy_resolved_by", "discrepancy_resolved_at",
            "discrepancy_notes", "status", "completed_at", "updated_at",
        ])

        return Response(StockTransferSerializer(transfer).data)


class StockTransferItemViewSet(viewsets.ModelViewSet):
    queryset = StockTransferItem.objects.all()
    serializer_class = StockTransferItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["transfer", "product", "variant", "batch"]
    ordering_fields = ["qty_sent", "qty_received", "unit_cost", "total_value", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(transfer__business=user.business)
        return qs.none()


class StockCountViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = StockCount.objects.all()
    serializer_class = StockCountSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "branch", "warehouse", "status",
        "created_by", "counter_user",
    ]
    search_fields = ["reference_number", "notes"]
    ordering_fields = [
        "reference_number", "total_items_counted", "variance_count",
        "variance_value", "started_at", "completed_at", "created_at",
    ]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class StockCountItemViewSet(viewsets.ModelViewSet):
    queryset = StockCountItem.objects.all()
    serializer_class = StockCountItemSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["stock_count", "product", "variant", "batch"]
    ordering_fields = ["system_qty", "counted_qty", "variance", "unit_cost", "variance_value", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_superuser:
            return qs
        if user.business_id:
            return qs.filter(stock_count__business=user.business)
        return qs.none()


class DamagedStockViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = DamagedStock.objects.all()
    serializer_class = DamagedStockSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "branch", "warehouse", "product",
        "variant", "batch", "reason", "status", "created_by",
    ]
    search_fields = ["notes"]
    ordering_fields = ["qty", "unit_cost", "total_value", "disposal_date", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class ExpiredStockViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ExpiredStock.objects.all()
    serializer_class = ExpiredStockSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "branch", "warehouse", "product",
        "variant", "batch", "status", "created_by",
    ]
    search_fields = ["notes"]
    ordering_fields = ["qty", "unit_cost", "total_value", "expiry_date", "disposal_date", "created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class StockAlertViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = StockAlert.objects.all()
    serializer_class = StockAlertSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "type", "product", "variant",
        "branch", "warehouse", "is_acknowledged", "acknowledged_by",
    ]
    search_fields = ["message"]
    ordering_fields = ["created_at", "acknowledged_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to   = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs
