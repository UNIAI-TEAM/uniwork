package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1645 (addendum 2026-10-15): the edit lock commands R1-R10 and the
// write gate, service level. Handler-level cases are A2's.

func TestEditLockWritesRefusedWith423(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.aclOwner, d.ID, "editor-a")

	// Another editor's save, with no id and with a made-up id: 423 with the
	// holder in fields, never the lock id.
	for _, id := range []string{"", util.NewID()} {
		err := w.patch(t, human(w.tn.member), d.ID, id)
		ce := wantCode(t, err, "document_locked")
		if ce.Status != http.StatusLocked || !errors.Is(err, ErrDocumentLocked) || errors.Is(err, ErrConflict) {
			t.Fatalf("423 shape: status %d, locked %v, conflict %v", ce.Status, errors.Is(err, ErrDocumentLocked), errors.Is(err, ErrConflict))
		}
		if ce.Fields["holder_id"] != w.tn.aclOwner.ID || ce.Fields["holder_name"] != w.tn.aclOwner.DisplayName || ce.Fields["held_by_me"] != false {
			t.Fatalf("423 fields: %v", ce.Fields)
		}
		for _, k := range []string{"since", "expires_at", "current_revision"} {
			if _, ok := ce.Fields[k]; !ok {
				t.Fatalf("423 lacks %s: %v", k, ce.Fields)
			}
		}
		if _, ok := ce.Fields["offline_hold_until"]; ok {
			t.Fatalf("offline_hold_until without a hold: %v", ce.Fields)
		}
		for _, v := range ce.Fields {
			if v == held.Lock.ID {
				t.Fatalf("423 leaks the lock id: %v", ce.Fields)
			}
		}
	}
	// The holder's save passes and refreshes the heartbeat.
	before := w.lockRow(t, held.Lock.ID)
	w.exec(t, `UPDATE document_edit_locks SET heartbeat_at = now() - interval '1 minute', expires_at = now() + interval '1 minute' WHERE id = $1`, held.Lock.ID)
	if err := w.patch(t, human(w.tn.aclOwner), d.ID, held.Lock.ID); err != nil {
		t.Fatalf("holder save: %v", err)
	}
	after := w.lockRow(t, held.Lock.ID)
	if !after.ExpiresAt.Time.After(before.ExpiresAt.Time.Add(-time.Second)) || !after.HeartbeatAt.Time.After(before.HeartbeatAt.Time.Add(-time.Second)) {
		t.Fatalf("holder save did not refresh the tenure: %v -> %v", before.ExpiresAt.Time, after.ExpiresAt.Time)
	}
	// The same person in another tab (other lock id): 423 held_by_me.
	ce := wantCode(t, w.patch(t, human(w.tn.aclOwner), d.ID, util.NewID()), "document_locked")
	if ce.Fields["held_by_me"] != true {
		t.Fatalf("same user other tab: %v", ce.Fields)
	}
	// Q1: with no live lock a save without an id passes.
	if err := w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, held.Lock.ID); err != nil {
		t.Fatal(err)
	}
	if err := w.patch(t, human(w.tn.member), d.ID, ""); err != nil {
		t.Fatalf("save with no live lock: %v", err)
	}
	// Q5: a rename never needs the lock.
	w.acquire(t, w.tn.aclOwner, d.ID, "editor-b")
	cur := w.env.doc(t, d.ID)
	if _, err := w.svc.UpdateDocument(w.ctx, human(w.tn.member), d.ID, UpdateDocumentInput{Revision: cur.Revision, Title: strPtr("Đổi tên")}); err != nil {
		t.Fatalf("rename while locked: %v", err)
	}
}

