import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal

try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class Medicine(models.Model):
    DOSAGE_FORM_CHOICES = (
        ("TABLET", _("Tablet")),
        ("CAPSULE", _("Capsule")),
        ("SYRUP", _("Syrup")),
        ("INJECTION", _("Injection")),
        ("CREAM", _("Cream")),
        ("DROP", _("Drop")),
        ("INHALER", _("Inhaler")),
        ("SUPPOSITORY", _("Suppository")),
        ("PATCH", _("Patch")),
        ("OTHER", _("Other")),
    )

    ADMINISTRATION_ROUTE_CHOICES = (
        ("ORAL", _("Oral")),
        ("IV", _("Intravenous")),
        ("IM", _("Intramuscular")),
        ("SC", _("Subcutaneous")),
        ("OPHTHALMIC", _("Ophthalmic")),
        ("OTIC", _("Otic")),
        ("TOPICAL", _("Topical")),
        ("RECTAL", _("Rectal")),
        ("VAGINAL", _("Vaginal")),
        ("INHALATION", _("Inhalation")),
        ("OTHER", _("Other")),
    )

    DRUG_CLASS_CHOICES = (
        ("ANTIBIOTIC", _("Antibiotic")),
        ("ANALGESIC", _("Analgesic")),
        ("ANTI_HYPERTENSIVE", _("Anti-Hypertensive")),
        ("ANTI_DIABETIC", _("Anti-Diabetic")),
        ("ANTIHISTAMINE", _("Antihistamine")),
        ("NSAID", _("NSAID")),
        ("PPI", _("PPI")),
        ("STATIN", _("Statin")),
        ("CORTICOSTEROID", _("Corticosteroid")),
        ("BRONCHODILATOR", _("Bronchodilator")),
        ("OTHER", _("Other")),
    )

    SCHEDULE_CHOICES = (
        ("OTC", _("OTC")),
        ("SCHEDULE_2", _("Schedule 2")),
        ("SCHEDULE_3", _("Schedule 3")),
        ("SCHEDULE_4", _("Schedule 4")),
        ("NARCOTIC", _("Narcotic")),
        ("CONTROLLED", _("Controlled")),
    )

    PREGNANCY_CATEGORY_CHOICES = (
        ("A", _("A")),
        ("B", _("B")),
        ("C", _("C")),
        ("D", _("D")),
        ("X", _("X")),
        ("UNKNOWN", _("Unknown")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="medicines",
    )
    product = models.OneToOneField(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="medicine",
        null=True,
        blank=True,
    )
    generic_name = models.CharField(max_length=255)
    brand_name = models.CharField(max_length=255, blank=True)
    strength = models.CharField(max_length=100, blank=True)
    dosage_form = models.CharField(
        max_length=20,
        choices=DOSAGE_FORM_CHOICES,
        default="TABLET",
    )
    administration_route = models.CharField(
        max_length=20,
        choices=ADMINISTRATION_ROUTE_CHOICES,
        default="ORAL",
    )
    active_ingredients = JSONField(default=list, blank=True)
    drug_class = models.CharField(
        max_length=30,
        choices=DRUG_CLASS_CHOICES,
        default="OTHER",
    )
    schedule = models.CharField(
        max_length=20,
        choices=SCHEDULE_CHOICES,
        default="OTC",
    )
    requires_prescription = models.BooleanField(default=False)
    pregnancy_category = models.CharField(
        max_length=10,
        choices=PREGNANCY_CATEGORY_CHOICES,
        default="UNKNOWN",
    )
    common_side_effects = models.TextField(blank=True)
    contraindications = models.TextField(blank=True)
    dosage_instructions = models.TextField(blank=True)
    storage_instructions = models.TextField(blank=True)
    is_pharmacist_only = models.BooleanField(default=False)
    drug_registration_number = models.CharField(max_length=100, blank=True)
    manufacturer = models.CharField(max_length=255, blank=True)
    country_of_origin = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pharmacy_medicine"
        verbose_name = _("Medicine")
        verbose_name_plural = _("Medicines")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.generic_name} - {self.strength}"


