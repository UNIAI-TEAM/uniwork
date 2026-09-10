package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/sync/errgroup"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/meetings"
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
		ID: util.NewID(), MeetingID: meetingID, ParticipantID: pid, SpeakerName: speaker, Text: text,
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
		ID: util.NewID(), MeetingID: meetingID, ParticipantID: pid, SpeakerName: speaker, Text: text,
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

// Summarize gathers transcript + notes, asks the gateway (capability
// meeting_summarization) and stores the result with the usage row that paid
// for it. Any host/admin may re-run it; the latest row wins.
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
	if err := g.Wait(); err != nil {
		return db.MeetingSummary{}, err
	}
	if len(segs) == 0 && len(notes) == 0 && len(chat) == 0 {
		return db.MeetingSummary{}, coded(http.StatusConflict, "nothing_to_summarize", "chưa có transcript hay ghi chú nào để tóm tắt")
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
		Vars: map[string]any{"title": m.Title, "agenda": m.Description, "locale": locale, "transcript": transcript, "notes": noteBodies, "chat": chatLines},
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
		ID: util.NewID(), MeetingID: meetingID, Summary: res.Summary,
		Decisions: string(decisions), ActionItems: string(items), Model: resp.Model, CreatedBy: userID,
		UsageEventID: strText(resp.UsageEventID),
	})
	if err != nil {
		return db.MeetingSummary{}, err
	}
	s.count("summary_ok")
	_ = s.writeAudit(ctx, s.q, meetingID, "SUMMARY_CREATED", userID, "", row.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "summary.created", Payload: map[string]string{"meeting_id": meetingID}})
	return row, nil
}

type SummaryTaskItem struct {
	Title       string
	Description string
	AssigneeID  *string
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
		t, err := s.Tasks.Create(ctx, Human(userID), m.WorkspaceID, CreateTaskInput{
			Title: it.Title, Description: desc, AssigneeID: assigneeID, DueDate: dueDate,
			OriginType: "meeting", OriginID: &meetingOrigin,
		})
		if err != nil {
			return out, err
		}
		out = append(out, t)
	}
	payload, _ := json.Marshal(map[string]int{"count": len(out)})
	_ = s.writeAudit(ctx, s.q, meetingID, "TASKS_CREATED_FROM_SUMMARY", userID, "", "", string(payload))
	return out, nil
}

// ---- Recording ---------------------------------------------------------------

func (s *MeetingService) RecordingEnabled(ctx context.Context) bool {
	return s.provider != nil && s.provider.Capabilities(ctx).Recording
}

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
	ref, err := s.provider.StartRecording(ctx, meetings.StartRecordingRequest{
		RoomName:   meetings.RoomNameForMeeting(meetingID),
		FilePrefix: "meetings/" + m.WorkspaceID + "/" + meetingID,
	})
	if err != nil {
		return db.MeetingRecording{}, coded(http.StatusBadGateway, "recording_failed", "không bắt đầu ghi hình được: "+err.Error())
	}
	rec, err := s.q.InsertMeetingRecording(ctx, db.InsertMeetingRecordingParams{
		ID: util.NewID(), MeetingID: meetingID, EgressID: ref.RecordingID, StartedBy: userID,
	})
	if err != nil {
		return db.MeetingRecording{}, err
	}
	_ = s.writeAudit(ctx, s.q, meetingID, "RECORDING_STARTED", userID, "", rec.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.started", Payload: map[string]string{"meeting_id": meetingID}})
	return rec, nil
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
	_ = s.writeAudit(ctx, s.q, m.ID, "RECORDING_STOPPED", actorID, "", rec.ID, "{}")
	s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.stopped", Payload: map[string]string{"meeting_id": m.ID}})
	return rec, nil
}

func (s *MeetingService) Recordings(ctx context.Context, userID, guestID, meetingID string) ([]db.MeetingRecording, error) {
	if _, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingRecordings(ctx, meetingID)
}

// finishRecordingFromProvider is called from HandleProviderEvent when the
// provider reports an egress ended.
func (s *MeetingService) finishRecordingFromProvider(ctx context.Context, ev ProviderNeutralEvent) {
	status := RecordingComplete
	if ev.RecordingFailed {
		status = RecordingFailed
	}
	rec, err := s.q.FinishRecordingByEgress(ctx, db.FinishRecordingByEgressParams{
		EgressID: ev.RecordingID, Status: status, FileUrl: strText(ev.RecordingURL),
	})
	if err != nil {
		return
	}
	if m, err := s.q.GetMeeting(ctx, rec.MeetingID); err == nil {
		s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "recording.ready", Payload: map[string]string{"meeting_id": m.ID}})
	}
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
		if _, err := s.endMeeting(ctx, m, "system", "MEETING_AUTO_ENDED"); err == nil {
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
	if _, err := s.endMeeting(ctx, m, "system", "MEETING_AUTO_ENDED"); err == nil {
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

func icsTime(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

// icsEscape follows RFC 5545 §3.3.11: backslash, semicolon, comma, newline.
func icsEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`)
	return r.Replace(s)
}

func renderICS(m db.Meeting, joinURL string, now time.Time) []byte {
	var b strings.Builder
	w := func(line string) { b.WriteString(line); b.WriteString("\r\n") }
	w("BEGIN:VCALENDAR")
	w("VERSION:2.0")
	w("PRODID:-//UniWork//Meetings//VI")
	w("METHOD:PUBLISH")
	w("BEGIN:VEVENT")
	w("UID:" + m.ID + "@uniwork")
	w("DTSTAMP:" + icsTime(now))
	w("DTSTART:" + icsTime(m.StartsAt.Time))
	w("DTEND:" + icsTime(m.EndsAt.Time))
	w("SUMMARY:" + icsEscape(m.Title))
	desc := m.Description
	if joinURL != "" {
		if desc != "" {
			desc += "\n\n"
		}
		desc += joinURL
		w("URL:" + joinURL)
	}
	if desc != "" {
		w("DESCRIPTION:" + icsEscape(desc))
	}
	status := "CONFIRMED"
	if m.Status == MeetingCanceled {
		status = "CANCELLED"
	}
	w("STATUS:" + status)
	w(fmt.Sprintf("SEQUENCE:%d", m.Version))
	w("END:VEVENT")
	w("END:VCALENDAR")
	return []byte(b.String())
}
