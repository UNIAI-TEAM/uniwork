package handler

import (
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

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
	in, ok := officeFrameExportBodyOf(w, r)
	if !ok {
		return
	}
	in.IdempotencyKey = r.Header.Get("Idempotency-Key")
	out, err := h.Office.ExportFramePDF(r.Context(), service.Human(claims.UserID), claims.DocumentID, in)
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

// officeFrameExportBodyOf reads the optional multipart body: a "file" part
// (the frame's unsaved bytes) or a "version" field (a stored version). No
// body, or a multipart body with neither, means the current version. A body
// that is not multipart, a second file part, both at once, a bad version or a
// part past the cap is refused here.
func officeFrameExportBodyOf(w http.ResponseWriter, r *http.Request) (service.OfficeExportPDFInput, bool) {
	var in service.OfficeExportPDFInput
	if r.ContentLength == 0 || (r.ContentLength < 0 && r.Header.Get("Content-Type") == "") {
		return in, true
	}
	if r.ContentLength > officeFrameExportBody {
		documentTooLarge(w)
		return in, false
	}
	if media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || media != "multipart/form-data" {
		respondError(w, http.StatusBadRequest, "invalid_request", "body must be empty or multipart/form-data")
		return in, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, officeFrameExportBody)
	mr, err := r.MultipartReader()
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "multipart/form-data body required")
		return in, false
	}
	for {
		p, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			officeFrameExportReadError(w, err)
			return in, false
		}
		switch p.FormName() {
		case "file":
			if in.Bytes != nil {
				respondError(w, http.StatusBadRequest, "invalid_request", "only one file part is accepted")
				return in, false
			}
			if in.Bytes, err = io.ReadAll(io.LimitReader(p, officeFrameExportMax+1)); err != nil {
				officeFrameExportReadError(w, err)
				return in, false
			}
			if len(in.Bytes) > officeFrameExportMax {
				documentTooLarge(w)
				return in, false
			}
			if len(in.Bytes) == 0 {
				respondError(w, http.StatusBadRequest, "invalid_request", "file part is empty")
				return in, false
			}
		case "version":
			raw, err := io.ReadAll(io.LimitReader(p, 16))
			n, perr := strconv.ParseInt(strings.TrimSpace(string(raw)), 10, 32)
			if err != nil || perr != nil || n < 1 {
				respondError(w, http.StatusBadRequest, "invalid_request", "version must be a positive integer")
				return in, false
			}
			in.Version = int32(n)
		default:
			// Unknown fields are drained and ignored, like the upload route.
			_, _ = io.Copy(io.Discard, io.LimitReader(p, documentUploadFieldCap))
		}
	}
	if in.Bytes != nil && in.Version != 0 {
		respondError(w, http.StatusBadRequest, "invalid_request", "send either file or version, not both")
		return in, false
	}
	return in, true
}

func officeFrameExportReadError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		documentTooLarge(w)
		return
	}
	respondError(w, http.StatusBadRequest, "invalid_request", "multipart body could not be read")
}
