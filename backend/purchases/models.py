"""
Purchases app models
====================

Entity hierarchy:

  PurchaseOrder
    └── PurchaseOrderItem          (one line per product)

  GoodsReceivedNote  (linked to PurchaseOrder)
    └── GoodsReceivedItem          (actual quantities received per item)
         └── → creates / updates products.Batch
              └── → writes inventory.StockMovement (type=PURCHASE)
              └── → updates products.ProductStockLevel

PurchaseReturn
  └── PurchaseReturnItem

PurchasePayment    (payment installments against a PO)

Stock-out tracking
------------------
When GoodsReceivedItem is saved it creates/updates a Batch record with:
  batch.purchase_date   = PO.order_date
  batch.received_date   = GRN.received_date
  batch.qty_purchased   = PurchaseOrderItem.qty_ordered
  batch.qty_received    = GoodsReceivedItem.qty_received
  batch.qty_remaining   = GoodsReceivedItem.qty_received  (decremented by sales signal)
  batch.stock_out_date  = null  (set automatically when qty_remaining → 0)

The products.Batch.stock_out_date is set by a post_save signal in
purchases/apps.py → purchases/signals.py when qty_remaining reaches zero.

Expiry date is stored on Batch.expiry_date (separate from stock_out_date).
"""

import uuid
from decimal import Decimal
from django.db import models
from django.utils.translation import gettext_lazy as _


# ─────────────────────────────────────────────────────────────────────────────
# Purchase Order
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseOrder(models.Model):
    STATUS_CHOICES = (
        ("DRAFT",             _("Draft")),
        ("ORDERED",           _("Ordered")),
        ("PARTIAL_RECEIVED",  _("Partial Received")),
        ("RECEIVED",          _("Fully Received")),
        ("CANCELLED",         _("Cancelled")),
    )
    PAYMENT_STATUS_CHOICES = (
        ("UNPAID",   _("Unpaid")),
        ("PARTIAL",  _("Partial")),
        ("PAID",     _("Paid")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="purchase_orders",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_orders",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_orders",
    )
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_orders",
    )

    po_number        = models.CharField(max_length=100)
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    payment_status   = models.CharField(max_length=10, choices=PAYMENT_STATUS_CHOICES, default="UNPAID")

    order_date       = models.DateField()
    expected_date    = models.DateField(null=True, blank=True)
    received_date    = models.DateField(null=True, blank=True)  # set when fully received

    subtotal         = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tax_amount       = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_amount     = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    amount_paid      = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))

    notes            = models.TextField(blank=True)
    reference        = models.CharField(max_length=100, blank=True,
                                        help_text=_("Supplier invoice / reference number"))

    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_orders_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table       = "purchases_purchase_order"
        verbose_name   = _("Purchase Order")
        verbose_name_plural = _("Purchase Orders")
        unique_together = ("business", "po_number")
        ordering       = ["-created_at"]

    def __str__(self):
        return f"{self.po_number} ({self.status})"

    @property
    def balance_due(self) -> Decimal:
        return self.total_amount - self.amount_paid


# ─────────────────────────────────────────────────────────────────────────────
# Purchase Order Item
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="purchase_order_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_order_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_order_items",
        help_text=_("Populated when goods are received"),
    )

    qty_ordered  = models.IntegerField(default=0)
    qty_received = models.IntegerField(default=0)
    unit_cost    = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    subtotal     = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))

    # Optional per-item expiry date (pharmacy, food, cosmetics)
    expiry_date  = models.DateField(null=True, blank=True)

    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = "purchases_purchase_order_item"
        verbose_name = _("Purchase Order Item")
        ordering     = ["created_at"]

    def __str__(self):
        return f"{self.purchase_order.po_number} — {self.product.name} ×{self.qty_ordered}"


# ─────────────────────────────────────────────────────────────────────────────
# Goods Received Note (GRN)
# ─────────────────────────────────────────────────────────────────────────────

class GoodsReceivedNote(models.Model):
    """
    Created when stock arrives physically.  One PO can have multiple GRNs
    (partial deliveries).  Receiving a GRN triggers stock updates.
    """
    STATUS_CHOICES = (
        ("DRAFT",    _("Draft")),
        ("POSTED",   _("Posted")),
        ("CANCELLED",_("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="goods_received_notes",
    )
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="grns",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="goods_received_notes",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="goods_received_notes",
    )

    grn_number    = models.CharField(max_length=100)
    status        = models.CharField(max_length=15, choices=STATUS_CHOICES, default="DRAFT")
    received_date = models.DateField(help_text=_("Date goods were physically received"))
    received_by   = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="grns_received",
    )

    total_items   = models.IntegerField(default=0)
    total_value   = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    notes         = models.TextField(blank=True)
    posted_at     = models.DateTimeField(null=True, blank=True)

    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table        = "purchases_goods_received_note"
        verbose_name    = _("Goods Received Note")
        verbose_name_plural = _("Goods Received Notes")
        unique_together = ("business", "grn_number")
        ordering        = ["-created_at"]

    def __str__(self):
        return f"{self.grn_number} — {self.purchase_order.po_number} ({self.status})"


