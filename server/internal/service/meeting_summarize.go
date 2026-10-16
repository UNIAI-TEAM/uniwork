package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The helpers of MeetingService.Summarize (UNI-1853): the single-flight lease,
// the one transaction that stores a summary with its audit row and event, the
// notes budget, and the mapping of every failure to a fixed refusal.

const (
	// transcriptSegmentRunes caps one transcript line or in-room chat message,
	// counted in characters so a cut never splits a UTF-8 sequence.
	transcriptSegmentRunes = 4000

	// Notes share summaryTranscriptRunes with the transcript: they take what
	// they need up to a quarter of it, and each note is clipped first so one
	// pasted wall of text cannot push every other note out of the window.
	summaryNotesRunes = summaryTranscriptRunes / 4
	summaryNoteRunes  = 4000

	// summaryRunLease is how long a claimed run keeps other runs of its
	// meeting out. It is also how long a meeting stays refused after the node
	// running its summary died.
	summaryRunLease = 3 * time.Minute
	// summaryRunBudget bounds gathering the sources and the model call, so a
	// live run always stores (or fails) and gives its lease back before the
	// lease expires: a second run never starts while the first can still pay.
	summaryRunBudget = summaryRunLease - time.Minute
	// summaryStoreTimeout bounds storing a summary the model already answered
	// (and was billed for); the store runs detached from the request.
	summaryStoreTimeout = 15 * time.Second
	// summaryReleaseTimeout bounds giving the lease back; past it the lease
	// is left to expire.
	summaryReleaseTimeout = 5 * time.Second
)

// Reasons label uniwork_meeting_summary_errors_total and the failure log.
const (
	summaryReasonNotConfigured = "not_configured"
	summaryReasonQuota         = "quota"
	summaryReasonRateLimited   = "rate_limited"
	summaryReasonTimeout       = "timeout"
	summaryReasonProvider      = "provider"
	summaryReasonGateway       = "gateway"
	summaryReasonParse         = "parse"
	summaryReasonEmpty         = "empty"
	summaryReasonStore         = "store"
)

// The refusals Summarize answers with. The message is fixed and never quotes
// the cause; the client translates the code (UNI-1853 M13).
func errSummaryNotConfigured() error {
	return coded(http.StatusServiceUnavailable, "ai_not_configured", "AI chưa được cấu hình trên server.")
}

func errSummaryNoSource() error {
	return coded(http.StatusConflict, "summary_no_source", "Chưa có transcript, ghi chú, chat hay kết quả biểu quyết nào để tóm tắt.")
}

func errSummaryInProgress() error {
	return coded(http.StatusConflict, "summary_in_progress", "Tóm tắt của cuộc họp này đang được tạo. Thử lại sau ít phút.")
}

func errSummaryFailed() error {
	return coded(http.StatusBadGateway, "ai_failed", "AI không tạo được tóm tắt. Thử lại sau.")
}

func errSummaryTimeout() error {
	return coded(http.StatusGatewayTimeout, "ai_timeout", "AI trả lời quá lâu. Thử lại sau.")
}

// errSummaryEmptyOutput is a model answer that parsed but says nothing.
var errSummaryEmptyOutput = errors.New("meetings: summary output is empty")

// summaryStepError is a failure after the gateway answered, so after the
// call was billed: the reason labels it, err is the cause for the log.
type summaryStepError struct {
	reason string
	err    error
}

func (e summaryStepError) Error() string { return e.reason + ": " + e.err.Error() }
func (e summaryStepError) Unwrap() error { return e.err }

// summaryFailure turns a failed run into the refusal the client sees, counts
// it, and logs the cause with the ids that tie it to its usage row. A billed
// call that left no summary (parse, empty, store) is logged at Warn with the
// usage_event_id, so an orphaned usage row can be traced (UNI-1853 L2).
func (s *MeetingService) summaryFailure(meetingID, usageEventID string, err error) error {
	reason, out := classifySummaryFailure(err)
	s.summaryErrorCount(reason)
	slog.Warn("meetings: summary failed", "meeting_id", meetingID, "usage_event_id", usageEventID, "reason", reason, "err", err)
	return out
}

// classifySummaryFailure maps a cause to its metric reason and its refusal.
// Quota and rate limit keep the gateway's code, status and fields (the
// rate limit's retry_after among them, UNI-1853 L16); everything the model
// side did wrong is ai_failed; a store failure stays an internal error, so
// the handler answers 500 without echoing it.
func classifySummaryFailure(err error) (string, error) {
	var step summaryStepError
	if errors.As(err, &step) {
		if step.reason == summaryReasonStore {
			return step.reason, fmt.Errorf("meetings: store summary: %w", step.err)
		}
		return step.reason, errSummaryFailed()
	}
	var aiErr *ai.Error
	if errors.As(err, &aiErr) {
		switch aiErr.Code {
		case ai.ErrDisabled.Code:
			return summaryReasonNotConfigured, errSummaryNotConfigured()
		case ai.ErrProviderTimeout.Code:
			return summaryReasonTimeout, errSummaryTimeout()
		case ai.ErrQuotaExceeded.Code:
			return summaryReasonQuota, CodedError{Code: aiErr.Code, Status: aiErr.Status, Msg: ai.ErrQuotaExceeded.Msg, Fields: aiErr.Fields}
		case ai.ErrRateLimited.Code:
			return summaryReasonRateLimited, CodedError{Code: aiErr.Code, Status: aiErr.Status, Msg: ai.ErrRateLimited.Msg, Fields: aiErr.Fields}
		}
		return summaryReasonProvider, errSummaryFailed()
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return summaryReasonTimeout, errSummaryTimeout()
	}
	return summaryReasonGateway, errSummaryFailed()
}

