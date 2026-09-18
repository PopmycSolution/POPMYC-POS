import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal
try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class PaymentMethod(models.Model):
    CODE_CHOICES = (
        ("CASH", _("Cash")),
        ("MTN_MOMO", _("MTN Mobile Money")),
        ("TELECEL_CASH", _("Telecel Cash")),
        ("AT_MONEY", _("AirtelTigo Money")),
        ("CARD", _("Card")),
        ("BANK_TRANSFER", _("Bank Transfer")),
        ("GHIPSS_QR", _("Ghana Interbank QR")),
        ("CHEQUE", _("Cheque")),
        ("CREDIT", _("Credit")),
        ("CUSTOMER_CREDIT", _("Customer Credit")),
    )

    TYPE_CHOICES = (
        ("CASH", _("Cash")),
        ("MOBILE_MONEY", _("Mobile Money")),
        ("CARD", _("Card")),
        ("BANK", _("Bank")),
        ("DIGITAL", _("Digital")),
        ("CREDIT", _("Credit")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="payment_methods",
    )
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=30, choices=CODE_CHOICES)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    is_active = models.BooleanField(default=True)
    min_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("1.00"))
    max_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("10000.00"))
    network_prefixes_json = JSONField(default=list, blank=True)
    merchant_id = models.CharField(max_length=255, blank=True)
    api_config_json = JSONField(default=dict, blank=True)
    fee_flat = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    fee_percent = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_payment_method"
        verbose_name = _("Payment Method")
        verbose_name_plural = _("Payment Methods")
        unique_together = ("business", "code")
        ordering = ["sort_order", "name"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Sale(models.Model):
    SALE_TYPE_CHOICES = (
        ("RETAIL", _("Retail")),
        ("WHOLESALE", _("Wholesale")),
        ("CREDIT_SALE", _("Credit Sale")),
        ("RETURN", _("Return")),
        ("EXCHANGE", _("Exchange")),
        ("LAYAWAY", _("Layaway")),
    )

    DINING_OPTION_CHOICES = (
        ("DINE_IN", _("Dine In")),
        ("TAKEAWAY", _("Takeaway")),
        ("DELIVERY", _("Delivery")),
        ("NA", _("N/A")),
    )

    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("COMPLETED", _("Completed")),
        ("VOIDED", _("Voided")),
        ("REFUNDED", _("Refunded")),
        ("PARTIAL_REFUND", _("Partial Refund")),
        ("HELD", _("Held")),
        ("PENDING_SYNC", _("Pending Sync")),
    )

    PAYMENT_STATUS_CHOICES = (
        ("UNPAID", _("Unpaid")),
        ("PARTIAL", _("Partial")),
        ("PAID", _("Paid")),
        ("OVERPAID", _("Overpaid")),
        ("CREDIT", _("Credit")),
    )

    REFUND_STATUS_CHOICES = (
        ("NONE", _("None")),
        ("PARTIAL", _("Partial")),
        ("FULL", _("Full")),
    )

    SYNC_STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("SYNCED", _("Synced")),
        ("FAILED", _("Failed")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sales",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="sales",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="sales",
    )
    register = models.ForeignKey(
        "branches.Register",
        on_delete=models.CASCADE,
        related_name="sales",
    )
    shift = models.ForeignKey(
        "branches.Shift",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    cashier = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="sales_as_cashier",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sales",
    )
    sale_type = models.CharField(max_length=20, choices=SALE_TYPE_CHOICES, default="RETAIL")
    dining_option = models.CharField(max_length=20, choices=DINING_OPTION_CHOICES, default="NA")
    invoice_number = models.CharField(max_length=50)
    reference = models.CharField(max_length=255, blank=True)
    proforma_number = models.CharField(max_length=50, blank=True, null=True)
    held_sale_ref = models.CharField(max_length=50, blank=True, null=True)
    cart_snapshot_json = JSONField(default=dict, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="COMPLETED")
    payment_status = models.CharField(max_length=20, choices=PAYMENT_STATUS_CHOICES, default="UNPAID")
    refund_status = models.CharField(max_length=20, choices=REFUND_STATUS_CHOICES, default="NONE")
    total_qty = models.IntegerField(default=0)
    subtotal_excl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_discount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_tax = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_incl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    rounding_adjustment = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    grand_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_paid = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    change_due = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    customer_credit_used = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tip_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    loyalty_points_earned = models.IntegerField(default=0)
    notes = models.TextField(blank=True)
    internal_notes = models.TextField(blank=True)
    tax_exempt_certificate = models.CharField(max_length=255, blank=True, null=True)
    is_tax_inclusive_pricing = models.BooleanField(default=True)
    prices_include_vat = models.BooleanField(default=True)
    currency = models.CharField(max_length=10, default="GHS")
    exchange_rate = models.DecimalField(max_digits=15, decimal_places=6, default=Decimal("1.00"))
    idempotency_key = models.CharField(max_length=255, blank=True)
    offline_uuid = models.UUIDField(null=True, blank=True)
    sync_status = models.CharField(max_length=20, choices=SYNC_STATUS_CHOICES, default="SYNCED")
    synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voided_sales",
    )
    void_reason = models.TextField(blank=True, null=True)

    class Meta:
        db_table = "sales_sale"
        verbose_name = _("Sale")
        verbose_name_plural = _("Sales")
        unique_together = ("business", "invoice_number")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "created_at"]),
            models.Index(fields=["business", "status"]),
            models.Index(fields=["business", "customer"]),
        ]

    def __str__(self):
        return f"Sale {self.invoice_number}"


