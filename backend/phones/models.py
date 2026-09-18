import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal
from django.core.exceptions import ValidationError

try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


def validate_luhn_checksum(value):
    if not value or not value.isdigit():
        return
    digits = [int(d) for d in str(value)]
    check_digit = digits.pop()
    digits.reverse()
    total = 0
    for i, d in enumerate(digits):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    calculated = (10 - (total % 10)) % 10
    if calculated != check_digit:
        raise ValidationError(_("IMEI failed Luhn checksum validation."))


class PhoneBrand(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_brands",
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=50)
    country = models.CharField(max_length=100, blank=True)
    logo = models.ImageField(upload_to="phone_brands/", null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phones_phone_brand"
        verbose_name = _("Phone Brand")
        verbose_name_plural = _("Phone Brands")
        unique_together = ("business", "code")
        ordering = ["name"]

    def __str__(self):
        return self.name


class PhoneModel(models.Model):
    SIM_TYPE_CHOICES = (
        ("SINGLE_SIM", _("Single SIM")),
        ("DUAL_SIM", _("Dual SIM")),
        ("ESIM", _("eSIM")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_models",
    )
    brand = models.ForeignKey(
        PhoneBrand,
        on_delete=models.CASCADE,
        related_name="models",
    )
    product = models.OneToOneField(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="phone_model",
        null=True,
        blank=True,
    )
    model_name = models.CharField(max_length=255)
    model_code = models.CharField(max_length=50)
    release_year = models.IntegerField(null=True, blank=True)
    operating_system = models.CharField(max_length=100, blank=True)
    os_version = models.CharField(max_length=50, blank=True)
    processor = models.CharField(max_length=255, blank=True)
    ram_gb = models.DecimalField(
        max_digits=6,
        decimal_places=1,
        default=Decimal("0.0"),
    )
    storage_gb = models.IntegerField(default=0)
    battery_mah = models.IntegerField(default=0)
    screen_size_inch = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    display_type = models.CharField(max_length=100, blank=True)
    resolution = models.CharField(max_length=50, blank=True)
    camera_spec = JSONField(default=dict, blank=True)
    connectivity = JSONField(default=dict, blank=True)
    sim_type = models.CharField(
        max_length=20,
        choices=SIM_TYPE_CHOICES,
        default="DUAL_SIM",
    )
    has_5g = models.BooleanField(default=False)
    body_dimensions = models.CharField(max_length=100, blank=True)
    weight_g = models.IntegerField(null=True, blank=True)
    colors = JSONField(default=list, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phones_phone_model"
        verbose_name = _("Phone Model")
        verbose_name_plural = _("Phone Models")
        unique_together = ("business", "model_code")
        ordering = ["brand__name", "model_name"]

    def __str__(self):
        return f"{self.brand.name} {self.model_name}"


class PhoneVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_variants",
    )
    phone_model = models.ForeignKey(
        PhoneModel,
        on_delete=models.CASCADE,
        related_name="variants",
    )
    product_variant = models.OneToOneField(
        "products.ProductVariant",
        on_delete=models.CASCADE,
        related_name="phone_variant",
        null=True,
        blank=True,
    )
    color = models.CharField(max_length=50, blank=True)
    storage_gb = models.IntegerField(default=0)
    ram_gb = models.DecimalField(
        max_digits=6,
        decimal_places=1,
        default=Decimal("0.0"),
    )
    sku_suffix = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phones_phone_variant"
        verbose_name = _("Phone Variant")
        verbose_name_plural = _("Phone Variants")

    def __str__(self):
        return f"{self.phone_model} - {self.color} {self.storage_gb}GB"


class PhoneIMEI(models.Model):
    SIM_LOCK_STATUS_CHOICES = (
        ("UNLOCKED", _("Unlocked")),
        ("CARRIER_LOCKED", _("Carrier Locked")),
        ("ICLOUD_LOCKED", _("iCloud Locked")),
        ("BLACKLISTED", _("Blacklisted")),
        ("UNKNOWN", _("Unknown")),
    )

    GRADE_CONDITION_CHOICES = (
        ("NEW", _("New")),
        ("OPEN_BOX", _("Open Box")),
        ("A_GRADE", _("A Grade")),
        ("B_GRADE", _("B Grade")),
        ("C_GRADE", _("C Grade")),
        ("DAMAGED", _("Damaged")),
        ("REFURBISHED", _("Refurbished")),
    )

    STATUS_CHOICES = (
        ("INSTOCK", _("In Stock")),
        ("RESERVED", _("Reserved")),
        ("SOLD", _("Sold")),
        ("RETURNED", _("Returned")),
        ("REPAIR_IN", _("Repair In")),
        ("REPAIR_OUT", _("Repair Out")),
        ("LOST", _("Lost")),
        ("STOLEN", _("Stolen")),
        ("WRITE_OFF", _("Write Off")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_imeis",
    )
    phone_model = models.ForeignKey(
        PhoneModel,
        on_delete=models.CASCADE,
        related_name="imeis",
    )
    phone_variant = models.ForeignKey(
        PhoneVariant,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="imeis",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="phone_imeis",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_imeis",
    )
    imei_1 = models.CharField(max_length=15, unique=True, validators=[validate_luhn_checksum])
    imei_2 = models.CharField(
        max_length=15,
        unique=True,
        null=True,
        blank=True,
        validators=[validate_luhn_checksum],
    )
    serial_number = models.CharField(max_length=100, unique=True)
    sim_lock_status = models.CharField(
        max_length=20,
        choices=SIM_LOCK_STATUS_CHOICES,
        default="UNKNOWN",
    )
    carrier = models.CharField(max_length=100, blank=True)
    grade_condition = models.CharField(
        max_length=20,
        choices=GRADE_CONDITION_CHOICES,
        default="NEW",
    )
    purchase_date = models.DateField(null=True, blank=True)
    supplier = models.ForeignKey(
        "suppliers.Supplier",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_imeis",
    )
    purchase_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    sale_price = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    warranty_months = models.IntegerField(default=12)
    warranty_expiry_date = models.DateField(null=True, blank=True)
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="phone_imeis",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="phone_imeis",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="INSTOCK",
    )
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_imeis",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_imeis",
    )
    last_status_change = models.DateTimeField(null=True, blank=True)
    physical_condition_notes = models.TextField(blank=True)
    accessories = JSONField(default=list, blank=True)
    box_included = models.BooleanField(default=False)
    charger_included = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_phone_imeis",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phones_phone_imei"
        verbose_name = _("Phone IMEI")
        verbose_name_plural = _("Phone IMEIs")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.phone_model} - {self.imei_1}"

    def clean(self):
        super().clean()
        validate_luhn_checksum(self.imei_1)
        if self.imei_2:
            validate_luhn_checksum(self.imei_2)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class PhoneWarranty(models.Model):
    WARRANTY_TYPE_CHOICES = (
        ("MANUFACTURER", _("Manufacturer")),
        ("EXTENDED", _("Extended")),
        ("STORE", _("Store")),
    )

    STATUS_CHOICES = (
        ("ACTIVE", _("Active")),
        ("EXPIRED", _("Expired")),
        ("VOIDED", _("Voided")),
        ("CLAIMED", _("Claimed")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_warranties",
    )
    imei = models.OneToOneField(
        PhoneIMEI,
        on_delete=models.CASCADE,
        related_name="warranty",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="phone_warranties",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.CASCADE,
        related_name="phone_warranties",
    )
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.CASCADE,
        related_name="phone_warranties",
    )
    warranty_number = models.CharField(max_length=50, unique=True)
    start_date = models.DateField()
    end_date = models.DateField()
    warranty_type = models.CharField(
        max_length=20,
        choices=WARRANTY_TYPE_CHOICES,
        default="MANUFACTURER",
    )
    terms = models.TextField(blank=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="ACTIVE",
    )
    claim_count = models.IntegerField(default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "phones_phone_warranty"
        verbose_name = _("Phone Warranty")
        verbose_name_plural = _("Phone Warranties")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.warranty_number} - {self.imei.imei_1}"


