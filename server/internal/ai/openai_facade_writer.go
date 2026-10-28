package ai

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// The writer route's stream (plan 5): unlike the chat turn's one chunk (A14),
// a writer answer streams for real, because the Word, Markdown and HTML
// writers put text into the editor while the model writes. Every delta is one
// chat.completion.chunk as it arrives; the last chunk carries finish_reason
// and usage, or — when the call fails after text went out — x_uniwork.terminal
// with the code a JSON refusal would have carried, so the client treats the
// text as partial. [DONE] closes both. A failure before the first delta never
// opens the stream: the handler answers it as JSON.

// uniworkStreamWriteIdle is the longest one chunk write may block: the server
// has no WriteTimeout, and a client that stops reading must not pin the call
// and its concurrency slot (the BYOK stream's rule).
const uniworkStreamWriteIdle = 60 * time.Second

// UniworkDeltaStream writes one writer answer as SSE.
type UniworkDeltaStream struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	meta    UniworkResponseMeta
	id      string
	started bool
}

// NewUniworkDeltaStream prepares the stream; nothing is written until the
// first Delta, Finish or Fail.
func NewUniworkDeltaStream(w http.ResponseWriter, meta UniworkResponseMeta) *UniworkDeltaStream {
	return &UniworkDeltaStream{w: w, rc: http.NewResponseController(w), meta: meta, id: util.NewID()}
}

// Started reports whether the 200 and a chunk are out: from then on a failure
// can only end the stream (Fail), never become an HTTP status.
func (s *UniworkDeltaStream) Started() bool { return s.started }

// Delta writes one piece of text; the first one sends the SSE header and 200.
func (s *UniworkDeltaStream) Delta(text string) error {
	return s.chunk(UniworkChunk{
		Choices: []UniworkChunkChoice{{Index: 0, Delta: UniworkAssistant{Role: "assistant", Content: text}}},
	})
}

// Finish ends an answered call: a chunk with finish_reason and usage, then
// [DONE].
func (s *UniworkDeltaStream) Finish(resp Response) error {
	finish := "stop"
	if resp.StopReason == "max_tokens" || resp.StopReason == "length" {
		finish = "length"
	}
	if resp.Model != "" {
		s.meta.Model = resp.Model
	}
	if err := s.chunk(UniworkChunk{
		Choices: []UniworkChunkChoice{{Index: 0, Delta: UniworkAssistant{Role: "assistant"}, FinishReason: finish}},
		Usage:   uniworkUsage(resp),
	}); err != nil {
		return err
	}
	return s.write([]byte("[DONE]"))
}

// uniworkTerminalChunk is the last chunk of a failed stream: x_uniwork carries
// only the terminal frame A14 reserved.
type uniworkTerminalChunk struct {
	ID       string               `json:"id"`
	Object   string               `json:"object"`
	Created  int64                `json:"created"`
	Model    string               `json:"model"`
	Choices  []UniworkChunkChoice `json:"choices"`
	XUniwork struct {
		Terminal UniworkTerminal `json:"terminal"`
	} `json:"x_uniwork"`
}

// Fail ends a stream whose call failed: the terminal chunk naming code, then
// [DONE].
func (s *UniworkDeltaStream) Fail(code string) error {
	c := uniworkTerminalChunk{
		ID: s.id, Object: "chat.completion.chunk", Created: uniworkCreated(s.meta), Model: s.meta.Model,
		Choices: []UniworkChunkChoice{},
	}
	c.XUniwork.Terminal.Code = code
	payload, err := json.Marshal(c)
	if err != nil {
		return err
	}
	if err := s.write(payload); err != nil {
		return err
	}
	return s.write([]byte("[DONE]"))
}

// chunk fills the fields every chunk carries and writes it.
func (s *UniworkDeltaStream) chunk(c UniworkChunk) error {
	c.ID, c.Object, c.Created, c.Model = s.id, "chat.completion.chunk", uniworkCreated(s.meta), s.meta.Model
	payload, err := json.Marshal(c)
	if err != nil {
		return err
	}
	return s.write(payload)
}

// write sends one "data:" line, opening the stream first when it is not yet.
func (s *UniworkDeltaStream) write(data []byte) error {
	if !s.started {
		h := s.w.Header()
		h.Set("Content-Type", "text/event-stream; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Accel-Buffering", "no")
		s.w.WriteHeader(http.StatusOK)
		s.started = true
	}
	// A writer without deadline support (tests) keeps the old behaviour.
	_ = s.rc.SetWriteDeadline(time.Now().Add(uniworkStreamWriteIdle))
	if _, err := s.w.Write(append(append([]byte("data: "), data...), '\n', '\n')); err != nil {
		return err
	}
	if err := s.rc.Flush(); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	return nil
}
