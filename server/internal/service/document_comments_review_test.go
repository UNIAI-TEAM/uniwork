package service

// G1-07a review r1 (M1, L2, L4), fixed on the G1-G2 root at the lane merge.

import (
	"errors"
	"testing"
)

// M1: an agent reads a workspace document at view but never writes a
// favorite - favorites are a person's bookmarks.
func TestDocumentFavoriteAgentRefused(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "favag")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	agent := agentActor(tn.agent)

	if _, err := f.svc.FavoriteDocument(f.ctx, agent, d.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent favorite: %v, want ErrForbidden", err)
	}
	if err := f.svc.UnfavoriteDocument(f.ctx, agent, d.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("agent unfavorite: %v, want ErrForbidden", err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM document_favorites WHERE document_id = $1`, d.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("agent left %d favorite rows", n)
	}
}

// L2: deleting a document comment removes its reactions in the same
// transaction (no FK; service cleanup).
func TestDocumentCommentDeleteTakesItsReactions(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "delr")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, member, d.ID, AddCommentInput{Body: "xoá tôi"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.AddDocumentCommentReaction(f.ctx, member, c.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.DeleteDocumentComment(f.ctx, member, c.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM comment_reactions WHERE comment_id = $1`, c.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("%d reactions survived their comment", n)
	}
}

// L4: an Idempotency-Key replays only on the same document; reused on
// another document it is a payload mismatch, not the first comment.
func TestDocumentCommentKeyReuseAcrossDocuments(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "idem")
	a := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	b := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	member := Human(tn.member.ID)

	first, err := f.svc.AddDocumentComment(f.ctx, member, a.ID, AddCommentInput{Body: "một"}, "key-1")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := f.svc.AddDocumentComment(f.ctx, member, a.ID, AddCommentInput{Body: "một"}, "key-1")
	if err != nil || replay.ID != first.ID {
		t.Fatalf("same document replay = %v %+v", err, replay)
	}
	_, err = f.svc.AddDocumentComment(f.ctx, member, b.ID, AddCommentInput{Body: "một"}, "key-1")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "idempotency_payload_mismatch" {
		t.Fatalf("key reused on another document: %v, want idempotency_payload_mismatch", err)
	}
}
