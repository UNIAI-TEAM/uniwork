package service

import (
	"context"
	"encoding/json"
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

func (s *MeetingService) ProcessWebhookInbox(ctx context.Context, limit int32) error {
	if limit <= 0 {
		limit = s.rt.WebhookBatch
	}
	if limit <= 0 {
		limit = webhookInboxBatch
	}
	_ = s.q.ReleaseStaleWebhookInbox(ctx)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := s.q.WithTx(tx).ClaimPendingWebhookInbox(ctx, db.ClaimPendingWebhookInboxParams{
		LeaseSeconds: float64(webhookLeaseSeconds), LimitN: limit,
	})
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
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
		if err != nil || len(closed) == 0 {
			continue
		}
		s.meterAttendanceSessions(ctx, meetingID, closed)
		s.publishAttendanceChanged(ctx, meetingID)
	}
	return nil
}

func (s *MeetingService) RunWorkers(ctx context.Context) {
	tick := s.rt.WorkerTick
	if tick <= 0 {
		tick = outboxWorkerTick
	}
	outboxTick := time.NewTicker(tick)
	reconTick := time.NewTicker(5 * time.Minute)
	defer outboxTick.Stop()
	defer reconTick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-outboxTick.C:
			_ = s.ProcessWebhookInbox(ctx, s.rt.WebhookBatch)
		case <-reconTick.C:
			_ = s.ReconcileStaleAttendance(ctx, 50)
			_ = s.ReconcileProviderDesync(ctx, 50)
		}
	}
}
