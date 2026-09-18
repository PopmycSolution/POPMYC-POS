# POPMYC Retail POS - Security Architecture

## Document Overview
- **Document ID**: POPMYC-SEC-001
- **Version**: 1.0.0
- **Status**: DRAFT
- **Last Updated**: 2026-09-04
- **Classification**: Internal / Confidential for Licensees

---

## 1. Security Philosophy & Principles

POPMYC Retail POS is a point-of-sale and financial-accounting platform that processes money, personally identifiable customer information, prescription data (pharmacies), and IMEI/serial-tracked device data. A breach of any of these classes would create direct financial loss, regulatory exposure to the Ghana Data Protection Commission (GDPC, Act 843), and reputational loss to the retailer.

Our security posture is built on these foundational principles:

1. **Defense in depth (layers)**: No single control is the only one. Even if the web-layer firewall fails, the app must enforce RBAC and per-row business scoping; even if that fails, DB permissions restrict what the app user can read.
2. **Zero trust for the LAN**: In a supermarket LAN, any till is a potentially compromised device. All API calls are authenticated and authorized individually. LAN IP whitelisting is a convenience, NOT a security boundary.
3. **Least privilege by default**: A new User without role assignments sees nothing. Permissions are additive (granted, not denied). The DB role used by the Django app CANNOT `DROP TABLE` or `ALTER SCHEMA`.
4. **Auditable first, then convenient**: Every money movement, stock write-off, login, and backup-restore writes an immutable audit trail. Convenience (e.g., a quick refund in the POS) NEVER wins over traceability.
5. **Ghana regulations aligned**: Respect the Data Protection Act, 2012 (Act 843) regarding collection/processing/retention of customer data, and GRA requirements for gapless invoice archival.
6. **Secure defaults, optional hardening**: The default single-PC deployment config applies CSP, HSTS, password hashing, audit logging, and TLS. Documentation tells admin how to increase posture (2FA, cert pinning, offline backup encryption passphrase).

---

## 2. Threat Model (STRIDE + Impact / Likelihood)

| Threat | Component | Impact | Likelihood | Controls |
|--------|-----------|--------|------------|----------|
| S **Spoofing cashier identity** | Login / POS unlock | High (theft via refunds) | Medium | JWT+refresh HTTPOnly, PIN unlock, TOTP for high-value actions, LoginSession kill |
| T **Tamper sale amount** | Client → Server API | Critical (stock/financial falsification) | Medium | Server re-computes ALL totals (never trust client sums), signature on sale payload, role gating on price/discount overrides |
| T **Tamper stock qty directly in DB** | PostgreSQL | Critical (inventory fraud) | Low | App DB user has no INSERT/UPDATE on Inventory directly; all writes via StockMovement trigger; DB-level trigger blocks manual UPDATE on Inventory |
| R **Repudiate a refund** | Payments / Audit log | High (dispute with customer) | Low | Refund requires reason + photo upload option; immutable AuditLog with before/after |
| I **Info-leak other Business data** (shared instance) | Multi-business isolation | Critical | Medium | `TenancyScopedManager` ORM filter, middleware re-check, DB RLS policy (Stage 01 via view, Stage 03 native PG RLS), CI tests assert zero cross-business rows |
| I **Plaintext MoMo API secrets** (Stage 02+) | Config | Critical | Low | All secrets in .env file (never repo), OS-level file permissions 0600, optional OS keyring |
| D **DOS by cashier abuse** (rapid void attempts) | API | Low-Medium | Medium | DRF rate limits by user/IP/endpoint; captcha on 5 login failures |
| E **Eavesdrop LAN till → server traffic** | Network | High (customer PII + passwords) | Low-Medium (LAN hub/malicious device) | Mandatory TLS self-signed CA to all terminals; no HTTP :80 except redirect |
| E **SQL injection** | ORM → DB | Critical | Low | Parameterised queries only (Django ORM + raw with %s params); no f-string SQL; CI blacklist |
| E **XSS in customer notes / receipt print** | Frontend rendering | High (session hijack) | Medium | React auto-escape by default + DOMPurify on any `dangerouslySetInnerHTML` (receipt HTML render) + CSP |
| E **CSRF between admin dashboard tabs** | Session / cookie | Medium | Medium | Double-submit CSRF cookie for non-JWT forms; JWT refresh endpoint requires CSRF token |
| E **Backup left on public share** | Backup files | Critical (full DB dump) | Medium | Backup files AES-256-GCM encrypted with admin passphrase (not hardcoded key), SHA-256 integrity, strict NTFS ACLs |
| E **Phishing BusinessOwner for password** | Login | High | Medium | Password length/complexity, TOTP MFA on BusinessOwner/Accountant/SuperAdmin, account lockout, GeoIP/LAN IP change alert email |
| E **Stolen till laptop (w/ IndexedDB PII)** | Offline storage | High | Low-Medium | IndexedDB at-rest encryption with per-terminal key derived from user PIN + terminal UUID; remote logout wipes local data on next connect; disk-level BitLocker required |
| E **Privilege escalation: Cashier → Manager role** | Role API | Critical | Low | Role-assignment endpoint requires two-eye approval AND `users.grant_permission` perm; immutable AuditLog + email to BusinessOwner |
| E **Return fraud: return same phone twice** | Sale Return + IMEI table | High | Medium | IMEI.status state machine + UNIQUE constraint per business_id on (imei1, status='INSTOCK'); second return blocked |

---

## 3. Authentication Architecture

