package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Transcript retention (UNI-1995 #5): an organization that set
// meeting_settings.transcript_retention_days keeps transcript lines and
// uploaded meeting audio that long. Summaries, minutes, action items and
// tasks are never swept. Each meeting's lines go in one transaction with an
// audit row (meeting.transcript_expired, the system as actor) and
// transcript.changed; each recording goes the way a clerk's delete does.
const (
	transcriptRetentionInterval = time.Hour
	// Per organization per pass: a backlog spreads over passes.
	transcriptRetentionBatch      = int32(50)
	transcriptRetentionMaxBatches = 20
	// "uw-trret" as an int64: the session lock one replica holds per pass.
	transcriptRetentionLockKey = int64(0x75772d7472726574)
)

var transcriptRetentionActor = audit.System("meeting_transcript_retention")

// TranscriptRetentionSweeper runs SweepTranscriptRetention every hour until
// its context ends; main awaits it in the shutdown sequence.
type TranscriptRetentionSweeper struct{ s *MeetingService }

func (s *MeetingService) NewTranscriptRetentionSweeper() *TranscriptRetentionSweeper {
	return &TranscriptRetentionSweeper{s: s}
}

func (w *TranscriptRetentionSweeper) Run(ctx context.Context) {
	for retentionPause(ctx, transcriptRetentionInterval) {
		if err := w.s.SweepTranscriptRetention(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("meeting transcript retention sweep", "err", err)
		}
	}
}

// SweepTranscriptRetention is one pass. One replica runs it at a time (a
// session advisory lock, works without Redis); the others skip the tick.
func (s *MeetingService) SweepTranscriptRetention(ctx context.Context) error {
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	lockQ := db.New(conn)
	if locked, err := lockQ.TranscriptRetentionTryLock(ctx, transcriptRetentionLockKey); err != nil || !locked {
		return err
	}
	defer func() {
		if _, err := lockQ.TranscriptRetentionUnlock(context.WithoutCancel(ctx), transcriptRetentionLockKey); err != nil {
			slog.Warn("meeting transcript retention: release sweep lease", "err", err)
		}
	}()
	orgs, err := s.q.ListTranscriptRetentionSettings(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, o := range orgs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		cutoff := pgtype.Timestamptz{Time: time.Now().AddDate(0, 0, -int(o.Days)), Valid: true}
		errs = append(errs, s.expireTranscriptions(ctx, o.OrganizationID, cutoff), s.expireTranscriptLines(ctx, o.OrganizationID, o.Days, cutoff))
	}
	return errors.Join(errs...)
}

// expireTranscriptions deletes uploaded recordings past the window, with
// their lines, releasing each file to the collector.
func (s *MeetingService) expireTranscriptions(ctx context.Context, orgID string, cutoff pgtype.Timestamptz) error {
	for range transcriptRetentionMaxBatches {
		rows, err := s.q.ListExpiredMeetingTranscriptions(ctx, db.ListExpiredMeetingTranscriptionsParams{
			OrganizationID: orgID, Cutoff: cutoff, RowLimit: transcriptRetentionBatch,
		})
		if err != nil {
			return err
		}
		for _, t := range rows {
			if err := s.inTx(ctx, func(q *db.Queries) error {
				m, err := q.GetMeeting(ctx, t.MeetingID)
				if err != nil {
					return err
				}
				return s.deleteTranscriptionInTx(ctx, q, m, transcriptRetentionActor, t.ID, "retention")
			}); err != nil && !errors.Is(err, ErrNotFound) {
				return err
			}
		}
		if int32(len(rows)) < transcriptRetentionBatch {
			return nil
		}
	}
	return nil
}

// expireTranscriptLines deletes, meeting by meeting, the lines stored before
// the cutoff.
func (s *MeetingService) expireTranscriptLines(ctx context.Context, orgID string, days int32, cutoff pgtype.Timestamptz) error {
	for range transcriptRetentionMaxBatches {
		ids, err := s.q.ListMeetingsWithExpiredTranscript(ctx, db.ListMeetingsWithExpiredTranscriptParams{
			OrganizationID: orgID, Cutoff: cutoff, RowLimit: transcriptRetentionBatch,
		})
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := s.inTx(ctx, func(q *db.Queries) error {
				m, err := q.GetMeeting(ctx, id)
				if err != nil {
					return err
				}
				n, err := q.DeleteExpiredTranscriptSegments(ctx, db.DeleteExpiredTranscriptSegmentsParams{
					OrganizationID: orgID, MeetingID: id, Cutoff: cutoff,
				})
				if err != nil || n == 0 {
					return err
				}
				return s.transcriptChanged(ctx, q, m, transcriptRetentionActor, audit.ActionMeetingTranscriptExpired, "meeting", m.ID,
					map[string]any{"segments": n, "retention_days": days})
			}); err != nil {
				return err
			}
		}
		if int32(len(ids)) < transcriptRetentionBatch {
			return nil
		}
	}
	return nil
}
