package service

import (
	"errors"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// soloOrganization is an organization whose owner is its only member, the
// one shape Close accepts (ADR 0032 D5).
func (f *orgMembersFixture) soloOrganization(t *testing.T) db.Organization {
	t.Helper()
	o, err := f.orgs.Create(f.ctx, f.other.ID, "Một mình", "mot-minh")
	if err != nil {
		t.Fatal(err)
	}
	return o
}

func (f *orgMembersFixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestCloseOrganization is spec §4.5: the sole owner archives the
// organization and is free again; nothing it holds is deleted.
func TestCloseOrganization(t *testing.T) {
	t.Run("only the owner may close", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		for _, who := range []string{f.admin.ID, f.member.ID, f.other.ID} {
			if err := f.svc.Close(f.ctx, who, f.org.ID, "unicom"); !errors.Is(err, ErrForbidden) {
				t.Fatalf("close by %s: %v", who, err)
			}
		}
	})

	t.Run("another active member blocks the close", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		err := f.svc.Close(f.ctx, f.owner.ID, f.org.ID, "unicom")
		codedFields(t, err, "organization_has_members")
		if o, _ := f.q.GetOrganizationByID(f.ctx, f.org.ID); o.Status != OrganizationActive {
			t.Fatalf("refused close changed the organization: %s", o.Status)
		}
	})

	t.Run("deactivated members do not block it", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		for _, id := range []string{f.admin.ID, f.member.ID} {
			if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, id); err != nil {
				t.Fatal(err)
			}
		}
		if err := f.svc.Close(f.ctx, f.owner.ID, f.org.ID, "unicom"); err != nil {
			t.Fatalf("close with only deactivated peers: %v", err)
		}
	})

	t.Run("the typed slug must match", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		o := f.soloOrganization(t)
		for _, typed := range []string{"", "Mot-Minh", "unicom"} {
			err := f.svc.Close(f.ctx, f.other.ID, o.ID, typed)
			codedFields(t, err, "close_confirm_mismatch")
		}
		if got, _ := f.q.GetOrganizationByID(f.ctx, o.ID); got.Status != OrganizationActive {
			t.Fatalf("refused close changed the organization: %s", got.Status)
		}
	})

	t.Run("only an active organization closes", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		o := f.soloOrganization(t)
		for _, status := range []string{OrganizationSuspended, "archived"} {
			f.setStatus(t, o.ID, status)
			if err := f.svc.Close(f.ctx, f.other.ID, o.ID, "mot-minh"); !errors.Is(err, ErrOrganizationSuspended) {
				t.Fatalf("close of a %s organization: %v", status, err)
			}
		}
	})

	t.Run("closing archives it, frees the owner and keeps the data", func(t *testing.T) {
		f := newOrgMembersFixture(t)
		o := f.soloOrganization(t)
		ws, err := f.ws.CreateInOrg(f.ctx, f.other.ID, o.ID, "Nhóm", "nhom")
		if err != nil {
			t.Fatal(err)
		}
		f.inviteToOrg(t, o.ID, f.other.ID, "pending@example.com")

		if err := f.svc.Close(f.ctx, f.other.ID, o.ID, "mot-minh"); err != nil {
			t.Fatalf("close: %v", err)
		}

		got, err := f.q.GetOrganizationByID(f.ctx, o.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != "archived" || got.SuspendedReason.String != "organization_closed" || !got.SuspendedAt.Valid {
			t.Fatalf("organization after close: %s %+v %+v", got.Status, got.SuspendedReason, got.SuspendedAt)
		}
		m, err := f.svc.member(f.ctx, o.ID, f.other.ID)
		if err != nil || !m.DeactivatedAt.Valid || m.DeactivatedBy.String != f.other.ID || m.Role != OrgRoleOwner {
			t.Fatalf("owner row after close: %v %+v", err, m)
		}
		if n := f.count(t, `SELECT count(*) FROM invitations WHERE organization_id = $1 AND revoked_at IS NULL AND accepted_at IS NULL`, o.ID); n != 0 {
			t.Fatalf("%d invitations still pending", n)
		}
		if n := f.count(t, `SELECT count(*) FROM subscriptions WHERE organization_id = $1 AND status <> 'canceled'`, o.ID); n != 0 {
			t.Fatalf("%d subscriptions still live", n)
		}
		if n := f.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'organization.closed' AND organization_id = $1`, o.ID); n != 1 {
			t.Fatalf("organization.closed events: %d", n)
		}
		if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = 'organization.closed' AND organization_id = $1`, o.ID); n != 1 {
			t.Fatalf("organization.closed audit rows: %d", n)
		}
		// D4: the workspace and its membership stay for a later restore.
		if n := f.count(t, `SELECT count(*) FROM workspaces WHERE id = $1`, ws.Workspace.ID); n != 1 {
			t.Fatal("the workspace was deleted")
		}
		if n := f.count(t, `SELECT count(*) FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, ws.Workspace.ID, f.other.ID); n != 1 {
			t.Fatal("the workspace membership was deleted")
		}

		if _, err := f.orgs.Create(f.ctx, f.other.ID, "Khởi đầu mới", "khoi-dau-moi"); err != nil {
			t.Fatalf("owner founding a new organization after close: %v", err)
		}
		if err := f.svc.Close(f.ctx, f.other.ID, o.ID, "mot-minh"); !errors.Is(err, ErrMemberDeactivated) {
			t.Fatalf("closing twice: %v", err)
		}
	})
}

// A closed organization holds nobody (ADR 0032 D1), so its former owner may
// erase the account: the owner row stays role=owner for a later restore, but
// it is deactivated and the organization archived.
func TestClosedOrganizationDoesNotBlockAccountDeletion(t *testing.T) {
	f := newOrgMembersFixture(t)
	o := f.soloOrganization(t)
	if err := f.svc.Close(f.ctx, f.other.ID, o.ID, "mot-minh"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := f.auth.DeleteAccount(f.ctx, f.other.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatalf("delete the account of a closed organization's owner: %v", err)
	}
	// The owner of a live organization still has to hand it over first.
	if err := f.auth.DeleteAccount(f.ctx, f.owner.ID, DeleteAccountInput{Password: "password123"}); !errors.Is(err, ErrOwnerMustTransfer) {
		t.Fatalf("delete the account of an active owner: %v", err)
	}
}
