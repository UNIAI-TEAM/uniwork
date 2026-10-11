package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatReminderTick  = 30 * time.Second
	chatReminderBatch = 100
)

// ChatReminderWorker fires due chat reminders (H16). Like MeetingReminder it
// is a ticker, not an outbox consumer: nothing emits "a reminder is due"
// until it does. Each tick claims due rows with SKIP LOCKED and, in the same
// transaction, emits chat.reminder.due (the notification consumer turns it
// into inbox + push for the room; the realtime consumer tells open clients)
// and advances the row to its next occurrence, so an occurrence fires once
// across pods and a failed tick rolls back to retry.
type ChatReminderWorker struct {
	s   *ChatService
	log *slog.Logger
}

// NewChatReminderWorker wires the worker onto the chat service's pool.
func (s *ChatService) NewChatReminderWorker() *ChatReminderWorker {
	return &ChatReminderWorker{s: s, log: slog.Default()}
}

// Run ticks until ctx is done.
func (w *ChatReminderWorker) Run(ctx context.Context) {
	t := time.NewTicker(chatReminderTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := w.RunOnce(ctx, time.Now()); err != nil {
				w.log.Warn("chat reminder", "err", err)
			}
		}
	}
}

// RunOnce fires every reminder due at now, a batch per transaction, and
// returns how many fired.
func (w *ChatReminderWorker) RunOnce(ctx context.Context, now time.Time) (int, error) {
	fired := 0
	for ctx.Err() == nil {
		n, claimed, err := w.batch(ctx, now)
		fired += n
		if err != nil || claimed < chatReminderBatch {
			return fired, err
		}
	}
	return fired, ctx.Err()
}

func (w *ChatReminderWorker) batch(ctx context.Context, now time.Time) (fired, claimed int, err error) {
	tx, err := w.s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)
	q := w.s.q.WithTx(tx)
	rows, err := q.ClaimDueChatReminders(ctx, db.ClaimDueChatRemindersParams{
		NextFireAt: pgtype.Timestamptz{Time: now, Valid: true}, Limit: chatReminderBatch,
	})
	if err != nil {
		return 0, 0, err
	}
	for _, r := range rows {
		occurrence, next := int(r.Occurrence), time.Time{}
		if !r.MessageGone {
			loc, _ := homeLocation(r.Timezone)
			occurrence, next = nextChatReminderFire(r.Repeat, r.RemindAt.Time.In(loc), occurrence, now)
			if err := auditRecorder.Emit(ctx, q, audit.System("chat_reminder"), audit.Event{
				Topic: "chat.reminder.due", Version: 1,
				OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID,
				Payload: map[string]string{"room_id": r.RoomID, "message_id": r.MessageID},
			}); err != nil {
				return 0, 0, err
			}
			fired++
		}
		if err := q.AdvanceChatReminder(ctx, db.AdvanceChatReminderParams{
			MessageID: r.MessageID, Occurrence: int32(occurrence),
			NextFireAt: pgtype.Timestamptz{Time: next, Valid: !next.IsZero()},
		}); err != nil {
			return 0, 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return fired, len(rows), nil
}

// nextChatReminderFire returns the occurrence after the one firing now and
// when it is due; zero time retires a one-shot reminder. Occurrences count
// from the anchor in its own location, so a daily 09:00 stays 09:00 across a
// DST change and a monthly reminder on the 31st clamps to short months
// without drifting. Occurrences missed while no worker ran are skipped: the
// reminder fires once now and resumes at the first one still ahead.
func nextChatReminderFire(repeat string, anchor time.Time, occurrence int, now time.Time) (int, time.Time) {
	for {
		occurrence++
		var next time.Time
		switch repeat {
		case "daily":
			next = time.Date(anchor.Year(), anchor.Month(), anchor.Day()+occurrence, anchor.Hour(), anchor.Minute(), anchor.Second(), 0, anchor.Location())
		case "weekly":
			next = time.Date(anchor.Year(), anchor.Month(), anchor.Day()+7*occurrence, anchor.Hour(), anchor.Minute(), anchor.Second(), 0, anchor.Location())
		case "monthly":
			month := anchor.Month() + time.Month(occurrence)
			lastDay := time.Date(anchor.Year(), month+1, 0, 0, 0, 0, 0, anchor.Location()).Day()
			next = time.Date(anchor.Year(), month, min(anchor.Day(), lastDay), anchor.Hour(), anchor.Minute(), anchor.Second(), 0, anchor.Location())
		default:
			return occurrence, time.Time{}
		}
		if next.After(now) {
			return occurrence, next
		}
	}
}
