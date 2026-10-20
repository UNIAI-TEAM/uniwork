package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The agent API (spec 2026-10-20-meeting-scribe-agent-design §7.1): the
// scribe agent's only way into the server (ADR 0036). Every call carries the
// claims of a verified uwma_ token; the meeting, its organization and the run
// must all match them, or the answer is 404 like for any id one may not see.

const (
	agentSegmentsMax     = 50
	agentSegmentRunes    = 4000
	agentSegmentIDMax    = 128
	agentIdentityMax     = 128
	agentLanguageMax     = 16
	agentSpeakerLabelMax = 120
	agentSpeechMaxMs     = 10 * 60 * 1000
	// An ended meeting still takes the agent's last batches this long (§4.1).
	agentDrainWindow  = 10 * time.Minute
	agentContextNames = 200
)

// AgentSegmentInput is one final segment as the agent sends it.
type AgentSegmentInput struct {
	SegmentID           string
	ParticipantIdentity string
	SpokenAt, EndedAt   time.Time
	SpeechMs            int64
	Text                string
	Language            string
	SpeakerLabel        string
}

// ScribeContext is what the agent turns into STT keyterms (§4.2): names and
// titles of this meeting only, never an email.
type ScribeContext struct {
	MeetingTitle        string
	WorkspaceName       string
	ProjectName         string
	Locale              string
	ParticipantNames    []string
	SharedMicIdentities []string
}

func (s *MeetingService) agentRun(ctx context.Context, c meetings.AgentClaims) (db.Meeting, db.MeetingScribeRun, error) {
	m, err := s.q.GetMeeting(ctx, c.MeetingID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && m.OrganizationID != c.OrganizationID) {
		return db.Meeting{}, db.MeetingScribeRun{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, db.MeetingScribeRun{}, err
	}
	r, err := s.q.GetScribeRun(ctx, c.RunID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && r.MeetingID != m.ID) {
		return db.Meeting{}, db.MeetingScribeRun{}, ErrNotFound
	}
	if err != nil {
		return db.Meeting{}, db.MeetingScribeRun{}, err
	}
	return m, r, nil
}

// AgentStarted marks the run ACTIVE. A run already closed answers 409: the
// agent was removed (switched off, failed, room emptied) and should leave.
func (s *MeetingService) AgentStarted(ctx context.Context, c meetings.AgentClaims) error {
	m, run, err := s.agentRun(ctx, c)
	if err != nil {
		return err
	}
	r, err := s.q.StartScribeRun(ctx, run.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errInvalidState()
	}
	if err != nil {
		return err
	}
	if run.Status != r.Status {
		s.count("scribe_active")
		s.emitScribeUpdated(ctx, m)
	}
	return nil
}

// AgentContext answers GET /agent/context.
func (s *MeetingService) AgentContext(ctx context.Context, c meetings.AgentClaims) (ScribeContext, error) {
	m, _, err := s.agentRun(ctx, c)
	if err != nil {
		return ScribeContext{}, err
	}
	out := ScribeContext{MeetingTitle: m.Title, Locale: scribeLocale, ParticipantNames: []string{}, SharedMicIdentities: []string{}}
	if w, err := s.q.GetWorkspaceByID(ctx, m.WorkspaceID); err == nil {
		out.WorkspaceName = w.Name
	}
	if m.ProjectID.Valid {
		if p, err := s.q.GetProject(ctx, db.GetProjectParams{ID: m.ProjectID.String, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID}); err == nil {
			out.ProjectName = p.Title
		}
	}
	ps, err := s.q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return ScribeContext{}, err
	}
	seen := map[string]bool{}
	for _, p := range ps {
		name := strings.TrimSpace(p.DisplayNameSnapshot)
		if name == "" || seen[name] || p.Status != ParticipantActive || len(out.ParticipantNames) >= agentContextNames {
			continue
		}
		seen[name] = true
		out.ParticipantNames = append(out.ParticipantNames, name)
	}
	return out, nil
}

func validateAgentSegments(segs []AgentSegmentInput) error {
	if len(segs) == 0 || len(segs) > agentSegmentsMax {
		return Invalid("cần từ 1 đến 50 đoạn")
	}
	for i := range segs {
		g := &segs[i]
		g.SegmentID = strings.TrimSpace(g.SegmentID)
		g.Text = strings.TrimSpace(g.Text)
		switch {
		case g.SegmentID == "" || len(g.SegmentID) > agentSegmentIDMax:
			return Invalid("segment_id không hợp lệ")
		case g.Text == "" || utf8.RuneCountInString(g.Text) > agentSegmentRunes:
			return Invalid("text phải có từ 1 đến 4000 ký tự")
		case len(g.ParticipantIdentity) > agentIdentityMax || len(g.Language) > agentLanguageMax || utf8.RuneCountInString(g.SpeakerLabel) > agentSpeakerLabelMax:
			return Invalid("participant_identity, language hoặc speaker_label quá dài")
		case g.SpokenAt.IsZero() || g.EndedAt.Before(g.SpokenAt):
			return Invalid("spoken_at/ended_at không hợp lệ")
		case g.SpeechMs < 0 || g.SpeechMs > agentSpeechMaxMs:
			return Invalid("speech_ms không hợp lệ")
		}
	}
	return nil
}

