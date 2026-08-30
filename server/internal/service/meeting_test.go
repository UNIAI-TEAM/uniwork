package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func meetingFixture(t *testing.T) (*MeetingService, db.User, db.User, db.Workspace) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil, nil, "")
	orgs := NewOrganizationService(q)
	ws := NewWorkspaceService(pool, q, orgs)
	ctx := context.Background()
	ua := registerVerified(t, q, as, "a@example.com", "A")
	ub := registerVerified(t, q, as, "b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-alpha")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	w := v.Workspace
	return NewMeetingService(q, ws, NopPublisher{}), ua, ub, w
}

func TestMeetingCRUD(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour).Truncate(time.Second)

	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Daily", StartsAt: start, EndsAt: start.Add(30 * time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(m.RoomName, "uniwork-") {
		t.Fatalf("room_name = %q", m.RoomName)
	}
	// EndsAt trước StartsAt → lỗi
	if _, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "X", StartsAt: start, EndsAt: start.Add(-time.Minute),
	}); err == nil {
		t.Fatal("invalid time range accepted")
	}
	// non-member
	if _, err := s.Get(ctx, ub.ID, m.ID); err != ErrForbidden {
		t.Fatalf("non-member get: %v", err)
	}

	title := "Daily standup"
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title})
	if err != nil || up.Title != "Daily standup" {
		t.Fatalf("update: %v", err)
	}

	if _, err := s.AddNote(ctx, ua.ID, m.ID, "biên bản"); err != nil {
		t.Fatal(err)
	}
	ns, err := s.Notes(ctx, ua.ID, m.ID)
	if err != nil || len(ns) != 1 {
		t.Fatalf("notes: %v n=%d", err, len(ns))
	}

	if err := s.Delete(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, ua.ID, m.ID); err != ErrNotFound {
		t.Fatalf("after delete: %v", err)
	}
}
