package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fixture: tạo 2 user, trả (WorkspaceService, userA, userB)
func wsFixture(t *testing.T) (*WorkspaceService, db.User, db.User) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour)
	ctx := context.Background()
	sa, err := as.Register(ctx, "a@example.com", "password123", "A")
	if err != nil {
		t.Fatal(err)
	}
	sb, err := as.Register(ctx, "b@example.com", "password123", "B")
	if err != nil {
		t.Fatal(err)
	}
	return NewWorkspaceService(q), sa.User, sb.User
}

func TestCreateAndMembership(t *testing.T) {
	s, ua, ub := wsFixture(t)
	ctx := context.Background()

	w, err := s.Create(ctx, ua.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.RequireMember(ctx, w.ID, ua.ID)
	if err != nil || m.Role != "owner" {
		t.Fatalf("owner membership: %v role=%s", err, m.Role)
	}
	if _, err := s.RequireMember(ctx, w.ID, ub.ID); err != ErrForbidden {
		t.Fatalf("non-member: got %v, want ErrForbidden", err)
	}
	if _, err := s.GetBySlug(ctx, ub.ID, "doi-alpha"); err != ErrNotFound {
		t.Fatalf("non-member GetBySlug: got %v", err)
	}
	if _, err := s.Create(ctx, ub.ID, "Khác", "doi-alpha"); err != ErrConflict {
		t.Fatalf("dup slug: got %v", err)
	}
	if _, err := s.Create(ctx, ua.ID, "X", "Bad Slug!"); err == nil {
		t.Fatal("invalid slug accepted")
	}
}

func TestInviteFlow(t *testing.T) {
	s, ua, ub := wsFixture(t)
	ctx := context.Background()
	w, _ := s.Create(ctx, ua.ID, "Đội Alpha", "doi-alpha")

	// người ngoài workspace không được mời
	if _, err := s.Invite(ctx, ub.ID, w.ID, "c@example.com", "member"); err != ErrForbidden {
		t.Fatalf("outsider invite: got %v", err)
	}
	inv, err := s.Invite(ctx, ua.ID, w.ID, "b@example.com", "member")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.AcceptInvite(ctx, ub.ID, inv.Token)
	if err != nil || got.ID != w.ID {
		t.Fatalf("accept: %v", err)
	}
	if _, err := s.RequireMember(ctx, w.ID, ub.ID); err != nil {
		t.Fatal("member not added after accept")
	}
	// token dùng lại → not found
	if _, err := s.AcceptInvite(ctx, ub.ID, inv.Token); err != ErrNotFound {
		t.Fatalf("reused invite: got %v", err)
	}
}
