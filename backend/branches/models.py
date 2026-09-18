import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal


class Branch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="branches",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    is_head_office = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branches_branch"
        verbose_name = _("Branch")
        verbose_name_plural = _("Branches")
        unique_together = ("business", "code")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Warehouse(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="warehouses",
    )
    branch = models.ForeignKey(
        Branch,
        on_delete=models.CASCADE,
        related_name="warehouses",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)
    address = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branches_warehouse"
        verbose_name = _("Warehouse")
        verbose_name_plural = _("Warehouses")
        unique_together = ("business", "code")

    def __str__(self):
        return f"{self.name} ({self.code})"


class Register(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="registers",
    )
    branch = models.ForeignKey(
        Branch,
        on_delete=models.CASCADE,
        related_name="registers",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    is_active = models.BooleanField(default=True)
    last_opening_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    current_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branches_register"
        verbose_name = _("Register")
        verbose_name_plural = _("Registers")
        unique_together = ("business", "code")

    def __str__(self):
        return f"{self.name} ({self.code})"


class CashDrawer(models.Model):
    DRAWER_STATUS_CHOICES = (
        ("OPEN", _("Open")),
        ("CLOSED", _("Closed")),
        ("RECONCILED", _("Reconciled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cash_drawers",
    )
    branch = models.ForeignKey(
        Branch,
        on_delete=models.CASCADE,
        related_name="cash_drawers",
    )
    register = models.OneToOneField(
        Register,
        on_delete=models.CASCADE,
        related_name="cash_drawer",
        null=True,
        blank=True,
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=DRAWER_STATUS_CHOICES, default="CLOSED")
    opening_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    current_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    expected_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_sales_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_refunds_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_paid_in = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_paid_out = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    last_reconciled_at = models.DateTimeField(null=True, blank=True)
    last_reconciled_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reconciled_drawers",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branches_cash_drawer"
        verbose_name = _("Cash Drawer")
        verbose_name_plural = _("Cash Drawers")
        unique_together = ("business", "code")

    def __str__(self):
        return f"{self.name} ({self.code})"


class CashDrawerTransaction(models.Model):
    TRANSACTION_TYPE_CHOICES = (
        ("OPENING", _("Opening Balance")),
        ("SALE", _("Cash Sale")),
        ("REFUND", _("Cash Refund")),
        ("PAID_IN", _("Paid In")),
        ("PAID_OUT", _("Paid Out")),
        ("TRANSFER_IN", _("Transfer In")),
        ("TRANSFER_OUT", _("Transfer Out")),
        ("RECONCILIATION", _("Reconciliation Adjustment")),
        ("CLOSING", _("Closing")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cash_drawer_transactions",
    )
    cash_drawer = models.ForeignKey(
        CashDrawer,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    shift = models.ForeignKey(
        "branches.Shift",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cash_drawer_transactions",
    )
    transaction_type = models.CharField(max_length=30, choices=TRANSACTION_TYPE_CHOICES)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    balance_after = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    reference = models.CharField(max_length=255, blank=True)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cash_drawer_transactions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "branches_cash_drawer_transaction"
        verbose_name = _("Cash Drawer Transaction")
        verbose_name_plural = _("Cash Drawer Transactions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} - {self.amount}"


class Shift(models.Model):
    SHIFT_STATUS_CHOICES = (
        ("OPEN", _("Open")),
        ("CLOSED", _("Closed")),
        ("RECONCILED", _("Reconciled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="shifts",
    )
    branch = models.ForeignKey(
        Branch,
        on_delete=models.CASCADE,
        related_name="shifts",
    )
    register = models.ForeignKey(
        Register,
        on_delete=models.CASCADE,
        related_name="shifts",
    )
    cash_drawer = models.ForeignKey(
        CashDrawer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="shifts",
    )
    cashier = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="shifts",
    )
    shift_number = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=SHIFT_STATUS_CHOICES, default="OPEN")
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    reconciled_at = models.DateTimeField(null=True, blank=True)
    opening_cash = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    expected_cash = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    actual_cash = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_shortage = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_overage = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_sales = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_refunds = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_cash_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_card_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_mobile_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_credit_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    sales_count = models.IntegerField(default=0)
    refunds_count = models.IntegerField(default=0)
    no_sales_count = models.IntegerField(default=0)
    cash_paid_in = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    cash_paid_out = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    closed_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_shifts",
    )
    closing_notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "branches_shift"
        verbose_name = _("Shift")
        verbose_name_plural = _("Shifts")
        unique_together = ("business", "shift_number")
        ordering = ["-opened_at"]

    def __str__(self):
        return f"Shift {self.shift_number} - {self.cashier.username}"


class ShiftSummary(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="shift_summaries",
    )
    shift = models.OneToOneField(
        Shift,
        on_delete=models.CASCADE,
        related_name="summary",
    )
    payment_method_breakdown = models.JSONField(default=dict, blank=True)
    category_sales_breakdown = models.JSONField(default=dict, blank=True)
    product_sales_breakdown = models.JSONField(default=dict, blank=True)
    discount_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tax_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    tips_total = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    gross_profit_estimate = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    average_transaction_value = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    items_sold_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "branches_shift_summary"
        verbose_name = _("Shift Summary")
        verbose_name_plural = _("Shift Summaries")

    def __str__(self):
        return f"Summary for Shift {self.shift.shift_number}"
