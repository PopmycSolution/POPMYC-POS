from rest_framework import serializers
from employees.models import Employee, Shift, CashDrawerEvent


class EmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class ShiftSerializer(serializers.ModelSerializer):
    class Meta:
        model = Shift
        fields = "__all__"
        read_only_fields = ("id", "created_at", "updated_at")


class CashDrawerEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashDrawerEvent
        fields = "__all__"
        read_only_fields = ("id", "created_at")
