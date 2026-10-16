package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1645 §3.5: the expiry sweeper, the release consumer and the archive
// release - every writer of document.edit_lock_released other than R4.

func (w *lockWorld) handle(t *testing.T, topic, orgID string, payload string) {
	t.Helper()
	ev := outbox.Row{ID: util.NewID(), Topic: topic, Payload: payload, OrganizationID: pgText(orgID)}
	if err := NewDocumentEditLockReleaser(w.svc).Handle(w.ctx, ev); err != nil {
		t.Fatalf("%s: %v", topic, err)
	}
}

func (w *lockWorld) wantEnded(t *testing.T, lockID, reason string) {
	t.Helper()
	got := w.lockRow(t, lockID)
	if !got.EndedAt.Valid || got.EndReason.String != reason {
		t.Fatalf("tenure %s: ended %v reason %q, want %q", lockID, got.EndedAt.Valid, got.EndReason.String, reason)
	}
}

func (w *lockWorld) wantLive(t *testing.T, lockID string) {
	t.Helper()
	if got := w.lockRow(t, lockID); got.EndedAt.Valid {
		t.Fatalf("tenure %s ended (%s), want live", lockID, got.EndReason.String)
	}
}

func TestEditLockSweeperExpires(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	live := w.acquire(t, w.tn.member, d.ID, "editor-live")
	gone := w.page(t)
	stale := w.acquire(t, w.tn.member, gone.ID, "editor-stale")
	w.expire(t, stale.Lock.ID)
	held := w.page(t)
	holding := w.acquire(t, w.tn.member, held.ID, "editor-held")
	// TTL ran out but the offline hold is live: not expired.
	w.exec(t, `UPDATE document_edit_locks SET expires_at = now() - interval '1 second', offline_hold_until = now() + interval '1 hour' WHERE id = $1`, holding.Lock.ID)
	// A pending request past its expiry and a tenure ended 8 days ago.
	req := w.insertRequest(t, d, live.Lock, w.tn.aclOwner.ID, "now() - interval '1 second'")
	oldDoc := w.page(t)
	old := w.acquire(t, w.tn.member, oldDoc.ID, "editor-old")
	w.exec(t, `UPDATE document_edit_locks SET ended_at = now() - interval '8 days', end_reason = 'released' WHERE id = $1`, old.Lock.ID)

	expired, deleted, err := NewDocumentEditLockSweeper(w.svc, nil).Sweep(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if expired < 1 || deleted < 1 {
		t.Fatalf("sweep expired %d deleted %d", expired, deleted)
	}
	w.wantEnded(t, stale.Lock.ID, "expired")
	w.wantLive(t, live.Lock.ID)
	w.wantLive(t, holding.Lock.ID)
	if meta := w.auditMeta(t, audit.ActionDocumentEditLockReleased, gone.ID); meta["reason"] != "expired" {
		t.Fatalf("expiry audit %v", meta)
	}
	if n := w.countOutbox(t, topicDocumentLockChanged, gone.ID); n != 2 {
		t.Fatalf("lock_changed rows of the expired document %d, want 2 (acquire, expire)", n)
	}
	var status string
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT status FROM document_edit_requests WHERE id = $1`, req).Scan(&status); err != nil || status != "expired" {
		t.Fatalf("request status %q %v", status, err)
	}
	var n int
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM document_edit_locks WHERE id = $1`, old.Lock.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("old tenure kept: %d %v", n, err)
	}
	// Another node sweeping right after finds nothing.
	again, _, err := NewDocumentEditLockSweeper(w.svc, nil).Sweep(w.ctx)
	if err != nil || again != 0 {
		t.Fatalf("second sweep %d %v", again, err)
	}
	// The freed document is takeable.
	w.acquire(t, w.tn.aclOwner, gone.ID, "editor-next")
}

