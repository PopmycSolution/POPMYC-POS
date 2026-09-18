from datetime import datetime, timezone
from django.db import connection
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny


class HealthCheckView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        database_status = "ok"
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
        except Exception:
            database_status = "error"

        return Response(
            {
                "status": "ok",
                "version": "0.1.0",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "database": database_status,
            },
            status=status.HTTP_200_OK,
        )


class PingGetView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {"message": "pong"},
            status=status.HTTP_200_OK,
        )
