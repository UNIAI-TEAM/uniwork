package service

import (
	"context"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// The list shows who is in a live room (spec 2026-10-29 §Dữ liệu 1): member
// faces earliest-joined first, a head count with guests, and whether the
// scribe is listening. Only IN_PROGRESS rows carry it.
func TestListMeetingsCarriesWhoIsInTheRoom(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET status = 'IN_PROGRESS' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	host := hostParticipant(t, s, m.ID, ua.ID)
	seedSession(t, s, m.ID, memberPID, "1 minute", "")
	seedSession(t, s, m.ID, host.ID, "2 minutes", "")
	seedSession(t, s, m.ID, newGuestParticipant(t, s, m.ID).ID, "3 minutes", "")
	seedSession(t, s, m.ID, newGuestParticipant(t, s, m.ID).ID, "0 minutes", "5 minutes")
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO meeting_scribe_runs (id, organization_id, workspace_id, meeting_id, status, created_by, created_by_kind)
		SELECT $1, organization_id, workspace_id, id, 'ACTIVE', 'system', 'system' FROM meetings WHERE id = $2`,
		util.NewID(), m.ID); err != nil {
		t.Fatal(err)
	}

	// A scheduled meeting with someone already waiting carries nothing.
	sched, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Sắp họp")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET status = 'SCHEDULED' WHERE id = $1`, sched.ID); err != nil {
		t.Fatal(err)
	}
	seedSession(t, s, sched.ID, hostParticipant(t, s, sched.ID, ua.ID).ID, "0 minutes", "")

	rows, _, err := s.ListFiltered(ctx, ub.ID, m.WorkspaceID, MeetingListFilter{})
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, r := range rows {
		switch r.Meeting.ID {
		case m.ID:
			found++
			if !slices.Equal(r.InRoomUserIds, []string{ub.ID, ua.ID}) || r.InRoomCount != 3 || !r.ScribeLive {
				t.Fatalf("live row: ids=%v count=%d scribe=%v, want [%s %s] 3 true", r.InRoomUserIds, r.InRoomCount, r.ScribeLive, ub.ID, ua.ID)
			}
		case sched.ID:
			found++
			if len(r.InRoomUserIds) != 0 || r.InRoomCount != 0 || r.ScribeLive {
				t.Fatalf("scheduled row: ids=%v count=%d scribe=%v, want empty", r.InRoomUserIds, r.InRoomCount, r.ScribeLive)
			}
		}
	}
	if found != 2 {
		t.Fatalf("found %d of the 2 meetings", found)
	}
}
