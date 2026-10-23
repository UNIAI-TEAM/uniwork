package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

// The G6-02 spike (UNI-1364, spec §6.2 and §8.4): one full loop — user → model
// returns a tool call → client sends the tool result → model answers — through
// the openai-compatible provider that ships today, in two modes. fake asserts
// the loop and the id round trip with no network; dev runs it against the dev
// upstream and measures what a decision (G6-D1) needs: whether tool-call ids
// survive, whether usage arrives, what a streamed answer looks like, and how
// slow a loop is.
//
// Synthetic data only: a "get_cell" tool over a made-up sheet. Nothing here may
// print or write the upstream's base URL, host, IP, port or key, so every
// string that reaches the log or the summary goes through spikeRedact first.
//
// Run it through scripts/office/ai-upstream-spike.sh, not by hand:
// SPIKE_MODE=fake|dev is the gate, and the wrapper owns SPIKE_OUT.

const (
	spikeToolName   = "get_cell"
	spikeToolSchema = `{"type":"object","properties":{"cell":{"type":"string","description":"A1-style reference"}},"required":["cell"]}`
	spikePrompt     = "Sheet Demo has one sheet named Sheet1. Read cell A1 with the get_cell tool, then tell me its value."
	spikeResult     = `{"sheet":"Sheet1","cell":"A1","value":42}`
	spikeMaxTokens  = 512
)

// TestUpstreamSpike is the harness. It is skipped unless SPIKE_MODE is fake or
// dev, so CI and the ordinary unit run never touch it.
func TestUpstreamSpike(t *testing.T) {
	mode := strings.TrimSpace(os.Getenv("SPIKE_MODE"))
	if mode != "fake" && mode != "dev" {
		t.Skip("set SPIKE_MODE=fake|dev (scripts/office/ai-upstream-spike.sh)")
	}
	loops := spikeEnvInt("SPIKE_LOOPS", 10)
	timeout := time.Duration(spikeEnvInt("SPIKE_TIMEOUT_SECONDS", 120)) * time.Second
	model := spikeModel(mode)

	ctx, cancel := context.WithTimeout(context.Background(), timeout*time.Duration(loops+2))
	defer cancel()

	var p Provider
	if mode == "fake" {
		p = &Fake{}
	} else {
		base, key := os.Getenv("OPENAI_BASE_URL"), os.Getenv("OPENAI_API_KEY")
		if base == "" || key == "" {
			t.Fatal("dev mode needs OPENAI_BASE_URL and OPENAI_API_KEY (source scripts/office/ai-upstream-spike-env.sh)")
		}
		p = NewOpenAI(base, key, timeout)
	}

	summary := spikeSummary{
		Mode: mode, Provider: p.Name(), StartedAt: time.Now().UTC().Format(time.RFC3339),
		Model: model, Loops: loops,
	}
	tools := []ToolSpec{{Name: spikeToolName, Description: "Read one cell of the synthetic sheet Demo.", Schema: json.RawMessage(spikeToolSchema)}}

	var call1, call2, full []int64
	for i := 0; i < loops; i++ {
		res := spikeLoop(ctx, p, model, tools)
		switch {
		case res.Err != "":
			summary.recordError("loop", res.Err)
			continue
		case res.FirstCallID == "":
			summary.LoopsWithoutCall++
			continue
		}
		summary.LoopsWithToolCall++
		summary.recordUsage(res)
		call1 = append(call1, res.FirstMS)
		call2 = append(call2, res.SecondMS)
		full = append(full, res.LoopMS)
		switch {
		case res.SentToolCallID != res.FirstCallID:
			summary.IDRoundTripFailed++
			summary.Notes = append(summary.Notes, fmt.Sprintf("loop %d: response id %q, tool_call_id sent %q", i+1, res.FirstCallID, res.SentToolCallID))
		default:
			summary.IDRoundTripOK++
		}
		if res.AnswerEchoesID {
			summary.AnswersEchoingID++
		}
		if res.SecondToolCalls != 0 {
			summary.SecondTurnCalls += res.SecondToolCalls
		}
		summary.StopReasons = spikeAppendUnique(summary.StopReasons, res.StopReason)
		summary.StopReasons = spikeAppendUnique(summary.StopReasons, res.SecondStopReason)
	}
	summary.Latency = spikeLatency(call1, call2, full)

	if mode == "dev" {
		var all []string
		all, summary.ModelListStatus = spikeModelNames(ctx, timeout)
		summary.ModelNameCount = len(all)
		// model_in_list is decided on the whole list, before the sample below
		// is capped: the configured model may sit anywhere in it.
		for _, name := range all {
			if name == model {
				summary.ModelInList = true
				break
			}
		}
		summary.ModelNames = all
		if len(summary.ModelNames) > spikeModelNameCap {
			summary.ModelNames = summary.ModelNames[:spikeModelNameCap]
			summary.Notes = append(summary.Notes, fmt.Sprintf("model list truncated to the first %d names", spikeModelNameCap))
		}
		summary.Stream = spikeStreamProbe(ctx, timeout, model, tools)
		summary.recordStreamErrors(summary.Stream)
	}
	spikeWriteSummary(t, &summary)

	switch {
	case summary.IDRoundTripOK+summary.IDRoundTripFailed == 0:
		t.Fatalf("no loop completed a tool call (%d loops, %d errors); statuses: %s", loops, len(summary.Errors), summary.errorStatuses())
	case summary.IDRoundTripFailed > 0:
		t.Fatalf("tool-call id did not survive the round trip in %d/%d loops", summary.IDRoundTripFailed, summary.IDRoundTripOK+summary.IDRoundTripFailed)
	case mode == "fake" && summary.IDRoundTripOK != loops:
		t.Fatalf("fake mode must round-trip every loop: %d/%d", summary.IDRoundTripOK, loops)
	}
}