// FA5b: tenures whose document row is gone (the delete consumer's to end)
// must not fill the sweeper's batch - a batch full of them would starve a
// real expired tenure out of ListExpiredDocumentEditLocks forever, because
// expireDocumentEditLock only skips them.
func TestEditLockSweeperSkipsGoneDocuments(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	real := w.acquire(t, w.tn.member, d.ID, "editor-real")
	w.expire(t, real.Lock.ID)

	// More than one batch of expired tenures on document ids that do not
	// exist, every one of them expiring before the real tenure.
	orphans := make([]string, 0, int(documentEditLockSweepBatch)+1)
	for i := 0; i < int(documentEditLockSweepBatch)+1; i++ {
		id := util.NewID()
		w.exec(t, `INSERT INTO document_edit_locks
			(id, organization_id, document_id, user_id, session_id, editor_id, client, base_revision, granted_via, acquired_at, heartbeat_at, expires_at)
			VALUES ($1, $2, $3, $4, 'orphan-session', 'orphan-editor', 'web_page', 1, 'acquire', now(), now(), now() - interval '1 hour')`,
			id, w.tn.orgID, util.NewID(), w.tn.member.ID)
		orphans = append(orphans, id)
	}
	defer func() {
		if _, err := w.env.f.pool.Exec(w.ctx, `DELETE FROM document_edit_locks WHERE id = ANY($1)`, orphans); err != nil {
			t.Fatalf("cleanup orphan tenures: %v", err)
		}
	}()

	if _, err := w.svc.SweepExpiredDocumentEditLocks(w.ctx); err != nil {
		t.Fatal(err)
	}
	w.wantEnded(t, real.Lock.ID, "expired")
	var unended int
	if err := w.env.f.pool.QueryRow(w.ctx,
		`SELECT count(*) FROM document_edit_locks WHERE id = ANY($1) AND ended_at IS NULL`, orphans).Scan(&unended); err != nil {
		t.Fatal(err)
	}
	if unended != len(orphans) {
		t.Fatalf("orphan tenures unended %d/%d, want all (a gone document's tenure is the delete consumer's)", unended, len(orphans))
	}
}

// insertRequest writes a pending request with the given expiry expression.
func (w *lockWorld) insertRequest(t *testing.T, d db.Document, lock db.DocumentEditLock, requesterID, expires string) string {
	t.Helper()
	id := util.NewID()
	w.exec(t, `INSERT INTO document_edit_requests (id, organization_id, document_id, lock_id, requester_id, holder_id, status, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', `+expires+`)`, id, d.OrganizationID, d.ID, lock.ID, requesterID, lock.UserID)
	return id
}

func TestEditLockReleaseWritersWriteTheirOwnRows(t *testing.T) {
	cases := map[string]func(t *testing.T, w *lockWorld, d db.Document, lock db.DocumentEditLock) string{
		"SweepExpiredDocumentEditLocks": func(t *testing.T, w *lockWorld, _ db.Document, lock db.DocumentEditLock) string {
			w.expire(t, lock.ID)
			if _, err := w.svc.SweepExpiredDocumentEditLocks(w.ctx); err != nil {
				t.Fatal(err)
			}
			return "expired"
		},
		"DocumentEditLockReleaser.Handle": func(t *testing.T, w *lockWorld, _ db.Document, lock db.DocumentEditLock) string {
			w.handle(t, "session.revoked", "", `{"user_id":"`+lock.UserID+`","session_id":"`+lock.SessionID+`"}`)
			return "session_revoked"
		},
		"ArchiveDocument": func(t *testing.T, w *lockWorld, d db.Document, _ db.DocumentEditLock) string {
			if _, err := w.svc.ArchiveDocument(w.ctx, human(w.tn.aclOwner), d.ID, ArchiveDocumentInput{}); err != nil {
				t.Fatal(err)
			}
			return "document_archived"
		},
	}
	for command, run := range cases {
		t.Run(command, func(t *testing.T) {
			w := newLockWorld(t)
			d := w.page(t)
			held := w.acquire(t, w.tn.member, d.ID, "editor-m")
			reason := run(t, w, d, held.Lock)
			w.wantEnded(t, held.Lock.ID, reason)
			if n := w.countAudit(t, audit.ActionDocumentEditLockReleased, d.ID); n != 1 {
				t.Fatalf("%s wrote %d released rows, want 1", command, n)
			}
			if meta := w.auditMeta(t, audit.ActionDocumentEditLockReleased, d.ID); meta["reason"] != reason {
				t.Fatalf("%s audit reason %v, want %s", command, meta["reason"], reason)
			}
			if n := w.countOutbox(t, topicDocumentLockChanged, d.ID); n != 2 {
				t.Fatalf("%s lock_changed rows %d, want 2 (acquire + release)", command, n)
			}
		})
	}
}