class SaleItem(models.Model):
    CONDITION_CHOICES = (
        ("NEW", _("New")),
        ("OPEN_BOX", _("Open Box")),
        ("USED", _("Used")),
        ("REFURBISHED", _("Refurbished")),
        ("DAMAGED", _("Damaged")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="items",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="sale_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    imei = models.ForeignKey(
        "phones.PhoneIMEI",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    line_number = models.IntegerField(default=1)
    sku_snapshot = models.CharField(max_length=100, blank=True)
    name_snapshot = models.CharField(max_length=255)
    description_snapshot = models.TextField(blank=True)
    qty = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("1"))
    uom = models.ForeignKey(
        "products.UnitOfMeasure",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_items",
    )
    base_price_excl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    base_price_incl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    unit_price_excl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    unit_price_incl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cost_price_snapshot = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    line_discount_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    line_discount_amt = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    order_discount_allocated_amt = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    subtotal_excl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    subtotal_incl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    taxable_amt = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    is_taxable = models.BooleanField(default=True)
    tax_exempt_reason = models.TextField(blank=True, null=True)
    tax_rates_json = JSONField(default=list, blank=True)
    tax_amt_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_line = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_line_excl = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    warranty_months_snapshot = models.IntegerField(default=0)
    is_returnable = models.BooleanField(default=True)
    return_reason = models.TextField(blank=True, null=True)
    returned_qty = models.IntegerField(default=0)
    condition_sold = models.CharField(max_length=20, choices=CONDITION_CHOICES, default="NEW")
    prescription_id = models.UUIDField(null=True, blank=True)
    oversold_flag = models.BooleanField(default=False)
    price_override_flag = models.BooleanField(default=False)
    price_override_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="price_override_items",
    )
    price_override_reason = models.TextField(blank=True, null=True)
    # ── Negotiated-price fields (distinct from formal discount) ───────────────
    # negotiated_unit_price: what the customer actually agreed to pay per unit.
    #   NULL  → no negotiation; use unit_price_incl as the final price.
    #   value → the negotiated final price (never written back to Product.selling_price).
    negotiated_unit_price = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        verbose_name=_("Negotiated Unit Price"),
        help_text=_("Customer-agreed price per unit. Product base price is unchanged."),
    )
    # Snapshot of the product's base selling price at time of sale,
    # kept even when a negotiated price was used so the difference is auditable.
    original_price_snapshot = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
        verbose_name=_("Original Price Snapshot"),
        help_text=_("Product selling_price at time of sale, preserved for audit."),
    )
    negotiated_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="negotiated_sale_items",
        verbose_name=_("Negotiated By"),
    )
    kitchen_note = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_sale_item"
        verbose_name = _("Sale Item")
        verbose_name_plural = _("Sale Items")
        ordering = ["line_number"]

    def __str__(self):
        return f"{self.name_snapshot} x {self.qty}"


