import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal
from django.core.exceptions import ValidationError


class Account(models.Model):
    ACCOUNT_TYPE_CHOICES = (
        ("ASSET", _("Asset")),
        ("LIABILITY", _("Liability")),
        ("EQUITY", _("Equity")),
        ("REVENUE", _("Revenue")),
        ("EXPENSE", _("Expense")),
    )

    NORMAL_BALANCE_CHOICES = (
        ("DEBIT", _("Debit")),
        ("CREDIT", _("Credit")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="accounts",
    )
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES)
    account_code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    parent = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="children",
    )
    level = models.IntegerField(default=1)
    is_contra = models.BooleanField(default=False)
    is_control_account = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    normal_balance = models.CharField(
        max_length=10,
        choices=NORMAL_BALANCE_CHOICES,
        default="DEBIT",
    )
    opening_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    opening_balance_date = models.DateField(null=True, blank=True)
    current_balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    last_activity_date = models.DateField(null=True, blank=True)
    sort_order = models.IntegerField(default=0)
    is_cash_account = models.BooleanField(default=False)
    is_bank_account = models.BooleanField(default=False)
    bank_name = models.CharField(max_length=255, blank=True)
    bank_account_number = models.CharField(max_length=50, blank=True)
    bank_branch = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_accounts",
    )
    tax_relevant = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounting_account"
        verbose_name = _("Account")
        verbose_name_plural = _("Accounts")
        unique_together = ("business", "account_code")
        ordering = ["sort_order", "account_code"]

    def __str__(self):
        return f"{self.account_code} - {self.name}"


class FiscalPeriod(models.Model):
    PERIOD_TYPE_CHOICES = (
        ("MONTH", _("Month")),
        ("QUARTER", _("Quarter")),
        ("YEAR", _("Year")),
    )

    STATUS_CHOICES = (
        ("OPEN", _("Open")),
        ("CLOSED", _("Closed")),
        ("ADJUSTMENTS", _("Adjustments")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="fiscal_periods",
    )
    name = models.CharField(max_length=255)
    period_type = models.CharField(max_length=20, choices=PERIOD_TYPE_CHOICES)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="OPEN")
    is_closed = models.BooleanField(default=False)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_periods",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounting_fiscal_period"
        verbose_name = _("Fiscal Period")
        verbose_name_plural = _("Fiscal Periods")
        ordering = ["-start_date"]

    def __str__(self):
        return f"{self.name} ({self.start_date} to {self.end_date})"


class JournalEntry(models.Model):
    SOURCE_MODULE_CHOICES = (
        ("MANUAL", _("Manual")),
        ("SALES", _("Sales")),
        ("PURCHASES", _("Purchases")),
        ("EXPENSES", _("Expenses")),
        ("PAYROLL", _("Payroll")),
        ("BANK", _("Bank")),
        ("INVENTORY", _("Inventory")),
        ("TAXES", _("Taxes")),
    )

    STATUS_CHOICES = (
        ("DRAFT", _("Draft")),
        ("POSTED", _("Posted")),
        ("VOIDED", _("Voided")),
        ("REVERSED", _("Reversed")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="journal_entries",
    )
    entry_number = models.CharField(max_length=50, unique=True)
    entry_date = models.DateField()
    reference = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    source_module = models.CharField(
        max_length=20,
        choices=SOURCE_MODULE_CHOICES,
        default="MANUAL",
    )
    source_document_type = models.CharField(max_length=100, blank=True)
    source_document_id = models.UUIDField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="DRAFT")
    total_debits = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_credits = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    is_adjusting = models.BooleanField(default=False)
    is_closing = models.BooleanField(default=False)
    fiscal_period = models.ForeignKey(
        FiscalPeriod,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_entries",
    )
    posted_at = models.DateTimeField(null=True, blank=True)
    posted_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="posted_journal_entries",
    )
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_journal_entries",
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="voided_journal_entries",
    )
    reversal_of = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reversals",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "accounting_journal_entry"
        verbose_name = _("Journal Entry")
        verbose_name_plural = _("Journal Entries")
        ordering = ["-entry_date", "-created_at"]

    def __str__(self):
        return f"{self.entry_number} - {self.entry_date}"

    def clean(self):
        super().clean()
        lines = getattr(self, "lines", None)
        if lines and lines.exists():
            total_debit = sum(line.debit_amount for line in lines.all())
            total_credit = sum(line.credit_amount for line in lines.all())
            if total_debit != total_credit:
                raise ValidationError(
                    f"Journal entry must balance. Debits: {total_debit}, Credits: {total_credit}"
                )


class JournalEntryLine(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="journal_entry_lines",
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="journal_entry_lines",
    )
    line_description = models.CharField(max_length=255, blank=True)
    debit_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    credit_amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    cost_center = models.CharField(max_length=100, blank=True)
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="journal_entry_lines",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounting_journal_entry_line"
        verbose_name = _("Journal Entry Line")
        verbose_name_plural = _("Journal Entry Lines")
        ordering = ["id"]

    def __str__(self):
        return f"{self.account} - Dr: {self.debit_amount} Cr: {self.credit_amount}"


class FinancialTransaction(models.Model):
    TRANSACTION_TYPE_CHOICES = (
        ("SALE", _("Sale")),
        ("PURCHASE", _("Purchase")),
        ("PAYMENT", _("Payment")),
        ("REFUND", _("Refund")),
        ("EXPENSE", _("Expense")),
        ("TRANSFER", _("Transfer")),
        ("ADJUSTMENT", _("Adjustment")),
        ("INVOICE", _("Invoice")),
        ("BILL", _("Bill")),
    )

    DIRECTION_CHOICES = (
        ("DEBIT", _("Debit")),
        ("CREDIT", _("Credit")),
    )

    COUNTERPARTY_TYPE_CHOICES = (
        ("CUSTOMER", _("Customer")),
        ("SUPPLIER", _("Supplier")),
        ("INTERNAL", _("Internal")),
        ("OTHER", _("Other")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="financial_transactions",
    )
    transaction_type = models.CharField(max_length=20, choices=TRANSACTION_TYPE_CHOICES)
    direction = models.CharField(max_length=10, choices=DIRECTION_CHOICES)
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name="financial_transactions",
    )
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    reference = models.CharField(max_length=255, blank=True)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    transaction_date = models.DateTimeField()
    description = models.TextField(blank=True)
    counterparty_type = models.CharField(
        max_length=20,
        choices=COUNTERPARTY_TYPE_CHOICES,
        default="OTHER",
    )
    counterparty_id = models.UUIDField(null=True, blank=True)
    currency = models.CharField(max_length=10, default="GHS")
    exchange_rate = models.DecimalField(
        max_digits=15,
        decimal_places=6,
        default=Decimal("1.000000"),
    )
    journal_entry = models.ForeignKey(
        JournalEntry,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_transactions",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="financial_transactions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "accounting_financial_transaction"
        verbose_name = _("Financial Transaction")
        verbose_name_plural = _("Financial Transactions")
        ordering = ["-transaction_date", "-created_at"]

    def __str__(self):
        return f"{self.transaction_type} - {self.account} - {self.amount}"
