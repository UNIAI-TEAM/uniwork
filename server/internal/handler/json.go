package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// maxJSONBody caps every JSON request body. The largest legitimate payload
// (a task description, a meeting note) is a few KiB; without a cap a single
// client can make the decoder allocate without bound. Multipart uploads set
// their own limit (see avatar.go).
const maxJSONBody = 1 << 20

func respondJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func respondError(w http.ResponseWriter, status int, code, msg string) {
	respondJSON(w, status, sdo.ErrorSDO{Error: sdo.ErrorDetail{Code: code, Message: msg}})
}

func respondErrorFields(w http.ResponseWriter, status int, code, msg string, fields map[string]any) {
	respondJSON(w, status, sdo.ErrorSDO{Error: sdo.ErrorDetail{Code: code, Message: msg, Fields: fields}})
}

// decode reads a JSON body into dst, bounded by limit bytes. On failure it
// writes the error response itself — 413 when the body exceeds the limit,
// 400 otherwise — and returns false so the handler can simply return.
func decode[T any](w http.ResponseWriter, r *http.Request, dst *T, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	err := json.NewDecoder(r.Body).Decode(dst)
	if err == nil {
		return true
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		respondError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body too large")
		return false
	}
	respondError(w, http.StatusBadRequest, "invalid_request", "invalid json")
	return false
}
