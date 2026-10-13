package service

// G8-05 (UNI-1400): the durable mention rows a document comment keeps
// (contract-collab section 8.1). The service reconciles them inside the same
// transaction as the create/edit: added ids are active (readers) or no_access
// (non-readers, G8-D3 provisional, no error), dropped ids become removed, and
// a removed id that returns turns active again with its notified_at kept so
// the person is never notified twice for one mention row.

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// commentMentionToken is the editor's one mention markup for a user.
func commentMentionToken(u db.User) string {
	return fmt.Sprintf("[@%s](mention://member/%s)", u.DisplayName, u.ID)
}

// mentionRowState reads one mention row's state and notified_at; the test
// fails when the row is missing.
func mentionRowState(t *testing.T, f *docPermFixture, commentID, userID string) (string, pgtype.Timestamptz) {
	t.Helper()
	var state string
	var notified pgtype.Timestamptz
	if err := f.pool.QueryRow(f.ctx,
		`SELECT state, notified_at FROM document_comment_mentions WHERE comment_id = $1 AND user_id = $2`,
		commentID, userID).Scan(&state, &notified); err != nil {
		t.Fatalf("mention row %s/%s: %v", commentID, userID, err)
	}
	return state, notified
}

// mentionRowCount counts the comment's mention rows; a duplicate token must
// not create a second row for the same person.
func mentionRowCount(t *testing.T, f *docPermFixture, commentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM document_comment_mentions WHERE comment_id = $1`, commentID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A create writes one row per named id: active for a reader, no_access for
// somebody who cannot read the document, self-mention stored like any other.
func TestDocumentMentionWriteOnCreate(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "mwrite")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)

	body := commentMentionToken(tn.member) + " xem giúp, " + commentMentionToken(tn.outsider) +
		" và " + commentMentionToken(tn.member) + " nhắc lại"
	c, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID, AddCommentInput{Body: body, CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}

	if n := mentionRowCount(t, f, c.ID); n != 2 {
		t.Fatalf("mention rows = %d, want one per person", n)
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.member.ID); state != "active" || notified.Valid {
		t.Fatalf("member row = %s/%v, want active with no notified_at", state, notified)
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.outsider.ID); state != "no_access" || notified.Valid {
		t.Fatalf("outsider row = %s/%v, want no_access", state, notified)
	}

	// Self-mention is stored like any other row; the notification rule drops
	// the actor, the row stays for the chip and the audit trail.
	self, err := f.svc.AddDocumentComment(f.ctx, Human(tn.member.ID), d.ID,
		AddCommentInput{Body: commentMentionToken(tn.member) + " tự nhắc", CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if state, _ := mentionRowState(t, f, self.ID, tn.member.ID); state != "active" {
		t.Fatalf("self mention row = %s, want active", state)
	}
}

// An edit diffs the body: a kept id is untouched, a dropped id becomes
// removed (its old notification stays), a new id lands active, and a removed
// id that returns turns active with its notified_at kept.
func TestDocumentMentionWriteOnEdit(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "medit")
	d := f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	acl := Human(tn.aclOwner.ID)

	c, err := f.svc.AddDocumentComment(f.ctx, acl, d.ID,
		AddCommentInput{Body: commentMentionToken(tn.member) + " " + commentMentionToken(tn.outsider), CommentType: "discussion"}, "")
	if err != nil {
		t.Fatal(err)
	}

	// The consumer already claimed the outsider before the id was dropped.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE document_comment_mentions SET notified_at = now() WHERE comment_id = $1 AND user_id = $2`,
		c.ID, tn.outsider.ID); err != nil {
		t.Fatal(err)
	}

	body := commentMentionToken(tn.member) + " cập nhật " + commentMentionToken(tn.wsAdmin)
	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, c.ID, UpdateCommentInput{Body: body}); err != nil {
		t.Fatal(err)
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.member.ID); state != "active" || notified.Valid {
		t.Fatalf("kept member row = %s/%v, want untouched active", state, notified)
	}
	if state, _ := mentionRowState(t, f, c.ID, tn.wsAdmin.ID); state != "active" {
		t.Fatalf("added wsadmin row = %s, want active", state)
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.outsider.ID); state != "removed" || !notified.Valid {
		t.Fatalf("dropped outsider row = %s/%v, want removed with the old notified_at kept", state, notified)
	}

	// Re-adding a removed id: active again, notified_at untouched.
	body += " " + commentMentionToken(tn.outsider)
	if _, err := f.svc.UpdateDocumentComment(f.ctx, acl, c.ID, UpdateCommentInput{Body: body}); err != nil {
		t.Fatal(err)
	}
	if state, notified := mentionRowState(t, f, c.ID, tn.outsider.ID); state != "active" || !notified.Valid {
		t.Fatalf("re-added outsider row = %s/%v, want active with notified_at kept", state, notified)
	}
	if n := mentionRowCount(t, f, c.ID); n != 3 {
		t.Fatalf("mention rows = %d, want 3", n)
	}
}

// A comment create and an edit that add a mention complete on a
// one-connection pool while several document mutations run (R1-1). The read
// gate that decides active vs no_access runs on the transaction's own q, so a
// mutation that holds the document row lock and its one connection never
// borrows a second one and waits forever for a connection its siblings hold -
// the deadlock TestDocumentMutationGateOnSmallPool names, on the mention path
// its no-op fn never reached.
func TestDocumentMentionWriteOnSmallPool(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "msmall")
	docs := make([]db.Document, 3)
	for i := range docs {
		docs[i] = f.doc(t, tn, docSpec{ws: tn.wsA, visibility: "workspace", aclOwner: tn.aclOwner.ID, createdBy: tn.aclOwner.ID})
	}

	cfg := f.pool.Config().Copy()
	cfg.MaxConns = 1
	small, err := pgxpool.NewWithConfig(f.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	svc := newDocumentServiceForTest(small, db.New(small))

	ctx, cancel := context.WithTimeout(f.ctx, 30*time.Second)
	defer cancel()
	acl := Human(tn.aclOwner.ID)
	body := commentMentionToken(tn.member) + " xem giúp " + commentMentionToken(tn.wsAdmin)
	errs := make(chan error, 6)
	start := make(chan struct{})
	for i := 0; i < 6; i++ {
		d := docs[i%len(docs)]
		go func() {
			<-start
			c, err := svc.AddDocumentComment(ctx, acl, d.ID, AddCommentInput{Body: body, CommentType: "discussion"}, "")
			if err != nil {
				errs <- err
				return
			}
			// An edit keeping the mention: the sync runs its diff again on the
			// same transaction, still without a second connection.
			_, err = svc.UpdateDocumentComment(ctx, acl, c.ID, UpdateCommentInput{Body: body + " " + commentMentionToken(tn.member)})
			errs <- err
		}()
	}
	close(start)
	for i := 0; i < 6; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("mention mutation %d on a 1-connection pool: %v", i, err)
		}
	}
}
