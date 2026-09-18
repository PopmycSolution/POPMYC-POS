"""
cloud/tests/test_models.py
==========================
Unit tests for cloud model methods and properties.
No HTTP — exercises model logic directly.
"""

import pytest
from django.test import TestCase
from django.contrib.auth import get_user_model

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


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_user(username="testuser", **kwargs):
    return User.objects.create_user(
        username=username,
        password="TestPass123!",
        email=f"{username}@example.com",
        **kwargs,
    )


def make_business(name="Acme Store", owner=None):
    return Business.objects.create(name=name, owner=owner)


def make_branch(business, name="Main", code="MAIN"):
    return Branch.objects.create(business=business, name=name, code=code)


def make_membership(user, business, role=BusinessMembership.RoleLabel.CASHIER,
                    status=BusinessMembership.MemberStatus.ACTIVE,
                    pwa_access=False, branch_access_all=True):
    return BusinessMembership.objects.create(
        user=user,
        business=business,
        role_label=role,
        status=status,
        pwa_access=pwa_access,
        branch_access_all=branch_access_all,
    )


# ══════════════════════════════════════════════════════════════════════════════

class TestCloudProfile(TestCase):

    def setUp(self):
        self.user = make_user("alice")

    def test_get_or_create_creates_profile(self):
        profile = CloudProfile.get_or_create_for(self.user)
        self.assertEqual(profile.user, self.user)
        self.assertFalse(profile.pwa_access_enabled)
        self.assertEqual(profile.account_status, CloudProfile.AccountStatus.ACTIVE)

    def test_get_or_create_is_idempotent(self):
        p1 = CloudProfile.get_or_create_for(self.user)
        p2 = CloudProfile.get_or_create_for(self.user)
        self.assertEqual(p1.pk, p2.pk)

    def test_touch_updates_last_cloud_activity(self):
        profile = CloudProfile.get_or_create_for(self.user)
        self.assertIsNone(profile.last_cloud_activity)
        profile.touch()
        profile.refresh_from_db()
        self.assertIsNotNone(profile.last_cloud_activity)

    def test_suspended_profile_str(self):
        profile = CloudProfile.get_or_create_for(self.user)
        profile.account_status = CloudProfile.AccountStatus.SUSPENDED
        profile.save()
        self.assertIn("alice", str(profile))


class TestCloudBusinessProfile(TestCase):

    def setUp(self):
        self.owner = make_user("owner")
        self.business = make_business(owner=self.owner)

    def test_cloud_uid_mirrors_business_id(self):
        profile = CloudBusinessProfile.get_or_create_for(self.business)
        self.assertEqual(profile.cloud_uid, self.business.id)

    def test_get_or_create_is_idempotent(self):
        p1 = CloudBusinessProfile.get_or_create_for(self.business)
        p2 = CloudBusinessProfile.get_or_create_for(self.business)
        self.assertEqual(p1.pk, p2.pk)

    def test_is_cloud_active_false_by_default(self):
        profile = CloudBusinessProfile.get_or_create_for(self.business)
        self.assertFalse(profile.is_cloud_active)

    def test_is_cloud_active_true_when_active(self):
        profile = CloudBusinessProfile.get_or_create_for(self.business)
        profile.cloud_status = CloudBusinessProfile.CloudStatus.ACTIVE
        profile.save()
        self.assertTrue(profile.is_cloud_active)


class TestBusinessMembership(TestCase):

    def setUp(self):
        self.user     = make_user("bob")
        self.business = make_business()

    def test_role_level_ordering(self):
        RL = BusinessMembership.RoleLabel
        owner      = make_membership(self.user, self.business, role=RL.OWNER)
        self.assertTrue(owner.has_min_role(RL.OWNER))
        self.assertTrue(owner.has_min_role(RL.SUPER_ADMIN))
        self.assertTrue(owner.has_min_role(RL.ADMIN))
        self.assertTrue(owner.has_min_role(RL.MANAGER))
        self.assertTrue(owner.has_min_role(RL.CASHIER))

    def test_cashier_cannot_reach_admin(self):
        RL = BusinessMembership.RoleLabel
        m  = make_membership(self.user, self.business, role=RL.CASHIER)
        self.assertFalse(m.has_min_role(RL.ADMIN))
        self.assertFalse(m.has_min_role(RL.MANAGER))
        self.assertTrue(m.has_min_role(RL.CASHIER))

    def test_is_active_false_when_suspended(self):
        m = make_membership(
            self.user, self.business,
            status=BusinessMembership.MemberStatus.SUSPENDED,
        )
        self.assertFalse(m.is_active)

    def test_can_access_pwa_requires_both_gates(self):
        profile = CloudProfile.get_or_create_for(self.user)
        m = make_membership(self.user, self.business, pwa_access=True)

        # User cloud gate closed
        profile.pwa_access_enabled = False
        profile.save()
        self.assertFalse(m.can_access_pwa)

        # Both open
        profile.pwa_access_enabled = True
        profile.save()
        self.assertTrue(m.can_access_pwa)

    def test_can_access_pwa_false_when_pwa_access_false(self):
        profile = CloudProfile.get_or_create_for(self.user)
        profile.pwa_access_enabled = True
        profile.save()
        m = make_membership(self.user, self.business, pwa_access=False)
        self.assertFalse(m.can_access_pwa)

    def test_unique_together_user_business(self):
        make_membership(self.user, self.business)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            BusinessMembership.objects.create(
                user=self.user,
                business=self.business,
                role_label=BusinessMembership.RoleLabel.ADMIN,
            )

    def test_touch_updates_last_activity(self):
        m = make_membership(self.user, self.business)
        self.assertIsNone(m.last_activity)
        m.touch()
        m.refresh_from_db()
        self.assertIsNotNone(m.last_activity)


