package handler

import (
	"net/http"
	"path"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

const (
	// askAttachmentMaxBytes mirrors the ai_attachment purpose cap.
	askAttachmentMaxBytes = 20 << 20
	// askAttachmentHeadroom is the multipart envelope's share of the body cap.
	askAttachmentHeadroom = 256 << 10
)

// uploadAskAttachment is POST /api/v1/workspaces/{workspaceID}/ai/attachments:
// one file for the asker's next question. The gate (member, flags) runs before
// the body is read, so a refused caller never makes the server spool 20 MiB.
func (h *handlers) uploadAskAttachment(w http.ResponseWriter, r *http.Request) {
	const tooLarge = "file must be at most 20 MiB"
	release, ok := beginUpload(w, r, uploads, askAttachmentMaxBytes+askAttachmentHeadroom, tooLarge)
	if !ok {
		return
	}
	defer release()
	userID, workspaceID := middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID")
	if err := h.AskUNI.AuthorizeAttachmentUpload(r.Context(), userID, workspaceID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	file, header, ok := uploadFormFile(w, r, tooLarge)
	if !ok {
		return
	}
	defer file.Close()
	if header.Size > askAttachmentMaxBytes {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", tooLarge)
		return
	}
	filename := "file"
	if base := path.Base(header.Filename); base != "" && base != "." && base != ".." && base != "/" {
		filename = base
	}
	att, err := h.AskUNI.UploadAttachment(r.Context(), userID, workspaceID, filename, file)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AiAttachmentUploadSDO{FileID: att.FileID, Name: att.Name, MIME: att.MIME, Size: att.Size, Kind: att.Kind})
}

// cancelAskAttachment is DELETE /api/v1/workspaces/{workspaceID}/ai/attachments/{fileID}.
func (h *handlers) cancelAskAttachment(w http.ResponseWriter, r *http.Request) {
	if err := h.AskUNI.CancelAttachment(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"), chi.URLParam(r, "fileID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