// msSince is the offset of t from the meeting's actual start, never negative.
func msSince(start pgtype.Timestamptz, t time.Time) pgtype.Int4 {
	if !start.Valid {
		return pgtype.Int4{}
	}
	d := t.Sub(start.Time).Milliseconds()
	if d < 0 {
		d = 0
	}
	if d > 1<<31-1 {
		d = 1<<31 - 1
	}
	return pgtype.Int4{Int32: int32(d), Valid: true}
}

// AppendAgentSegments stores a batch of final segments (§4.1): each once per
// (meeting, segment_id), timed from the actual start, its speech added to the
// run and metered. Accepted while the meeting is in progress and for ten
// minutes after it ended, so the agent can flush. It returns how many were
// new and how many the server already had.
func (s *MeetingService) AppendAgentSegments(ctx context.Context, c meetings.AgentClaims, segs []AgentSegmentInput) (accepted, duplicates int, err error) {
	if err := validateAgentSegments(segs); err != nil {
		return 0, 0, err
	}
	m, run, err := s.agentRun(ctx, c)
	if err != nil {
		return 0, 0, err
	}
	draining := m.Status == MeetingEnded && m.ActualEndAt.Valid && time.Since(m.ActualEndAt.Time) <= agentDrainWindow
	if m.Status != MeetingInProgress && !draining {
		return 0, 0, errInvalidState()
	}
	ps, err := s.q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return 0, 0, err
	}
	byIdentity := make(map[string]db.MeetingParticipant, len(ps))
	for _, p := range ps {
		byIdentity[meetings.IdentityForParticipant(p.ID)] = p
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	var speech int64
	for _, g := range segs {
		pid, speaker := pgtype.Text{}, g.ParticipantIdentity
		if p, ok := byIdentity[g.ParticipantIdentity]; ok {
			pid, speaker = strText(p.ID), p.DisplayNameSnapshot
		}
		_, err := q.InsertAgentTranscriptSegment(ctx, db.InsertAgentTranscriptSegmentParams{
			ID: util.NewID(), MeetingID: m.ID, OrganizationID: m.OrganizationID, ParticipantID: pid,
			SpeakerName: speaker, Text: g.Text, SpokenAt: pgtype.Timestamptz{Time: g.SpokenAt, Valid: true},
			StartMs: msSince(m.ActualStartAt, g.SpokenAt), EndMs: msSince(m.ActualStartAt, g.EndedAt),
			SpeakerLabel: g.SpeakerLabel, ClientSegmentID: strText(g.SegmentID), Language: g.Language,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			duplicates++
			continue
		}
		if err != nil {
			return 0, 0, err
		}
		accepted++
		speech += g.SpeechMs
	}
	if accepted > 0 {
		r, err := q.AddScribeRunSpeech(ctx, db.AddScribeRunSpeechParams{ID: run.ID, SpeechMs: speech, Segments: int32(accepted)})
		if err != nil {
			return 0, 0, err
		}
		if err := s.meterScribeRun(ctx, q, r); err != nil {
			return 0, 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	if accepted > 0 {
		s.pub.Publish(ctx, m.WorkspaceID, Event{Type: "transcript.appended", Payload: map[string]string{"meeting_id": m.ID}})
	}
	return accepted, duplicates, nil
}

// AgentFinished closes the run (the room emptied or the meeting ended) and
// meters its last seconds. A run already closed only records the vendor
// session time the agent measured.
func (s *MeetingService) AgentFinished(ctx context.Context, c meetings.AgentClaims, sttSessionMs int64) error {
	if sttSessionMs < 0 {
		return Invalid("stt_session_ms không hợp lệ")
	}
	m, run, err := s.agentRun(ctx, c)
	if err != nil {
		return err
	}
	r, err := s.q.FinishScribeRun(ctx, db.FinishScribeRunParams{ID: run.ID, SttSessionMs: sttSessionMs})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.q.AddScribeRunSessionTime(ctx, db.AddScribeRunSessionTimeParams{ID: run.ID, SttSessionMs: sttSessionMs})
	}
	if err != nil {
		return err
	}
	if err := s.meterScribeRunTx(ctx, r); err != nil {
		return err
	}
	s.emitScribeUpdated(ctx, m)
	return nil
}