### 3.1 Authentication Factors (Stage 01)
- **Something you know (Password)**: Django default PBKDF2 password hasher, reconfigured iterations + algorithm.
- **Something you know (PIN)**: 4-6 digit numeric for POS terminal unlock (not login; login requires password).
- **Something you have (TOTP, optional)**: RFC 6238 time-based one-time password (Google Authenticator / Authy / Microsoft Authenticator) — required for any user with role holding `backup.restore`, `payment.refund_above_1000`, `users.grant_permission`, `accounting.journal.post` perms.
- **Something you are**: Biometric fingerprint (future Stage 02 via Windows Hello on till PC).

### 3.2 Password Hashing — Implementation Details

**Algorithm**: Django PBKDF2 wrapper configured explicitly to:
- `PBKDF2_HMAC_SHA512` (not default SHA256 for NIST PUB 800-132 compliance upgrade)
- **Iterations**: **600,000** (OWASP 2023 minimum for PBKDF2-HMAC-SHA256 was 600,000; SHA512 similar magnitude, slower ASIC resistance).
- Salt length: 22 random chars, unique per password hash, stored alongside per Django convention.
- Hash format in `password_hash` column:
  `pbkdf2_sha512$600000$base64salt$base64hash` (Django format, algorithm prefix self-describing so future migration to Argon2id is seamless via hash upgrading).

**PIN Hashing**: Same algorithm, separate `pin_hash` column, min iterations 300,000, salt unique.

