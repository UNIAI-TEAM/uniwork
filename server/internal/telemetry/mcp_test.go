package telemetry

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestSetMCPStampsTheSpanAndSkipsEmptyIDs(t *testing.T) {
	sr := recorder(t, "")
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Post("/mcp", func(w http.ResponseWriter, req *http.Request) {
		SetMCP(req.Context(), "mcpc_1", "g1", "read write", "")
		SetMCP(req.Context(), "", "", "", "my_work")
		w.WriteHeader(http.StatusNoContent)
	})
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/mcp", nil))

	attrs := map[string]string{}
	for _, kv := range sr.Ended()[0].Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsString()
	}
	for k, want := range map[string]string{"mcp.client_id": "mcpc_1", "mcp.grant_id": "g1", "mcp.scope": "read write", "mcp.tool": "my_work"} {
		if attrs[k] != want {
			t.Errorf("%s = %q, want %q", k, attrs[k], want)
		}
	}
}

// A context with no span (a test, a worker) is a no-op, never a panic.
func TestSetMCPWithoutASpanIsANoop(t *testing.T) {
	SetMCP(t.Context(), "c", "g", "read", "t")
}

// A call with no scope leaves the attribute off, like any other empty value.
func TestSetMCPSkipsAnEmptyScope(t *testing.T) {
	sr := recorder(t, "")
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Post("/mcp", func(w http.ResponseWriter, req *http.Request) {
		SetMCP(req.Context(), "mcpc_1", "g1", "", "my_work")
		w.WriteHeader(http.StatusNoContent)
	})
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/mcp", nil))
	for _, kv := range sr.Ended()[0].Attributes() {
		if string(kv.Key) == AttrMCPScope {
			t.Errorf("mcp.scope = %q, want it left off", kv.Value.AsString())
		}
	}
}
