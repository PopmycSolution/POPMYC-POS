from rest_framework import serializers
from backups.models import Backup


class BackupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Backup
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at", "restored_at")