func TestEditLockWritesRefusedWith423OnCommitFrameAndRestore(t *testing.T) {
	w := newLockWorld(t)
	file := w.env.createFile(t, human(w.tn.aclOwner), "a.pdf", pdfBody("v1"))
	docID := file.Document.ID
	held := w.acquire(t, w.tn.aclOwner, docID, "editor-a")
	cur := w.env.doc(t, docID)
	up := w.env.upload(t, human(w.tn.member), docID, "a.pdf", pdfBody("v2"))
	for _, frame := range []bool{false, true} {
		_, err := w.svc.CommitFileVersion(w.ctx, human(w.tn.member), docID, CommitFileVersionInput{
			UploadID: up.UploadID, BaseRevision: cur.Revision, Frame: frame,
		})
		wantCode(t, err, "document_locked")
	}
	_, err := w.svc.RestoreDocumentVersion(w.ctx, human(w.tn.member), docID, RestoreDocumentVersionInput{Version: 1, BaseRevision: cur.Revision})
	wantCode(t, err, "document_locked")
	// The holder commits.
	if _, err := w.svc.CommitFileVersion(w.ctx, human(w.tn.aclOwner), docID, CommitFileVersionInput{
		UploadID: up.UploadID, BaseRevision: cur.Revision, EditLockID: held.Lock.ID,
	}); err != nil {
		t.Fatalf("holder commit: %v", err)
	}
}

func TestRestoreVersionNeedsEditLock(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	if err := w.patch(t, human(w.tn.aclOwner), d.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.CreateDocumentVersion(w.ctx, human(w.tn.aclOwner), d.ID, CreateDocumentVersionInput{}); err != nil {
		t.Fatal(err)
	}
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	cur := w.env.doc(t, d.ID)
	_, err := w.svc.RestoreDocumentVersion(w.ctx, human(w.tn.aclOwner), d.ID, RestoreDocumentVersionInput{Version: 1, BaseRevision: cur.Revision})
	wantCode(t, err, "document_locked")
	if _, err := w.svc.RestoreDocumentVersion(w.ctx, human(w.tn.member), d.ID, RestoreDocumentVersionInput{Version: 1, BaseRevision: cur.Revision, EditLockID: held.Lock.ID}); err != nil {
		t.Fatalf("holder restore: %v", err)
	}
}

func TestRenameAndMoveNeedNoEditLock(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	cur := w.env.doc(t, d.ID)
	if _, err := w.svc.UpdateDocument(w.ctx, human(w.tn.aclOwner), d.ID, UpdateDocumentInput{Revision: cur.Revision, Title: strPtr("Tên mới")}); err != nil {
		t.Fatalf("rename: %v", err)
	}
	cur = w.env.doc(t, d.ID)
	if _, err := w.svc.UpdateDocument(w.ctx, human(w.tn.aclOwner), d.ID, UpdateDocumentInput{Revision: cur.Revision, Visibility: strPtr("restricted")}); err != nil {
		t.Fatalf("visibility: %v", err)
	}
	cur = w.env.doc(t, d.ID)
	if _, err := w.svc.MoveDocument(w.ctx, human(w.tn.aclOwner), d.ID, MoveDocumentInput{ParentID: "", Revision: cur.Revision}); err != nil {
		t.Fatalf("move: %v", err)
	}
	if _, err := w.svc.CreateDocumentVersion(w.ctx, human(w.tn.aclOwner), d.ID, CreateDocumentVersionInput{}); err != nil {
		t.Fatalf("manual version: %v", err)
	}
	if got := w.lockRow(t, held.Lock.ID); got.EndedAt.Valid {
		t.Fatalf("a non-content write ended the lock: %s", got.EndReason.String)
	}
}

func TestEditLockErrorPrecedence(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	w.acquire(t, w.tn.aclOwner, d.ID, "editor-a")
	// A stale base under a live lock is 423, not revision_conflict: a locked
	// caller never reaches the overwrite path.
	_, err := w.svc.UpdateDocument(w.ctx, human(w.tn.member), d.ID, UpdateDocumentInput{Revision: 999, Content: lockTestContent})
	wantCode(t, err, "document_locked")
	// Below edit is 403 before 423; unreadable is 404 before both.
	view := w.restricted(t)
	w.shareTo(t, view, w.tn.outsider, DocumentLevelView)
	w.acquire(t, w.tn.aclOwner, view.ID, "editor-r")
	_, err = w.svc.UpdateDocument(w.ctx, human(w.tn.outsider), view.ID, UpdateDocumentInput{Revision: 999, Content: lockTestContent})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer under a lock: want forbidden, got %v", err)
	}
	_, err = w.svc.UpdateDocument(w.ctx, human(w.tn.bMember), view.ID, UpdateDocumentInput{Revision: 999, Content: lockTestContent})
	wantNotFound(t, err)
	// Archived is the existing code before 423.
	w.exec(t, `UPDATE documents SET archived_at = now() WHERE id = $1`, d.ID)
	_, err = w.svc.UpdateDocument(w.ctx, human(w.tn.aclOwner), d.ID, UpdateDocumentInput{Revision: 999, Content: lockTestContent})
	wantCode(t, err, "document_deleted")
}