func TestEditLockReleasedOnSessionRevoke(t *testing.T) {
	w := newLockWorld(t)
	acq := func(u db.User, sid, editor string) DocumentEditLockView {
		d := w.page(t)
		v, err := w.svc.AcquireDocumentEditLock(w.ctx, human(u), d.ID, AcquireDocumentEditLockInput{EditorID: editor, Client: DocumentEditClientWebPage, SessionID: sid})
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	// Web logout of one session: only that session's tenure.
	a := acq(w.tn.member, "web-1", "e1")
	b := acq(w.tn.member, "web-2", "e2")
	w.handle(t, "session.revoked", "", `{"user_id":"`+w.tn.member.ID+`","session_id":"web-1"}`)
	w.wantEnded(t, a.Lock.ID, "session_revoked")
	w.wantLive(t, b.Lock.ID)
	// Revoke all (empty session id): every tenure, including someone's hold.
	sid := w.device(t, w.tn.member.ID)
	c := acq(w.tn.member, sid, "e3")
	if _, err := w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), c.Lock.DocumentID, c.Lock.ID, sid); err != nil {
		t.Fatal(err)
	}
	other := acq(w.tn.aclOwner, "web-9", "e9")
	w.handle(t, "session.revoked", "", `{"user_id":"`+w.tn.member.ID+`","session_id":""}`)
	w.wantEnded(t, b.Lock.ID, "session_revoked")
	w.wantEnded(t, c.Lock.ID, "session_revoked")
	w.wantLive(t, other.Lock.ID)
	// Desktop logout: the device session.
	dsid := w.device(t, w.tn.aclOwner.ID)
	dl := acq(w.tn.aclOwner, dsid, "e10")
	w.handle(t, "session.revoked", "", `{"user_id":"`+w.tn.aclOwner.ID+`","session_id":"`+dsid+`"}`)
	w.wantEnded(t, dl.Lock.ID, "session_revoked")
	w.wantLive(t, other.Lock.ID)
}

func TestEditLockReleasedOnAccessLoss(t *testing.T) {
	type scene struct {
		name   string
		reason string
		lose   func(t *testing.T, w *lockWorld, d db.Document, sh db.DocumentShare)
	}
	scenes := []scene{
		{"share revoke", "access_lost", func(t *testing.T, w *lockWorld, d db.Document, sh db.DocumentShare) {
			w.env.f.revoke(t, sh, w.tn.owner.ID)
			w.handle(t, "document.share_revoked", w.tn.orgID, `{"document_id":"`+d.ID+`"}`)
		}},
		{"workspace removal", "access_lost", func(t *testing.T, w *lockWorld, _ db.Document, sh db.DocumentShare) {
			// The share alone would keep edit (see "removal kept by a share").
			w.env.f.revoke(t, sh, w.tn.owner.ID)
			w.exec(t, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.tn.wsA, w.tn.member.ID)
			w.handle(t, "member.removed", w.tn.orgID, `{"user_id":"`+w.tn.member.ID+`","workspace_id":"`+w.tn.wsA+`"}`)
		}},
		{"deactivation", "member_deactivated", func(t *testing.T, w *lockWorld, _ db.Document, _ db.DocumentShare) {
			w.exec(t, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.tn.orgID, w.tn.member.ID)
			w.handle(t, "member.deactivated", w.tn.orgID, `{"user_id":"`+w.tn.member.ID+`"}`)
		}},
		{"leaving", "access_lost", func(t *testing.T, w *lockWorld, _ db.Document, _ db.DocumentShare) {
			w.handle(t, "member.left", w.tn.orgID, `{"user_id":"`+w.tn.member.ID+`"}`)
		}},
		{"suspension", "organization_suspended", func(t *testing.T, w *lockWorld, _ db.Document, _ db.DocumentShare) {
			w.handle(t, "organization.suspended", w.tn.orgID, `{}`)
		}},
	}
	for _, sc := range scenes {
		for _, hold := range []bool{false, true} {
			name := sc.name
			if hold {
				name += " with hold"
			}
			t.Run(name, func(t *testing.T) {
				w := newLockWorld(t)
				d := w.restricted(t)
				sh := w.shareTo(t, d, w.tn.member, DocumentLevelEdit)
				sid := w.device(t, w.tn.member.ID)
				held, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.member), d.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientDesktop, SessionID: sid})
				if err != nil {
					t.Fatal(err)
				}
				if hold {
					if _, err := w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, sid); err != nil {
						t.Fatal(err)
					}
				}
				sc.lose(t, w, d, sh)
				w.wantEnded(t, held.Lock.ID, sc.reason)
			})
		}
	}
	// A removal that leaves the holder at edit (a share keeps it) keeps the lock.
	t.Run("removal kept by a share", func(t *testing.T) {
		w := newLockWorld(t)
		d := w.page(t)
		w.shareTo(t, d, w.tn.member, DocumentLevelEdit)
		held := w.acquire(t, w.tn.member, d.ID, "e")
		w.exec(t, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.tn.wsA, w.tn.member.ID)
		w.handle(t, "member.removed", w.tn.orgID, `{"user_id":"`+w.tn.member.ID+`","workspace_id":"`+w.tn.wsA+`"}`)
		w.wantLive(t, held.Lock.ID)
	})
}

