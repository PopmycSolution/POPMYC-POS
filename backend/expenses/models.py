import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal


class ExpenseCategory(models.Model):
    TYPE_CHOICES = (
        ("OPERATING", _("Operating")),
        ("COGS", _("Cost of Goods Sold")),
        ("CAPEX", _("Capital Expenditure")),
        ("TAX", _("Tax")),
        ("OTHER", _("Other")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="expense_categories",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="OPERATING")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "expenses_expense_category"
        verbose_name = _("Expense Category")
        verbose_name_plural = _("Expense Categories")
        unique_together = ("business", "code")
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Expense(models.Model):
    PAYMENT_METHOD_CHOICES = (
        ("CASH", _("Cash")),
        ("MTN_MOMO", _("MTN Momo")),
        ("TELECEL_CASH", _("Telecel Cash")),
        ("AT_MONEY", _("AT Money")),
        ("CARD", _("Card")),
        ("BANK_TRANSFER", _("Bank Transfer")),
        ("CHEQUE", _("Cheque")),
        ("CREDIT", _("Credit")),
    )

    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("APPROVED", _("Approved")),
        ("PAID", _("Paid")),
        ("REJECTED", _("Rejected")),
        ("CANCELLED", _("Cancelled")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="expenses",
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.CASCADE,
        related_name="expenses",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="expenses",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    expense_date = models.DateField()
    reference_number = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    tax_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default="CASH",
    )
    cash_account = models.ForeignKey(
        "accounting.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="cash_expenses",
    )
    bank_account = models.ForeignKey(
        "accounting.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_expenses",
    )
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    receipt_number = models.CharField(max_length=100, blank=True)
    receipt_image = models.ImageField(upload_to="expense_receipts/", null=True, blank=True)
    is_tax_deductible = models.BooleanField(default=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    approved_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_expenses",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="paid_expenses",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_expenses",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "expenses_expense"
        verbose_name = _("Expense")
        verbose_name_plural = _("Expenses")
        ordering = ["-expense_date", "-created_at"]

    def __str__(self):
        return f"{self.reference_number or self.id} - {self.total_amount}"


class RecurringExpense(models.Model):
    FREQUENCY_CHOICES = (
        ("DAILY", _("Daily")),
        ("WEEKLY", _("Weekly")),
        ("MONTHLY", _("Monthly")),
        ("QUARTERLY", _("Quarterly")),
        ("YEARLY", _("Yearly")),
    )

    PAYMENT_METHOD_CHOICES = (
        ("CASH", _("Cash")),
        ("MTN_MOMO", _("MTN Momo")),
        ("TELECEL_CASH", _("Telecel Cash")),
        ("AT_MONEY", _("AT Money")),
        ("CARD", _("Card")),
        ("BANK_TRANSFER", _("Bank Transfer")),
        ("CHEQUE", _("Cheque")),
        ("CREDIT", _("Credit")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="recurring_expenses",
    )
    category = models.ForeignKey(
        ExpenseCategory,
        on_delete=models.CASCADE,
        related_name="recurring_expenses",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="recurring_expenses",
    )
    description = models.TextField(blank=True)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    tax_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    frequency = models.CharField(
        max_length=20,
        choices=FREQUENCY_CHOICES,
        default="MONTHLY",
    )
    day_of_month = models.IntegerField(null=True, blank=True)
    next_run_date = models.DateField()
    last_run_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    payment_method = models.CharField(
        max_length=20,
        choices=PAYMENT_METHOD_CHOICES,
        default="CASH",
    )
    cash_account = models.ForeignKey(
        "accounting.Account",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recurring_expenses",
    )
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_recurring_expenses",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "expenses_recurring_expense"
        verbose_name = _("Recurring Expense")
        verbose_name_plural = _("Recurring Expenses")
        ordering = ["-next_run_date"]

    def __str__(self):
        return f"{self.description} - {self.frequency}"


class ExpenseApproval(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("APPROVED", _("Approved")),
        ("REJECTED", _("Rejected")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    expense = models.ForeignKey(
        Expense,
        on_delete=models.CASCADE,
        related_name="approvals",
    )
    approver = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="expense_approvals",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    approval_level = models.IntegerField(default=1)
    comment = models.TextField(blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "expenses_expense_approval"
        verbose_name = _("Expense Approval")
        verbose_name_plural = _("Expense Approvals")
        ordering = ["approval_level", "-created_at"]

    def __str__(self):
        return f"{self.expense} - {self.approver} - {self.status}"