class SaleTax(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="taxes",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_taxes",
    )
    sale_item = models.ForeignKey(
        SaleItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="taxes",
    )
    tax_rate = models.ForeignKey(
        "products.TaxRate",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_taxes",
    )
    tax_code = models.CharField(max_length=50)
    tax_name = models.CharField(max_length=100)
    tax_rate_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    taxable_base = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tax_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    is_compound = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_sale_tax"
        verbose_name = _("Sale Tax")
        verbose_name_plural = _("Sale Taxes")

    def __str__(self):
        return f"{self.tax_name} - {self.tax_amount}"


class SaleDiscount(models.Model):
    DISCOUNT_TYPE_CHOICES = (
        ("PERCENTAGE", _("Percentage")),
        ("FIXED", _("Fixed")),
        ("BOGO", _("BOGO")),
        ("BUNDLE", _("Bundle")),
        ("PROMO", _("Promo")),
        ("LOYALTY", _("Loyalty")),
        ("COUPON", _("Coupon")),
    )

    DISCOUNT_SCOPE_CHOICES = (
        ("LINE", _("Line")),
        ("ORDER", _("Order")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="discounts",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_discounts",
    )
    sale_item = models.ForeignKey(
        SaleItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="discounts",
    )
    discount_type = models.CharField(max_length=20, choices=DISCOUNT_TYPE_CHOICES)
    discount_scope = models.CharField(max_length=10, choices=DISCOUNT_SCOPE_CHOICES)
    code = models.CharField(max_length=100, blank=True)
    name = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    percentage = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    applied_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="applied_discounts",
    )
    override_reason = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_sale_discount"
        verbose_name = _("Sale Discount")
        verbose_name_plural = _("Sale Discounts")

    def __str__(self):
        return f"{self.discount_type} - {self.amount or self.percentage}%"


class SalePayment(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("COMPLETED", _("Completed")),
        ("FAILED", _("Failed")),
        ("CANCELLED", _("Cancelled")),
        ("TIMED_OUT", _("Timed Out")),
        ("REFUNDED", _("Refunded")),
        ("PARTIAL_REFUND", _("Partial Refund")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_payments",
    )
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.PROTECT,
        related_name="sale_payments",
    )
    method_code = models.CharField(max_length=30)
    method_name = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tendered_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    change = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="COMPLETED")
    transaction_reference = models.CharField(max_length=255, blank=True)
    gateway_reference = models.CharField(max_length=255, blank=True)
    customer_phone = models.CharField(max_length=20, blank=True)
    customer_wallet_id = models.CharField(max_length=255, blank=True, null=True)
    currency = models.CharField(max_length=10, default="GHS")
    fee_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    net_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    paid_at = models.DateTimeField(auto_now_add=True)
    processed_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="processed_payments",
    )
    notes = models.TextField(blank=True)
    processor_response_json = JSONField(default=dict, blank=True)
    offline_uuid = models.UUIDField(null=True, blank=True)
    retry_count = models.IntegerField(default=0)
    idempotency_key = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_sale_payment"
        verbose_name = _("Sale Payment")
        verbose_name_plural = _("Sale Payments")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.method_name} - {self.amount}"


