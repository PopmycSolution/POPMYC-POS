from django.urls import path, include
from rest_framework.routers import DefaultRouter
from api.views import HealthCheckView, PingGetView

router = DefaultRouter()

urlpatterns = [
    path("api/v1/health/", HealthCheckView.as_view(), name="health-check"),
    path("api/v1/ping/", PingGetView.as_view(), name="ping"),
    path("api/v1/accounts/", include("accounts.urls")),
    path("api/v1/auth/", include("accounts.urls")),
    path("api/v1/businesses/", include("businesses.urls")),
    path("api/v1/branches/", include("branches.urls")),
    path("api/v1/products/", include("products.urls")),
    path("api/v1/inventory/", include("inventory.urls")),
    path("api/v1/sales/", include("sales.urls")),
    path("api/v1/purchases/", include("purchases.urls")),
    path("api/v1/suppliers/", include("suppliers.urls")),
    path("api/v1/customers/", include("customers.urls")),
    path("api/v1/expenses/", include("expenses.urls")),
    path("api/v1/accounting/", include("accounting.urls")),
    path("api/v1/reports/", include("reports.urls")),
    path("api/v1/pharmacy/", include("pharmacy.urls")),
    path("api/v1/phones/", include("phones.urls")),
    path("api/v1/repairs/", include("repairs.urls")),
    path("api/v1/employees/", include("employees.urls")),
    path("api/v1/notifications/", include("notifications.urls")),
    path("api/v1/audit/", include("audit.urls")),
    path("api/v1/backups/", include("backups.urls")),
    path("api/v1/licensing/", include("licensing.urls")),
    path("api/v1/", include(router.urls)),
]
