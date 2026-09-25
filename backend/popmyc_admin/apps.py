from django.apps import AppConfig


class PopmycAdminConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "popmyc_admin"
    verbose_name = "POPMYC Admin"

    def ready(self):
        # 1. Import admin_site so popmyc_admin_site is created.
        from .admin_site import popmyc_admin_site  # noqa: F401

        # 2. Copy every ModelAdmin registered on the default admin.site into
        #    popmyc_admin_site.  All app admin.py files use @admin.register()
        #    which targets django.contrib.admin.site (the default).  We copy
        #    that registry here — after all apps are fully loaded — so the
        #    custom site shows exactly the same models without requiring any
        #    changes to existing admin.py files.
        #
        #    We copy rather than replace so that:
        #      - The default admin.site remains intact (used by Django internals)
        #      - No duplicate registrations occur (we only copy if not already
        #        registered on the custom site)
        from django.contrib import admin as _admin
        for model, model_admin in _admin.site._registry.items():
            if model not in popmyc_admin_site._registry:
                popmyc_admin_site._registry[model] = model_admin