class SaleReturn(models.Model):
    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("COMPLETED", _("Completed")),
        ("VOIDED", _("Voided")),
    )

    RETURN_TYPE_CHOICES = (
        ("FULL", _("Full")),
        ("PARTIAL", _("Partial")),
        ("EXCHANGE", _("Exchange")),
    )

    REFUND_METHOD_CHOICES = (
        ("ORIGINAL_METHODS", _("Original Methods")),
        ("CASH_ONLY", _("Cash Only")),
        ("CUSTOMER_CREDIT", _("Customer Credit")),
        ("SPLIT", _("Split")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_returns",
    )
    original_sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="returns",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="sale_returns",
    )
    register = models.ForeignKey(
        "branches.Register",
        on_delete=models.CASCADE,
        related_name="sale_returns",
    )
    shift = models.ForeignKey(
        "branches.Shift",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sale_returns",
    )
    cashier = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="processed_returns",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="returns",
    )
    return_invoice_number = models.CharField(max_length=50, unique=True)
    reference = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    return_type = models.CharField(max_length=20, choices=RETURN_TYPE_CHOICES, default="FULL")
    total_items_returned = models.IntegerField(default=0)
    subtotal_refund = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_tax_refund = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_discount_reversed = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_refund_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    restocking_fee = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    net_refund_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    refund_method_preference = models.CharField(max_length=30, choices=REFUND_METHOD_CHOICES, default="ORIGINAL_METHODS")
    return_reason_summary = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sales_sale_return"
        verbose_name = _("Sale Return")
        verbose_name_plural = _("Sale Returns")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Return {self.return_invoice_number}"


