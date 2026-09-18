from django.contrib import admin
from .models import (
    ExpenseCategory,
    Expense,
    RecurringExpense,
    ExpenseApproval,
)


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "type", "parent", "is_active", "sort_order")
    list_filter = ("business", "type", "is_active")
    search_fields = ("name", "code", "description")
    ordering = ("sort_order", "name")


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = (
        "reference_number",
        "business",
        "category",
        "branch",
        "expense_date",
        "total_amount",
        "payment_method",
        "status",
    )
    list_filter = ("business", "category", "branch", "payment_method", "status", "expense_date")
    search_fields = ("reference_number", "description", "receipt_number", "notes")
    ordering = ("-expense_date", "-created_at")
    date_hierarchy = "expense_date"
    readonly_fields = ("created_at", "updated_at")


@admin.register(RecurringExpense)
class RecurringExpenseAdmin(admin.ModelAdmin):
    list_display = (
        "description",
        "business",
        "category",
        "branch",
        "frequency",
        "total_amount",
        "next_run_date",
        "is_active",
    )
    list_filter = ("business", "category", "branch", "frequency", "is_active")
    search_fields = ("description",)
    ordering = ("-next_run_date",)


@admin.register(ExpenseApproval)
class ExpenseApprovalAdmin(admin.ModelAdmin):
    list_display = ("expense", "approver", "status", "approval_level", "decided_at")
    list_filter = ("status", "approval_level")
    search_fields = ("comment",)
    ordering = ("approval_level", "-created_at")
