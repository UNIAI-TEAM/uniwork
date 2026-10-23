package service

import (
	"errors"
	"testing"
)

// Audit "Security & privacy", privacy-defaults-off: every member reads the
// organization's floor under their phone's app lock and screen-capture
// choices; only an owner or admin changes it, one field at a time, and only a
// real change is audited.
func TestMobileSecurityPolicyIsReadByMembersAndSetByOwnersAndAdmins(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	f.addMember(t)
	on, off := true, false
	rows := func() int {
		t.Helper()
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'organization.mobile_security_policy_changed' AND organization_id = $1`, f.orgID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	p, err := f.orgs.MobileSecurityPolicy(f.ctx, f.member.ID, f.orgID)
	if err != nil || p.RequireAppLock || p.BlockScreenCapture || p.CanManage {
		t.Fatalf("member reads the default: %+v %v", p, err)
	}
	if _, err := f.orgs.SetMobileSecurityPolicy(f.ctx, f.member.ID, f.orgID, MobileSecurityPolicyChange{RequireAppLock: &on}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member sets: %v, want ErrForbidden", err)
	}
	if _, err := f.orgs.MobileSecurityPolicy(f.ctx, f.third.ID, f.orgID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider reads: %v, want ErrForbidden", err)
	}

	p, err = f.orgs.SetMobileSecurityPolicy(f.ctx, f.owner.ID, f.orgID, MobileSecurityPolicyChange{RequireAppLock: &on})
	if err != nil || !p.RequireAppLock || p.BlockScreenCapture || !p.CanManage || rows() != 1 {
		t.Fatalf("owner requires the lock: %+v %v rows=%d", p, err, rows())
	}
	// The other field is left as it is, and a repeat writes no second row.
	p, err = f.orgs.SetMobileSecurityPolicy(f.ctx, f.owner.ID, f.orgID, MobileSecurityPolicyChange{RequireAppLock: &on})
	if err != nil || !p.RequireAppLock || rows() != 1 {
		t.Fatalf("repeat: %+v %v rows=%d", p, err, rows())
	}
	p, err = f.orgs.SetMobileSecurityPolicy(f.ctx, f.owner.ID, f.orgID, MobileSecurityPolicyChange{BlockScreenCapture: &on})
	if err != nil || !p.RequireAppLock || !p.BlockScreenCapture || rows() != 2 {
		t.Fatalf("owner blocks capture: %+v %v rows=%d", p, err, rows())
	}
	p, err = f.orgs.MobileSecurityPolicy(f.ctx, f.member.ID, f.orgID)
	if err != nil || !p.RequireAppLock || !p.BlockScreenCapture || p.CanManage {
		t.Fatalf("member reads both: %+v %v", p, err)
	}
	p, err = f.orgs.SetMobileSecurityPolicy(f.ctx, f.owner.ID, f.orgID, MobileSecurityPolicyChange{RequireAppLock: &off, BlockScreenCapture: &off})
	if err != nil || p.RequireAppLock || p.BlockScreenCapture || rows() != 3 {
		t.Fatalf("owner lifts both: %+v %v rows=%d", p, err, rows())
	}
	var by *string
	if err := f.pool.QueryRow(f.ctx, `SELECT mobile_app_lock_required_by FROM organizations WHERE id = $1`, f.orgID).Scan(&by); err != nil || by != nil {
		t.Fatalf("lifting clears who set it: %v %v", by, err)
	}
}
