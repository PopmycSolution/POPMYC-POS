"""
purchases/signals.py
====================

Stock-out detection signal.

When products.Batch.qty_remaining reaches zero AND stock_out_date is not yet
set, automatically stamp stock_out_date = now().

This covers ALL paths that decrement a batch's qty_remaining:
  - Sales that reference a batch
  - Stock adjustments that reference a batch
  - Any direct save on Batch

Connected in purchases/apps.py → ready() method.
"""
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


def _check_batch_stock_out(sender, instance, **kwargs):
    """
    Stamp stock_out_date on a Batch when qty_remaining first reaches zero.
    Does nothing if:
      - qty_remaining > 0  (still in stock)
      - stock_out_date already set  (don't overwrite)
      - qty_remaining is None  (untracked batch)
    """
    if (
        instance.qty_remaining is not None
        and instance.qty_remaining <= 0
        and instance.stock_out_date is None
    ):
        # Use update() to avoid triggering this signal again
        from products.models import Batch
        Batch.objects.filter(pk=instance.pk).update(stock_out_date=timezone.now())
        # Refresh the in-memory instance so callers see the updated value
        instance.stock_out_date = timezone.now()


def connect_signals():
    """
    Connect the stock-out signal.
    Called from purchases.apps.PurchasesConfig.ready().
    """
    from products.models import Batch
    post_save.connect(_check_batch_stock_out, sender=Batch,
                      dispatch_uid="batch_stock_out_detector")
