package notification

import (
	"context"
	"testing"
	"time"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// workspaceUser registers one more member of the fixture's workspace.
func (f *fixture) workspaceUser(t *testing.T, email, name string) db.User {
	t.Helper()
	auth := service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := f.register(t, auth, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	return u
}

// recapMeeting is meetingWithSecretary plus an invited attendee and an
// invitee who was removed again.
func (f *fixture) recapMeeting(t *testing.T) (meetingID string, attendee, removed db.User) {
	t.Helper()
	attendee = f.workspaceUser(t, "attendee@example.com", "Người Dự")
	removed = f.workspaceUser(t, "removed@example.com", "Bị Gỡ")
	meetingID = f.meetingWithSecretary(t, "Giao ban")
	for _, u := range []db.User{attendee, removed} {
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_participants (id, meeting_id, organization_id, principal_type, user_id, display_name_snapshot, role, status, source_type, added_by)
			VALUES ($1, $2, $3, 'USER', $4, $5, 'ATTENDEE', 'ACTIVE', 'DIRECT_INVITE', $6)`, "pt-"+u.ID, meetingID, f.orgID, u.ID, u.DisplayName, f.owner.ID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE meeting_participants SET status = 'REMOVED', removed_at = now() WHERE id = $1`, "pt-"+removed.ID); err != nil {
		t.Fatal(err)
	}
	return meetingID, attendee, removed
}

func kindsOf(ns []db.Notification) []string {
	out := make([]string, len(ns))
	for i, n := range ns {
		out[i] = n.Kind
	}
	return out
}

// follow-1: the recap reaches the participants the summary-ready notice
// does not - not the host or the secretaries, not a removed invitee - once
// per meeting, whoever made the summary.
func TestRecapReachesTheParticipantsOnce(t *testing.T) {
	f := newFixture(t)
	meetingID, attendee, removed := f.recapMeeting(t)
	f.storeSummary(t, "sum-1", meetingID, f.owner.ID, "human")
	f.handleLast(t, "summary.created")

	got := f.inbox(t, attendee.ID)
	if len(got) != 1 || got[0].Kind != KindMeetingRecapReady || got[0].ResourceID != meetingID ||
		!contains(got[0].Params, `"meeting":"Giao ban"`) || contains(got[0].Params, `"stage"`) {
		t.Fatalf("attendee inbox = %+v", got)
	}
	url, err := ResourceURL(f.ctx, f.q, "https://app.test", got[0])
	if err != nil || url != "https://app.test/notif-org/notif-ws/meetings/"+meetingID+"?section=summary" {
		t.Fatalf("url = %q %v", url, err)
	}
	for _, uid := range []string{f.owner.ID, f.member.ID, removed.ID} {
		if ns := f.inbox(t, uid); len(ns) != 0 {
			t.Fatalf("inbox of %s = %v", uid, kindsOf(ns))
		}
	}

	// A regenerated summary tells nobody again, even once the first was read.
	f.readAll(t, attendee.ID)
	f.storeSummary(t, "sum-2", meetingID, f.owner.ID, "human")
	f.handleLast(t, "summary.created")
	if n := len(f.inbox(t, attendee.ID)); n != 1 {
		t.Fatalf("recaps after a regeneration = %d, want 1", n)
	}
}

// The auto summary keeps its own notice for the host and the secretary;
// the attendee hears the recap.
func TestRecapBesideTheAutoSummaryNotice(t *testing.T) {
	f := newFixture(t)
	meetingID, attendee, _ := f.recapMeeting(t)
	f.storeSummary(t, "sum-auto", meetingID, "meeting_auto_summary", "system")
	f.handleLast(t, "summary.created")
	if got := kindsOf(f.inbox(t, f.member.ID)); len(got) != 1 || got[0] != KindMeetingSummaryReady {
		t.Fatalf("secretary = %v", got)
	}
	if got := kindsOf(f.inbox(t, attendee.ID)); len(got) != 1 || got[0] != KindMeetingRecapReady {
		t.Fatalf("attendee = %v", got)
	}
}

type fakeDocReaders struct{ readers map[string]bool }

func (d fakeDocReaders) CanReadDocument(_ context.Context, userID, _ string) (bool, error) {
	return d.readers[userID], nil
}

func (d fakeDocReaders) FilterDocumentReaders(_ context.Context, _ string, userIDs []string) ([]string, error) {
	out := []string{}
	for _, id := range userIDs {
		if d.readers[id] {
			out = append(out, id)
		}
	}
	return out, nil
}

// Finalized minutes tell the participants who may read the page, once,
// in their own sentence; minutes reopened before the rule ran tell nobody.
func TestRecapOnFinalizedMinutes(t *testing.T) {
	f := newFixture(t)
	meetingID, attendee, _ := f.recapMeeting(t)
	outsider := f.workspaceUser(t, "noread@example.com", "Không Đọc")
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_participants (id, meeting_id, organization_id, principal_type, user_id, display_name_snapshot, role, status, source_type, added_by)
		VALUES ('pt-noread', $1, $2, 'USER', $3, 'Không Đọc', 'ATTENDEE', 'ACTIVE', 'DIRECT_INVITE', $4)`, meetingID, f.orgID, outsider.ID, f.owner.ID); err != nil {
		t.Fatal(err)
	}
	f.consumer.SetDocumentReaders(fakeDocReaders{readers: map[string]bool{attendee.ID: true, f.owner.ID: true, f.member.ID: true}})
	finalize := func(at string) {
		if _, err := f.pool.Exec(f.ctx, `UPDATE meetings SET minutes_document_id = 'doc-min', minutes_finalized_at = `+at+` WHERE id = $1`, meetingID); err != nil {
			t.Fatal(err)
		}
		f.emit(t, "minutes.finalized", `{"meeting_id":"`+meetingID+`","document_id":"doc-min","workspace_id":"`+f.wsID+`"}`)
		f.handleLast(t, "minutes.finalized")
	}
	finalize("NULL") // reopened before the rule ran
	if n := len(f.inbox(t, attendee.ID)); n != 0 {
		t.Fatalf("recap for reopened minutes: %d", n)
	}
	finalize("now()")
	got := f.inbox(t, attendee.ID)
	if len(got) != 1 || got[0].Kind != KindMeetingRecapReady || !contains(got[0].Params, `"stage":"minutes"`) {
		t.Fatalf("attendee inbox = %+v", got)
	}
	url, err := ResourceURL(f.ctx, f.q, "https://app.test", got[0])
	if err != nil || url != "https://app.test/notif-org/notif-ws/meetings/"+meetingID+"?section=minutes" {
		t.Fatalf("url = %q %v", url, err)
	}
	if ns := f.inbox(t, outsider.ID); len(ns) != 0 {
		t.Fatalf("a participant who cannot read the minutes heard: %v", kindsOf(ns))
	}
	if ns := f.inbox(t, f.member.ID); len(ns) != 0 {
		t.Fatalf("the secretary heard: %v", kindsOf(ns))
	}
	// Finalizing again after a correction tells nobody twice.
	f.readAll(t, attendee.ID)
	finalize("now()")
	if n := len(f.inbox(t, attendee.ID)); n != 1 {
		t.Fatalf("recaps after a second finalize = %d", n)
	}
	if got := Title("vi", KindMeetingRecapReady, map[string]string{"meeting": "Giao ban", "stage": "minutes"}); got != "Biên bản \"Giao ban\" đã chốt · Xem lại các quyết định và việc được giao" {
		t.Fatalf("vi minutes title = %q", got)
	}
}
