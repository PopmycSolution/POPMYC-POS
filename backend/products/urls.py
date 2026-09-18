from django.urls import path, include
from rest_framework.routers import DefaultRouter
from products.views import (
    CategoryViewSet,
    BrandViewSet,
    UnitOfMeasureViewSet,
    TaxRateViewSet,
    ProductViewSet,
    ProductVariantViewSet,
    ProductBarcodeViewSet,
    ProductImageViewSet,
    ProductPriceListViewSet,
    ProductPriceViewSet,
    ProductBundleViewSet,
    BatchViewSet,
    ProductStockLevelViewSet,
)

router = DefaultRouter()
router.register(r"categories", CategoryViewSet, basename="category")
router.register(r"brands", BrandViewSet, basename="brand")
router.register(r"unit-of-measures", UnitOfMeasureViewSet, basename="unit-of-measure")
router.register(r"tax-rates", TaxRateViewSet, basename="tax-rate")
router.register(r"products", ProductViewSet, basename="product")
router.register(r"product-variants", ProductVariantViewSet, basename="product-variant")
router.register(r"product-barcodes", ProductBarcodeViewSet, basename="product-barcode")
router.register(r"product-images", ProductImageViewSet, basename="product-image")
router.register(r"product-price-lists", ProductPriceListViewSet, basename="product-price-list")
router.register(r"product-prices", ProductPriceViewSet, basename="product-price")
router.register(r"product-bundles", ProductBundleViewSet, basename="product-bundle")
router.register(r"batches", BatchViewSet, basename="batch")
router.register(r"product-stock-levels", ProductStockLevelViewSet, basename="product-stock-level")

urlpatterns = [
    path("", include(router.urls)),
]
