package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDriveProposalSeamHelpersAndOrgLifecycleDiscards verifies the B5/B6 seam
// helpers (requireOwnProposalQ, lockSourceForProposalQ, matchDriveProposalDuplicatesQ)
// and that organization member Leave / Deactivate disconnects the member's
// Drive connection and discards their ready proposals in the same transaction.
func TestDriveProposalSeamHelpersAndOrgLifecycleDiscards(t *testing.T) {
	e := newDriveFilesTestEnv(t)
	ctx := context.Background()

	gw := ai.NewGateway(e.q, &provider.Fake{
		Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{
				Text:  `{"items":[{"title":"Seam task alpha","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"Doc","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal","checklist":[],"excerpt":{"section":"S1","quote":"Quote"},"blocked_by_indexes":[]}]}`,
				Model: "fake",
			}
		},
	}, NewAIQuota(NewEntitlementService(e.pool, e.q)), nil, ai.Options{})

	propSvc := NewDriveTaskProposalService(e.pool, e.q, e.ws, e.fileSvc, e.svc, e.contentSvc, gw)

	ownerConn := e.connectAccount(t, e.owner.ID, e.wsA.ID, "sub-seam-owner", "seam-owner@example.com")
	e.googleSrv.SetFile("ext-seam-doc", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-seam-doc", Name: "Seam Doc", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Seam Doc\nContent"),
		},
	})
	linked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{"ext-seam-doc"},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link = %+v, err=%v", linked, err)
	}
	fileID := linked[0].File.ID

	propView, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID, ProposeDriveTasksInput{
		Prompt: "Extract seam tasks",
	})
	if err != nil {
		t.Fatalf("Propose = %v", err)
	}

	// 1. requireOwnProposalQ (R1-3): owner succeeds; peer in same workspace,
	// unknown workspace, and unknown proposal ID all return ErrNotFound; operational
	// DB errors (cancelled context) propagate instead of being masked as ErrNotFound.
	pRow, err := propSvc.requireOwnProposalQ(ctx, e.q, e.owner.ID, e.wsA.ID, propView.ID)
	if err != nil || pRow.ID != propView.ID {
		t.Fatalf("requireOwnProposalQ(owner) = %+v, err=%v", pRow, err)
	}
	if _, err := propSvc.requireOwnProposalQ(ctx, e.q, e.peer.ID, e.wsA.ID, propView.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("requireOwnProposalQ(peer) = %v, want ErrNotFound", err)
	}
	if _, err := propSvc.requireOwnProposalQ(ctx, e.q, e.owner.ID, "01UNKNOWNWS000000000000000", propView.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("requireOwnProposalQ(unknown workspace) = %v, want ErrNotFound", err)
	}
	if _, err := propSvc.requireOwnProposalQ(ctx, e.q, e.owner.ID, e.wsA.ID, "01UNKNOWNPROP0000000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("requireOwnProposalQ(unknown proposal) = %v, want ErrNotFound", err)
	}
	canceledCtx, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := propSvc.requireOwnProposalQ(canceledCtx, e.q, e.owner.ID, e.wsA.ID, propView.ID); !errors.Is(err, context.Canceled) {
		t.Fatalf("requireOwnProposalQ(canceledCtx) = %v, want context.Canceled", err)
	}
	// 2. lockSourceForProposalQ: succeeds inside a caller transaction and returns the locked proposal row.
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	qtx := e.q.WithTx(tx)
	locked, err := propSvc.lockSourceForProposalQ(ctx, qtx, pRow)
	if err != nil || locked.ID != pRow.ID || locked.Status != DriveProposalStatusReady {
		_ = tx.Rollback(ctx)
		t.Fatalf("lockSourceForProposalQ(intact) = %+v, err=%v", locked, err)
	}
	_ = tx.Rollback(ctx)

	// 3. matchDriveProposalDuplicatesQ: matches open task by normalized title, keyed by 0-based position.
	task, err := e.taskSvc.Create(ctx, Human(e.owner.ID), e.wsA.ID, CreateTaskInput{Title: "Seam Task Alpha"})
	if err != nil {
		t.Fatalf("Create task: %v", err)
	}
	matches, err := matchDriveProposalDuplicatesQ(ctx, e.q, e.org.ID, e.wsA.ID, "", "", []string{"Unmatched title", "  seam   task ALPHA "})
	if err != nil || len(matches) != 2 || matches[0] != nil || matches[1] == nil || matches[1].TaskID != task.ID {
		t.Fatalf("matchDriveProposalDuplicatesQ = %+v, err=%v, want [nil, %s]", matches, err, task.ID)
	}

	// 4. Mark access lost -> lockSourceForProposalQ returns ErrDriveSourceChanged (409 drive_source_changed).
	if _, err := e.q.MarkDriveFileAccessLost(ctx, db.MarkDriveFileAccessLostParams{
		OrganizationID: e.org.ID,
		WorkspaceID:    e.wsA.ID,
		DriveFileID:    fileID,
		UserID:         e.owner.ID,
		ConnectionID:   ownerConn.ID,
	}); err != nil {
		t.Fatal(err)
	}
	tx2, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, lockErr := propSvc.lockSourceForProposalQ(ctx, e.q.WithTx(tx2), pRow)
	_ = tx2.Rollback(ctx)
	if !errors.Is(lockErr, ErrDriveSourceChanged) {
		t.Fatalf("lockSourceForProposalQ(access lost) = %v, want ErrDriveSourceChanged", lockErr)
	}

	// 5. Peer creates a proposal on their own connection; deactivating peer disconnects their connection
	// and discards their ready proposal in the same transaction (reason = source_disconnected).
	peerConn := e.connectAccount(t, e.peer.ID, e.wsA.ID, "sub-seam-peer", "seam-peer@example.com")
	e.googleSrv.SetFile("ext-seam-peer-doc", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-seam-peer-doc", Name: "Peer Doc", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Peer Doc\nPeer Content"),
		},
	})
	peerLinked, err := e.fileSvc.Link(ctx, Human(e.peer.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    peerConn.ID,
		ExternalFileIDs: []string{"ext-seam-peer-doc"},
	})
	if err != nil || len(peerLinked) != 1 || peerLinked[0].File == nil {
		t.Fatalf("peer Link = %+v, err=%v", peerLinked, err)
	}
	peerProp, err := propSvc.Propose(ctx, Human(e.peer.ID), e.wsA.ID, peerLinked[0].File.ID, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("peer Propose = %v", err)
	}

	orgMemberSvc := NewOrganizationMemberService(e.pool, e.q, e.orgs)
	orgMemberSvc.SetDrive(e.svc)

	// R1-11 rollback check on the shared org-lifecycle seam: if a later step in
	// Deactivate fails (e.g. recording drive_connection.disconnected), peer's
	// membership, Drive connection, ready proposal (status=ready, non-null items),
	// and discard audit row all roll back together.
	if _, err := e.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION uni_test_b5_lifecycle_rollback() RETURNS trigger
		LANGUAGE plpgsql AS $fn$
		BEGIN
		  IF NEW.organization_id = '`+e.org.ID+`' AND NEW.action = 'drive_connection.disconnected' THEN
		    RAISE EXCEPTION 'simulated lifecycle audit failure after proposal discard';
		  END IF;
		  RETURN NEW;
		END;
		$fn$`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `DROP TRIGGER IF EXISTS uni_test_b5_lifecycle_rollback ON audit_events`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `
		CREATE TRIGGER uni_test_b5_lifecycle_rollback
		BEFORE INSERT ON audit_events
		FOR EACH ROW EXECUTE FUNCTION uni_test_b5_lifecycle_rollback()`); err != nil {
		t.Fatal(err)
	}
	dropLifecycleTrigger := func() {
		_, _ = e.pool.Exec(ctx, `DROP TRIGGER IF EXISTS uni_test_b5_lifecycle_rollback ON audit_events`)
		_, _ = e.pool.Exec(ctx, `DROP FUNCTION IF EXISTS uni_test_b5_lifecycle_rollback()`)
	}
	t.Cleanup(dropLifecycleTrigger)

	if _, err := orgMemberSvc.Deactivate(ctx, e.owner.ID, e.org.ID, e.peer.ID); err == nil {
		t.Fatal("Deactivate succeeded past simulated audit failure")
	}
	var peerDeactivatedAt, peerConnDiscAt bool
	if err := e.pool.QueryRow(ctx, `SELECT deactivated_at IS NOT NULL FROM organization_members WHERE organization_id = $1 AND user_id = $2`, e.org.ID, e.peer.ID).Scan(&peerDeactivatedAt); err != nil || peerDeactivatedAt {
		t.Fatalf("after failed Deactivate: deactivated_at valid=%v err=%v, want false", peerDeactivatedAt, err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT disconnected_at IS NOT NULL FROM drive_connections WHERE id = $1`, peerConn.ID).Scan(&peerConnDiscAt); err != nil || peerConnDiscAt {
		t.Fatalf("after failed Deactivate: connection disconnected_at valid=%v err=%v, want false", peerConnDiscAt, err)
	}
	var peerPropStatus string
	var peerPropItems []byte
	if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, peerProp.ID).Scan(&peerPropStatus, &peerPropItems); err != nil || peerPropStatus != DriveProposalStatusReady || len(peerPropItems) == 0 {
		t.Fatalf("after failed Deactivate: proposal status=%q len(items)=%d err=%v, want ready with items", peerPropStatus, len(peerPropItems), err)
	}
	var peerDiscardAudits int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`, e.org.ID, peerProp.ID).Scan(&peerDiscardAudits); err != nil || peerDiscardAudits != 0 {
		t.Fatalf("after failed Deactivate: discard audit count=%d err=%v, want 0", peerDiscardAudits, err)
	}
	dropLifecycleTrigger()

	if _, err := orgMemberSvc.Deactivate(ctx, e.owner.ID, e.org.ID, e.peer.ID); err != nil {
		t.Fatalf("Deactivate peer = %v", err)
	}

	var peerDiscardReason, peerDiscardEmail, peerDiscardSub string
	if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, peerProp.ID).Scan(&peerPropStatus, &peerPropItems); err != nil || peerPropStatus != DriveProposalStatusDiscarded || peerPropItems != nil {
		t.Fatalf("peer proposal status after Deactivate = %q items=%v (err=%v), want discarded and nil items", peerPropStatus, peerPropItems, err)
	}
	if err := e.pool.QueryRow(ctx,
		`SELECT metadata::jsonb->>'reason', metadata::jsonb->>'google_email', metadata::jsonb->>'google_sub'
		 FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.org.ID, peerProp.ID,
	).Scan(&peerDiscardReason, &peerDiscardEmail, &peerDiscardSub); err != nil || peerDiscardReason != "source_disconnected" || peerDiscardEmail != "seam-peer@example.com" || peerDiscardSub != "sub-seam-peer" {
		t.Fatalf("peer proposal discard audit after Deactivate = (%q, %q, %q) err=%v, want (source_disconnected, seam-peer@example.com, sub-seam-peer)", peerDiscardReason, peerDiscardEmail, peerDiscardSub, err)
	}
}

