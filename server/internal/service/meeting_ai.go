package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	RecordingActive     = "ACTIVE"
	RecordingProcessing = "PROCESSING"
	RecordingComplete   = "COMPLETE"
	RecordingFailed     = "FAILED"

	transcriptLimit = 5000
	chatLimit       = 500

	// autoEndOvertime is the hard cap after ends_at while a conference is still open.
	autoEndOvertime = 2 * time.Hour
	autoEndInterval = 60 * time.Second
)

func (s *MeetingService) count(event string) {
	if s.metrics != nil {
		s.metrics.Inc(event)
	}
}

// ---- Transcript ------------------------------------------------------------

func (s *MeetingService) AppendTranscript(ctx context.Context, userID, meetingID, text string, spokenAt time.Time) (db.MeetingTranscriptSegment, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingTranscriptSegment{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingTranscriptSegment{}, errInvalidState()
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return db.MeetingTranscriptSegment{}, Invalid("nội dung không được để trống")
	}
	if len(text) > 4000 {
		text = text[:4000]
	}
	if spokenAt.IsZero() {
		spokenAt = time.Now().UTC()
	}
	speaker := ""
	pid := pgtype.Text{}
	if p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: meetingID, UserID: strText(userID)}); err == nil {
		pid = strText(p.ID)
		speaker = p.DisplayNameSnapshot
	}
	if speaker == "" {
		if u, err := s.q.GetUserByID(ctx, userID); err == nil {
			speaker = u.DisplayName
		}
	}
	seg, err := s.q.InsertTranscriptSegment(ctx, db.InsertTranscriptSegmentParams{
		ID: util.NewID(), MeetingID: meetingID, OrganizationID: m.OrganizationID, ParticipantID: pid, SpeakerName: speaker, Text: text,
		SpokenAt: pgtype.Timestamptz{Time: spokenAt, Valid: true},
	})
	if err != nil {
		return db.MeetingTranscriptSegment{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "transcript.appended", Payload: map[string]string{"meeting_id": meetingID}})
	return seg, nil
}

func (s *MeetingService) STTAgentEnabled() bool {
	return s.rt.STTAgentSecret != ""
}

// AppendTranscriptFromAgent ingests a diarized segment from a LiveKit Agents
// worker. The worker authenticates with X-Meeting-Agent-Secret, not a user JWT.
func (s *MeetingService) AppendTranscriptFromAgent(ctx context.Context, meetingID, participantIdentity, speakerName, text string, spokenAt time.Time) (db.MeetingTranscriptSegment, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.MeetingTranscriptSegment{}, ErrNotFound
		}
		return db.MeetingTranscriptSegment{}, err
	}
	if m.Status != MeetingInProgress {
		return db.MeetingTranscriptSegment{}, errInvalidState()
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return db.MeetingTranscriptSegment{}, Invalid("nội dung không được để trống")
	}
	if len(text) > 4000 {
		text = text[:4000]
	}
	if spokenAt.IsZero() {
		spokenAt = time.Now().UTC()
	}
	pid := pgtype.Text{}
	speaker := strings.TrimSpace(speakerName)
	const idPrefix = "uw_participant_"
	if strings.HasPrefix(participantIdentity, idPrefix) {
		participantID := strings.TrimPrefix(participantIdentity, idPrefix)
		if p, err := s.q.GetMeetingParticipant(ctx, participantID); err == nil && p.MeetingID == meetingID {
			pid = strText(p.ID)
			if speaker == "" {
				speaker = p.DisplayNameSnapshot
			}
		}
	}
	if speaker == "" {
		speaker = participantIdentity
	}
	seg, err := s.q.InsertTranscriptSegment(ctx, db.InsertTranscriptSegmentParams{
		ID: util.NewID(), MeetingID: meetingID, OrganizationID: m.OrganizationID, ParticipantID: pid, SpeakerName: speaker, Text: text,
		SpokenAt: pgtype.Timestamptz{Time: spokenAt, Valid: true},
	})
	if err != nil {
		return db.MeetingTranscriptSegment{}, err
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "transcript.appended", Payload: map[string]string{"meeting_id": meetingID}})
	return seg, nil
}

func (s *MeetingService) Transcript(ctx context.Context, userID, meetingID string) ([]db.MeetingTranscriptSegment, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListTranscriptSegments(ctx, db.ListTranscriptSegmentsParams{MeetingID: meetingID, Limit: transcriptLimit})
}

