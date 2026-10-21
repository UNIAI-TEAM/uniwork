package handler

import (
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func pushPreviewPolicySDO(p service.PushPreviewPolicy) sdo.PushPreviewPolicySDO {
	out := sdo.PushPreviewPolicySDO{Hidden: p.Hidden, CanManage: p.CanManage}
	if p.HiddenAt != nil {
		at := p.HiddenAt.UTC().Format(time.RFC3339)
		out.HiddenAt = &at
	}
	return out
}

func (h *handlers) orgPushPreviewPolicy(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	p, err := h.Organizations.PushPreviewPolicy(r.Context(), middleware.UserID(r.Context()), orgID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, pushPreviewPolicySDO(p))
}

func (h *handlers) setOrgPushPreviewPolicy(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.PushPreviewPolicySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if in.Hidden == nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "hidden is required")
		return
	}
	p, err := h.Organizations.SetPushPreviewPolicy(r.Context(), middleware.UserID(r.Context()), orgID, *in.Hidden)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, pushPreviewPolicySDO(p))
}
