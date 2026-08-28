package mail

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Enqueuer is what services hold: queue a rendered message, optionally on
// the caller's transaction, and nudge the worker.
type Enqueuer interface {
	Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error)
	Kick()
}

const (
	outboxBatch     = 20
	outboxMaxTries  = 5
	outboxRetention = 30 * 24 * time.Hour
	defaultTick     = 5 * time.Second
)

// backoff[n] is the wait after the (n+1)th failure; the 5th failure gives up.
var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour, 6 * time.Hour}

// Outbox stores mail in the emails table and delivers it from Run. One
// goroutine per process; several processes are safe because the claim uses
// FOR UPDATE SKIP LOCKED. Delivery is at-least-once: a crash between Send
// and commit re-sends that one message.
type Outbox struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	sender Sender
	log    *slog.Logger
	kick   chan struct{}
	tick   time.Duration
	now    func() time.Time
}

func NewOutbox(pool *pgxpool.Pool, sender Sender, log *slog.Logger) *Outbox {
	if log == nil {
		log = slog.Default()
	}
	return &Outbox{pool: pool, q: db.New(pool), sender: sender, log: log,
		kick: make(chan struct{}, 1), tick: defaultTick, now: time.Now}
}

// Enqueue inserts the message. q lets the caller pass its transaction's
// Queries so the row commits with the business change; pass o.q-equivalent
// (any Queries on the pool) otherwise.
func (o *Outbox) Enqueue(ctx context.Context, q *db.Queries, msg Message) (string, error) {
	if q == nil {
		q = o.q
	}
	row, err := q.CreateEmail(ctx, db.CreateEmailParams{
		ID: util.NewID(), Kind: msg.Kind, ToEmail: msg.To,
		UserID: pgtype.Text{String: msg.UserID, Valid: msg.UserID != ""},
		Locale: msg.Locale, Subject: msg.Subject, Html: msg.HTML, Text: msg.Text,
	})
	if err != nil {
		return "", err
	}
	return row.ID, nil
}

// Kick wakes Run before the next tick. Non-blocking; a pending kick is enough.
func (o *Outbox) Kick() {
	select {
	case o.kick <- struct{}{}:
	default:
	}
}

// Run delivers until ctx is done. A full batch loops immediately; otherwise
// it waits for a tick or a Kick. Once an hour it prunes old history.
func (o *Outbox) Run(ctx context.Context) {
	o.log.Info("mail: outbox worker started", "tick", o.tick)
	ticker := time.NewTicker(o.tick)
	defer ticker.Stop()
	lastPrune := o.now()
	for {
		n, err := o.RunOnce(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			o.log.Error("mail: outbox run", "err", err)
		}
		if o.now().Sub(lastPrune) > time.Hour {
			lastPrune = o.now()
			if err := o.q.DeleteSentEmailsBefore(ctx, pgtype.Timestamptz{Time: o.now().Add(-outboxRetention), Valid: true}); err != nil {
				o.log.Warn("mail: prune history", "err", err)
			}
			if err := o.q.DeleteExpiredPasswordResetTokens(ctx); err != nil {
				o.log.Warn("mail: prune reset tokens", "err", err)
			}
		}
		if n == outboxBatch {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-o.kick:
		}
	}
}

// RunOnce claims one batch, sends each row, records the outcome, commits.
// Returns how many rows it claimed.
func (o *Outbox) RunOnce(ctx context.Context) (int, error) {
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := o.q.WithTx(tx)
	rows, err := qtx.ClaimPendingEmails(ctx, outboxBatch)
	if err != nil {
		return 0, err
	}
	for _, row := range rows {
		o.deliver(ctx, qtx, row)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(rows), nil
}

func (o *Outbox) deliver(ctx context.Context, q *db.Queries, row db.Email) {
	msg := Message{Kind: row.Kind, Locale: row.Locale, UserID: row.UserID.String, To: row.ToEmail,
		Subject: row.Subject, HTML: row.Html, Text: row.Text}
	sendErr := o.sender.Send(ctx, msg)
	if sendErr == nil {
		if err := q.MarkEmailSent(ctx, row.ID); err != nil {
			o.log.Error("mail: mark sent", "id", row.ID, "err", err)
		}
		return
	}
	attempt := int(row.Attempts) + 1
	if attempt >= outboxMaxTries {
		o.log.Error("mail: giving up", "kind", row.Kind, "to", row.ToEmail, "attempts", attempt, "err", sendErr)
		if err := q.MarkEmailFailed(ctx, db.MarkEmailFailedParams{ID: row.ID, LastError: pgtype.Text{String: sendErr.Error(), Valid: true}}); err != nil {
			o.log.Error("mail: mark failed", "id", row.ID, "err", err)
		}
		return
	}
	next := o.now().Add(backoff[attempt-1])
	o.log.Warn("mail: send failed, will retry", "kind", row.Kind, "to", row.ToEmail, "attempts", attempt, "next", next, "err", sendErr)
	if err := q.MarkEmailAttemptFailed(ctx, db.MarkEmailAttemptFailedParams{
		ID: row.ID, NextAttemptAt: pgtype.Timestamptz{Time: next, Valid: true},
		LastError: pgtype.Text{String: sendErr.Error(), Valid: true},
	}); err != nil {
		o.log.Error("mail: mark attempt", "id", row.ID, "err", err)
	}
}
