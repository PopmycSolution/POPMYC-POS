"""
cloud/tests/test_api.py
=======================
Integration tests for the cloud API endpoints.

Coverage:
  - Authentication required
  - Business isolation (user A cannot access business B)
  - Membership role enforcement
  - Branch access enforcement
  - Device registration and revocation
  - Audit log access control
  - PWA context structure
  - Cross-business membership creation rejected
  - Suspended/removed member access rejected
"""

import uuid
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status

from businesses.models import Business
from branches.models import Branch
from cloud.models import (
    CloudProfile,
    CloudBusinessProfile,
    BusinessMembership,
    UserBranchAccess,
    CloudDevice,
    CloudAuditLog,
)

User = get_user_model()


# ── Fixtures ──────────────────────────────────────────────────────────────────

def make_user(username, password="TestPass123!", **kwargs):
    return User.objects.create_user(
        username=username, password=password,
        email=f"{username}@example.com", **kwargs,
    )


def make_business(name="Acme", owner=None):
    return Business.objects.create(name=name, owner=owner)


def make_branch(business, name="Main", code=None):
    code = code or name[:6].upper()
    return Branch.objects.create(business=business, name=name, code=code)


def make_membership(user, business, role=BusinessMembership.RoleLabel.CASHIER,
                    pwa_access=True, branch_access_all=True,
                    status=BusinessMembership.MemberStatus.ACTIVE):
    return BusinessMembership.objects.create(
        user=user, business=business, role_label=role,
        pwa_access=pwa_access, branch_access_all=branch_access_all,
        status=status,
    )


def make_cloud_profile(user, pwa_enabled=True,
                       account_status=CloudProfile.AccountStatus.ACTIVE):
    profile = CloudProfile.get_or_create_for(user)
    profile.pwa_access_enabled = pwa_enabled
    profile.account_status = account_status
    profile.save()
    return profile


def get_jwt(client, username, password="TestPass123!"):
    resp = client.post(
        "/api/v1/auth/login/",
        {"username": username, "password": password},
        format="json",
    )
    return resp.data.get("access", "")


def authed_client(user, password="TestPass123!"):
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ══════════════════════════════════════════════════════════════════════════════
# Auth / access control
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestCloudAuthentication(TestCase):

    def test_unauthenticated_status_returns_401(self):
        c = APIClient()
        resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_unauthenticated_account_returns_401(self):
        c = APIClient()
        resp = c.get("/api/v1/cloud/account/")
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_user_without_cloud_profile_gets_access_denied(self):
        # A user with no CloudProfile (account_status default = ACTIVE after first call)
        # get_or_create_for auto-creates ACTIVE profile, so this tests suspended profile
        user = make_user("noprofile")
        profile = make_cloud_profile(user, account_status=CloudProfile.AccountStatus.SUSPENDED)
        c = authed_client(user)
        resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_active_user_can_access_status(self):
        user = make_user("active_user")
        make_cloud_profile(user)
        c = authed_client(user)
        resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertIn("user_id", resp.data)
        self.assertIn("server_time", resp.data)

    def test_status_response_shape(self):
        user = make_user("shape_user")
        make_cloud_profile(user)
        c = authed_client(user)
        resp = c.get("/api/v1/cloud/status/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for key in ("cloud_enabled", "pwa_access_enabled", "account_status",
                    "business_count", "active_memberships", "server_time"):
            self.assertIn(key, resp.data, f"Missing key: {key}")