# ─────────────────────────────────────────────────────────────────────────────
# Goods Received Item
# ─────────────────────────────────────────────────────────────────────────────

class GoodsReceivedItem(models.Model):
    """
    One line per product in a GRN.  When the GRN is posted:
      1. Creates / updates products.Batch with all tracking fields.
      2. Updates products.ProductStockLevel.
      3. Writes inventory.StockMovement (type=PURCHASE).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(
        GoodsReceivedNote,
        on_delete=models.CASCADE,
        related_name="items",
    )
    purchase_order_item = models.ForeignKey(
        PurchaseOrderItem,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="grn_items",
        help_text=_("The PO line this receipt corresponds to"),
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="grn_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="grn_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="grn_items",
        help_text=_("Populated when GRN is posted (batch created/updated at that time)"),
    )

    qty_received   = models.IntegerField(default=0)
    unit_cost      = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_value    = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))

    # Per-item expiry (pharmacy, food, beverages, cosmetics)
    expiry_date    = models.DateField(null=True, blank=True)

    # Batch identifier supplied at receive time (e.g. manufacturer's lot number)
    batch_number   = models.CharField(max_length=100, blank=True)

    notes          = models.TextField(blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = "purchases_goods_received_item"
        verbose_name = _("Goods Received Item")
        ordering     = ["created_at"]

    def __str__(self):
        return f"{self.grn.grn_number} — {self.product.name} ×{self.qty_received}"


# ─────────────────────────────────────────────────────────────────────────────
# Purchase Return
# ─────────────────────────────────────────────────────────────────────────────

class PurchaseReturn(models.Model):
    STATUS_CHOICES = (
        ("DRAFT",    _("Draft")),
        ("POSTED",   _("Posted")),
        ("CANCELLED",_("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="purchase_returns",
    )
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="returns",
    )
    grn = models.ForeignKey(
        GoodsReceivedNote,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="returns",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_returns",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_returns",
    )
    return_number = models.CharField(max_length=100)
    status        = models.CharField(max_length=15, choices=STATUS_CHOICES, default="DRAFT")
    return_date   = models.DateField()
    reason        = models.TextField(blank=True)
    total_value   = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    created_by    = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_returns_created",
    )
    notes         = models.TextField(blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table        = "purchases_purchase_return"
        verbose_name    = _("Purchase Return")
        verbose_name_plural = _("Purchase Returns")
        unique_together = ("business", "return_number")
        ordering        = ["-created_at"]

    def __str__(self):
        return f"{self.return_number} ({self.status})"


class PurchaseReturnItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_return = models.ForeignKey(
        PurchaseReturn,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="purchase_return_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_return_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_return_items",
    )
    qty_returned = models.IntegerField(default=0)
    unit_cost    = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_value  = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    reason       = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = "purchases_purchase_return_item"
        verbose_name = _("Purchase Return Item")
        ordering     = ["created_at"]

    def __str__(self):
        return f"{self.purchase_return.return_number} — {self.product.name} ×{self.qty_returned}"


# ─────────────────────────────────────────────────────────────────────────────
# Purchase Payment
# ─────────────────────────────────────────────────────────────────────────────

class PurchasePayment(models.Model):
    PAYMENT_METHOD_CHOICES = (
        ("CASH",          _("Cash")),
        ("BANK_TRANSFER", _("Bank Transfer")),
        ("CHEQUE",        _("Cheque")),
        ("MOBILE_MONEY",  _("Mobile Money")),
        ("CREDIT",        _("Credit Note")),
        ("OTHER",         _("Other")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="purchase_payments",
    )
    purchase_order = models.ForeignKey(
        PurchaseOrder,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    amount         = models.DecimalField(max_digits=15, decimal_places=2)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_METHOD_CHOICES, default="CASH")
    payment_date   = models.DateField()
    reference      = models.CharField(max_length=100, blank=True)
    notes          = models.TextField(blank=True)
    recorded_by    = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="purchase_payments_recorded",
    )
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table     = "purchases_purchase_payment"
        verbose_name = _("Purchase Payment")
        ordering     = ["-payment_date"]

    def __str__(self):
        return f"{self.purchase_order.po_number} — {self.amount} ({self.payment_method})"