// ---- one loop -------------------------------------------------------------

type spikeLoopResult struct {
	FirstCallID      string
	SentToolCallID   string
	SecondToolCalls  int
	AnswerEchoesID   bool
	FirstUsage       bool
	SecondUsage      bool
	FirstIn          int
	FirstOut         int
	SecondIn         int
	SecondOut        int
	StopReason       string
	SecondStopReason string
	FirstMS          int64
	SecondMS         int64
	LoopMS           int64
	Err              string
}

// spikeLoop runs the two model calls of one turn and reports what came back.
// Errors are returned redacted: they end up in the summary file.
func spikeLoop(ctx context.Context, p Provider, model string, tools []ToolSpec) spikeLoopResult {
	var res spikeLoopResult
	started := time.Now()
	history := []Message{{Role: "user", Content: spikePrompt}}

	t0 := time.Now()
	first, err := p.Complete(ctx, CompletionRequest{Model: model, MaxTokens: spikeMaxTokens, Messages: history, Tools: tools})
	res.FirstMS = time.Since(t0).Milliseconds()
	if err != nil {
		res.Err = spikeRedact(err.Error())
		return res
	}
	res.FirstUsage, res.FirstIn, res.FirstOut, res.StopReason = first.UsagePresent, first.InputTokens, first.OutputTokens, first.StopReason
	if len(first.ToolCalls) == 0 {
		return res
	}
	res.FirstCallID = first.ToolCalls[0].ID

	history = append(history, Message{Role: "assistant", ToolCalls: first.ToolCalls})
	history = append(history, Message{Role: "tool", ToolCallID: first.ToolCalls[0].ID, Content: spikeResult})
	res.SentToolCallID = history[len(history)-1].ToolCallID

	t1 := time.Now()
	second, err := p.Complete(ctx, CompletionRequest{Model: model, MaxTokens: spikeMaxTokens, Messages: history, Tools: tools})
	res.SecondMS = time.Since(t1).Milliseconds()
	res.LoopMS = time.Since(started).Milliseconds()
	if err != nil {
		res.Err = spikeRedact(err.Error())
		return res
	}
	res.SecondUsage, res.SecondIn, res.SecondOut = second.UsagePresent, second.InputTokens, second.OutputTokens
	res.SecondStopReason = second.StopReason
	res.SecondToolCalls = len(second.ToolCalls)
	res.AnswerEchoesID = res.FirstCallID != "" && strings.Contains(second.Text, res.FirstCallID)
	return res
}

