package handler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// resolveWorkspaceFiles is POST /workspaces/{workspaceID}/files/resolve: the
// caller's own staged uploads, one entry per requested id in request order.
// A refused id carries its FS-C1 code in its own entry; the request itself
// fails only for the workspace gate or a malformed body.
func (h *handlers) resolveWorkspaceFiles(w http.ResponseWriter, r *http.Request) {
	if h.FileAccess == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file access is not configured")
		return
	}
	var in sdi.ResolveFilesSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items, err := h.FileAccess.ResolveUploads(r.Context(), service.FileAccessRequest{
		UserID:      middleware.UserID(r.Context()),
		SessionID:   middleware.SessionID(r.Context()),
		WorkspaceID: chi.URLParam(r, "workspaceID"),
		FileIDs:     in.FileIDs,
		Disposition: in.Disposition,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.ResolveFilesSDO{Items: make([]sdo.FileAccessItemSDO, 0, len(items))}
	for _, item := range items {
		out.Items = append(out.Items, fileAccessItemDTO(item))
	}
	// A resolve answer carries URLs bound to this caller: never cache it.
	w.Header().Set("Cache-Control", "private, no-store")
	respondJSON(w, http.StatusOK, out)
}

func fileAccessItemDTO(item service.FileAccessItem) sdo.FileAccessItemSDO {
	out := sdo.FileAccessItemSDO{FileID: item.FileID}
	if item.Err != nil {
		out.Error = fileItemError(item.Err)
		return out
	}
	if item.File != nil {
		f := sdo.FileSDO{
			ID:          item.File.ID,
			Filename:    item.File.Filename,
			ContentType: item.File.ContentType,
			SizeBytes:   item.File.SizeBytes,
			Status:      item.File.Status,
			Metadata:    item.File.Metadata,
		}
		if !item.File.ReadyAt.IsZero() {
			at := item.File.ReadyAt.UTC().Format(time.RFC3339)
			f.ReadyAt = &at
		}
		out.File = &f
	}
	out.Access = item.Access
	out.URL = item.URL
	if !item.URLExpiresAt.IsZero() {
		at := item.URLExpiresAt.UTC().Format(time.RFC3339)
		out.URLExpiresAt = &at
	}
	return out
}

// fileItemError renders a per-id refusal. Only coded FileService errors reach
// a client; anything else is reported as unavailable without its cause.
func fileItemError(err error) *sdo.ErrorDetail {
	var ce service.CodedError
	if errors.As(err, &ce) {
		return &sdo.ErrorDetail{Code: ce.Code, Message: ce.Msg}
	}
	return &sdo.ErrorDetail{Code: "storage_unavailable", Message: "file storage is unavailable"}
}

// getFileContent is GET and HEAD /files/{fileID}/content?ticket=...: the
// proxy route for a ticket minted by resolveWorkspaceFiles. It needs no
// Bearer header (native img/audio/video cannot send one); the service
// re-checks the ticket, the live auth session, the workspace membership and
// the file on every request. HEAD answers the headers of the same GET without
// opening the object; Range serves one window with 206, and an unsatisfiable
// one is 416 with Content-Range: bytes */size.
func (h *handlers) getFileContent(w http.ResponseWriter, r *http.Request) {
	if h.FileAccess == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "file access is not configured")
		return
	}
	content, err := h.FileAccess.AuthorizeContent(r.Context(), chi.URLParam(r, "fileID"), r.URL.Query().Get("ticket"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	size := content.SizeBytes
	rangeHeader := r.Header.Get("Range")
	start, end := int64(0), size-1
	partial := false
	switch {
	case size == 0 && rangeHeader != "":
		fileRangeNotSatisfiable(w, size)
		return
	case size > 0:
		var ok bool
		if start, end, ok = parseByteRange(rangeHeader, size); !ok {
			fileRangeNotSatisfiable(w, size)
			return
		}
		partial = rangeHeader != ""
	}
	length := end - start + 1
	if size == 0 {
		length = 0
	}

	header := w.Header()
	header.Set("Content-Type", content.ContentType)
	header.Set("Content-Disposition", content.ContentDisposition)
	header.Set("Accept-Ranges", "bytes")
	header.Set("X-Content-Type-Options", "nosniff")
	// Private and uncached: revoking the session or the grant must stop the
	// next read, which a shared or long-lived cache would defeat.
	header.Set("Cache-Control", "private, no-store")
	// The bytes are user content: if one is ever opened as a document it runs
	// sandboxed with nothing to load.
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	header.Set("Content-Length", strconv.FormatInt(length, 10))
	status := http.StatusOK
	if partial {
		header.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
		status = http.StatusPartialContent
	}
	if r.Method == http.MethodHead || length == 0 {
		w.WriteHeader(status)
		return
	}

	body, err := content.Open(r.Context(), start, length)
	if err != nil {
		for _, name := range []string{"Content-Type", "Content-Disposition", "Content-Length", "Content-Range", "Content-Security-Policy"} {
			header.Del(name)
		}
		h.mapServiceError(w, err)
		return
	}
	defer body.Close()
	w.WriteHeader(status)
	// The request context cancels the object read when the client goes away;
	// a failed copy after the headers can only be logged.
	if _, err := io.Copy(w, body); err != nil && r.Context().Err() == nil {
		h.Log.Error("file content stream", "err", err, "file_id", content.FileID)
	}
}

func fileRangeNotSatisfiable(w http.ResponseWriter, size int64) {
	w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", size))
	respondError(w, http.StatusRequestedRangeNotSatisfiable, "invalid_range", "invalid byte range")
}
