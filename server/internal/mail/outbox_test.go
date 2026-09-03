package mail

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type flakySender struct {
	mu    sync.Mutex
	fails int // số lần đầu trả lỗi
	sent  []Message
}

func (f *flakySender) Send(_ context.Context, m Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fails > 0 {
		f.fails--
		return errors.New("smtp down")
	}
	f.sent = append(f.sent, m)
	return nil
}

func msg(to string) Message {
	return Message{Kind: KindWelcome, Locale: "vi", To: to, Subject: "s", HTML: "<p>h</p>", Text: "t"}
}

func TestOutboxRetriesWithBackoffThenGivesUp(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{fails: 10}
	o := NewOutbox(pool, s, slog.Default())
	now := time.Date(2026, 8, 28, 9, 0, 0, 0, time.UTC)
	o.now = func() time.Time { return now }
	ctx := context.Background()
	id, err := o.Enqueue(ctx, q, msg("a@example.com"))
	if err != nil {
		t.Fatal(err)
	}
	want := []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}
	for i, d := range want {
		if _, err := o.RunOnce(ctx); err != nil {
			t.Fatal(err)
		}
		row, _ := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "a@example.com", Kind: KindWelcome})
		if row.Attempts != int32(i+1) || !row.NextAttemptAt.Time.Equal(now.Add(d)) || row.FailedAt.Valid {
			t.Fatalf("attempt %d: attempts=%d next=%v failed=%v", i+1, row.Attempts, row.NextAttemptAt.Time, row.FailedAt.Valid)
		}
		// Đẩy giả lập thời gian qua mốc retry để lần sau claim được.
		_, _ = pool.Exec(ctx, "UPDATE emails SET next_attempt_at = now() WHERE id = $1", id)
	}
	if _, err := o.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	row, _ := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "a@example.com", Kind: KindWelcome})
	if row.Attempts != 5 || !row.FailedAt.Valid || row.SentAt.Valid {
		t.Fatalf("after 5 failures: %+v", row)
	}
}

func TestOutboxSendsOnceAcrossTwoWorkers(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{}
	ctx := context.Background()
	for i := 0; i < 50; i++ {
		if _, err := NewOutbox(pool, s, slog.Default()).Enqueue(ctx, q, msg("b@example.com")); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	var total atomic.Int32
	for w := 0; w < 2; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o := NewOutbox(pool, s, slog.Default())
			for {
				n, err := o.RunOnce(ctx)
				if err != nil {
					t.Error(err)
					return
				}
				if n == 0 {
					return
				}
				total.Add(int32(n))
			}
		}()
	}
	wg.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.sent) != 50 || total.Load() != 50 {
		t.Fatalf("sent %d, processed %d", len(s.sent), total.Load())
	}
}

func TestOutboxKickWakesRun(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{}
	o := NewOutbox(pool, s, slog.Default())
	o.tick = time.Hour // tick không thể là lý do gửi
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		o.Run(ctx)
		close(done)
	}()
	if _, err := o.Enqueue(ctx, q, msg("c@example.com")); err != nil {
		cancel()
		<-done
		t.Fatal(err)
	}
	o.Kick()
	deadline := time.Now().Add(3 * time.Second)
	ok := false
	for time.Now().Before(deadline) {
		s.mu.Lock()
		n := len(s.sent)
		s.mu.Unlock()
		if n == 1 {
			ok = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !ok {
		cancel()
		<-done
		t.Fatal("Kick did not wake the worker")
	}
	// Send() records into s.sent slightly before RunOnce commits the
	// bookkeeping update, so poll the row too instead of asserting right
	// after observing s.sent.
	var row db.Email
	var err error
	settleDeadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(settleDeadline) {
		row, err = q.GetLatestEmailForRecipient(context.Background(), db.GetLatestEmailForRecipientParams{ToEmail: "c@example.com", Kind: KindWelcome})
		if err == nil && row.SentAt.Valid {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done
	if err != nil {
		t.Fatal(err)
	}
	if !row.SentAt.Valid || row.LastError.Valid || row.Attempts != 1 {
		t.Fatalf("sent row: %+v", row)
	}
}

// deliver is a package-internal contract: any MarkEmail* failure must be
// returned so RunOnce stops the loop and rolls back instead of continuing
// to send against an aborted tx. The least invasive way to force a
// deterministic MarkEmailSent failure is a context already canceled before
// deliver runs its query — sender.Send doesn't check ctx (flakySender
// ignores it), so this exercises exactly the "send ok, bookkeeping fails"
// path without needing to poison the connection or the tx.
func TestDeliverReturnsMarkEmailError(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	s := &flakySender{}
	o := NewOutbox(pool, s, slog.Default())
	ctx := context.Background()
	id, err := o.Enqueue(ctx, q, msg("d@example.com"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "d@example.com", Kind: KindWelcome})
	if err != nil {
		t.Fatal(err)
	}
	if row.ID != id {
		t.Fatalf("unexpected row id %s", row.ID)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := o.deliver(canceled, q, row); err == nil {
		t.Fatal("expected error from deliver when MarkEmailSent fails")
	}
}

type permanentSender struct{}

func (permanentSender) Send(context.Context, Message) error {
	return fmt.Errorf("smtp RCPT TO: %w: 550 5.1.1 User unknown", ErrPermanent)
}

func TestOutboxGivesUpImmediatelyOnPermanentError(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	o := NewOutbox(pool, permanentSender{}, slog.Default())
	ctx := context.Background()
	if _, err := o.Enqueue(ctx, q, msg("dead@example.com")); err != nil {
		t.Fatal(err)
	}
	if _, err := o.RunOnce(ctx); err != nil {
		t.Fatal(err)
	}
	row, _ := q.GetLatestEmailForRecipient(ctx, db.GetLatestEmailForRecipientParams{ToEmail: "dead@example.com", Kind: KindWelcome})
	if row.Attempts != 1 || !row.FailedAt.Valid {
		t.Fatalf("permanent error should fail on first attempt: %+v", row)
	}
}
