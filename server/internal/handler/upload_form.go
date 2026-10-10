package handler

import (
	"errors"
	"mime/multipart"
	"net/http"

	"golang.org/x/sync/semaphore"
)

// uploadInflightBytes caps the request bytes the multipart upload routes of
// this process hold at once. Past it an upload answers 503 + Retry-After
// rather than piling bodies, temp files and spools onto a 512Mi pod (C7).
const uploadInflightBytes = 128 << 20

// uploads is the process-wide budget behind uploadInflightBytes.
var uploads = semaphore.NewWeighted(uploadInflightBytes)

// uploadFormMemory is how much of a file part ParseMultipartForm keeps in
// heap; a larger part goes to a temp file, which release removes (net/http
// only cleans up the request it created, never the copies middleware pass
// down). It replaces r.FormFile's implicit 32 MiB.
const uploadFormMemory = 256 << 10

// beginUpload refuses an upload on its headers, before any body byte is read:
// a declared Content-Length over limit is 413, and a full budget is 503. A
// body without Content-Length is charged the whole limit. On success the body
// is capped at limit and the caller defers release, after closing the file,
// so it also removes the parsed form's temp files.
func beginUpload(w http.ResponseWriter, r *http.Request, sem *semaphore.Weighted, limit int64, tooLarge string) (release func(), ok bool) {
	if r.ContentLength > limit {
		respondError(w, http.StatusRequestEntityTooLarge, "too_large", tooLarge)
		return nil, false
	}
	n := r.ContentLength
	if n <= 0 {
		n = limit
	}
	if !sem.TryAcquire(n) {
		w.Header().Set("Retry-After", "2")
		respondError(w, http.StatusServiceUnavailable, "uploads_busy", "too many uploads in progress, retry shortly")
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		sem.Release(n)
	}, true
}

// uploadFormFile parses the multipart body with file parts spooled to disk
// and returns the "file" part as a seekable file. Text fields are read
// wherever they sit relative to the file, so clients that append
// client_msg_id after the file keep working.
func uploadFormFile(w http.ResponseWriter, r *http.Request, tooLarge string) (multipart.File, *multipart.FileHeader, bool) {
	if err := r.ParseMultipartForm(uploadFormMemory); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			respondError(w, http.StatusRequestEntityTooLarge, "too_large", tooLarge)
			return nil, nil, false
		}
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return nil, nil, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", `multipart field "file" is required`)
		return nil, nil, false
	}
	return file, header, true
}
