from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

# ── POPMYC custom admin site ──────────────────────────────────────────────────
# Route /admin/ to the custom PopmycAdminSite (dashboard + KPI cards).
# The default admin.site branding is also set here for any code that still
# references it directly (e.g. DRF browsable API).
from popmyc_admin.admin_site import popmyc_admin_site

admin.site.site_header   = "POPMYC POS Administration"
admin.site.site_title    = "POPMYC Admin"
admin.site.index_title   = "Dashboard"

urlpatterns = [
    path("admin/", popmyc_admin_site.urls),
    path("api-auth/", include("rest_framework.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    path("", include("api.urls")),
    path("api/sync/", include("synchronization.urls")),
    # Also mount under /api/v1/sync/ so the PWA (which uses API_BASE_URL=/api/v1)
    # can reach sync endpoints without a separate base URL.
    path("api/v1/sync/", include("synchronization.urls")),
    path("api/v1/setup/", include("setup.urls")),
    path("api/v1/cloud/", include("cloud.urls", namespace="cloud")),
]

if settings.DEBUG:
    # Development: Django serves static/media; Vite dev server handles the SPA.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
else:
    # Desktop / Production: WhiteNoise handles static files.
    # Media files (user uploads — avatars, logos) are always served by Django
    # directly since WhiteNoise only handles static, not user-uploaded media.
    if settings.MEDIA_URL and settings.MEDIA_ROOT:
        urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    # Desktop / Production: WhiteNoise handles all static files including the
    # built React SPA. The catch-all below sends every unmatched URL to
    # index.html so React Router handles client-side navigation.
    # Ordering: this must be last — after all /api/*, /admin/*, /static/* routes.
    from django.http import FileResponse, HttpResponseNotFound
    from django.views import View

    class SPAIndexView(View):
        """Serve the React SPA index.html for any non-API route."""
        def get(self, request, *args, **kwargs):
            index_path = settings.STATIC_ROOT / "index.html"
            if index_path.exists():
                return FileResponse(open(index_path, "rb"), content_type="text/html")
            return HttpResponseNotFound(
                "<h1>Frontend not built</h1>"
                "<p>Run <code>npm run build</code> then "
                "<code>python manage.py collectstatic</code>.</p>"
            )

    urlpatterns += [
        re_path(
            r"^(?!api/|admin/|api-auth/|static/|media/).*$",
            SPAIndexView.as_view(),
            name="spa-index",
        ),
    ]