**Password Policy** (enforced backend + frontend, no bypass):
- Min length: 10 characters.
- Max length: 128 characters (no arbitrary upper to avoid DoS via PBKDF2; cap at 128 because bcrypt truncates at 72 anyway; PBKDF2 doesn't truncate but we still cap).
- Required classes: at least 1 UPPER, 1 lower, 1 digit. Symbol optional (to avoid "sticky note passwords" in busy shops).
- Blocklisted passwords: top 100,000 breached passwords from HIBP v8 list, bundled in a compressed bloom filter (1MB, 0.1% false positive) at deploy. On create/change password: check against bloom, then (if match) online k-anonymity HIBP API (optional, requires internet; failure → non-blocking warning).
- Password rotation: NOT forced by default (NIST 800-63B). Forced rotation ONLY for Auditor role (180 days) and if password found in breach list at login.
- Reuse history: last 24 passwords hashed retained; cannot reuse.

**Login Flow**:
1. User POST `{username, password}` to `/api/v1/auth/login/`.
2. Rate limit: 5 attempts per IP per 10 minutes. After 5 → HTTP 429, lock for 10 minutes.
3. Backend verifies password via Django `check_password`. If algorithm is outdated (older iteration count or SHA256), **rehash silently** with new settings and UPDATE row.
4. If password matches but user has TOTP required (`totp_secret` non-null) → respond `{ "mfa_required": true, "challenge_id": uuid }` without JWT.
5. If no MFA (or MFA verified via `POST /auth/mfa/totp` with correct 6-digit code):
   - Generate `access_jwt` (HS256, 15 min validity, claim: `{sub, business_id, branch_id, active_roles[], scope_idents[]}`).
   - Generate `refresh_jwt` (HS512, 7-day sliding, claim: `{sub, session_uuid}`).
   - Write row to `login_sessions`: `refresh_token_hash = SHA256(raw_refresh_token)`, `user_id`, `business_id`, `ip_address`, `user_agent`, `terminal_uuid?`.
   - Set HTTPOnly Secure SameSite=Lax cookie: `popmyc_refresh=raw_refresh_jwt; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`.
   - Set HTTPOnly Secure CSRF double-submit cookie: `popmyc_csrf=<32-char-random>; Path=/; Max-Age=…`.
   - Return body: `{ access: "<JWT>", expires_in: 900, user: {…}, selected_business: {…}, active_branch: {…}, csrf_token: "<same as cookie for first-boot JS pickup>" }`.
6. Session sliding: every use of a valid (non-expired) refresh token → `last_seen_at = now(); expires_at = now() + 7d`.
7. Explicit logout POST `/api/v1/auth/logout/` (requires CSRF) → UPDATE login_sessions SET status='LOGGED_OUT', revoked_at=now(). Delete cookies.
8. Remote logout (admin action): User Management → Revoke Session → updates session to REVOKED; any refresh against a REVOKED session → 401 + wipe cookies.

### 3.3 JWT Implementation Details
- **Signing algorithm**: Access = HS256 with per-deployment secret `DJANGO_SECRET_KEY` (rotatable); Refresh = HS512 with separate key `JWT_REFRESH_SECRET_KEY` so compromise of access key doesn't mint new refresh tokens.
- **Access token audience**: `aud = "popmyc-api"`, `iss = "popmyc-<instance-id>"`. Validated both.
- **JWT ID (jti)**: UUID per access token; NOT stored server-side (stateless for scale in future). Revocation relies on short 15-min validity + session refresh token.
- **Token transport**:
  - Access token: **Authorization: Bearer <token> header ONLY**. Never in localStorage (XSS risk); kept in Zustand in-memory store, lost on browser refresh, silently reacquired via `/api/v1/auth/refresh/` (cookie-based refresh).
  - Refresh token: HTTPOnly Secure cookie (not readable by JS).
  - CSRF token: double-submit cookie pattern + `X-CSRFToken` header required for POST/PUT/PATCH/DELETE state-changing calls (even JWT requests — because cookies are sent automatically; protects against CSRF).
- **Token rotation**: Each successful refresh → old refresh token hash invalidated (login_sessions new row), new refresh JWT + new session UUID returned. Prevents reuse of stolen old refresh JWT.
- **Clock skew tolerance**: 30 seconds (SimpleJWT default). Server time synchronised via NTP to `time.google.com`.

---

## 4. Authorization Model: RBAC + Fine-Grained Permissions

### 4.1 Permission Model Formalism
POPMYC uses an RBAC model of `User --has_many--> Roles --has_many--> Permissions`, scoped by Business (roles are per-business).

A **Permission** in the system is a triple `(resource, action, constraint?)` represented as a dot-codename string: `<app>.<entity>_<action>`. Examples:
- `sale.create` — can create new sales.
- `sale.price_override` — can edit line unit_price on POS (beyond lookup from DB).
- `sale.discount_above_10pct` — can grant >10% discount without override.
- `stock.adjust` — can create StockAdjustment DRAFT.
- `stock.adjust.approve` — can POST StockAdjustment if value > GHS 500.
- `stock.transfer.approve` — can approve cross-branch transfer.
- `payment.refund` — can refund any payment; with threshold permission `payment.refund_above_1000` requires TOTP re-verify at action time.
- `accounting.journal.post` — can post manual JournalEntry (critical because it directly changes P&L).
- `backup.restore` — can upload and restore DB (CRITICAL; requires TOTP + dual approval for Enterprise tier).
- `backup.download` — can download encrypted backups (default only BusinessOwner + SuperAdmin).
- `report.view_profit_loss` — can see P&L.
- `report.view_cost_of_goods` — can see unit costs (competitively sensitive). Cashier sees only selling price.
- `users.grant_permission` — can edit role assignments. (Dual-control: if granting `BUSINESS_OWNER` role, must email another existing owner for approval within 24h.)
- `customers.export_all` — can export entire customer list (GDPC consent logging required).
- `audit_log.view` — can search/read AuditLog (Auditor role + BusinessOwner only).

### 4.2 Authorization Enforcement Points (Layered)
1. **Router / React Router loader**: Frontend hides UI elements if user lacks permission (never trust; UX convenience only).
2. **DRF View permission_classes**: `permissions.IsAuthenticated`, `HasBusinessScope`, `HasAnyPerm(['sale.create'])`. Returns 403 before touching service layer.
3. **Service layer / Use case**: Explicit permission checks inside `atomic()` block with `user.has_perm(perm, obj?)`. Raises `PermissionDenied`. Service-level checks are the authoritative source of truth.
4. **Object-level permission gating**: Where needed (e.g. StockTransfer between branches) — check `user.employee.branch_id == transfer.from_branch_id OR user_has('stock.transfer.approve_all')`. Django Guardian may be introduced later; Stage 01: explicit code.
5. **Database RLS (hardened option)**: Stage 01 optional `ALTER TABLE <biz_table> ENABLE ROW LEVEL SECURITY; CREATE POLICY …` that enforces business_id scoping even if Django ORM has a bug. Documented in DEPLOYMENT.md hardening section. DB RLS disabled by default on single-PC deploy because it interacts poorly with pg_dump/restore of multiple businesses without superuser; recommended explicitly for multi-business shared instances.

### 4.3 Separation of Duties (Hard Constraints Backend Enforced)
- A single user cannot **both** create a StockAdjustment AND approve it (unless value < 500 AND BusinessOwner role). Enforced by comparing created_by vs approver_id.
- A single user cannot **both** create a manual JournalEntry AND post it (unless SUPERUSER / BusinessOwner with explicit override flag).
- A Cashier with `sale.create` CANNOT issue a REFUND unless also granted `payment.refund`.
- Employee who created an Expense cannot approve/reconcile it (expense approver permission).

---

## 5. Input Validation & Injection Defenses

### 5.1 Input Validation (Deny-by-Default)
Validation occurs at 3 layers with different purposes:
- **Browser (React Hook Form + Zod)**: Fast user feedback; prevent accidental bad input. (Not security.)
- **DRF Serializer**: Strict field types, length bounds, regex patterns, choice validators. (API contract + security.)
- **Django Model `.clean()` + DB constraints CHECK**: Last line of defense — invariants are persisted in DB so even a bug in serializer cannot write invalid rows. (Security + Data integrity.)

Examples of strict validation rules:
- Phone number: normalise to E.164 `^\+233[2-9]\d{8}$` for GH; allow `^\+[1-9]\d{6,14}$` for foreign.
- TIN: `^(GHA)?\d{7,11}$` (GRA format: GHA + 10 digits or bare 10 digits).
- GPS address: `^[A-Z]{1,3}-\d{1,4}-\d{1,5}$` (e.g. GA-123-4567).
- Currency amounts: reject NaN, reject > 100,000,000 GHS (fraud guard; configurable) — if BusinessOwner needs to exceed, must override in BusinessSettings with audit log.
- Percentages: 0 ≤ rate ≤ 1 (decimal).
- SKU/Barcode: `[A-Za-z0-9\-_./ ]{2,64}` (no control chars, no emoji — avoids barcode printer bugs and XSS-in-barcode edge cases).
- Customer notes length: max 2000 chars.
- Employee salary: >= 0, < 10,000,000 GHS / mo.
- Dates: DOB in reasonable range (1890+); expiry not before manufacture date.

### 5.2 SQL Injection Protection
- **Mandatory Rule**: No f-string SQL. No `.format()` SQL. Only:
  1. Django ORM QuerySet methods.
  2. `Model.objects.raw("SELECT … WHERE id = %s", [param])` — tuple/list params only, %s placeholders, no %(name)s expansion with user-supplied dict keys (keys not escaped).
  3. `cursor.execute("UPDATE … WHERE id=%(id)s", {"id": safe_int})` — named allowed, but values always via params dict, never concatenated.
- **Enforcement**:
  - pylint plugin with regex that flags `\.raw\([^)]*["'].*%(?!s\b)` — triggers on f-string or `.format()` before `.raw`.
  - CI step `grep -RP '\b(raw|execute)\s*\(\s*(f"|f\'"' backend/` fails build.
  - Stage 02+: database-only DB role for app with `GRANT SELECT, INSERT, UPDATE, DELETE ON …` — no DDL. If somehow raw SQL drops a table, fails.

### 5.3 Cross-Site Scripting (XSS)
- **Layer 1 — React default**: React escapes all interpolated values in JSX by default.
- **Layer 2 — Banned patterns**: `dangerouslySetInnerHTML` banned by eslint; only 2 allowed uses, wrapped with DOMPurify.sanitize() and code-reviewed:
  1. Printable receipt HTML preview (backend returns sanitised receipt template).
  2. Admin-created product rich description (stored as sanitised HTML; sanitised on write with Bleach library — allow-list tags `<b><i><u><ul><ol><li><br><p><a href>`).
- **Layer 3 — Content Security Policy (CSP)**: HTTP response header from nginx/django-csp-middleware:
  ```
  Content-Security-Policy:
    default-src 'self';
    script-src 'self' 'nonce-<per-request-random>' https://cdn.jsdelivr.net;
    style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;  (Tailwind + shadcn injects inline styles; nonce not feasible for build output; unsafe-inline acceptable when script-src is strict)
    img-src 'self' data: blob: https:;   (allow https product images imported from supplier webpages in future)
    font-src 'self' data: https://fonts.gstatic.com;
    connect-src 'self' https: ws://localhost:* wss:;   (companion service on localhost for printers, live reload websocket dev only)
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
    object-src 'none';
    upgrade-insecure-requests;
  ```
  Nonce per-request on `script-src` for admin pages; POS uses build-time hash-based allowlist.
- **Layer 4 — Cookie flags**: All cookies `Secure; HttpOnly; SameSite=Lax`. No session in JS-readable storage.
- **Layer 5 — Trusted Types** (Chrome/Edge): Enforce `Content-Security-Policy: require-trusted-types-for 'script'`; only DOMPurify exposes a policy for allowed HTML sinks.

### 5.4 CSRF (Cross-Site Request Forgery)
Given API is JWT + Bearer (not cookie), CSRF against JSON endpoints is traditionally considered low risk. However, we still use the double-submit cookie pattern because:
1. Refresh tokens live in cookies (refresh endpoint IS vulnerable if no CSRF).
2. Some older browsers + flash plugins CAN send cross-origin requests with custom Content-Type (historic).
3. Django `CsrfViewMiddleware` is well-audited.

Rules:
- All non-safe HTTP methods (POST/PUT/PATCH/DELETE) require `X-CSRFToken: <value>` header matching the `popmyc_csrf` cookie's value.
- CORS (see below) only allows configured origins.
- Login/logout/refresh endpoints additionally check `Origin` header matches `ALLOWED_HOSTS` or `CORS_ALLOWED_ORIGINS`.

### 5.5 CORS (Cross-Origin Resource Sharing)
- `CORS_ALLOWED_ORIGINS = [ <LAN server FQDN https://popmyc.local>, https://localhost:5173 (dev only, removed in prod settings by default) ]`.
- `CORS_ALLOW_CREDENTIALS = true` (required because refresh cookies; bearer token alone would allow `*`; we tighten).
- Never `CORS_ALLOW_ALL_ORIGINS = True` in production. Settings module asserts this and raises `ImproperlyConfigured` on boot if `DEBUG=False` and all origins are enabled.

---

## 6. Rate Limiting, DOS & Brute-Force Protection

Implemented via Django REST Framework throttling classes; overrides as follows:

| Scope | Throttle Rate | Purpose |
|-------|---------------|---------|
| `login_scope` | 5/min per IP | Password brute-force prevention |
| `mfa_scope` | 10/min per user | TOTP brute force → lock account 5 min after 10 fails |
| `pin_scope` | 10/min per terminal_uuid | POS PIN unlock attempt flood |
| `sale_write_scope` | 60/min per user | Stuck-loop or script flood of duplicate sales (client side bugs) |
| `refund_scope` | 5/min per user | Fraudulent rapid refund spree |
| `user_scope` (default) | 600/min per user | General write rate limit |
| `anon_scope` (default) | 30/min per IP | Unauthenticated traffic (health checks, auth endpoints) |
| `admin_scope` | 120/min per user | Admin CRUD operations |
| `ip_scope` (global) | 2000/min per IP | Any individual IP (misconfigured POS scanning) |

Throttling responses return HTTP 429 `Retry-After: <seconds>`, JSON body with error code `RATE_LIMITED`, log a WARNING to audit log with user/IP/endpoint. For 3+ throttled 429s in 5 min → emit in-app Notification to instance SuperAdmin.

Additionally:
- Fail2ban (Windows equivalent via NSSM service `wail2ban.ps1` or `Cyberarms`) for repeated login 401/429 → Windows Firewall block IP 1 hour.
- POS client exponential backoff on 429 (client retry after Retry-After header; NEVER tight-loop).

---

## 7. Audit Logging, Non-Repudiation & Integrity

### 7.1 What is Logged
AuditLog table columns described in DATABASE_DESIGN.md. The matrix:

| Category | Event Type | Examples | Severity |
|----------|------------|----------|----------|
| Auth | LOGIN, LOGIN_FAIL, LOGOUT, SESSION_REVOKED, MFA_FAIL, MFA_SUCCESS, PASSWORD_CHANGE, TOTP_ENABLE, TOTP_DISABLE, USER_LOCKED, USER_UNLOCKED | — | INFO → ERROR |
| User/Role management | CREATE/UPDATE/DELETE on users, roles, user_roles, permissions granted | — | INFO / WARNING for grant of high-value perms |
| Financial | CREATE on payments, refunds, supplier_payments, expenses, incomes, JournalEntry POST, reconciliation, Currency revalue | — | INFO / ERROR on failures |
| Stock | CREATE on StockMovement (all 15 types), StockTransfer SEND/RECEIVE, StockAdjustment APPROVE/REJECT, StockCount APPROVE, WRITE-OFF, LOST_STOLEN incident created | — | INFO / CRITICAL for LOST_STOLEN > threshold |
| Sales | Sale COMPLETE, Sale VOID, SaleReturn POST, price_override (>20% delta from DB price), discount (>15% from default), held sale expired without recovery | — | INFO / WARNING for overrides |
| Data access | customers.export_all, products.export_all, audit_log.view queries, backup.download | — | WARNING+ (trace export recipient & timestamp) |
| Data destruction | SOFT_DELETE/HARD_DELETE on business data (customer, product, supplier), Backup record DELETED, PURGE of old AuditLog | — | ERROR / CRITICAL for hard deletes |
| System | BACKUP success/failure, BACKUP RESTORE ATTEMPT/COMPLETE/FAIL, DB schema migration applied, License EXPIRED/SUSPENDED/RENEWED, MoMo gateway DOWN/UP | — | INFO → CRITICAL (RESTORE = CRITICAL) |

### 7.2 How AuditLog is Protected
- **Immutability at DB level**: PostgreSQL rule/trigger: `CREATE RULE audit_log_no_change AS ON UPDATE TO audit_log DO INSTEAD NOTHING; CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;` — only a schema owner/superuser (not the app DB user) can drop the rule or DELETE/TRUNCATE.
- **Retention**: 7 years default (tax audits). BusinessSetting `audit.retention_months` overrides; min 12 months enforced by check constraint.
- **Purging**: Automated purge job requires SuperAdmin + BusinessOwner dual approval (two tokens to fire, within 1 h window) AND backup taken before purge (enforced in purge service code — if last backup older than 24 hours, abort).
- **Integrity chaining**: Optional HMAC chain. Each AuditLog row after insert computes `row_hmac = HMAC-SHA256( concat(id::text, timestamp, business_id, before_jsonb::text, after_jsonb::text, prev_row_hmac), AUDIT_HMAC_KEY )`. `AUDIT_HMAC_KEY` stored outside DB in OS keyring or .env file (NOT same as DJANGO_SECRET_KEY). Third-party auditor can verify chain has not been tampered with. (Stage 01: disabled by default; enable via BusinessSetting `audit.enable_hmac_chain=true`.)

---

## 8. Secret Management & Environment Variables

### 8.1 .env File Standard
Backend root: `.env` (git-ignored via `.gitignore`), frontend root: `.env.local` (git-ignored). An example `.env.example` is committed with placeholders, documented, NO real values. Example:

```dotenv
# .env.example  -- DO NOT commit real secrets. Copy to .env and edit.
# === Django core ===
DJANGO_SECRET_KEY=<generate via: python -c "import secrets; print(secrets.token_urlsafe(64))">
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,popmyc.local,192.168.1.100
DJANGO_CSRF_TRUSTED_ORIGINS=https://popmyc.local,https://192.168.1.100

# === Database ===
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=popmyc
DB_USER=popmyc_app
DB_PASSWORD=<strong random 24 chars>
DB_SSLMODE=disable   # use require for networked DB

# === JWT ===
JWT_REFRESH_SECRET_KEY=<different from DJANGO_SECRET_KEY; 64 bytes>
JWT_ACCESS_LIFETIME_SECONDS=900
JWT_REFRESH_LIFETIME_SECONDS=604800

# === Audit / Backup ===
AUDIT_HMAC_KEY=<optional HMAC chain; 64 bytes hex>
BACKUP_ENCRYPTION_PEPPER=<global pepper appended to admin passphrase-derived key; 32 bytes hex>
BACKUP_RETENTION_DAILY_DAYS=30
BACKUP_RETENTION_WEEKLY_MONTHS=12

# === Hardware companion service ===
COMPANION_SERVICE_TOKEN=<shared token between React SPA and localhost companion; 32 bytes>
COMPANION_SERVICE_PORT=17099
COMPANION_SERVICE_ALLOW_ORIGINS=https://popmyc.local,https://localhost

# === Stage 02+: MoMo gateways ===
HUBTEL_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
HUBTEL_CLIENT_SECRET=<HIGHLY CONFIDENTIAL; restrict via OS ACL to backend user only>
FLUTTERWAVE_PUBLIC_KEY=FLWPUBK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X
FLUTTERWAVE_SECRET_KEY=FLWSECK-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx-X

# === Email (optional) ===
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=yourshop@gmail.com
EMAIL_HOST_PASSWORD=<google-app-password-not-account-password>
EMAIL_USE_TLS=true

# === SMS (optional; Mnotify / Hubtel) ===
MNOTIFY_API_KEY=<api key>
MNOTIFY_SENDER_ID=MYSHOP
```

### 8.2 File Permission & Storage Rules (Windows + Linux)
- `.env` file: NTFS ACL → allow only the Windows service user (e.g. `NT SERVICE\popmyc-django`) + Administrators (Read). Deny Everyone else. In PowerShell:
  ```powershell
  $acl = Get-Acl .env
  $acl.SetAccessRuleProtection($true,$false)
  $admins = New-Object System.Security.Principal.NTAccount("BUILTIN","Administrators")
  $svc = New-Object System.Security.Principal.NTAccount("NT SERVICE","popmyc-django")
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($admins,"Read","Allow")))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($svc,"Read","Allow")))
  Set-Acl .env $acl
  ```
- Never `.env.*` uploaded to any cloud storage via scheduled backup; backup scripts explicitly exclude `.env` (they encrypt DB dump, but config must be re-entered on restore — acceptable tradeoff to stop MoMo secret theft via stolen backup).

### 8.3 Database Credentials — Principle of Least Privilege
- **Superuser role (`postgres`)**: Used by deployment / migration scripts ONLY (pg_dump, restore, CREATE EXTENSION, DDL). Never by Django runtime.
- **Migration role (`popmyc_migrator`)**: OWNER of all tables, can CREATE/ALTER/DROP. Used only by `python manage.py migrate` in CI / deploy.
- **App role (`popmyc_app`)**: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO popmyc_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public;`. No DDL. No access to `pg_authid` etc.
- **Read-only role (`popmyc_auditor`)**: SELECT-only on business-scoped tables + audit_log. Used by reporting tool only.

---

## 9. Backup Encryption, Storage & Restore Safety

### 9.1 Encryption Algorithm
Each backup produced by `backups.services.create_backup()` is:
1. Exported via `pg_dump -Fc --no-owner --no-privileges -d popmyc > plain.dump`.
2. Compute `plain_sha256 = sha256(plain.dump)`. Store in `backups.plaintext_sha256`.
3. Derive encryption key: `KDF(passphrase, salt) = PBKDF2-HMAC-SHA512(passphrase || BACKUP_ENCRYPTION_PEPPER, salt, iterations=200000, dkLen=32 bytes)`. Salt = 16 random bytes per backup. Pepper = global `.env` value (backup files alone cannot be brute-forced if pepper unknown).
4. Encrypt `plain.dump` with `AES-256-GCM(key, random_12_byte_nonce, AAD = business_id || version || timestamp)`. Append header `POPMYCBACKUPv1 || salt(16) || nonce(12) || version(2 bytes) || AAD_metadata_len || AAD_metadata_json || ciphertext || tag(16 bytes)`.
5. Compute `encrypted_sha256 = sha256(final_file)`; store in DB.
6. Write final file with extension `.popbak` (not plain `.sql` or `.dump` to avoid accidental double-click restore).

### 9.2 Restore Process
- Restore UI (admin only, requires TOTP + user has `backup.restore` perm):
  1. Upload `.popbak`.
  2. Enter passphrase (used in step 3 above).
  3. Backend reads header, derives key, decrypts, verifies AES-GCM tag (tamper = abort).
  4. Pre-flight checks:
     - Decrypted file size < target DB disk free × 2.
     - PostgreSQL version compatible (backup taken on PG16, target PG16+).
     - Target DB: if non-empty → show warning and require typing "I ACCEPT DESTRUCTION OF EXISTING DATA FOR BUSINESS #X" into confirmation box.
     - Optional checksum: if user provides `plain_sha256` (from old DB Backup row), re-compute and match (early tamper detection).
  5. Take **a fresh auto backup of the current DB first** ("safety backup") before running `pg_restore`. Save auto safety backup for 30 days.
  6. `pg_restore --no-owner --no-privileges --single-transaction -j 4 -d popmyc_temp_decrypt < plain.dump`. If succeeds, atomically rename tables (via ALTER TABLE … RENAME or swap schema search_path — safer approach: point app to new schema `restored_20260904` and set default). Do NOT drop original until admin confirms OK.
  7. After restore: run 3 integrity check queries → pass/fail. Emit CRITICAL AuditLog with business_id, user_id, source backup id, safety backup id, SHA256s, and duration. Email all BusinessOwners for that business.

### 9.3 Backup Storage Hardening
- 3-2-1 rule minimum:
  1. Local SSD primary (default `C:\ProgramData\POPMYC\Backups\`)
  2. Network share (e.g. `\\NAS01\Backups\POPMYC\`) — different storage media.
  3. Offline rotation: weekly backup copied to encrypted USB drive that admin takes home. Drive uses BitLocker/AES-256 hardware encryption.
- NTFS ACLs on backup folder: only Admin user + Django service user Read/Write. Till-user accounts have NO access to the backup folder.

---

## 10. Session Management & Secure Client-Side Storage

### 10.1 Session Cookies (Same-as JWT Section 3, Summarized)
| Cookie | Size | Secure | HttpOnly | SameSite | Max-Age | Path |
|--------|------|--------|----------|----------|---------|------|
| `popmyc_access` | NOT STORED | — | — | — | — | — |  (access in Zustand in-memory only; lifetime 15 min in RAM) |
| `popmyc_refresh` | ~600 bytes JWT | YES | YES | Lax | 604800 (7d) | / |
| `popmyc_csrf` | 32 chars | YES | NO (JS reads to set header) | Lax | 604800 | / |
| `popmyc_biz` | 4 bytes business_id | YES | NO | Lax | 604800 | / |
| `popmyc_theme` | 6 bytes | YES | NO | Lax | 31536000 | / | (non-sensitive) |

- TLS-only deployment: all cookies have `Secure` flag. Redirect all HTTP `:80` → HTTPS `:443` with `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2 years HSTS for LAN admin to enable; browser remembers never to use HTTP).
- Frontend POS idle timeout: configurable BusinessSetting `security.pos_idle_minutes` (default 5 min). After no user input, Zustand in-memory access JWT is erased; POS screen locks to PIN re-entry. If user remains idle for 30 min, send refresh token to logout endpoint (explicit session termination).

