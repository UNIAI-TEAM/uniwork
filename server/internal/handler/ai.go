package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func toAiMessageDTO(m db.AiMessage) sdo.AiMessageDTO {
	var cites []service.AskCitation
	_ = json.Unmarshal([]byte(m.Citations), &cites)
	out := sdo.AiMessageDTO{ID: m.ID, Role: m.Role, Content: m.Content, Citations: citationDTOs(cites), Notice: m.Notice.String, CreatedAt: m.CreatedAt.Time.UTC().Format(time.RFC3339)}
	out.Steps, out.Followups, out.Mentions = []sdo.AiStepDTO{}, []string{}, []sdo.AiContextRefDTO{}
	// A column that is NULL or does not decode reads as empty, never an error.
	var steps []service.AskStep
	_ = json.Unmarshal([]byte(m.Steps), &steps)
	for _, st := range steps {
		counts := st.Counts
		if counts == nil {
			counts = map[string]int{}
		}
		out.Steps = append(out.Steps, sdo.AiStepDTO{Tool: st.Tool, Label: st.Label, Counts: counts})
	}
	_ = json.Unmarshal([]byte(m.Followups), &out.Followups)
	if out.Followups == nil {
		out.Followups = []string{}
	}
	var refs []service.AskContextRef
	_ = json.Unmarshal([]byte(m.Mentions), &refs)
	for _, r := range refs {
		out.Mentions = append(out.Mentions, sdo.AiContextRefDTO{Kind: r.Kind, ID: r.ID, Title: r.Title})
	}
	var focus service.AskContextRef
	if m.Focus.Valid && json.Unmarshal([]byte(m.Focus.String), &focus) == nil && focus.ID != "" {
		out.Focus = &sdo.AiContextRefDTO{Kind: focus.Kind, ID: focus.ID, Title: focus.Title}
	}
	return out
}

// citationDTOs is cites as the API names them; never nil.
func citationDTOs(cites []service.AskCitation) []sdo.AiCitationDTO {
	out := make([]sdo.AiCitationDTO, 0, len(cites))
	for _, c := range cites {
		out = append(out, sdo.AiCitationDTO{SourceID: c.SourceID, Quote: c.Quote, Kind: c.Kind, Title: c.Title, Href: c.Href, ObjectID: c.ObjectID})
	}
	return out
}

func (h *handlers) aiCapabilities(w http.ResponseWriter, r *http.Request) {
	c, err := h.AskUNI.Capabilities(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	models := make([]sdo.AiModelOptionDTO, 0, len(c.Models))
	for _, m := range c.Models {
		models = append(models, sdo.AiModelOptionDTO{Key: m.Key, Speed: m.Speed, Intelligence: m.Intelligence, Cost: m.Cost, Enabled: m.Enabled})
	}
	respondJSON(w, 200, sdo.AiCapabilitiesSDO{
		Enabled: c.Enabled, AskUni: c.AskUni, MeetingSummary: c.MeetingSummary,
		Quota:  sdo.AiQuotaDTO{UsedTokens: c.UsedTokens, LimitTokens: c.LimitTokens},
		Models: models, AutoModel: c.AutoModel,
	})
}

func (h *handlers) getOrgAskModels(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	keys, err := h.AskUNI.AskModels(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskModelsSDO{Models: keys})
}

func (h *handlers) setOrgAskModels(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.AskModelsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	// A body without models (or null) is a mistake, not "only Auto": that is
	// an explicit [] (ruling P21).
	if in.Models == nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "models is required; [] keeps only Auto")
		return
	}
	keys, err := h.AskUNI.SetAskModels(r.Context(), middleware.UserID(r.Context()), orgID, in.Models)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskModelsSDO{Models: keys})
}

// askInputFromSDI maps the body both ask routes share.
func askInputFromSDI(in sdi.AskUniSDI) service.AskInput {
	askIn := service.AskInput{ConversationID: in.ConversationID, Question: in.Question, Locale: in.Locale, Model: in.Model, Effort: in.Effort}
	if in.Focus != nil {
		askIn.Focus = &ai.Focus{Kind: in.Focus.Kind, ID: in.Focus.ID}
	}
	for _, m := range in.Mentions {
		askIn.Mentions = append(askIn.Mentions, ai.Focus{Kind: m.Kind, ID: m.ID})
	}
	return askIn
}

// refuseAsk answers an ask refused before any answer exists. The agent's busy
// and organization limits carry the seconds to wait in the error's fields;
// the shared mapping drops them (P13).
func (h *handlers) refuseAsk(w http.ResponseWriter, err error) {
	if retry, ok := uniworkRetryAfter(err); ok {
		w.Header().Set("Retry-After", retry)
	}
	h.mapServiceError(w, err)
}

func (h *handlers) askUni(w http.ResponseWriter, r *http.Request) {
	var in sdi.AskUniSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	askIn := askInputFromSDI(in)
	res, err := h.AskUNI.Ask(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), askIn)
	if err != nil {
		h.refuseAsk(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskUniSDO{
		ConversationID: res.ConversationID, Message: toAiMessageDTO(res.Message),
		Usage: sdo.AiUsageDTO{InputTokens: res.InputTokens, OutputTokens: res.OutputTokens},
	})
}

