from rest_framework import serializers
from .models import (
    Medicine,
    Prescription,
    PrescriptionItem,
    DrugInteraction,
    DrugAllergy,
    DrugStockFEFO,
)


class MedicineSerializer(serializers.ModelSerializer):
    class Meta:
        model = Medicine
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PrescriptionItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrescriptionItem
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class PrescriptionSerializer(serializers.ModelSerializer):
    items = PrescriptionItemSerializer(many=True, required=False)

    class Meta:
        model = Prescription
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")

    def create(self, validated_data):
        items_data = validated_data.pop("items", [])
        prescription = Prescription.objects.create(**validated_data)
        for item_data in items_data:
            PrescriptionItem.objects.create(
                prescription=prescription,
                **item_data,
            )
        return prescription

    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if items_data is not None:
            instance.items.all().delete()
            for item_data in items_data:
                PrescriptionItem.objects.create(
                    prescription=instance,
                    **item_data,
                )
        return instance


class DrugInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DrugInteraction
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class DrugAllergySerializer(serializers.ModelSerializer):
    class Meta:
        model = DrugAllergy
        fields = "__all__"
        read_only_fields = ("id", "recorded_at", "created_at", "updated_at")


class DrugStockFEFOSerializer(serializers.ModelSerializer):
    class Meta:
        model = DrugStockFEFO
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")