func TestEditLockIDFromAnotherTenantIsRefused(t *testing.T) {
	w := newLockWorld(t)
	other := w.env.f.tenant(t, "lockb"+strings.ToLower(util.NewID()[20:]))
	foreignDoc := w.env.f.doc(t, other, docSpec{ws: other.wsA, visibility: "workspace", aclOwner: other.owner.ID, createdBy: other.owner.ID})
	foreign, err := w.svc.AcquireDocumentEditLock(w.ctx, human(other.owner), foreignDoc.ID, AcquireDocumentEditLockInput{EditorID: "x", Client: DocumentEditClientDesktop})
	if err != nil {
		t.Fatal(err)
	}
	page := w.page(t)
	w.acquire(t, w.tn.aclOwner, page.ID, "editor-a")
	wantCode(t, w.patch(t, human(w.tn.aclOwner), page.ID, foreign.Lock.ID), "document_locked")

	file := w.env.createFile(t, human(w.tn.aclOwner), "b.pdf", pdfBody("v1"))
	w.acquire(t, w.tn.member, file.Document.ID, "editor-m")
	cur := w.env.doc(t, file.Document.ID)
	up := w.env.upload(t, human(w.tn.aclOwner), file.Document.ID, "b.pdf", pdfBody("v2"))
	for _, frame := range []bool{false, true} {
		_, err := w.svc.CommitFileVersion(w.ctx, human(w.tn.aclOwner), file.Document.ID, CommitFileVersionInput{
			UploadID: up.UploadID, BaseRevision: cur.Revision, EditLockID: foreign.Lock.ID, Frame: frame,
		})
		wantCode(t, err, "document_locked")
	}
	_, err = w.svc.RestoreDocumentVersion(w.ctx, human(w.tn.aclOwner), file.Document.ID, RestoreDocumentVersionInput{Version: 1, BaseRevision: cur.Revision, EditLockID: foreign.Lock.ID})
	wantCode(t, err, "document_locked")
	if after := w.env.doc(t, file.Document.ID); after.Revision != cur.Revision {
		t.Fatalf("a refused write moved the revision: %d -> %d", cur.Revision, after.Revision)
	}
	if got := w.lockRow(t, foreign.Lock.ID); got.EndedAt.Valid || got.HeartbeatAt != foreign.Lock.HeartbeatAt {
		t.Fatal("the foreign tenure was touched")
	}
}

// recordingDocMetrics records the counters the save path moves.
type recordingDocMetrics struct {
	nopDocumentMetrics
	outcomes  []string
	conflicts []string
	refused   []string
	ops       []string
	requests  []string
}

