package service

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// TestChatDocumentCardRefresherCoalescesABatch is SF2: a Documents batch share
// of 1,000 people writes 1,000 document.shared rows with one correlation id,
// and the refresher publishes one refresh per card for the whole batch, not
// one per row. A row without a correlation id, another command's correlation
// id, another topic of the same command, a row whose handling failed and a row
// after the coalescing window each still refresh.
func TestChatDocumentCardRefresherCoalescesABatch(t *testing.T) {
	f := newChatDocumentFixture(t)
	ctx := context.Background()
	sent, err := f.svc.SendDocumentMessage(ctx, f.ua.ID, f.ws.ID, f.dm(t).ID, documentMessageInput("coalesce-doc-1"))
	if err != nil {
		t.Fatalf("send document: %v", err)
	}
	docID := sent.Document.DocumentID
	ch, err := f.svc.CreateChannel(ctx, f.ua.ID, f.ws.ID, CreateChannelInput{Name: "coalesce-room", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	f.cardMessage(t, f.orgID, f.ws.ID, ch.ID, f.ua.ID, docID)

	c := NewChatDocumentCardRefresher(f.q, f.svc)
	clock := time.Now()
	c.now = func() time.Time { return clock }
	row := func(i int, topic, correlation string) outbox.Row {
		r := outbox.Row{
			ID: fmt.Sprintf("row-%s-%d", topic, i), Topic: topic,
			Payload:        `{"document_id":"` + docID + `","workspace_id":"` + f.ws.ID + `"}`,
			OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
		}
		if correlation != "" {
			r.CorrelationID = pgtype.Text{String: correlation, Valid: true}
		}
		return r
	}
	handle := func(r outbox.Row) {
		t.Helper()
		if err := c.Handle(ctx, r); err != nil {
			t.Fatalf("handle %s: %v", r.ID, err)
		}
	}
	refreshes := func() int {
		n := len(updatedMessageIDs(f.pub.events))
		f.pub.events = nil
		return n
	}
	f.pub.events = nil

	for i := range 1000 {
		handle(row(i, "document.shared", "corr-batch"))
	}
	if got := refreshes(); got != 2 {
		t.Fatalf("1,000 rows of one batch published %d card refreshes, want 2 (one per card)", got)
	}

	// Another command's rows are not swallowed by the first batch's key.
	handle(row(0, "document.shared", "corr-other"))
	if got := refreshes(); got != 2 {
		t.Fatalf("a second batch published %d refreshes, want 2", got)
	}
	// Another topic of the same command refreshes on its own.
	handle(row(0, "document.share_revoked", "corr-batch"))
	if got := refreshes(); got != 2 {
		t.Fatalf("another topic of the same command published %d refreshes, want 2", got)
	}
	// No correlation id: nothing identifies the command, so nothing coalesces.
	for i := range 3 {
		handle(row(i, "document.shared", ""))
	}
	if got := refreshes(); got != 6 {
		t.Fatalf("3 rows without a correlation id published %d refreshes, want 6", got)
	}

	// A row that failed gives its key back, so the outbox retry still refreshes.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := c.Handle(cancelled, row(0, "document.shared", "corr-retry")); err == nil {
		t.Fatal("a handle on a cancelled context must fail so the outbox retries it")
	}
	handle(row(0, "document.shared", "corr-retry"))
	if got := refreshes(); got != 2 {
		t.Fatalf("the retry of a failed row published %d refreshes, want 2", got)
	}

	// After the window the same command id refreshes again (an id is never
	// reused in practice; the window only bounds the memory).
	clock = clock.Add(chatDocumentCardRefreshCoalesce + time.Second)
	handle(row(1, "document.shared", "corr-batch"))
	if got := refreshes(); got != 2 {
		t.Fatalf("a row after the window published %d refreshes, want 2", got)
	}
	if len(c.seen) > 3 {
		t.Fatalf("the coalescing memory holds %d keys after the window, want the expired ones swept", len(c.seen))
	}
}