class Prescription(models.Model):
    STATUS_CHOICES = (
        ("PENDING", _("Pending")),
        ("DISPENSED", _("Dispensed")),
        ("PARTIALLY_DISPENSED", _("Partially Dispensed")),
        ("CANCELLED", _("Cancelled")),
        ("EXPIRED", _("Expired")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="prescriptions",
    )
    prescription_number = models.CharField(max_length=50, unique=True)
    patient_name = models.CharField(max_length=255)
    patient_age = models.IntegerField(null=True, blank=True)
    patient_gender = models.CharField(max_length=10, blank=True)
    patient_phone = models.CharField(max_length=20, blank=True)
    patient_address = models.TextField(blank=True)
    doctor_name = models.CharField(max_length=255, blank=True)
    doctor_phone = models.CharField(max_length=20, blank=True)
    doctor_reg_number = models.CharField(max_length=100, blank=True)
    hospital_clinic = models.CharField(max_length=255, blank=True)
    diagnosis = models.TextField(blank=True)
    prescription_date = models.DateField()
    valid_until_date = models.DateField(null=True, blank=True)
    is_repeat = models.BooleanField(default=False)
    repeat_count = models.IntegerField(default=0)
    max_repeats = models.IntegerField(default=0)
    status = models.CharField(
        max_length=30,
        choices=STATUS_CHOICES,
        default="PENDING",
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_prescriptions",
    )
    dispensed_by = models.ForeignKey(
        "accounts.CustomUser",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dispensed_prescriptions",
    )
    dispensed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pharmacy_prescription"
        verbose_name = _("Prescription")
        verbose_name_plural = _("Prescriptions")
        ordering = ["-prescription_date", "-created_at"]

    def __str__(self):
        return f"{self.prescription_number} - {self.patient_name}"


class PrescriptionItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    prescription = models.ForeignKey(
        Prescription,
        on_delete=models.CASCADE,
        related_name="items",
    )
    medicine = models.ForeignKey(
        Medicine,
        on_delete=models.CASCADE,
        related_name="prescription_items",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="prescription_items",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="prescription_items",
    )
    batch = models.ForeignKey(
        "products.Batch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="prescription_items",
    )
    dosage_instruction = models.TextField(blank=True)
    frequency = models.CharField(max_length=100, blank=True)
    duration_days = models.IntegerField(null=True, blank=True)
    quantity_prescribed = models.IntegerField(default=0)
    quantity_dispensed = models.IntegerField(default=0)
    quantity_remaining = models.IntegerField(default=0)
    refill_count = models.IntegerField(default=0)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pharmacy_prescription_item"
        verbose_name = _("Prescription Item")
        verbose_name_plural = _("Prescription Items")
        ordering = ["id"]

    def __str__(self):
        return f"{self.prescription} - {self.medicine}"


class DrugInteraction(models.Model):
    SEVERITY_CHOICES = (
        ("MINOR", _("Minor")),
        ("MODERATE", _("Moderate")),
        ("MAJOR", _("Major")),
        ("SEVERE", _("Severe")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="drug_interactions",
    )
    medicine_a = models.ForeignKey(
        Medicine,
        on_delete=models.CASCADE,
        related_name="interactions_a",
    )
    medicine_b = models.ForeignKey(
        Medicine,
        on_delete=models.CASCADE,
        related_name="interactions_b",
    )
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="MODERATE")
    description = models.TextField(blank=True)
    clinical_significance = models.TextField(blank=True)
    management = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pharmacy_drug_interaction"
        verbose_name = _("Drug Interaction")
        verbose_name_plural = _("Drug Interactions")
        unique_together = ("business", "medicine_a", "medicine_b")

    def __str__(self):
        return f"{self.medicine_a} + {self.medicine_b} ({self.severity})"


class DrugAllergy(models.Model):
    REACTION_TYPE_CHOICES = (
        ("RASH", _("Rash")),
        ("ITCHING", _("Itching")),
        ("SWELLING", _("Swelling")),
        ("ANAPHYLAXIS", _("Anaphylaxis")),
        ("GI_DISTRESS", _("GI Distress")),
        ("OTHER", _("Other")),
    )

    SEVERITY_CHOICES = (
        ("MILD", _("Mild")),
        ("MODERATE", _("Moderate")),
        ("SEVERE", _("Severe")),
        ("LIFE_THREATENING", _("Life Threatening")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="drug_allergies",
    )
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.CASCADE,
        related_name="drug_allergies",
    )
    medicine = models.ForeignKey(
        Medicine,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="allergy_reports",
    )
    generic_name = models.CharField(max_length=255, blank=True)
    ingredient_name = models.CharField(max_length=255, blank=True)
    reaction_type = models.CharField(
        max_length=20,
        choices=REACTION_TYPE_CHOICES,
        default="OTHER",
    )
    severity = models.CharField(
        max_length=20,
        choices=SEVERITY_CHOICES,
        default="MILD",
    )
    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    recorded_at = models.DateTimeField(auto_now_add=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pharmacy_drug_allergy"
        verbose_name = _("Drug Allergy")
        verbose_name_plural = _("Drug Allergies")
        ordering = ["-recorded_at"]

    def __str__(self):
        return f"{self.customer} - {self.generic_name or self.medicine}"


class DrugStockFEFO(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="drug_stock_fefo",
    )
    medicine = models.ForeignKey(
        Medicine,
        on_delete=models.CASCADE,
        related_name="fefo_stocks",
    )
    product = models.ForeignKey(
        "products.Product",
        on_delete=models.CASCADE,
        related_name="fefo_stocks",
    )
    variant = models.ForeignKey(
        "products.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fefo_stocks",
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="fefo_stocks",
    )
    warehouse = models.ForeignKey(
        "branches.Warehouse",
        on_delete=models.CASCADE,
        related_name="fefo_stocks",
    )
    batches_ordered = JSONField(default=list, blank=True)
    total_available_qty = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pharmacy_drug_stock_fefo"
        verbose_name = _("Drug Stock FEFO")
        verbose_name_plural = _("Drug Stock FEFOs")

    def __str__(self):
        return f"FEFO {self.product} - {self.total_available_qty}"
