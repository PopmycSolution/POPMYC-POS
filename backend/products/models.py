import uuid
from decimal import Decimal
from django.db import models
from django.utils.translation import gettext_lazy as _
try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="categories",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to="category_images/", null=True, blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_category"
        verbose_name = _("Category")
        verbose_name_plural = _("Categories")
        unique_together = ("business", "code")
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Brand(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="brands",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    logo = models.ImageField(upload_to="brand_logos/", null=True, blank=True)
    website = models.URLField(max_length=500, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_brand"
        verbose_name = _("Brand")
        verbose_name_plural = _("Brands")
        unique_together = ("business", "code")
        ordering = ["name"]

    def __str__(self):
        return self.name


class UnitOfMeasure(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="unit_of_measures",
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    symbol = models.CharField(max_length=10, blank=True)
    allow_fractional = models.BooleanField(default=False)
    base_unit = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="converted_units",
    )
    conversion_factor = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("1.00"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_unit_of_measure"
        verbose_name = _("Unit of Measure")
        verbose_name_plural = _("Units of Measure")
        unique_together = ("business", "code")
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.symbol or self.code})"


class TaxRate(models.Model):
    TAX_TYPE_CHOICES = (
        ("VAT", _("VAT")),
        ("NHIL", _("NHIL")),
        ("GETFund", _("GETFund")),
        ("CST", _("CST")),
        ("EXCISE", _("EXCISE")),
        ("NONE", _("NONE")),
    )
    APPLIES_TO_CHOICES = (
        ("ALL", _("All")),
        ("GOODS", _("Goods")),
        ("SERVICES", _("Services")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="tax_rates",
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20)
    rate_percent = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    type = models.CharField(max_length=20, choices=TAX_TYPE_CHOICES, default="VAT")
    is_compound = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    applies_to = models.CharField(max_length=20, choices=APPLIES_TO_CHOICES, default="ALL")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_tax_rate"
        verbose_name = _("Tax Rate")
        verbose_name_plural = _("Tax Rates")
        unique_together = ("business", "code")
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.rate_percent}%)"


class Product(models.Model):
    PRODUCT_TYPE_CHOICES = (
        ("STOCK", _("Stock")),
        ("SERVICE", _("Service")),
        ("BUNDLE", _("Bundle")),
        ("VARIANT_PARENT", _("Variant Parent")),
    )

    class PricingType(models.TextChoices):
        FIXED      = "FIXED",      _("Fixed Price")
        NEGOTIABLE = "NEGOTIABLE", _("Negotiable Price")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="products",
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products",
    )
    brand = models.ForeignKey(
        Brand,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="products",
    )
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=30, choices=PRODUCT_TYPE_CHOICES, default="STOCK")
    is_active = models.BooleanField(default=True)
    is_track_stock = models.BooleanField(default=True)
    allow_negative = models.BooleanField(default=False)
    barcode_main = models.CharField(max_length=100, blank=True)
    warranty_months = models.IntegerField(default=0)
    returnable_days = models.IntegerField(default=7)
    is_tax_exempt = models.BooleanField(default=False)
    tax_rates = models.ManyToManyField(TaxRate, blank=True, related_name="products")
    uom_purchase = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="purchase_products",
    )
    uom_sale = models.ForeignKey(
        UnitOfMeasure,
        on_delete=models.PROTECT,
        related_name="sale_products",
    )
    conversion_purchase_sale = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("1.00"),
    )
    cost_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    selling_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    wholesale_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    low_stock_threshold = models.IntegerField(default=5)
    expiry_alert_days = models.IntegerField(default=30)
    weight_kg = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    pricing_type = models.CharField(
        max_length=20,
        choices=PricingType.choices,
        default=PricingType.FIXED,
        verbose_name=_("Pricing Type"),
        help_text=_(
            "FIXED: the selling price is used as-is. "
            "NEGOTIABLE: authorised staff may agree a different price with the customer at checkout."
        ),
    )
    images_json = JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product"
        verbose_name = _("Product")
        verbose_name_plural = _("Products")
        unique_together = ("business", "sku")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.sku})"


class ProductVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_variants",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    variant_name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100)
    cost_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    selling_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    wholesale_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    is_default = models.BooleanField(default=False)
    attributes_json = JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_variant"
        verbose_name = _("Product Variant")
        verbose_name_plural = _("Product Variants")
        unique_together = ("product", "sku")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.product.name} - {self.variant_name}"


class ProductBarcode(models.Model):
    BARCODE_TYPE_CHOICES = (
        ("EAN13", _("EAN-13")),
        ("UPC-A", _("UPC-A")),
        ("CODE128", _("CODE128")),
        ("QR", _("QR Code")),
        ("OTHER", _("Other")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_barcodes",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="barcodes",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="barcodes",
    )
    barcode = models.CharField(max_length=100)
    type = models.CharField(max_length=20, choices=BARCODE_TYPE_CHOICES, default="EAN13")
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_barcode"
        verbose_name = _("Product Barcode")
        verbose_name_plural = _("Product Barcodes")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.barcode} ({self.type})"


