package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// aiReads runs every AI-content read of one meeting as userID and returns
// the errors by name.
func aiReads(ctx context.Context, s *MeetingService, userID, meetingID string) map[string]error {
	refs, _ := ParseEvidenceRefs("segment:01J8X4K2M0N1P2Q3R4S5T6U7V8")
	_, transcript := s.Transcript(ctx, userID, meetingID, FeedQuery{})
	_, summary := s.Summary(ctx, userID, meetingID)
	_, evidence := s.EvidenceSources(ctx, userID, meetingID, refs)
	_, labels := s.SpeakerLabels(ctx, userID, meetingID)
	_, transcriptions := s.Transcriptions(ctx, userID, meetingID)
	return map[string]error{
		"transcript": transcript, "summary": summary, "evidence": evidence,
		"speaker_labels": labels, "transcriptions": transcriptions,
	}
}

func wantAIReads(t *testing.T, who string, errs map[string]error, allowed bool) {
	t.Helper()
	for name, err := range errs {
		switch {
		case allowed && err != nil:
			t.Errorf("%s: %s = %v, want readable", who, name, err)
		case !allowed && !codedIs(err, "meeting_ai_restricted"):
			t.Errorf("%s: %s = %v, want meeting_ai_restricted", who, name, err)
		case !allowed && !errors.Is(err, ErrForbidden):
			t.Errorf("%s: %s does not wrap ErrForbidden", who, name)
		}
	}
}

// TestMeetingAIContentIsForThePeopleOfTheMeeting (UNI-1995 access, #4): a
// workspace member the host never invited reads no AI content; invited,
// they do; removed, they are out again. A workspace admin always reads, and
// a share opens it to every member. The meeting itself stays readable.
func TestMeetingAIContentIsForThePeopleOfTheMeeting(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	addMember(t, s, w.ID, ub.ID)
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, s.q, as, "c@example.com", "C")
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: uc.ID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Đánh giá nhân sự")
	if err != nil {
		t.Fatal(err)
	}

	wantAIReads(t, "host", aiReads(ctx, s, ua.ID, m.ID), true)
	wantAIReads(t, "workspace admin", aiReads(ctx, s, uc.ID, m.ID), true)
	wantAIReads(t, "uninvited member", aiReads(ctx, s, ub.ID, m.ID), false)
	if _, err := s.Get(ctx, ub.ID, m.ID); err != nil {
		t.Fatalf("the meeting itself stays with the workspace: %v", err)
	}
	if s.CanReadAIContent(ctx, ub.ID, m) || !s.CanReadAIContent(ctx, ua.ID, m) {
		t.Fatal("CanReadAIContent disagrees with the reads")
	}

	p, err := s.Invite(ctx, ua.ID, m.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantAIReads(t, "invited member", aiReads(ctx, s, ub.ID, m.ID), true)

	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	wantAIReads(t, "removed member", aiReads(ctx, s, ub.ID, m.ID), false)

	if _, err := s.SetAIContentShared(ctx, ub.ID, m.ID, true); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("a member outside the meeting shares: %v, want not_meeting_clerk", err)
	}
	shared, err := s.SetAIContentShared(ctx, ua.ID, m.ID, true)
	if err != nil || !shared.AiContentSharedAt.Valid {
		t.Fatalf("share: %+v, %v", shared.AiContentSharedAt, err)
	}
	wantAIReads(t, "removed member, shared meeting", aiReads(ctx, s, ub.ID, m.ID), true)
	unshared, err := s.SetAIContentShared(ctx, ua.ID, m.ID, false)
	if err != nil || unshared.AiContentSharedAt.Valid {
		t.Fatalf("unshare: %+v, %v", unshared.AiContentSharedAt, err)
	}
	wantAIReads(t, "removed member, unshared again", aiReads(ctx, s, ub.ID, m.ID), false)

	var audited int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.ai_sharing_changed' AND resource_id = $1`, m.ID).Scan(&audited); err != nil {
		t.Fatal(err)
	}
	if audited != 2 {
		t.Fatalf("audit rows = %d, want 2 (share, unshare)", audited)
	}
}
