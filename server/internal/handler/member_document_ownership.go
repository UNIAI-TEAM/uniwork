package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// The two document-ownership routes of an organization member (DOC-06b,
// UNI-2092; addendum §2.2, §4.2). {org} is the slug, resolved for an active
// member like every member route; the service decides the rest.

func (h *handlers) getMemberDocumentOwnership(w http.ResponseWriter, r *http.Request) {
	if h.MemberDocuments == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	own, err := h.MemberDocuments.MemberDocumentOwnership(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MemberDocumentOwnershipSDO{
		UserID: own.UserID, Total: own.Total,
		Workspaces: make([]sdo.MemberDocumentWorkspaceCountDTO, 0, len(own.Workspaces)),
	}
	for _, ws := range own.Workspaces {
		out.Workspaces = append(out.Workspaces, sdo.MemberDocumentWorkspaceCountDTO{
			WorkspaceID: ws.WorkspaceID, WorkspaceName: ws.WorkspaceName, Count: ws.Count,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) transferMemberDocuments(w http.ResponseWriter, r *http.Request) {
	if h.MemberDocuments == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.TransferMemberDocumentsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	input := service.MemberDocumentsTransferInput{ToUserID: in.ToUserID}
	if in.BulkID != nil {
		input.BulkID = *in.BulkID
	}
	if in.Cursor != nil {
		input.Cursor = *in.Cursor
	}
	got, err := h.MemberDocuments.TransferMemberDocuments(r.Context(), service.Human(middleware.UserID(r.Context())), orgID, chi.URLParam(r, "userID"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.MemberDocumentsTransferSDO{
		BulkID: got.BulkID, Transferred: got.Transferred,
		Skipped: sdo.MemberDocumentsSkippedDTO{
			RecipientNotMember: got.SkippedRecipientNotMember, SelfRestricted: got.SkippedSelfRestricted,
		},
		HasMore: got.HasMore, Cursor: got.Cursor,
	})
}