// ---- stream probe (dev only) ---------------------------------------------

type spikeStream struct {
	Status            int      `json:"status"`
	Chunks            int      `json:"chunks"`
	ToolCallDelta     bool     `json:"tool_call_delta"`
	ToolCallIDOnFirst bool     `json:"tool_call_id_on_first_delta"`
	ToolCallID        string   `json:"tool_call_id,omitempty"`
	UsageChunk        bool     `json:"usage_chunk"`
	FinishReasons     []string `json:"finish_reasons"`
	Err               string   `json:"err,omitempty"`
}

// spikeStreamProbe sends one raw stream:true request with tools and
// stream_options.include_usage, and counts what the SSE body did. It is the
// only place the harness speaks HTTP itself: provider.Provider has no stream
// method yet (spec §6.2, G6-D1 decides whether one is added).
func spikeStreamProbe(ctx context.Context, timeout time.Duration, model string, tools []ToolSpec) *spikeStream {
	out := &spikeStream{}
	base, key := os.Getenv("OPENAI_BASE_URL"), os.Getenv("OPENAI_API_KEY")
	body, err := json.Marshal(map[string]any{
		"model": model, "stream": true, "max_tokens": spikeMaxTokens,
		"stream_options": map[string]any{"include_usage": true},
		"messages":       []map[string]any{{"role": "user", "content": spikePrompt}},
		"tools":          []map[string]any{{"type": "function", "function": map[string]any{"name": spikeToolName, "parameters": json.RawMessage(spikeToolSchema)}}},
	})
	if err != nil {
		out.Err = spikeRedact(err.Error())
		return out
	}
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, strings.TrimSuffix(base, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		out.Err = spikeRedact(err.Error())
		return out
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		out.Err = spikeRedact(err.Error())
		return out
	}
	defer res.Body.Close()
	out.Status = res.StatusCode
	if res.StatusCode < 200 || res.StatusCode > 299 {
		out.Err = "stream request refused"
		return out
	}
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 0, 64<<10), 4<<20)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		data, ok := strings.CutPrefix(line, "data:")
		if !ok {
			continue
		}
		data = strings.TrimSpace(data)
		if data == "" || data == "[DONE]" {
			continue
		}
		out.Chunks++
		var chunk struct {
			Choices []struct {
				Delta struct {
					ToolCalls []struct {
						ID string `json:"id"`
					} `json:"tool_calls"`
				} `json:"delta"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
			Usage json.RawMessage `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		if len(chunk.Usage) > 0 && string(chunk.Usage) != "null" {
			out.UsageChunk = true
		}
		for _, c := range chunk.Choices {
			if c.FinishReason != "" {
				out.FinishReasons = spikeAppendUnique(out.FinishReasons, c.FinishReason)
			}
			if len(c.Delta.ToolCalls) > 0 {
				id := c.Delta.ToolCalls[0].ID
				if !out.ToolCallDelta {
					out.ToolCallDelta = true
					out.ToolCallIDOnFirst = id != ""
				}
				if id != "" && out.ToolCallID == "" {
					out.ToolCallID = id
				}
			}
		}
	}
	if err := sc.Err(); err != nil {
		out.Err = spikeRedact(err.Error())
	}
	return out
}

// ---- model list (dev only) ------------------------------------------------

