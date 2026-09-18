from datetime import datetime
from django.db import models
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter, OrderingFilter
from notifications.models import Notification
from notifications.serializers import NotificationSerializer


class NotificationViewSet(viewsets.ModelViewSet):
    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["business", "user", "type", "is_read"]
    search_fields = ["title", "message"]
    ordering_fields = ["created_at", "read_at", "type"]
    ordering = ["-created_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.business:
            qs = qs.filter(business=user.business)
        if user:
            qs = qs.filter(models.Q(user=user) | models.Q(user__isnull=True))
        return qs

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notification = self.get_object()
        if notification.user_id and notification.user_id != request.user.id:
            return Response(
                {"detail": "Not authorized."},
                status=status.HTTP_403_FORBIDDEN,
            )
        notification.is_read = True
        notification.read_at = datetime.now()
        notification.save(update_fields=["is_read", "read_at"])
        serializer = self.get_serializer(notification)
        return Response(serializer.data)

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        user = request.user
        qs = self.get_queryset().filter(is_read=False)
        if user:
            qs = qs.filter(user=user)
        updated = qs.update(is_read=True, read_at=datetime.now())
        return Response(
            {"detail": f"Marked {updated} notifications as read."},
            status=status.HTTP_200_OK,
        )
