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
	if _, err := s.storeSummary(ctx, m, Human(ua.ID), ai.MeetingSummary{
		Summary: "Nhóm chốt ngân sách.", Decisions: []ai.Decision{{Text: "Chốt ngân sách quý 4"}}, ActionItems: []ai.ActionItem{},
	}, ai.Response{Model: "fake"}, newSummaryLabels(), false); err != nil {
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
	// The time line is the meeting's actual times on its own clock, never the
	// scheduled ones and never UTC.
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET timezone = 'Asia/Ho_Chi_Minh',
		starts_at = '2026-10-20T01:00:00Z', ends_at = '2026-10-20T02:00:00Z',
		actual_start_at = '2026-10-20T02:05:00Z', actual_end_at = '2026-10-20T03:40:00Z' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
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
	for _, want := range []string{"09:05 – 10:40 (GMT+7), 20/10/2026", "Chủ trì", "Nhóm chốt ngân sách.", "Chốt ngân sách quý 4", "Người được mời"} {
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
	// The meeting's timeline says so too, or it would still read "finalized".
	if n := countRows(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MINUTES_REOPENED' AND actor_id = $2`, m.ID, ub.ID); n != 1 {
		t.Fatalf("reopened timeline rows = %d", n)
	}
	// Reopening a draft writes nothing.
	if _, err := s.ReopenMinutes(ctx, ub.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_audit_logs WHERE meeting_id = $1 AND event_type = 'MINUTES_REOPENED'`, m.ID); n != 1 {
		t.Fatalf("reopened timeline rows after a no-op = %d", n)
	}
}

// A shelved minutes page is read-only: the meeting does not offer finalize
// or reopen, which the page would refuse.
func TestShelvedMinutesCannotBeEdited(t *testing.T) {
	s, ua, _, _, m := minutesFixture(t)
	ctx := context.Background()
	made, err := s.CreateMinutes(ctx, ua.ID, m.ID, "vi")
	if err != nil || !made.CanEdit {
		t.Fatalf("made = %+v %v", made, err)
	}
	if _, err := s.Docs.ShelveDocument(ctx, Human(ua.ID), made.DocumentID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	v, err := s.Minutes(ctx, ua.ID, m.ID)
	if err != nil || v == nil || v.CanEdit || !v.Readable {
		t.Fatalf("shelved minutes = %+v %v", v, err)
	}
	_, err = s.FinalizeMinutes(ctx, ua.ID, m.ID)
	wantCode(t, err, "document_shelved")
}

// UNI-2288 (D1): a minutes page carries MinutesMeeting {ID, Title} on GetDocument,
// UpdateDocument, DocumentTree, ListDocuments, ListRecentDocuments and
// ListSharedWithMe. Title is populated only when the viewer is a human who passes
// WorkspaceService.RequireMember on the meeting's workspace; cross-workspace share
// recipients and agents receive ID with an empty Title, and non-minutes documents
// carry nil.
func TestMinutesPageCarriesMeetingSourceWithWorkspaceMemberTitleGate(t *testing.T) {
	s, ua, ub, uc, m := minutesFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)

	// ud is a member of the meeting's workspace who was never invited to the meeting:
	// under D1 they pass RequireMember(m.WorkspaceID) and see the meeting title.
	ud := registerVerified(t, s.q, as, "d-ws-member@example.com", "D")
	addOrgMember(t, s.q, m.OrganizationID, ud.ID)
	addMember(t, s, m.WorkspaceID, ud.ID)

	// outsider belongs to the organization and a sibling workspace (wsB), not m.WorkspaceID.
	outsider := registerVerified(t, s.q, as, "outsider-share@example.com", "Outsider")
	addOrgMember(t, s.q, m.OrganizationID, outsider.ID)
	wsB, err := s.ws.CreateInOrg(ctx, ua.ID, m.OrganizationID, "Sibling", "sib-"+strings.ToLower(m.ID[20:]))
	if err != nil {
		t.Fatalf("CreateInOrg(wsB): %v", err)
	}
	addMember(t, s, wsB.ID, outsider.ID)

	made, err := s.CreateMinutes(ctx, ub.ID, m.ID, "vi")
	if err != nil {
		t.Fatalf("CreateMinutes: %v", err)
	}
	minutesDocID := made.DocumentID

	plainPage, err := s.Docs.CreatePage(ctx, Human(ua.ID), m.WorkspaceID, CreatePageInput{
		Title:      "Trang thường",
		Visibility: documentVisibilityWorkspace,
	})
	if err != nil {
		t.Fatalf("CreatePage(plainPage): %v", err)
	}
	folderDoc, err := s.Docs.CreatePage(ctx, Human(ua.ID), m.WorkspaceID, CreatePageInput{
		Kind:  DocumentKindFolder,
		Title: "Thư mục thường",
	})
	if err != nil {
		t.Fatalf("CreatePage(folderDoc): %v", err)
	}
	if plainPage.MinutesMeeting != nil || folderDoc.MinutesMeeting != nil {
		t.Fatalf("non-minutes create carried MinutesMeeting: page=%+v folder=%+v", plainPage.MinutesMeeting, folderDoc.MinutesMeeting)
	}

	// A meeting in wsB whose minutes_document_id points at plainPage in m.WorkspaceID must never claim it.
	crossM, err := s.CreateInstant(ctx, ua.ID, wsB.ID, "Họp ở workspace B")
	if err != nil {
		t.Fatalf("CreateInstant(wsB): %v", err)
	}
	if err := s.q.SetMeetingMinutesDocument(ctx, db.SetMeetingMinutesDocumentParams{
		DocumentID: strText(plainPage.Document.ID), ID: crossM.ID, OrganizationID: m.OrganizationID,
	}); err != nil {
		t.Fatalf("SetMeetingMinutesDocument(cross): %v", err)
	}

	// Every human member of m.WorkspaceID (host, secretary, participant, non-participant workspace member)
	// gets {ID: m.ID, Title: m.Title}.
	for _, viewer := range []struct {
		name string
		user db.User
	}{
		{"host", ua},
		{"secretary", ub},
		{"participant member", uc},
		{"non-participant workspace member", ud},
	} {
		got, err := s.Docs.GetDocument(ctx, Human(viewer.user.ID), minutesDocID)
		if err != nil {
			t.Fatalf("GetDocument(%s): %v", viewer.name, err)
		}
		if got.MinutesMeeting == nil || got.MinutesMeeting.ID != m.ID || got.MinutesMeeting.Title != m.Title {
			t.Fatalf("GetDocument(%s) MinutesMeeting = %+v, want {ID:%q Title:%q}", viewer.name, got.MinutesMeeting, m.ID, m.Title)
		}
	}

	// UpdateDocument (PATCH) also returns MinutesMeeting.
	newIcon := "📝"
	patched, err := s.Docs.UpdateDocument(ctx, Human(ua.ID), minutesDocID, UpdateDocumentInput{
		Revision: 1, Icon: &newIcon,
	})
	if err != nil {
		t.Fatalf("UpdateDocument: %v", err)
	}
	if patched.MinutesMeeting == nil || patched.MinutesMeeting.ID != m.ID || patched.MinutesMeeting.Title != m.Title {
		t.Fatalf("UpdateDocument MinutesMeeting = %+v, want {ID:%q Title:%q}", patched.MinutesMeeting, m.ID, m.Title)
	}

	// DocumentTree (foldersOnly=false) attaches MinutesMeeting to the minutes page node only;
	// foldersOnly=true skips page queries and returns only folders with nil MinutesMeeting.
	tree, err := s.Docs.DocumentTree(ctx, Human(ud.ID), m.WorkspaceID, "", false)
	if err != nil {
		t.Fatalf("DocumentTree: %v", err)
	}
	byTreeID := map[string]*DocumentMinutesMeeting{}
	for _, n := range tree {
		byTreeID[n.ID] = n.MinutesMeeting
	}
	if mm := byTreeID[minutesDocID]; mm == nil || mm.ID != m.ID || mm.Title != m.Title {
		t.Fatalf("tree minutes node MinutesMeeting = %+v, want {ID:%q Title:%q}", mm, m.ID, m.Title)
	}
	if mm := byTreeID[plainPage.Document.ID]; mm != nil {
		t.Fatalf("tree plainPage node MinutesMeeting = %+v, want nil", mm)
	}
	if mm := byTreeID[folderDoc.Document.ID]; mm != nil {
		t.Fatalf("tree folderDoc node MinutesMeeting = %+v, want nil", mm)
	}
	foldersTree, err := s.Docs.DocumentTree(ctx, Human(ud.ID), m.WorkspaceID, "", true)
	if err != nil || len(foldersTree) != 1 || foldersTree[0].MinutesMeeting != nil {
		t.Fatalf("DocumentTree(foldersOnly) = %+v, %v", foldersTree, err)
	}

	// ListDocuments & ListRecentDocuments attach Facts.MinutesMeeting to the minutes page only.
	list, err := s.Docs.ListDocuments(ctx, Human(ud.ID), m.WorkspaceID, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatalf("ListDocuments: %v", err)
	}
	byListID := map[string]*DocumentMinutesMeeting{}
	for _, it := range list.Items {
		byListID[it.Document.ID] = it.Facts.MinutesMeeting
	}
	if mm := byListID[minutesDocID]; mm == nil || mm.ID != m.ID || mm.Title != m.Title {
		t.Fatalf("list minutes row MinutesMeeting = %+v, want {ID:%q Title:%q}", mm, m.ID, m.Title)
	}
	if mm := byListID[plainPage.Document.ID]; mm != nil {
		t.Fatalf("list plainPage row MinutesMeeting = %+v, want nil", mm)
	}
	recent, err := s.Docs.ListRecentDocuments(ctx, Human(ud.ID), m.WorkspaceID, ListDocumentsInput{Limit: 50})
	if err != nil {
		t.Fatalf("ListRecentDocuments: %v", err)
	}
	sawMinutesInRecent := false
	for _, it := range recent.Items {
		if it.Document.ID == minutesDocID {
			sawMinutesInRecent = true
			if it.Facts.MinutesMeeting == nil || it.Facts.MinutesMeeting.ID != m.ID || it.Facts.MinutesMeeting.Title != m.Title {
				t.Fatalf("recent minutes row MinutesMeeting = %+v", it.Facts.MinutesMeeting)
			}
		}
	}
	if !sawMinutesInRecent {
		t.Fatal("recent list missing opened minutes page")
	}

	// Cross-workspace share recipient (outsider): sees MinutesMeeting.ID, but Title is blanked.
	if _, err := s.Docs.ShareDocument(ctx, Human(ub.ID), minutesDocID, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: outsider.ID, Level: DocumentLevelView,
	}); err != nil {
		t.Fatalf("ShareDocument(outsider): %v", err)
	}
	outsiderView, err := s.Docs.GetDocument(ctx, Human(outsider.ID), minutesDocID)
	if err != nil {
		t.Fatalf("GetDocument(outsider): %v", err)
	}
	if outsiderView.MinutesMeeting == nil || outsiderView.MinutesMeeting.ID != m.ID || outsiderView.MinutesMeeting.Title != "" {
		t.Fatalf("GetDocument(outsider) MinutesMeeting = %+v, want {ID:%q Title:\"\"}", outsiderView.MinutesMeeting, m.ID)
	}
	sharedPage, err := s.Docs.ListSharedWithMe(ctx, outsider.ID, m.OrganizationID, SharedWithMeQuery{Limit: 50})
	if err != nil || len(sharedPage.Items) != 1 {
		t.Fatalf("ListSharedWithMe(outsider) = %+v, %v", sharedPage.Items, err)
	}
	if mm := sharedPage.Items[0].Facts.MinutesMeeting; mm == nil || mm.ID != m.ID || mm.Title != "" {
		t.Fatalf("ListSharedWithMe(outsider) MinutesMeeting = %+v, want {ID:%q Title:\"\"}", mm, m.ID)
	}

	// Workspace agent: sees MinutesMeeting.ID, but Title is blanked (agents never get meeting titles under D1).
	ag, err := s.q.CreateAgent(ctx, db.CreateAgentParams{
		ID: "ag-" + strings.ToLower(m.ID[20:]), OrganizationID: m.OrganizationID,
		Name: "ScribeBot", Handle: "scribebot-" + strings.ToLower(m.ID[20:]),
		OwnerUserID: ua.ID, AutonomyPolicy: "{}", CreatedBy: ua.ID, CreatedByKind: "human",
	})
	if err != nil {
		t.Fatalf("CreateAgent: %v", err)
	}
	if err := s.q.AddWorkspaceAgentMember(ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: m.WorkspaceID, AgentID: ag.ID, OrganizationID: m.OrganizationID,
		CreatedBy: ua.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatalf("AddWorkspaceAgentMember: %v", err)
	}
	agentActor := Actor{Kind: audit.KindAgent, ID: ag.ID}
	agentView, err := s.Docs.GetDocument(ctx, agentActor, minutesDocID)
	if err != nil {
		t.Fatalf("GetDocument(agent): %v", err)
	}
	if agentView.MinutesMeeting == nil || agentView.MinutesMeeting.ID != m.ID || agentView.MinutesMeeting.Title != "" {
		t.Fatalf("GetDocument(agent) MinutesMeeting = %+v, want {ID:%q Title:\"\"}", agentView.MinutesMeeting, m.ID)
	}
	agentTree, err := s.Docs.DocumentTree(ctx, agentActor, m.WorkspaceID, "", false)
	if err != nil {
		t.Fatalf("DocumentTree(agent): %v", err)
	}
	for _, n := range agentTree {
		if n.ID == minutesDocID {
			if n.MinutesMeeting == nil || n.MinutesMeeting.ID != m.ID || n.MinutesMeeting.Title != "" {
				t.Fatalf("DocumentTree(agent) MinutesMeeting = %+v, want {ID:%q Title:\"\"}", n.MinutesMeeting, m.ID)
			}
		}
	}
}
