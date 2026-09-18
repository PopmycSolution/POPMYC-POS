from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin

from employees.models import Employee, Shift, CashDrawerEvent
from employees.serializers import (
    EmployeeSerializer,
    ShiftSerializer,
    CashDrawerEventSerializer,
)


class EmployeeViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Employee.objects.all()
    serializer_class = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "status"]
    search_fields = ["employee_number", "job_title", "user__username", "user__first_name", "user__last_name"]
    ordering_fields = ["created_at", "updated_at", "employee_number", "salary"]
    ordering = ["-created_at"]


class ShiftViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Shift.objects.all()
    serializer_class = ShiftSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "employee", "register", "status"]
    search_fields = ["shift_number"]
    ordering_fields = ["created_at", "updated_at", "open_time", "close_time", "opening_float", "variance"]
    ordering = ["-created_at"]

    @action(detail=True, methods=["post"], url_path="close")
    def close_shift(self, request, pk=None):
        shift = self.get_object()
        if shift.status != "OPEN":
            return Response(
                {"detail": "Shift is not open."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        serializer = self.get_serializer(shift, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(status="CLOSED")
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="force-close")
    def force_close_shift(self, request, pk=None):
        shift = self.get_object()
        if shift.status != "OPEN":
            return Response(
                {"detail": "Shift is not open."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        shift.status = "FORCE_CLOSED"
        shift.save(update_fields=["status", "updated_at"])
        serializer = self.get_serializer(shift)
        return Response(serializer.data)


class CashDrawerEventViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = CashDrawerEvent.objects.all()
    serializer_class = CashDrawerEventSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "employee", "shift", "event_type"]
    search_fields = ["reason", "reference"]
    ordering_fields = ["created_at", "amount"]
    ordering = ["-created_at"]
