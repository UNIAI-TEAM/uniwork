package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// transferDocumentOwner is PUT /documents/{documentID}/owner (DOC-06 §2.1,
// §4.2): hand the ACL owner slot to an effective member of the document's
// workspace.
func (h *handlers) transferDocumentOwner(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.TransferDocumentOwnerSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	got, err := h.Documents.TransferOwner(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), service.DocumentOwnerTransferInput{
			UserID: in.UserID, PreviousOwnerLevel: derefString(in.PreviousOwnerLevel),
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentOwnerSDO{
		DocumentID: got.DocumentID, ACLOwnerID: got.ACLOwnerID,
		PreviousOwnerID: got.PreviousOwnerID, PreviousOwnerShareID: got.PreviousOwnerShareID,
	})
}
