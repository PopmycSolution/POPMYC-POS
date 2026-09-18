from rest_framework import viewsets, permissions
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter

from common.mixins import BusinessScopedMixin

from branches.models import Branch, Warehouse, Register
from branches.serializers import (
    BranchSerializer,
    WarehouseSerializer,
    RegisterSerializer,
)


class BranchViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Branch.objects.all()
    serializer_class = BranchSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "is_head_office", "is_active"]
    search_fields = ["name", "code", "address", "phone"]
    ordering_fields = ["created_at", "updated_at", "name", "code"]
    ordering = ["-created_at"]


class WarehouseViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Warehouse.objects.all()
    serializer_class = WarehouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "is_active"]
    search_fields = ["name", "code", "address"]
    ordering_fields = ["created_at", "updated_at", "name", "code"]
    ordering = ["-created_at"]


class RegisterViewSet(BusinessScopedMixin, viewsets.ModelViewSet):
    queryset = Register.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "branch", "is_active"]
    search_fields = ["name", "code"]
    ordering_fields = ["created_at", "updated_at", "name", "code", "current_balance"]
    ordering = ["-created_at"]
