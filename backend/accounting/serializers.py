from rest_framework import serializers
from .models import (
    Account,
    JournalEntry,
    JournalEntryLine,
    FinancialTransaction,
    FiscalPeriod,
)


class AccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Account
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class JournalEntryLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = JournalEntryLine
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, required=False)

    class Meta:
        model = JournalEntry
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def create(self, validated_data):
        lines_data = validated_data.pop("lines", [])
        journal_entry = JournalEntry.objects.create(**validated_data)
        for line_data in lines_data:
            JournalEntryLine.objects.create(
                journal_entry=journal_entry,
                business=journal_entry.business,
                **line_data,
            )
        return journal_entry

    def update(self, instance, validated_data):
        lines_data = validated_data.pop("lines", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if lines_data is not None:
            instance.lines.all().delete()
            for line_data in lines_data:
                JournalEntryLine.objects.create(
                    journal_entry=instance,
                    business=instance.business,
                    **line_data,
                )
        return instance


class FinancialTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinancialTransaction
        fields = "__all__"
        read_only_fields = ("id", "created_at")


class FiscalPeriodSerializer(serializers.ModelSerializer):
    class Meta:
        model = FiscalPeriod
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
