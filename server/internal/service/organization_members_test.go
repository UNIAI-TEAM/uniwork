package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// orgMembersFixture builds one organization with an owner, an admin and a
// plain member — the three roles the permission matrix in spec F-03 §4.1 is
// written against.
type orgMembersFixture struct {
	ctx    context.Context
	q      *db.Queries
	orgs   *OrganizationService
	svc    *OrganizationMemberService
	org    db.Organization
	owner  db.User
	admin  db.User
	member db.User
	other  db.User
	auth   *AuthService
}

func newOrgMembersFixture(t *testing.T) *orgMembersFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	f := &orgMembersFixture{ctx: context.Background(), q: q, auth: as}
	f.orgs = NewOrganizationService(pool, q)
	f.svc = NewOrganizationMemberService(pool, q, f.orgs)
	f.owner = registerVerified(t, q, as, "owner@example.com", "Owner")
	f.admin = registerVerified(t, q, as, "admin@example.com", "Admin")
	f.member = registerVerified(t, q, as, "member@example.com", "Member")
	f.other = registerVerified(t, q, as, "other@example.com", "Other")
	o, err := f.orgs.Create(f.ctx, f.owner.ID, "Unicom", "unicom")
	if err != nil {
		t.Fatal(err)
	}
	f.org = o
	for _, m := range []struct {
		id, role string
	}{{f.admin.ID, OrgRoleAdmin}, {f.member.ID, OrgRoleMember}} {
		if err := q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
			OrganizationID: o.ID, UserID: m.id, Role: m.role,
		}); err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func TestOrganizationMemberRoleMatrix(t *testing.T) {
	f := newOrgMembersFixture(t)
	cases := []struct {
		name    string
		run     func() error
		wantErr error
	}{
		{"member cannot change a role", func() error {
			_, err := f.svc.UpdateRole(f.ctx, f.member.ID, f.org.ID, f.admin.ID, OrgRoleMember)
			return err
		}, ErrForbidden},
		{"outsider cannot list members", func() error {
			_, err := f.svc.Members(f.ctx, f.other.ID, f.org.ID, MemberStatusActive, "", 10)
			return err
		}, ErrForbidden},
		{"member may list members", func() error {
			_, err := f.svc.Members(f.ctx, f.member.ID, f.org.ID, MemberStatusActive, "", 10)
			return err
		}, nil},
		{"nobody may deactivate the owner", func() error {
			_, err := f.svc.Deactivate(f.ctx, f.admin.ID, f.org.ID, f.owner.ID)
			return err
		}, ErrLastOwner},
		{"the owner's role cannot be changed", func() error {
			_, err := f.svc.UpdateRole(f.ctx, f.admin.ID, f.org.ID, f.owner.ID, OrgRoleMember)
			return err
		}, ErrLastOwner},
		{"an admin cannot change their own role", func() error {
			_, err := f.svc.UpdateRole(f.ctx, f.admin.ID, f.org.ID, f.admin.ID, OrgRoleMember)
			return err
		}, nil},
		{"the owner cannot leave", func() error {
			return f.svc.Leave(f.ctx, f.owner.ID, f.org.ID)
		}, ErrLastOwner},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := c.run()
			if c.wantErr == nil {
				return
			}
			if !errors.Is(err, c.wantErr) {
				t.Fatalf("got %v, want %v", err, c.wantErr)
			}
		})
	}
}

func TestAdminCannotDeactivateAnotherAdmin(t *testing.T) {
	f := newOrgMembersFixture(t)
	second := registerVerified(t, f.q, f.auth, "admin2@example.com", "Admin hai")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: second.ID, Role: OrgRoleAdmin,
	}); err != nil {
		t.Fatal(err)
	}
	// OPEN_QUESTIONS P6: peers cannot switch each other off.
	if _, err := f.svc.Deactivate(f.ctx, f.admin.ID, f.org.ID, second.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("admin deactivating an admin: got %v, want forbidden", err)
	}
	// The owner can.
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, second.ID); err != nil {
		t.Fatalf("owner deactivating an admin: %v", err)
	}
}

