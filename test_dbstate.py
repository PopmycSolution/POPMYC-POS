import sys, os
sys.path.insert(0, r"c:\xampp\htdocs\POS\backend")
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
import django; django.setup()

from businesses.models import Business
from branches.models import Branch
from django.contrib.auth import get_user_model
from licensing.models import License

User = get_user_model()

print("=== Dev database state ===")
print("Businesses:        ", Business.objects.count())
print("Branches:          ", Branch.objects.count())
print("Users w/ business: ", User.objects.filter(business__isnull=False).count())
print("Active licenses:   ", License.objects.filter(status=License.Status.ACTIVE).count())
print()
print("=== Business names ===")
for b in Business.objects.all():
    print(" -", b.name, "(id:", str(b.id)[:8], ")")
print()
print("=== Users ===")
for u in User.objects.all():
    print(" -", u.username, "| business:", u.business_id is not None)
