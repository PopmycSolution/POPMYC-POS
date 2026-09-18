from rest_framework import serializers
from sales.models import (
    PaymentMethod,
    Sale,
    SaleItem,
    SaleTax,
    SaleDiscount,
    SalePayment,
    SaleReturn,
    SaleReturnItem,
    SaleReturnRefund,
    HeldSale,
    Receipt,
    Exchange,
    Promotion,
    Coupon,
    CouponRedemption,
    CustomerLoyaltyReward,
    LoyaltyRedemption,
)


class PaymentMethodSerializer(serializers.ModelSerializer):
    class Meta:
        model = PaymentMethod
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SaleTaxSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleTax
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SaleDiscountSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleDiscount
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SalePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalePayment
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    taxes = SaleTaxSerializer(many=True, read_only=True)
    discounts = SaleDiscountSerializer(many=True, read_only=True)
    payments = SalePaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Sale
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class SaleReturnItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleReturnItem
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SaleReturnRefundSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleReturnRefund
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class SaleReturnSerializer(serializers.ModelSerializer):
    items = SaleReturnItemSerializer(many=True, read_only=True)
    refunds = SaleReturnRefundSerializer(many=True, read_only=True)

    class Meta:
        model = SaleReturn
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class HeldSaleSerializer(serializers.ModelSerializer):
    class Meta:
        model = HeldSale
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class ReceiptSerializer(serializers.ModelSerializer):
    class Meta:
        model = Receipt
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class ExchangeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exchange
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class PromotionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Promotion
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CouponSerializer(serializers.ModelSerializer):
    class Meta:
        model = Coupon
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CouponRedemptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CouponRedemption
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class CustomerLoyaltyRewardSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerLoyaltyReward
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class LoyaltyRedemptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyRedemption
        fields = "__all__"
        read_only_fields = ("id", "created_at")
