package notification

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Meeting reminders list many accepted participants; membership is filtered in one query.
func TestMeetingReminderBatchMembershipGate(t *testing.T) {
	f := newFixture(t)
	const extra = 24
	userIDs := make([]string, 0, extra+2)
	userIDs = append(userIDs, f.owner.ID, f.member.ID)
	auth := service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	for i := 0; i < extra; i++ {
		u := f.register(t, auth, fmt.Sprintf("meet-rem-%d@example.com", i), "Khách")
		if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		userIDs = append(userIDs, u.ID)
	}
	now := time.Now()
	m := f.scheduleMeeting(t, "All-hands", now.Add(5*time.Minute))
	gate := &countingMemberGate{inner: f.ws}
	r := NewMeetingReminder(NewConsumer(f.pool, f.q, gate))
	r.recipients = func(context.Context, string) ([]string, error) { return userIDs, nil }
	row := db.ListMeetingsDueReminderRow{
		ID: m.ID, OrganizationID: f.orgID, WorkspaceID: f.wsID, Title: m.Title,
		StartsAt: pgtype.Timestamptz{Time: now.Add(5 * time.Minute), Valid: true},
	}
	ok, err := r.remind(f.ctx, row, now)
	if err != nil || !ok {
		t.Fatalf("remind ok=%v err=%v", ok, err)
	}
	if got := gate.n.Load(); got != 0 {
		t.Fatalf("RequireMember calls = %d, want 0", got)
	}
}