// spikeModelNames reads GET /v1/models and returns every name, sorted. Only
// names are kept: the base URL, host and key never reach the summary. The
// caller decides what to sample from the list.
func spikeModelNames(ctx context.Context, timeout time.Duration) (names []string, status int) {
	base, key := os.Getenv("OPENAI_BASE_URL"), os.Getenv("OPENAI_API_KEY")
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(cctx, http.MethodGet, strings.TrimSuffix(base, "/")+"/models", nil)
	if err != nil {
		return nil, 0
	}
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	res, err := (&http.Client{Timeout: timeout}).Do(req)
	if err != nil {
		return nil, 0
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, res.StatusCode
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	// This upstream lists thousands of names; read generously but keep only a
	// bounded sample so the summary stays small.
	if json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(&out) != nil {
		return nil, res.StatusCode
	}
	names = make([]string, 0, len(out.Data))
	for _, m := range out.Data {
		names = append(names, m.ID)
	}
	sort.Strings(names)
	return names, res.StatusCode
}

// spikeModelNameCap bounds how many model names the summary carries.
const spikeModelNameCap = 200

// ---- summary --------------------------------------------------------------

type spikeSummary struct {
	Mode              string        `json:"mode"`
	Provider          string        `json:"provider"`
	StartedAt         string        `json:"started_at"`
	Model             string        `json:"model"`
	Loops             int           `json:"loops"`
	LoopsWithToolCall int           `json:"loops_with_tool_call"`
	LoopsWithoutCall  int           `json:"loops_without_tool_call"`
	IDRoundTripOK     int           `json:"id_round_trip_ok"`
	IDRoundTripFailed int           `json:"id_round_trip_failed"`
	AnswersEchoingID  int           `json:"answers_echoing_id"`
	SecondTurnCalls   int           `json:"second_turn_tool_calls"`
	StopReasons       []string      `json:"stop_reasons"`
	Usage             spikeUsage    `json:"usage"`
	Latency           spikeLatencyT `json:"latency_ms"`
	ModelNames        []string      `json:"model_names,omitempty"`
	ModelNameCount    int           `json:"model_name_count,omitempty"`
	ModelInList       bool          `json:"model_in_list"`
	ModelListStatus   int           `json:"model_list_status,omitempty"`
	Stream            *spikeStream  `json:"stream,omitempty"`
	Errors            []spikeError  `json:"errors"`
	Notes             []string      `json:"notes,omitempty"`
}

type spikeUsage struct {
	FirstPresent  int   `json:"first_call_usage_present"`
	FirstMissing  int   `json:"first_call_usage_missing"`
	SecondPresent int   `json:"second_call_usage_present"`
	SecondMissing int   `json:"second_call_usage_missing"`
	FirstIn       []int `json:"first_call_prompt_tokens,omitempty"`
	FirstOut      []int `json:"first_call_completion_tokens,omitempty"`
	SecondIn      []int `json:"second_call_prompt_tokens,omitempty"`
	SecondOut     []int `json:"second_call_completion_tokens,omitempty"`
}

type spikeLatencyT struct {
	Call1P50 int64 `json:"call1_p50"`
	Call1P95 int64 `json:"call1_p95"`
	Call2P50 int64 `json:"call2_p50"`
	Call2P95 int64 `json:"call2_p95"`
	LoopP50  int64 `json:"loop_p50"`
	LoopP95  int64 `json:"loop_p95"`
}

type spikeError struct {
	Phase  string `json:"phase"`
	Status int    `json:"status"`
	Count  int    `json:"count"`
}

func (s *spikeSummary) recordUsage(r spikeLoopResult) {
	if r.FirstUsage {
		s.Usage.FirstPresent++
		s.Usage.FirstIn = append(s.Usage.FirstIn, r.FirstIn)
		s.Usage.FirstOut = append(s.Usage.FirstOut, r.FirstOut)
	} else {
		s.Usage.FirstMissing++
	}
	if r.SecondUsage {
		s.Usage.SecondPresent++
		s.Usage.SecondIn = append(s.Usage.SecondIn, r.SecondIn)
		s.Usage.SecondOut = append(s.Usage.SecondOut, r.SecondOut)
	} else {
		s.Usage.SecondMissing++
	}
}

// recordError keeps the status code only: a vendor body may echo the prompt or
// the key, and the message may carry the host.
func (s *spikeSummary) recordError(phase, msg string) {
	status := spikeStatus(msg)
	for i := range s.Errors {
		if s.Errors[i].Phase == phase && s.Errors[i].Status == status {
			s.Errors[i].Count++
			return
		}
	}
	s.Errors = append(s.Errors, spikeError{Phase: phase, Status: status, Count: 1})
}

func (s *spikeSummary) recordStreamErrors(st *spikeStream) {
	if st == nil || st.Err == "" {
		return
	}
	s.recordError("stream", st.Err)
}

func (s *spikeSummary) errorStatuses() string {
	if len(s.Errors) == 0 {
		return "none"
	}
	parts := make([]string, 0, len(s.Errors))
	for _, e := range s.Errors {
		parts = append(parts, fmt.Sprintf("%s=%d", e.Phase, e.Status))
	}
	return strings.Join(parts, " ")
}

var spikeStatusRe = regexp.MustCompile(`(?:→|\s)([1-5][0-9][0-9])(?::|\s|$)`)

// spikeStatus pulls the HTTP status out of a provider error and drops
// everything else, including the body snippet postJSON appends.
func spikeStatus(msg string) int {
	m := spikeStatusRe.FindStringSubmatch(msg)
	if m == nil {
		return 0
	}
	var code int
	_, _ = fmt.Sscanf(m[1], "%d", &code)
	return code
}

// spikeWriteSummary writes <SPIKE_OUT>.json and <SPIKE_OUT>.txt. Without
// SPIKE_OUT it writes nothing and only logs: the wrappers set it.
func spikeWriteSummary(t *testing.T, s *spikeSummary) {
	t.Helper()
	text := spikeText(s)
	t.Log("\n" + text)
	base := strings.TrimSpace(os.Getenv("SPIKE_OUT"))
	if base == "" {
		t.Log("SPIKE_OUT unset: summary not written")
		return
	}
	if err := os.MkdirAll(filepath.Dir(base), 0o755); err != nil {
		t.Fatalf("spike output dir: %v", err)
	}
	blob, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(base+".json", append(blob, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(base+".txt", []byte(text+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("spike summary written to %s.json and %s.txt", base, base)
}

func spikeText(s *spikeSummary) string {
	var b strings.Builder
	fmt.Fprintf(&b, "UNI-1364 G6-02 upstream spike — mode=%s provider=%s model=%s\n", s.Mode, s.Provider, s.Model)
	fmt.Fprintf(&b, "started %s, %d loops\n", s.StartedAt, s.Loops)
	if len(s.ModelNames) > 0 {
		fmt.Fprintf(&b, "GET /v1/models → status %d, %d names, configured model present: %v (sample of %d): %s\n",
			s.ModelListStatus, s.ModelNameCount, s.ModelInList, len(s.ModelNames), strings.Join(s.ModelNames, ", "))
	} else {
		fmt.Fprintf(&b, "GET /v1/models → status %d, no names read\n", s.ModelListStatus)
	}
	fmt.Fprintf(&b, "tool call returned: %d loops; no tool call: %d\n", s.LoopsWithToolCall, s.LoopsWithoutCall)
	fmt.Fprintf(&b, "tool-call id round trip: ok=%d failed=%d; answer echoed the id: %d; extra tool calls on turn 2: %d\n",
		s.IDRoundTripOK, s.IDRoundTripFailed, s.AnswersEchoingID, s.SecondTurnCalls)
	fmt.Fprintf(&b, "usage present/missing: turn1 %d/%d, turn2 %d/%d\n",
		s.Usage.FirstPresent, s.Usage.FirstMissing, s.Usage.SecondPresent, s.Usage.SecondMissing)
	if len(s.Usage.FirstIn) > 0 {
		fmt.Fprintf(&b, "turn1 prompt tokens %v, completion tokens %v\n", s.Usage.FirstIn, s.Usage.FirstOut)
	}
	if len(s.Usage.SecondIn) > 0 {
		fmt.Fprintf(&b, "turn2 prompt tokens %v, completion tokens %v\n", s.Usage.SecondIn, s.Usage.SecondOut)
	}
	fmt.Fprintf(&b, "latency ms: call1 p50=%d p95=%d, call2 p50=%d p95=%d, loop p50=%d p95=%d\n",
		s.Latency.Call1P50, s.Latency.Call1P95, s.Latency.Call2P50, s.Latency.Call2P95, s.Latency.LoopP50, s.Latency.LoopP95)
	fmt.Fprintf(&b, "stop reasons seen: %v\n", s.StopReasons)
	if s.Stream != nil {
		fmt.Fprintf(&b, "stream: status=%d chunks=%d tool_call_delta=%v id_on_first_delta=%v usage_chunk=%v finish=%v err=%q\n",
			s.Stream.Status, s.Stream.Chunks, s.Stream.ToolCallDelta, s.Stream.ToolCallIDOnFirst, s.Stream.UsageChunk, s.Stream.FinishReasons, s.Stream.Err)
	}
	for _, e := range s.Errors {
		fmt.Fprintf(&b, "error: phase=%s status=%d count=%d\n", e.Phase, e.Status, e.Count)
	}
	for _, n := range s.Notes {
		fmt.Fprintf(&b, "note: %s\n", n)
	}
	return b.String()
}

// ---- helpers --------------------------------------------------------------

// spikeRedact is the one gate every string that leaves the harness passes
// through: the upstream's URL, host and key become placeholders.
func spikeRedact(s string) string {
	out := s
	for _, secret := range []string{os.Getenv("OPENAI_BASE_URL"), os.Getenv("OPENAI_API_KEY")} {
		if secret == "" {
			continue
		}
		out = strings.ReplaceAll(out, secret, "<upstream>")
		out = strings.ReplaceAll(out, strings.TrimSuffix(secret, "/"), "<upstream>")
	}
	if base := strings.TrimSpace(os.Getenv("OPENAI_BASE_URL")); base != "" {
		if u, err := url.Parse(base); err == nil {
			for _, part := range []string{u.Host, u.Hostname()} {
				if part != "" {
					out = strings.ReplaceAll(out, part, "<upstream>")
				}
			}
		}
	}
	return out
}

func spikeModel(mode string) string {
	for _, key := range []string{"SPIKE_MODEL", "AI_MODEL_OFFICE_UNIWORK_AI"} {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
	}
	if mode == "fake" {
		return "fake"
	}
	return ""
}

func spikeEnvInt(key string, def int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def
	}
	n := 0
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n <= 0 {
		return def
	}
	return n
}

// spikeLatency reports p50/p95 by nearest rank; an empty sample is 0.
func spikeLatency(call1, call2, loop []int64) spikeLatencyT {
	return spikeLatencyT{
		Call1P50: spikePercentile(call1, 0.50), Call1P95: spikePercentile(call1, 0.95),
		Call2P50: spikePercentile(call2, 0.50), Call2P95: spikePercentile(call2, 0.95),
		LoopP50: spikePercentile(loop, 0.50), LoopP95: spikePercentile(loop, 0.95),
	}
}

func spikePercentile(xs []int64, q float64) int64 {
	if len(xs) == 0 {
		return 0
	}
	sorted := append([]int64(nil), xs...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	idx := int(q*float64(len(sorted)) + 0.999999)
	if idx < 1 {
		idx = 1
	}
	if idx > len(sorted) {
		idx = len(sorted)
	}
	return sorted[idx-1]
}

func spikeAppendUnique(xs []string, v string) []string {
	if v == "" {
		return xs
	}
	for _, x := range xs {
		if x == v {
			return xs
		}
	}
	return append(xs, v)
}
