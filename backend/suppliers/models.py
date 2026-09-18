import uuid
from decimal import Decimal
from django.db import models
from django.utils.translation import gettext_lazy as _


class Supplier(models.Model):
    SUPPLIER_TYPE_CHOICES = (
        ("MANUFACTURER", _("Manufacturer")),
        ("DISTRIBUTOR", _("Distributor")),
        ("WHOLESALER", _("Wholesaler")),
        ("IMPORTER", _("Importer")),
        ("LOCAL", _("Local")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="suppliers",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    supplier_type = models.CharField(
        max_length=30,
        choices=SUPPLIER_TYPE_CHOICES,
        default="LOCAL",
    )
    contact_person = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    tin = models.CharField(max_length=50, blank=True, verbose_name=_("Taxpayer Identification Number"))
    tax_number = models.CharField(max_length=50, blank=True)
    credit_limit = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    credit_days = models.IntegerField(default=0)
    payment_terms = models.TextField(blank=True)
    bank_name = models.CharField(max_length=255, blank=True)
    bank_account = models.CharField(max_length=100, blank=True)
    bank_branch = models.CharField(max_length=100, blank=True)
    bank_swift = models.CharField(max_length=20, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="suppliers_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers_supplier"
        verbose_name = _("Supplier")
        verbose_name_plural = _("Suppliers")
        unique_together = ("business", "code")
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class SupplierContact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.CASCADE,
        related_name="contacts",
    )
    name = models.CharField(max_length=255)
    position = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_primary = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers_supplier_contact"
        verbose_name = _("Supplier Contact")
        verbose_name_plural = _("Supplier Contacts")
        ordering = ["-is_primary", "name"]

    def __str__(self):
        return f"{self.name} - {self.supplier.name}"


class SupplierProductPrice(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.CASCADE,
        related_name="product_prices",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="supplier_prices",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="supplier_prices",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="supplier_product_prices",
    )
    supplier_sku = models.CharField(max_length=100, blank=True)
    unit_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    moq = models.IntegerField(default=1, verbose_name=_("Minimum Order Quantity"))
    lead_time_days = models.IntegerField(null=True, blank=True)
    currency = models.CharField(max_length=10, default="GHS")
    is_preferred = models.BooleanField(default=False)
    valid_from = models.DateField(null=True, blank=True)
    valid_to = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers_supplier_product_price"
        verbose_name = _("Supplier Product Price")
        verbose_name_plural = _("Supplier Product Prices")
        ordering = ["-is_preferred", "-created_at"]

    def __str__(self):
        return f"{self.supplier.name} - {self.product.name}: {self.unit_price} {self.currency}"


class SupplierBalance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="supplier_balances",
    )
    supplier = models.OneToOneField(
        Supplier,
        on_delete=models.CASCADE,
        related_name="balance",
    )
    total_purchases = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    total_paid = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    balance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    last_purchase_date = models.DateField(null=True, blank=True)
    last_payment_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers_supplier_balance"
        verbose_name = _("Supplier Balance")
        verbose_name_plural = _("Supplier Balances")
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.supplier.name}: Balance {self.balance}"


class SupplierTransaction(models.Model):
    TRANSACTION_TYPE_CHOICES = (
        ("INVOICE", _("Invoice")),
        ("PAYMENT", _("Payment")),
        ("CREDIT_NOTE", _("Credit Note")),
        ("DEBIT_NOTE", _("Debit Note")),
        ("REFUND", _("Refund")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="supplier_transactions",
    )
    supplier = models.ForeignKey(
        Supplier,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    type = models.CharField(max_length=30, choices=TRANSACTION_TYPE_CHOICES)
    reference = models.CharField(max_length=100, blank=True)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    balance_after = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    transaction_date = models.DateField()
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supplier_transactions_created",
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "suppliers_supplier_transaction"
        verbose_name = _("Supplier Transaction")
        verbose_name_plural = _("Supplier Transactions")
        ordering = ["-transaction_date", "-created_at"]

    def __str__(self):
        return f"{self.type} {self.amount:+} - {self.supplier.name}"
