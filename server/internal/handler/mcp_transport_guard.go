package handler

import (
	"bufio"
	"errors"
	"io"
	"net/http"
)

// What /mcp accepts. The SDK serves everything its protocol revisions allow,
// and two of those allow one HTTP request to cost far more than the 120 a
// minute the limiter counts: a JSON-RPC batch, and a subscriptions/listen
// stream. The revisions are narrowed to the floor below (ServerOptions), which
// ends the stream; a batch is refused by mcpGuard, behind the token check and
// in front of the SDK, because the SDK takes one whenever no revision header
// is sent (it assumes 2025-03-26 then), narrowed or not.

// mcpProtocolVersions is the floor of spec §7.1 and the whole of what is
// served. Both revisions forbid batching (it ended with 2025-06-18) and neither
// has the long-lived subscriptions/listen stream (2026-07-28 onwards: SSE even
// with JSONResponse, no write timeout, and HTTP_MAX_IN_FLIGHT slots that one
// token would fill, so every tenant on the replica would get 503). A request
// naming another revision is a 400 from the SDK; the initialize handshake never
// fails and answers with the newest revision of the list. TestMcpProtocolVersionFloor
// pins both, so an SDK upgrade that changes either shows up there.
var mcpProtocolVersions = []string{"2025-06-18", "2025-11-25"}

const jsonRPCInvalidRequest = -32600

// mcpGuard refuses a batch. It reports true when it has answered; the body is
// otherwise left exactly as it was for the SDK.
func (h *handlers) mcpGuard(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost || r.Body == nil {
		return false
	}
	// The body is capped as the SDK caps it before a byte of it is judged: a
	// request that is mostly blanks must not be read without limit.
	body := r.Body
	br := bufio.NewReader(http.MaxBytesReader(w, body, mcpMaxBody))
	for {
		b, err := br.ReadByte()
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				respondError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "request body too large")
				return true
			}
			// Empty, or unreadable: the SDK reads the same and answers it.
			break
		}
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		if b == '[' {
			// One request must be one call. The SDK runs every call of a batch
			// on a goroutine of its own, so a megabyte of calls (about ten
			// thousand) would drain the database pool for every tenant.
			writeJSONRPCError(w, http.StatusBadRequest, jsonRPCInvalidRequest, "batch requests are not supported")
			return true
		}
		_ = br.UnreadByte()
		break
	}
	r.Body = struct {
		io.Reader
		io.Closer
	}{br, body}
	return false
}

// writeJSONRPCError answers before the SDK with the error object JSON-RPC
// gives a request that is refused as a whole: id null, because the request was
// not read far enough to have one.
func writeJSONRPCError(w http.ResponseWriter, status, code int, message string) {
	respondJSON(w, status, map[string]any{
		"jsonrpc": "2.0",
		"id":      nil,
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
