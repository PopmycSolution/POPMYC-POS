from django.contrib import admin
from .models import (
    Account,
    JournalEntry,
    JournalEntryLine,
    FinancialTransaction,
    FiscalPeriod,
)


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display = (
        "account_code",
        "name",
        "business",
        "account_type",
        "normal_balance",
        "current_balance",
        "is_active",
        "is_cash_account",
        "is_bank_account",
    )
    list_filter = (
        "business",
        "account_type",
        "normal_balance",
        "is_active",
        "is_contra",
        "is_control_account",
        "is_cash_account",
        "is_bank_account",
        "tax_relevant",
    )
    search_fields = ("account_code", "name", "description")
    ordering = ("sort_order", "account_code")
    readonly_fields = ("created_at", "updated_at")


class JournalEntryLineInline(admin.TabularInline):
    model = JournalEntryLine
    extra = 2
    readonly_fields = ("created_at",)


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = (
        "entry_number",
        "business",
        "entry_date",
        "source_module",
        "status",
        "total_debits",
        "total_credits",
    )
    list_filter = (
        "business",
        "source_module",
        "status",
        "fiscal_period",
        "is_adjusting",
        "is_closing",
        "entry_date",
    )
    search_fields = ("entry_number", "reference", "description", "notes")
    ordering = ("-entry_date", "-created_at")
    date_hierarchy = "entry_date"
    readonly_fields = ("created_at", "updated_at", "posted_at", "voided_at")
    inlines = [JournalEntryLineInline]


@admin.register(JournalEntryLine)
class JournalEntryLineAdmin(admin.ModelAdmin):
    list_display = (
        "journal_entry",
        "account",
        "debit_amount",
        "credit_amount",
        "branch",
    )
    list_filter = ("account", "branch")
    search_fields = ("line_description", "reference_type")
    readonly_fields = ("created_at",)


@admin.register(FinancialTransaction)
class FinancialTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "transaction_type",
        "direction",
        "account",
        "amount",
        "transaction_date",
        "reference",
        "branch",
    )
    list_filter = (
        "business",
        "transaction_type",
        "direction",
        "account",
        "counterparty_type",
        "branch",
    )
    search_fields = ("reference", "description")
    ordering = ("-transaction_date", "-created_at")
    readonly_fields = ("created_at",)


@admin.register(FiscalPeriod)
class FiscalPeriodAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "business",
        "period_type",
        "start_date",
        "end_date",
        "status",
        "is_closed",
    )
    list_filter = ("business", "period_type", "status", "is_closed")
    search_fields = ("name",)
    ordering = ("-start_date",)
    readonly_fields = ("created_at", "updated_at", "closed_at")
