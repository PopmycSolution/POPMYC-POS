import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class Business(models.Model):
    # ── Legacy choices kept for backwards-compat (used by old data) ────────────
    LEGACY_BUSINESS_TYPE_CHOICES = (
        ("supermarket", _("Supermarket")),
        ("pharmacy", _("Pharmacy")),
        ("phone_shop", _("Phone Shop")),
        ("electronics", _("Electronics")),
        ("boutique", _("Boutique")),
        ("cosmetics", _("Cosmetics")),
        ("restaurant", _("Restaurant")),
        ("wholesale", _("Wholesale")),
        ("general", _("General")),
    )

    # ── New stable machine-readable choices ────────────────────────────────────
    class BusinessCategory(models.TextChoices):
        PROVISION_GROCERY  = "PROVISION_GROCERY",  _("Provision / Grocery")
        SUPERMARKET        = "SUPERMARKET",         _("Supermarket")
        GENERAL_RETAIL     = "GENERAL_RETAIL",      _("General Retail")
        COSMETICS          = "COSMETICS",           _("Cosmetics")
        PHARMACY           = "PHARMACY",            _("Pharmacy")
        ELECTRONICS        = "ELECTRONICS",         _("Electronics")
        PHONE_ACCESSORIES  = "PHONE_ACCESSORIES",   _("Phone & Accessories")
        FASHION_CLOTHING   = "FASHION_CLOTHING",    _("Fashion / Clothing")
        SHOES              = "SHOES",               _("Shoes")
        SERVICE            = "SERVICE",             _("Service")
        OTHER              = "OTHER",               _("Other")

    # Business types that support negotiable pricing (product-level opt-in)
    NEGOTIABLE_BUSINESS_TYPES = frozenset({
        BusinessCategory.PHONE_ACCESSORIES,
        BusinessCategory.FASHION_CLOTHING,
        BusinessCategory.SHOES,
    })

    SUBSCRIPTION_TIER_CHOICES = (
        ("free",       _("Free")),
        ("starter",    _("Starter")),
        ("pro",        _("Pro")),
        ("enterprise", _("Enterprise")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)

    # ── business_type: old free-form field kept for legacy data ───────────────
    # Use business_category for new logic.
    business_type = models.CharField(max_length=50, default="general", blank=True)

    # ── business_category: the new stable typed field ─────────────────────────
    business_category = models.CharField(
        max_length=30,
        choices=BusinessCategory.choices,
        default=BusinessCategory.GENERAL_RETAIL,
        verbose_name=_("Business Category"),
        help_text=_("The type of business — controls default pricing behaviour."),
    )

    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    tin = models.CharField(max_length=50, blank=True, verbose_name=_("Taxpayer Identification Number"))
    logo = models.ImageField(upload_to="business_logos/", null=True, blank=True)
    currency = models.CharField(max_length=10, default="GHS")
    currency_symbol = models.CharField(max_length=10, default="GH₵")

    owner = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_businesses",
        verbose_name=_("Business Owner"),
    )

    subscription_tier = models.CharField(
        max_length=20,
        choices=SUBSCRIPTION_TIER_CHOICES,
        default="free",
        verbose_name=_("Subscription Tier"),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "businesses_business"
        verbose_name = _("Business")
        verbose_name_plural = _("Businesses")
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    # ── Helpers ────────────────────────────────────────────────────────────────

    @property
    def supports_negotiable_pricing(self) -> bool:
        """True when this business type allows products to be marked NEGOTIABLE."""
        return self.business_category in self.NEGOTIABLE_BUSINESS_TYPES

    @property
    def stock_enabled(self) -> bool:
        """True when this business tracks stock quantities (inventory management is active)."""
        try:
            return self.settings.inventory_enabled
        except Exception:
            return True  # safe default: enable stock if settings row doesn't exist yet


class BusinessSettings(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.OneToOneField(
        Business,
        on_delete=models.CASCADE,
        related_name="settings",
    )
    tax_config = JSONField(default=dict, blank=True)
    receipt_config = JSONField(default=dict, blank=True)
    inventory_config = JSONField(default=dict, blank=True)

    # ── Pricing config ─────────────────────────────────────────────────────────
    allow_cashier_price_negotiation = models.BooleanField(
        default=False,
        verbose_name=_("Allow Cashier Price Negotiation"),
        help_text=_(
            "When True, Cashiers can finalise a negotiated (customer-agreed) price "
            "at the POS without manager approval. "
            "Admins and Managers can always negotiate regardless of this setting."
        ),
    )

    # ── Branch mode ────────────────────────────────────────────────────────────
    class BranchMode(models.TextChoices):
        SINGLE = "SINGLE", _("Single Branch")
        MULTI  = "MULTI",  _("Multiple Branches")

    branch_mode = models.CharField(
        max_length=10,
        choices=BranchMode.choices,
        default=BranchMode.SINGLE,
        verbose_name=_("Branch Mode"),
        help_text=_(
            "SINGLE: business has one fixed location — branch management is hidden. "
            "MULTI: business has multiple locations — branch management is enabled."
        ),
    )

    # ── Inventory / Operating mode ─────────────────────────────────────────────
    class InventoryMode(models.TextChoices):
        # ── New three-way operating modes ─────────────────────────────────────
        FULL_POS         = "FULL_POS",        _("Full POS + Inventory")
        INVENTORY_ONLY   = "INVENTORY_ONLY",  _("Inventory / Stock Only")
        POS_ONLY         = "POS_ONLY",        _("POS Only")
        # ── Legacy two-way values (kept for data compatibility) ───────────────
        # Existing rows with STOCK_ENABLED are treated as FULL_POS.
        # Existing rows with SALES_ONLY are treated as POS_ONLY.
        STOCK_ENABLED    = "STOCK_ENABLED",   _("Stock Enabled (legacy)")
        SALES_ONLY       = "SALES_ONLY",      _("Sales Only (legacy)")

    inventory_mode = models.CharField(
        max_length=20,
        choices=InventoryMode.choices,
        default=InventoryMode.FULL_POS,
        verbose_name=_("Operating Mode"),
        help_text=_(
            "FULL_POS: full POS checkout + inventory management. "
            "INVENTORY_ONLY: stock/inventory management only — new sales are blocked. "
            "POS_ONLY: sales/checkout only — inventory workflows are hidden. "
            "Legacy values STOCK_ENABLED and SALES_ONLY are mapped to FULL_POS and POS_ONLY."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "businesses_settings"
        verbose_name = _("Business Settings")
        verbose_name_plural = _("Business Settings")

    def __str__(self):
        return f"Settings for {self.business.name}"

    # ── Operating mode helpers ─────────────────────────────────────────────────

    _LEGACY_MAP = {
        "STOCK_ENABLED": "FULL_POS",
        "SALES_ONLY":    "POS_ONLY",
    }

    @property
    def effective_operating_mode(self) -> str:
        """
        Returns the canonical three-way operating mode, mapping legacy values:
          STOCK_ENABLED → FULL_POS
          SALES_ONLY    → POS_ONLY
        """
        return self._LEGACY_MAP.get(self.inventory_mode, self.inventory_mode)

    @property
    def pos_enabled(self) -> bool:
        """True when the business is allowed to create POS sales."""
        return self.effective_operating_mode in ("FULL_POS", "POS_ONLY")

    @property
    def inventory_enabled(self) -> bool:
        """True when inventory/stock management features are available."""
        return self.effective_operating_mode in ("FULL_POS", "INVENTORY_ONLY")

    @property
    def is_full_pos(self) -> bool:
        return self.effective_operating_mode == "FULL_POS"

    @property
    def is_inventory_only(self) -> bool:
        return self.effective_operating_mode == "INVENTORY_ONLY"

    @property
    def is_pos_only(self) -> bool:
        return self.effective_operating_mode == "POS_ONLY"
