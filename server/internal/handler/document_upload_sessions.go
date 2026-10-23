package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Large upload sessions (BIGUP-S1, addendum §6). Three create routes - the
// workspace, document and Office-frame scopes - open a multipart session for a
// file over the single-request threshold; GET, complete and DELETE then act on
// the session by id. A session is readable only by the principal that opened
// it: a session token route refuses a session an Office frame token opened and
// the other way round, and both answer the same 404 as an unknown id, so the
// wire never tells a non-owner that the session exists (contract §3).
//
// The create body carries the client's probe of the file head (up to 64 KiB)
// and, for a zip container, its central directory (up to 1 MiB), both base64.
// Base64 inflates by 4/3: 64 KiB + 1 MiB of probe is ~1.42 MiB on the wire, so
// the cap below is 2 MiB - enough for the probe plus the JSON envelope, while
// still bounding what a caller can make the server buffer before the service's
// own 64 KiB / 1 MiB probe limits reject the request.
const maxUploadSessionJSONBody = 2 << 20

// openUploadSessionInput maps the wire body onto the service input. The parent
// rides on the path, never in the body, so nothing here can name another
// workspace or document.
func openUploadSessionInput(in sdi.CreateUploadSessionSDI) service.OpenUploadSessionInput {
	return service.OpenUploadSessionInput{
		Filename:   strings.TrimSpace(in.Filename),
		SizeBytes:  in.SizeBytes,
		Title:      stringValue(in.Title),
		ParentID:   in.ParentID,
		Visibility: stringValue(in.Visibility),
		Probe: service.UploadSessionProbeInput{
			HeadB64:       in.Probe.HeadB64,
			CentralDirB64: in.Probe.CentralDirB64,
			CDOffset:      in.Probe.CDOffset,
			CDSize:        in.Probe.CDSize,
		},
	}
}

// uploadSessionOpenStatus is 201 for a freshly opened session and 200 for a
// replay of the caller's own Idempotency-Key, where the answer is the session
// that already exists (addendum §6.2).
func uploadSessionOpenStatus(v service.UploadSessionView) int {
	if v.Replayed {
		return http.StatusOK
	}
	return http.StatusCreated
}

// uploadSessionSDO is the shared wire shape of the create and GET answers.
// status is written only when the caller asked for it (GET): the create answer
// follows addendum §6.2, which has no status field.
func uploadSessionSDO(v service.UploadSessionView, withStatus bool) sdo.UploadSessionSDO {
	out := sdo.UploadSessionSDO{
		SessionID:  v.SessionID,
		PartSize:   v.PartSize,
		TotalParts: v.TotalParts,
		ExpiresAt:  v.ExpiresAt.UTC().Format(time.RFC3339),
	}
	if withStatus {
		out.Status = v.Status
	}
	out.CompletedParts = make([]sdo.UploadSessionCompletedPartSDO, 0, len(v.CompletedParts))
	for _, p := range v.CompletedParts {
		out.CompletedParts = append(out.CompletedParts, sdo.UploadSessionCompletedPartSDO{
			PartNumber: p.PartNumber, ETag: p.ETag, Size: p.SizeBytes,
		})
	}
	for _, p := range v.Parts {
		headers := map[string]string{}
		for name, values := range p.Headers {
			if len(values) > 0 {
				headers[name] = values[0]
			}
		}
		out.Parts = append(out.Parts, sdo.UploadSessionPartURLSDO{
			PartNumber: p.PartNumber, Method: p.Method, URL: p.URL, Headers: headers,
			ExpiresAt: p.ExpiresAt.UTC().Format(time.RFC3339),
		})
	}
	return out
}

// completeUploadSessionInput maps the client's part list. The storage's own
// ListParts is the authority on what was really uploaded; this is what the
// client claims, and a mismatch is 422 upload_parts_invalid.
func completeUploadSessionInput(in sdi.CompleteUploadSessionSDI) service.CompleteUploadSessionInput {
	out := service.CompleteUploadSessionInput{Parts: make([]service.CompleteUploadPartInput, 0, len(in.Parts))}
	for _, p := range in.Parts {
		out.Parts = append(out.Parts, service.CompleteUploadPartInput{PartNumber: p.PartNumber, ETag: strings.TrimSpace(p.ETag)})
	}
	return out
}

// createWorkspaceUploadSession is POST
// /workspaces/{workspaceID}/documents/upload-sessions: a new file document
// above the single-request threshold. Completing it creates the document and
// answers the 201-shaped DocumentSDO the one-request route answers.
func (h *handlers) createWorkspaceUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	input := openUploadSessionInput(in)
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	view, err := h.Documents.OpenWorkspaceUploadSession(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, uploadSessionOpenStatus(view), uploadSessionSDO(view, false))
}