### 10.2 IndexedDB (Offline-First) Storage Encryption
IndexedDB on each POS terminal holds:
- Full product catalog (100k SKUs) — low sensitivity.
- Offline queued sales/payments — medium; contains customer phone, line items.
- Customer records cached — medium sensitivity (PII).
- Open login session fingerprint.

For deployments processing pharmaceutical or device IMEI data:
- Enable per-terminal IndexedDB encryption via `BusinessSetting security.indexeddb_aes_gcm = true`.
- Key derivation: `terminal_enc_key = HMAC-SHA256( USER_PIN_HASH_SERVER_RETURNED_AT_LOGIN + TERMINAL_UUID + JWT_ACCESS_SIGNATURE_SUBSTRING )`. Server returns a derived salt at login (never reuses the JWT directly; PBKDF2 50k iter).
- Encrypt object stores: `sales`, `payments`, `customers`, `held_sales`, `stock_adjustments` at rest in IndexedDB via wrapper library `dexie-encrypted`.
- Remote logout or idle 30 min → wipe encrypted keys from memory; IndexedDB rows become opaque until next login unlock.
- Administrative Windows hardening: Enable BitLocker on till PC's system volume. Mandatory in DEPLOYMENT.md security baseline.

---

## 11. GDPR-like / Ghana Data Protection Act 843 Compliance

