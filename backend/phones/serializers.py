from rest_framework import serializers
from .models import (
    PhoneBrand,
    PhoneModel,
    PhoneVariant,
    PhoneIMEI,
    PhoneWarranty,
    PhoneHistory,
)


class PhoneBrandSerializer(serializers.ModelSerializer):
    class Meta:
        model = PhoneBrand
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PhoneVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = PhoneVariant
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PhoneModelSerializer(serializers.ModelSerializer):
    variants = PhoneVariantSerializer(many=True, read_only=True, required=False)

    class Meta:
        model = PhoneModel
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PhoneIMEISerializer(serializers.ModelSerializer):
    class Meta:
        model = PhoneIMEI
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PhoneWarrantySerializer(serializers.ModelSerializer):
    class Meta:
        model = PhoneWarranty
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PhoneHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = PhoneHistory
        fields = "__all__"
        read_only_fields = ("id", "created_at")