// createDocumentUploadSession is POST /documents/{documentID}/upload-sessions:
// a new version of an existing file document. Completing it stages the upload
// and answers DocumentUploadSDO for the existing commit route.
func (h *handlers) createDocumentUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	input := openUploadSessionInput(in)
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	view, err := h.Documents.OpenVersionUploadSession(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, uploadSessionOpenStatus(view), uploadSessionSDO(view, false))
}

// createFrameUploadSession is POST
// /office-frame/documents/{documentID}/upload-sessions: the same session for a
// frame save over 20 MiB. The token alone is the credential, as on every other
// frame route; the session records the document the token names.
func (h *handlers) createFrameUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	var in sdi.CreateUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	input := openUploadSessionInput(in)
	input.IdempotencyKey = r.Header.Get("Idempotency-Key")
	view, err := h.OfficeFrame.OpenUploadSession(r.Context(), officeFrameClaims(r), chi.URLParam(r, "documentID"), input)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, uploadSessionOpenStatus(view), uploadSessionSDO(view, false))
}

// getUploadSession is GET /upload-sessions/{sessionID}: the session status,
// what the storage already holds, and a fresh presigned URL for every part
// still missing (a client whose part URLs expired resumes here).
func (h *handlers) getUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	view, err := h.Documents.GetUploadSession(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "sessionID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, uploadSessionSDO(view, true))
}

// getFrameUploadSession is GET
// /office-frame/documents/{documentID}/upload-sessions/{sessionID}.
func (h *handlers) getFrameUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	view, err := h.OfficeFrame.GetUploadSession(r.Context(), officeFrameClaims(r), chi.URLParam(r, "documentID"), chi.URLParam(r, "sessionID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, uploadSessionSDO(view, true))
}

// respondUploadSessionComplete answers the complete routes by the route family
// that opened the session: the workspace route returns the created document
// (the shape POST .../documents/files answers), the document and frame routes
// return the staged upload the existing commit routes claim.
func (h *handlers) respondUploadSessionComplete(w http.ResponseWriter, r *http.Request, res service.UploadSessionCompleteResult) {
	if res.OpenedVia == "workspace" && res.Document != nil {
		view, err := h.Documents.GetDocument(r.Context(), service.Human(middleware.UserID(r.Context())), res.Document.Document.ID)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		respondJSON(w, http.StatusOK, sdo.DocumentSDO{Document: documentDTO(view)})
		return
	}
	up := res.Upload
	if up == nil {
		respondError(w, http.StatusInternalServerError, "internal", "internal error")
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentUploadSDO{
		UploadID:       up.UploadID,
		ChecksumSha256: up.ChecksumSHA256,
		SizeBytes:      up.SizeBytes,
		ClaimExpiresAt: up.ClaimExpiresAt.UTC().Format(time.RFC3339),
	})
}

// completeUploadSession is POST /upload-sessions/{sessionID}/complete: assembles
// the parts, checks size and probe against what was declared, runs the full
// file validation and either creates the document or stages the upload. A
// long request while a large file is validated; repeating it answers the same
// result.
func (h *handlers) completeUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CompleteUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	res, err := h.Documents.CompleteUploadSession(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "sessionID"), completeUploadSessionInput(in))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondUploadSessionComplete(w, r, res)
}

// completeFrameUploadSession is POST
// /office-frame/documents/{documentID}/upload-sessions/{sessionID}/complete.
func (h *handlers) completeFrameUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	var in sdi.CompleteUploadSessionSDI
	if !decode(w, r, &in, maxUploadSessionJSONBody) {
		return
	}
	res, err := h.OfficeFrame.CompleteUploadSession(r.Context(), officeFrameClaims(r),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "sessionID"), completeUploadSessionInput(in))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondUploadSessionComplete(w, r, res)
}

// abortUploadSession is DELETE /upload-sessions/{sessionID}: discards the
// parts at the storage, cancels the FileService session (releasing the
// reserved quota) and answers 204. Aborting an already aborted or expired
// session is 204; one that completed answers 409.
func (h *handlers) abortUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if err := h.Documents.AbortUploadSession(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "sessionID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// abortFrameUploadSession is DELETE
// /office-frame/documents/{documentID}/upload-sessions/{sessionID}.
func (h *handlers) abortFrameUploadSession(w http.ResponseWriter, r *http.Request) {
	if h.OfficeFrame == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	if err := h.OfficeFrame.AbortUploadSession(r.Context(), officeFrameClaims(r),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "sessionID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
