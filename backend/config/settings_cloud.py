"""
config/settings_cloud.py
========================
Cloud / Render production settings for POPMYC POS.

Extends base settings.py and adds the production-hardening that is
appropriate for a Render web service backed by Supabase PostgreSQL.

How it is loaded
----------------
Set the environment variable on Render:
    DJANGO_SETTINGS_MODULE=config.settings_cloud

Required environment variables on Render
-----------------------------------------
    DATABASE_URL          — Supabase / Render PostgreSQL connection string
    DJANGO_SECRET_KEY     — strong random secret key
    DJANGO_ALLOWED_HOSTS  — comma-separated, e.g. popmyc.onrender.com
    CSRF_TRUSTED_ORIGINS  — comma-separated https origins

Optional
---------
    DB_SSLMODE            — defaults to "require" when DATABASE_URL is set
    CLOUD_ENABLED         — set to True to enable cloud sync endpoints
    PWA_ENABLED           — set to True to enable PWA endpoints
    CORS_ALLOWED_ORIGINS  — comma-separated allowed CORS origins

What this module changes over base settings.py
-----------------------------------------------
- DEBUG is always False (hard-coded off in production)
- WhiteNoise middleware is inserted for static-file serving
- SECURE_PROXY_SSL_HEADER is set for Render's TLS termination proxy
- SESSION_COOKIE_SECURE and CSRF_COOKIE_SECURE are enabled
- All other settings (models, apps, auth, JWT, licensing, sync)
  are inherited unchanged from base settings.py.

Nothing here changes business logic, models, or the desktop workflow.
The desktop uses config.settings_desktop, never config.settings_cloud.
"""

import os
from .settings import *  # noqa: F401, F403 — inherit all base settings

# ── Security ──────────────────────────────────────────────────────────────────
DEBUG = False   # hard-off; never True in cloud production

# ALLOWED_HOSTS and CSRF_TRUSTED_ORIGINS are already read from env vars
# in base settings.py, so no override needed here.

# Trust the X-Forwarded-Proto header set by Render's TLS proxy.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Secure cookies for HTTPS-only cloud deployment.
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE    = True

# ── Static files — WhiteNoise ─────────────────────────────────────────────────
# Insert WhiteNoise immediately after SecurityMiddleware so it serves
# compressed, cached static files without a separate CDN/nginx.
_mw = list(MIDDLEWARE)  # noqa: F405 — inherited from base
_wn = "whitenoise.middleware.WhiteNoiseMiddleware"
if _wn not in _mw:
    _sec_idx = next(
        (i for i, m in enumerate(_mw) if "SecurityMiddleware" in m), 1
    )
    _mw.insert(_sec_idx + 1, _wn)
MIDDLEWARE = _mw

WHITENOISE_INDEX_FILE = True
WHITENOISE_ROOT       = str(BASE_DIR / "staticfiles")  # noqa: F405
WHITENOISE_MAX_AGE    = 86400   # 1-day browser cache for hashed assets

# PORT — Render sets the PORT env var; Waitress / gunicorn should read it.
# This constant is exposed here for the WSGI runner to reference if needed.
PORT = int(os.getenv("PORT", "8000"))