// TestDriveProposalProposeFillsTodayStartDateThroughFakeGateway verifies that
// DriveTaskProposalService.Propose passes the ICT (UTC+7) today date to the
// prompt and normalizer, so an item with no dates from the fake gateway comes
// back with start_date = today and the Vietnamese default start_basis constant.
func TestDriveProposalProposeFillsTodayStartDateThroughFakeGateway(t *testing.T) {
	e := newDriveFilesTestEnv(t)
	ctx := context.Background()

	gw := ai.NewGateway(e.q, &provider.Fake{Reply: ai.FakeReply}, NewAIQuota(NewEntitlementService(e.pool, e.q)), nil, ai.Options{})
	propSvc := NewDriveTaskProposalService(e.pool, e.q, e.ws, e.fileSvc, e.svc, e.contentSvc, gw)
	// 2026-10-26 20:30 UTC is 2026-10-27 03:30 in UTC+7 (ICT).
	propSvc.now = func() time.Time {
		return time.Date(2026, 10, 26, 20, 30, 0, 0, time.UTC)
	}

	ownerConn := e.connectAccount(t, e.owner.ID, e.wsA.ID, "sub-today-owner", "today-owner@example.com")
	e.googleSrv.SetFile("ext-today-doc", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-today-doc", Name: "Today Sheet", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Today Sheet\n- Theo dõi nội dung tài liệu"),
		},
	})
	linked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{"ext-today-doc"},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link = %+v, err=%v", linked, err)
	}

	propView, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, linked[0].File.ID, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("Propose = %v", err)
	}
	if len(propView.Items) != 1 {
		t.Fatalf("len(propView.Items) = %d, want 1", len(propView.Items))
	}
	it := propView.Items[0]
	if it.StartDate == nil || *it.StartDate != "2026-10-27" {
		t.Fatalf("item.StartDate = %v, want 2026-10-27 (ICT today)", it.StartDate)
	}
	if it.StartBasis != "Không thấy ngày bắt đầu trong tài liệu, đặt hôm nay" {
		t.Fatalf("item.StartBasis = %q, want default Vietnamese basis", it.StartBasis)
	}
	if it.DueDate != nil || it.DueBasis != "" {
		t.Fatalf("item.DueDate/DueBasis = %v / %q, want nil and empty", it.DueDate, it.DueBasis)
	}
}