func (h *handlers) chatCatchUp(w http.ResponseWriter, r *http.Request) {
	var in sdi.ChatCatchUpSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	var since *time.Time
	if raw := strings.TrimSpace(in.Since); raw != "" {
		t, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "since must be RFC3339")
			return
		}
		since = &t
	}
	res, err := h.AskUNI.CatchUp(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), service.CatchUpInput{
		RoomID: in.RoomID, ThreadRootID: in.ThreadRootID, Locale: in.Locale, Since: since,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	items := make([]sdo.ChatCatchUpActionItemDTO, 0, len(res.ActionItems))
	for _, a := range res.ActionItems {
		items = append(items, sdo.ChatCatchUpActionItemDTO{
			Title: a.Title, Owner: a.Owner, Due: a.Due, SourceMessageID: a.SourceMessageID,
		})
	}
	highlights := make([]sdo.ChatCatchUpHighlightDTO, 0, len(res.HighlightItems))
	for _, hl := range res.HighlightItems {
		highlights = append(highlights, sdo.ChatCatchUpHighlightDTO{Text: hl.Text, SourceMessageID: hl.SourceMessageID})
	}
	respondJSON(w, 200, sdo.ChatCatchUpSDO{
		Summary: res.Summary, Highlights: res.Highlights, HighlightItems: highlights, ActionItems: items,
		MessageCount: res.MessageCount, Mode: res.Mode, Since: res.Since.UTC().Format(time.RFC3339),
		Usage: sdo.AiUsageDTO{InputTokens: res.InputTokens, OutputTokens: res.OutputTokens},
	})
}

func (h *handlers) listAiConversations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.AskUNI.ListConversations(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiConversationListSDO{Conversations: make([]sdo.AiConversationDTO, 0, len(rows))}
	for _, c := range rows {
		out.Conversations = append(out.Conversations, toAiConversationDTO(c))
	}
	respondJSON(w, 200, out)
}

func (h *handlers) listAiMessages(w http.ResponseWriter, r *http.Request) {
	rows, err := h.AskUNI.Messages(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiMessageListSDO{Messages: make([]sdo.AiMessageDTO, 0, len(rows))}
	for _, m := range rows {
		out.Messages = append(out.Messages, toAiMessageDTO(m))
	}
	respondJSON(w, 200, out)
}

func (h *handlers) deleteAiConversation(w http.ResponseWriter, r *http.Request) {
	if err := h.AskUNI.DeleteConversation(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func toAiConversationDTO(c db.AiConversation) sdo.AiConversationDTO {
	return sdo.AiConversationDTO{
		ID: c.ID, Title: c.Title, CreatedAt: c.CreatedAt.Time.UTC().Format(time.RFC3339), UpdatedAt: c.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
}

func (h *handlers) renameAiConversation(w http.ResponseWriter, r *http.Request) {
	var in sdi.AiRenameConversationSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.AskUNI.RenameConversation(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"), in.Title)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toAiConversationDTO(c))
}

func (h *handlers) setAiFeedback(w http.ResponseWriter, r *http.Request) {
	var in sdi.AiFeedbackSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	err := h.AskUNI.SetFeedback(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"), chi.URLParam(r, "messageID"),
		service.AskFeedbackInput{Rating: in.Rating, Reason: in.Reason, Note: in.Note})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) clearAiFeedback(w http.ResponseWriter, r *http.Request) {
	if err := h.AskUNI.ClearFeedback(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"), chi.URLParam(r, "messageID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func usageWindow(r *http.Request) (time.Time, time.Time) {
	parse := func(s string) time.Time {
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02", s); err == nil {
			return t
		}
		return time.Time{}
	}
	return parse(r.URL.Query().Get("from")), parse(r.URL.Query().Get("to"))
}

func (h *handlers) respondUsage(w http.ResponseWriter, sum service.AIUsageSummary) {
	out := sdo.AiUsageSDO{From: sum.From.UTC().Format(time.RFC3339), To: sum.To.UTC().Format(time.RFC3339), Rows: make([]sdo.AiUsageRowDTO, 0, len(sum.Rows))}
	for _, row := range sum.Rows {
		out.Rows = append(out.Rows, sdo.AiUsageRowDTO{
			Day: row.Day.UTC().Format("2006-01-02"), Capability: row.Capability, ActorKind: row.ActorKind, WorkspaceID: row.WorkspaceID,
			Calls: row.Calls, InputTokens: row.InputTokens, OutputTokens: row.OutputTokens, CostMicros: row.CostMicros,
		})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) workspaceAiUsage(w http.ResponseWriter, r *http.Request) {
	from, to := usageWindow(r)
	sum, err := h.AskUNI.WorkspaceUsage(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), from, to)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondUsage(w, sum)
}

func (h *handlers) organizationAiUsage(w http.ResponseWriter, r *http.Request) {
	from, to := usageWindow(r)
	sum, err := h.AskUNI.OrganizationUsage(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), from, to)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondUsage(w, sum)
}