func (m *recordingDocMetrics) ObserveDocumentSave(_, outcome string, _ float64) {
	m.outcomes = append(m.outcomes, outcome)
}
func (m *recordingDocMetrics) IncDocumentConflict(_, code string) {
	m.conflicts = append(m.conflicts, code)
}
func (m *recordingDocMetrics) IncDocumentEditLockRefused(route string) {
	m.refused = append(m.refused, route)
}
func (m *recordingDocMetrics) IncDocumentEditLockOp(op string)  { m.ops = append(m.ops, op) }
func (m *recordingDocMetrics) IncDocumentEditRequest(op string) { m.requests = append(m.requests, op) }

func TestDocumentSaveOutcomeForLockIsNotConflict(t *testing.T) {
	if outcome, code := documentSaveResult(errDocumentLocked(db.DocumentEditLock{}, "", false, 1)); outcome != "locked" || code != "" {
		t.Fatalf("documentSaveResult(423) = %q, %q", outcome, code)
	}
	w := newLockWorld(t)
	m := &recordingDocMetrics{}
	w.svc.SetMetrics(m)
	d := w.page(t)
	w.acquire(t, w.tn.aclOwner, d.ID, "editor-a")
	wantCode(t, w.patch(t, human(w.tn.member), d.ID, ""), "document_locked")
	if len(m.outcomes) != 1 || m.outcomes[0] != "locked" {
		t.Fatalf("save outcomes %v, want [locked]", m.outcomes)
	}
	if len(m.conflicts) != 0 {
		t.Fatalf("a 423 was counted as a conflict: %v", m.conflicts)
	}
	if len(m.refused) != 1 || m.refused[0] != DocumentEditLockRoutePatch {
		t.Fatalf("refused %v, want [patch]", m.refused)
	}
	if len(m.ops) != 1 || m.ops[0] != "acquire" {
		t.Fatalf("ops %v, want [acquire]", m.ops)
	}
}

func TestEditLockAcquireStatesAndIdempotency(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	first := w.acquire(t, w.tn.member, d.ID, "editor-m")
	if !first.Created || first.Lock.GrantedVia != "acquire" || first.HeartbeatInterval != 30*time.Second || first.TTL != 2*time.Minute {
		t.Fatalf("first acquire: %+v", first)
	}
	again := w.acquire(t, w.tn.member, d.ID, "editor-m")
	if again.Created || again.Lock.ID != first.Lock.ID {
		t.Fatalf("same user + editor must return the tenure (200): %+v", again)
	}
	if n := w.countAudit(t, audit.ActionDocumentEditLockAcquired, d.ID); n != 1 {
		t.Fatalf("idempotent acquire wrote %d acquired rows", n)
	}
	// A viewer cannot acquire; an outsider does not see the document.
	view := w.restricted(t)
	w.shareTo(t, view, w.tn.outsider, DocumentLevelView)
	_, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.outsider), view.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer acquire: want forbidden, got %v", err)
	}
	_, err = w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.bMember), view.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage})
	wantNotFound(t, err)
	_, err = w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.member), d.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: "fax"})
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("bad client: want validation, got %v", err)
	}
}

func TestEditLockAcquireSameEditorOtherUserIs423(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "shared-editor-id")
	_, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, AcquireDocumentEditLockInput{EditorID: "shared-editor-id", Client: DocumentEditClientWebPage})
	ce := wantCode(t, err, "document_locked")
	if ce.Fields["held_by_me"] != false || ce.Fields["holder_id"] != w.tn.member.ID {
		t.Fatalf("423 fields %v", ce.Fields)
	}
	if got := w.lockRow(t, held.Lock.ID); got.EndedAt.Valid || got.UserID != w.tn.member.ID {
		t.Fatal("the holder's tenure changed")
	}
}