class TestUserBranchAccess(TestCase):

    def setUp(self):
        self.user     = make_user("carol")
        self.business = make_business()
        self.branch   = make_branch(self.business)
        self.m        = make_membership(
            self.user, self.business,
            branch_access_all=False,
        )

    def test_can_access_branch_when_access_record_exists(self):
        UserBranchAccess.objects.create(
            membership=self.m, branch=self.branch, is_active=True,
        )
        self.assertTrue(self.m.can_access_branch(self.branch.id))

    def test_cannot_access_branch_without_record(self):
        self.assertFalse(self.m.can_access_branch(self.branch.id))

    def test_branch_access_all_bypasses_check(self):
        m2 = make_membership(make_user("dave"), self.business, branch_access_all=True)
        other_branch = make_branch(self.business, name="Branch 2", code="BR2")
        # No UserBranchAccess row needed
        self.assertTrue(m2.can_access_branch(other_branch.id))

    def test_inactive_branch_access_denied(self):
        UserBranchAccess.objects.create(
            membership=self.m, branch=self.branch, is_active=False,
        )
        self.assertFalse(self.m.can_access_branch(self.branch.id))


class TestCloudDevice(TestCase):

    def setUp(self):
        self.user     = make_user("eve")
        self.business = make_business()
        self.membership = make_membership(self.user, self.business)

    def test_token_hashing_and_verification(self):
        raw = CloudDevice.generate_token()
        device = CloudDevice(business=self.business, membership=self.membership)
        device.set_token(raw)
        # Raw token is not stored
        self.assertNotEqual(device.token_hash, raw)
        self.assertTrue(device.verify_token(raw))

    def test_wrong_token_rejected(self):
        raw = CloudDevice.generate_token()
        device = CloudDevice(business=self.business, membership=self.membership)
        device.set_token(raw)
        self.assertFalse(device.verify_token("wrong_token"))

    def test_revoke_clears_token_hash(self):
        raw = CloudDevice.generate_token()
        device = CloudDevice.objects.create(
            business=self.business,
            membership=self.membership,
            name="Test Device",
        )
        device.set_token(raw)
        device.save()
        device.revoke(revoked_by=self.user)
        device.refresh_from_db()
        self.assertEqual(device.token_hash, "")
        self.assertEqual(device.status, CloudDevice.DeviceStatus.REVOKED)
        self.assertEqual(device.revoked_by, self.user)

    def test_empty_token_hash_always_fails_verify(self):
        device = CloudDevice(token_hash="")
        self.assertFalse(device.verify_token("any_token"))


class TestCloudAuditLog(TestCase):

    def setUp(self):
        self.actor    = make_user("frank")
        self.target   = make_user("grace")
        self.business = make_business()

    def test_log_factory_creates_entry(self):
        entry = CloudAuditLog.log(
            action=CloudAuditLog.Action.MEMBER_ADDED,
            actor=self.actor,
            business=self.business,
            target_user=self.target,
            metadata={"role": "CASHIER"},
        )
        self.assertEqual(entry.action, CloudAuditLog.Action.MEMBER_ADDED)
        self.assertEqual(entry.actor, self.actor)
        self.assertEqual(entry.target_user, self.target)
        self.assertEqual(entry.metadata, {"role": "CASHIER"})

    def test_log_without_actor_is_system_event(self):
        entry = CloudAuditLog.log(
            action=CloudAuditLog.Action.BUSINESS_CLOUD_ACTIVATED,
            business=self.business,
        )
        self.assertIsNone(entry.actor)

    def test_audit_log_ordering_newest_first(self):
        CloudAuditLog.log(action=CloudAuditLog.Action.MEMBER_ADDED, actor=self.actor)
        CloudAuditLog.log(action=CloudAuditLog.Action.PWA_ENABLED, actor=self.actor)
        entries = list(CloudAuditLog.objects.all())
        self.assertEqual(entries[0].action, CloudAuditLog.Action.PWA_ENABLED)