// ---- AI summary --------------------------------------------------------------

func (s *MeetingService) Summary(ctx context.Context, userID, meetingID string) (*db.MeetingSummary, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	sum, err := s.q.GetLatestMeetingSummary(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &sum, nil
}

func (s *MeetingService) AIEnabled() bool { return s.AI.Enabled() }

// Summarize gathers transcript, notes, chat, the attendance report and the
// closed votes, asks the gateway (capability meeting_summarization) and
// stores the result with the usage row that paid for it. Any host/admin may
// re-run it; the latest row wins.
func (s *MeetingService) Summarize(ctx context.Context, userID, meetingID, locale string) (db.MeetingSummary, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	if err := s.requireFeature(ctx, m, FeatureMeetingAISummary); err != nil {
		return db.MeetingSummary{}, err
	}
	if !s.AI.Enabled() {
		return db.MeetingSummary{}, coded(http.StatusServiceUnavailable, "ai_not_configured", "AI chưa được cấu hình trên server")
	}
	if m.Status != MeetingInProgress && m.Status != MeetingEnded {
		return db.MeetingSummary{}, errInvalidState()
	}
	var segs []db.MeetingTranscriptSegment
	var notes []db.ListMeetingNotesRow
	var chat []db.MeetingChatMessage
	var rep AttendanceReport
	var closed []db.MeetingMotion
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		var err error
		segs, err = s.q.ListTranscriptSegments(gctx, db.ListTranscriptSegmentsParams{MeetingID: meetingID, Limit: transcriptLimit})
		return err
	})
	g.Go(func() error {
		var err error
		notes, err = s.q.ListMeetingNotes(gctx, meetingID)
		return err
	})
	g.Go(func() error {
		var err error
		chat, err = s.q.ListMeetingChatMessages(gctx, db.ListMeetingChatMessagesParams{MeetingID: meetingID, Limit: chatLimit})
		return err
	})
	g.Go(func() error {
		var err error
		rep, err = s.attendanceReport(gctx, s.q, m)
		return err
	})
	g.Go(func() error {
		var err error
		closed, err = s.q.ListClosedMeetingMotions(gctx, meetingID)
		return err
	})
	if err := g.Wait(); err != nil {
		return db.MeetingSummary{}, err
	}
	// Attendance alone is not material (every meeting has a roll); a closed
	// vote is: it is a decision the minutes must carry.
	if len(segs) == 0 && len(notes) == 0 && len(chat) == 0 && len(closed) == 0 {
		return db.MeetingSummary{}, coded(http.StatusConflict, "nothing_to_summarize", "chưa có transcript, ghi chú, chat hay kết quả biểu quyết nào để tóm tắt")
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	transcript := make([]ai.TranscriptLine, 0, len(segs))
	for _, sg := range segs {
		transcript = append(transcript, ai.TranscriptLine{Speaker: sg.SpeakerName, Text: sg.Text})
	}
	noteBodies := make([]string, 0, len(notes))
	for _, n := range notes {
		noteBodies = append(noteBodies, n.Body)
	}
	chatLines := make([]ai.ChatLine, 0, len(chat))
	for _, c := range chat {
		chatLines = append(chatLines, ai.ChatLine{Sender: c.SenderName, Text: c.Message})
	}
	resp, err := s.AI.Complete(ctx, ai.Request{
		Actor: Human(userID), OrganizationID: orgID, WorkspaceID: m.WorkspaceID,
		Capability: ai.CapMeetingSummarization, PromptID: ai.PromptMeetingSummary,
		Vars: map[string]any{
			"title": m.Title, "agenda": m.Description, "locale": locale,
			"transcript": transcript, "notes": noteBodies, "chat": chatLines,
			"attendance": summaryAttendanceFacts(m, rep), "motions": summaryMotionFacts(closed),
		},
	})
	if err != nil {
		s.count("summary_error")
		var aiErr *ai.Error
		if errors.As(err, &aiErr) {
			return db.MeetingSummary{}, coded(aiErr.Status, aiErr.Code, aiErr.Msg)
		}
		return db.MeetingSummary{}, coded(http.StatusBadGateway, "ai_failed", "không tạo được tóm tắt: "+err.Error())
	}
	res, err := ai.ParseSummaryJSON(resp.Text)
	if err != nil {
		s.count("summary_error")
		return db.MeetingSummary{}, coded(http.StatusBadGateway, "ai_failed", "không tạo được tóm tắt: "+err.Error())
	}
	decisions, _ := json.Marshal(res.Decisions)
	items, _ := json.Marshal(res.ActionItems)
	row, err := s.q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: meetingID, OrganizationID: m.OrganizationID, Summary: res.Summary,
		Decisions: string(decisions), ActionItems: string(items), Model: resp.Model, CreatedBy: userID,
		UsageEventID: strText(resp.UsageEventID),
	})
	if err != nil {
		return db.MeetingSummary{}, err
	}
	s.count("summary_ok")
	_ = s.writeAudit(ctx, s.q, m, "SUMMARY_CREATED", userID, "", row.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "summary.created", Payload: map[string]string{"meeting_id": meetingID}})
	return row, nil
}

