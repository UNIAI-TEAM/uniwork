package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The HTTP face of Ask UNI's proposals (ADR 0044, R17). Every decision is the
// asker's: the service reads the row as them and answers 404 for a row that is
// not theirs. A row whose command failed is a 409 carrying the row's code and
// the row itself, so a card repaints from the answer; that is told apart from
// a refusal (404, 403, 429, 409 before the command ran), which carries no row.

func contextRefDTO(r service.AskContextRef) sdo.AiContextRefDTO {
	return sdo.AiContextRefDTO{Kind: r.Kind, ID: r.ID, Title: r.Title}
}

func toAiProposalDTO(p service.AskProposal) sdo.AiProposalDTO {
	fields := make([]sdo.AiProposalFieldDTO, 0, len(p.Preview.Fields))
	for _, f := range p.Preview.Fields {
		fields = append(fields, sdo.AiProposalFieldDTO{Field: f.Field, Type: f.Type, From: f.From, To: f.To, Options: f.Options})
	}
	notifies := make([]sdo.AiContextRefDTO, 0, len(p.Preview.Audience.Notifies))
	for _, n := range p.Preview.Audience.Notifies {
		notifies = append(notifies, contextRefDTO(n))
	}
	refs := p.Preview.Refs
	if refs == nil {
		refs = []int{}
	}
	changes := make([]sdo.AiProposalChangeDTO, 0, len(p.Result.Changes))
	for _, c := range p.Result.Changes {
		changes = append(changes, sdo.AiProposalChangeDTO{Field: c.Field, From: c.From, To: c.To})
	}
	return sdo.AiProposalDTO{
		ID: p.ID, MessageID: p.MessageID, Position: p.Position, Tool: p.Tool, Level: p.Level, Mode: p.Mode,
		Status: p.Status, Decision: p.Decision, CanUndo: p.CanUndo, ErrorCode: p.ErrorCode, Tainted: p.Tainted,
		ExpiresAt: p.ExpiresAt.UTC().Format(time.RFC3339),
		Preview: sdo.AiProposalPreviewDTO{
			Target: contextRefDTO(p.Preview.Target), Fields: fields, Body: p.Preview.Body, Refs: refs,
			Audience: sdo.AiProposalAudienceDTO{
				Visibility: p.Preview.Audience.Visibility, RoomMembers: p.Preview.Audience.RoomMembers,
				Notifies: notifies, NotifiesMore: p.Preview.Audience.NotifiesMore,
			},
		},
		Result: sdo.AiProposalResultDTO{ObjectID: p.Result.ObjectID, Href: p.Result.Href, Revision: p.Result.Revision, Changes: changes, Note: p.Result.Note},
	}
}

func aiProposalDTOs(ps []service.AskProposal) []sdo.AiProposalDTO {
	out := make([]sdo.AiProposalDTO, 0, len(ps))
	for _, p := range ps {
		out = append(out, toAiProposalDTO(p))
	}
	return out
}

// proposalFailure answers err of a call that also returned rows. A failed row
// is 409 with its own code and the rows in error.fields (key names the
// payload); any other error is the shared mapping, with no row.
func (h *handlers) proposalFailure(w http.ResponseWriter, err error, key string, payload any, failed *service.AskProposal) {
	if failed != nil && failed.Status == "failed" && failed.ErrorCode != "" {
		respondErrorFields(w, http.StatusConflict, failed.ErrorCode, "proposal failed", map[string]any{key: payload})
		return
	}
	h.mapServiceError(w, err)
}

func (h *handlers) proposalAnswer(w http.ResponseWriter, p service.AskProposal, err error) {
	if err != nil {
		h.proposalFailure(w, err, "proposal", toAiProposalDTO(p), &p)
		return
	}
	respondJSON(w, 200, toAiProposalDTO(p))
}

func (h *handlers) applyAiProposal(w http.ResponseWriter, r *http.Request) {
	p, err := h.AskUNI.ApplyProposal(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "proposalID"))
	h.proposalAnswer(w, p, err)
}

func (h *handlers) rejectAiProposal(w http.ResponseWriter, r *http.Request) {
	p, err := h.AskUNI.RejectProposal(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "proposalID"))
	h.proposalAnswer(w, p, err)
}

func (h *handlers) undoAiProposal(w http.ResponseWriter, r *http.Request) {
	p, err := h.AskUNI.UndoProposal(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "proposalID"))
	h.proposalAnswer(w, p, err)
}

func (h *handlers) editAiProposal(w http.ResponseWriter, r *http.Request) {
	var in sdi.AiProposalEditSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.AskUNI.EditProposal(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "proposalID"), in.Changes)
	h.proposalAnswer(w, p, err)
}

func (h *handlers) applyAiMessageProposals(w http.ResponseWriter, r *http.Request) {
	var in sdi.AiApplyProposalsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if len(in.ProposalIDs) > 10 {
		respondError(w, http.StatusBadRequest, "invalid_request", "proposal_ids has more than 10 rows")
		return
	}
	ps, err := h.AskUNI.ApplyMessageProposals(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"), chi.URLParam(r, "messageID"), in.ProposalIDs)
	if err != nil {
		var failed *service.AskProposal
		for i := range ps {
			if ps[i].Status == "failed" {
				failed = &ps[i]
				break
			}
		}
		h.proposalFailure(w, err, "proposals", aiProposalDTOs(ps), failed)
		return
	}
	respondJSON(w, 200, sdo.AiProposalListSDO{Proposals: aiProposalDTOs(ps)})
}

func (h *handlers) saveAiAnswerAsDocument(w http.ResponseWriter, r *http.Request) {
	p, err := h.AskUNI.SaveAnswerAsDocument(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "conversationID"), chi.URLParam(r, "messageID"))
	h.proposalAnswer(w, p, err)
}

// refuseAskActionsOff is the kill switch (R2) for the routes that name no
// proposal; the proposal routes get it from the service's shared gate.
func (h *handlers) refuseAskActionsOff(w http.ResponseWriter, r *http.Request, orgID string) bool {
	if h.AskUNI.AskActionsEnabled(r.Context(), middleware.UserID(r.Context()), orgID) {
		return false
	}
	respondError(w, http.StatusForbidden, "ai_actions_disabled", "Ask UNI actions are off")
	return true
}

func (h *handlers) setAskUniMode(w http.ResponseWriter, r *http.Request) {
	var in sdi.AskUniModeSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if h.refuseAskActionsOff(w, r, "") {
		return
	}
	mode, err := h.AskUNI.SetAskUniMode(r.Context(), middleware.UserID(r.Context()), in.Mode)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskUniModeSDO{Mode: mode})
}

func (h *handlers) getOrgAskWritePolicy(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	if h.refuseAskActionsOff(w, r, orgID) {
		return
	}
	ceiling, err := h.AskUNI.AskWritePolicy(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskWritePolicySDO{Ceiling: ceiling})
}

func (h *handlers) setOrgAskWritePolicy(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.AskWritePolicySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if h.refuseAskActionsOff(w, r, orgID) {
		return
	}
	ceiling, err := h.AskUNI.SetAskWritePolicy(r.Context(), middleware.UserID(r.Context()), orgID, in.Ceiling)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AskWritePolicySDO{Ceiling: ceiling})
}