class ProductImage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_images",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="images",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="images",
    )
    image = models.ImageField(upload_to="product_images/")
    alt_text = models.CharField(max_length=255, blank=True)
    sort_order = models.IntegerField(default=0)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_image"
        verbose_name = _("Product Image")
        verbose_name_plural = _("Product Images")
        ordering = ["sort_order", "-created_at"]

    def __str__(self):
        return f"Image for {self.product.name}"


class ProductPriceList(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_price_lists",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    customer_tiers = models.ManyToManyField(
        "customers.LoyaltyTier",
        blank=True,
        related_name="price_lists",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_price_list"
        verbose_name = _("Product Price List")
        verbose_name_plural = _("Product Price Lists")
        unique_together = ("business", "code")
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class ProductPrice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_prices",
    )
    price_list = models.ForeignKey(
        ProductPriceList,
        on_delete=models.CASCADE,
        related_name="prices",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="price_entries",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="price_entries",
    )
    price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    min_qty = models.IntegerField(default=1)
    max_qty = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_price"
        verbose_name = _("Product Price")
        verbose_name_plural = _("Product Prices")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.price_list.name} - {self.product.name}: {self.price}"


class ProductBundle(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_bundles",
    )
    bundle_product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="bundle_components",
    )
    component_product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="bundle_memberships",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="bundle_components",
    )
    qty = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("1.00"),
    )
    cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_bundle"
        verbose_name = _("Product Bundle")
        verbose_name_plural = _("Product Bundles")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.bundle_product.name} contains {self.qty} x {self.component_product.name}"


class Batch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="batches",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="batches",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="batches",
    )
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="batches",
    )
    batch_number = models.CharField(max_length=100)
    manufacture_date = models.DateField(null=True, blank=True)
    expiry_date      = models.DateField(null=True, blank=True)
    purchase_price   = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    # ── Purchase / receipt tracking ───────────────────────────────────────────
    purchase_date = models.DateField(
        null=True, blank=True,
        help_text=_("Date the purchase order was placed"),
    )
    received_date = models.DateField(
        null=True, blank=True,
        help_text=_("Date goods were physically received"),
    )

    # ── Quantity tracking ─────────────────────────────────────────────────────
    qty_purchased = models.IntegerField(
        default=0,
        help_text=_("Total quantity on the purchase order for this batch"),
    )
    qty_received = models.IntegerField(
        default=0,
        help_text=_("Quantity actually received into stock"),
    )
    qty_remaining = models.IntegerField(
        default=0,
        help_text=_("Units still in stock from this batch (decremented on each sale)"),
    )

    # ── Stock-out tracking ────────────────────────────────────────────────────
    stock_out_date = models.DateTimeField(
        null=True, blank=True,
        help_text=_("Timestamp when qty_remaining first reached zero for this batch"),
    )

    # ── Purchase order reference ──────────────────────────────────────────────
    purchase_order = models.ForeignKey(
        "purchases.PurchaseOrder",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="batches",
        help_text=_("The PO that created this batch (if any)"),
    )

    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_batch"
        verbose_name = _("Batch")
        verbose_name_plural = _("Batches")
        unique_together = ("business", "product", "batch_number")

    # ── Computed helpers ──────────────────────────────────────────────────────

    @property
    def days_to_sell_out(self) -> int | None:
        """
        Number of days between received_date and stock_out_date.
        Returns None if the batch has not yet sold out or if received_date is unknown.
        """
        if self.stock_out_date and self.received_date:
            from django.utils import timezone
            import datetime
            so = self.stock_out_date.date() if hasattr(self.stock_out_date, "date") else self.stock_out_date
            return (so - self.received_date).days
        return None

    @property
    def days_in_stock(self) -> int:
        """
        Days elapsed since this batch was received.
        If already sold out, returns the total days it was available.
        """
        import datetime
        from django.utils import timezone
        if not self.received_date:
            return 0
        end = (
            self.stock_out_date.date()
            if self.stock_out_date and hasattr(self.stock_out_date, "date")
            else timezone.now().date()
        )
        return (end - self.received_date).days

    @property
    def is_sold_out(self) -> bool:
        return self.stock_out_date is not None
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.batch_number} - {self.product.name}"


class ProductStockLevel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="product_stock_levels",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.CASCADE,
        related_name="stock_levels",
    )
    variant = models.ForeignKey(
        ProductVariant,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_levels",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="product_stock_levels",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="product_stock_levels",
    )
    qty_on_hand = models.IntegerField(default=0)
    qty_reserved = models.IntegerField(default=0)
    qty_available = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=0)
    last_received_date = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products_product_stock_level"
        verbose_name = _("Product Stock Level")
        verbose_name_plural = _("Product Stock Levels")
        unique_together = ("product", "variant", "branch", "warehouse")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.product.name} - {self.branch.name}/{self.warehouse.name}: {self.qty_available}"
