from django.contrib import admin
from .models import (
    CustomerGroup,
    LoyaltyTier,
    Customer,
    CustomerContact,
    CustomerCredit,
    CustomerCreditTransaction,
    CustomerStatement,
    LoyaltyTransaction,
    CustomerLoyaltyCard,
    SaleOnAccount,
    SaleOnAccountPayment,
)


@admin.register(CustomerGroup)
class CustomerGroupAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "discount_pct", "is_default", "is_active")
    list_filter = ("business", "is_active", "is_default")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(LoyaltyTier)
class LoyaltyTierAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "business", "min_points", "max_points", "discount_pct", "is_active")
    list_filter = ("business", "is_active")
    search_fields = ("name", "code")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("__str__", "phone", "customer_group", "tier", "business", "is_active")
    list_filter = ("business", "customer_group", "tier", "gender", "is_active")
    search_fields = ("first_name", "last_name", "company_name", "phone", "email", "customer_number")
    readonly_fields = (
        "id",
        "created_at",
        "updated_at",
        "current_credit_balance",
        "total_credit_used",
        "loyalty_points_balance",
        "loyalty_total_earned",
        "loyalty_total_redeemed",
    )


@admin.register(CustomerContact)
class CustomerContactAdmin(admin.ModelAdmin):
    list_display = ("name", "customer", "relationship", "phone", "is_primary")
    list_filter = ("is_primary",)
    search_fields = ("name", "phone", "email", "customer__first_name", "customer__last_name")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(CustomerCredit)
class CustomerCreditAdmin(admin.ModelAdmin):
    list_display = ("customer", "business", "available_credit", "used_credit", "balance")
    list_filter = ("business",)
    search_fields = ("customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(CustomerCreditTransaction)
class CustomerCreditTransactionAdmin(admin.ModelAdmin):
    list_display = ("type", "amount", "customer", "balance_after", "transaction_date")
    list_filter = ("type", "business")
    search_fields = ("reference", "customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "transaction_date")


@admin.register(CustomerStatement)
class CustomerStatementAdmin(admin.ModelAdmin):
    list_display = ("customer", "statement_date", "period_start", "period_end", "opening_balance", "closing_balance")
    list_filter = ("business", "is_sent")
    search_fields = ("customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "sent_at")


@admin.register(LoyaltyTransaction)
class LoyaltyTransactionAdmin(admin.ModelAdmin):
    list_display = ("type", "points", "customer", "balance_after", "transaction_date")
    list_filter = ("type", "business")
    search_fields = ("customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "transaction_date")


@admin.register(CustomerLoyaltyCard)
class CustomerLoyaltyCardAdmin(admin.ModelAdmin):
    list_display = ("card_number", "customer", "card_status", "issued_at", "expires_at")
    list_filter = ("business", "card_status")
    search_fields = ("card_number", "customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(SaleOnAccount)
class SaleOnAccountAdmin(admin.ModelAdmin):
    list_display = ("invoice_number", "customer", "total_amount", "amount_paid", "balance", "status", "due_date")
    list_filter = ("business", "status")
    search_fields = ("invoice_number", "customer__first_name", "customer__last_name", "customer__phone")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(SaleOnAccountPayment)
class SaleOnAccountPaymentAdmin(admin.ModelAdmin):
    list_display = ("credit_sale", "customer", "amount", "payment_method", "transaction_date")
    list_filter = ("business", "payment_method")
    search_fields = ("reference", "credit_sale__invoice_number", "customer__first_name", "customer__last_name")
    readonly_fields = ("id", "created_at", "transaction_date")
