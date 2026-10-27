package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
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