// summaryAttendanceFacts turns the attendance report into prompt facts.
// Counted members only (attendanceReport's summary): observers, and anyone
// who joined after the roll was finalized, are neither counted nor named. nil when the
// meeting has no members, so the prompt carries no empty attendance block.
func summaryAttendanceFacts(m db.Meeting, rep AttendanceReport) *ai.AttendanceFacts {
	if rep.Summary.Members == 0 {
		return nil
	}
	f := &ai.AttendanceFacts{
		Members: rep.Summary.Members, Present: rep.Summary.Present, Late: rep.Summary.Late,
		Excused: rep.Summary.Excused, Absent: rep.Summary.Absent,
		QuorumMet: rep.Summary.QuorumMet, Finalized: m.AttendanceFinalizedAt.Valid,
		NamesByStatus: map[string][]string{},
	}
	if m.QuorumPercent.Valid {
		f.QuorumPercent = int(m.QuorumPercent.Int16)
	}
	for _, r := range rep.Rows {
		if !r.counted() {
			continue
		}
		// Same bucketing as attendanceReport's summary: anything else is absent.
		status := r.Status
		switch status {
		case AttendancePresent, AttendanceLate, AttendanceExcused:
		default:
			status = AttendanceAbsent
		}
		f.NamesByStatus[status] = append(f.NamesByStatus[status], r.Participant.DisplayNameSnapshot)
	}
	return f
}

// summaryMotionFacts carries each closed vote's stored count and outcome.
// Voter names are never read here, whatever the ballot mode.
func summaryMotionFacts(closed []db.MeetingMotion) []ai.MotionFact {
	out := make([]ai.MotionFact, 0, len(closed))
	for _, mo := range closed {
		d := motionDenominator(mo.Base, int(mo.RollSize.Int32), int(mo.TotalMembers.Int32))
		out = append(out, ai.MotionFact{
			Title: mo.Title, BallotMode: mo.BallotMode,
			Yes: int(mo.YesCount), No: int(mo.NoCount), Abstain: int(mo.AbstainCount),
			Required: requiredYes(mo.Threshold, d), Outcome: mo.Outcome.String,
		})
	}
	return out
}

type SummaryTaskItem struct {
	Title       string
	Description string
	AssigneeID  *string
	ProjectID   *string
	Priority    string
	DueDate     *string
	Owner       string
	DueSpoken   string
}

