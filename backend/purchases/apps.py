from django.apps import AppConfig


class PurchasesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "purchases"
    verbose_name = "Purchases"

    def ready(self):
        # Connect the stock-out auto-stamp signal
        from purchases.signals import connect_signals
        connect_signals()
