package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The shared microphone and its speaker labels (spec
// 2026-10-20-meeting-scribe-agent-design §4.3, §6.3, §7.2). A label key is
// "<participant identity>:<stt session>:<provider label>"; the agent sends
// "?" as the provider label for a line the vendor could not attribute.

const (
	speakerLabelUnknown = "?"
	speakerNameMax      = 120
)

// sharedMicAttributes is what a join token carries for the participant: the
// attribute only while they are the shared microphone.
func sharedMicAttributes(p db.MeetingParticipant) map[string]string {
	if !p.SharedMicAt.Valid {
		return nil
	}
	return map[string]string{meetings.AttrSharedMic: "1"}
}

// SetSharedMic marks or unmarks a participant as the room's shared
// microphone. A clerk's command, before or during the meeting. During it the
// LiveKit attribute is written after the commit; a failed write is logged,
// and the participant's next join token carries the attribute anyway.
func (s *MeetingService) SetSharedMic(ctx context.Context, actorID, meetingID, participantID string, enabled bool) (db.MeetingParticipant, error) {
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return db.MeetingParticipant{}, errInvalidState()
	}
	p, err := s.q.GetMeetingParticipant(ctx, participantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (p.MeetingID != meetingID || p.Status != ParticipantActive)) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	// The scribe would diarize the phone line and keep the caller's identity
	// in its speaker labels. Clearing stays allowed.
	if enabled && isDialInParticipant(p) {
		return db.MeetingParticipant{}, coded(http.StatusConflict, "shared_mic_dial_in", "người gọi điện thoại không làm micro hội trường được")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	up, err := q.SetParticipantSharedMic(ctx, db.SetParticipantSharedMicParams{ID: participantID, On: enabled, By: actorID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingParticipant{}, ErrNotFound
	}
	if err != nil {
		return db.MeetingParticipant{}, err
	}
	if p.SharedMicAt.Valid != up.SharedMicAt.Valid {
		s.recordAction(ctx, q, m, audit.User(actorID), audit.ActionMeetingSharedMicToggled, "participant.updated",
			meetingRelatedPayload(m, map[string]string{"participant_id": participantID}),
			audit.Diff(map[string]any{"participant_id": participantID, "shared_mic": p.SharedMicAt.Valid},
				map[string]any{"participant_id": participantID, "shared_mic": up.SharedMicAt.Valid}),
			"meeting", m.ID)
	}
	if err := tx.Commit(ctx); err != nil {
		return db.MeetingParticipant{}, err
	}
	// Written even when nothing changed: a click repairs an earlier failed write.
	if m.Status == MeetingInProgress && s.provider != nil {
		value := ""
		if enabled {
			value = "1"
		}
		cctx, cancel := context.WithTimeout(ctx, scribeCallTimeout)
		defer cancel()
		if err := s.provider.SetParticipantAttributes(cctx, meetings.SetParticipantAttributesRequest{
			RoomName: meetings.RoomNameForMeeting(m.ID), Identity: meetings.IdentityForParticipant(participantID),
			Attributes: map[string]string{meetings.AttrSharedMic: value},
		}); err != nil {
			slog.Warn("meeting shared mic: attribute not set", "meeting", m.ID, "participant", participantID, "err", err)
		}
	}
	return up, nil
}

// validSpeakerLabel: a label names the participant whose track it came from,
// so one participant's labels can never be filed under another's.
func validSpeakerLabel(label, identity string) bool {
	rest, ok := strings.CutPrefix(label, identity+":")
	if !ok || identity == "" {
		return false
	}
	session, provider, ok := strings.Cut(rest, ":")
	return ok && session != "" && provider != "" && !strings.Contains(provider, ":")
}

// insertSpeakerLabels files every new, attributable label of a batch as an
// unassigned row and reports whether any was new. q is the batch's
// transaction.
func (s *MeetingService) insertSpeakerLabels(ctx context.Context, q *db.Queries, m db.Meeting, segs []AgentSegmentInput) (bool, error) {
	created := false
	seen := map[string]bool{}
	for _, g := range segs {
		if g.SpeakerLabel == "" || seen[g.SpeakerLabel] || strings.HasSuffix(g.SpeakerLabel, ":"+speakerLabelUnknown) {
			continue
		}
		seen[g.SpeakerLabel] = true
		n, err := q.InsertMeetingSpeakerLabel(ctx, db.InsertMeetingSpeakerLabelParams{
			ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
			LabelKey: g.SpeakerLabel, CreatedBy: scribeActor.ID, CreatedByKind: string(scribeActor.Kind),
		})
		if err != nil {
			return false, err
		}
		created = created || n > 0
	}
	return created, nil
}

// emitSpeakerLabelsUpdated tells clients the label list changed without an
// audit row: the agent filing a new label is not a command anyone gave.
func (s *MeetingService) emitSpeakerLabelsUpdated(ctx context.Context, q *db.Queries, m db.Meeting) error {
	return auditRecorder.Emit(ctx, q, scribeActor, audit.Event{
		Topic: "speaker_label.updated", OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Payload: map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
	})
}

// SpeakerName is how one label of a meeting reads: its number in order of
// first appearance ("Người nói n", spec §4.3) and, once a clerk assigned it,
// the name. Numbers are per meeting, so the vendor's "A" of two STT sessions
// are two speakers.
type SpeakerName struct {
	Number int32
	Name   string
}

// TranscriptPage is a transcript page with the meeting's labels, so a client
// can word an unassigned room speaker in its own language.
type TranscriptPage struct {
	FeedPage[db.MeetingTranscriptSegment]
	Speakers map[string]SpeakerName
}

// speakerName is the name a transcript line shows (parent spec §7.3, this
// spec §4.3): the assigned name, else the shared microphone's numbered
// speaker, else "unknown" for an unattributed line; a line without a label
// keeps its participant's name. English for an "en" locale, else Vietnamese.
func speakerName(seg db.MeetingTranscriptSegment, speakers map[string]SpeakerName, locale string) string {
	if seg.SpeakerLabel == "" {
		return seg.SpeakerName
	}
	sp := speakers[seg.SpeakerLabel]
	en := strings.HasPrefix(locale, "en")
	switch {
	case sp.Name != "":
		return sp.Name
	case sp.Number > 0 && en:
		return fmt.Sprintf("Room · Speaker %d", sp.Number)
	case sp.Number > 0:
		return fmt.Sprintf("Hội trường · Người nói %d", sp.Number)
	case en:
		return "Room · Unknown"
	}
	return "Hội trường · Không rõ"
}

// nameSpeakers rewrites SpeakerName of labelled segments in place and returns
// the labels it used; a page without labels costs no query.
func (s *MeetingService) nameSpeakers(ctx context.Context, meetingID string, segs []db.MeetingTranscriptSegment, locale string) (map[string]SpeakerName, error) {
	labelled := false
	for _, g := range segs {
		if g.SpeakerLabel != "" {
			labelled = true
			break
		}
	}
	if !labelled {
		return nil, nil
	}
	rows, err := s.q.ListMeetingSpeakerNames(ctx, meetingID)
	if err != nil {
		return nil, err
	}
	speakers := make(map[string]SpeakerName, len(rows))
	for _, r := range rows {
		speakers[r.LabelKey] = SpeakerName{Number: r.Number, Name: r.Name}
	}
	for i := range segs {
		segs[i].SpeakerName = speakerName(segs[i], speakers, locale)
	}
	return speakers, nil
}

// SpeakerLabels lists the meeting's labels, assigned or not, for anyone who
// may read its transcript.
func (s *MeetingService) SpeakerLabels(ctx context.Context, userID, meetingID string) ([]db.ListMeetingSpeakerLabelsRow, error) {
	if _, _, err := s.authorize(ctx, userID, meetingID); err != nil {
		return nil, err
	}
	return s.q.ListMeetingSpeakerLabels(ctx, meetingID)
}

// AssignSpeakerLabel gives a label to a workspace member (someone tasks can
// be assigned to) or a free name; neither clears it. A clerk's command. It
// answers the label as SpeakerLabels lists it.
func (s *MeetingService) AssignSpeakerLabel(ctx context.Context, actorID, meetingID, labelID string, userID, name *string) (db.ListMeetingSpeakerLabelsRow, error) {
	uid, nm := "", ""
	if userID != nil {
		uid = strings.TrimSpace(*userID)
	}
	if name != nil {
		nm = strings.TrimSpace(*name)
	}
	if uid != "" && nm != "" {
		return db.ListMeetingSpeakerLabelsRow{}, Invalid("chỉ gán một trong user_id hoặc name")
	}
	if utf8.RuneCountInString(nm) > speakerNameMax {
		return db.ListMeetingSpeakerLabelsRow{}, Invalid("name tối đa 120 ký tự")
	}
	m, err := s.requireMeetingClerk(ctx, actorID, meetingID)
	if err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	if uid != "" {
		if _, err := s.ws.RequireMember(ctx, m.WorkspaceID, uid); err != nil {
			if errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrOrganizationDeletionScheduled) {
				return db.ListMeetingSpeakerLabelsRow{}, err
			}
			return db.ListMeetingSpeakerLabelsRow{}, coded(http.StatusUnprocessableEntity, "assignee_not_member", "người được gán không phải thành viên workspace")
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	// The row as it stands under the lock: the audit diff never compares
	// against a copy a concurrent assignment already replaced.
	l, err := q.LockMeetingSpeakerLabel(ctx, db.LockMeetingSpeakerLabelParams{ID: labelID, MeetingID: m.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ListMeetingSpeakerLabelsRow{}, ErrNotFound
	}
	if err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	// A label of a superseded upload run is hidden (UNI-2001): refuse it
	// before any write, as if it did not exist.
	if _, err := speakerLabelView(ctx, q, m.ID, l.ID); err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	up, err := q.AssignMeetingSpeakerLabel(ctx, db.AssignMeetingSpeakerLabelParams{
		ID: l.ID, UserID: pgtype.Text{String: uid, Valid: uid != ""}, Name: nm,
	})
	if err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	if l.UserID != up.UserID || l.Name != up.Name {
		s.recordResource(ctx, q, m, audit.User(actorID), "speaker_label.updated",
			map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
			audit.Diff(map[string]any{"user_id": l.UserID.String, "name": l.Name}, map[string]any{"user_id": up.UserID.String, "name": up.Name}),
			"meeting_speaker_label", l.ID)
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	return speakerLabelView(ctx, s.q, m.ID, up.ID)
}

// speakerLabelView is one row of the meeting's label list; ErrNotFound when
// the list does not show it (a superseded upload run's label).
func speakerLabelView(ctx context.Context, q *db.Queries, meetingID, id string) (db.ListMeetingSpeakerLabelsRow, error) {
	rows, err := q.ListMeetingSpeakerLabels(ctx, meetingID)
	if err != nil {
		return db.ListMeetingSpeakerLabelsRow{}, err
	}
	for _, r := range rows {
		if r.ID == id {
			return r, nil
		}
	}
	return db.ListMeetingSpeakerLabelsRow{}, ErrNotFound
}