// CreateTasksFromSummary turns chosen action items into workspace tasks.
func (s *MeetingService) CreateTasksFromSummary(ctx context.Context, userID, meetingID string, items []SummaryTaskItem) ([]db.Task, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Tasks == nil {
		return nil, coded(http.StatusServiceUnavailable, "tasks_unavailable", "task service chưa sẵn sàng")
	}
	if len(items) == 0 {
		return nil, Invalid("cần ít nhất một việc")
	}
	if len(items) > 50 {
		return nil, Invalid("tối đa 50 việc mỗi lần")
	}
	candidates, err := s.loadAssigneeCandidates(ctx, meetingID, m.WorkspaceID)
	if err != nil {
		return nil, err
	}
	anchor := meetingDueAnchor(m)
	meetingOrigin := meetingID
	out := make([]db.Task, 0, len(items))
	for _, it := range items {
		assigneeID := it.AssigneeID
		if assigneeID == nil && strings.TrimSpace(it.Owner) != "" {
			assigneeID = candidates.resolve(it.Owner)
		}
		dueDate := it.DueDate
		if dueDate == nil && strings.TrimSpace(it.DueSpoken) != "" {
			dueDate = parseMeetingDueSpoken(it.DueSpoken, anchor)
		}
		desc := strings.TrimSpace(it.Description)
		var extra []string
		if strings.TrimSpace(it.Owner) != "" && assigneeID == nil {
			extra = append(extra, "Người phụ trách (AI): "+strings.TrimSpace(it.Owner))
		}
		if strings.TrimSpace(it.DueSpoken) != "" && dueDate == nil {
			extra = append(extra, "Hạn (AI): "+strings.TrimSpace(it.DueSpoken))
		}
		if len(extra) > 0 {
			block := strings.Join(extra, "\n")
			if desc == "" {
				desc = block
			} else {
				desc = desc + "\n" + block
			}
		}
		origin := "Từ cuộc họp: " + m.Title
		if desc == "" {
			desc = origin
		} else {
			desc = desc + "\n\n" + origin
		}
		priority := strings.TrimSpace(it.Priority)
		t, err := s.Tasks.Create(ctx, Human(userID), m.WorkspaceID, CreateTaskInput{
			Title: it.Title, Description: desc, AssigneeID: assigneeID, DueDate: dueDate, ProjectID: it.ProjectID,
			Priority: priority, OriginType: "meeting", OriginID: &meetingOrigin,
		})
		if err != nil {
			return out, err
		}
		out = append(out, t)
	}
	payload, _ := json.Marshal(map[string]int{"count": len(out)})
	_ = s.writeAudit(ctx, s.q, m, "TASKS_CREATED_FROM_SUMMARY", userID, "", "", string(payload))
	return out, nil
}

// ---- Recording ---------------------------------------------------------------

func (s *MeetingService) RecordingEnabled(ctx context.Context) bool {
	return s.provider != nil && s.provider.Capabilities(ctx).Recording
}

// FileServiceEnabled reports whether the FileService path is wired.
func (s *MeetingService) FileServiceEnabled() bool { return s.files != nil }

// recordingWriteLease bounds the write target's validity. The egress uploads
// the object when the recording finalizes, not when it starts, so the lease
// must cover the longest plausible recording — a meeting can run well past
// its scheduled end inside autoEndOvertime.
const recordingWriteLease = 24 * time.Hour

func (s *MeetingService) StartRecording(ctx context.Context, userID, meetingID string) (db.MeetingRecording, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingRecording{}, err
	}
	if err := s.requireFeature(ctx, m, FeatureMeetingRecording); err != nil {
		return db.MeetingRecording{}, err
	}
	if !s.RecordingEnabled(ctx) {
		return db.MeetingRecording{}, coded(http.StatusServiceUnavailable, "recording_not_configured", "ghi hình chưa được cấu hình trên server")
	}
	if m.Status != MeetingInProgress {
		return db.MeetingRecording{}, errInvalidState()
	}
	if _, err := s.q.GetActiveMeetingRecording(ctx, meetingID); err == nil {
		return db.MeetingRecording{}, coded(http.StatusConflict, "recording_active", "cuộc họp đang được ghi hình")
	}
	recID := util.NewID()
	var target *meetings.RecordingOutputTarget
	var fileID pgtype.Text
	if s.files != nil {
		orgID, err := s.organizationOf(ctx, m)
		if err != nil {
			return db.MeetingRecording{}, err
		}
		// Reserve the file and the write target before the provider starts:
		// the egress id does not exist yet, so the recording row id doubles
		// as the provider operation identity and the webhook binds
		// egress_id -> row -> (file_id, operation id).
		po, err := s.files.RegisterProviderOutput(ctx, files.ProviderOutputInput{
			Actor:       Human(userID),
			Purpose:     files.MeetingRecording,
			Scope:       files.Scope{OrganizationID: orgID, WorkspaceID: m.WorkspaceID},
			OperationID: recID,
			Deadline:    time.Now().UTC().Add(recordingWriteLease),
		})
		if err != nil {
			return db.MeetingRecording{}, recordingFileErr("không bắt đầu ghi hình được", err)
		}
		target = &meetings.RecordingOutputTarget{
			URL: po.WriteTarget.URL, Method: po.WriteTarget.Method,
			Headers: po.WriteTarget.Headers, ExpiresAt: po.WriteTarget.ExpiresAt,
		}
		fileID = strText(string(po.FileID))
	}
	ref, err := s.provider.StartRecording(ctx, meetings.StartRecordingRequest{
		RoomName:     meetings.RoomNameForMeeting(meetingID),
		FilePrefix:   "meetings/" + m.WorkspaceID + "/" + meetingID,
		Layout:       "grid",
		OutputTarget: target,
	})
	if err != nil {
		if errors.Is(err, meetings.ErrRecordingOutputTarget) {
			return db.MeetingRecording{}, coded(http.StatusServiceUnavailable, "recording_not_configured", "ghi hình chưa được cấu hình trên server")
		}
		return db.MeetingRecording{}, coded(http.StatusBadGateway, "recording_failed", "không bắt đầu ghi hình được: "+err.Error())
	}
	// A provider started but the row insert failing leaves the intent pending
	// until the session expires; the reconciler collects it — the egress
	// writes an object nobody claims.
	rec, err := s.q.InsertMeetingRecording(ctx, db.InsertMeetingRecordingParams{
		ID: recID, MeetingID: meetingID, OrganizationID: m.OrganizationID, EgressID: ref.RecordingID, StartedBy: userID, FileID: fileID,
	})
	if err != nil {
		return db.MeetingRecording{}, err
	}
	_ = s.writeAudit(ctx, s.q, m, "RECORDING_STARTED", userID, "", rec.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.started", Payload: map[string]string{"meeting_id": meetingID}})
	return rec, nil
}

