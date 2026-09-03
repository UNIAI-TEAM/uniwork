package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func orgFixture(t *testing.T) (*db.Queries, *OrganizationService, db.User, db.User) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ua := registerVerified(t, q, as, "a@example.com", "A")
	ub := registerVerified(t, q, as, "b@example.com", "B")
	return q, NewOrganizationService(q), ua, ub
}

func TestOrganizationCreateAndAccess(t *testing.T) {
	_, s, ua, ub := orgFixture(t)
	ctx := context.Background()

	o, err := s.Create(ctx, ua.ID, "  Unicom  ", "unicom")
	if err != nil || o.Name != "Unicom" {
		t.Fatalf("create: %v name=%q", err, o.Name)
	}
	m, err := s.RequireMember(ctx, o.ID, ua.ID)
	if err != nil || m.Role != "owner" {
		t.Fatalf("owner: %v role=%s", err, m.Role)
	}
	if _, err := s.RequireMember(ctx, o.ID, ub.ID); err != ErrForbidden {
		t.Fatalf("outsider: got %v", err)
	}
	if _, _, err := s.GetBySlug(ctx, ub.ID, "unicom"); err != ErrNotFound {
		t.Fatalf("outsider GetBySlug: got %v", err)
	}
	if _, err := s.Create(ctx, ub.ID, "Khác", "unicom"); err != ErrConflict {
		t.Fatalf("dup slug: got %v", err)
	}
	if _, err := s.Create(ctx, ua.ID, "X", "login"); err == nil {
		t.Fatal("reserved slug accepted")
	}
	if _, err := s.Create(ctx, ua.ID, "", "abc"); err == nil {
		t.Fatal("empty name accepted")
	}
	list, err := s.ListForUser(ctx, ua.ID)
	if err != nil || len(list) != 1 || list[0].Role != "owner" {
		t.Fatalf("list: %v %+v", err, list)
	}
}
