package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	webhookInboxBatch   int32 = 20
	webhookLeaseSeconds int32 = 60
	webhookMaxAttempts  int32 = 8
	webhookDrainRounds        = 20
	// reconcileInterval paces the backstop sweeps (stale room sessions,
	// provider desync).
	reconcileInterval = 5 * time.Minute
)

func (s *MeetingService) EnqueueProviderWebhook(ctx context.Context, provider, eventID, eventType string, payload []byte) (bool, error) {
	if eventID == "" {
		eventID = util.NewID()
	}
	n, err := s.q.InsertWebhookInbox(ctx, db.InsertWebhookInboxParams{
		ID: util.NewID(), Provider: provider, ProviderEventID: eventID,
		EventType: eventType, Payload: string(payload),
	})
	if err != nil {
		return false, err
	}
	if n == 0 {
		if s.metrics != nil {
			s.metrics.IncWebhookDuplicate()
		}
		return false, nil
	}
	if s.metrics != nil {
		s.metrics.IncWebhookReceived()
	}
	return true, nil
}

// ProcessWebhookInbox claims and applies one batch of provider webhooks.
func (s *MeetingService) ProcessWebhookInbox(ctx context.Context, limit int32) error {
	_, err := s.processWebhookBatch(ctx, limit)
	return err
}

// processWebhookBatch claims up to limit inbox rows, applies them and reports
// how many it claimed. A row whose event fails goes back to PENDING with a
// backoff (DEAD_LETTER after webhookMaxAttempts); one that was interrupted by
// shutdown is left to its lease, so a deploy costs no attempt.
func (s *MeetingService) processWebhookBatch(ctx context.Context, limit int32) (int, error) {
	if limit <= 0 {
		limit = s.rt.WebhookBatch
	}
	if limit <= 0 {
		limit = webhookInboxBatch
	}
	_ = s.q.ReleaseStaleWebhookInbox(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := s.q.WithTx(tx).ClaimPendingWebhookInbox(ctx, db.ClaimPendingWebhookInboxParams{
		LeaseSeconds: float64(webhookLeaseSeconds), LimitN: limit,
	})
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	concurrency := s.rt.WebhookConcurrency
	if concurrency <= 0 {
		concurrency = 1
	}
	sem := make(chan struct{}, concurrency)
	type rowResult struct {
		row db.WebhookInbox
		err error
	}
	results := make([]rowResult, len(rows))
	var wg sync.WaitGroup
	for _, group := range webhookRowGroups(rows) {
		wg.Add(1)
		sem <- struct{}{}
		go func(group []int) {
			defer wg.Done()
			defer func() { <-sem }()
			for _, i := range group {
				results[i] = rowResult{row: rows[i], err: s.processWebhookRow(ctx, rows[i])}
			}
		}(group)
	}
	wg.Wait()

	for _, res := range results {
		if res.err != nil {
			if ctx.Err() != nil {
				continue // shutting down: the lease hands the row back
			}
			s.markWebhookFailed(ctx, res.row, res.err)
			if s.metrics != nil {
				s.metrics.IncWebhookErrors()
			}
			continue
		}
		_ = s.q.MarkWebhookInboxDone(ctx, res.row.ID)
		if s.metrics != nil {
			s.metrics.IncWebhookProcessed()
		}
	}
	return len(rows), nil
}

// drainWebhookInbox processes batches until one comes back short, bounded so
// one tick cannot hold the loop forever: a join wave of hundreds of people is
// applied within the tick instead of one batch per tick.
func (s *MeetingService) drainWebhookInbox(ctx context.Context) error {
	limit := s.rt.WebhookBatch
	if limit <= 0 {
		limit = webhookInboxBatch
	}
	for range webhookDrainRounds {
		n, err := s.processWebhookBatch(ctx, limit)
		if err != nil || n < int(limit) || ctx.Err() != nil {
			return err
		}
	}
	return nil
}

// webhookRowGroups splits a claimed batch into groups that may run in
// parallel: the events of one provider identity stay together, in the order
// they were received, because a reconnect's join and leave only make sense in
// order. Every other row is a group of its own.
func webhookRowGroups(rows []db.WebhookInbox) [][]int {
	groups := make([][]int, 0, len(rows))
	byIdentity := map[string]int{}
	for i, row := range rows {
		var ev struct{ Identity string }
		if json.Unmarshal([]byte(row.Payload), &ev) != nil || ev.Identity == "" {
			groups = append(groups, []int{i})
			continue
		}
		if g, ok := byIdentity[ev.Identity]; ok {
			groups[g] = append(groups[g], i)
			continue
		}
		byIdentity[ev.Identity] = len(groups)
		groups = append(groups, []int{i})
	}
	return groups
}

func (s *MeetingService) processWebhookRow(ctx context.Context, row db.WebhookInbox) error {
	var ev ProviderNeutralEvent
	if err := json.Unmarshal([]byte(row.Payload), &ev); err != nil {
		return err
	}
	return s.HandleProviderEvent(ctx, ev)
}

func (s *MeetingService) markWebhookFailed(ctx context.Context, row db.WebhookInbox, err error) {
	nextAt, status := outbox.RetryAt(row.AttemptCount+1), "PENDING"
	if row.AttemptCount+1 >= webhookMaxAttempts {
		status = "DEAD_LETTER"
	}
	_ = s.q.MarkWebhookInboxFailed(ctx, db.MarkWebhookInboxFailedParams{
		ID: row.ID, LastError: strText(err.Error()),
		NextAttemptAt: pgtype.Timestamptz{Time: nextAt, Valid: true},
		Status:        status,
	})
}

func (s *MeetingService) ReconcileStaleAttendance(ctx context.Context, limit int32) error {
	if limit <= 0 {
		limit = 50
	}
	ids, err := s.q.ListEndedMeetingsWithOpenAttendance(ctx, limit)
	if err != nil {
		return err
	}
	for _, meetingID := range ids {
		m, err := s.q.GetMeeting(ctx, meetingID)
		if err != nil {
			continue
		}
		// An ended meeting's sessions close at its end, however late the
		// sweep runs; a canceled one never started, so now() is all there is.
		closed, err := s.q.CloseOpenAttendanceForMeeting(ctx, db.CloseOpenAttendanceForMeetingParams{
			MeetingID: meetingID, LeaveReason: strText("reconciled"), LeftAt: m.ActualEndAt,
		})
		if err != nil || closed == 0 {
			continue
		}
		s.publishAttendanceChanged(ctx, meetingID)
	}
	return nil
}

// RunWorkers runs the meeting workers until ctx is done and returns once all
// of them have stopped, so the shutdown sequence can await it. Each loop has
// its own goroutine: a slow reconcile or metering sweep never stalls webhook
// processing, and the other way round.
func (s *MeetingService) RunWorkers(ctx context.Context) {
	tick := s.rt.WorkerTick
	if tick <= 0 {
		tick = outboxWorkerTick
	}
	var wg sync.WaitGroup
	loop := func(name string, every time.Duration, run func(context.Context) error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			t := time.NewTicker(every)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					if err := run(ctx); err != nil && ctx.Err() == nil {
						slog.Warn("meeting worker", "worker", name, "err", err)
					}
				}
			}
		}()
	}
	loop("webhook_inbox", tick, s.drainWebhookInbox)
	loop("attendance_metering", attendanceMeterTick, s.drainAttendanceMetering)
	loop("reconcile", reconcileInterval, func(ctx context.Context) error {
		return errors.Join(s.ReconcileStaleAttendance(ctx, 50), s.ReconcileProviderDesync(ctx, 50))
	})
	wg.Wait()
}