// recordingFileErr maps a FileService refusal on the recording path: storage
// or scope problems mean the deployment cannot take provider output, so the
// surface stays the capability error rather than a start failure.
func recordingFileErr(prefix string, err error) error {
	var fe *files.Error
	if errors.As(err, &fe) {
		switch fe.Code {
		case files.CodeScopeInvalid, files.CodePurposeDisabled, files.CodePurposeUnknown, files.CodeStorageUnavailable:
			return CodedError{Code: "recording_not_configured", Status: http.StatusServiceUnavailable, Msg: "ghi hình chưa được cấu hình trên server", Err: err}
		}
	}
	return CodedError{Code: "recording_failed", Status: http.StatusBadGateway, Msg: prefix + ": " + err.Error(), Err: err}
}

func (s *MeetingService) StopRecording(ctx context.Context, userID, meetingID string) (db.MeetingRecording, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.MeetingRecording{}, err
	}
	rec, err := s.stopActiveRecording(ctx, m, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingRecording{}, coded(http.StatusConflict, "recording_not_active", "không có bản ghi nào đang chạy")
	}
	return rec, err
}

// stopActiveRecording is shared by StopRecording and End. It marks the row
// PROCESSING; the provider webhook finishes it with the file URL.
func (s *MeetingService) stopActiveRecording(ctx context.Context, m db.Meeting, actorID string) (db.MeetingRecording, error) {
	active, err := s.q.GetActiveMeetingRecording(ctx, m.ID)
	if err != nil {
		return db.MeetingRecording{}, err
	}
	if s.provider != nil {
		if err := s.provider.StopRecording(ctx, meetings.StopRecordingRequest{RecordingID: active.EgressID}); err != nil {
			return db.MeetingRecording{}, coded(http.StatusBadGateway, "recording_failed", "không dừng ghi hình được: "+err.Error())
		}
	}
	rec, err := s.q.FinishMeetingRecording(ctx, db.FinishMeetingRecordingParams{ID: active.ID, Status: RecordingProcessing})
	if err != nil {
		return db.MeetingRecording{}, err
	}
	_ = s.writeAudit(ctx, s.q, m, "RECORDING_STOPPED", actorID, "", rec.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.stopped", Payload: map[string]string{"meeting_id": m.ID}})
	return rec, nil
}

func (s *MeetingService) Recordings(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingRecording, error) {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingRecordings(ctx, meetingID)
}

// GetMeetingRecordingForPlayback returns a completed recording the caller may stream.
func (s *MeetingService) GetMeetingRecordingForPlayback(
	ctx context.Context, userID, guestID, meetingID, recordingID string,
) (db.MeetingRecording, error) {
	recordingID = strings.TrimSpace(recordingID)
	if recordingID == "" {
		return db.MeetingRecording{}, Invalid("recording_id is required")
	}
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return db.MeetingRecording{}, err
	}
	rec, err := s.q.GetMeetingRecordingByID(ctx, db.GetMeetingRecordingByIDParams{
		ID: recordingID, MeetingID: meetingID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.MeetingRecording{}, ErrNotFound
		}
		return db.MeetingRecording{}, err
	}
	if rec.Status != RecordingComplete {
		return db.MeetingRecording{}, coded(http.StatusConflict, "recording_not_ready",
			"bản ghi chưa sẵn sàng")
	}
	if strings.TrimSpace(rec.FileUrl.String) == "" && strings.TrimSpace(rec.FileID.String) == "" {
		return db.MeetingRecording{}, ErrNotFound
	}
	return rec, nil
}

