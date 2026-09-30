from django.apps import AppConfig


class SynchronizationConfig(AppConfig):
    name = "synchronization"
    verbose_name = "Synchronization"

    def ready(self):
        # Connect cloud-push signals so admin changes on Render automatically
        # queue SyncRecords that the local POS downloads on its next sync cycle.
        # This is the mechanism that makes cloud admin changes take effect locally.
        try:
            from synchronization.cloud_signals import connect_signals
            connect_signals()
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(
                "Could not connect cloud sync signals (non-fatal): %s", exc
            )
