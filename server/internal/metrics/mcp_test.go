package metrics

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMcpMetricsAreExposed(t *testing.T) {
	reg := NewRegistry(RegistryOptions{})
	reg.Mcp.IncOAuth("token_issued")
	reg.Mcp.ObserveTool("my_work", "read", "ok", 120*time.Millisecond)
	reg.Mcp.ObserveTool("get_task", "read", "not_found", time.Millisecond)
	reg.Mcp.ObserveTool("create_task", "write", "ok", time.Millisecond)
	rec := httptest.NewRecorder()
	NewHandler(reg.Gatherer).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`uniwork_mcp_oauth_events_total{event="token_issued"} 1`,
		`uniwork_mcp_tool_calls_total{kind="read",outcome="ok",tool="my_work"} 1`,
		`uniwork_mcp_tool_calls_total{kind="read",outcome="not_found",tool="get_task"} 1`,
		`uniwork_mcp_tool_calls_total{kind="write",outcome="ok",tool="create_task"} 1`,
		`uniwork_mcp_tool_duration_seconds_count{tool="my_work"} 1`,
		`uniwork_mcp_tool_duration_seconds_bucket{tool="my_work",le="0.25"} 1`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %s", want)
		}
	}
}

// Without METRICS_ADDR there is no registry; a nil collector set must stay
// callable so the services never test for it.
func TestMcpMetricsAreNilSafe(t *testing.T) {
	var m *Mcp
	m.IncOAuth("token_issued")
	m.ObserveTool("search", "read", "ok", time.Second)
	if c := m.Collectors(); c != nil {
		t.Fatalf("nil Mcp collectors = %v", c)
	}
}