func (s *MeetingService) summaryErrorCount(reason string) {
	s.count("summary_error")
	if s.metrics != nil {
		s.metrics.IncSummaryError(reason)
	}
}

// summaryIsEmpty is a parsed answer with nothing to store.
func summaryIsEmpty(res ai.MeetingSummary) bool {
	return strings.TrimSpace(res.Summary) == "" && len(res.Decisions) == 0 && len(res.ActionItems) == 0
}

// claimSummaryRun claims the meeting's summary run lease (UNI-1853 M9): one
// row in meeting_summary_runs that expires after summaryRunLease, given back
// by release. A live lease, taken on this node or another, is 409
// summary_in_progress.
//
// Why a lease row and not a lock: MeetingService has no Redis client, and a
// process-local guard would let two API nodes pay the model twice, so the
// lease lives in the one database every node shares. A session advisory lock
// would pin a pooled connection through the whole model call while the run
// needs more connections for its reads and its store, so summaries in flight
// could starve the pool (and it breaks behind a transaction-pooling proxy).
// The claim and the release are one short statement each and hold nothing in
// between; a node that dies mid-run leaves a lease that expires on its own.
func (s *MeetingService) claimSummaryRun(ctx context.Context, m db.Meeting) (func(), error) {
	runID := util.NewID()
	_, err := s.q.ClaimMeetingSummaryRun(ctx, db.ClaimMeetingSummaryRunParams{
		OrganizationID: m.OrganizationID, MeetingID: m.ID, RunID: runID, LeaseSeconds: summaryRunLease.Seconds(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errSummaryInProgress()
	}
	if err != nil {
		return nil, err
	}
	return func() {
		rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), summaryReleaseTimeout)
		defer cancel()
		if err := s.q.ReleaseMeetingSummaryRun(rctx, db.ReleaseMeetingSummaryRunParams{
			OrganizationID: m.OrganizationID, MeetingID: m.ID, RunID: runID,
		}); err != nil {
			slog.Warn("meetings: summary run lease not released, it expires on its own", "meeting_id", m.ID, "err", err)
		}
	}, nil
}

// storeSummary writes the summary, its meeting timeline row, its audit row
// and its summary.created event in one transaction (ADR 0009, ADR 0012): a
// summary that is stored is always audited and always announced, and an
// audit failure stores nothing.
func (s *MeetingService) storeSummary(ctx context.Context, m db.Meeting, userID string, res ai.MeetingSummary, resp ai.Response) (db.MeetingSummary, error) {
	decisions, err := json.Marshal(res.Decisions)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	items, err := json.Marshal(res.ActionItems)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// A conversion of the meeting's current summary under way finishes
	// first: it then links its tasks to a summary that was still the latest.
	if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
		return db.MeetingSummary{}, err
	}
	row, err := q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, Summary: res.Summary,
		Decisions: string(decisions), ActionItems: string(items), Model: resp.Model, CreatedBy: userID,
		UsageEventID: strText(resp.UsageEventID),
	})
	if err != nil {
		return db.MeetingSummary{}, err
	}
	// The meeting's own activity timeline still reads meeting_audit_logs.
	if err := s.writeAudit(ctx, q, m, "SUMMARY_CREATED", userID, "", row.ID, "{}"); err != nil {
		return db.MeetingSummary{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionMeetingSummaryCreated,
		ResourceType: "meeting", ResourceID: m.ID,
		Metadata: map[string]any{
			"summary_id": row.ID, "usage_event_id": resp.UsageEventID, "model": resp.Model,
			"decisions": len(res.Decisions), "action_items": len(res.ActionItems),
		},
	}, audit.Event{Topic: "summary.created", Payload: map[string]string{
		"meeting_id": m.ID, "summary_id": row.ID, "workspace_id": m.WorkspaceID,
	}}); err != nil {
		return db.MeetingSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingSummary{}, err
	}
	return row, nil
}

// summaryNoteLines renders the meeting's notes for the prompt as
// "Author: text", each clipped to summaryNoteRunes, and keeps what fits
// summaryNotesRunes with the same head-and-tail window as the transcript.
// It returns the lines and the runes they use, which the transcript's budget
// gives up.
func summaryNoteLines(notes []db.ListMeetingNotesRow) ([]string, int) {
	lines := make([]string, 0, len(notes))
	for _, n := range notes {
		body := capRunes(strings.TrimSpace(n.Body), summaryNoteRunes, "…")
		if body == "" {
			continue
		}
		if author := strings.TrimSpace(n.DisplayName); author != "" {
			body = author + ": " + body
		}
		lines = append(lines, body)
	}
	lines = windowSummaryLines(lines, summaryNotesRunes,
		func(l string) int { return utf8.RuneCountInString(l) + 1 },
		summaryOmitted)
	used := 0
	for _, l := range lines {
		used += utf8.RuneCountInString(l) + 1
	}
	return lines, used
}