func TestEditLockMoveHereSameUser(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	old := w.acquire(t, w.tn.member, d.ID, "tab-1")
	_, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.member), d.ID, AcquireDocumentEditLockInput{EditorID: "tab-2", Client: DocumentEditClientWebPage})
	if ce := wantCode(t, err, "document_locked"); ce.Fields["held_by_me"] != true {
		t.Fatalf("second tab: %v", ce.Fields)
	}
	moved, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.member), d.ID, AcquireDocumentEditLockInput{EditorID: "tab-2", Client: DocumentEditClientWebPage, MoveFromSelf: true})
	if err != nil {
		t.Fatal(err)
	}
	if !moved.Created || moved.Lock.GrantedVia != "move_here" || moved.Lock.PreviousLockID.String != old.Lock.ID {
		t.Fatalf("move here: %+v", moved.Lock)
	}
	if got := w.lockRow(t, old.Lock.ID); got.EndReason.String != "moved_here" {
		t.Fatalf("old tenure end %q", got.EndReason.String)
	}
	if n := w.countAudit(t, audit.ActionDocumentEditLockTakenOver, d.ID); n != 0 {
		t.Fatalf("move here wrote %d take-over rows", n)
	}
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, old.Lock.ID)
	if ce := wantCode(t, err, "edit_lock_lost"); ce.Fields["reason"] != "moved_here" {
		t.Fatalf("old tab heartbeat: %v", ce.Fields)
	}
}

func TestTakeOverAudited(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	// Stale confirmation, free document, own lock.
	_, err := w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, TakeOverDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage, ExpectedLockID: util.NewID()})
	wantCode(t, err, "edit_lock_changed")
	_, err = w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.member), d.ID, TakeOverDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage, ExpectedLockID: held.Lock.ID})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("editor take-over: want forbidden, got %v", err)
	}
	took, err := w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, TakeOverDocumentEditLockInput{EditorID: "editor-a", Client: DocumentEditClientWebPage, ExpectedLockID: held.Lock.ID})
	if err != nil {
		t.Fatal(err)
	}
	if took.Lock.GrantedVia != "take_over" || took.Lock.UserID != w.tn.aclOwner.ID {
		t.Fatalf("take-over tenure %+v", took.Lock)
	}
	meta := w.auditMeta(t, audit.ActionDocumentEditLockTakenOver, d.ID)
	if meta["previous_holder_id"] != w.tn.member.ID || meta["previous_lock_id"] != held.Lock.ID || meta["lock_id"] != took.Lock.ID || meta["previous_offline_hold"] != false {
		t.Fatalf("take-over audit %v", meta)
	}
	if n := w.countOutbox(t, topicDocumentLockTakenOver, d.ID); n != 1 {
		t.Fatalf("lock_taken_over rows %d", n)
	}
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	ce := wantCode(t, err, "edit_lock_lost")
	if ce.Fields["reason"] != "taken_over" || ce.Fields["by_id"] != w.tn.aclOwner.ID || ce.Fields["by_name"] != w.tn.aclOwner.DisplayName {
		t.Fatalf("lost fields %v", ce.Fields)
	}
	wantCode(t, w.patch(t, human(w.tn.member), d.ID, held.Lock.ID), "document_locked")
	_, err = w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, TakeOverDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage, ExpectedLockID: took.Lock.ID})
	wantCode(t, err, "edit_lock_held_by_me")
	if err := w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, took.Lock.ID); err != nil {
		t.Fatal(err)
	}
	_, err = w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, TakeOverDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage, ExpectedLockID: took.Lock.ID})
	wantCode(t, err, "edit_lock_free")
}

func TestReleaseEmitsLockChanged(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	if n := w.countOutbox(t, topicDocumentLockChanged, d.ID); n != 1 {
		t.Fatalf("acquire lock_changed rows %d", n)
	}
	// Not the caller's: not found; a heartbeat writes no frame.
	wantNotFound(t, w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, held.Lock.ID))
	if _, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
		t.Fatal(err)
	}
	if err := w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
		t.Fatal(err)
	}
	if err := w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
		t.Fatalf("second release must be idempotent: %v", err)
	}
	if n := w.countOutbox(t, topicDocumentLockChanged, d.ID); n != 2 {
		t.Fatalf("lock_changed rows %d, want 2 (acquire, release)", n)
	}
	if meta := w.auditMeta(t, audit.ActionDocumentEditLockReleased, d.ID); meta["reason"] != "released" || meta["lock_id"] != held.Lock.ID {
		t.Fatalf("release audit %v", meta)
	}
	other := w.page(t)
	wantNotFound(t, w.svc.ReleaseDocumentEditLock(w.ctx, human(w.tn.member), other.ID, held.Lock.ID))
}

