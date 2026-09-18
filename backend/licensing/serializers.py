"""
licensing/serializers.py
========================
Serializers for the licensing API.

LicenseSerializer         — full read representation (POPMYC staff / superuser)
LicenseStatusSerializer   — lightweight status check for the frontend
LicenseCreateSerializer   — POPMYC creates a new license for a business
ActivateLicenseSerializer — customer activates their license with a code
RenewLicenseSerializer    — customer renews an expired subscription with a new code
"""
from datetime import date, timedelta

from rest_framework import serializers

from businesses.models import Business
from .models import License, LicenseRenewalLog, _generate_code


class LicenseSerializer(serializers.ModelSerializer):
    business_name = serializers.CharField(source="business.name", read_only=True)
    is_active      = serializers.BooleanField(read_only=True)
    is_expired     = serializers.BooleanField(read_only=True)
    days_remaining = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = License
        fields = [
            "id",
            "business",
            "business_name",
            "license_type",
            "activation_code",
            "status",
            "start_date",
            "expiry_date",
            "activated_at",
            "created_at",
            "updated_at",
            "notes",
            # computed
            "is_active",
            "is_expired",
            "days_remaining",
        ]
        read_only_fields = [
            "id", "activation_code", "activated_at",
            "created_at", "updated_at",
            "is_active", "is_expired", "days_remaining",
        ]


class LicenseStatusSerializer(serializers.ModelSerializer):
    """
    Lightweight payload returned to the frontend on every page load check.
    Does NOT expose the activation code.
    """
    business_name  = serializers.CharField(source="business.name", read_only=True)
    is_active      = serializers.BooleanField(read_only=True)
    is_expired     = serializers.BooleanField(read_only=True)
    is_trial       = serializers.BooleanField(read_only=True)
    days_remaining = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = License
        fields = [
            "id",
            "business_name",
            "license_type",
            "status",
            "start_date",
            "expiry_date",
            "is_active",
            "is_expired",
            "is_trial",
            "days_remaining",
        ]


class LicenseCreateSerializer(serializers.Serializer):
    """
    Used by POPMYC staff to issue a new license.
    Only one license per business is allowed (enforced by OneToOneField).
    """
    business_id   = serializers.UUIDField()
    license_type  = serializers.ChoiceField(choices=License.LicenseType.choices)
    duration_days = serializers.IntegerField(
        min_value=1, default=365,
        help_text="For SUBSCRIPTION only. Ignored for LIFETIME.",
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_business_id(self, value):
        try:
            business = Business.objects.get(id=value)
        except Business.DoesNotExist:
            raise serializers.ValidationError("Business not found.")
        if hasattr(business, "license"):
            raise serializers.ValidationError(
                "This business already has a license. Use renew or manage the existing one."
            )
        return value

    def create(self, validated_data):
        business   = Business.objects.get(id=validated_data["business_id"])
        ltype      = validated_data["license_type"]
        duration   = validated_data["duration_days"]
        notes      = validated_data.get("notes", "")

        expiry = None
        if ltype == License.LicenseType.SUBSCRIPTION:
            expiry = date.today() + timedelta(days=duration)

        license = License.objects.create(
            business=business,
            license_type=ltype,
            expiry_date=expiry,
            notes=notes,
            status=License.Status.PENDING,
        )
        return license


class ActivateLicenseSerializer(serializers.Serializer):
    """
    The customer enters their activation code; this activates the license.
    The code must belong to the business making the request.
    """
    activation_code = serializers.CharField(max_length=30)

    def validate_activation_code(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        business = self.context["business"]
        code = attrs["activation_code"]

        try:
            license = License.objects.get(business=business, activation_code=code)
        except License.DoesNotExist:
            raise serializers.ValidationError(
                {"activation_code": "Invalid activation code for this business."}
            )

        if license.status == License.Status.REVOKED:
            raise serializers.ValidationError(
                {"activation_code": "This license has been revoked. Contact POPMYC support."}
            )

        attrs["license"] = license
        return attrs

    def save(self, **kwargs):
        license = self.validated_data["license"]
        user    = self.context.get("user")

        license.activate()

        LicenseRenewalLog.objects.create(
            license=license,
            action="ACTIVATION",
            code_used=license.activation_code,
            previous_expiry=None,
            new_expiry=license.expiry_date,
            duration_days=0,
            performed_by=user,
        )
        return license


class RenewLicenseSerializer(serializers.Serializer):
    """
    Renew an expired (or soon-to-expire) SUBSCRIPTION license.
    POPMYC generates a new code and gives it to the customer.
    The customer enters it here to extend their expiry.
    """
    activation_code = serializers.CharField(max_length=30)

    def validate_activation_code(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        business = self.context["business"]
        code = attrs["activation_code"]

        try:
            license = License.objects.get(business=business)
        except License.DoesNotExist:
            raise serializers.ValidationError("No license found for this business.")

        if license.license_type != License.LicenseType.SUBSCRIPTION:
            raise serializers.ValidationError(
                "Lifetime licenses do not require renewal."
            )

        if license.activation_code != code:
            raise serializers.ValidationError(
                {"activation_code": "Invalid activation code. Please check the code provided by POPMYC."}
            )

        if license.status == License.Status.REVOKED:
            raise serializers.ValidationError(
                {"activation_code": "This license has been revoked. Contact POPMYC support."}
            )

        attrs["license"] = license
        return attrs

    def save(self, **kwargs):
        license      = self.validated_data["license"]
        code_used    = license.activation_code
        prev_expiry  = license.expiry_date
        user         = self.context.get("user")
        duration     = self.context.get("duration_days", 365)

        base = max(license.expiry_date, date.today()) if license.expiry_date else date.today()
        new_expiry = base + timedelta(days=duration)

        license.expiry_date      = new_expiry
        license.status           = License.Status.ACTIVE
        license.activation_code  = _generate_code()  # rotate so old code is dead
        license.save(update_fields=["expiry_date", "status", "activation_code", "updated_at"])

        LicenseRenewalLog.objects.create(
            license=license,
            action="RENEWAL",
            code_used=code_used,
            previous_expiry=prev_expiry,
            new_expiry=new_expiry,
            duration_days=duration,
            performed_by=user,
        )
        return license
