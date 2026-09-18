from decimal import Decimal

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin
from products.models import (
    Category, Brand, UnitOfMeasure, TaxRate, Product, ProductVariant,
    ProductBarcode, ProductImage, ProductPriceList, ProductPrice,
    ProductBundle, Batch, ProductStockLevel,
)
from products.serializers import (
    CategorySerializer, BrandSerializer, UnitOfMeasureSerializer,
    TaxRateSerializer, ProductSerializer, ProductVariantSerializer,
    ProductBarcodeSerializer, ProductImageSerializer,
    ProductPriceListSerializer, ProductPriceSerializer,
    ProductBundleSerializer, BatchSerializer, ProductStockLevelSerializer,
)


class CategoryViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "parent", "is_active"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["name", "code", "sort_order", "created_at"]


class BrandViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Brand.objects.all()
    serializer_class = BrandSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "is_active"]
    search_fields = ["name", "code", "description", "website"]
    ordering_fields = ["name", "code", "created_at"]


class UnitOfMeasureViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = UnitOfMeasure.objects.all()
    serializer_class = UnitOfMeasureSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "base_unit", "allow_fractional"]
    search_fields = ["name", "code", "symbol"]
    ordering_fields = ["name", "code", "created_at"]


class TaxRateViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = TaxRate.objects.all()
    serializer_class = TaxRateSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "type", "is_active", "applies_to", "is_compound"]
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code", "rate_percent", "created_at"]


class ProductViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = [
        "business", "category", "brand", "type",
        "is_active", "is_track_stock", "is_tax_exempt",
        "uom_purchase", "uom_sale",
        "pricing_type",   # new filter
    ]
    search_fields = ["name", "sku", "description", "barcode_main"]
    ordering_fields = ["name", "sku", "cost_price", "selling_price", "created_at"]


class ProductVariantViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductVariant.objects.all()
    serializer_class = ProductVariantSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "product", "is_default", "is_active"]
    search_fields = ["variant_name", "sku"]
    ordering_fields = ["variant_name", "sku", "selling_price", "created_at"]


class ProductBarcodeViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductBarcode.objects.all()
    serializer_class = ProductBarcodeSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "product", "variant", "type", "is_primary"]
    search_fields = ["barcode"]
    ordering_fields = ["barcode", "created_at"]


class ProductImageViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductImage.objects.all()
    serializer_class = ProductImageSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "product", "variant", "is_primary"]
    search_fields = ["alt_text"]
    ordering_fields = ["sort_order", "created_at"]


class ProductPriceListViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductPriceList.objects.all()
    serializer_class = ProductPriceListSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "is_active"]
    search_fields = ["name", "code", "description"]
    ordering_fields = ["name", "code", "valid_from", "created_at"]


class ProductPriceViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductPrice.objects.all()
    serializer_class = ProductPriceSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "price_list", "product", "variant"]
    ordering_fields = ["price", "min_qty", "max_qty", "created_at"]


class ProductBundleViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductBundle.objects.all()
    serializer_class = ProductBundleSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "bundle_product", "component_product", "variant"]
    ordering_fields = ["qty", "cost", "created_at"]


class BatchViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Batch.objects.all()
    serializer_class = BatchSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "product", "variant", "supplier"]
    search_fields = ["batch_number", "notes"]
    ordering_fields = ["batch_number", "manufacture_date", "expiry_date", "created_at"]


class ProductStockLevelViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = ProductStockLevel.objects.select_related("product", "branch", "warehouse").all()
    serializer_class = ProductStockLevelSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "product", "variant", "branch", "warehouse"]
    ordering_fields = [
        "qty_on_hand", "qty_reserved", "qty_available",
        "reorder_level", "last_received_date", "created_at",
    ]

    @action(detail=False, methods=["get"], url_path="branch-summary")
    def branch_summary(self, request):
        """
        GET /api/v1/products/stock-levels/branch-summary/?branch=<uuid>

        Returns a compact dict of {product_id: qty_available} for a specific branch.
        Used by the frontend BranchInventory store to load branch-specific stock.
        Also supports ?warehouse=<uuid> for warehouse-level scoping.
        """
        branch_id = request.query_params.get("branch")
        warehouse_id = request.query_params.get("warehouse")

        if not branch_id:
            return Response(
                {"error": "branch query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = self.get_queryset().filter(branch_id=branch_id)
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)

        summary = {
            str(sl.product_id): {
                "qty_on_hand":   sl.qty_on_hand,
                "qty_reserved":  sl.qty_reserved,
                "qty_available": sl.qty_available,
                "reorder_level": sl.reorder_level,
                "branch_id":     str(sl.branch_id),
                "warehouse_id":  str(sl.warehouse_id),
            }
            for sl in qs
        }

        return Response({"branch_id": branch_id, "stock": summary})

    @action(detail=False, methods=["post"], url_path="adjust")
    def adjust(self, request):
        """
        POST /api/v1/products/stock-levels/adjust/

        Body: { product: UUID, branch: UUID, warehouse: UUID, delta: int, notes: "" }

        Atomically adjusts qty_on_hand and qty_available for a branch+product,
        creating the ProductStockLevel record if it doesn't exist yet.
        Also records a StockMovement for the audit trail.
        """
        from django.db import transaction
        from inventory.models import StockMovement

        product_id  = request.data.get("product")
        branch_id   = request.data.get("branch")
        warehouse_id = request.data.get("warehouse")
        delta       = request.data.get("delta")
        notes       = request.data.get("notes", "")
        move_type   = request.data.get("type", "ADJUSTMENT")

        if not all([product_id, branch_id, warehouse_id, delta is not None]):
            return Response(
                {"error": "product, branch, warehouse and delta are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            delta = int(delta)
        except (TypeError, ValueError):
            return Response(
                {"error": "delta must be an integer."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = request.user
        business = getattr(user, "business", None)

        with transaction.atomic():
            sl, _ = ProductStockLevel.objects.get_or_create(
                product_id=product_id,
                branch_id=branch_id,
                warehouse_id=warehouse_id,
                variant=None,
                defaults={
                    "business": business,
                    "qty_on_hand": 0,
                    "qty_reserved": 0,
                    "qty_available": 0,
                    "reorder_level": 0,
                },
            )
            sl.qty_on_hand   = max(0, sl.qty_on_hand + delta)
            sl.qty_available = max(0, sl.qty_available + delta)
            sl.save(update_fields=["qty_on_hand", "qty_available", "updated_at"])

            # Write movement record for audit trail
            StockMovement.objects.create(
                business=business,
                product_id=product_id,
                branch_id=branch_id,
                warehouse_id=warehouse_id,
                qty_delta=delta,
                type=move_type,
                notes=notes,
                created_by=user,
            )

        return Response(ProductStockLevelSerializer(sl).data, status=status.HTTP_200_OK)