### 11.1 Data Categories & Consent
| Data | Basis under DPA 843 | Retention | Right To Erase |
|------|---------------------|-----------|-----------------|
| Customer: name, phone, email | Legitimate interest (accounting records, return processing) + explicit consent for SMS marketing | Indefinite (required for accounting/tax 7 year min) | Refusable (only delete where not required for tax. Allow "anonymise" that zeros phone/name and keeps aggregated totals) |
| Customer: GPS address, DOB | Consent (optional profile enrichment) | Until withdrawal | Delete within 30 days of request |
| Customer SMS/Email opt-in | Explicit opt-in; double opt-in best practice | Until opt-out | Honour within 24 h (backend: customers.opt_in_sms = false) |
| Employee: name, TIN (payroll), national ID | Employment contract + tax law | 7 years post termination | No (tax law retain) |
| AuditLog rows including customer phone read access | Legitimate interest (fraud prevention, dispute resolution) | 7 years | Review (not erase; audit integrity required by law) |
| Login IP/user agent | Legitimate interest (security) | 1 year | Anonymise after 1 year |

### 11.2 Rights Implementation in Product (Stage 01)
- **Right of Access (SAR)**: Admin → Tools → Data Subject Request → Enter customer phone → Generate ZIP export of: profile fields JSON, all sale PDFs, all loyalty history CSV, messages sent. Produce within 10 business days (DPA allows up to 30; we aim for 10).
- **Right to Rectification**: Edit customer profile (AuditLog entry recorded with before/after).
- **Right to Erasure**: "Anonymise customer" action: replaces `full_name = "Deleted Customer <UUID>"`, phone=NULL, email=NULL, address/gps=NULL, TIN=NULL; keeps sale rows (foreign keys intact to anonymised record). AuditLog records the erasure action. Rejects erasure if any sale has balance_due > 0 or pending warranty claim.
- **Right to Data Portability**: SAR export also includes CSV/JSON formats machine-readable.
- **Consent management**: "Marketing opt-in" checkbox on customer creation; list view filter to suppress opt-outs from SMS blast (future).

