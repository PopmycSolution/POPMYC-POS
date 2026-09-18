import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal
try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class CustomerGroup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="customer_groups",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    discount_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    price_list_code = models.CharField(max_length=100, blank=True)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_customer_group"
        verbose_name = _("Customer Group")
        verbose_name_plural = _("Customer Groups")
        unique_together = ("business", "code")

    def __str__(self):
        return self.name


class LoyaltyTier(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="loyalty_tiers",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    min_points = models.IntegerField(default=0)
    max_points = models.IntegerField(default=0)
    discount_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    points_multiplier = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("1.00"))
    price_list_code = models.CharField(max_length=100, blank=True, null=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_loyalty_tier"
        verbose_name = _("Loyalty Tier")
        verbose_name_plural = _("Loyalty Tiers")
        unique_together = ("business", "code")
        ordering = ["min_points"]

    def __str__(self):
        return self.name


class Customer(models.Model):
    GENDER_CHOICES = (
        ("MALE", _("Male")),
        ("FEMALE", _("Female")),
        ("OTHER", _("Other")),
        ("NA", _("N/A")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="customers",
    )
    customer_group = models.ForeignKey(
        CustomerGroup,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customers",
    )
    tier = models.ForeignKey(
        LoyaltyTier,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customers",
    )
    customer_number = models.CharField(max_length=50, blank=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    company_name = models.CharField(max_length=255, blank=True)
    # phone is no longer globally unique — two businesses can share the same phone number.
    # Uniqueness is enforced per-business via the unique_together constraint below.
    phone = models.CharField(max_length=20, db_index=True)
    phone2 = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True, default="Ghana")
    tin = models.CharField(max_length=50, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, choices=GENDER_CHOICES, default="NA")
    notes = models.TextField(blank=True)
    credit_limit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    current_credit_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_credit_used = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    loyalty_points_balance = models.IntegerField(default=0)
    loyalty_total_earned = models.IntegerField(default=0)
    loyalty_total_redeemed = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_customers",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_customer"
        verbose_name = _("Customer")
        verbose_name_plural = _("Customers")
        ordering = ["-created_at"]
        # Enforce uniqueness per business — two different businesses can have
        # the same customer phone number without conflict.
        unique_together = ("business", "phone")

    def __str__(self):
        name = f"{self.first_name} {self.last_name}".strip()
        return name or self.company_name or self.phone


class CustomerContact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="contacts",
    )
    name = models.CharField(max_length=255)
    relationship = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_customer_contact"
        verbose_name = _("Customer Contact")
        verbose_name_plural = _("Customer Contacts")

    def __str__(self):
        return f"{self.name} - {self.customer}"


class CustomerCredit(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="customer_credits",
    )
    customer = models.OneToOneField(
        Customer,
        on_delete=models.CASCADE,
        related_name="credit",
    )
    available_credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    used_credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_purchases_on_credit = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_paid = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    last_credit_date = models.DateTimeField(null=True, blank=True)
    last_payment_date = models.DateTimeField(null=True, blank=True)
    credit_utilization_pct = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_customer_credit"
        verbose_name = _("Customer Credit")
        verbose_name_plural = _("Customer Credits")

    def __str__(self):
        return f"Credit for {self.customer}"


class CustomerCreditTransaction(models.Model):
    TXN_TYPE_CHOICES = (
        ("CREDIT_SALE", _("Credit Sale")),
        ("PAYMENT", _("Payment")),
        ("CREDIT_LIMIT_ADJUSTMENT", _("Credit Limit Adjustment")),
        ("INTEREST", _("Interest")),
        ("WRITEOFF", _("Write-off")),
        ("CREDIT_NOTE", _("Credit Note")),
        ("REFUND", _("Refund")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="credit_transactions",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="credit_transactions",
    )
    credit = models.ForeignKey(
        CustomerCredit,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    type = models.CharField(max_length=30, choices=TXN_TYPE_CHOICES)
    reference = models.CharField(max_length=255, blank=True)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    balance_after = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    due_date = models.DateField(null=True, blank=True)
    transaction_date = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="credit_transactions",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "customers_customer_credit_transaction"
        verbose_name = _("Customer Credit Transaction")
        verbose_name_plural = _("Customer Credit Transactions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.type} - {self.amount} ({self.customer})"


class CustomerStatement(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="customer_statements",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="statements",
    )
    statement_date = models.DateField()
    period_start = models.DateField()
    period_end = models.DateField()
    opening_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    closing_balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_charges = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    total_payments = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    pdf_file = models.FileField(upload_to="customer_statements/", null=True, blank=True)
    generated_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="generated_statements",
    )
    is_sent = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "customers_customer_statement"
        verbose_name = _("Customer Statement")
        verbose_name_plural = _("Customer Statements")
        ordering = ["-statement_date"]

    def __str__(self):
        return f"Statement {self.statement_date} for {self.customer}"


class LoyaltyTransaction(models.Model):
    TXN_TYPE_CHOICES = (
        ("EARN", _("Earn")),
        ("REDEEM", _("Redeem")),
        ("EXPIRE", _("Expire")),
        ("TRANSFER", _("Transfer")),
        ("BONUS", _("Bonus")),
        ("ADJUSTMENT", _("Adjustment")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="loyalty_transactions",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="loyalty_transactions",
    )
    type = models.CharField(max_length=20, choices=TXN_TYPE_CHOICES)
    points = models.IntegerField(default=0)
    balance_after = models.IntegerField(default=0)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    reason = models.TextField(blank=True)
    transaction_date = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loyalty_transactions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "customers_loyalty_transaction"
        verbose_name = _("Loyalty Transaction")
        verbose_name_plural = _("Loyalty Transactions")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.type} {self.points} pts - {self.customer}"


class CustomerLoyaltyCard(models.Model):
    CARD_STATUS_CHOICES = (
        ("ACTIVE", _("Active")),
        ("BLOCKED", _("Blocked")),
        ("EXPIRED", _("Expired")),
        ("PENDING", _("Pending")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="loyalty_cards",
    )
    customer = models.OneToOneField(
        Customer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="loyalty_card",
    )
    card_number = models.CharField(max_length=50, unique=True)
    card_status = models.CharField(max_length=20, choices=CARD_STATUS_CHOICES, default="PENDING")
    issued_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_customer_loyalty_card"
        verbose_name = _("Customer Loyalty Card")
        verbose_name_plural = _("Customer Loyalty Cards")

    def __str__(self):
        return f"Card {self.card_number} - {self.card_status}"


class SaleOnAccount(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("PARTIAL", _("Partial")),
        ("PAID", _("Paid")),
        ("OVERDUE", _("Overdue")),
        ("WRITTEN_OFF", _("Written Off")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="sales_on_account",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="sales_on_account",
    )
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="account_sales",
    )
    invoice_number = models.CharField(max_length=50)
    total_amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    amount_paid = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    balance = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="PENDING")
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_sales_on_account",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customers_sale_on_account"
        verbose_name = _("Sale on Account")
        verbose_name_plural = _("Sales on Account")
        unique_together = ("business", "invoice_number")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.invoice_number} - {self.customer}"


class SaleOnAccountPayment(models.Model):
    PAYMENT_METHOD_CHOICES = (
        ("CASH", _("Cash")),
        ("MTN_MOMO", _("MTN Mobile Money")),
        ("TELECEL_CASH", _("Telecel Cash")),
        ("AT_MONEY", _("AirtelTigo Money")),
        ("CARD", _("Card")),
        ("BANK_TRANSFER", _("Bank Transfer")),
        ("CREDIT", _("Credit")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    credit_sale = models.ForeignKey(
        SaleOnAccount,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        related_name="account_payments",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="account_payments",
    )
    amount = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal("0.00"))
    payment_method = models.CharField(max_length=30, choices=PAYMENT_METHOD_CHOICES)
    reference = models.CharField(max_length=255, blank=True)
    transaction_date = models.DateTimeField(auto_now_add=True)
    received_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="received_account_payments",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "customers_sale_on_account_payment"
        verbose_name = _("Sale on Account Payment")
        verbose_name_plural = _("Sales on Account Payments")
        ordering = ["-created_at"]

    def __str__(self):
        return f"Payment {self.amount} for {self.credit_sale.invoice_number}"