// finishRecordingFromProvider is called from HandleProviderEvent when the
// provider reports an egress ended.
func (s *MeetingService) finishRecordingFromProvider(ctx context.Context, ev ProviderNeutralEvent) {
	rec, err := s.q.GetMeetingRecordingByEgressID(ctx, ev.RecordingID)
	if err != nil {
		if s.Chat != nil {
			s.Chat.FinishVoiceRecordingByEgress(ctx, ev)
		}
		return
	}
	if strings.TrimSpace(rec.FileID.String) != "" {
		// The row was reserved through FileService. If the seam is unwired at
		// webhook time, leave it non-terminal and loud rather than writing a
		// legacy locator onto an FS row the claim would never see.
		if s.files == nil {
			slog.Error("recording finish dropped: FileService unwired for FS-backed row",
				"recording_id", rec.ID, "egress_id", ev.RecordingID)
			return
		}
		s.finishRecordingFileClaim(ctx, ev, rec)
		return
	}
	status := RecordingComplete
	if ev.RecordingFailed {
		status = RecordingFailed
	}
	updated, err := s.q.FinishRecordingByEgress(ctx, db.FinishRecordingByEgressParams{
		EgressID: ev.RecordingID, Status: status, FileUrl: strText(storage.NormalizeObjectURL(ev.RecordingURL)),
	})
	if err != nil {
		return
	}
	if m, err := s.q.GetMeeting(ctx, updated.MeetingID); err == nil {
		s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.ready", Payload: map[string]string{"meeting_id": m.ID}})
	}
}

// finishRecordingFileClaim finishes an FS-backed recording row: verify the
// object the egress uploaded, then claim the file and mark the row COMPLETE
// in one transaction so a halfway state is impossible. The locator lives on
// files.file_id; the webhook's file URL is never stored.
func (s *MeetingService) finishRecordingFileClaim(ctx context.Context, ev ProviderNeutralEvent, rec db.MeetingRecording) {
	m, err := s.q.GetMeeting(ctx, rec.MeetingID)
	if err != nil {
		return
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return
	}
	scope := files.Scope{OrganizationID: orgID, WorkspaceID: m.WorkspaceID}
	if ev.RecordingFailed {
		// The provider never delivered the object. Fail the row; the pending
		// output expires with its session and the collector removes it.
		// Publish only when the row actually transitioned — a duplicate
		// recording_ended re-delivery reaches here on a terminal row and must
		// not re-fire the event.
		if rec.Status == RecordingActive || rec.Status == RecordingProcessing {
			if _, err := s.q.FinishRecordingByEgress(ctx, db.FinishRecordingByEgressParams{
				EgressID: ev.RecordingID, Status: RecordingFailed,
			}); err == nil {
				s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.ready", Payload: map[string]string{"meeting_id": m.ID}})
			}
		}
		return
	}
	if rec.Status != RecordingActive && rec.Status != RecordingProcessing {
		return // terminal already — a replay is a no-op
	}
	if _, err := s.files.CompleteProviderOutput(ctx, files.CompleteOutputInput{
		Actor:       audit.System("livekit.egress"),
		Scope:       scope,
		FileID:      files.FileID(rec.FileID.String),
		OperationID: rec.ID,
	}); err != nil {
		// Retryable failures leave the row PROCESSING: storage_unavailable is
		// transient, and file_not_ready means the object is not visible yet —
		// a later provider event for the same egress finishes the job inside
		// the session lease. Every other refusal is permanent (wrong bytes,
		// over the cap, rejected type, expired or deleted file): fail the row.
		var fe *files.Error
		if !errors.As(err, &fe) || (fe.Code != files.CodeStorageUnavailable && fe.Code != files.CodeNotReady) {
			_, _ = s.q.FinishRecordingByEgress(ctx, db.FinishRecordingByEgressParams{
				EgressID: ev.RecordingID, Status: RecordingFailed,
			})
		}
		return
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor:   audit.System("livekit.egress"),
		Purpose: files.MeetingRecording,
		Scope:   scope,
		FileIDs: []files.FileID{files.FileID(rec.FileID.String)},
	}); err != nil {
		return
	}
	if _, err := q.FinishRecordingByEgress(ctx, db.FinishRecordingByEgressParams{
		EgressID: ev.RecordingID, Status: RecordingComplete,
	}); err != nil {
		return
	}
	_ = s.writeAudit(ctx, q, m, "RECORDING_COMPLETED", rec.StartedBy, "", rec.ID, "{}")
	if err := tx.Commit(ctx); err != nil {
		return
	}
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.ready", Payload: map[string]string{"meeting_id": m.ID}})
}