// TestCreateTasksFromProposalBatchDependenciesDuplicatesAndRollback exercises
// DriveTaskProposalService.CreateTasksFromProposal at the service layer (spec §8.5):
//   - Subset conversion (items[0] and items[2]), intra-batch dependencies (blocked_by),
//     cycle refusal (parent_cycle), and reference to unselected index refusal.
//   - Batch duplicate refusal (open task + intra-batch duplicate) with item_indexes,
//     and allow_duplicate override (batch-level and item-level).
//   - Full rollback when any step fails (no tasks, no dependencies, no links,
//     proposal remains ready with items intact).
//   - Proposal state transitions (status=converted, items=NULL), 409 proposal_not_ready
//     on second submit or after discard, 410 proposal_expired after expires_at,
//     and 409 drive_source_changed when connection/file/access changed.
//   - Concurrent double-submit serialization via FOR UPDATE (1 x success, 1 x 409 proposal_not_ready).
//   - Audit rows and outbox events (task.created with source="drive_task_proposal" and drive_file_id,
//     task.updated for dependencies, task.drive_file_linked + drive_file.task_linked per task, and
//     drive_task_proposal.tasks_created + drive_task_proposal.converted with zero document text).
func TestCreateTasksFromProposalBatchDependenciesDuplicatesAndRollback(t *testing.T) {
	e := newDriveFilesTestEnv(t)
	ctx := context.Background()

	var aiText string
	gw := ai.NewGateway(e.q, &provider.Fake{
		Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			if aiText != "" {
				return provider.CompletionResponse{Text: aiText, Model: "fake"}
			}
			return provider.CompletionResponse{
				Text: `{"items":[
					{"title":"Task Alpha","assignee_member_id":"","assignee_basis":"","priority":"high","priority_basis":"Doc","start_date":"2026-10-27","start_basis":"","due_date":"2026-11-05","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal A","checklist":["Step A"],"excerpt":{"section":"S1","quote":"Quote A"},"blocked_by_indexes":[]},
					{"title":"Task Beta","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"Doc","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal B","checklist":[],"excerpt":{"section":"S2","quote":"Quote B"},"blocked_by_indexes":[0]},
					{"title":"Task Gamma","assignee_member_id":"","assignee_basis":"","priority":"low","priority_basis":"Doc","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal C","checklist":[],"excerpt":{"section":"S3","quote":"Quote C"},"blocked_by_indexes":[0,1]}
				]}`,
				Model: "fake",
			}
		},
	}, NewAIQuota(NewEntitlementService(e.pool, e.q)), nil, ai.Options{})

	propSvc := NewDriveTaskProposalService(e.pool, e.q, e.ws, e.fileSvc, e.svc, e.contentSvc, gw)
	propSvc.SetTasks(e.taskSvc)
	e.fileSvc.SetTaskCreationsLoader(e.fileSvc)
	propSvc.SetTaskCreationsLoader(e.fileSvc)

	ownerConn := e.connectAccount(t, e.owner.ID, e.wsA.ID, "sub-b6-owner", "b6-owner@example.com")
	e.googleSrv.SetFile("ext-b6-doc", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-b6-doc", Name: "B6 Launch Spec", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# B6 Launch Spec\nSECRET_B6_DOC_CONTENT_DO_NOT_LEAK"),
		},
	})
	linked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{"ext-b6-doc"},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link = %+v, err=%v", linked, err)
	}
	fileID := linked[0].File.ID

	prop, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID, ProposeDriveTasksInput{
		Prompt: "Extract B6 tasks",
	})
	if err != nil || len(prop.Items) != 3 {
		t.Fatalf("Propose = %+v, err=%v", prop, err)
	}

	// 1. Peer (non-requester) and Guest are refused before touching the proposal.
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.peer.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{{Index: 0, Title: "Peer attempt"}},
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer CreateTasksFromProposal = %v, want ErrNotFound", err)
	}
	as := NewAuthService(e.pool, e.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	guest := registerVerified(t, e.q, as, "guest-b6-"+util.NewID()+"@example.com", "Guest B6")
	addOrgMember(t, e.q, e.org.ID, guest.ID)
	e.guests[guest.ID] = true
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(guest.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{{Index: 0, Title: "Guest attempt"}},
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("guest CreateTasksFromProposal = %v, want ErrForbidden", err)
	}

	// 2. Validation and rollback:
	// - blocked_by_indexes pointing to unselected item index 1 -> 400 Invalid
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Task Alpha"},
			{Index: 2, Title: "Task Gamma", BlockedByIndexes: []int{1}},
		},
	}); err == nil {
		t.Fatal("expected error when blocked_by_indexes references unselected item index 1")
	}
	// - intra-batch dependency cycle (0 -> 2 and 2 -> 0) -> 422 parent_cycle
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Task Alpha", BlockedByIndexes: []int{2}},
			{Index: 2, Title: "Task Gamma", BlockedByIndexes: []int{0}},
		},
	}); !isCodedError(err, http.StatusUnprocessableEntity, "parent_cycle") {
		t.Fatalf("dependency cycle err = %v, want 422 parent_cycle", err)
	}
	// - self dependency (0 -> 0) -> 422 parent_cycle
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Task Alpha", BlockedByIndexes: []int{0}},
		},
	}); !isCodedError(err, http.StatusUnprocessableEntity, "parent_cycle") {
		t.Fatalf("self dependency err = %v, want 422 parent_cycle", err)
	}
	// - mid-transaction Before/create rollback: item 0 has valid assignee, item 2 has non-member assignee -> 422 assignee_not_member, all counts unchanged, proposal still ready.
	beforeBadAssignee := snapshotProposalBatchCounts(t, ctx, e)
	badAssignee := "01NONEXISTENTUSER000000000"
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Task Alpha", AssigneeMemberID: &e.owner.ID},
			{Index: 2, Title: "Task Gamma", AssigneeMemberID: &badAssignee},
		},
	}); !isCodedError(err, http.StatusUnprocessableEntity, "assignee_not_member") {
		t.Fatalf("non-member assignee err = %v, want 422 assignee_not_member", err)
	}
	assertProposalBatchCountsUnchanged(t, ctx, e, beforeBadAssignee, "after non-member assignee rollback")
	assertProposalReadyWithItems(t, ctx, e, prop.ID, 3)

	// - R5a: mid-After dependency-step failure rollback: item 1 (blocked by 0) succeeds in setDependencyTx,
	//   then a reverse edge (task[0] depends_on task[2]) is seeded inside the same transaction so the second
	//   setDependencyTx call (item 2 blocked by 0) fails with 422 parent_cycle -> full rollback of tasks,
	//   task_dependencies, drive_file_task_links, drive_task_proposal_links, audit_events, outbox_events,
	//   and proposal remains ready with items intact.
	beforeDepRollback := snapshotProposalBatchCounts(t, ctx, e)
	hookCalls := 0
	testProposalAfterDepHook = func(hctx context.Context, qtx *db.Queries, batchTasks []db.Task) error {
		hookCalls++
		if hookCalls == 1 && len(batchTasks) == 3 {
			_, herr := qtx.CreateTaskDependency(hctx, db.CreateTaskDependencyParams{
				ID:              util.NewID(),
				OrganizationID:  e.org.ID,
				WorkspaceID:     e.wsA.ID,
				TaskID:          batchTasks[0].ID,
				DependsOnTaskID: batchTasks[2].ID,
				Type:            dependencyTypeBlockedBy,
			})
			return herr
		}
		return nil
	}
	_, depRollbackErr := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Rollback Alpha"},
			{Index: 1, Title: "Rollback Beta", BlockedByIndexes: []int{0}},
			{Index: 2, Title: "Rollback Gamma", BlockedByIndexes: []int{0}},
		},
	})
	testProposalAfterDepHook = nil
	if hookCalls != 1 || !isCodedError(depRollbackErr, http.StatusUnprocessableEntity, "parent_cycle") {
		t.Fatalf("mid-After dependency failure: hookCalls=%d err=%v, want hookCalls=1 and 422 parent_cycle", hookCalls, depRollbackErr)
	}
	assertProposalBatchCountsUnchanged(t, ctx, e, beforeDepRollback, "after mid-After dependency step failure")
	assertProposalReadyWithItems(t, ctx, e, prop.ID, 3)

	// - R5b + R6: late-After unique conflict on InsertDriveTaskProposalLink: seed an existing
	//   drive_task_proposal_links row for (prop.ID, item_index=2), then submit [0, 2 (blocked_by: [0])]
	//   so tasks, dependency edge, item 0's file/proposal links, and item 2's file link are written in After
	//   before item 2's InsertDriveTaskProposalLink hits ON CONFLICT DO NOTHING -> 409 proposal_item_already_converted
	//   and rolls back every table.
	seedConflictLinkID := util.NewID()
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO drive_task_proposal_links (
			id, organization_id, workspace_id, proposal_id, item_index,
			task_id, drive_file_id, external_file_id, created_by, created_by_kind
		) VALUES ($1, $2, $3, $4, 2, '01SEEDTASK0000000000000000', $5, 'ext-b6-doc', $6, 'human')
	`, seedConflictLinkID, e.org.ID, e.wsA.ID, prop.ID, fileID, e.owner.ID); err != nil {
		t.Fatalf("seed conflicting proposal link: %v", err)
	}
	beforeConflictRollback := snapshotProposalBatchCounts(t, ctx, e)
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Conflict Rollback Item 0"},
			{Index: 2, Title: "Conflict Rollback Item 2", BlockedByIndexes: []int{0}},
		},
	}); !isCodedError(err, http.StatusConflict, "proposal_item_already_converted") {
		t.Fatalf("unique conflict on proposal_links err = %v, want 409 proposal_item_already_converted", err)
	}
	assertProposalBatchCountsUnchanged(t, ctx, e, beforeConflictRollback, "after proposal_item_already_converted rollback")
	assertProposalReadyWithItems(t, ctx, e, prop.ID, 3)
	if _, err := e.pool.Exec(ctx, `DELETE FROM drive_task_proposal_links WHERE id = $1`, seedConflictLinkID); err != nil {
		t.Fatalf("remove seeded conflict link: %v", err)
	}
	// 3. Duplicate refusal (existing open task + intra-batch duplicate) with item_indexes.
	existingOpen, err := e.taskSvc.Create(ctx, Human(e.owner.ID), e.wsA.ID, CreateTaskInput{
		Title: "Existing Open Duplicate",
	})
	if err != nil {
		t.Fatalf("Create existingOpen: %v", err)
	}
	_, dupErr := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "  existing   OPEN duplicate "},
			{Index: 1, Title: "Repeated In Batch"},
			{Index: 2, Title: "repeated in batch"},
		},
	})
	var ce CodedError
	if !errors.As(dupErr, &ce) || ce.Status != http.StatusConflict || ce.Code != "active_duplicate_task" {
		t.Fatalf("duplicate batch err = %v, want 409 active_duplicate_task", dupErr)
	}
	if gotIdx, ok := ce.Fields["item_indexes"].([]int); !ok || !reflect.DeepEqual(gotIdx, []int{0, 1, 2}) {
		t.Fatalf("active_duplicate_task item_indexes = %#v, want []int{0, 1, 2}", ce.Fields["item_indexes"])
	}
	if ce.Fields["task_id"] != existingOpen.ID {
		t.Fatalf("active_duplicate_task task_id = %v, want %s", ce.Fields["task_id"], existingOpen.ID)
	}

	// 4. Successful conversion of shuffled subset (items [2, 0] in non-ascending request order,
	// with item 2 blocked by item 0, AllowDuplicate on item 0, and excerpt-bearing descriptions).
	startDate := "2026-10-27"
	dueDate := "2026-11-05"
	wantDesc2 := "## Mục tiêu\nHoàn thiện tài liệu kỹ thuật\n\n## Checklist\n- [ ] Cập nhật sơ đồ\n\n> **Trích đoạn (S3):** \"Quote C — giữ nguyên sau khi xóa đề xuất\"\n\nNguồn: https://docs.google.com/document/d/ext-b6-doc/edit"
	wantDesc0 := "  ## Mục tiêu\nKhởi chạy thử nghiệm\n\n> **Trích đoạn (S1):** \"Quote A\"  "
	created, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{
				Index:            2,
				Title:            "Task Gamma Final",
				Description:      wantDesc2,
				AssigneeMemberID: &e.peer.ID,
				Priority:         "low",
				BlockedByIndexes: []int{0},
			},
			{
				Index:            0,
				Title:            "Existing Open Duplicate",
				Description:      wantDesc0,
				AssigneeMemberID: &e.owner.ID,
				Priority:         "high",
				StartDate:        &startDate,
				DueDate:          &dueDate,
				BlockedByIndexes: []int{},
				AllowDuplicate:   true,
			},
		},
	})
	if err != nil {
		t.Fatalf("CreateTasksFromProposal = %v", err)
	}
	if len(created.TaskIDs) != 2 || len(created.Items) != 2 {
		t.Fatalf("created = %+v, want 2 tasks", created)
	}
	if created.Items[0].Index != 2 || created.Items[0].TaskID != created.TaskIDs[0] ||
		created.Items[1].Index != 0 || created.Items[1].TaskID != created.TaskIDs[1] {
		t.Fatalf("created.Items = %+v, TaskIDs = %+v, want [{Index:2 TaskID:%s} {Index:0 TaskID:%s}]",
			created.Items, created.TaskIDs, created.TaskIDs[0], created.TaskIDs[1])
	}
	taskIDForItem2 := created.TaskIDs[0]
	taskIDForItem0 := created.TaskIDs[1]

	// Verify origin_type, origin_id, and single task.created audit row with source="drive_task_proposal" and drive_file_id on each created task.
	for _, tid := range created.TaskIDs {
		taskRow, terr := e.taskSvc.Get(ctx, e.owner.ID, tid)
		if terr != nil {
			t.Fatalf("Get task %s: %v", tid, terr)
		}
		if taskRow.OriginType.String != "drive_task_proposal" || taskRow.OriginID.String != prop.ID {
			t.Fatalf("task %s origin = (%q, %q), want (drive_task_proposal, %s)", tid, taskRow.OriginType.String, taskRow.OriginID.String, prop.ID)
		}
		var taskCreatedCount int
		var rawTaskMeta []byte
		if err := e.pool.QueryRow(ctx,
			`SELECT count(*), min(metadata::text)::bytea FROM audit_events WHERE organization_id = $1 AND action = 'task.created' AND resource_type = 'task' AND resource_id = $2`,
			e.org.ID, tid,
		).Scan(&taskCreatedCount, &rawTaskMeta); err != nil || taskCreatedCount != 1 {
			t.Fatalf("task.created audit count for %s = %d (err=%v), want 1", tid, taskCreatedCount, err)
		}
		var taskMeta map[string]any
		if err := json.Unmarshal(rawTaskMeta, &taskMeta); err != nil {
			t.Fatalf("unmarshal task.created metadata (%s): %v", tid, err)
		}
		if taskMeta["source"] != "drive_task_proposal" || taskMeta["drive_file_id"] != fileID {
			t.Fatalf("task.created (%s) metadata = %+v, want source=\"drive_task_proposal\" drive_file_id=%q", tid, taskMeta, fileID)
		}
	}

	// Verify submitted descriptions (including excerpt text and whitespace) on created tasks before proposal purge.
	gotTask2Before, err := e.taskSvc.Get(ctx, e.owner.ID, taskIDForItem2)
	if err != nil || gotTask2Before.Description != wantDesc2 {
		t.Fatalf("task[item 2] description before purge = %q (err=%v), want %q", gotTask2Before.Description, err, wantDesc2)
	}
	gotTask0Before, err := e.taskSvc.Get(ctx, e.owner.ID, taskIDForItem0)
	if err != nil || gotTask0Before.Description != wantDesc0 {
		t.Fatalf("task[item 0] description before purge = %q (err=%v), want %q", gotTask0Before.Description, err, wantDesc0)
	}

	// Verify dependency row: taskIDForItem2 (item 2) is blocked_by taskIDForItem0 (item 0).
	var depType string
	if err := e.pool.QueryRow(ctx,
		`SELECT type FROM task_dependencies WHERE workspace_id = $1 AND task_id = $2 AND depends_on_task_id = $3`,
		e.wsA.ID, taskIDForItem2, taskIDForItem0,
	).Scan(&depType); err != nil || depType != "blocked_by" {
		t.Fatalf("task_dependencies row = %q (err=%v), want blocked_by", depType, err)
	}

	// Verify drive_file_task_links count and exact persisted 0-based (item_index, task_id) pairs in drive_task_proposal_links (R7).
	var fileLinkCount int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE drive_file_id = $1 AND task_id = ANY($2)`, fileID, created.TaskIDs).Scan(&fileLinkCount); err != nil || fileLinkCount != 2 {
		t.Fatalf("drive_file_task_links count = %d (err=%v), want 2", fileLinkCount, err)
	}
	linkRows, err := e.pool.Query(ctx, `SELECT item_index, task_id FROM drive_task_proposal_links WHERE proposal_id = $1 ORDER BY item_index ASC`, prop.ID)
	if err != nil {
		t.Fatalf("query drive_task_proposal_links: %v", err)
	}
	var persistedLinks []CreatedDriveProposalTask
	for linkRows.Next() {
		var idx int
		var tid string
		if err := linkRows.Scan(&idx, &tid); err != nil {
			linkRows.Close()
			t.Fatalf("scan drive_task_proposal_links: %v", err)
		}
		persistedLinks = append(persistedLinks, CreatedDriveProposalTask{Index: idx, TaskID: tid})
	}
	linkRows.Close()
	wantPersistedLinks := []CreatedDriveProposalTask{
		{Index: 0, TaskID: taskIDForItem0},
		{Index: 2, TaskID: taskIDForItem2},
	}
	if !reflect.DeepEqual(persistedLinks, wantPersistedLinks) {
		t.Fatalf("persisted drive_task_proposal_links = %+v, want %+v", persistedLinks, wantPersistedLinks)
	}
	// Verify proposal row is now status='converted' and items IS NULL.
	var propStatus string
	var propItems []byte
	if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, prop.ID).Scan(&propStatus, &propItems); err != nil {
		t.Fatalf("query proposal after convert: %v", err)
	}
	if propStatus != DriveProposalStatusConverted || propItems != nil {
		t.Fatalf("proposal after convert: status=%q items=%v, want converted and nil", propStatus, propItems)
	}

	// Verify audit row drive_task_proposal.tasks_created carries all 6 required keys and zero doc text,
	// and outbox row drive_task_proposal.converted {proposal_id, workspace_id} is emitted.
	var rawMeta []byte
	if err := e.pool.QueryRow(ctx,
		`SELECT metadata FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.tasks_created' AND resource_id = $2`,
		e.org.ID, prop.ID,
	).Scan(&rawMeta); err != nil {
		t.Fatalf("query drive_task_proposal.tasks_created audit: %v", err)
	}
	if strings.Contains(string(rawMeta), "SECRET_B6_DOC_CONTENT_DO_NOT_LEAK") {
		t.Fatalf("audit metadata leaked document content: %s", string(rawMeta))
	}
	var meta struct {
		DriveFileID string   `json:"drive_file_id"`
		Count       *int     `json:"count"`
		ItemIndexes []int    `json:"item_indexes"`
		TaskIDs     []string `json:"task_ids"`
		GoogleEmail string   `json:"google_email"`
		GoogleSub   string   `json:"google_sub"`
	}
	if err := json.Unmarshal(rawMeta, &meta); err != nil {
		t.Fatalf("unmarshal drive_task_proposal.tasks_created metadata: %v", err)
	}
	if meta.DriveFileID != fileID || meta.Count == nil || *meta.Count != 2 ||
		!reflect.DeepEqual(meta.ItemIndexes, []int{2, 0}) || !reflect.DeepEqual(meta.TaskIDs, created.TaskIDs) ||
		meta.GoogleEmail != "b6-owner@example.com" || meta.GoogleSub != "sub-b6-owner" {
		t.Fatalf("drive_task_proposal.tasks_created metadata = %s, want drive_file_id=%q count=2 item_indexes=[2 0] task_ids=%v", string(rawMeta), fileID, created.TaskIDs)
	}
	var convertedOutboxCount int
	if err := e.pool.QueryRow(ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = 'drive_task_proposal.converted' AND payload::jsonb @> jsonb_build_object('proposal_id', $1::text, 'workspace_id', $2::text)`,
		prop.ID, e.wsA.ID,
	).Scan(&convertedOutboxCount); err != nil || convertedOutboxCount != 1 {
		t.Fatalf("outbox drive_task_proposal.converted count = %d (err=%v), want 1", convertedOutboxCount, err)
	}

	// 5. Re-submitting the converted proposal returns 409 proposal_not_ready.
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{{Index: 0, Title: "Again"}},
	}); !isCodedError(err, http.StatusConflict, "proposal_not_ready") {
		t.Fatalf("resubmit converted proposal = %v, want 409 proposal_not_ready", err)
	}

	// 6. Expired proposal returns 410 proposal_expired.
	propExp, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("Propose for expiry: %v", err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE drive_task_proposals SET expires_at = now() - interval '1 minute' WHERE id = $1`, propExp.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, propExp.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{{Index: 0, Title: "Expired"}},
	}); !isCodedError(err, http.StatusGone, "proposal_expired") {
		t.Fatalf("expired proposal = %v, want 410 proposal_expired", err)
	}

	// 7. Concurrent double-submit on a ready proposal: exactly one succeeds (201), one gets 409 proposal_not_ready.
	propRace, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("Propose for race: %v", err)
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for g := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, propRace.ID, CreateTasksFromProposalInput{
				AllowDuplicate: true,
				Items: []CreateTasksFromProposalItemInput{
					{Index: 0, Title: fmt.Sprintf("Race Task %d", idx)},
				},
			})
		}(g)
	}
	wg.Wait()
	successes, notReady := 0, 0
	for _, rerr := range errs {
		if rerr == nil {
			successes++
		} else if isCodedError(rerr, http.StatusConflict, "proposal_not_ready") {
			notReady++
		} else {
			t.Fatalf("unexpected concurrent CreateTasksFromProposal error: %v", rerr)
		}
	}
	if successes != 1 || notReady != 1 {
		t.Fatalf("concurrent double-submit: successes=%d notReady=%d (errs=%v), want 1 and 1", successes, notReady, errs)
	}
}