func TestArchiveReleasesEditLock(t *testing.T) {
	w := newLockWorld(t)
	m := &recordingDocMetrics{}
	w.svc.SetMetrics(m)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "e")
	if _, err := w.svc.ArchiveDocument(w.ctx, human(w.tn.aclOwner), d.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	w.wantEnded(t, held.Lock.ID, "document_archived")
	if len(m.ops) != 2 || m.ops[1] != "release" {
		t.Fatalf("ops %v, want [acquire release]", m.ops)
	}
	_, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	wantNotFound(t, err)
}

// FA5b: the owner seams archive in the caller's transaction, so the edit
// lock release they write is part of that transaction too: the tenure ends
// with document_archived and carries the release audit row and the
// lock_changed frame the public archive writes, as soon as the caller
// commits. The release counters stay unflushed - the seam cannot see the
// commit - so the seam's caller owns the metric, not the command.
func TestOwnerSeamArchiveReleasesEditLock(t *testing.T) {
	calls := map[string]func(w *lockWorld, q *db.Queries, owner Actor, d db.Document) error{
		"ArchiveOwnedDocumentsInTx": func(w *lockWorld, q *db.Queries, owner Actor, d db.Document) error {
			_, err := w.svc.ArchiveOwnedDocumentsInTx(w.ctx, q, owner, d.OrganizationID, d.WorkspaceID, d.OwnerID.String, "")
			return err
		},
		"ArchiveOwnedDocumentInTx": func(w *lockWorld, q *db.Queries, owner Actor, d db.Document) error {
			_, err := w.svc.ArchiveOwnedDocumentInTx(w.ctx, q, owner, d.OrganizationID, d.WorkspaceID, d.ID)
			return err
		},
	}
	for seam, call := range calls {
		t.Run(seam, func(t *testing.T) {
			w := newLockWorld(t)
			m := &recordingDocMetrics{}
			w.svc.SetMetrics(m)
			// An owned document answers through the owner service: grant the
			// holder edit there so it can take the tenure that must release.
			w.svc.SetOwnerLevelResolver(mapOwnerResolver{w.tn.member.ID: DocumentLevelEdit})
			defer w.svc.SetOwnerLevelResolver(nil)
			owned := w.env.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID, ownerID: "wp-seam"})
			held := w.acquire(t, w.tn.member, owned.ID, "e")

			tx, err := w.env.f.pool.Begin(w.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = tx.Rollback(w.ctx) }()
			if err := call(w, w.env.f.q.WithTx(tx), human(w.tn.owner), owned); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(w.ctx); err != nil {
				t.Fatal(err)
			}

			w.wantEnded(t, held.Lock.ID, "document_archived")
			if len(m.ops) != 1 || m.ops[0] != "acquire" {
				t.Fatalf("ops %v, want [acquire] (the seam cannot flush the release counter)", m.ops)
			}
			if n := w.countAudit(t, audit.ActionDocumentEditLockReleased, owned.ID); n != 1 {
				t.Fatalf("released rows %d, want 1", n)
			}
			if meta := w.auditMeta(t, audit.ActionDocumentEditLockReleased, owned.ID); meta["reason"] != "document_archived" || meta["lock_id"] != held.Lock.ID {
				t.Fatalf("release audit %v", meta)
			}
			if n := w.countAudit(t, audit.ActionDocumentArchived, owned.ID); n != 1 {
				t.Fatalf("archived rows %d, want 1", n)
			}
			if n := w.countOutbox(t, topicDocumentLockChanged, owned.ID); n != 2 {
				t.Fatalf("lock_changed rows %d, want 2 (acquire + the seam's release)", n)
			}
			if n := w.countOutbox(t, "document.archived", owned.ID); n != 1 {
				t.Fatalf("document.archived rows %d, want 1", n)
			}
		})
	}
}

