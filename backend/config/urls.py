from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api-auth/", include("rest_framework.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/schema/swagger-ui/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("api/schema/redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
    path("", include("api.urls")),
    path("api/sync/", include("synchronization.urls")),
    path("api/v1/setup/", include("setup.urls")),
    path("api/v1/cloud/", include("cloud.urls", namespace="cloud")),
]

if settings.DEBUG:
    # Development: Django serves static/media; Vite dev server handles the SPA.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
else:
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
