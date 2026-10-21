package service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Meetings held without a room (parent spec 2026-10-20-meeting-follow-through
// §5.3, §6.4, §7.4, §7.5, UNI-2001): the host records that the meeting was
// held, a clerk uploads its recording, and the worker below has it
// transcribed in batch. The minutes are charged to meeting.transcription,
// the same meter as the live scribe (D15).

const (
	TranscriptionQueued   = "QUEUED"
	TranscriptionRunning  = "RUNNING"
	TranscriptionComplete = "COMPLETE"
	TranscriptionFailed   = "FAILED"

	transcriptionFlag = "meeting_transcription"
	// The worker asks every 15 s; a claim holds a row this long, enough for
	// one vendor call (its client gives up after a minute) or one completion.
	transcriptionPollInterval = 15 * time.Second
	transcriptionLease        = 2 * time.Minute
	transcriptionBatch        = 20
	// One vendor job may run max(2 h, 3 × the audio); three jobs per row.
	transcriptionMinJob      = 2 * time.Hour
	transcriptionMaxAttempts = 3
	// A clock in the future by more than this is a wrong time, not a skew.
	heldClockSkew = time.Minute
)

// transcriptionURLTTL is how long the vendor may read the recording (§7.4).
const transcriptionURLTTL = 6 * time.Hour

// pollSeconds is transcriptionPollInterval for the queries, which schedule
// on the database's clock.
const pollSeconds = int32(transcriptionPollInterval / time.Second)

// transcriptionBackoff is the pause before the second and the third job.
var transcriptionBackoff = []time.Duration{time.Minute, 5 * time.Minute}

// Closed set of error_code values a failed transcription shows.
const (
	transcriptionErrFile     = "file_unavailable"
	transcriptionErrProvider = "provider_error"
	transcriptionErrTimeout  = "timeout"
)

// transcriptionActor attributes the worker's rows, minutes and events.
var transcriptionActor = audit.System("meeting_transcription")

// SetUploads wires the shared large-upload sessions (BIGUP) the audio
// upload rides on; nil leaves the upload route answering 503.
func (s *MeetingService) SetUploads(d *DocumentService) { s.uploads = d }

// TranscriptionAvailable is the `transcription` meeting capability: a vendor
// is configured, the flag is on and the plan includes meeting.transcription.
func (s *MeetingService) TranscriptionAvailable(ctx context.Context, orgID string) bool {
	return s.AI.MeetingTranscribeAvailable() && s.files != nil &&
		s.orgFlagOn(ctx, orgID, transcriptionFlag) && s.ent.Can(ctx, orgID, FeatureMeetingTranscription) == nil
}

func errTranscriptionUnavailable() error {
	return coded(http.StatusServiceUnavailable, "transcription_unavailable", "chưa bật ghi lời file ghi âm cho tổ chức này")
}

// requireTranscription: the plan first (403 entitlement_required, as every
// plan gate answers), then the flag and the vendor (503).
func (s *MeetingService) requireTranscription(ctx context.Context, orgID string) error {
	if err := s.ent.Can(ctx, orgID, FeatureMeetingTranscription); err != nil {
		return err
	}
	if !s.TranscriptionAvailable(ctx, orgID) {
		return errTranscriptionUnavailable()
	}
	return nil
}

// RecordHeld is "Ghi nhận đã họp" (D10): a meeting held in person without a
// room goes SCHEDULED → ENDED at the times the host reports, with no
// conference session. It emits meeting.ended like End, so what follows an
// ended meeting follows this one too.
func (s *MeetingService) RecordHeld(ctx context.Context, userID, meetingID string, startedAt, endedAt time.Time) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingScheduled {
		return db.Meeting{}, errInvalidState()
	}
	if startedAt.IsZero() || !endedAt.After(startedAt) || endedAt.After(time.Now().Add(heldClockSkew)) {
		return db.Meeting{}, coded(http.StatusUnprocessableEntity, "invalid_held_times",
			"giờ kết thúc phải sau giờ bắt đầu và không ở tương lai")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	ended, err := q.RecordMeetingHeld(ctx, db.RecordMeetingHeldParams{
		StartedAt: pgtype.Timestamptz{Time: startedAt, Valid: true}, EndedAt: pgtype.Timestamptz{Time: endedAt, Valid: true},
		UpdatedBy: strText(userID), ID: m.ID, Version: m.Version,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	_ = q.RevokeGrantsForMeeting(ctx, db.RevokeGrantsForMeetingParams{MeetingID: m.ID, RevokedBy: strText(userID), RevokeReason: strText("meeting_ended")})
	_ = q.ExpirePendingJoinRequests(ctx, m.ID)
	if err := s.writeAudit(ctx, q, m, "MEETING_RECORDED_HELD", userID, MeetingScheduled, MeetingEnded, "{}"); err != nil {
		return db.Meeting{}, err
	}
	// As endMeeting does (A5). With no notes or transcript yet (the audio is
	// usually uploaded later) the run settles quietly as summary_no_source.
	if err := s.queueAutoSummary(ctx, q, ended); err != nil {
		return db.Meeting{}, err
	}
	s.recordAction(ctx, q, ended, audit.User(userID), audit.ActionMeetingHeldRecorded, "meeting.ended", nil,
		audit.Diff(map[string]any{"status": MeetingScheduled}, map[string]any{
			"status": MeetingEnded, "actual_start_at": tsOrNil(ended.ActualStartAt), "actual_end_at": tsOrNil(ended.ActualEndAt),
		}), "meeting", m.ID)
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	s.count("ended")
	return ended, nil
}

// OpenAudioUploadSession opens the large upload session for a recording of
// an ended meeting (§5.5): a clerk, with transcription available.
func (s *MeetingService) OpenAudioUploadSession(ctx context.Context, userID, meetingID string, in OpenUploadSessionInput) (UploadSessionView, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return UploadSessionView{}, err
	}
	if m.Status != MeetingEnded {
		return UploadSessionView{}, errInvalidState()
	}
	if err := s.requireTranscription(ctx, m.OrganizationID); err != nil {
		return UploadSessionView{}, err
	}
	// The size is known now: a recording the plan cannot pay for is refused
	// before 2 GiB travel, with the same estimate the request will use. An
	// unreadable head is left to the open's own probe check.
	if head, err := decodeBase64Probe(in.Probe.HeadB64); err == nil {
		mime := files.NormalizeContentType(files.DetectContentType(head, in.Filename))
		if err := s.checkTranscriptionQuota(ctx, s.q, m.OrganizationID, estimateSeconds(in.SizeBytes, mime, head)); err != nil {
			return UploadSessionView{}, err
		}
	}
	if s.uploads == nil {
		return UploadSessionView{}, errTranscriptionUnavailable()
	}
	return s.uploads.OpenMeetingAudioUploadSession(ctx, Human(userID), m.OrganizationID, m.WorkspaceID, m.ID, in)
}

// TranscriptionRequest is POST /meetings/{id}/transcriptions.
type TranscriptionRequest struct {
	UploadID string
	Language string
	// Consent: the clerk confirmed attendees were told the meeting was
	// recorded (§7.5). Kept in the audit row's metadata.
	Consent bool
}

// RequestTranscription claims an uploaded recording for the meeting and
// queues it (§6.4). The minutes it will take are estimated from its size
// and checked up front, together with what the organization's other open
// jobs were estimated at, so a long file cannot push the organization over
// its plan hours later (§7.4).
func (s *MeetingService) RequestTranscription(ctx context.Context, userID, meetingID string, in TranscriptionRequest) (db.MeetingTranscription, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingTranscription{}, err
	}
	if m.Status != MeetingEnded {
		return db.MeetingTranscription{}, errInvalidState()
	}
	if !in.Consent {
		return db.MeetingTranscription{}, coded(http.StatusUnprocessableEntity, "recording_consent_required",
			"cần xác nhận đã thông báo cho người dự họp về việc ghi âm")
	}
	if in.Language == "" {
		in.Language = scribeLocale
	}
	if in.Language != "vi" && in.Language != "en" {
		return db.MeetingTranscription{}, Invalid("language phải là vi hoặc en")
	}
	uploadID := strings.TrimSpace(in.UploadID)
	if uploadID == "" {
		return db.MeetingTranscription{}, Invalid("upload_id bắt buộc")
	}
	if err := s.requireTranscription(ctx, m.OrganizationID); err != nil {
		return db.MeetingTranscription{}, err
	}
	// Only the person who uploaded the recording queues it, and only for the
	// meeting the upload session was opened for; anything else is not found.
	up, err := s.q.GetMeetingAudioUpload(ctx, db.GetMeetingAudioUploadParams{FileID: uploadID, OrganizationID: m.OrganizationID})
	if errors.Is(err, pgx.ErrNoRows) || err == nil && (up.CreatedBy != userID || up.MeetingID.String != m.ID) {
		return db.MeetingTranscription{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingTranscription{}, err
	}
	head := s.audioHead(ctx, m, uploadID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingTranscription{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	claimed, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: audit.User(userID), Purpose: files.MeetingAudio,
		Scope:   files.Scope{OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID},
		FileIDs: []files.FileID{files.FileID(uploadID)},
	})
	if err != nil {
		return db.MeetingTranscription{}, filesError(err)
	}
	f := claimed[0]
	estimate := estimateSeconds(f.SizeBytes, f.ContentType, head)
	if err := s.checkTranscriptionQuota(ctx, q, m.OrganizationID, estimate); err != nil {
		return db.MeetingTranscription{}, err
	}
	start, err := q.MeetingTranscriptionFileStart(ctx, db.MeetingTranscriptionFileStartParams{MeetingID: m.ID, FileID: string(f.ID)})
	if err != nil {
		return db.MeetingTranscription{}, err
	}
	startsAt := start.PreviousStart
	if !startsAt.Valid {
		base := m.ActualStartAt
		if !base.Valid {
			base = m.StartsAt
		}
		startsAt = pgtype.Timestamptz{Time: base.Time.Add(time.Duration(start.EarlierSeconds) * time.Second), Valid: true}
	}
	t, err := q.InsertMeetingTranscription(ctx, db.InsertMeetingTranscriptionParams{
		ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
		FileID: string(f.ID), Filename: f.Filename, ContentType: f.ContentType, SizeBytes: f.SizeBytes,
		EstimatedSeconds: estimate, StartsAt: startsAt, Language: in.Language,
		CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
	})
	if isUniqueViolation(err) {
		return db.MeetingTranscription{}, coded(http.StatusConflict, "transcription_in_progress", "tệp này đang được ghi lời")
	}
	if err != nil {
		return db.MeetingTranscription{}, err
	}
	if err := s.recordTranscription(ctx, q, t, audit.User(userID), audit.ActionMeetingTranscriptionRequested, "transcription.requested",
		map[string]any{"consent_confirmed": true, "file_id": t.FileID, "estimated_seconds": t.EstimatedSeconds}); err != nil {
		return db.MeetingTranscription{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingTranscription{}, err
	}
	return t, nil
}

// Transcriptions lists the meeting's transcriptions, newest first, for
// anyone who may read its transcript.
func (s *MeetingService) Transcriptions(ctx context.Context, userID, meetingID string) ([]db.MeetingTranscription, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingTranscriptions(ctx, meetingID)
}

// estimateSeconds is the up-front length of a recording (§7.4): its size
// at the rate its head declares, else at the container's typical rate.
func estimateSeconds(size int64, mime string, head []byte) int32 {
	return int32(math.Ceil(ai.EstimateAudioSecondsFromHead(size, mime, head)))
}

// audioHead reads the first 64 KiB of a staged recording for the estimate;
// nil when it cannot (the estimate then uses the table).
func (s *MeetingService) audioHead(ctx context.Context, m db.Meeting, fileID string) []byte {
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope: files.Scope{OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID}, FileID: files.FileID(fileID),
		Length: files.DetectHeadBytes,
	})
	if err != nil {
		return nil
	}
	defer func() { _ = r.Close() }()
	head, err := io.ReadAll(io.LimitReader(r.Body, files.DetectHeadBytes))
	if err != nil {
		return nil
	}
	return head
}

// checkTranscriptionQuota refuses, with 402, a recording whose estimated
// minutes and the organization's open jobs together pass what is left of
// meeting.transcription.
func (s *MeetingService) checkTranscriptionQuota(ctx context.Context, q *db.Queries, orgID string, seconds int32) error {
	open, err := q.OpenTranscriptionMinutes(ctx, orgID)
	if err != nil {
		return err
	}
	return paymentRequired(s.ent.CheckQuota(ctx, orgID, FeatureMeetingTranscription, billedMinutes(float64(seconds))+open))
}

// billedMinutes is per started minute, at least one (ADR 0029).
func billedMinutes(seconds float64) int64 {
	return max(int64(math.Ceil(seconds/60)), 1)
}

// paymentRequired answers a plan meter that is spent with 402, as the AI
// commands do; the fields stay those of quota_exceeded.
func paymentRequired(err error) error {
	var ce CodedError
	if errors.As(err, &ce) && errors.Is(err, ErrQuotaExceeded) {
		ce.Status = http.StatusPaymentRequired
		return ce
	}
	return err
}

func (s *MeetingService) recordTranscription(ctx context.Context, q *db.Queries, t db.MeetingTranscription, actor audit.Actor, action, topic string, metadata map[string]any) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: t.OrganizationID, WorkspaceID: t.WorkspaceID, Actor: actor, Action: action,
		ResourceType: "meeting_transcription", ResourceID: t.ID,
		Changes:  audit.Diff(nil, map[string]any{"status": t.Status, "meeting_id": t.MeetingID}),
		Metadata: metadata,
	}, audit.Event{
		Topic: topic, OrganizationID: t.OrganizationID, WorkspaceID: t.WorkspaceID,
		Payload: map[string]string{"meeting_id": t.MeetingID, "transcription_id": t.ID, "workspace_id": t.WorkspaceID},
	})
}