// TestDriveTasksCreatedFromDocumentProvenanceAndPrivacy verifies §8.8:
//   - tasks_created summary and task_creations / prior_creations groups across
//     GET /drive-files, GET /drive-files/{id}, GET /tasks/{id}/drive-files,
//     POST /task-proposals, and GET /drive-task-proposals/{id}.
//   - Unlinking a task from the Drive file (DELETE /tasks/{id}/drive-files/{fileID})
//     removes it from used_in_tasks but preserves it in tasks_created and task_creations.
//   - Unlinking and relinking the same external_file_id in the workspace preserves
//     prior tasks_created and task_creations via external_file_id.
//   - Deleting a task (TaskService.Delete) drops it from tasks_created and omits empty groups.
//   - Task visibility filtering (DriveTaskAccessPolicy.CanViewTask) hides tasks a viewer
//     may not see from both tasks_created.count and task_creations / prior_creations.
func TestDriveTasksCreatedFromDocumentProvenanceAndPrivacy(t *testing.T) {
	e := newDriveFilesTestEnv(t)
	ctx := context.Background()

	gw := ai.NewGateway(e.q, &provider.Fake{
		Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{
				Text: `{"items":[
					{"title":"Provenance Task 1","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"","checklist":[],"excerpt":{"section":"S1","quote":"Q1"},"blocked_by_indexes":[]},
					{"title":"Provenance Task 2","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"","checklist":[],"excerpt":{"section":"S2","quote":"Q2"},"blocked_by_indexes":[]}
				]}`,
				Model: "fake",
			}
		},
	}, NewAIQuota(NewEntitlementService(e.pool, e.q)), nil, ai.Options{})

	propSvc := NewDriveTaskProposalService(e.pool, e.q, e.ws, e.fileSvc, e.svc, e.contentSvc, gw)
	propSvc.SetTasks(e.taskSvc)
	e.fileSvc.SetTaskCreationsLoader(e.fileSvc)
	propSvc.SetTaskCreationsLoader(e.fileSvc)

	ownerConn := e.connectAccount(t, e.owner.ID, e.wsA.ID, "sub-prov-owner", "prov-owner@example.com")
	const extID = "ext-prov-doc-88"
	e.googleSrv.SetFile(extID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: extID, Name: "Provenance Spec", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Provenance Spec\nBody"),
		},
	})
	linked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{extID},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link = %+v, err=%v", linked, err)
	}
	fileID1 := linked[0].File.ID

	// Batch 1: create 2 tasks from proposal 1 with edited goal/checklist/excerpt/link descriptions (R9).
	prop1, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID1, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("Propose 1: %v", err)
	}
	wantDescA := "## Mục tiêu\nTriển khai cổng thanh toán\n\n## Danh sách việc\n- [ ] Kiểm thử sandbox\n\n> **Trích đoạn (§2.1):** \"Thanh toán phải hoàn tất trước ngày 05/11.\"\n\nNguồn: https://docs.google.com/document/d/ext-prov-doc-88/edit"
	wantDescB := "  ## Mục tiêu\nĐối soát hóa đơn\n\n> **Trích đoạn (§3.4):** \"Giữ nguyên văn bản trích dẫn khi xóa bản nháp.\"  "
	res1, err := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, prop1.ID, CreateTasksFromProposalInput{
		Items: []CreateTasksFromProposalItemInput{
			{Index: 0, Title: "Prov Batch 1 Task A", Description: wantDescA},
			{Index: 1, Title: "Prov Batch 1 Task B", Description: wantDescB},
		},
	})
	if err != nil || len(res1.TaskIDs) != 2 {
		t.Fatalf("CreateTasksFromProposal 1 = %+v, err=%v", res1, err)
	}
	taskA, taskB := res1.TaskIDs[0], res1.TaskIDs[1]

	// Verify task descriptions before proposal row deletion (R9).
	for tid, wantDesc := range map[string]string{taskA: wantDescA, taskB: wantDescB} {
		gotTask, terr := e.taskSvc.Get(ctx, e.owner.ID, tid)
		if terr != nil || gotTask.Description != wantDesc {
			t.Fatalf("Get(%s) description before sweep = %q (err=%v), want %q", tid, gotTask.Description, terr, wantDesc)
		}
	}

	// 0. Run B7 retention sweep to delete the converted proposal row (prop1) from drive_task_proposals,
	// prove prop1 is gone, and verify that both task descriptions (R9) and tasks_created / task_creations
	// across file detail, file list, and task cards (R8) remain unchanged!
	sweeper := NewDriveProposalRetentionSweeper(propSvc, nil)
	sweptCount, err := sweeper.Sweep(ctx)
	if err != nil || sweptCount < 1 {
		t.Fatalf("sweeper.Sweep after convert = %d, err=%v, want >= 1", sweptCount, err)
	}
	var prop1Remaining int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM drive_task_proposals WHERE id = $1`, prop1.ID).Scan(&prop1Remaining); err != nil || prop1Remaining != 0 {
		t.Fatalf("prop1 count in drive_task_proposals after sweep = %d (err=%v), want 0", prop1Remaining, err)
	}
	for tid, wantDesc := range map[string]string{taskA: wantDescA, taskB: wantDescB} {
		gotTask, terr := e.taskSvc.Get(ctx, e.owner.ID, tid)
		if terr != nil || gotTask.Description != wantDesc {
			t.Fatalf("Get(%s) description after proposal row deleted = %q (err=%v), want %q", tid, gotTask.Description, terr, wantDesc)
		}
	}
	detailAfterPurge, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID1)
	if err != nil {
		t.Fatalf("Get(fileID1) after proposal purge: %v", err)
	}
	if detailAfterPurge.TasksCreated.Count != 2 || detailAfterPurge.TasksCreated.LastCreatedAt == nil || detailAfterPurge.TasksCreated.LastCreatedByName == nil {
		t.Fatalf("after proposal purge TasksCreated = %+v, want Count=2 with non-nil LastCreatedAt/ByName", detailAfterPurge.TasksCreated)
	}
	if len(detailAfterPurge.TaskCreations) != 1 || detailAfterPurge.TaskCreations[0].ProposalID != prop1.ID || len(detailAfterPurge.TaskCreations[0].Tasks) != 2 {
		t.Fatalf("after proposal purge TaskCreations = %+v, want 1 group for prop1 with 2 tasks", detailAfterPurge.TaskCreations)
	}
	mineAfterPurge, err := e.fileSvc.ListMine(ctx, Human(e.owner.ID), e.wsA.ID, ListDriveFilesFilter{})
	if err != nil || len(mineAfterPurge.Files) != 1 || mineAfterPurge.Files[0].TasksCreated.Count != 2 {
		t.Fatalf("ListMine after proposal purge = %+v, err=%v", mineAfterPurge, err)
	}
	cardsAfterPurge, err := e.fileSvc.ListForTask(ctx, Human(e.owner.ID), taskA)
	if err != nil || len(cardsAfterPurge) != 1 || cardsAfterPurge[0].TasksCreated.Count != 2 {
		t.Fatalf("ListForTask(taskA) after proposal purge = %+v, err=%v", cardsAfterPurge, err)
	}
	// 1. RemoveFromTask on taskA: unlinks drive_file_task_links, so used_in_count drops to 1,
	// but tasks_created.count stays 2 and task_creations still lists both taskA and taskB!
	if err := e.fileSvc.RemoveFromTask(ctx, Human(e.owner.ID), taskA, fileID1); err != nil {
		t.Fatalf("RemoveFromTask(taskA): %v", err)
	}
	detail1, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID1)
	if err != nil {
		t.Fatalf("Get(fileID1): %v", err)
	}
	if detail1.UsedInCount != 1 || detail1.TasksCreated.Count != 2 {
		t.Fatalf("after RemoveFromTask: UsedInCount=%d TasksCreated.Count=%d, want 1 and 2", detail1.UsedInCount, detail1.TasksCreated.Count)
	}
	if len(detail1.TaskCreations) != 1 || len(detail1.TaskCreations[0].Tasks) != 2 {
		t.Fatalf("after RemoveFromTask: TaskCreations = %+v, want 1 group with 2 tasks", detail1.TaskCreations)
	}

	// 2. Unlink fileID1 from workspace and relink the same external_file_id -> new drive_files.id,
	// but tasks_created and task_creations survive because they are keyed by (workspace_id, external_file_id)!
	if err := e.fileSvc.Unlink(ctx, Human(e.owner.ID), e.wsA.ID, fileID1); err != nil {
		t.Fatalf("Unlink(fileID1): %v", err)
	}
	relinked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{extID},
		TaskID:          &taskB,
	})
	if err != nil || len(relinked) != 1 || relinked[0].File == nil {
		t.Fatalf("Relink = %+v, err=%v", relinked, err)
	}
	fileID2 := relinked[0].File.ID
	if fileID2 == fileID1 {
		t.Fatalf("expected new drive_files.id after unlink+relink, got same %s", fileID2)
	}

	detail2, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatalf("Get(fileID2): %v", err)
	}
	if detail2.TasksCreated.Count != 2 || detail2.TasksCreated.LastCreatedAt == nil || detail2.TasksCreated.LastCreatedByName == nil {
		t.Fatalf("after relink TasksCreated = %+v, want Count=2 with non-nil LastCreatedAt/ByName", detail2.TasksCreated)
	}
	if len(detail2.TaskCreations) != 1 || detail2.TaskCreations[0].ProposalID != prop1.ID || len(detail2.TaskCreations[0].Tasks) != 2 {
		t.Fatalf("after relink TaskCreations = %+v, want 1 group for prop1 with 2 tasks", detail2.TaskCreations)
	}

	// Check ListMine and ListForTask also carry tasks_created.count == 2.
	mine, err := e.fileSvc.ListMine(ctx, Human(e.owner.ID), e.wsA.ID, ListDriveFilesFilter{})
	if err != nil || len(mine.Files) != 1 || mine.Files[0].TasksCreated.Count != 2 {
		t.Fatalf("ListMine = %+v, err=%v", mine, err)
	}
	cards, err := e.fileSvc.ListForTask(ctx, Human(e.owner.ID), taskB)
	if err != nil || len(cards) != 1 || cards[0].TasksCreated.Count != 2 {
		t.Fatalf("ListForTask(taskB) = %+v, err=%v", cards, err)
	}

	// Check Propose and Get on a second proposal for the relinked file include prior_creations and tasks_created!
	prop2, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID2, ProposeDriveTasksInput{})
	if err != nil {
		t.Fatalf("Propose 2: %v", err)
	}
	if prop2.TasksCreated.Count != 2 || len(prop2.PriorCreations) != 1 || prop2.PriorCreations[0].ProposalID != prop1.ID {
		t.Fatalf("Propose 2 prior_creations = %+v / %+v, want count=2 and prop1 group", prop2.TasksCreated, prop2.PriorCreations)
	}
	gotProp2, err := propSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, prop2.ID)
	if err != nil {
		t.Fatalf("Get(prop2): %v", err)
	}
	if gotProp2.TasksCreated.Count != 2 || len(gotProp2.PriorCreations) != 1 {
		t.Fatalf("Get(prop2) prior_creations = %+v / %+v", gotProp2.TasksCreated, gotProp2.PriorCreations)
	}

	// 3. Task visibility filtering: restrict viewer from seeing taskA -> count becomes 1, group has only taskB;
	// restrict viewer from seeing both taskA and taskB -> count becomes 0, group is dropped!
	e.fileSvc.SetTaskAccessPolicy(DriveTaskAccessPolicy{
		CanViewTask: func(_ context.Context, _ string, _ db.WorkspaceMember, tID string) bool {
			return tID != taskA
		},
	})
	filteredOne, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatal(err)
	}
	if filteredOne.TasksCreated.Count != 1 || len(filteredOne.TaskCreations) != 1 || len(filteredOne.TaskCreations[0].Tasks) != 1 || filteredOne.TaskCreations[0].Tasks[0].TaskID != taskB {
		t.Fatalf("filteredOne = count:%d groups:%+v, want count=1 with [taskB]", filteredOne.TasksCreated.Count, filteredOne.TaskCreations)
	}

	e.fileSvc.SetTaskAccessPolicy(DriveTaskAccessPolicy{
		CanViewTask: func(_ context.Context, _ string, _ db.WorkspaceMember, _ string) bool {
			return false
		},
	})
	filteredAll, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatal(err)
	}
	if filteredAll.TasksCreated.Count != 0 || filteredAll.TasksCreated.LastCreatedAt != nil || len(filteredAll.TaskCreations) != 0 {
		t.Fatalf("filteredAll = summary:%+v groups:%+v, want count=0 and empty groups", filteredAll.TasksCreated, filteredAll.TaskCreations)
	}
	e.fileSvc.SetTaskAccessPolicy(DriveTaskAccessPolicy{})

	// 4. Deleting taskA via TaskService.Delete removes it from tasks_created and task_creations;
	// deleting taskB too drops the empty group and resets count to 0.
	if err := e.taskSvc.Delete(ctx, e.owner.ID, taskA); err != nil {
		t.Fatalf("Delete(taskA): %v", err)
	}
	afterDelA, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatal(err)
	}
	if afterDelA.TasksCreated.Count != 1 || len(afterDelA.TaskCreations) != 1 || len(afterDelA.TaskCreations[0].Tasks) != 1 {
		t.Fatalf("after Delete(taskA): summary=%+v groups=%+v, want count=1 and 1 task", afterDelA.TasksCreated, afterDelA.TaskCreations)
	}
	if err := e.taskSvc.Delete(ctx, e.owner.ID, taskB); err != nil {
		t.Fatalf("Delete(taskB): %v", err)
	}
	afterDelBoth, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatal(err)
	}
	if afterDelBoth.TasksCreated.Count != 0 || len(afterDelBoth.TaskCreations) != 0 {
		t.Fatalf("after Delete(taskB): summary=%+v groups=%+v, want count=0 and 0 groups", afterDelBoth.TasksCreated, afterDelBoth.TaskCreations)
	}

	// 5. Verify 5-group cap on task_creations / prior_creations when >5 proposal batches convert.
	for b := range 6 {
		pb, perr := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID2, ProposeDriveTasksInput{})
		if perr != nil {
			t.Fatalf("Propose batch %d: %v", b, perr)
		}
		if _, cerr := propSvc.CreateTasksFromProposal(ctx, Human(e.owner.ID), e.wsA.ID, pb.ID, CreateTasksFromProposalInput{
			Items: []CreateTasksFromProposalItemInput{
				{Index: 0, Title: fmt.Sprintf("Cap Batch %d Task", b)},
			},
		}); cerr != nil {
			t.Fatalf("CreateTasksFromProposal batch %d: %v", b, cerr)
		}
	}
	cappedDetail, err := e.fileSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, fileID2)
	if err != nil {
		t.Fatal(err)
	}
	if cappedDetail.TasksCreated.Count != 6 || len(cappedDetail.TaskCreations) != 5 {
		t.Fatalf("6 batches: TasksCreated.Count=%d len(TaskCreations)=%d, want 6 and 5", cappedDetail.TasksCreated.Count, len(cappedDetail.TaskCreations))
	}
}

func isCodedError(err error, wantStatus int, wantCode string) bool {
	var ce CodedError
	if !errors.As(err, &ce) {
		return false
	}
	return ce.Status == wantStatus && ce.Code == wantCode
}

type proposalBatchTableCounts struct {
	tasks             int
	taskDependencies  int
	driveFileLinks    int
	driveProposalLink int
	auditEvents       int
	outboxEvents      int
}

func snapshotProposalBatchCounts(t *testing.T, ctx context.Context, e *driveFilesTestEnv) proposalBatchTableCounts {
	t.Helper()
	var c proposalBatchTableCounts
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, e.wsA.ID).Scan(&c.tasks); err != nil {
		t.Fatalf("count tasks: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM task_dependencies WHERE workspace_id = $1`, e.wsA.ID).Scan(&c.taskDependencies); err != nil {
		t.Fatalf("count task_dependencies: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM drive_file_task_links WHERE workspace_id = $1`, e.wsA.ID).Scan(&c.driveFileLinks); err != nil {
		t.Fatalf("count drive_file_task_links: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM drive_task_proposal_links WHERE workspace_id = $1`, e.wsA.ID).Scan(&c.driveProposalLink); err != nil {
		t.Fatalf("count drive_task_proposal_links: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1`, e.org.ID).Scan(&c.auditEvents); err != nil {
		t.Fatalf("count audit_events: %v", err)
	}
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE organization_id = $1`, e.org.ID).Scan(&c.outboxEvents); err != nil {
		t.Fatalf("count outbox_events: %v", err)
	}
	return c
}

func assertProposalBatchCountsUnchanged(t *testing.T, ctx context.Context, e *driveFilesTestEnv, before proposalBatchTableCounts, contextLabel string) {
	t.Helper()
	after := snapshotProposalBatchCounts(t, ctx, e)
	if after != before {
		t.Fatalf("%s: counts changed = %+v, want %+v", contextLabel, after, before)
	}
}

func assertProposalReadyWithItems(t *testing.T, ctx context.Context, e *driveFilesTestEnv, proposalID string, wantItems int) {
	t.Helper()
	var status string
	var rawItems []byte
	if err := e.pool.QueryRow(ctx, `SELECT status, items FROM drive_task_proposals WHERE id = $1`, proposalID).Scan(&status, &rawItems); err != nil {
		t.Fatalf("query proposal %s: %v", proposalID, err)
	}
	var items []DriveTaskProposalItem
	if err := json.Unmarshal(rawItems, &items); err != nil {
		t.Fatalf("unmarshal proposal %s items: %v", proposalID, err)
	}
	if status != DriveProposalStatusReady || len(items) != wantItems {
		t.Fatalf("proposal %s state = (status=%q, len(items)=%d), want (ready, %d)", proposalID, status, len(items), wantItems)
	}
}

// TestValidateAndNormalizeProposalCreateItemsUnit exercises pure item validation,
// 0-based index bounds, duplicate index refusal, date/priority normalization,
// intra-batch dependency cycle detection, and batch project/parent ID resolution
// without requiring a database connection.
func TestValidateAndNormalizeProposalCreateItemsUnit(t *testing.T) {
	t.Parallel()

	// 1. Empty items -> 400 Invalid.
	if _, err := validateAndNormalizeProposalCreateItems(nil, 5); err == nil {
		t.Fatal("expected error on empty items")
	}

	// 2. Out-of-range index (< 0 or >= storedCount) -> 400 Invalid.
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: -1, Title: "Negative"},
	}, 5); err == nil {
		t.Fatal("expected error on negative index")
	}
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 3, Title: "Beyond stored count"},
	}, 3); err == nil {
		t.Fatal("expected error on index >= storedCount")
	}

	// 3. Duplicate index in same request -> 400 Invalid.
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 1, Title: "First"},
		{Index: 1, Title: "Second"},
	}, 5); err == nil {
		t.Fatal("expected error on duplicate item index")
	}

	// 4. Unselected dependency index -> 400 Invalid.
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 0, Title: "Zero"},
		{Index: 2, Title: "Two", BlockedByIndexes: []int{1}},
	}, 5); err == nil {
		t.Fatal("expected error on unselected blocked_by_indexes")
	}

	// 5. Self dependency -> 422 parent_cycle.
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 0, Title: "Self", BlockedByIndexes: []int{0}},
	}, 5); !isCodedError(err, http.StatusUnprocessableEntity, "parent_cycle") {
		t.Fatalf("self dependency = %v, want 422 parent_cycle", err)
	}

	// 6. 3-node dependency cycle (0 -> 2 -> 4 -> 0) -> 422 parent_cycle.
	if _, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 0, Title: "N0", BlockedByIndexes: []int{2}},
		{Index: 2, Title: "N2", BlockedByIndexes: []int{4}},
		{Index: 4, Title: "N4", BlockedByIndexes: []int{0}},
	}, 5); !isCodedError(err, http.StatusUnprocessableEntity, "parent_cycle") {
		t.Fatalf("3-node cycle = %v, want 422 parent_cycle", err)
	}

	// 7. Valid subset with DAG (4 blocked by 0 and 2; 2 blocked by 0; duplicate dep deduplicated).
	start := "2026-10-27"
	due := "2026-11-05"
	batch, err := validateAndNormalizeProposalCreateItems([]CreateTasksFromProposalItemInput{
		{Index: 0, Title: "  Root Task  ", Priority: "HIGH", StartDate: &start, DueDate: &due},
		{Index: 2, Title: "Middle Task", BlockedByIndexes: []int{0, 0}},
		{Index: 4, Title: "Leaf Task", BlockedByIndexes: []int{0, 2}, AllowDuplicate: true},
	}, 5)
	if err != nil {
		t.Fatalf("valid subset = %v", err)
	}
	if len(batch.orderedItems) != 3 || len(batch.taskInputs) != 3 {
		t.Fatalf("batch len = %d / %d, want 3", len(batch.orderedItems), len(batch.taskInputs))
	}
	if batch.taskInputs[0].Title != "Root Task" || batch.taskInputs[0].Priority != "high" {
		t.Fatalf("taskInputs[0] = %+v", batch.taskInputs[0])
	}
	if !reflect.DeepEqual(batch.orderedItems[1].BlockedByIndexes, []int{0}) {
		t.Fatalf("orderedItems[1].BlockedByIndexes = %v, want [0]", batch.orderedItems[1].BlockedByIndexes)
	}
	if !reflect.DeepEqual(batch.orderedItems[2].BlockedByIndexes, []int{0, 2}) || !batch.taskInputs[2].AllowDuplicate {
		t.Fatalf("orderedItems[2] = %+v, taskInputs[2] = %+v", batch.orderedItems[2], batch.taskInputs[2])
	}

	// 8. Coded error constructors: expired proposal maps to HTTP 410 Gone (proposal_expired).
	if err := errDriveProposalExpired(); !isCodedError(err, http.StatusGone, "proposal_expired") || !errors.Is(err, ErrDriveProposalExpired) {
		t.Fatalf("errDriveProposalExpired() = %v, want 410 proposal_expired wrapping ErrDriveProposalExpired", err)
	}
	if err := errDriveProposalNotReady(); !isCodedError(err, http.StatusConflict, "proposal_not_ready") || !errors.Is(err, ErrDriveProposalNotReady) {
		t.Fatalf("errDriveProposalNotReady() = %v, want 409 proposal_not_ready", err)
	}
	if err := errDriveProposalItemAlreadyConverted(); !isCodedError(err, http.StatusConflict, "proposal_item_already_converted") || !errors.Is(err, ErrDriveProposalItemAlreadyConverted) {
		t.Fatalf("errDriveProposalItemAlreadyConverted() = %v, want 409 proposal_item_already_converted", err)
	}
}

// TestDriveFakeProviderOfflineReadForAIAndPropose verifies that with
// DRIVE_FAKE_PROVIDER=1 and the fake AI gateway (AI_PROVIDER=fake -> ai.FakeReply),
// linking a Drive file, reading its content via ReadForAI, and calling Propose
// runs 100% offline (zero outbound HTTP calls) and produces a ready proposal
// with normalized items.
func TestDriveFakeProviderOfflineReadForAIAndPropose(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	fx.svc.ConfigureOAuth(config.Config{
		AppEnv:            "development",
		DriveFakeProvider: true,
		FrontendOrigin:    "http://localhost:3000",
		APIPublicURL:      "http://localhost:8080",
	})

	apiClient := NewDriveAPIClient()
	apiClient.httpClient.Transport = failingDriveRoundTripper{t: t}

	fileSvc := NewDriveFileService(fx.pool, fx.q, fx.ws, fx.svc, apiClient)
	fileSvc.SetFlags(fx.svc.flags)

	contentSvc := NewDriveContentService(fx.pool, fx.q, fx.ws, fileSvc, fx.svc, apiClient, nil)

	var capturedDocPrompt string
	gw := ai.NewGateway(fx.q, &provider.Fake{
		Reply: func(req provider.CompletionRequest) provider.CompletionResponse {
			if len(req.Messages) > 0 {
				capturedDocPrompt = req.Messages[len(req.Messages)-1].Content
			}
			return ai.FakeReply(req)
		},
	}, NewAIQuota(NewEntitlementService(fx.pool, fx.q)), nil, ai.Options{})

	propSvc := NewDriveTaskProposalService(fx.pool, fx.q, fx.ws, fileSvc, fx.svc, contentSvc, gw)
	propSvc.SetFlags(fx.svc.flags)

	refEnc, err := fx.svc.sealSecret("tok-r-fake-propose")
	if err != nil {
		t.Fatal(err)
	}
	accEnc, err := fx.svc.sealSecret("tok-a-fake-propose")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := fx.q.CreateDriveConnection(ctx, db.CreateDriveConnectionParams{
		ID:              util.NewID(),
		OrganizationID:  fx.org.ID,
		UserID:          fx.user.ID,
		Provider:        "google",
		GoogleSub:       "sub-fake-propose-" + util.NewID(),
		GoogleEmail:     "fake-propose@example.com",
		RefreshTokenEnc: refEnc,
		AccessTokenEnc:  accEnc,
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
		Scopes:          "openid email " + DriveGoogleScope,
	})
	if err != nil {
		t.Fatalf("CreateDriveConnection: %v", err)
	}

	extID := "ext-fake-propose-doc"
	linked, err := fileSvc.Link(ctx, Human(fx.user.ID), fx.work.ID, LinkDriveFilesInput{
		ConnectionID:    conn.ID,
		ExternalFileIDs: []string{extID},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link under DRIVE_FAKE_PROVIDER=1 = %+v, err=%v", linked, err)
	}
	driveFileID := linked[0].File.ID

	dc, err := contentSvc.ReadForAI(ctx, fx.user.ID, fx.work.ID, driveFileID, DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("ReadForAI under DRIVE_FAKE_PROVIDER=1: %v", err)
	}
	if dc.Text != fakeDriveExportMarkdown || dc.Truncated {
		t.Fatalf("ReadForAI text = %q (truncated=%v), want %q", dc.Text, dc.Truncated, fakeDriveExportMarkdown)
	}

	proposal, err := propSvc.Propose(ctx, Human(fx.user.ID), fx.work.ID, driveFileID, ProposeDriveTasksInput{
		Prompt: "Tạo việc từ tài liệu fake",
	})
	if err != nil {
		t.Fatalf("Propose under DRIVE_FAKE_PROVIDER=1 + AI_PROVIDER=fake: %v", err)
	}
	if proposal.Status != DriveProposalStatusReady || len(proposal.Items) == 0 {
		t.Fatalf("proposal = %+v, want status=ready with non-empty items", proposal)
	}
	if !strings.Contains(capturedDocPrompt, "Chốt phạm vi tính năng beta trước 2026-11-15") {
		t.Fatalf("expected AI prompt to include fake exported markdown, got %q", capturedDocPrompt)
	}
}

// TestDriveTaskProposalServiceDefaultFlagEnabled verifies that with a real flag
// service and no DB override, FF_* env, or YAML rule, DriveTaskProposalService
// evaluates drive_connector at its catalogue default (true), and refuses with
// 404 feature_disabled when FF_DRIVE_CONNECTOR=false.
func TestDriveTaskProposalServiceDefaultFlagEnabled(t *testing.T) {
	isolateDriveConnectorFlagSources(t)
	e := newDriveFilesTestEnv(t)
	ctx := context.Background()

	realFlags, _, err := featureflags.NewService(e.q, nil)
	if err != nil {
		t.Fatal(err)
	}
	e.svc.SetFlags(realFlags)
	e.fileSvc.SetFlags(realFlags)

	gw := ai.NewGateway(e.q, &provider.Fake{
		Reply: func(provider.CompletionRequest) provider.CompletionResponse {
			return provider.CompletionResponse{
				Text:  `{"items":[{"title":"Default flag task","assignee_member_id":"","assignee_basis":"","priority":"medium","priority_basis":"Doc","start_date":"","start_basis":"","due_date":"","due_basis":"","label_ids":[],"label_basis":"","goal":"Goal","checklist":[],"excerpt":{"section":"S1","quote":"Quote"},"blocked_by_indexes":[]}]}`,
				Model: "fake",
			}
		},
	}, NewAIQuota(NewEntitlementService(e.pool, e.q)), nil, ai.Options{})

	propSvc := NewDriveTaskProposalService(e.pool, e.q, e.ws, e.fileSvc, e.svc, e.contentSvc, gw)
	propSvc.SetFlags(realFlags)

	ownerConn := e.connectAccount(t, e.owner.ID, e.wsA.ID, "sub-def-flag-owner", "def-flag-owner@example.com")
	e.googleSrv.SetFile("ext-def-flag-doc", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "ext-def-flag-doc", Name: "Default Flag Doc", MimeType: DriveMimeGoogleDoc},
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Default Flag Doc\nContent"),
		},
	})
	linked, err := e.fileSvc.Link(ctx, Human(e.owner.ID), e.wsA.ID, LinkDriveFilesInput{
		ConnectionID:    ownerConn.ID,
		ExternalFileIDs: []string{"ext-def-flag-doc"},
	})
	if err != nil || len(linked) != 1 || linked[0].File == nil {
		t.Fatalf("Link = %+v, err=%v", linked, err)
	}
	fileID := linked[0].File.ID

	propView, err := propSvc.Propose(ctx, Human(e.owner.ID), e.wsA.ID, fileID, ProposeDriveTasksInput{
		Prompt: "Extract default flag tasks",
	})
	if err != nil {
		t.Fatalf("Propose with default flag (no override/env/YAML): %v, want nil", err)
	}

	// Also verify direct evaluation on propSvc when s.files is nil (fallback branch).
	propSvcNoFiles := NewDriveTaskProposalService(e.pool, e.q, e.ws, nil, e.svc, e.contentSvc, gw)
	propSvcNoFiles.SetFlags(realFlags)
	if _, err := propSvcNoFiles.Get(ctx, Human(e.owner.ID), e.wsA.ID, propView.ID); err != nil {
		t.Fatalf("Get with default flag (no files service): %v, want nil", err)
	}

	t.Setenv("FF_DRIVE_CONNECTOR", "false")
	var ce CodedError
	if _, err := propSvc.Get(ctx, Human(e.owner.ID), e.wsA.ID, propView.ID); !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "feature_disabled" {
		t.Fatalf("Get with FF_DRIVE_CONNECTOR=false = %v, want 404 feature_disabled", err)
	}
	if _, err := propSvcNoFiles.Get(ctx, Human(e.owner.ID), e.wsA.ID, propView.ID); !errors.As(err, &ce) || ce.Status != http.StatusNotFound || ce.Code != "feature_disabled" {
		t.Fatalf("Get (no files service) with FF_DRIVE_CONNECTOR=false = %v, want 404 feature_disabled", err)
	}
}
