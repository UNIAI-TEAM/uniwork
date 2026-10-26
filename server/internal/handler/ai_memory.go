package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The HTTP face of Ask UNI memory (P4 R16). The service gates on membership
// and the flag and scopes every row to the caller, so a handler only decodes.

func toAiMemoryDTO(m db.AiMemory) sdo.AiMemoryDTO {
	return sdo.AiMemoryDTO{
		ID: m.ID, Kind: m.Kind, Text: m.Body, Source: m.Source,
		CreatedAt: m.CreatedAt.Time.UTC().Format(time.RFC3339), UpdatedAt: m.UpdatedAt.Time.UTC().Format(time.RFC3339),
	}
}

// memoryOrg answers the organization of {org} and the caller, or writes the failure.
func (h *handlers) memoryOrg(w http.ResponseWriter, r *http.Request) (userID, orgID string, ok bool) {
	if h.AiMemory == nil {
		respondError(w, http.StatusServiceUnavailable, "ai_memory_unavailable", "Ask UNI memory is not configured")
		return "", "", false
	}
	orgID, ok = h.orgIDFromSlug(w, r)
	return middleware.UserID(r.Context()), orgID, ok
}

func (h *handlers) listAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	l, err := h.AiMemory.List(r.Context(), userID, orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	entries := make([]sdo.AiMemoryDTO, 0, len(l.Entries))
	for _, e := range l.Entries {
		entries = append(entries, toAiMemoryDTO(e))
	}
	respondJSON(w, 200, sdo.AiMemoryListSDO{Entries: entries, On: l.On, Limit: l.Limit, Remaining: l.Remaining})
}

func (h *handlers) createAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	var in sdi.AiMemoryCreateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.AiMemory.Create(r.Context(), userID, orgID, in.Kind, in.Text)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, toAiMemoryDTO(m))
}

func (h *handlers) updateAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	var in sdi.AiMemoryUpdateSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.AiMemory.Update(r.Context(), userID, orgID, chi.URLParam(r, "memoryID"), in.Kind, in.Text)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toAiMemoryDTO(m))
}

func (h *handlers) deleteAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	if err := h.AiMemory.Delete(r.Context(), userID, orgID, chi.URLParam(r, "memoryID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *handlers) clearAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	n, err := h.AiMemory.Clear(r.Context(), userID, orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AiMemoryClearSDO{Deleted: n})
}

// splitAiMemoryImport splits a paste into entries to tick; nothing is stored.
func (h *handlers) splitAiMemoryImport(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	var in sdi.AiMemoryImportSplitSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	res, err := h.AiMemory.SplitImport(r.Context(), userID, orgID, in.Text)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiMemoryImportSplitSDO{Candidates: []sdo.AiMemoryCandidateDTO{}, Skipped: []sdo.AiMemorySkippedDTO{}}
	for _, c := range res.Candidates {
		out.Candidates = append(out.Candidates, sdo.AiMemoryCandidateDTO{Text: c.Text, Kind: c.Kind, InstructionLike: c.InstructionLike, Duplicate: c.Duplicate})
	}
	for _, s := range res.Skipped {
		out.Skipped = append(out.Skipped, sdo.AiMemorySkippedDTO{Text: s.Text, Reason: s.Reason})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) importAiMemory(w http.ResponseWriter, r *http.Request) {
	userID, orgID, ok := h.memoryOrg(w, r)
	if !ok {
		return
	}
	var in sdi.AiMemoryImportSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	entries := make([]service.AiMemoryInput, 0, len(in.Entries))
	for _, e := range in.Entries {
		entries = append(entries, service.AiMemoryInput{Kind: e.Kind, Text: e.Text})
	}
	l, err := h.AiMemory.ImportMemories(r.Context(), userID, orgID, entries)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AiMemoryImportSDO{Entries: []sdo.AiMemoryDTO{}, On: l.On, Limit: l.Limit, Remaining: l.Remaining, SkippedDuplicates: l.SkippedDuplicates}
	for _, e := range l.Entries {
		out.Entries = append(out.Entries, toAiMemoryDTO(e))
	}
	respondJSON(w, 200, out)
}

// setAskUniMemory names no organization: the service reads the flag for any
// organization the person is in. It writes no audit row (the switch is theirs).
func (h *handlers) setAskUniMemory(w http.ResponseWriter, r *http.Request) {
	if h.AiMemory == nil {
		respondError(w, http.StatusServiceUnavailable, "ai_memory_unavailable", "Ask UNI memory is not configured")
		return
	}
	var in sdi.AiMemorySwitchSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.AiMemory.SetOn(r.Context(), middleware.UserID(r.Context()), in.Enabled); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// memoryProposalAnswer answers a decision on a memory proposal. A 409 carries
// the row as it now stands in error.fields.proposal, so the card repaints
// from the answer (R16); every other refusal carries no row.
func (h *handlers) memoryProposalAnswer(w http.ResponseWriter, p service.AskMemoryProposal, err error) {
	var ce service.CodedError
	switch {
	case err == nil:
		respondJSON(w, 200, toAiMemoryProposalDTO(p))
	case errors.As(err, &ce) && ce.Status == http.StatusConflict && p.ID != "":
		respondErrorFields(w, ce.Status, ce.Code, ce.Error(), map[string]any{"proposal": toAiMemoryProposalDTO(p)})
	default:
		h.mapServiceError(w, err)
	}
}

// memoryProposalCall runs one decision as the caller on {memoryProposalID}.
func (h *handlers) memoryProposalCall(w http.ResponseWriter, r *http.Request, run func(ctx context.Context, userID, id string) (service.AskMemoryProposal, error)) {
	if h.AiMemory == nil {
		respondError(w, http.StatusServiceUnavailable, "ai_memory_unavailable", "Ask UNI memory is not configured")
		return
	}
	p, err := run(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "memoryProposalID"))
	h.memoryProposalAnswer(w, p, err)
}

func (h *handlers) applyAiMemoryProposal(w http.ResponseWriter, r *http.Request) {
	h.memoryProposalCall(w, r, h.AiMemory.ApplyProposal)
}

func (h *handlers) rejectAiMemoryProposal(w http.ResponseWriter, r *http.Request) {
	h.memoryProposalCall(w, r, h.AiMemory.RejectProposal)
}

func (h *handlers) undoAiMemoryProposal(w http.ResponseWriter, r *http.Request) {
	h.memoryProposalCall(w, r, h.AiMemory.UndoProposal)
}

func (h *handlers) editAiMemoryProposal(w http.ResponseWriter, r *http.Request) {
	var in sdi.AiMemoryProposalEditSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	h.memoryProposalCall(w, r, func(ctx context.Context, userID, id string) (service.AskMemoryProposal, error) {
		return h.AiMemory.EditProposal(ctx, userID, id, in.Kind, in.Text)
	})
}
