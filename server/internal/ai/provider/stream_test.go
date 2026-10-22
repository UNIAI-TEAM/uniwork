package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

func sse(w http.ResponseWriter, events ...[2]string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, e := range events {
		if e[0] != "" {
			fmt.Fprintf(w, "event: %s\n", e[0])
		}
		fmt.Fprintf(w, "data: %s\n\n", e[1])
	}
	w.(http.Flusher).Flush()
}

func anthropicStream(t *testing.T, h http.HandlerFunc) *Anthropic {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &Anthropic{client: anthropic.NewClient(option.WithAPIKey("k"), option.WithBaseURL(srv.URL), option.WithMaxRetries(0))}
}

var (
	aStart = [2]string{"message_start", `{"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-x","content":[],"stop_reason":null,"usage":{"input_tokens":120,"output_tokens":1}}}`}
	aText0 = [2]string{"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`}
	aStop0 = [2]string{"content_block_stop", `{"type":"content_block_stop","index":0}`}
	aEnd   = [2]string{"message_stop", `{"type":"message_stop"}`}
)

func aDelta(s string) [2]string {
	return [2]string{"content_block_delta", fmt.Sprintf(`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":%q}}`, s)}
}
func aMsgDelta(reason string) [2]string {
	return [2]string{"message_delta", fmt.Sprintf(`{"type":"message_delta","delta":{"stop_reason":%q,"stop_sequence":null},"usage":{"output_tokens":7}}`, reason)}
}

func TestAnthropicStreamDeliversTextAndUsage(t *testing.T) {
	a := anthropicStream(t, func(w http.ResponseWriter, r *http.Request) {
		sse(w, aStart, aText0, aDelta("Xin "), aDelta("chào"), aStop0, aMsgDelta("end_turn"), aEnd)
	})
	var got []string
	resp, err := a.Stream(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64, Messages: []Message{{Role: "user", Content: "q"}}}, func(s string) { got = append(got, s) })
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"Xin ", "chào"}) || resp.Text != "Xin chào" {
		t.Fatalf("deltas %q text %q", got, resp.Text)
	}
	if resp.InputTokens != 120 || resp.OutputTokens != 7 || !resp.UsagePresent || resp.StopReason != "end_turn" {
		t.Fatalf("usage %+v", resp)
	}
	var turn anthropic.MessageParam
	if err := json.Unmarshal(resp.Raw, &turn); err != nil || len(turn.Content) != 1 {
		t.Fatalf("raw not replayable: %v %s", err, resp.Raw)
	}
	// Replayable through Complete's request builder.
	if _, err := a.params(CompletionRequest{Messages: []Message{{Role: "assistant", Raw: resp.Raw}}}); err != nil {
		t.Fatal(err)
	}
}