---

## 12. Secure Development & CI/CD Controls

### 12.1 Git & Pre-commit
- `.gitignore` includes: `.env`, `.env.local`, `*.popbak`, `*.dump`, `media/backups/*`, `**/node_modules`, `__pycache__/`, `*.pem`, `id_rsa`, `.vscode/settings.json` (may have secrets).
- Pre-commit hooks for both frontend + backend:
  - `detect-secrets` (Yelp/detect-secrets) — High entropy string scan for AWS keys, MoMo secrets. Scans staged files; blocks commit if any candidate found. False positives audited in `.secrets.baseline` file (committed and code-reviewed).
  - `bandit` — Python security scanner (SQL injection, eval, pickle, subprocess shell=True, hardcoded temp dirs, weak hash). Fail build on `bandit -r backend/` any severity HIGH.
  - `eslint-plugin-security` + `@typescript-eslint/no-unsafe-* strict` — JS/TS unsafe patterns.
  - `semgrep` — custom rules: "dangerouslySetInnerHTML without DOMPurify", "JWT stored in localStorage", "fetch credentials=include without CSRF header".
  - `gitleaks` (on commit + pre-push) — Historical repo secret scan.

### 12.2 CI Pipeline (GitHub Actions / GitLab CI)
| Step | Tool | Gate |
|------|------|------|
| 1 | `python -m pytest --cov=backend --cov-fail-under=75` | Fail if coverage drops |
| 2 | `pytest -m "security"` — security-specific tests (cross-business isolation test, SQL injection fuzz, permission matrix, password hash validation, JWT expiry, backup encrypt/decrypt roundtrip) | All green |
| 3 | `bandit -r backend -ll` (medium+) | 0 findings |
| 4 | `gitleaks detect --no-git` on repo checkout | 0 findings |
| 5 | `npm run build` + `npm run lint` + `npm run test:unit` + Playwright smoke (Stage 02) | All green |
| 6 | OSV / Dependabot / pip-audit / npm audit --audit-level=high | Block on HIGH CRITICAL CVEs in dependencies; no unfixed HIGH in prod bundle |
| 7 | Build Docker image + scan with Trivy or Grype | 0 HIGH/CRITICAL OS+pip+npm |
| 8 | (Stage 03 SaaS only) Zap Baseline API scan against staging environment | Risk code 0 HIGH |

