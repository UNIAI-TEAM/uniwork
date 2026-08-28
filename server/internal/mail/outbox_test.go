package mail

import (
	"context"
	"errors"
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
	defer cancel()
	go o.Run(ctx)
	if _, err := o.Enqueue(ctx, q, msg("c@example.com")); err != nil {
		t.Fatal(err)
	}
	o.Kick()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		n := len(s.sent)
		s.mu.Unlock()
		if n == 1 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Kick did not wake the worker")
}
