import uuid
from decimal import Decimal
from django.db import models
from django.utils.translation import gettext_lazy as _


class StockMovement(models.Model):
    MOVEMENT_TYPE_CHOICES = (
        ("SALE", _("Sale")),
        ("PURCHASE", _("Purchase")),
        ("RETURN_IN", _("Return In")),
        ("RETURN_OUT", _("Return Out")),
        ("TRANSFER_IN", _("Transfer In")),
        ("TRANSFER_OUT", _("Transfer Out")),
        ("ADJUSTMENT", _("Adjustment")),
        ("DAMAGED", _("Damaged")),
        ("EXPIRED", _("Expired")),
        ("OPENING_STOCK", _("Opening Stock")),
        ("STOCK_COUNT", _("Stock Count")),
        ("PURCHASE_RETURN", _("Purchase Return")),
        ("SALE_RETURN", _("Sale Return")),
        # Stock-adjustment-specific movement types
        ("LOST", _("Lost")),
        ("THEFT", _("Theft")),
        ("INTERNAL_USE", _("Internal Use")),
        ("STOCK_CORRECTION", _("Stock Correction")),
        ("SUPPLIER_RETURN", _("Supplier Return")),
        ("FOUND_STOCK", _("Found Stock")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_movements",
    )
    qty_delta = models.IntegerField()
    type = models.CharField(max_length=30, choices=MOVEMENT_TYPE_CHOICES)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_stock_movement"
        verbose_name = _("Stock Movement")
        verbose_name_plural = _("Stock Movements")
        indexes = [
            models.Index(fields=["product", "variant", "branch", "warehouse", "created_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.type} {self.qty_delta:+d} {self.product.name}"


class OpeningStock(models.Model):
    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("POSTED", _("Posted")),
        ("CANCELLED", _("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="opening_stocks",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="opening_stocks",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="opening_stocks",
    )
    reference_number = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    total_items = models.IntegerField(default=0)
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="opening_stocks_created",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_opening_stock"
        verbose_name = _("Opening Stock")
        verbose_name_plural = _("Opening Stocks")
        unique_together = ("business", "reference_number")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference_number} - {self.status}"


class OpeningStockItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    opening_stock = models.ForeignKey(
        OpeningStock,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="opening_stock_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="opening_stock_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="opening_stock_items",
    )
    qty = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_opening_stock_item"
        verbose_name = _("Opening Stock Item")
        verbose_name_plural = _("Opening Stock Items")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.opening_stock.reference_number} - {self.product.name}: {self.qty}"


class StockAdjustment(models.Model):
    REASON_CHOICES = (
        ("DAMAGED",          _("Damaged")),
        ("EXPIRED",          _("Expired")),
        ("LOST",             _("Lost / Missing")),
        ("THEFT",            _("Theft")),
        ("INTERNAL_USE",     _("Internal Use")),
        ("STOCK_CORRECTION", _("Stock Correction")),
        ("SUPPLIER_RETURN",  _("Supplier Return")),
        ("FOUND",            _("Found Stock")),
        ("WRONG_ENTRY",      _("Wrong Entry")),
        ("OTHER",            _("Other")),
    )
    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("POSTED", _("Posted")),
        ("CANCELLED", _("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="stock_adjustments",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_adjustments",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_adjustments",
    )
    reference_number = models.CharField(max_length=100)
    reason = models.CharField(max_length=30, choices=REASON_CHOICES, default="OTHER")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    total_items = models.IntegerField(default=0)
    total_value_change = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_adjustments_created",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_adjustment"
        verbose_name = _("Stock Adjustment")
        verbose_name_plural = _("Stock Adjustments")
        unique_together = ("business", "reference_number")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference_number} - {self.reason} ({self.status})"


class StockAdjustmentItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    adjustment = models.ForeignKey(
        StockAdjustment,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="stock_adjustment_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_adjustment_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_adjustment_items",
    )
    qty_expected = models.IntegerField(default=0)
    qty_actual = models.IntegerField(default=0)
    qty_delta = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    value_delta = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    restock = models.BooleanField(default=False)
    serial_number = models.CharField(
        max_length=100,
        blank=True,
        help_text=_("Optional IMEI / serial number for serialised products (phones, electronics, etc.)"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_adjustment_item"
        verbose_name = _("Stock Adjustment Item")
        verbose_name_plural = _("Stock Adjustment Items")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.adjustment.reference_number} - {self.product.name}: {self.qty_delta:+d}"


class StockTransfer(models.Model):
    STATUS_CHOICES = (
        ("REQUESTED",  _("Requested")),
        ("APPROVED",   _("Approved")),
        ("IN_TRANSIT", _("In Transit")),
        ("RECEIVED",   _("Received")),
        ("COMPLETED",  _("Completed")),
        ("CANCELLED",  _("Cancelled")),
        # Legacy — kept so old DB rows are not broken
        ("DRAFT", _("Draft")),
        ("SENT",  _("Sent")),
    )

    TRANSFER_METHOD_CHOICES = (
        ("PHYSICAL_COLLECTION", _("Physical Collection")),
        ("DELIVERY",            _("Delivery / Dispatch")),
        ("OTHER",               _("Other")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="stock_transfers",
    )
    from_branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_transfers_from",
    )
    to_branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_transfers_to",
    )
    from_warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_transfers_from",
    )
    to_warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_transfers_to",
    )
    reference_number = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="REQUESTED"
    )
    transfer_method = models.CharField(
        max_length=25,
        choices=TRANSFER_METHOD_CHOICES,
        default="DELIVERY",
    )
    total_items = models.IntegerField(default=0)
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    # Timestamps for each workflow step
    approved_at  = models.DateTimeField(null=True, blank=True)
    sent_at      = models.DateTimeField(null=True, blank=True)
    received_at  = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # People involved at each step
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfers_created",
    )
    approved_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfers_approved",
    )
    released_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfers_released",
    )
    received_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfers_received",
    )
    # Discrepancy tracking
    has_discrepancy     = models.BooleanField(default=False)
    discrepancy_notes   = models.TextField(blank=True)
    discrepancy_resolved = models.BooleanField(default=False)
    discrepancy_resolved_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfers_discrepancy_resolved",
    )
    discrepancy_resolved_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_transfer"
        verbose_name = _("Stock Transfer")
        verbose_name_plural = _("Stock Transfers")
        unique_together = ("business", "reference_number")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference_number} {self.from_branch.code}->{self.to_branch.code} ({self.status})"


class StockTransferItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transfer = models.ForeignKey(
        StockTransfer,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="stock_transfer_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_transfer_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_transfer_items",
    )
    qty_sent = models.IntegerField(default=0)
    qty_received = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    # Serialised-product support
    serial_number = models.CharField(
        max_length=100,
        blank=True,
        help_text=_("IMEI / serial number for phones or electronics"),
    )
    condition = models.CharField(
        max_length=30,
        blank=True,
        help_text=_("Product condition e.g. New, Refurbished, Used"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_transfer_item"
        verbose_name = _("Stock Transfer Item")
        verbose_name_plural = _("Stock Transfer Items")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transfer.reference_number} - {self.product.name}: {self.qty_sent}/{self.qty_received}"


class StockCount(models.Model):
    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("IN_PROGRESS", _("In Progress")),
        ("COMPLETED", _("Completed")),
        ("CANCELLED", _("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="stock_counts",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_counts",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_counts",
    )
    reference_number = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    total_items_counted = models.IntegerField(default=0)
    variance_count = models.IntegerField(default=0)
    variance_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_counts_created",
    )
    counter_user = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_counts_counted",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_count"
        verbose_name = _("Stock Count")
        verbose_name_plural = _("Stock Counts")
        unique_together = ("business", "reference_number")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.reference_number} ({self.status})"


class StockCountItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    stock_count = models.ForeignKey(
        StockCount,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="stock_count_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_count_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_count_items",
    )
    system_qty = models.IntegerField(default=0)
    counted_qty = models.IntegerField(default=0)
    variance = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    variance_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_stock_count_item"
        verbose_name = _("Stock Count Item")
        verbose_name_plural = _("Stock Count Items")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.stock_count.reference_number} - {self.product.name}: var {self.variance:+d}"


class DamagedStock(models.Model):
    REASON_CHOICES = (
        ("DAMAGED_ON_ARRIVAL", _("Damaged on Arrival")),
        ("SHOP_DAMAGE", _("Shop Damage")),
        ("CUSTOMER_RETURN_DAMAGED", _("Customer Return Damaged")),
        ("OTHER", _("Other")),
    )
    STATUS_CHOICES = (
        ("QUARANTINED", _("Quarantined")),
        ("WRITTEN_OFF", _("Written Off")),
        ("RETURNED_TO_SUPPLIER", _("Returned to Supplier")),
        ("DONATED", _("Donated")),
        ("SOLD_AS_IS", _("Sold As Is")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="damaged_stocks",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="damaged_stocks",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="damaged_stocks",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="damaged_stocks",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="damaged_stocks",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damaged_stocks",
    )
    qty = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    reason = models.CharField(max_length=40, choices=REASON_CHOICES, default="OTHER")
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="QUARANTINED")
    disposal_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="damaged_stocks_created",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_damaged_stock"
        verbose_name = _("Damaged Stock")
        verbose_name_plural = _("Damaged Stocks")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.product.name} - {self.qty} damaged ({self.status})"


class ExpiredStock(models.Model):
    STATUS_CHOICES = (
        ("QUARANTINED", _("Quarantined")),
        ("WRITTEN_OFF", _("Written Off")),
        ("RETURNED_TO_SUPPLIER", _("Returned to Supplier")),
        ("DONATED", _("Donated")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="expired_stocks",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="expired_stocks",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="expired_stocks",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="expired_stocks",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="expired_stocks",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expired_stocks",
    )
    qty = models.IntegerField(default=0)
    unit_cost = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_value = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    expiry_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="QUARANTINED")
    disposal_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expired_stocks_created",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_expired_stock"
        verbose_name = _("Expired Stock")
        verbose_name_plural = _("Expired Stocks")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.product.name} - {self.qty} expired ({self.status})"


class StockAlert(models.Model):
    ALERT_TYPE_CHOICES = (
        ("LOW_STOCK", _("Low Stock")),
        ("EXPIRING_SOON", _("Expiring Soon")),
        ("EXPIRED", _("Expired")),
        ("OUT_OF_STOCK", _("Out of Stock")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="stock_alerts",
    )
    type = models.CharField(max_length=30, choices=ALERT_TYPE_CHOICES)
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="stock_alerts",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="stock_alerts",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="stock_alerts",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="stock_alerts",
    )
    message = models.TextField()
    is_acknowledged = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledged_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_alerts_acknowledged",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "inventory_stock_alert"
        verbose_name = _("Stock Alert")
        verbose_name_plural = _("Stock Alerts")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.type} - {self.product.name}: {self.message[:50]}"