### 12.3 Deployment Signing
- Windows installer (Inno Setup) code-signed with EV code-signing certificate (Sectigo/DigiCert) — avoids SmartScreen warnings for customers.
- Companion service executable code-signed; device driver for POS USB hardware signed with WHQL if distributing custom driver.

---

## 13. Incident Response & Security Patch SLA

### 13.1 Severity Matrix
| Severity | Definition | Example | Internal SLA | Customer SLA (notified) |
|----------|------------|---------|--------------|--------------------------|
| **CRITICAL** | Exploitable remotely, cross-business data leak, full DB RCE, backup encryption key disclosure, MoMo secret theft by unprivileged user | SQL injection found in production; Zero-day in Django allowing RCE | **4 hours to mitigation; 24 h to patch** | Notify within 24 hours |
| **HIGH** | Privilege escalation Cashier → Owner, till user accesses other branches' reports, XSS that bypasses CSP on admin | Stored XSS via product description editor | 24 h patch; 72 h rollout to all customers | Notify within 72 h |
| **MEDIUM** | CSRF on low-sensitivity endpoint, brute-force throttle bypass, info leak of internal version strings | 404 page leaks Django debug stack trace when DEBUG accidentally true on single deploy | 5 business days | Patch release notes only (no active notification) |
| **LOW** | Minor UI spoof (e.g. customer notes HTML stripped inconsistently), log format issue, dependency LOW CVE | Dependency CVE with no known exploit vector + requires browser extension | Next scheduled release | Included in patch notes |

