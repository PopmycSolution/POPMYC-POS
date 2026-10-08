import os
import sys
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# ── Security ──────────────────────────────────────────────────────────────────
_default_secret = "django-insecure-change-me-in-production"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", _default_secret)

# Warn loudly (but do not crash) if the insecure default is used outside tests.
if SECRET_KEY == _default_secret and "test" not in sys.argv and os.getenv("DJANGO_DEBUG", "False") != "True":
    import warnings
    warnings.warn(
        "DJANGO_SECRET_KEY is not set. Using the insecure default key. "
        "Set a strong DJANGO_SECRET_KEY environment variable before deploying.",
        RuntimeWarning,
        stacklevel=1,
    )

DEBUG = os.getenv("DJANGO_DEBUG", "False") == "True"

ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# ── Auto-detect Render deployment ──────────────────────────────────────────────
# On Render, RENDER=true is always set. Use it to inject the right defaults
# without needing every env var to be set manually in the dashboard.
_IS_RENDER = os.getenv("RENDER", "").lower() == "true"

if _IS_RENDER:
    # Render sets RENDER_EXTERNAL_HOSTNAME to the service's public hostname
    _render_host = os.getenv("RENDER_EXTERNAL_HOSTNAME", "popmyc-pos.onrender.com")
    if _render_host not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(_render_host)

# ── CSRF trusted origins (required for Render / any non-localhost deployment) ─
_csrf_origins_env = os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    # Default includes both Render service URLs so PWA works without extra config
    "https://popmyc-pos.onrender.com,https://popmyc-poos-app.onrender.com" if _IS_RENDER else "",
)
CSRF_TRUSTED_ORIGINS = [o.strip() for o in _csrf_origins_env.split(",") if o.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "popmyc_admin",   # POPMYC custom admin dashboard
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    "guardian",
    "drf_spectacular",
    "accounts",
    "businesses",
    "branches",
    "products",
    "inventory",
    "sales",
    "purchases",
    "suppliers",
    "customers",
    "expenses",
    "accounting",
    "reports",
    "pharmacy",
    "phones",
    "repairs",
    "employees",
    "notifications",
    "audit",
    "backups",
    "licensing",
    "synchronization",
    "setup",
    "cloud",
]

# ── Cloud / PWA feature flags ──────────────────────────────────────────────────
# Both default False so the local POS works with no internet and no cloud config.
# On Render (_IS_RENDER=True) they default to True — the whole point of Render
# is to serve the cloud/PWA backend. Override via env vars if needed.
CLOUD_ENABLED = os.getenv("CLOUD_ENABLED", "True" if _IS_RENDER else "False") == "True"
PWA_ENABLED   = os.getenv("PWA_ENABLED",   "True" if _IS_RENDER else "False") == "True"

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "licensing.middleware.LicenseCheckMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],   # POPMYC admin template overrides
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# ── Database ──────────────────────────────────────────────────────────────────
# Priority:
#   1. DATABASE_URL  — set on Render / Supabase cloud deployments.
#   2. DB_* vars     — used by the local Windows desktop installation.
#
# The local DB_* path is NEVER modified by the DATABASE_URL logic, so the
# existing desktop / offline workflow is completely unaffected.

_DATABASE_URL = os.getenv("DATABASE_URL", "")

if _DATABASE_URL:
    # Parse the PostgreSQL URL using Python's stdlib urllib.parse.
    # No external library is required.
    from urllib.parse import urlparse as _urlparse, unquote as _unquote

    _u = _urlparse(_DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE":   "django.db.backends.postgresql",
            "NAME":     _unquote(_u.path.lstrip("/")),
            "USER":     _unquote(_u.username or ""),
            "PASSWORD": _unquote(_u.password or ""),
            "HOST":     _u.hostname or "localhost",
            "PORT":     str(_u.port or 5432),
            # Supabase / Render PostgreSQL requires SSL.
            # DB_SSLMODE can override this (e.g. "disable" for local testing
            # with a DATABASE_URL).  The local DB_* path never sets OPTIONS
            # so the existing Windows desktop connection is untouched.
            "OPTIONS": {
                "sslmode": os.getenv("DB_SSLMODE", "require"),
            },
        }
    }
else:
    # ── Local desktop path — unchanged from original configuration ────────────
    DATABASES = {
        "default": {
            "ENGINE":   "django.db.backends.postgresql",
            "NAME":     os.getenv("DB_NAME", "popmyc_pos"),
            "USER":     os.getenv("DB_USER", "postgres"),
            "PASSWORD": os.getenv("DB_PASSWORD", "changeme"),
            "HOST":     os.getenv("DB_HOST", "localhost"),
            "PORT":     os.getenv("DB_PORT", "5432"),
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]   # popmyc_admin.css and other project-level statics
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.CustomUser"

AUTHENTICATION_BACKENDS = (
    "django.contrib.auth.backends.ModelBackend",
    "guardian.backends.ObjectPermissionBackend",
)

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=24),   # 24h — full working day without re-login
    "REFRESH_TOKEN_LIFETIME": timedelta(days=90),   # 90 days — long-lived refresh for POS usage
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "AUTH_HEADER_NAME": "HTTP_AUTHORIZATION",
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        # Desktop dev origins + Render backend + Render PWA static site.
        # When you buy a domain, add it via the CORS_ALLOWED_ORIGINS env var
        # on the Render backend service (no code change needed).
        "http://localhost:5173,http://localhost:3000,http://127.0.0.1:8000,"
        "https://popmyc-pos.onrender.com,"
        "https://popmyc-poos-app.onrender.com",
    ).split(",")
    if origin.strip()
]

CORS_ALLOW_CREDENTIALS = True

SPECTACULAR_SETTINGS = {
    "TITLE": "POPMyC POS API",
    "DESCRIPTION": "Point of Sale System API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

# ============================================================
# POPMYC POS CLOUD SYNCHRONIZATION
# ============================================================

SYNC_CLOUD_URL = os.environ.get(
    "SYNC_CLOUD_URL",
    ""
)

# ── Shared sync token ──────────────────────────────────────────────────────────
# This token is the shared secret between Render (cloud) and every local POS.
# It is set as an environment variable on Render and written to each local
# .env by pg_setup.py during installation.
# Local POS devices send: Authorization: Bearer <SYNC_CLOUD_TOKEN>
# The SyncTokenAuthentication backend in synchronization/views.py validates it.
SYNC_CLOUD_TOKEN = os.environ.get(
    "SYNC_CLOUD_TOKEN",
    "WS1qTCN7vP8m6ziVLhZDMIckd5QGoAtaERfbupney2gXJO9w",   # default matches installer
)

# ── Cloud licensing service URL ────────────────────────────────────────────────
# Used by SetupRunView._verify_cloud_reservation() during the first-run
# cloud TrialCode activation handshake (Phase 1.5).
#
# Production default: the live Render deployment.
# Overrideable via the CLOUD_SETUP_URL environment variable — useful for
# development, staging, or testing against a local Django instance.
#
# Security:
#   - This is a URL only. No credential, token, or secret is stored here.
#   - The local POS backend sends only the opaque reservation token to this
#     URL and receives only {valid: bool}. Nothing else is transmitted.
#   - Normal POS API traffic never uses this URL.
#   - Only contacted once during the first-run Setup Wizard activation.
CLOUD_SETUP_URL = os.environ.get(
    "CLOUD_SETUP_URL",
    "https://popmyc-pos.onrender.com",   # production default — no credential
)
