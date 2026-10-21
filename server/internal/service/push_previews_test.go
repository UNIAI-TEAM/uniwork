package service

import (
	"errors"
	"testing"
)

// Audit "Security & privacy", push-preview-plaintext: a person hides the words
// of their chat pushes; an owner or admin hides them for the organization.
func TestSetPushPreviewsRecordsThePersonsChoiceOnce(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	rows := func() int {
		t.Helper()
		var n int
		if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'user.push_previews_changed' AND resource_id = $1`, f.member.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Shown by default: showing again changes nothing and writes nothing.
	u, err := f.auth.SetPushPreviews(f.ctx, f.member.ID, true)
	if err != nil || u.PushPreviewsHiddenAt.Valid || rows() != 0 {
		t.Fatalf("show by default: %+v %v rows=%d", u.PushPreviewsHiddenAt, err, rows())
	}
	u, err = f.auth.SetPushPreviews(f.ctx, f.member.ID, false)
	if err != nil || !u.PushPreviewsHiddenAt.Valid {
		t.Fatalf("hide: %+v %v", u.PushPreviewsHiddenAt, err)
	}
	if _, err := f.auth.SetPushPreviews(f.ctx, f.member.ID, false); err != nil {
		t.Fatal(err)
	}
	if n := rows(); n != 1 {
		t.Fatalf("rows after hide twice = %d, want 1", n)
	}
	u, err = f.auth.SetPushPreviews(f.ctx, f.member.ID, true)
	if err != nil || u.PushPreviewsHiddenAt.Valid || rows() != 2 {
		t.Fatalf("show again: %+v %v rows=%d", u.PushPreviewsHiddenAt, err, rows())
	}
	if _, err := f.auth.SetPushPreviews(f.ctx, "01NOSUCHUSER0000000000000", false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown user: %v, want ErrNotFound", err)
	}
}

func TestPushPreviewPolicyIsReadByMembersAndSetByOwnersAndAdmins(t *testing.T) {
	f := newAuditFixture(t)
	f.build(t)
	f.addMember(t)

	p, err := f.orgs.PushPreviewPolicy(f.ctx, f.member.ID, f.orgID)
	if err != nil || p.Hidden || p.CanManage || p.HiddenAt != nil {
		t.Fatalf("member reads the default: %+v %v", p, err)
	}
	if _, err := f.orgs.SetPushPreviewPolicy(f.ctx, f.member.ID, f.orgID, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member sets: %v, want ErrForbidden", err)
	}
	if _, err := f.orgs.PushPreviewPolicy(f.ctx, f.third.ID, f.orgID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider reads: %v, want ErrForbidden", err)
	}

	p, err = f.orgs.SetPushPreviewPolicy(f.ctx, f.owner.ID, f.orgID, true)
	if err != nil || !p.Hidden || !p.CanManage || p.HiddenAt == nil {
		t.Fatalf("owner hides: %+v %v", p, err)
	}
	// A repeat changes nothing and writes no second row.
	if _, err := f.orgs.SetPushPreviewPolicy(f.ctx, f.owner.ID, f.orgID, true); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events WHERE action = 'organization.push_preview_policy_changed' AND organization_id = $1`, f.orgID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("policy rows = %d, want 1", n)
	}
	p, err = f.orgs.PushPreviewPolicy(f.ctx, f.member.ID, f.orgID)
	if err != nil || !p.Hidden {
		t.Fatalf("member reads hidden: %+v %v", p, err)
	}
	p, err = f.orgs.SetPushPreviewPolicy(f.ctx, f.owner.ID, f.orgID, false)
	if err != nil || p.Hidden || p.HiddenAt != nil {
		t.Fatalf("owner shows again: %+v %v", p, err)
	}
}