### 13.2 Runbook Snippets
- **Incident: "Compromised Cashier Credentials — Suspected Refund Fraud"**:
  1. Security officer → User Admin → revoke all sessions for that user (one click).
  2. Lock user account (set locked_until = 1 year, is_active=false).
  3. AuditLog query: user_id, action IN (PAYMENT.REFUND, SALE.VOID), last 7 days → export to CSV → investigate. Match with camera footage / drawer variance.
  4. If MoMo fraud suspected (customer refunded to a personal number): immediately change MoMo API keys via Hubtel/Flutterwave dashboard (independent of POPMYC) then rotate `.env` secrets.
  5. If any customer PII exported: comply with DPA 843 breach notification within 72 hours to affected individuals + GDPC.

---

## 14. Hardware & Physical (Brief)
- Till PC: BIOS password. Auto-login ONLY to a restricted Windows standard-user account (NOT Local Admin). UAC enabled.
- USB ports: restrict via Group Policy — allow only specific VID/PID of barcode scanner, printer, scale. Block USB mass storage. Disable CD/DVD boot.
- Server room / back office PC: locked cabinet. No unauthorised USB. CCTV retained 30 days.
- Receipt paper: do not print FULL customer phone on receipt (mask middle digits `024***6789`). Full number on customer copy of invoice only when required by GRA (tax invoice threshold).

---

## 15. Security Review & Maintenance Cadence

| Activity | Frequency | Owner | Artifact |
|----------|-----------|-------|----------|
| Dependency update audit (pip-audit + npm audit) | Weekly | Backend + Frontend lead | CI report |
| Penetration test (external) | Annual + after major release | 3rd party GRA/regulated partner + internal | Pen-test report, 30-day remediation plan |
| Threat model review | Every release major.minor | Architecture team | Updated this doc with new threats matrix |
| Backup restore drill (real) | Quarterly (min) | Release engineer + customer IT | Drill report signed by BusinessOwner; drill log in AuditLog |
| Role access review (least privilege attestation) | Quarterly | BusinessOwner (delegate) | Sign-off: list all users with role grants > Cashier, confirm need |
| Rotate DJANGO_SECRET_KEY, JWT_REFRESH_SECRET_KEY, MoMo secrets | Annual, or on staff departure (any engineer who had .env access) | DevOps | Change log, audit log event |
| Password policy audit (HIBP batch scan of password hashes — k-anonymity offline) | Annual | Security officer | Report: users with breached passwords → force change next login |

All security reviews, incident reports, and drill records stored in a secure repository with access limited to the security team and legal counsel.

---

## 16. Compliance Against Standards (Informative)

| Framework / Standard | Coverage (Stage 01) | Notes |
|----------------------|---------------------|-------|
| **OWASP Top 10 2021** | A01 Broken Access Control → RBAC + tenancy scoping. A02 Cryptographic Failures → TLS+HSTS+PBKDF2+AES backup. A03 Injection → ORM/parameterized + CSP. A04 Insecure Design → STRIDE threat model. A05 Misconfig → secure defaults, CSP, .env permissions. A06 Vulnerable Components → pip-audit. A07 Auth Failures → MFA, lockout, session sliding/revocation. A08 Integrity → HMAC audit chain, signed installers. A09 Logging → structured logs + audit. A10 SSRF → (Stage 02+ relevant only, MoMo webhook URL allow-listed) | |
| **PCI DSS (Level 4)** | Applicable to Stage 02 card-present track data. Stage 01: out of scope because card numbers are NOT stored — terminal-only processing via payment gateway SDK; PAN/Track data never traverses Django backend or logs. | Logs scrub any regex 13–19 digit PAN even if accidentally entered in notes field. |
| **Ghana DPA, 2012 (Act 843)** | Consent fields, SAR, rectification, erasure/anonymisation, breach 72-h notification plan. | |
| **ISO 27001 Annex A** | Policy docs (this + Incident Response), access control, cryptography, ops security, incident mgmt, backup, physical. | Partial. Full ISO 27001 Stage 03. |

This document is version-controlled alongside code. Any PR that introduces a new feature involving authentication, authorization, payments, customer data, or backup/restore MUST include an update to this document (security impact section) in the same PR, reviewed by at least one engineer NOT on the feature implementation team (separation of review duties).
