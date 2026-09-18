from django.contrib import admin
from employees.models import Employee, Shift, CashDrawerEvent


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ("employee_number", "user", "branch", "job_title", "status", "created_at")
    list_filter = ("business", "branch", "status", "created_at")
    search_fields = ("employee_number", "job_title", "user__username", "user__first_name", "user__last_name")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("user", "business", "branch", "allow_branches")


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = ("shift_number", "employee", "register", "status", "open_time", "close_time", "variance")
    list_filter = ("business", "branch", "status", "created_at", "open_time")
    search_fields = ("shift_number", "closing_note")
    readonly_fields = ("id", "created_at", "updated_at")
    raw_id_fields = ("register", "employee", "business", "branch")


@admin.register(CashDrawerEvent)
class CashDrawerEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "amount", "shift", "employee", "reference", "created_at")
    list_filter = ("business", "branch", "event_type", "created_at")
    search_fields = ("reason", "reference")
    readonly_fields = ("id", "created_at")
    raw_id_fields = ("shift", "business", "branch", "employee")
