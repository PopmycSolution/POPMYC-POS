"""
config/settings_desktop.py
==========================
Desktop production settings for POPMYC POS.

Extends base settings.py and overrides only the values that differ
between the development server and the Windows desktop application.

How it is loaded
----------------
The Electron launcher sets:
    DJANGO_SETTINGS_MODULE=config.settings_desktop

What it changes over the base settings
---------------------------------------
- DEBUG = False  (always)
- WhiteNoise middleware for static file serving (serves the built React SPA)
- STATIC_ROOT / STATICFILES_DIRS point to the packaged frontend dist/
- ALLOWED_HOSTS restricted to localhost only (desktop never needs external hosts)
- Data directory read from POPMYC_DATA_DIR env var (set by the launcher)
  so logs, media, and backups land in %APPDATA%/POPMYC POS/ not in the
  application install directory (which may be wiped on update)
- CORS is tightened (localhost:8000 only — frontend is served from Django)
- Celery/Redis are made optional — the desktop sync works over HTTP without
  Celery; Celery tasks simply won't run if Redis is absent

Nothing here changes models, business logic, or the existing sync system.
"""

import os
from pathlib import Path
from .settings import *  # noqa: F401, F403  — import all base settings

# ---------------------------------------------------------------------------
# Core security — hard-off for production
# ---------------------------------------------------------------------------

DEBUG = False

# The desktop app only ever talks to itself on localhost.
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

# ---------------------------------------------------------------------------
# Persistent data directory
# ---------------------------------------------------------------------------
# The launcher sets POPMYC_DATA_DIR to the user's data folder, e.g.
#   Windows: C:\Users\<name>\AppData\Roaming\POPMYC POS\
# Falling back to BASE_DIR keeps things working for developers who run
# settings_desktop.py directly without the launcher.

_DATA_DIR = Path(os.environ.get("POPMYC_DATA_DIR", str(BASE_DIR / "desktop_data")))  # noqa: F405
_DATA_DIR.mkdir(parents=True, exist_ok=True)

MEDIA_ROOT = _DATA_DIR / "media"
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

LOGS_DIR = _DATA_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

BACKUPS_DIR = _DATA_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Static files — WhiteNoise serves the built React SPA from Django
# ---------------------------------------------------------------------------
# After `npm run build`, the dist/ output is copied into STATIC_ROOT by the
# desktop build script. WhiteNoise compresses and caches these files.

STATIC_ROOT = BASE_DIR / "staticfiles"  # noqa: F405  — collected here by collectstatic
STATIC_URL = "/static/"

# WhiteNoise also serves files from STATICFILES_DIRS at the root URL,
# which is how the React SPA (index.html, assets/) is reachable at /.
STATICFILES_DIRS = []  # collectstatic handles everything

# Insert WhiteNoise middleware immediately after SecurityMiddleware.
# Position 1 keeps the order: CORS → Security → WhiteNoise → …
_mw = list(MIDDLEWARE)  # noqa: F405
_wn_cls = "whitenoise.middleware.WhiteNoiseMiddleware"
if _wn_cls not in _mw:
    _sec_idx = next(
        (i for i, m in enumerate(_mw) if "SecurityMiddleware" in m), 1
    )
    _mw.insert(_sec_idx + 1, _wn_cls)
MIDDLEWARE = _mw

WHITENOISE_INDEX_FILE = True          # serve index.html for /
WHITENOISE_ROOT = str(STATIC_ROOT)    # root directory to serve from
WHITENOISE_MAX_AGE = 86400            # 24h browser cache for assets

# ---------------------------------------------------------------------------
# CORS — desktop frontend is served from the same Django origin
# ---------------------------------------------------------------------------
# The built React SPA is at http://localhost:8000/ and calls /api/v1/...
# on the same host. No cross-origin requests are needed in desktop mode.
CORS_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

# ---------------------------------------------------------------------------
# Database — read from env (set by launcher from the user's data dir .env)
# ---------------------------------------------------------------------------
# The base settings.py already reads DB_* from .env via python-dotenv.
# The desktop launcher loads the correct .env before starting Django,
# so no further override is needed here.

# ---------------------------------------------------------------------------
# Logging — write to persistent data directory
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {
            "format": "{levelname} {asctime} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "simple",
        },
        "desktop_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(LOGS_DIR / "popmyc_desktop.log"),
            "maxBytes": 10 * 1024 * 1024,  # 10 MB
            "backupCount": 5,
            "formatter": "verbose",
        },
    },
    "root": {
        "handlers": ["console", "desktop_file"],
        "level": "WARNING",
    },
    "loggers": {
        "django": {
            "handlers": ["console", "desktop_file"],
            "level": "WARNING",
            "propagate": False,
        },
        "synchronization": {
            "handlers": ["console", "desktop_file"],
            "level": "INFO",
            "propagate": False,
        },
        "backups": {
            "handlers": ["console", "desktop_file"],
            "level": "INFO",
            "propagate": False,
        },
    },
}

# ---------------------------------------------------------------------------
# Celery — gracefully degrade when Redis is unavailable on the desktop
# ---------------------------------------------------------------------------
# Redis is not required for the desktop's offline POS operation.
# If Redis is not running, Celery tasks simply won't execute — the core
# POS, inventory, sales, and sync-over-HTTP all continue working.
# The launcher checks Redis availability and sets this flag accordingly.
CELERY_TASK_ALWAYS_EAGER = os.environ.get("POPMYC_CELERY_EAGER", "True") == "True"
CELERY_TASK_EAGER_PROPAGATES = False  # Don't raise task exceptions synchronously

# ---------------------------------------------------------------------------
# Security headers — appropriate for localhost desktop app
# ---------------------------------------------------------------------------
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "SAMEORIGIN"

# Do NOT enable HTTPS-only settings (SECURE_SSL_REDIRECT etc.) — the desktop
# app runs over plain HTTP on localhost. HTTPS termination is not needed for
# a locally-bound service that never leaves the machine.
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
