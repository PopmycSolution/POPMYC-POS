from django.contrib import admin
from .models import (
    Medicine,
    Prescription,
    PrescriptionItem,
    DrugInteraction,
    DrugAllergy,
    DrugStockFEFO,
)


@admin.register(Medicine)
class MedicineAdmin(admin.ModelAdmin):
    list_display = (
        "generic_name",
        "brand_name",
        "strength",
        "dosage_form",
        "drug_class",
        "schedule",
        "requires_prescription",
        "business",
    )
    list_filter = (
        "business",
        "dosage_form",
        "administration_route",
        "drug_class",
        "schedule",
        "requires_prescription",
        "pregnancy_category",
        "is_pharmacist_only",
    )
    search_fields = (
        "generic_name",
        "brand_name",
        "strength",
        "manufacturer",
        "drug_registration_number",
    )
    ordering = ("-created_at",)
    readonly_fields = ("created_at", "updated_at")


class PrescriptionItemInline(admin.TabularInline):
    model = PrescriptionItem
    extra = 1
    readonly_fields = ("created_at", "updated_at")


@admin.register(Prescription)
class PrescriptionAdmin(admin.ModelAdmin):
    list_display = (
        "prescription_number",
        "patient_name",
        "patient_age",
        "doctor_name",
        "prescription_date",
        "status",
        "is_repeat",
        "business",
    )
    list_filter = (
        "business",
        "status",
        "is_repeat",
        "prescription_date",
        "created_by",
        "dispensed_by",
    )
    search_fields = (
        "prescription_number",
        "patient_name",
        "patient_phone",
        "doctor_name",
        "doctor_reg_number",
        "diagnosis",
    )
    ordering = ("-prescription_date", "-created_at")
    date_hierarchy = "prescription_date"
    readonly_fields = ("created_at", "updated_at", "dispensed_at")
    inlines = [PrescriptionItemInline]


@admin.register(PrescriptionItem)
class PrescriptionItemAdmin(admin.ModelAdmin):
    list_display = (
        "prescription",
        "medicine",
        "quantity_prescribed",
        "quantity_dispensed",
        "quantity_remaining",
        "refill_count",
    )
    list_filter = ("medicine", "batch")
    search_fields = ("dosage_instruction", "frequency", "notes")
    readonly_fields = ("created_at", "updated_at")


@admin.register(DrugInteraction)
class DrugInteractionAdmin(admin.ModelAdmin):
    list_display = (
        "medicine_a",
        "medicine_b",
        "severity",
        "business",
    )
    list_filter = ("business", "severity")
    search_fields = ("description", "clinical_significance", "management")
    readonly_fields = ("created_at", "updated_at")


@admin.register(DrugAllergy)
class DrugAllergyAdmin(admin.ModelAdmin):
    list_display = (
        "customer",
        "medicine",
        "generic_name",
        "reaction_type",
        "severity",
        "business",
    )
    list_filter = ("business", "reaction_type", "severity", "customer")
    search_fields = ("generic_name", "ingredient_name", "description", "notes")
    ordering = ("-recorded_at",)
    readonly_fields = ("recorded_at", "created_at", "updated_at")


@admin.register(DrugStockFEFO)
class DrugStockFEFOAdmin(admin.ModelAdmin):
    list_display = (
        "medicine",
        "product",
        "branch",
        "warehouse",
        "total_available_qty",
        "business",
    )
    list_filter = ("business", "branch", "warehouse", "medicine")
    readonly_fields = ("created_at", "updated_at")