class SaleReturnItem(models.Model):
    RETURN_REASON_CHOICES = (
        ("DEFECTIVE", _("Defective")),
        ("WRONG_ITEM", _("Wrong Item")),
        ("WRONG_SIZE", _("Wrong Size")),
        ("CHANGED_MIND", _("Changed Mind")),
        ("EXPIRED", _("Expired")),
        ("DAMAGED", _("Damaged")),
        ("DUPLICATE", _("Duplicate")),
        ("MISSING_PARTS", _("Missing Parts")),
        ("OTHER", _("Other")),
    )

    CONDITION_CHOICES = (
        ("NEW", _("New")),
        ("OPEN_BOX", _("Open Box")),
        ("USED", _("Used")),
        ("DAMAGED", _("Damaged")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale_return = models.ForeignKey(
        SaleReturn,
        on_delete=models.CASCADE,
        related_name="items",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_return_items",
    )
    original_sale_item = models.ForeignKey(
        SaleItem,
        on_delete=models.CASCADE,
        related_name="return_items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="return_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="return_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="return_items",
    )
    qty_returned = models.IntegerField(default=0)
    return_reason = models.CharField(max_length=30, choices=RETURN_REASON_CHOICES, default="OTHER")
    condition_returned = models.CharField(max_length=20, choices=CONDITION_CHOICES, default="NEW")
    restock = models.BooleanField(default=True)
    original_unit_price = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    refund_unit_price = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    unit_tax_refund = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    line_discount_reversed = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    line_refund_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_sale_return_item"
        verbose_name = _("Sale Return Item")
        verbose_name_plural = _("Sale Return Items")

    def __str__(self):
        return f"{self.product} x {self.qty_returned}"


class SaleReturnRefund(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("COMPLETED", _("Completed")),
        ("FAILED", _("Failed")),
        ("CANCELLED", _("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sale_return = models.ForeignKey(
        SaleReturn,
        on_delete=models.CASCADE,
        related_name="refunds",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sale_return_refunds",
    )
    payment_method = models.ForeignKey(
        PaymentMethod,
        on_delete=models.PROTECT,
        related_name="return_refunds",
    )
    method_code = models.CharField(max_length=30)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    customer_phone = models.CharField(max_length=20, blank=True)
    transaction_reference = models.CharField(max_length=255, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    processed_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="processed_return_refunds",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_sale_return_refund"
        verbose_name = _("Sale Return Refund")
        verbose_name_plural = _("Sale Return Refunds")

    def __str__(self):
        return f"Refund {self.method_code} - {self.amount}"


class HeldSale(models.Model):
    STATUS_CHOICES = (
        ("HELD", _("Held")),
        ("CONVERTED", _("Converted")),
        ("EXPIRED", _("Expired")),
        ("DISCARDED", _("Discarded")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="held_sales",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="held_sales",
    )
    register = models.ForeignKey(
        "branches.Register",
        on_delete=models.CASCADE,
        related_name="held_sales",
    )
    cashier = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="held_sales",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="held_sales",
    )
    held_reference = models.CharField(max_length=50, unique=True)
    customer_name_ref = models.CharField(max_length=255, blank=True)
    cart_snapshot_json = JSONField(default=dict, blank=True)
    item_count = models.IntegerField(default=0)
    total_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="HELD")
    expires_at = models.DateTimeField(null=True, blank=True)
    converted_to_sale = models.ForeignKey(
        Sale,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="held_sale",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_held_sale"
        verbose_name = _("Held Sale")
        verbose_name_plural = _("Held Sales")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Held Sale {self.held_reference}"


class Receipt(models.Model):
    RECEIPT_TYPE_CHOICES = (
        ("SALE", _("Sale")),
        ("RETURN", _("Return")),
        ("PROFORMA", _("Proforma")),
        ("QUOTATION", _("Quotation")),
        ("Z_REPORT", _("Z Report")),
        ("X_REPORT", _("X Report")),
        ("COPY", _("Copy")),
    )

    FORMAT_TYPE_CHOICES = (
        ("THERMAL_58", _("Thermal 58mm")),
        ("THERMAL_80", _("Thermal 80mm")),
        ("A4", _("A4")),
        ("A5", _("A5")),
        ("PDF", _("PDF")),
        ("DIGITAL", _("Digital")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="receipts",
    )
    sale = models.OneToOneField(
        Sale,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="receipt",
    )
    return_receipt = models.ForeignKey(
        SaleReturn,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="receipts",
        db_column="return_id",
    )
    receipt_type = models.CharField(max_length=20, choices=RECEIPT_TYPE_CHOICES)
    receipt_number = models.CharField(max_length=50, unique=True)
    format_type = models.CharField(max_length=20, choices=FORMAT_TYPE_CHOICES, default="THERMAL_80")
    is_original = models.BooleanField(default=True)
    is_emailed = models.BooleanField(default=False)
    is_smssent = models.BooleanField(default=False)
    print_count = models.IntegerField(default=0)
    last_printed_at = models.DateTimeField(null=True, blank=True)
    qr_code_payload = models.TextField(blank=True)
    signed_payload_hmac = models.CharField(max_length=255, blank=True)
    generated_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="generated_receipts",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    receipt_html = models.TextField(blank=True)
    rendered_pdf = models.FileField(upload_to="receipts/", null=True, blank=True)

    class Meta:
        db_table = "sales_receipt"
        verbose_name = _("Receipt")
        verbose_name_plural = _("Receipts")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Receipt {self.receipt_number}"


class Exchange(models.Model):
    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("COMPLETED", _("Completed")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="exchanges",
    )
    sale = models.ForeignKey(
        Sale,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="exchanges_new",
    )
    original_sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="exchanges_original",
    )
    exchange_number = models.CharField(max_length=50, unique=True)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.CASCADE,
        related_name="exchanges",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    items_taken_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    items_returned_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    difference_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    difference_paid = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    difference_refunded = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_exchanges",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_exchange"
        verbose_name = _("Exchange")
        verbose_name_plural = _("Exchanges")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Exchange {self.exchange_number}"


class Promotion(models.Model):
    TYPE_CHOICES = (
        ("PERCENTAGE", _("Percentage")),
        ("FIXED", _("Fixed")),
        ("BOGO", _("BOGO")),
        ("BUNDLE", _("Bundle")),
        ("BULK", _("Bulk")),
        ("CUSTOMER_TIER", _("Customer Tier")),
        ("DATE_BASED", _("Date Based")),
        ("FREE_SHIPPING", _("Free Shipping")),
    )

    SCOPE_CHOICES = (
        ("ORDER", _("Order")),
        ("CATEGORY", _("Category")),
        ("PRODUCT", _("Product")),
        ("CUSTOMER_GROUP", _("Customer Group")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="promotions",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    scope = models.CharField(max_length=30, choices=SCOPE_CHOICES, default="ORDER")
    discount_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    min_order_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    min_qty = models.IntegerField(default=1)
    max_discount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    categories = models.ManyToManyField(
        "products.Category",
        related_name="promotions",
        blank=True,
    )
    products = models.ManyToManyField(
        "products.Product",
        related_name="promotions",
        blank=True,
    )
    customer_groups = models.ManyToManyField(
        "customers.CustomerGroup",
        related_name="promotions",
        blank=True,
    )
    tiers = models.ManyToManyField(
        "customers.LoyaltyTier",
        related_name="promotions",
        blank=True,
    )
    buy_qty = models.IntegerField(default=0)
    get_qty = models.IntegerField(default=0)
    get_discount_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("100.00"))
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_to = models.DateTimeField(null=True, blank=True)
    usage_limit = models.IntegerField(default=0)
    usage_count = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    is_stackable = models.BooleanField(default=False)
    sort_order = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_promotions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_promotion"
        verbose_name = _("Promotion")
        verbose_name_plural = _("Promotions")
        unique_together = ("business", "code")
        ordering = ["sort_order", "-created_at"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Coupon(models.Model):
    TYPE_CHOICES = (
        ("PERCENTAGE", _("Percentage")),
        ("FIXED", _("Fixed")),
        ("FREE_SHIPPING", _("Free Shipping")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="coupons",
    )
    promotion = models.ForeignKey(
        Promotion,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coupons",
    )
    code = models.CharField(max_length=50, unique=True)
    description = models.TextField(blank=True)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    discount_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    max_discount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    min_order_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    usage_limit_per_customer = models.IntegerField(default=1)
    total_usage_limit = models.IntegerField(default=0)
    total_used = models.IntegerField(default=0)
    valid_from = models.DateTimeField(null=True, blank=True)
    valid_to = models.DateTimeField(null=True, blank=True)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coupons",
    )
    customer_group = models.ForeignKey(
        "customers.CustomerGroup",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="coupons",
    )
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_coupons",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_coupon"
        verbose_name = _("Coupon")
        verbose_name_plural = _("Coupons")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Coupon {self.code}"


class CouponRedemption(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coupon = models.ForeignKey(
        Coupon,
        on_delete=models.CASCADE,
        related_name="redemptions",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="coupon_redemptions",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.CASCADE,
        related_name="coupon_redemptions",
    )
    sale = models.ForeignKey(
        Sale,
        on_delete=models.CASCADE,
        related_name="coupon_redemptions",
    )
    redeemed_at = models.DateTimeField(auto_now_add=True)
    discount_applied = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_coupon_redemption"
        verbose_name = _("Coupon Redemption")
        verbose_name_plural = _("Coupon Redemptions")

    def __str__(self):
        return f"{self.coupon.code} - {self.discount_applied}"


class CustomerLoyaltyReward(models.Model):
    REWARD_TYPE_CHOICES = (
        ("DISCOUNT_PCT", _("Percentage Discount")),
        ("DISCOUNT_FIXED", _("Fixed Discount")),
        ("FREE_PRODUCT", _("Free Product")),
        ("GIFT_CARD", _("Gift Card")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="loyalty_rewards",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    points_required = models.IntegerField(default=0)
    reward_type = models.CharField(max_length=30, choices=REWARD_TYPE_CHOICES)
    discount_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    discount_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    free_product = models.ForeignKey(
        "products.Product",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loyalty_rewards",
    )
    gift_card_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sales_customer_loyalty_reward"
        verbose_name = _("Customer Loyalty Reward")
        verbose_name_plural = _("Customer Loyalty Rewards")
        ordering = ["sort_order", "points_required"]

    def __str__(self):
        return f"{self.name} ({self.points_required} pts)"


class LoyaltyRedemption(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("COMPLETED", _("Completed")),
        ("CANCELLED", _("Cancelled")),
        ("EXPIRED", _("Expired")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="loyalty_redemptions",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.CASCADE,
        related_name="loyalty_redemptions",
    )
    reward = models.ForeignKey(
        CustomerLoyaltyReward,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="redemptions",
    )
    points_used = models.IntegerField(default=0)
    discount_applied = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    free_product_quantity = models.IntegerField(default=0)
    sale = models.ForeignKey(
        Sale,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loyalty_redemptions",
    )
    reference = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    redeemed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_loyalty_redemptions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sales_loyalty_redemption"
        verbose_name = _("Loyalty Redemption")
        verbose_name_plural = _("Loyalty Redemptions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.points_used} pts - {self.customer}"