// ---- Worker -----------------------------------------------------------------

// runTranscriptions is the 15 s worker (§7.4), off the outbox because one
// job outlives an outbox delivery. Rows are claimed with SKIP LOCKED and a
// lease, so nodes never work the same row; the lease value is the holder's
// token for every write after it. Rows are claimed one at a time, right
// before their work, so the 2-minute lease always covers the one vendor call
// (its client gives up after a minute) or the one completion behind it: a
// batch claimed up front would age its last rows' leases while the first
// ones run, and another node would submit them a second time. Without a
// vendor the rows wait.
func (s *MeetingService) runTranscriptions(ctx context.Context) error {
	if !s.AI.MeetingTranscribeAvailable() || s.files == nil {
		return nil
	}
	var errs []error
	for range transcriptionBatch {
		rows, err := s.q.ClaimMeetingTranscriptions(ctx, db.ClaimMeetingTranscriptionsParams{
			LeaseSeconds: int32(transcriptionLease / time.Second), RowLimit: 1,
		})
		if err != nil || len(rows) == 0 {
			return errors.Join(append(errs, err)...)
		}
		if err := s.advanceTranscription(ctx, rows[0]); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (s *MeetingService) advanceTranscription(ctx context.Context, t db.MeetingTranscription) error {
	if t.Status == TranscriptionQueued || t.ProviderJobID == "" {
		return s.submitTranscription(ctx, t)
	}
	overdue, err := s.q.TranscriptionOverdue(ctx, t.ID)
	if err != nil {
		return err
	}
	if overdue {
		s.AI.MeetingTranscribeAbandon(ctx, t.UsageEventID.String)
		return s.failTranscriptionAttempt(ctx, t, transcriptionErrTimeout, t.Attempts)
	}
	res, err := s.AI.MeetingTranscribePoll(ctx, t.UsageEventID.String, t.ProviderJobID)
	var jobErr *provider.FileJobError
	switch {
	case errors.As(err, &jobErr):
		return s.failTranscriptionAttempt(ctx, t, transcriptionErrProvider, t.Attempts)
	case err != nil:
		// A transport error: the job may still run; ask again next tick.
		_, rerr := s.q.RescheduleTranscription(ctx, db.RescheduleTranscriptionParams{
			ID: t.ID, Lease: t.LeaseUntil, AfterSeconds: pollSeconds,
		})
		return errors.Join(err, rerr)
	case !res.Done:
		_, err := s.q.RescheduleTranscription(ctx, db.RescheduleTranscriptionParams{
			ID: t.ID, Lease: t.LeaseUntil, AfterSeconds: pollSeconds,
		})
		return err
	}
	return s.completeTranscription(ctx, t, res)
}

func (s *MeetingService) submitTranscription(ctx context.Context, t db.MeetingTranscription) error {
	// The flag is the legal kill switch (§7.5) and the plan may have lapsed:
	// a job not sent yet waits, uncounted, until both allow it again.
	if !s.TranscriptionAvailable(ctx, t.OrganizationID) {
		_, err := s.q.RescheduleTranscription(ctx, db.RescheduleTranscriptionParams{ID: t.ID, Lease: t.LeaseUntil, AfterSeconds: pollSeconds})
		return err
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope: files.Scope{OrganizationID: t.OrganizationID, WorkspaceID: t.WorkspaceID},
		Mode:  files.ReadPresign, Disposition: files.DispositionAttachment, FileIDs: []files.FileID{files.FileID(t.FileID)},
		MaxTTL: transcriptionURLTTL,
	})
	if err != nil || len(resolved) == 0 || resolved[0].Err != nil || resolved[0].URL == "" {
		return s.failTranscriptionAttempt(ctx, t, transcriptionErrFile, t.Attempts+1)
	}
	jobID, usageID, err := s.AI.MeetingTranscribeSubmit(ctx,
		ai.CloudCall{Actor: audit.Actor{Kind: audit.Kind(t.CreatedByKind), ID: t.CreatedBy}, OrganizationID: t.OrganizationID},
		provider.FileTranscribeRequest{
			// One id per (row, attempt): a submit repeated after a lost
			// answer is the same vendor request, not a second job.
			RequestID: t.ID + "-" + strconv.Itoa(int(t.Attempts)+1),
			AudioURL:  resolved[0].URL, MIME: t.ContentType, Language: t.Language, Diarize: true,
		})
	if err != nil {
		return s.failTranscriptionAttempt(ctx, t, transcriptionErrProvider, t.Attempts+1)
	}
	job := max(transcriptionMinJob, 3*time.Duration(t.EstimatedSeconds)*time.Second)
	n, err := s.q.MarkTranscriptionSubmitted(ctx, db.MarkTranscriptionSubmittedParams{
		ID: t.ID, Lease: t.LeaseUntil, Provider: s.AI.MeetingTranscriberName(), Model: s.AI.MeetingTranscriberModel(),
		ProviderJobID: jobID, UsageEventID: strText(usageID),
		JobSeconds: int32(job / time.Second), AfterSeconds: pollSeconds,
	})
	if err == nil && n == 0 {
		// The lease moved on while the vendor answered: the row is not ours to
		// record. Its next holder resubmits under the same request id; this
		// job's usage row is settled so it does not stay pending.
		s.AI.MeetingTranscribeAbandon(ctx, usageID)
		slog.Warn("meeting transcription: lease lost during submit", "transcription", t.ID, "usage_event_id", usageID)
	}
	return err
}

// failTranscriptionAttempt ends one attempt: back to the queue after a pause
// while attempts are left, else FAILED with its audit row and event.
func (s *MeetingService) failTranscriptionAttempt(ctx context.Context, t db.MeetingTranscription, code string, attempts int32) error {
	if attempts < transcriptionMaxAttempts {
		pause := transcriptionBackoff[min(int(attempts), len(transcriptionBackoff))-1]
		_, err := s.q.RetryTranscription(ctx, db.RetryTranscriptionParams{
			ID: t.ID, Lease: t.LeaseUntil, ErrorCode: code, Attempts: attempts,
			AfterSeconds: int32(pause / time.Second),
		})
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	failed, err := q.FailTranscription(ctx, db.FailTranscriptionParams{ID: t.ID, Lease: t.LeaseUntil, ErrorCode: code, Attempts: attempts})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // the lease moved on: another node owns the row now
	}
	if err != nil {
		return err
	}
	if err := s.recordTranscription(ctx, q, failed, transcriptionActor, audit.ActionMeetingTranscriptionFailed, "transcription.failed",
		map[string]any{"error_code": code, "attempts": attempts}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// completeTranscription lands a finished job in one transaction (§7.4): the
// segments on the meeting's clock, one unassigned speaker label per vendor
// label (scribe spec §6.3, "upload:<id>:<label>"), COMPLETE with the billed
// seconds, the minutes on meeting.transcription, the timeline line, the
// audit row and transcription.completed.
func (s *MeetingService) completeTranscription(ctx context.Context, t db.MeetingTranscription, res provider.FileTranscribeResult) error {
	// Silent audio (the vendor heard no speech) is COMPLETE with nothing to
	// bill: the minutes meter speech, and nothing was transcribed.
	seconds := res.Seconds
	if seconds <= 0 && !res.Silent {
		seconds = float64(t.EstimatedSeconds)
	}
	model := res.Model
	if model == "" {
		model = t.Model
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	done, err := q.CompleteTranscription(ctx, db.CompleteTranscriptionParams{
		ID: t.ID, Lease: t.LeaseUntil, AudioSeconds: pgtype.Int4{Int32: int32(math.Ceil(seconds)), Valid: true}, Model: model,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	labels := map[string]bool{}
	for _, seg := range res.Segments {
		vendor := seg.SpeakerLabel
		if vendor == "" {
			vendor = "?"
		}
		key := "upload:" + t.ID + ":" + vendor
		if vendor != "?" && !labels[key] {
			labels[key] = true
			if _, err := q.InsertMeetingSpeakerLabel(ctx, db.InsertMeetingSpeakerLabelParams{
				ID: util.NewID(), OrganizationID: t.OrganizationID, WorkspaceID: t.WorkspaceID, MeetingID: t.MeetingID,
				LabelKey: key, CreatedBy: transcriptionActor.ID, CreatedByKind: string(transcriptionActor.Kind),
			}); err != nil {
				return err
			}
		}
		if err := q.InsertTranscriptionSegment(ctx, db.InsertTranscriptionSegmentParams{
			ID: util.NewID(), MeetingID: t.MeetingID, OrganizationID: t.OrganizationID, Text: seg.Text,
			SpokenAt:        pgtype.Timestamptz{Time: t.StartsAt.Time.Add(time.Duration(seg.StartMs) * time.Millisecond), Valid: true},
			TranscriptionID: strText(t.ID), StartMs: pgtype.Int4{Int32: int32(seg.StartMs), Valid: true},
			EndMs: pgtype.Int4{Int32: int32(seg.EndMs), Valid: true}, SpeakerLabel: key, Language: t.Language,
		}); err != nil {
			return err
		}
	}
	if !res.Silent {
		if err := s.ent.RecordUsage(ctx, q, ConsumeInput{
			OrganizationID: t.OrganizationID, WorkspaceID: t.WorkspaceID, Meter: FeatureMeetingTranscription,
			Delta: billedMinutes(seconds), Actor: transcriptionActor,
			RefType: "meeting_transcription", RefID: t.ID, IdempotencyKey: "transcription:" + t.ID,
		}); err != nil {
			return err
		}
	}
	m, err := q.GetMeeting(ctx, t.MeetingID)
	if err != nil {
		return err
	}
	if err := s.writeAudit(ctx, q, m, "TRANSCRIPTION_COMPLETED", transcriptionActor.ID, "", "", "{}"); err != nil {
		return err
	}
	if err := s.recordTranscription(ctx, q, done, transcriptionActor, audit.ActionMeetingTranscriptionCompleted, "transcription.completed",
		map[string]any{"audio_seconds": done.AudioSeconds.Int32, "segments": len(res.Segments), "usage_event_id": t.UsageEventID.String}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// MeetingTranscriptionProvider is the FS-C1 section 6 reference provider for
// meeting_transcriptions.file_id: any transcription row holds its recording.
type MeetingTranscriptionProvider struct{}

func (MeetingTranscriptionProvider) Name() string { return "meetings.transcriptions" }

func (MeetingTranscriptionProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.MeetingAudio}
}

func (MeetingTranscriptionProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListMeetingTranscriptionFileHolds(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, h := range held {
		out[files.FileID(h)] = files.HoldActive
	}
	return out, nil
}