// ---- Recording playback (FileService path) ------------------------------------
//
// The purpose policy's read mode is presign: the browser plays the object
// directly off storage, and the proxy stream below exists for the range-aware
// fallback route. Handlers hold no files types; every method re-authorizes
// the caller itself so the permission check is never delegated to the caller.

// RecordingPlaybackURL is a presigned read target for an FS-backed
// recording.
type RecordingPlaybackURL struct {
	URL       string
	ExpiresAt time.Time
}

// recordingScope rebuilds the tenant scope a recording was claimed under. It
// must match the scope RegisterProviderOutput/ClaimInTx used, so it reads the
// meeting row rather than the caller's claims.
func (s *MeetingService) recordingScope(ctx context.Context, meetingID string) (files.Scope, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil {
		return files.Scope{}, err
	}
	orgID, err := s.organizationOf(ctx, m)
	if err != nil {
		return files.Scope{}, err
	}
	return files.Scope{OrganizationID: orgID, WorkspaceID: m.WorkspaceID}, nil
}

// ResolveMeetingRecordingPlaybackURL returns a presigned read URL for an
// FS-backed recording row.
func (s *MeetingService) ResolveMeetingRecordingPlaybackURL(ctx context.Context, userID, guestID, meetingID, recordingID string) (RecordingPlaybackURL, error) {
	rec, err := s.GetMeetingRecordingForPlayback(ctx, userID, guestID, meetingID, recordingID)
	if err != nil {
		return RecordingPlaybackURL{}, err
	}
	if strings.TrimSpace(rec.FileID.String) == "" {
		return RecordingPlaybackURL{}, ErrNotFound
	}
	scope, err := s.recordingScope(ctx, meetingID)
	if err != nil {
		return RecordingPlaybackURL{}, err
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       scope,
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(rec.FileID.String)},
	})
	if err != nil {
		return RecordingPlaybackURL{}, filesError(err)
	}
	if len(resolved) == 0 || resolved[0].Err != nil || resolved[0].URL == "" {
		if len(resolved) > 0 && resolved[0].Err != nil {
			return RecordingPlaybackURL{}, filesError(resolved[0].Err)
		}
		return RecordingPlaybackURL{}, ErrNotFound
	}
	return RecordingPlaybackURL{URL: resolved[0].URL, ExpiresAt: resolved[0].URLExpiresAt}, nil
}

// MeetingRecordingFileSize authorizes the caller and returns the byte size of
// an FS-backed recording, so the proxy route can do its own Range math.
func (s *MeetingService) MeetingRecordingFileSize(ctx context.Context, userID, guestID, meetingID, recordingID string) (int64, error) {
	rec, err := s.GetMeetingRecordingForPlayback(ctx, userID, guestID, meetingID, recordingID)
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(rec.FileID.String) == "" {
		return 0, ErrNotFound
	}
	scope, err := s.recordingScope(ctx, meetingID)
	if err != nil {
		return 0, err
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       scope,
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(rec.FileID.String)},
	})
	if err != nil {
		return 0, filesError(err)
	}
	if len(resolved) == 0 || resolved[0].Err != nil {
		if len(resolved) > 0 && resolved[0].Err != nil {
			return 0, filesError(resolved[0].Err)
		}
		return 0, ErrNotFound
	}
	return resolved[0].File.SizeBytes, nil
}