func TestDeactivateClosesEveryMembershipGate(t *testing.T) {
	f := newOrgMembersFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.member.ID); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("RequireMember after deactivate: got %v", err)
	}
	// The person still knows the organization exists, so GetBySlug answers
	// honestly instead of hiding behind 404.
	if _, _, err := f.orgs.GetBySlug(f.ctx, f.member.ID, "unicom"); !errors.Is(err, ErrMemberDeactivated) {
		t.Fatalf("GetBySlug after deactivate: got %v", err)
	}
	// Nobody may deactivate themselves, whatever their role.
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.owner.ID); err == nil {
		t.Fatal("owner deactivated themselves")
	}
	if _, err := f.svc.Reactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.member.ID); err != nil {
		t.Fatalf("RequireMember after reactivate: %v", err)
	}
}

func TestDeactivateRevokesSessionsOnlyWhenNoOtherOrganizationRemains(t *testing.T) {
	f := newOrgMembersFixture(t)
	// The member also belongs to a second organization, so their sessions are
	// not this organization's to end.
	second, err := f.orgs.Create(f.ctx, f.other.ID, "Khác", "khac")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: second.ID, UserID: f.member.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	tok, err := f.q.CreateRefreshToken(f.ctx, db.CreateRefreshTokenParams{
		ID: "01TOKEN0000000000000000001", UserID: f.member.ID, TokenHash: "hash-one",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.GetRefreshTokenByHash(f.ctx, tok.TokenHash); err != nil {
		t.Fatalf("session revoked while the member still belongs to another organization: %v", err)
	}
	// Once they leave the other organization, deactivation ends the session.
	if err := f.svc.Leave(f.ctx, f.member.ID, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Reactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.GetRefreshTokenByHash(f.ctx, tok.TokenHash); err == nil {
		t.Fatal("expected the last organization's deactivation to revoke the session")
	}
}

func TestLeaveRemovesWorkspaceMembershipToo(t *testing.T) {
	f := newOrgMembersFixture(t)
	if err := f.svc.Leave(f.ctx, f.member.ID, f.org.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.orgs.RequireMember(f.ctx, f.org.ID, f.member.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("after leave: got %v", err)
	}
	list, err := f.orgs.ListForUser(f.ctx, f.member.ID)
	if err != nil || len(list) != 0 {
		t.Fatalf("organizations after leave: %v %+v", err, list)
	}
}

func TestMembersPagesByKeyset(t *testing.T) {
	f := newOrgMembersFixture(t)
	first, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, MemberStatusAll, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Members) != 2 || first.NextCursor == "" {
		t.Fatalf("first page: %d rows, cursor %q", len(first.Members), first.NextCursor)
	}
	second, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, MemberStatusAll, first.NextCursor, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Members) != 1 || second.NextCursor != "" {
		t.Fatalf("second page: %d rows, cursor %q", len(second.Members), second.NextCursor)
	}
	seen := map[string]bool{}
	for _, m := range append(first.Members, second.Members...) {
		if seen[m.UserID] {
			t.Fatalf("user %s appeared twice across pages", m.UserID)
		}
		seen[m.UserID] = true
	}
	if _, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, MemberStatusAll, "not-a-cursor!!", 2); err == nil {
		t.Fatal("a malformed cursor should be rejected, not silently restart the listing")
	}
}

func TestMembersStatusFilter(t *testing.T) {
	f := newOrgMembersFixture(t)
	if _, err := f.svc.Deactivate(f.ctx, f.owner.ID, f.org.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	active, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, MemberStatusActive, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(active.Members) != 2 {
		t.Fatalf("active listing: %d rows, want 2", len(active.Members))
	}
	off, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, MemberStatusDeactivated, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(off.Members) != 1 || off.Members[0].UserID != f.member.ID {
		t.Fatalf("deactivated listing: %+v", off.Members)
	}
	if _, err := f.svc.Members(f.ctx, f.owner.ID, f.org.ID, "nonsense", "", 50); err == nil {
		t.Fatal("unknown status accepted")
	}
}
