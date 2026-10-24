package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
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
