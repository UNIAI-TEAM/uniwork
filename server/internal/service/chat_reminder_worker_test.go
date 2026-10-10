package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestNextChatReminderFire(t *testing.T) {
	hcm, _ := time.LoadLocation("Asia/Ho_Chi_Minh")
	ny, _ := time.LoadLocation("America/New_York")
	cases := []struct {
		name       string
		repeat     string
		anchor     time.Time
		occurrence int
		now        time.Time
		wantOcc    int
		want       time.Time // zero = retired
	}{
		{"none retires", "none", time.Date(2026, 10, 9, 9, 0, 0, 0, hcm), 0, time.Date(2026, 10, 9, 9, 0, 0, 0, hcm), 1, time.Time{}},
		{"daily next local morning", "daily", time.Date(2026, 10, 9, 9, 0, 0, 0, hcm), 0, time.Date(2026, 10, 9, 9, 0, 30, 0, hcm), 1, time.Date(2026, 10, 10, 9, 0, 0, 0, hcm)},
		// DST starts 2026-03-08 in New York: 09:00 local stays 09:00, 23h later.
		{"daily across DST keeps wall clock", "daily", time.Date(2026, 3, 7, 9, 0, 0, 0, ny), 0, time.Date(2026, 3, 7, 9, 1, 0, 0, ny), 1, time.Date(2026, 3, 8, 9, 0, 0, 0, ny)},
		{"weekly", "weekly", time.Date(2026, 10, 9, 9, 0, 0, 0, hcm), 0, time.Date(2026, 10, 9, 9, 0, 0, 0, hcm), 1, time.Date(2026, 10, 16, 9, 0, 0, 0, hcm)},
		// Anchored on the 31st: February clamps, March is back on the 31st.
		{"monthly clamps to month end", "monthly", time.Date(2026, 1, 31, 9, 0, 0, 0, hcm), 0, time.Date(2026, 1, 31, 9, 0, 0, 0, hcm), 1, time.Date(2026, 2, 28, 9, 0, 0, 0, hcm)},
		{"monthly does not drift", "monthly", time.Date(2026, 1, 31, 9, 0, 0, 0, hcm), 1, time.Date(2026, 2, 28, 9, 0, 0, 0, hcm), 2, time.Date(2026, 3, 31, 9, 0, 0, 0, hcm)},
		// A worker down for three days fires once and resumes in the future.
		{"catch up skips missed occurrences", "daily", time.Date(2026, 10, 1, 9, 0, 0, 0, hcm), 0, time.Date(2026, 10, 4, 10, 0, 0, 0, hcm), 4, time.Date(2026, 10, 5, 9, 0, 0, 0, hcm)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			occ, next := nextChatReminderFire(c.repeat, c.anchor, c.occurrence, c.now)
			if occ != c.wantOcc || !next.Equal(c.want) {
				t.Fatalf("got (%d, %v), want (%d, %v)", occ, next, c.wantOcc, c.want)
			}
		})
	}
}

func chatReminderDueEvents(t *testing.T, s *ChatService, messageID string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM outbox_events WHERE topic = 'chat.reminder.due' AND payload::jsonb->>'message_id' = $1`, messageID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func chatReminderNextFire(t *testing.T, s *ChatService, messageID string) pgtype.Timestamptz {
	t.Helper()
	var next pgtype.Timestamptz
	if err := s.pool.QueryRow(context.Background(),
		`SELECT next_fire_at FROM chat_reminders WHERE message_id = $1`, messageID,
	).Scan(&next); err != nil {
		t.Fatal(err)
	}
	return next
}

// The reminder is stored server side when it is sent, fires once when due
// even with two pods ticking together, and is retired afterwards.
func TestChatReminderWorkerFiresDueOnce(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()
	roomID := reminderGroup(t, s, ua, ub, w, q, "Remind once", "remind-once@example.com")
	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	msg, err := s.SendReminderMessage(ctx, ua.ID, w.ID, roomID, SendReminderMessageInput{
		Body: "Nộp báo cáo", RemindAt: remindAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	if next := chatReminderNextFire(t, s, msg.ID); !next.Valid || !next.Time.Equal(remindAt) {
		t.Fatalf("stored next_fire_at = %+v, want %v", next, remindAt)
	}

	worker := s.NewChatReminderWorker()
	if n, err := worker.RunOnce(ctx, remindAt.Add(-time.Second)); err != nil || n != 0 {
		t.Fatalf("early tick fired %d (err %v), want 0", n, err)
	}

	due := remindAt.Add(30 * time.Second)
	var wg sync.WaitGroup
	counts := make([]int, 2)
	errs := make([]error, 2)
	for i := range counts {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			counts[i], errs[i] = s.NewChatReminderWorker().RunOnce(ctx, due)
		}(i)
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if counts[0]+counts[1] != 1 {
		t.Fatalf("concurrent ticks fired %v, want exactly one between them", counts)
	}
	if n := chatReminderDueEvents(t, s, msg.ID); n != 1 {
		t.Fatalf("chat.reminder.due events = %d, want 1", n)
	}
	if next := chatReminderNextFire(t, s, msg.ID); next.Valid {
		t.Fatalf("one-shot reminder still due at %v", next.Time)
	}
	if n, err := worker.RunOnce(ctx, due.Add(time.Hour)); err != nil || n != 0 {
		t.Fatalf("later tick fired %d (err %v), want 0", n, err)
	}
}

// A daily reminder fires and moves to the same wall-clock time tomorrow in
// the creator's timezone.
func TestChatReminderWorkerSchedulesRepeat(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()
	if _, err := s.pool.Exec(ctx, `UPDATE users SET timezone = 'America/New_York' WHERE id = $1`, ua.ID); err != nil {
		t.Fatal(err)
	}
	roomID := reminderGroup(t, s, ua, ub, w, q, "Remind daily", "remind-daily@example.com")
	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	msg, err := s.SendReminderMessage(ctx, ua.ID, w.ID, roomID, SendReminderMessageInput{
		Body: "Standup", RemindAt: remindAt.Format(time.RFC3339), Repeat: "daily",
	})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := s.NewChatReminderWorker().RunOnce(ctx, remindAt.Add(time.Second)); err != nil || n != 1 {
		t.Fatalf("tick fired %d (err %v), want 1", n, err)
	}
	ny, _ := time.LoadLocation("America/New_York")
	want := remindAt.In(ny).AddDate(0, 0, 1)
	if next := chatReminderNextFire(t, s, msg.ID); !next.Valid || !next.Time.Equal(want) {
		t.Fatalf("next_fire_at = %+v, want %v", next, want)
	}
}

// A deleted reminder message is retired without firing.
func TestChatReminderWorkerRetiresDeletedMessage(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()
	roomID := reminderGroup(t, s, ua, ub, w, q, "Remind deleted", "remind-deleted@example.com")
	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	msg, err := s.SendReminderMessage(ctx, ua.ID, w.ID, roomID, SendReminderMessageInput{
		Body: "Huỷ", RemindAt: remindAt.Format(time.RFC3339), Repeat: "weekly",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, msg.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := s.NewChatReminderWorker().RunOnce(ctx, remindAt.Add(time.Second)); err != nil || n != 0 {
		t.Fatalf("tick fired %d (err %v), want 0", n, err)
	}
	if n := chatReminderDueEvents(t, s, msg.ID); n != 0 {
		t.Fatalf("chat.reminder.due events = %d, want 0", n)
	}
	if next := chatReminderNextFire(t, s, msg.ID); next.Valid {
		t.Fatalf("deleted reminder still due at %v", next.Time)
	}
}