# ══════════════════════════════════════════════════════════════════════════════
# Account / PWA context
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestCloudAccount(TestCase):
    def setUp(self):
        self.user    = make_user("pwa_user")
        self.profile = make_cloud_profile(self.user)
        self.client  = authed_client(self.user)
        self.biz     = make_business(owner=self.user)
        self.m       = make_membership(
            self.user, self.biz,
            role=BusinessMembership.RoleLabel.OWNER,
            pwa_access=True,
        )

    def test_get_account_returns_profile(self):
        resp = self.client.get("/api/v1/cloud/account/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(str(resp.data["user"]["id"]), str(self.user.id))
        self.assertIn("pwa_access_enabled", resp.data)

    def test_patch_pwa_access_enabled(self):
        resp = self.client.patch(
            "/api/v1/cloud/account/",
            {"pwa_access_enabled": False},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.data["pwa_access_enabled"])

    def test_non_superuser_cannot_change_account_status(self):
        resp = self.client.patch(
            "/api/v1/cloud/account/",
            {"account_status": "SUSPENDED"},
            format="json",
        )
        # Request succeeds but account_status is silently ignored
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["account_status"], "ACTIVE")

    def test_my_businesses_returns_memberships(self):
        resp = self.client.get("/api/v1/cloud/account/businesses/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["role_label"], "OWNER")

    def test_pwa_context_structure(self):
        resp = self.client.get("/api/v1/cloud/account/pwa-context/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        for key in ("user_id", "username", "pwa_access_enabled",
                    "account_status", "businesses"):
            self.assertIn(key, resp.data, f"Missing key: {key}")
        self.assertEqual(len(resp.data["businesses"]), 1)
        biz = resp.data["businesses"][0]
        for key in ("business_id", "business_name", "role", "pwa_access",
                    "branches", "pwa_modules"):
            self.assertIn(key, biz, f"Missing business key: {key}")

    def test_my_businesses_excludes_removed_memberships(self):
        other_biz = make_business(name="Other Co")
        make_membership(
            self.user, other_biz,
            status=BusinessMembership.MemberStatus.REMOVED,
        )
        resp = self.client.get("/api/v1/cloud/account/businesses/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        biz_ids = [b["business_id"] for b in resp.data]
        self.assertNotIn(str(other_biz.id), biz_ids)


# ══════════════════════════════════════════════════════════════════════════════
# Business isolation
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestBusinessIsolation(TestCase):

    def setUp(self):
        # Business A and its owner
        self.user_a  = make_user("user_a")
        self.biz_a   = make_business(name="Biz A", owner=self.user_a)
        make_cloud_profile(self.user_a)
        make_membership(self.user_a, self.biz_a, role=BusinessMembership.RoleLabel.OWNER)
        self.client_a = authed_client(self.user_a)

        # Business B and its owner (different user)
        self.user_b  = make_user("user_b")
        self.biz_b   = make_business(name="Biz B", owner=self.user_b)
        make_cloud_profile(self.user_b)
        make_membership(self.user_b, self.biz_b, role=BusinessMembership.RoleLabel.OWNER)
        self.client_b = authed_client(self.user_b)

    def test_user_a_can_access_biz_a(self):
        resp = self.client_a.get(f"/api/v1/cloud/business/{self.biz_a.id}/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_user_a_cannot_access_biz_b(self):
        resp = self.client_a.get(f"/api/v1/cloud/business/{self.biz_b.id}/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_b_cannot_access_biz_a_members(self):
        resp = self.client_b.get(f"/api/v1/cloud/business/{self.biz_a.id}/members/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_b_cannot_access_biz_a_devices(self):
        resp = self.client_b.get(f"/api/v1/cloud/business/{self.biz_a.id}/devices/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_user_b_cannot_access_biz_a_audit(self):
        resp = self.client_b.get(f"/api/v1/cloud/business/{self.biz_a.id}/audit/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ══════════════════════════════════════════════════════════════════════════════
# Membership management
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestMembershipManagement(TestCase):

    def setUp(self):
        self.owner    = make_user("owner")
        self.biz      = make_business(owner=self.owner)
        make_cloud_profile(self.owner)
        self.owner_m  = make_membership(
            self.owner, self.biz,
            role=BusinessMembership.RoleLabel.OWNER,
        )
        self.owner_c  = authed_client(self.owner)

        # A regular cashier
        self.cashier  = make_user("cashier")
        make_cloud_profile(self.cashier)
        self.cashier_m = make_membership(
            self.cashier, self.biz,
            role=BusinessMembership.RoleLabel.CASHIER,
        )
        self.cashier_c = authed_client(self.cashier)

    def test_owner_can_list_members(self):
        resp = self.owner_c.get(f"/api/v1/cloud/business/{self.biz.id}/members/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 2)  # owner + cashier

    def test_cashier_can_list_members(self):
        # Cashier can list for coordination (view-only)
        resp = self.cashier_c.get(f"/api/v1/cloud/business/{self.biz.id}/members/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_cashier_cannot_add_member(self):
        new_user = make_user("newbie")
        resp = self.cashier_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/",
            {"user": str(new_user.id), "role_label": "CASHIER"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_owner_can_add_member(self):
        new_user = make_user("newbie2")
        make_cloud_profile(new_user)
        resp = self.owner_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/",
            {"user": str(new_user.id), "role_label": "CASHIER"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["role_label"], "CASHIER")

    def test_duplicate_membership_rejected(self):
        resp = self.owner_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/",
            {"user": str(self.cashier.id), "role_label": "ADMIN"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_adding_member_creates_cloud_profile(self):
        new_user = make_user("newbie3")
        self.assertFalse(CloudProfile.objects.filter(user=new_user).exists())
        self.owner_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/",
            {"user": str(new_user.id), "role_label": "CASHIER"},
            format="json",
        )
        self.assertTrue(CloudProfile.objects.filter(user=new_user).exists())

    def test_owner_can_change_role(self):
        resp = self.owner_c.patch(
            f"/api/v1/cloud/business/{self.biz.id}/members/{self.cashier_m.id}/",
            {"role_label": "MANAGER"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.cashier_m.refresh_from_db()
        self.assertEqual(self.cashier_m.role_label, "MANAGER")

    def test_role_change_creates_audit_log(self):
        self.owner_c.patch(
            f"/api/v1/cloud/business/{self.biz.id}/members/{self.cashier_m.id}/",
            {"role_label": "ADMIN"},
            format="json",
        )
        log = CloudAuditLog.objects.filter(
            action=CloudAuditLog.Action.ROLE_CHANGED,
            business=self.biz,
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.target_user, self.cashier)

    def test_owner_can_remove_member(self):
        resp = self.owner_c.delete(
            f"/api/v1/cloud/business/{self.biz.id}/members/{self.cashier_m.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.cashier_m.refresh_from_db()
        self.assertEqual(self.cashier_m.status, BusinessMembership.MemberStatus.REMOVED)

    def test_non_admin_cannot_remove_member(self):
        victim = make_user("victim")
        make_cloud_profile(victim)
        vm = make_membership(victim, self.biz, role=BusinessMembership.RoleLabel.CASHIER)
        resp = self.cashier_c.delete(
            f"/api/v1/cloud/business/{self.biz.id}/members/{vm.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_suspended_member_cannot_access_business(self):
        suspended = make_user("suspended")
        make_cloud_profile(suspended)
        make_membership(
            suspended, self.biz,
            role=BusinessMembership.RoleLabel.CASHIER,
            status=BusinessMembership.MemberStatus.SUSPENDED,
        )
        c = authed_client(suspended)
        resp = c.get(f"/api/v1/cloud/business/{self.biz.id}/members/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ══════════════════════════════════════════════════════════════════════════════
# Branch access
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestBranchAccess(TestCase):

    def setUp(self):
        self.owner  = make_user("branch_owner")
        self.biz    = make_business(owner=self.owner)
        make_cloud_profile(self.owner)
        self.owner_m = make_membership(
            self.owner, self.biz,
            role=BusinessMembership.RoleLabel.OWNER,
        )
        self.owner_c = authed_client(self.owner)

        self.branch1 = make_branch(self.biz, "Branch One", "BR1")
        self.branch2 = make_branch(self.biz, "Branch Two", "BR2")

        # Restricted user — branch_access_all=False
        self.restricted = make_user("restricted")
        make_cloud_profile(self.restricted)
        self.restricted_m = make_membership(
            self.restricted, self.biz,
            role=BusinessMembership.RoleLabel.CASHIER,
            branch_access_all=False,
        )
        self.restricted_c = authed_client(self.restricted)

    def test_owner_with_all_access_can_list_branches_in_pwa_context(self):
        resp = self.owner_c.get("/api/v1/cloud/account/pwa-context/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        branches = resp.data["businesses"][0]["branches"]
        branch_ids = [b["id"] for b in branches]
        self.assertIn(str(self.branch1.id), branch_ids)
        self.assertIn(str(self.branch2.id), branch_ids)

    def test_restricted_user_only_sees_granted_branches_in_pwa_context(self):
        # Grant access to branch1 only
        UserBranchAccess.objects.create(
            membership=self.restricted_m,
            branch=self.branch1,
            is_active=True,
        )
        resp = self.restricted_c.get("/api/v1/cloud/account/pwa-context/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        branches = resp.data["businesses"][0]["branches"]
        branch_ids = [b["id"] for b in branches]
        self.assertIn(str(self.branch1.id), branch_ids)
        self.assertNotIn(str(self.branch2.id), branch_ids)

    def test_admin_can_grant_branch_access(self):
        resp = self.owner_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/"
            f"{self.restricted_m.id}/branches/",
            {"branch": str(self.branch1.id)},
            format="json",
        )
        self.assertIn(resp.status_code, [
            status.HTTP_201_CREATED, status.HTTP_200_OK
        ])
        self.assertTrue(
            UserBranchAccess.objects.filter(
                membership=self.restricted_m,
                branch=self.branch1,
                is_active=True,
            ).exists()
        )

    def test_cannot_grant_branch_from_different_business(self):
        other_biz    = make_business(name="Other")
        other_branch = make_branch(other_biz, "Foreign", "FRN")
        resp = self.owner_c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/"
            f"{self.restricted_m.id}/branches/",
            {"branch": str(other_branch.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_can_revoke_branch_access(self):
        UserBranchAccess.objects.create(
            membership=self.restricted_m,
            branch=self.branch1,
            is_active=True,
        )
        resp = self.owner_c.delete(
            f"/api/v1/cloud/business/{self.biz.id}/members/"
            f"{self.restricted_m.id}/branches/{self.branch1.id}/"
        )
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        access = UserBranchAccess.objects.get(
            membership=self.restricted_m, branch=self.branch1
        )
        self.assertFalse(access.is_active)

    def test_non_admin_cannot_grant_branch_access(self):
        other_user = make_user("other_cashier")
        make_cloud_profile(other_user)
        other_m = make_membership(
            other_user, self.biz, role=BusinessMembership.RoleLabel.CASHIER
        )
        c = authed_client(other_user)
        resp = c.post(
            f"/api/v1/cloud/business/{self.biz.id}/members/"
            f"{self.restricted_m.id}/branches/",
            {"branch": str(self.branch1.id)},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)


# ══════════════════════════════════════════════════════════════════════════════
# Device registration
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestDeviceRegistration(TestCase):

    def setUp(self):
        self.owner  = make_user("device_owner")
        self.biz    = make_business(owner=self.owner)
        make_cloud_profile(self.owner)
        self.m      = make_membership(
            self.owner, self.biz, role=BusinessMembership.RoleLabel.OWNER
        )
        self.client = authed_client(self.owner)

    def test_register_device_returns_token_once(self):
        resp = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Till 1", "device_type": "POS_TERMINAL"},
            format="json",
        )
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertIn("token", resp.data)
        self.assertIn("device_uuid", resp.data)
        self.assertGreater(len(resp.data["token"]), 20)

    def test_token_not_stored_in_plaintext(self):
        resp = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Till 2", "device_type": "POS_TERMINAL"},
            format="json",
        )
        raw_token = resp.data["token"]
        device_uuid = resp.data["device_uuid"]
        device = CloudDevice.objects.get(device_uuid=device_uuid)
        # Token is hashed — never stored as plaintext
        self.assertNotEqual(device.token_hash, raw_token)
        self.assertTrue(device.verify_token(raw_token))

    def test_device_list_excludes_revoked(self):
        resp1 = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Active Device"},
            format="json",
        )
        device_id = str(CloudDevice.objects.get(
            device_uuid=resp1.data["device_uuid"]
        ).id)

        # Revoke it
        self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{device_id}/revoke/",
            format="json",
        )

        # Register another
        self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Active Device 2"},
            format="json",
        )

        resp_list = self.client.get(
            f"/api/v1/cloud/business/{self.biz.id}/devices/"
        )
        self.assertEqual(resp_list.status_code, status.HTTP_200_OK)
        names = [d["name"] for d in resp_list.data]
        self.assertNotIn("Active Device", names)
        self.assertIn("Active Device 2", names)

    def test_revoke_creates_audit_log(self):
        resp = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Revoke Me"},
            format="json",
        )
        device_id = str(CloudDevice.objects.get(
            device_uuid=resp.data["device_uuid"]
        ).id)
        self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/{device_id}/revoke/"
        )
        self.assertTrue(
            CloudAuditLog.objects.filter(
                action=CloudAuditLog.Action.DEVICE_REVOKED,
                business=self.biz,
            ).exists()
        )

    def test_revoked_device_cannot_re_register_same_uuid(self):
        resp = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Revoke Then Retry"},
            format="json",
        )
        device_uuid = resp.data["device_uuid"]
        device = CloudDevice.objects.get(device_uuid=device_uuid)
        device.revoke(revoked_by=self.owner)

        resp2 = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"device_uuid": device_uuid, "name": "Retry"},
            format="json",
        )
        self.assertEqual(resp2.status_code, status.HTTP_403_FORBIDDEN)

    def test_token_hash_not_in_device_list_response(self):
        self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Hash Check"},
            format="json",
        )
        resp = self.client.get(
            f"/api/v1/cloud/business/{self.biz.id}/devices/"
        )
        for device in resp.data:
            self.assertNotIn("token_hash", device)
            self.assertNotIn("token", device)

    def test_cashier_cannot_see_other_users_devices(self):
        cashier = make_user("cashier2")
        make_cloud_profile(cashier)
        cashier_m = make_membership(
            cashier, self.biz, role=BusinessMembership.RoleLabel.CASHIER
        )
        cashier_c = authed_client(cashier)

        # Owner registers a device (membership=owner's membership)
        self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "Owner Device"},
            format="json",
        )

        # Cashier lists devices — should only see their own
        resp = cashier_c.get(f"/api/v1/cloud/business/{self.biz.id}/devices/")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Cashier has no devices yet
        self.assertEqual(len(resp.data), 0)

    def test_device_belongs_to_correct_business(self):
        other_biz = make_business(name="Other Biz")
        other_user = make_user("other_owner2")
        make_cloud_profile(other_user)
        make_membership(other_user, other_biz, role=BusinessMembership.RoleLabel.OWNER)
        other_c = authed_client(other_user)

        # Register in own business
        resp = self.client.post(
            f"/api/v1/cloud/business/{self.biz.id}/devices/register/",
            {"name": "My Device"},
            format="json",
        )
        device_uuid = resp.data["device_uuid"]
        device = CloudDevice.objects.get(device_uuid=device_uuid)
        self.assertEqual(device.business, self.biz)

        # Other business owner cannot see this device
        resp2 = other_c.get(f"/api/v1/cloud/business/{other_biz.id}/devices/")
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        uuids = [d["device_uuid"] for d in resp2.data]
        self.assertNotIn(str(device_uuid), uuids)


# ══════════════════════════════════════════════════════════════════════════════
# Audit log access
# ══════════════════════════════════════════════════════════════════════════════

@override_settings(CLOUD_ENABLED=True)
class TestAuditLog(TestCase):

    def setUp(self):
        self.owner  = make_user("audit_owner")
        self.biz    = make_business(owner=self.owner)
        make_cloud_profile(self.owner)
        self.m      = make_membership(
            self.owner, self.biz, role=BusinessMembership.RoleLabel.OWNER
        )
        self.owner_c = authed_client(self.owner)

        self.cashier = make_user("audit_cashier")
        make_cloud_profile(self.cashier)
        make_membership(
            self.cashier, self.biz, role=BusinessMembership.RoleLabel.CASHIER
        )
        self.cashier_c = authed_client(self.cashier)

    def test_owner_can_read_audit_log(self):
        CloudAuditLog.log(
            action=CloudAuditLog.Action.MEMBER_ADDED,
            actor=self.owner,
            business=self.biz,
        )
        resp = self.owner_c.get(
            f"/api/v1/cloud/business/{self.biz.id}/audit/"
        )
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(resp.data), 1)

    def test_cashier_cannot_read_audit_log(self):
        resp = self.cashier_c.get(
            f"/api/v1/cloud/business/{self.biz.id}/audit/"
        )
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_audit_log_never_exposes_secrets(self):
        CloudAuditLog.log(
            action=CloudAuditLog.Action.DEVICE_REGISTERED,
            actor=self.owner,
            business=self.biz,
            metadata={"device_uuid": "some-uuid", "name": "Till 1"},
        )
        resp = self.owner_c.get(
            f"/api/v1/cloud/business/{self.biz.id}/audit/"
        )
        resp_str = str(resp.data)
        # Confirm no sensitive fields appear
        for forbidden in ("password", "token", "activation_code", "secret"):
            self.assertNotIn(forbidden, resp_str.lower())

    def test_cross_business_audit_access_rejected(self):
        other_owner = make_user("other_owner3")
        other_biz   = make_business(owner=other_owner)
        make_cloud_profile(other_owner)
        make_membership(
            other_owner, other_biz, role=BusinessMembership.RoleLabel.OWNER
        )
        other_c = authed_client(other_owner)
        resp = other_c.get(f"/api/v1/cloud/business/{self.biz.id}/audit/")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)