class PhoneHistory(models.Model):
    EVENT_TYPE_CHOICES = (
        ("PURCHASED", _("Purchased")),
        ("RECEIVED_STOCK", _("Received Stock")),
        ("RESERVED", _("Reserved")),
        ("SOLD", _("Sold")),
        ("RETURNED", _("Returned")),
        ("REPAIRED", _("Repaired")),
        ("LOST", _("Lost")),
        ("FOUND", _("Found")),
        ("STOLEN", _("Stolen")),
        ("RECOVERED", _("Recovered")),
        ("WRITTEN_OFF", _("Written Off")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="phone_history",
    )
    imei = models.ForeignKey(
        PhoneIMEI,
        on_delete=models.CASCADE,
        related_name="history",
    )
    status_from = models.CharField(max_length=20, blank=True)
    status_to = models.CharField(max_length=20, blank=True)
    event_type = models.CharField(
        max_length=20,
        choices=EVENT_TYPE_CHOICES,
    )
    notes = models.TextField(blank=True)
    reference_type = models.CharField(max_length=100, blank=True)
    reference_id = models.UUIDField(null=True, blank=True)
    event_date = models.DateTimeField(auto_now_add=True)
    done_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="phone_history",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "phones_phone_history"
        verbose_name = _("Phone History")
        verbose_name_plural = _("Phone Histories")
        ordering = ["-event_date"]

    def __str__(self):
        return f"{self.imei.imei_1} - {self.event_type}"
