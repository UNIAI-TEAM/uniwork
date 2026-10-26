package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
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

// TestMeetingActionItemsAreTaskReferencesOutsideTheMeeting (UNI-1995 access,
// demo bug 2): what the scribe drew from the transcript is AI content too. A
// member outside the meeting reads only the items that became tasks, and
// each as the task it became (the task's own title, state, assignee, due):
// no pending or dismissed item, no owner or due phrase, no description,
// priority or evidence. The counts stay. The people of the meeting, a
// workspace admin and everyone once it is shared read every item in full.
func TestMeetingActionItemsAreTaskReferencesOutsideTheMeeting(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, s.q, as, "c@example.com", "C")
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: uc.ID, Role: "admin"}); err != nil {
		t.Fatal(err)
	}
	seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Đặt cọc hội trường", Owner: "B", Due: "thứ Sáu", Description: "Anh B nói ngân sách 30 triệu", Priority: "high"},
		ai.ActionItem{Title: "Gọi nhà cung cấp âm thanh", Owner: "B", Description: "Theo lời chị A"},
		ai.ActionItem{Title: "Việc trùng lặp"},
	)
	items := itemsByTitle(t, s, ua.ID, m)
	due := "2999-01-02"
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: items["Đặt cọc hội trường"].Item.ID, AssigneeID: &ub.ID, DueDate: &due}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, items["Việc trùng lặp"].Item.ID, "trùng với việc tuần trước"); err != nil {
		t.Fatal(err)
	}
	ev, _ := json.Marshal([]EvidenceRef{{Kind: "note", ID: "01J8X4K2M0N1P2Q3R4S5T6U7V8"}})
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_action_items SET evidence = $1 WHERE meeting_id = $2`, string(ev), m.ID); err != nil {
		t.Fatal(err)
	}
	// The task moved on since: its title is its own now.
	if _, err := s.pool.Exec(ctx, `UPDATE tasks SET title = 'Đặt cọc 30% hội trường' WHERE id = $1`, links[0].TaskID); err != nil {
		t.Fatal(err)
	}

	full, err := s.ActionItems(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	restricted, err := s.ActionItems(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restricted.Counts != full.Counts {
		t.Errorf("counts outside the meeting = %+v, want the meeting's %+v", restricted.Counts, full.Counts)
	}
	if len(restricted.Items) != 1 {
		t.Fatalf("items outside the meeting = %+v, want the one converted item", restricted.Items)
	}
	got := restricted.Items[0]
	want := ActionItemView{
		Item: db.MeetingActionItem{
			ID: got.Item.ID, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
			Source: ActionItemSourceAI, Position: got.Item.Position, Title: "Đặt cọc 30% hội trường",
			TaskID: got.Item.TaskID, CreatedAt: got.Item.CreatedAt,
		},
		Status: ActionItemConverted, Task: got.Task,
	}
	if got.Item != want.Item || got.Status != want.Status || got.Evidence != nil || got.SuggestedAssigneeID != nil || got.SuggestedDueDate != nil {
		t.Errorf("converted item outside the meeting = %+v, want only the task reference %+v", got, want)
	}
	if got.Task == nil || got.Task.ID != links[0].TaskID || got.Task.Title != "Đặt cọc 30% hội trường" ||
		got.Task.AssigneeID == nil || *got.Task.AssigneeID != ub.ID || got.Task.DueDate == nil || *got.Task.DueDate != due {
		t.Errorf("task reference = %+v", got.Task)
	}

	wantFull := func(who, userID string) {
		t.Helper()
		v, err := s.ActionItems(ctx, userID, m.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(v.Items) != 3 {
			t.Fatalf("%s reads %d items, want 3", who, len(v.Items))
		}
		for _, it := range v.Items {
			if it.Item.Title == "Đặt cọc hội trường" && (it.Item.Description == "" || it.Item.OwnerText != "B" || len(it.Evidence) != 1) {
				t.Errorf("%s reads a reduced item: %+v", who, it)
			}
		}
	}
	wantFull("host", ua.ID)
	wantFull("workspace admin", uc.ID)
	p, err := s.Invite(ctx, ua.ID, m.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	wantFull("invited member", ub.ID)
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if v, err := s.ActionItems(ctx, ub.ID, m.ID); err != nil || len(v.Items) != 1 {
		t.Fatalf("removed member reads %d items (%v), want the converted one", len(v.Items), err)
	}
	if _, err := s.SetAIContentShared(ctx, ua.ID, m.ID, true); err != nil {
		t.Fatal(err)
	}
	wantFull("member, shared meeting", ub.ID)
}
