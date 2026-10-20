package handler

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

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
	respondJSON(w, status, sdo.NewErrorSDO(code, msg))
}

func respondErrorFields(w http.ResponseWriter, status int, code, msg string, fields map[string]any) {
	body := sdo.NewErrorSDO(code, msg)
	body.Error.Fields = fields
	respondJSON(w, status, body)
}

// emptyBodyAsObject makes a zero-length request body read as "{}", for a route
// whose contract allows no body at all (the desktop's offline-lease grant). It
// only rewrites what decode would read next, so decode still caps the body and
// answers 413/400 itself; a body that is present is passed through untouched.
func emptyBodyAsObject(r *http.Request) {
	br := bufio.NewReader(r.Body)
	if _, err := br.Peek(1); errors.Is(err, io.EOF) {
		r.Body = io.NopCloser(strings.NewReader("{}"))
		return
	}
	r.Body = struct {
		io.Reader
		io.Closer
	}{br, r.Body}
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
