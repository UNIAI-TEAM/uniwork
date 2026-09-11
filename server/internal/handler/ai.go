package handler

import (
	"encoding/json"
	"net/http"
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
	out := sdo.AiMessageDTO{ID: m.ID, Role: m.Role, Content: m.Content, Citations: make([]sdo.AiCitationDTO, 0, len(cites)), CreatedAt: m.CreatedAt.Time.UTC().Format(time.RFC3339)}
	for _, c := range cites {
		out.Citations = append(out.Citations, sdo.AiCitationDTO{SourceID: c.SourceID, Quote: c.Quote, Kind: c.Kind, Title: c.Title, Href: c.Href})
	}
	return out
}

func (h *handlers) aiCapabilities(w http.ResponseWriter, r *http.Request) {
	c, err := h.AskUNI.Capabilities(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AiCapabilitiesSDO{
		Enabled: c.Enabled, AskUni: c.AskUni, MeetingSummary: c.MeetingSummary,
		Quota: sdo.AiQuotaDTO{UsedTokens: c.UsedTokens, LimitTokens: c.LimitTokens},
	})
}

func (h *handlers) askUni(w http.ResponseWriter, r *http.Request) {
	var in sdi.AskUniSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	askIn := service.AskInput{ConversationID: in.ConversationID, Question: in.Question, Locale: in.Locale}
	if in.Focus != nil {
		askIn.Focus = &ai.Focus{Kind: in.Focus.Kind, ID: in.Focus.ID}
	}
	res, err := h.AskUNI.Ask(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), askIn)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskUniSDO{
		ConversationID: res.ConversationID, Message: toAiMessageDTO(res.Message),
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
		out.Conversations = append(out.Conversations, sdo.AiConversationDTO{
			ID: c.ID, Title: c.Title, CreatedAt: c.CreatedAt.Time.UTC().Format(time.RFC3339), UpdatedAt: c.UpdatedAt.Time.UTC().Format(time.RFC3339),
		})
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
