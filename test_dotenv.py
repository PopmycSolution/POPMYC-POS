import sys
sys.path.insert(0, r"c:\xampp\htdocs\POS\backend")
from dotenv import dotenv_values

data_dir = sys.argv[1]
values = dotenv_values(f"{data_dir}/.env")

print("DB_NAME:           ", values.get("DB_NAME"))
print("DB_USER:           ", values.get("DB_USER"))
print("DB_PORT:           ", values.get("DB_PORT"))
print("DJANGO_SECRET_KEY: ", values.get("DJANGO_SECRET_KEY"))
print("DJANGO_DEBUG:      ", values.get("DJANGO_DEBUG"))
print("CLOUD_SETUP_URL:   ", values.get("CLOUD_SETUP_URL"))

sk = values.get("DJANGO_SECRET_KEY", "")
bad = set(sk) & set('$^!`"\\|&<>')
print("SECRET_KEY bad chars:", bad if bad else "NONE OK")
print("All keys loaded:", list(values.keys()))
