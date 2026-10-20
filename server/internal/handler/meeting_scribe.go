package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// agentSegmentsBody caps a batch: 50 segments of at most 4,000 characters,
// up to 4 bytes each, plus their fields.
const agentSegmentsBody = 1 << 20

// The scribe agent's routes (spec 2026-10-20-meeting-scribe-agent-design
// §7.1). RequireMeetingAgentToken already proved the token names this
// meeting; the service checks its organization and run.

func (h *handlers) meetingAgentStarted(w http.ResponseWriter, r *http.Request) {
	var in sdi.AgentStartedSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.AgentStarted(r.Context(), middleware.MeetingAgentClaims(r.Context()), in.ParticipantSID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) meetingAgentContext(w http.ResponseWriter, r *http.Request) {
	c, err := h.Meetings.AgentContext(r.Context(), middleware.MeetingAgentClaims(r.Context()))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingAgentContextSDO{
		MeetingTitle: c.MeetingTitle, WorkspaceName: c.WorkspaceName, ProjectName: c.ProjectName,
		Locale: c.Locale, ParticipantNames: c.ParticipantNames, SharedMicIdentities: c.SharedMicIdentities,
	})
}

func (h *handlers) meetingAgentSegments(w http.ResponseWriter, r *http.Request) {
	var in sdi.AppendAgentSegmentsSDI
	if !decode(w, r, &in, agentSegmentsBody) {
		return
	}
	segs := make([]service.AgentSegmentInput, len(in.Segments))
	for i, g := range in.Segments {
		segs[i] = service.AgentSegmentInput{
			SegmentID: g.SegmentID, ParticipantIdentity: g.ParticipantIdentity, SpokenAt: g.SpokenAt, EndedAt: g.EndedAt,
			SpeechMs: g.SpeechMs, Text: g.Text, Language: g.Language, SpeakerLabel: g.SpeakerLabel,
		}
	}
	accepted, dup, err := h.Meetings.AppendAgentSegments(r.Context(), middleware.MeetingAgentClaims(r.Context()), segs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingAgentSegmentsSDO{Accepted: accepted, Duplicates: dup})
}

func (h *handlers) meetingAgentFinished(w http.ResponseWriter, r *http.Request) {
	var in sdi.AgentFinishedSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.AgentFinished(r.Context(), middleware.MeetingAgentClaims(r.Context()), in.SttSessionMs); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) setMeetingScribe(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetMeetingScribeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.SetScribe(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Enabled)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	d := toMeetingDTO(m)
	d.ScribeStatus = h.Meetings.ScribeStatus(r.Context(), m.ID)
	respondJSON(w, 200, sdo.MeetingSDO{Meeting: d})
}

func (h *handlers) setParticipantSharedMic(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetSharedMicSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.Meetings.SetSharedMic(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "participantID"), in.Enabled)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ParticipantSDO{Participant: toParticipantDTO(p, false)})
}

func toSpeakerLabelDTO(l db.ListMeetingSpeakerLabelsRow) sdo.SpeakerLabelDTO {
	assigned := l.Name
	if l.UserID.Valid {
		assigned = l.UserName
	}
	return sdo.SpeakerLabelDTO{
		ID: l.ID, LabelKey: l.LabelKey, Speaker: l.LabelKey[strings.LastIndex(l.LabelKey, ":")+1:],
		UserID: l.UserID.String, Name: l.Name, AssignedName: assigned, Sample: l.Sample,
		FirstSpokenAt: rfc3339(l.FirstSpokenAt),
	}
}

func (h *handlers) listSpeakerLabels(w http.ResponseWriter, r *http.Request) {
	ls, err := h.Meetings.SpeakerLabels(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.SpeakerLabelDTO, 0, len(ls))
	for _, l := range ls {
		out = append(out, toSpeakerLabelDTO(l))
	}
	respondJSON(w, 200, sdo.SpeakerLabelListSDO{Labels: out})
}

func (h *handlers) assignSpeakerLabel(w http.ResponseWriter, r *http.Request) {
	var in sdi.AssignSpeakerLabelSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	l, err := h.Meetings.AssignSpeakerLabel(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "meetingID"), chi.URLParam(r, "speakerLabelID"), in.UserID, in.Name)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.SpeakerLabelSDO{Label: toSpeakerLabelDTO(l)})
}
