package handler

import (
	"encoding/base64"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Saved signatures HTTP (UNI-925 B6). The rows are the caller's own, scoped
// to one organization: the list answers only their signatures, the create
// decodes the base64 image itself (the service still sniffs the bytes), and
// the delete answers 404 for a signature that is not theirs. A non-member of
// the organization sees 404 from the service, never 403.

// savedSignatureDTO renders one stored row. The image goes back out in the
// same base64 shape it arrived in, so the picker can draw it directly.
func savedSignatureDTO(id, label, contentType string, image []byte, createdAt time.Time) sdo.SavedSignatureDTO {
	return sdo.SavedSignatureDTO{
		ID:          id,
		Label:       label,
		ContentType: contentType,
		Image:       base64.StdEncoding.EncodeToString(image),
		ByteSize:    len(image),
		CreatedAt:   createdAt.UTC().Format(time.RFC3339),
	}
}

// listSavedSignatures is GET /orgs/{orgID}/signatures: the caller's saved
// signatures in one organization, newest first.
func (h *handlers) listSavedSignatures(w http.ResponseWriter, r *http.Request) {
	if h.Signatures == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "saved signatures are not configured")
		return
	}
	rows, err := h.Signatures.ListSavedSignatures(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.SavedSignatureListSDO{Signatures: make([]sdo.SavedSignatureDTO, 0, len(rows))}
	for _, row := range rows {
		out.Signatures = append(out.Signatures, savedSignatureDTO(
			row.ID, row.Label, row.ContentType, row.Image, row.CreatedAt.Time,
		))
	}
	respondJSON(w, http.StatusOK, out)
}

// createSavedSignature is POST /orgs/{orgID}/signatures: save one image for
// the caller. The base64 decode happens here so a malformed body is a 400
// before the service sees it; the service owns the format and size rules.
func (h *handlers) createSavedSignature(w http.ResponseWriter, r *http.Request) {
	if h.Signatures == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "saved signatures are not configured")
		return
	}
	var in sdi.CreateSavedSignatureSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	image, err := base64.StdEncoding.DecodeString(in.Image)
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "image must be base64")
		return
	}
	row, err := h.Signatures.SaveSignature(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"), service.SaveSignatureInput{
		Label: in.Label, ContentType: in.ContentType, Image: image,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.SavedSignatureSDO{Signature: savedSignatureDTO(
		row.ID, row.Label, row.ContentType, row.Image, row.CreatedAt.Time,
	)})
}

// deleteSavedSignature is DELETE /orgs/{orgID}/signatures/{signatureID}:
// remove one of the caller's signatures. A signature that is not theirs - or
// not in this organization - is a 404.
func (h *handlers) deleteSavedSignature(w http.ResponseWriter, r *http.Request) {
	if h.Signatures == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "saved signatures are not configured")
		return
	}
	if err := h.Signatures.DeleteSavedSignature(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "orgID"), chi.URLParam(r, "signatureID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
