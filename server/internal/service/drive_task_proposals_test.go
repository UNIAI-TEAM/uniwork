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

	// 1. requireOwnProposalQ: owner succeeds, peer in same workspace gets ErrNotFound.
	pRow, err := propSvc.requireOwnProposalQ(ctx, e.q, e.owner.ID, e.wsA.ID, propView.ID)
	if err != nil || pRow.ID != propView.ID {
		t.Fatalf("requireOwnProposalQ(owner) = %+v, err=%v", pRow, err)
	}
	if _, err := propSvc.requireOwnProposalQ(ctx, e.q, e.peer.ID, e.wsA.ID, propView.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("requireOwnProposalQ(peer) = %v, want ErrNotFound", err)
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
	if _, err := orgMemberSvc.Deactivate(ctx, e.owner.ID, e.org.ID, e.peer.ID); err != nil {
		t.Fatalf("Deactivate peer = %v", err)
	}

	var peerPropStatus, peerDiscardReason string
	if err := e.pool.QueryRow(ctx, `SELECT status FROM drive_task_proposals WHERE id = $1`, peerProp.ID).Scan(&peerPropStatus); err != nil || peerPropStatus != DriveProposalStatusDiscarded {
		t.Fatalf("peer proposal status after Deactivate = %q (err=%v), want discarded", peerPropStatus, err)
	}
	if err := e.pool.QueryRow(ctx,
		`SELECT metadata::jsonb->>'reason' FROM audit_events WHERE organization_id = $1 AND action = 'drive_task_proposal.discarded' AND resource_id = $2`,
		e.org.ID, peerProp.ID,
	).Scan(&peerDiscardReason); err != nil || peerDiscardReason != "source_disconnected" {
		t.Fatalf("peer proposal discard audit reason after Deactivate = %q (err=%v), want source_disconnected", peerDiscardReason, err)
	}
}
