
import uuid
from django.db import models
from django.utils.translation import gettext_lazy as _
from decimal import Decimal

try:
    from jsonfield import JSONField
except ImportError:
    from django.db.models import JSONField


class Employee(models.Model):
    STATUS_CHOICES = (
        ("ACTIVE", _("Active")),
        ("INACTIVE", _("Inactive")),
        ("ON_LEAVE", _("On Leave")),
        ("TERMINATED", _("Terminated")),
        ("SUSPENDED", _("Suspended")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        "accounts.CustomUser",
        on_delete=models.CASCADE,
        related_name="employee_profile",
        null=True,
        blank=True,
    )
    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="employees",
    )
    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="employees",
    )
    employee_number = models.CharField(max_length=50)
    job_title = models.CharField(max_length=255, blank=True)
    date_of_joining = models.DateField(null=True, blank=True)
    salary = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    allow_branches = models.ManyToManyField(
        "branches.Branch",
        related_name="allowed_employees",
        blank=True,
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ACTIVE")
    emergency_contact = JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employees_employee"
        verbose_name = _("Employee")
        verbose_name_plural = _("Employees")
        unique_together = ("business", "employee_number")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["branch", "status"]),
        ]

    def __str__(self):
        name = self.user.get_full_name() if self.user else self.employee_number
        return f"{self.employee_number} - {name}"


class Shift(models.Model):
    STATUS_CHOICES = (
        ("OPEN", _("Open")),
        ("CLOSED", _("Closed")),
        ("FORCE_CLOSED", _("Force Closed")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    register = models.ForeignKey(
        "branches.Register",
        on_delete=models.CASCADE,
        related_name="employee_shifts",
    )

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name="shifts",
    )

    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="employee_shifts",
    )

    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="employee_shifts",
    )

    shift_number = models.CharField(max_length=50)
    open_time = models.DateTimeField()
    close_time = models.DateTimeField(null=True, blank=True)

    opening_float = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    closing_cash_counted = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        null=True,
        blank=True,
    )

    closing_cash_expected = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        null=True,
        blank=True,
    )

    variance = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
        null=True,
        blank=True,
    )

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="OPEN",
    )

    summary_json = JSONField(default=dict, blank=True)
    closing_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employees_shift"
        verbose_name = _("Shift")
        verbose_name_plural = _("Shifts")
        unique_together = ("business", "shift_number")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "status"]),
            models.Index(fields=["branch", "status"]),
            models.Index(fields=["employee", "status"]),
            models.Index(fields=["register", "status"]),
            models.Index(fields=["open_time", "close_time"]),
        ]

    def __str__(self):
        return f"Shift {self.shift_number} - {self.status}"


class CashDrawerEvent(models.Model):
    EVENT_TYPE_CHOICES = (
        ("OPEN", _("Open Drawer")),
        ("CASH_IN", _("Cash In")),
        ("CASH_OUT", _("Cash Out")),
        ("NO_SALE", _("No Sale")),
        ("PAYIN", _("Pay In")),
        ("PAYOUT", _("Pay Out")),
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    shift = models.ForeignKey(
        Shift,
        on_delete=models.CASCADE,
        related_name="cash_drawer_events",
    )

    business = models.ForeignKey(
        "businesses.Business",
        on_delete=models.CASCADE,
        related_name="cash_drawer_events",
    )

    branch = models.ForeignKey(
        "branches.Branch",
        on_delete=models.CASCADE,
        related_name="cash_drawer_events",
    )

    employee = models.ForeignKey(
        Employee,
        on_delete=models.CASCADE,
        related_name="cash_drawer_events",
    )

    event_type = models.CharField(
        max_length=20,
        choices=EVENT_TYPE_CHOICES,
    )

    amount = models.DecimalField(
        max_digits=15,
        decimal_places=2,
        default=Decimal("0.00"),
    )

    reason = models.TextField(blank=True)
    reference = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employees_cash_drawer_event"
        verbose_name = _("Cash Drawer Event")
        verbose_name_plural = _("Cash Drawer Events")
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["business", "event_type"]),
            models.Index(fields=["branch", "event_type"]),
            models.Index(fields=["shift", "event_type"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        return f"{self.event_type} - {self.amount}"