func TestEditLockStateLockIDOnlyForManagers(t *testing.T) {
	w := newLockWorld(t)
	d := w.restricted(t)
	w.shareTo(t, d, w.tn.member, DocumentLevelEdit)
	w.shareTo(t, d, w.tn.outsider, DocumentLevelView)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")

	mgr, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.aclOwner), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mgr.Lock == nil || mgr.Lock.LockID != held.Lock.ID || !mgr.CanTakeOver || !mgr.CanRequest {
		t.Fatalf("manager state %+v", mgr.Lock)
	}
	holder, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.member), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if holder.Lock.LockID != "" || !holder.Lock.HeldByMe || holder.CanRequest || holder.CanTakeOver {
		t.Fatalf("holder state %+v", holder)
	}
	viewer, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.outsider), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if viewer.Lock.LockID != "" || viewer.CanRequest || viewer.CanTakeOver || viewer.Lock.HolderName != w.tn.member.DisplayName {
		t.Fatalf("viewer state %+v", viewer.Lock)
	}
	// A manager holding it does not see its own id there (it has it from R2).
	w.exec(t, `UPDATE document_edit_locks SET user_id = $1 WHERE id = $2`, w.tn.aclOwner.ID, held.Lock.ID)
	own, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.aclOwner), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if own.Lock.LockID != "" {
		t.Fatal("holder manager sees lock_id in R1")
	}
	// List rows never carry it.
	sums, err := w.svc.DocumentEditLockSummaries(w.ctx, human(w.tn.aclOwner), w.tn.orgID, []string{d.ID})
	if err != nil {
		t.Fatal(err)
	}
	if s, ok := sums[d.ID]; !ok || s.LockID != "" {
		t.Fatalf("list summary %+v", s)
	}
	// R1 is read-only: an expired tenure reads as no lock and is not ended.
	w.expire(t, held.Lock.ID)
	st, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.aclOwner), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Lock != nil || st.CanTakeOver {
		t.Fatalf("expired tenure reads as %+v", st.Lock)
	}
	if got := w.lockRow(t, held.Lock.ID); got.EndedAt.Valid {
		t.Fatal("R1 ended a tenure")
	}
}

func TestEditLockHeartbeatRechecksLevel(t *testing.T) {
	w := newLockWorld(t)
	d := w.restricted(t)
	sh := w.shareTo(t, d, w.tn.member, DocumentLevelEdit)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	beat, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	if err != nil || beat.LockID != held.Lock.ID {
		t.Fatalf("heartbeat %+v %v", beat, err)
	}
	w.env.f.revoke(t, sh, w.tn.owner.ID)
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	wantNotFound(t, err)
	if got := w.lockRow(t, held.Lock.ID); got.EndReason.String != "access_lost" {
		t.Fatalf("end reason %q, want access_lost", got.EndReason.String)
	}
	// Down to view: forbidden, access_lost too.
	d2 := w.restricted(t)
	sh2 := w.shareTo(t, d2, w.tn.member, DocumentLevelEdit)
	held2 := w.acquire(t, w.tn.member, d2.ID, "editor-m2")
	w.env.f.revoke(t, sh2, w.tn.owner.ID)
	w.shareTo(t, d2, w.tn.member, DocumentLevelView)
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d2.ID, held2.Lock.ID)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("view heartbeat: want forbidden, got %v", err)
	}
	if got := w.lockRow(t, held2.Lock.ID); got.EndReason.String != "access_lost" {
		t.Fatalf("end reason %q", got.EndReason.String)
	}
	// A late heartbeat after expiry never revives.
	d3 := w.page(t)
	held3 := w.acquire(t, w.tn.member, d3.ID, "editor-m3")
	w.expire(t, held3.Lock.ID)
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d3.ID, held3.Lock.ID)
	if ce := wantCode(t, err, "edit_lock_lost"); ce.Fields["reason"] != "expired" {
		t.Fatalf("late heartbeat %v", ce.Fields)
	}
	// {lockID} of another document: 404.
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held3.Lock.ID)
	wantNotFound(t, err)
}

