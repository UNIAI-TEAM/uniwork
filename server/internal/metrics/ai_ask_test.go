package metrics

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAskMetricsBoundToolLabel(t *testing.T) {
	reg := NewRegistry(RegistryOptions{})
	reg.AIAsk.ObserveAskTool("search", "ok", 0.1)
	reg.AIAsk.ObserveAskTool("x", "weird", 0.1)
	reg.AIAsk.ObserveAskRun("answered", 2, 1.5)
	reg.AIAsk.ObserveAskRun("bogus", 9, 1)
	rec := httptest.NewRecorder()
	NewHandler(reg.Gatherer).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`uniwork_ai_ask_tool_calls_total{status="ok",tool="search"} 1`,
		`uniwork_ai_ask_tool_calls_total{status="error",tool="other"} 1`,
		`uniwork_ai_ask_tool_seconds_count{tool="other"} 1`,
		`uniwork_ai_ask_runs_total{outcome="answered"} 1`,
		`uniwork_ai_ask_runs_total{outcome="agent_failed"} 1`,
		`uniwork_ai_ask_run_rounds_bucket{le="2"} 1`,
		`uniwork_ai_ask_run_seconds_count 2`,
		// Past the 120 s run deadline, so a run that hit it is not lost in +Inf.
		`uniwork_ai_ask_run_seconds_bucket{le="150"} 2`,
		// Tool rounds, capped at 4.
		`# HELP uniwork_ai_ask_run_rounds Tool rounds`,
		`uniwork_ai_ask_run_rounds_bucket{le="4"}`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %s", want)
		}
	}
}

func TestAskMetricsAreNilSafe(t *testing.T) {
	var m *AIAsk
	m.ObserveAskRun("answered", 1, 1)
	m.ObserveAskTool("search", "ok", 1)
	if m.Collectors() != nil {
		t.Fatal("nil collectors")
	}
}
