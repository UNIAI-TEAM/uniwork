package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// Folder bulk access HTTP handlers (UNI-2244 §3). In BE-1 both routes answer
// 501 not_implemented after decoding any request body; BE-2 wires the service.

// updateFolderContentsAccess is PUT /api/v1/documents/{folderID}/contents-access.
func (h *handlers) updateFolderContentsAccess(w http.ResponseWriter, r *http.Request) {
	var in sdi.UpdateFolderContentsAccessSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	respondError(w, http.StatusNotImplemented, sdo.FolderContentsAccessErrNotImplemented, "folder bulk access is not implemented yet")
}

// getFolderContentsAccessBatch is GET /api/v1/documents/{folderID}/contents-access/{batchID}.
func (h *handlers) getFolderContentsAccessBatch(w http.ResponseWriter, _ *http.Request) {
	respondError(w, http.StatusNotImplemented, sdo.FolderContentsAccessErrNotImplemented, "folder bulk access batch progress is not implemented yet")
}