func TestAnthropicStreamToolUse(t *testing.T) {
	a := anthropicStream(t, func(w http.ResponseWriter, r *http.Request) {
		sse(w, aStart,
			[2]string{"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu1","name":"search","input":{}}}`},
			[2]string{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"que"}}`},
			[2]string{"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"ry\":\"x\"}"}}`},
			aStop0, aMsgDelta("tool_use"), aEnd)
	})
	n := 0
	resp, err := a.Stream(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64}, func(string) { n++ })
	if err != nil || n != 0 {
		t.Fatalf("err %v deltas %d", err, n)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].ID != "tu1" || string(resp.ToolCalls[0].Input) != `{"query":"x"}` {
		t.Fatalf("calls %+v", resp.ToolCalls)
	}
}

func TestAnthropicStreamRefusal(t *testing.T) {
	a := anthropicStream(t, func(w http.ResponseWriter, r *http.Request) {
		sse(w, aStart, aMsgDelta("refusal"), aEnd)
	})
	resp, err := a.Stream(context.Background(), CompletionRequest{Model: "claude-x", MaxTokens: 64}, func(string) {})
	if !errors.Is(err, ErrRefused) || resp.OutputTokens != 7 {
		t.Fatalf("err %v resp %+v", err, resp)
	}
}

func TestAnthropicStreamCancelReturnsPartial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := anthropicStream(t, func(w http.ResponseWriter, r *http.Request) {
		sse(w, aStart, aText0, aDelta("Xin "))
		<-r.Context().Done()
	})
	resp, err := a.Stream(ctx, CompletionRequest{Model: "claude-x", MaxTokens: 64}, func(string) { cancel() })
	if !errors.Is(err, context.Canceled) || resp.Text != "Xin " || resp.InputTokens != 120 || resp.UsagePresent {
		t.Fatalf("err %v resp %+v", err, resp)
	}
}

func oaiStream(t *testing.T, lines ...string) (*OpenAI, *map[string]any) {
	t.Helper()
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "text/event-stream")
		for _, l := range lines {
			fmt.Fprintf(w, "data: %s\n\n", l)
		}
		w.(http.Flusher).Flush()
		if !strings.Contains(strings.Join(lines, ""), "[DONE]") {
			<-r.Context().Done()
		}
	}))
	t.Cleanup(srv.Close)
	return NewOpenAI(srv.URL, "k", time.Second), &body
}

func TestOpenAIStreamAccumulates(t *testing.T) {
	o, body := oaiStream(t,
		`{"model":"m1","choices":[{"delta":{"content":"Xin "}}]}`,
		`{"choices":[{"delta":{"content":"chào"}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search","arguments":"{\"q"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":1}"}}]},"finish_reason":"tool_calls"}]}`,
		`{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":7}}`,
		`[DONE]`)
	var got []string
	resp, err := o.Stream(context.Background(), CompletionRequest{Model: "m", MaxTokens: 8}, func(s string) { got = append(got, s) })
	if err != nil {
		t.Fatal(err)
	}
	if (*body)["stream"] != true || (*body)["stream_options"].(map[string]any)["include_usage"] != true {
		t.Fatalf("body %v", *body)
	}
	if !reflect.DeepEqual(got, []string{"Xin ", "chào"}) || resp.Text != "Xin chào" || resp.Model != "m1" || resp.StopReason != "tool_calls" {
		t.Fatalf("%q %+v", got, resp)
	}
	if !resp.UsagePresent || resp.InputTokens != 120 || resp.OutputTokens != 7 {
		t.Fatalf("usage %+v", resp)
	}
	if len(resp.ToolCalls) != 1 || resp.ToolCalls[0].ID != "c1" || resp.ToolCalls[0].Name != "search" || string(resp.ToolCalls[0].Input) != `{"q":1}` {
		t.Fatalf("calls %+v", resp.ToolCalls)
	}
}

func TestOpenAIStreamCancelReturnsPartial(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	o, _ := oaiStream(t, `{"choices":[{"delta":{"content":"Xin "}}]}`)
	resp, err := o.Stream(ctx, CompletionRequest{Model: "m", MaxTokens: 8}, func(string) { cancel() })
	if !errors.Is(err, context.Canceled) || resp.Text != "Xin " || resp.UsagePresent {
		t.Fatalf("err %v resp %+v", err, resp)
	}
}

func TestFakeStreamChunksAndCancel(t *testing.T) {
	reply := func(CompletionRequest) CompletionResponse {
		return CompletionResponse{Text: "abcdefghijklmnopqrst", UsagePresent: true}
	}
	f := &Fake{Reply: reply}
	var got []string
	resp, err := f.Stream(context.Background(), CompletionRequest{}, func(s string) { got = append(got, s) })
	if err != nil || len(got) != 3 || got[0] != "abcdefgh" || resp.Text != "abcdefghijklmnopqrst" {
		t.Fatalf("%v %q %+v", err, got, resp)
	}

	ctx, cancel := context.WithCancel(context.Background())
	f = &Fake{Reply: reply, StreamDelay: time.Hour}
	got = nil
	resp, err = f.Stream(ctx, CompletionRequest{}, func(s string) { got = append(got, s); cancel() })
	if !errors.Is(err, context.Canceled) || resp.Text != "abcdefgh" || len(got) != 1 || resp.UsagePresent {
		t.Fatalf("%v %q %+v", err, got, resp)
	}

	// A tool-call answer has no text, so no delta.
	f = &Fake{}
	n := 0
	resp, err = f.Stream(context.Background(), CompletionRequest{Tools: []ToolSpec{{Name: "t"}}, Messages: []Message{{Role: "user", Content: "q"}}}, func(string) { n++ })
	if err != nil || n != 0 || len(resp.ToolCalls) != 1 {
		t.Fatalf("%v %d %+v", err, n, resp)
	}
}
