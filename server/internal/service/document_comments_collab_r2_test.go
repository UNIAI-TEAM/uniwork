package service

// G8-03 (UNI-1398) review round 1 fixes: an Idempotency-Key replay answers
// the comment as it is now (R1-3), a cascading hard delete names every removed
// id in its audit row (R1-5), and the edit history is read in one snapshot
// with the comment it belongs to (R1-6).

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func TestDocumentCommentReplayAnswersTheCurrentRow(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "replay")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)
	in := AddCommentInput{Body: "bản gốc"}

	first, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, in, "replay-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, first.ID, UpdateCommentInput{Body: "đã sửa"}); err != nil {
		t.Fatal(err)
	}
	// The ledger stored the create's answer; the replay must not resurrect it.
	replayed, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, in, "replay-1")
	if err != nil {
		t.Fatal(err)
	}
	if replayed.ID != first.ID || replayed.Body != "đã sửa" || replayed.Revision != 2 {
		t.Fatalf("replay after an edit = %+v, want the current row", replayed)
	}
	// Once the comment is gone the replay is the same 404 as any missing id,
	// never a 200 for a row the next list would not show.
	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, first.ID); err != nil || outcome != DocumentCommentOutcomeRemoved {
		t.Fatalf("delete = %q %v", outcome, err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, in, "replay-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("replay after removal: %v, want ErrNotFound", err)
	}
}

func TestDocumentCommentCascadeAuditsEveryRemovedID(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "cascadeaudit")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	root, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "gốc"}, "")
	if err != nil {
		t.Fatal(err)
	}
	mid, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "giữa", ParentID: &root.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "lá", ParentID: &mid.ID}, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{root.ID, mid.ID} {
		if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, id); err != nil || outcome != DocumentCommentOutcomeTombstoned {
			t.Fatalf("tombstone %s = %q %v", id, outcome, err)
		}
	}
	// Removing the leaf takes both childless tombstones above it.
	if outcome, err := f.svc.DeleteDocumentComment(f.ctx, member, leaf.ID); err != nil || outcome != DocumentCommentOutcomeRemoved {
		t.Fatalf("delete leaf = %q %v", outcome, err)
	}
	var raw []byte
	if err := f.pool.QueryRow(f.ctx, `SELECT metadata FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'comment_id' = $3`,
		audit.ActionDocumentCommentDeleted, d.ID, leaf.ID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var meta struct {
		Removed []string `json:"removed_comment_ids"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	want := []string{leaf.ID, mid.ID, root.ID}
	if len(meta.Removed) != len(want) {
		t.Fatalf("removed_comment_ids = %v, want %v", meta.Removed, want)
	}
	for i := range want {
		if meta.Removed[i] != want[i] {
			t.Fatalf("removed_comment_ids = %v, want %v", meta.Removed, want)
		}
	}
}

func TestDocumentCommentRevisionsReadOneSnapshot(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "revsnap")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	root, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "bản một"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "phản hồi", ParentID: &root.ID}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.UpdateDocumentComment(f.ctx, member, root.ID, UpdateCommentInput{Body: "bản hai"}); err != nil {
		t.Fatal(err)
	}

	// A tombstone commits between the comment load and the history read: the
	// answer must describe one moment - the live comment with its history -
	// never a live comment with the history the tombstone already deleted.
	armed := true
	documentCommentRevisionsAfterLoad = func() {
		if !armed {
			return
		}
		armed = false
		if _, err := f.svc.DeleteDocumentComment(context.Background(), member, root.ID); err != nil {
			t.Errorf("interleaved delete: %v", err)
		}
	}
	t.Cleanup(func() { documentCommentRevisionsAfterLoad = nil })

	revs, err := f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(revs) != 1 || revs[0].Body != "bản một" {
		t.Fatalf("history across a concurrent tombstone = %+v, want the one revision of the snapshot", revs)
	}
	// The next read sees the tombstone.
	if _, err := f.svc.DocumentCommentRevisions(f.ctx, member, d.ID, root.ID); err == nil {
		t.Fatal("history of a tombstone was served")
	} else {
		collabWantCode(t, err, "comment_deleted")
	}
}
