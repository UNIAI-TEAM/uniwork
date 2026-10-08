package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// officeFrameExportMax bounds the optional DOCX part (the DocumentFile cap)
// and officeFrameExportBody the whole multipart body around it.
const (
	officeFrameExportMax  = 50 << 20
	officeFrameExportBody = officeFrameExportMax + 1<<20
)

// exportOfficeFramePDF is POST
// /office-frame/documents/{documentID}/export/pdf (UNI-1013): the PDF of the
// token's document, rendered by the Office engine with the Docs renderer. An
// empty body exports the current version; a multipart "file" part is the
// frame's unsaved edit of it. The answer is the PDF itself, which is what the
// frame protocol's api.export returns to the editor.
func (h *handlers) exportOfficeFramePDF(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	claims := officeFrameClaims(r)
	if _, err := h.OfficeFrame.Authorize(r.Context(), claims); err != nil {
		h.mapServiceError(w, err)
		return
	}
	body, ok := officeFrameExportBodyOf(w, r)
	if !ok {
		return
	}
	out, err := h.Office.ExportFramePDF(r.Context(), service.Human(claims.UserID), claims.DocumentID, service.OfficeExportPDFInput{
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
		Bytes:          body,
	})
	if errors.Is(err, service.ErrOfficeExportInput) {
		respondError(w, http.StatusBadRequest, "invalid_request", "file must be a DOCX document")
		return
	}
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	defer out.Reader.Close()
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "attachment; filename=\"document.pdf\"")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.FormatInt(out.Reader.File.SizeBytes, 10))
	w.Header().Set("X-Office-Job-Id", out.Job.ID)
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, out.Reader.Body); err != nil && r.Context().Err() == nil {
		h.Log.Error("office frame export stream", "err", err, "document_id", claims.DocumentID)
	}
}

// officeFrameExportBodyOf reads the optional "file" part. No body (or an
// empty one) means the current version; a body that is not multipart, a
// second file part or one past the cap is refused here.
func officeFrameExportBodyOf(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.ContentLength == 0 || (r.ContentLength < 0 && r.Header.Get("Content-Type") == "") {
		return nil, true
	}
	if r.ContentLength > officeFrameExportBody {
		documentTooLarge(w)
		return nil, false
	}
	if media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || media != "multipart/form-data" {
		respondError(w, http.StatusBadRequest, "invalid_request", "body must be empty or multipart/form-data with a file part")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, officeFrameExportBody)
	mr, err := r.MultipartReader()
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "multipart/form-data body required")
		return nil, false
	}
	var file []byte
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			officeFrameExportReadError(w, err)
			return nil, false
		}
		if p.FormName() != "file" {
			// Unknown fields are drained and ignored, like the upload route.
			_, _ = io.Copy(io.Discard, io.LimitReader(p, documentUploadFieldCap))
			continue
		}
		if file != nil {
			respondError(w, http.StatusBadRequest, "invalid_request", "only one file part is accepted")
			return nil, false
		}
		file, err = io.ReadAll(io.LimitReader(p, officeFrameExportMax+1))
		if err != nil {
			officeFrameExportReadError(w, err)
			return nil, false
		}
		if len(file) > officeFrameExportMax {
			documentTooLarge(w)
			return nil, false
		}
		if len(file) == 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "file part is empty")
			return nil, false
		}
	}
	return file, true
}

func officeFrameExportReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		documentTooLarge(w)
		return
	}
	respondError(w, http.StatusBadRequest, "invalid_request", "multipart body could not be read")
}