// CBE-1c-1: the archive releases every node it stamps, not only the root's
// tenure. A folder whose CHILD is being edited must end that child's tenure
// (document_archived) with the child's own audit row and lock_changed frame,
// while the root, which holds no lock, writes no release row.
func TestArchiveFolderReleasesChildEditLock(t *testing.T) {
	w := newLockWorld(t)
	folder := listablePage(t, w, treeDocSpec{kind: DocumentKindFolder, title: "Thư mục đang sửa"})
	child := listablePage(t, w, treeDocSpec{parent: folder.ID, title: "Trang con"})
	sibling := listablePage(t, w, treeDocSpec{parent: folder.ID, title: "Trang em"})
	held := w.acquire(t, w.tn.member, child.ID, "e")
	if _, err := w.svc.ArchiveDocument(w.ctx, human(w.tn.aclOwner), folder.ID, ArchiveDocumentInput{}); err != nil {
		t.Fatal(err)
	}
	w.wantEnded(t, held.Lock.ID, "document_archived")
	if n := w.countAudit(t, audit.ActionDocumentEditLockReleased, child.ID); n != 1 {
		t.Fatalf("child's released rows %d, want 1 (the row names the child)", n)
	}
	if n := w.countAudit(t, audit.ActionDocumentEditLockReleased, folder.ID); n != 0 {
		t.Fatalf("folder's released rows %d, want 0 (the tenure was the child's)", n)
	}
	if meta := w.auditMeta(t, audit.ActionDocumentEditLockReleased, child.ID); meta["reason"] != "document_archived" || meta["lock_id"] != held.Lock.ID {
		t.Fatalf("child release audit %v", meta)
	}
	var orgID string
	if err := w.env.f.pool.QueryRow(w.ctx,
		`SELECT organization_id FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentEditLockReleased, child.ID).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	if orgID != folder.OrganizationID {
		t.Fatalf("release audit organization %s, want the folder's %s", orgID, folder.OrganizationID)
	}
	// One lock_changed frame for the child (acquire + the archive release);
	// the untouched sibling carries none.
	if n := w.countOutbox(t, topicDocumentLockChanged, child.ID); n != 2 {
		t.Fatalf("child lock_changed rows %d, want 2 (acquire + archive release)", n)
	}
	if n := w.countOutbox(t, topicDocumentLockChanged, sibling.ID); n != 0 {
		t.Fatalf("sibling lock_changed rows %d, want 0", n)
	}
	// The child's holder heartbeats after the folder archive exactly as the
	// single-doc test expects: the document reads gone (404 / lost).
	_, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), child.ID, held.Lock.ID)
	wantNotFound(t, err)
}

func TestDeleteReleasesEditLock(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "e")
	w.exec(t, `DELETE FROM documents WHERE id = $1`, d.ID)
	w.handle(t, "document.deleted", w.tn.orgID, `{"document_id":"`+d.ID+`","workspace_id":"`+d.WorkspaceID+`"}`)
	w.wantEnded(t, held.Lock.ID, "document_deleted")
	if n := w.countOutbox(t, topicDocumentLockChanged, d.ID); n != 2 {
		t.Fatalf("lock_changed rows %d", n)
	}
	// Re-delivery is a no-op.
	w.handle(t, "document.deleted", w.tn.orgID, `{"document_id":"`+d.ID+`","workspace_id":"`+d.WorkspaceID+`"}`)
	if n := w.countAudit(t, audit.ActionDocumentEditLockReleased, d.ID); n != 1 {
		t.Fatalf("released rows %d", n)
	}
}

func TestMoveKeepsLockUnlessAccessLost(t *testing.T) {
	w := newLockWorld(t)
	kept := w.page(t)
	keptLock := w.acquire(t, w.tn.member, kept.ID, "e1")
	w.handle(t, "document.moved", w.tn.orgID, `{"document_id":"`+kept.ID+`"}`)
	w.wantLive(t, keptLock.Lock.ID)

	lost := w.page(t)
	lostLock := w.acquire(t, w.tn.member, lost.ID, "e2")
	// A move to workspace B, where the holder is no member.
	w.exec(t, `UPDATE documents SET workspace_id = $1 WHERE id = $2`, w.tn.wsB, lost.ID)
	w.handle(t, "document.moved", w.tn.orgID, `{"document_id":"`+lost.ID+`"}`)
	w.wantEnded(t, lostLock.Lock.ID, "access_lost")
}
