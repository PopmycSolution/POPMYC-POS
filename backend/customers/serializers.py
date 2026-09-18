from rest_framework import serializers
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


class CustomerGroupSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerGroup
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class LoyaltyTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyTier
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CustomerContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerContact
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CustomerSerializer(serializers.ModelSerializer):
    contacts = CustomerContactSerializer(many=True, read_only=True)

    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = (
            "id",
            "created_at",
            "updated_at",
            "current_credit_balance",
            "total_credit_used",
            "loyalty_points_balance",
            "loyalty_total_earned",
            "loyalty_total_redeemed",
        )


class CustomerCreditSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerCredit
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CustomerCreditTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerCreditTransaction
        fields = "__all__"
        read_only_fields = ("id", "created_at", "transaction_date")


class CustomerStatementSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerStatement
        fields = "__all__"
        read_only_fields = ("id", "created_at", "sent_at")


class LoyaltyTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyTransaction
        fields = "__all__"
        read_only_fields = ("id", "created_at", "transaction_date")


class CustomerLoyaltyCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerLoyaltyCard
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SaleOnAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleOnAccount
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SaleOnAccountPaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleOnAccountPayment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "transaction_date")


class CreditChargeSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=15, decimal_places=2)
    reference = serializers.CharField(required=False, allow_blank=True)
    reference_id = serializers.UUIDField(required=False, allow_null=True)
    reference_type = serializers.CharField(required=False, allow_blank=True)
    due_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class CreditPaySerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=15, decimal_places=2)
    reference = serializers.CharField(required=False, allow_blank=True)
    reference_id = serializers.UUIDField(required=False, allow_null=True)
    reference_type = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class StatementRequestSerializer(serializers.Serializer):
    period_start = serializers.DateField(required=False, allow_null=True)
    period_end = serializers.DateField(required=False, allow_null=True)
