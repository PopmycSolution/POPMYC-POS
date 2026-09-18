from rest_framework import serializers

from synchronization.models import SyncRecord, SyncDevice


class SyncRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncRecord
        fields = [
            "id",
            "record_id",
            "app_label",
            "model_name",
            "action",
            "status",
            "payload",
            "attempts",
            "last_error",
            "created_at",
            "updated_at",
            "synced_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "attempts",
            "last_error",
            "created_at",
            "updated_at",
            "synced_at",
        ]


class SyncDeviceSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncDevice
        fields = [
            "id",
            "device_id",
            "name",
            "business_id",
            "branch_id",
            "last_sync_at",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "device_id",
            "created_at",
            "updated_at",
        ]