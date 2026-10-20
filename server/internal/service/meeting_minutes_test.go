package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// minutesFixture: an ended meeting hosted by ua, with ub its secretary and uc
// a plain member of the workspace, a summary with one decision, and the
// document service wired in.
func minutesFixture(t *testing.T) (s *MeetingService, ua, ub, uc db.User, m db.Meeting) {
	t.Helper()
	ctx := context.Background()
	s, ua, ub, m, pid := governanceFixture(t)
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc = registerVerified(t, s.q, as, "c@example.com", "C")
	addOrgMember(t, s.q, m.OrganizationID, ub.ID)
	addOrgMember(t, s.q, m.OrganizationID, uc.ID)
	addMember(t, s, m.WorkspaceID, uc.ID)
	s.Docs = NewDocumentService(s.pool, s.q, NewOrganizationService(s.pool, s.q), s.ws)
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, pid, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Invite(ctx, ua.ID, m.ID, uc.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.storeSummary(ctx, m, ua.ID, ai.MeetingSummary{
		Summary: "Nhóm chốt ngân sách.", Decisions: []ai.Decision{{Text: "Chốt ngân sách quý 4"}}, ActionItems: []ai.ActionItem{},
	}, ai.Response{Model: "fake"}, newSummaryLabels()); err != nil {
		t.Fatal(err)
	}
	if m, err := s.End(ctx, ua.ID, m.ID); err != nil || m.Status != MeetingEnded {
		t.Fatalf("end: %v %v", m.Status, err)
	}
	m, err := s.q.GetMeeting(ctx, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	return s, ua, ub, uc, m
}

func docLevel(t *testing.T, s *MeetingService, userID, docID string) DocumentLevel {
	t.Helper()
	doc, err := s.q.GetDocumentByID(context.Background(), docID)
	if err != nil {
		t.Fatal(err)
	}
	l, err := s.Docs.LevelFor(context.Background(), Human(userID), doc)
	if err != nil {
		t.Fatal(err)
	}
	return l
}

func TestCreateMinutes(t *testing.T) {
	s, ua, ub, uc, m := minutesFixture(t)
	ctx := context.Background()

	_, err := s.CreateMinutes(ctx, uc.ID, m.ID, "vi")
	wantCode(t, err, "not_meeting_clerk")
	// The secretary clerks: the minutes are theirs to make.
	got, err := s.CreateMinutes(ctx, ub.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || got.DocumentID == "" || !got.FinalizedAt.IsZero() || !got.CanEdit || !got.Readable {
		t.Fatalf("minutes = %+v", got)
	}
	doc, err := s.q.GetDocumentByID(ctx, got.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(doc.Title, "Biên bản: Giao ban (") || doc.ParentID.Valid || doc.Visibility != "workspace" {
		t.Fatalf("page = %q parent=%v visibility=%q", doc.Title, doc.ParentID, doc.Visibility)
	}
	for _, want := range []string{"Chủ trì", "Nhóm chốt ngân sách.", "Chốt ngân sách quý 4", "Người được mời"} {
		if !strings.Contains(doc.ContentText, want) {
			t.Errorf("page text lacks %q:\n%s", want, doc.ContentText)
		}
	}
	// Host and secretary edit, the creator (the secretary) manages, everyone else views.
	if l := docLevel(t, s, ub.ID, doc.ID); l != DocumentLevelManage {
		t.Errorf("creator level = %q", l)
	}
	if l := docLevel(t, s, ua.ID, doc.ID); !l.AtLeast(DocumentLevelEdit) {
		t.Errorf("host level = %q", l)
	}
	if l := docLevel(t, s, uc.ID, doc.ID); l != DocumentLevelView {
		t.Errorf("member level = %q", l)
	}
	row, _ := s.q.GetMeeting(ctx, m.ID)
	if row.MinutesDocumentID.String != doc.ID {
		t.Fatalf("meeting minutes_document_id = %v", row.MinutesDocumentID)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionMeetingMinutesCreated, m.ID); n != 1 {
		t.Fatalf("minutes_created audit rows = %d", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'minutes.created' AND payload::jsonb->>'document_id' = $1`, doc.ID); n != 1 {
		t.Fatalf("minutes.created events = %d", n)
	}

	_, err = s.CreateMinutes(ctx, ua.ID, m.ID, "vi")
	wantCode(t, err, "minutes_exist")

	// A member the page was made private to learns the meeting has minutes,
	// never which page they are.
	if _, err := s.pool.Exec(ctx, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, doc.ID); err != nil {
		t.Fatal(err)
	}
	if v, err := s.Minutes(ctx, uc.ID, m.ID); err != nil || v == nil || v.Readable || v.DocumentID != "" || v.CanEdit {
		t.Fatalf("unreadable minutes = %+v %v", v, err)
	}
	if v, err := s.Minutes(ctx, ua.ID, m.ID); err != nil || !v.Readable || v.DocumentID != doc.ID {
		t.Fatalf("host's minutes = %+v %v", v, err)
	}

	// A page in the trash is no minutes: they can be made again.
	if _, err := s.Docs.ArchiveDocument(ctx, Human(ub.ID), doc.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	if v, err := s.Minutes(ctx, uc.ID, m.ID); err != nil || v != nil {
		t.Fatalf("trashed minutes read as %+v %v", v, err)
	}
	again, err := s.CreateMinutes(ctx, ua.ID, m.ID, "en")
	if err != nil {
		t.Fatal(err)
	}
	if again.DocumentID == doc.ID {
		t.Fatal("the trashed page came back")
	}
}

func TestCreateMinutesNeedsAnEndedMeeting(t *testing.T) {
	s, ua, _, m, _ := governanceFixture(t)
	s.Docs = NewDocumentService(s.pool, s.q, NewOrganizationService(s.pool, s.q), s.ws)
	_, err := s.CreateMinutes(context.Background(), ua.ID, m.ID, "vi")
	wantCode(t, err, "invalid_meeting_state")
}

func TestFinalizeMinutes(t *testing.T) {
	s, ua, ub, uc, m := minutesFixture(t)
	ctx := context.Background()

	_, err := s.FinalizeMinutes(ctx, ua.ID, m.ID)
	wantCode(t, err, "minutes_missing")
	made, err := s.CreateMinutes(ctx, ua.ID, m.ID, "vi")
	if err != nil {
		t.Fatal(err)
	}
	docID := made.DocumentID
	versions := func() int {
		return countRows(t, s, `SELECT count(*) FROM document_versions WHERE document_id = $1`, docID)
	}

	// A secretary appointed after the minutes were made clerks but holds no
	// edit on the page: the meeting is not a second way into the document.
	admin := uc
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(uc.ID)})
	if err != nil {
		t.Fatal(err)
	}
	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, p.ID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	_, err = s.FinalizeMinutes(ctx, admin.ID, m.ID)
	wantCode(t, err, "minutes_edit_required")

	first, err := s.FinalizeMinutes(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if versions() != 1 || first.FinalizedVersionID == "" || first.FinalizedBy != ub.ID || first.EditedSinceFinalized {
		t.Fatalf("finalized = %+v, versions %d", first, versions())
	}
	// Unchanged since: finalizing again keeps the same version.
	same, err := s.FinalizeMinutes(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if same.FinalizedVersionID != first.FinalizedVersionID || versions() != 1 {
		t.Fatalf("re-finalize unchanged = %s, versions %d", same.FinalizedVersionID, versions())
	}

	// A correction after finalizing shows, and finalizing again replaces the id.
	time.Sleep(5 * time.Millisecond)
	if _, err := s.pool.Exec(ctx, `UPDATE documents SET content = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đính chính"}]}]}',
		content_saved_at = now() WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	edited, err := s.Minutes(ctx, uc.ID, m.ID)
	if err != nil || !edited.EditedSinceFinalized || edited.CanEdit {
		t.Fatalf("after a correction = %+v %v", edited, err)
	}
	second, err := s.FinalizeMinutes(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.FinalizedVersionID == first.FinalizedVersionID || second.FinalizedVersion != first.FinalizedVersion+1 || second.EditedSinceFinalized || versions() != 2 {
		t.Fatalf("re-finalized = %+v (first %+v), versions %d", second, first, versions())
	}
	// An edit and its revert leave the content as finalized but saved since:
	// the warning shows, and finalizing records a fresh version that clears it.
	time.Sleep(5 * time.Millisecond)
	if _, err := s.pool.Exec(ctx, `UPDATE documents SET content_saved_at = now() WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	if v, err := s.Minutes(ctx, ua.ID, m.ID); err != nil || !v.EditedSinceFinalized {
		t.Fatalf("after edit and revert = %+v %v", v, err)
	}
	reverted, err := s.FinalizeMinutes(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reverted.FinalizedVersionID == second.FinalizedVersionID || reverted.EditedSinceFinalized || versions() != 3 {
		t.Fatalf("re-finalized after a revert = %+v, versions %d", reverted, versions())
	}
	second = reverted
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'version_id' = $3`,
		audit.ActionMeetingMinutesFinalized, m.ID, second.FinalizedVersionID); n != 1 {
		t.Fatalf("finalized audit for the new version = %d", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MINUTES_FINALIZED'`, m.ID); n != 4 {
		t.Fatalf("timeline rows = %d", n)
	}

	// Reopening forgets the version; the page's history keeps it.
	_, err = s.ReopenMinutes(ctx, admin.ID, m.ID)
	wantCode(t, err, "minutes_edit_required")
	open, err := s.ReopenMinutes(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !open.FinalizedAt.IsZero() || open.FinalizedVersionID != "" || versions() != 3 {
		t.Fatalf("reopened = %+v, versions %d", open, versions())
	}
	if n := countRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'minutes.reopened' AND payload::jsonb->>'meeting_id' = $1`, m.ID); n != 1 {
		t.Fatalf("minutes.reopened events = %d", n)
	}
}