func TestEditLockUsesServerClock(t *testing.T) {
	w := newLockWorld(t)
	w.svc.SetClock(func() time.Time { return time.Now().Add(48 * time.Hour) })
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	var dbNow time.Time
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		t.Fatal(err)
	}
	if got := held.Lock.ExpiresAt.Time.Sub(dbNow); got > 2*time.Minute+5*time.Second || got < 2*time.Minute-30*time.Second {
		t.Fatalf("expires_at is %v from the database clock, want ~2m (service clock ignored)", got)
	}
}

func TestEditLockSurvivesServiceRestart(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	fresh := newDocumentServiceForTest(w.env.f.pool, w.env.f.q)
	if _, err := fresh.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
		t.Fatalf("heartbeat on a new service: %v", err)
	}
	_, err := fresh.AcquireDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage})
	wantCode(t, err, "document_locked")
}

func TestAgentCannotHoldTakeOverOrRequest(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	agent := agentActor(w.tn.agent)
	_, err := w.svc.AcquireDocumentEditLock(w.ctx, agent, d.ID, AcquireDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage})
	wantNotFound(t, err)
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	_, err = w.svc.TakeOverDocumentEditLock(w.ctx, agent, d.ID, TakeOverDocumentEditLockInput{EditorID: "e", Client: DocumentEditClientWebPage, ExpectedLockID: held.Lock.ID})
	wantNotFound(t, err)
	_, err = w.svc.CreateDocumentEditRequest(w.ctx, agent, d.ID)
	wantNotFound(t, err)
	_, err = w.svc.PutDocumentEditHold(w.ctx, agent, d.ID, held.Lock.ID, "")
	wantNotFound(t, err)
	_, err = w.svc.ClearDocumentEditHold(w.ctx, agent, d.ID, held.Lock.ID)
	wantNotFound(t, err)
	_, err = w.svc.AnswerDocumentEditRequest(w.ctx, agent, d.ID, util.NewID(), AnswerDocumentEditRequestInput{Decision: "decline", LockID: held.Lock.ID})
	wantNotFound(t, err)
	var n int
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM document_edit_locks WHERE user_id = $1`, w.tn.agent).Scan(&n); err != nil || n != 0 {
		t.Fatalf("agent tenures %d %v", n, err)
	}
}

// TestAgentWriteRefusedWhileLocked runs the gate itself for an agent actor:
// agents are capped at view today (ADR 0010), so no route reaches it yet.
func TestAgentWriteRefusedWhileLocked(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	agent := agentActor(w.tn.agent)
	gate := func(lockID string) error {
		tx, err := w.env.f.pool.Begin(w.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(w.ctx) }()
		q := w.env.f.q.WithTx(tx)
		doc, err := q.LockDocumentByID(w.ctx, d.ID)
		if err != nil {
			t.Fatal(err)
		}
		return w.svc.checkDocumentEditLock(w.ctx, q, agent, doc, lockID)
	}
	if err := gate(""); err != nil {
		t.Fatalf("no lock: agent write must pass the gate, got %v", err)
	}
	held := w.acquire(t, w.tn.member, d.ID, "editor-m")
	for _, id := range []string{"", held.Lock.ID} {
		ce := wantCode(t, gate(id), "document_locked")
		if ce.Fields["held_by_me"] != false {
			t.Fatalf("agent 423 %v", ce.Fields)
		}
	}
}