// OpenMeetingRecording streams bytes of an FS-backed recording for the
// authorized proxy route. Offset/Length mirror files.OpenInput — Length 0
// reads to the end.
func (s *MeetingService) OpenMeetingRecording(ctx context.Context, userID, guestID, meetingID, recordingID string, offset, length int64) (io.ReadCloser, error) {
	rec, err := s.GetMeetingRecordingForPlayback(ctx, userID, guestID, meetingID, recordingID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(rec.FileID.String) == "" {
		return nil, ErrNotFound
	}
	scope, err := s.recordingScope(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope: scope, FileID: files.FileID(rec.FileID.String), Offset: offset, Length: length,
	})
	if err != nil {
		return nil, filesError(err)
	}
	return r.Body, nil
}

// MeetingRecordingProvider is the FS-C1 section 6 reference provider for
// meeting_recordings.file_id: a live recording row holds its file.
type MeetingRecordingProvider struct{}

func (MeetingRecordingProvider) Name() string { return "meetings.recordings" }

func (MeetingRecordingProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.MeetingRecording}
}

func (MeetingRecordingProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListMeetingRecordingFileHolds(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, h := range held {
		if h.Valid && h.String != "" {
			out[files.FileID(h.String)] = files.HoldActive
		}
	}
	return out, nil
}

// FileReferenceProvider exposes the recording provider for the FileService
// registry.
func (s *MeetingService) FileReferenceProvider() files.ReferenceProvider {
	return MeetingRecordingProvider{}
}

// ---- Auto end ----------------------------------------------------------------

// AutoEndOverdue ends IN_PROGRESS meetings that are past ends_at with no
// ACTIVE conference, or still ACTIVE but past ends_at + autoEndOvertime.
// IDLE / PENDING / missing session count as empty.
func (s *MeetingService) AutoEndOverdue(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.q.ListOverdueInProgressMeetings(ctx, db.ListOverdueInProgressMeetingsParams{
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
		OvertimeCutoff: pgtype.Timestamptz{Time: now.Add(-autoEndOvertime), Valid: true},
	})
	if err != nil {
		return 0, err
	}
	n := 0
	for _, m := range rows {
		if _, err := s.endMeeting(ctx, m, systemActorID, "MEETING_AUTO_ENDED"); err == nil {
			n++
			s.count("auto_ended")
		}
	}
	return n, nil
}

// endIfOverdueEmpty ends an IN_PROGRESS meeting whose window has passed and
// whose conference is no longer ACTIVE. room_finished calls this so an empty
// overtime room does not wait for the next RunAutoEnd tick.
func (s *MeetingService) endIfOverdueEmpty(ctx context.Context, meetingID string) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil || m.Status != MeetingInProgress {
		return
	}
	if !meetingPastScheduledEnd(m, time.Now().UTC()) {
		return
	}
	if sess, err := s.q.GetOpenConferenceSession(ctx, meetingID); err == nil && sess.Status == "ACTIVE" {
		return
	}
	if _, err := s.endMeeting(ctx, m, systemActorID, "MEETING_AUTO_ENDED"); err == nil {
		s.count("auto_ended")
	}
}

func (s *MeetingService) RunAutoEnd(ctx context.Context) {
	t := time.NewTicker(autoEndInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_, _ = s.AutoEndOverdue(ctx, time.Now())
		}
	}
}

// ---- Calendar ----------------------------------------------------------------

// CalendarICS renders the meeting as an RFC 5545 VEVENT. Times are UTC so
// every client shows them in its own zone. frontendOrigin builds the join URL.
func (s *MeetingService) CalendarICS(ctx context.Context, userID, meetingID, frontendOrigin string) ([]byte, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	joinURL := ""
	if ws, err := s.q.GetWorkspaceWithOrg(ctx, m.WorkspaceID); err == nil && frontendOrigin != "" {
		joinURL = strings.TrimSuffix(frontendOrigin, "/") + "/" + ws.OrganizationSlug + "/" + ws.Slug + "/meetings/" + m.ID
	}
	return renderICS(m, joinURL, time.Now()), nil
}
