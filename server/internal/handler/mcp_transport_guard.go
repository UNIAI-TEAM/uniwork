package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

// What /mcp accepts. The SDK serves every method its protocol revisions know,
// and some let one HTTP request cost far more than the 120 a minute the limiter
// counts or hold a connection open: a JSON-RPC batch, and subscriptions/listen,
// which the transport answers as a server-sent stream that stays open until the
// client cancels (whatever revision the client names, JSONResponse or not; the
// handler parks while the server advertises tools.listChanged). So the SDK sees
// only what mcpGuard lets through: one JSON-RPC message that is not a batch and
// whose method is on mcpMethods. A method the SDK learns in a later release is
// refused here until it is added to the list on purpose.

// mcpProtocolVersions is the floor of spec §7.1. Both revisions forbid batching
// (it ended with 2025-06-18) and neither has the subscriptions/listen stream of
// 2026-07-28 onwards, which the SDK serves as SSE even with JSONResponse. A
// request naming another revision is a 400 from the SDK; the initialize
// handshake never fails and answers with the newest revision of the list.
// TestMcpProtocolVersionFloor pins both, so an SDK upgrade that changes either
// shows up there.
var mcpProtocolVersions = []string{"2025-06-18", "2025-11-25"}

// mcpMethods are the calls and notifications the connector serves: the
// handshake, ping, and the two tool methods. Nothing else is read-only data of
// ours (no resources, prompts, completions, logging, roots or subscriptions).
// A notification outside the list (notifications/cancelled, roots/list_changed)
// is dropped with 202: a stateless server has no in-flight request of another
// HTTP request to cancel, and JSON-RPC has no reply to a notification.
var mcpMethods = map[string]bool{
	"initialize":                true,
	"notifications/initialized": true,
	"ping":                      true,
	"tools/list":                true,
	"tools/call":                true,
}

const (
	jsonRPCParseError     = -32700
	jsonRPCInvalidRequest = -32600
	jsonRPCMethodNotFound = -32601
)

// mcpGuard refuses what the connector does not serve. It reports true when it
// has answered; otherwise the body goes on to the SDK with the same meaning (the
// blanks in front of it are gone), and what the SDK reads is what the guard
// judged: a body the guard cannot read the method of with certainty is refused
// rather than handed on, so the two JSON parsers never get to disagree about
// which method a request calls.
func (h *handlers) mcpGuard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost || r.Body == nil {
		return false
	}
	// Read the whole request, under the cap the SDK applies; the SDK reads all
	// of it before it looks at it, too.
	body := r.Body
	raw, err := io.ReadAll(http.MaxBytesReader(w, body, mcpMaxBody))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			respondError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body too large")
			return true
		}
		writeJSONRPCError(w, http.StatusBadRequest, jsonRPCParseError, nil, "request body could not be read")
		return true
	}
	raw = bytes.TrimLeft(raw, " \t\n\r")
	if len(raw) > 0 && raw[0] == '[' {
		// One request must be one call. The SDK runs every call of a batch on a
		// goroutine of its own, so a megabyte of calls (about ten thousand)
		// would drain the database pool for every tenant.
		writeJSONRPCError(w, http.StatusBadRequest, jsonRPCInvalidRequest, nil, "batch requests are not supported")
		return true
	}
	method, id, err := mcpRequestMethod(raw)
	if err != nil {
		writeJSONRPCError(w, http.StatusBadRequest, jsonRPCInvalidRequest, nil, "request must be one JSON-RPC message with one method")
		return true
	}
	if !mcpMethods[method] {
		if id == nil {
			w.WriteHeader(http.StatusAccepted)
			return true
		}
		writeJSONRPCError(w, http.StatusOK, jsonRPCMethodNotFound, id, "method not found")
		return true
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	return false
}

// mcpRequestMethod reads the top-level "method" and "id" of one JSON-RPC
// message. id is nil for a notification. It fails on anything that could be
// read two ways: a body that is not exactly one JSON object, a "method" that is
// not a string, and a method or id key that is repeated or differs only in case
// (both Go JSON decoders match keys without regard to case).
func mcpRequestMethod(raw []byte) (method string, id json.RawMessage, err error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return "", nil, errors.New("not an object")
	}
	var haveMethod, haveID bool
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return "", nil, err
		}
		key, _ := t.(string)
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return "", nil, err
		}
		switch {
		case key == "method":
			if haveMethod || len(value) == 0 || value[0] != '"' || json.Unmarshal(value, &method) != nil {
				return "", nil, errors.New("method is repeated or not a string")
			}
			haveMethod = true
		case strings.EqualFold(key, "method"):
			return "", nil, errors.New("method key in another case")
		case key == "id":
			if haveID {
				return "", nil, errors.New("id is repeated")
			}
			haveID, id = true, value
		case strings.EqualFold(key, "id"):
			return "", nil, errors.New("id key in another case")
		}
	}
	if t, err := dec.Token(); err != nil || t != json.Delim('}') {
		return "", nil, errors.New("object not closed")
	}
	if _, err := dec.Token(); err != io.EOF {
		return "", nil, errors.New("data after the message")
	}
	if !haveMethod {
		return "", nil, errors.New("no method")
	}
	return method, id, nil
}

// writeJSONRPCError answers before the SDK with a JSON-RPC error object. id is
// the request's own id when it was read far enough to have one, otherwise null.
func writeJSONRPCError(w http.ResponseWriter, status, code int, id json.RawMessage, message string) {
	if id == nil {
		id = json.RawMessage("null")
	}
	respondJSON(w, status, map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]any{"code": code, "message": message},
	})
}

// noStoreWriter keeps Cache-Control: no-store on what the SDK writes. The SDK
// sets "no-cache, no-transform" on its own answers, replacing the header
// mcpServe set, and these answers carry a person's tasks. The header is set
// again at the moment the status goes out, which is after the SDK is done with
// it.
type noStoreWriter struct {
	http.ResponseWriter
	sent bool
}

func (w *noStoreWriter) markSent() {
	if !w.sent {
		w.sent = true
		noStore(w.ResponseWriter)
	}
}

func (w *noStoreWriter) WriteHeader(code int) {
	w.markSent()
	w.ResponseWriter.WriteHeader(code)
}

func (w *noStoreWriter) Write(b []byte) (int, error) {
	w.markSent()
	return w.ResponseWriter.Write(b)
}

func (w *noStoreWriter) Flush() {
	w.markSent()
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.ResponseController reach the connection underneath.
func (w *noStoreWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
