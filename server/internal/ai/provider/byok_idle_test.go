package provider

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

// quietBody blocks in Read until the request is cancelled, then reports a
// clean EOF: the teardown race where the idle cancel surfaces as end of stream.
type quietBody struct{ ctx context.Context }

func (q quietBody) Read([]byte) (int, error) {
	<-q.ctx.Done()
	return 0, io.EOF
}

func (quietBody) Close() error { return nil }

func TestIdleBodyEOFAfterIdleTimeoutIsUnreachable(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := newIdleBody(quietBody{ctx: ctx}, 20*time.Millisecond, cancel)
	defer func() { _ = b.Close() }()

	_, err := b.Read(make([]byte, 8))
	if !errors.Is(err, ErrUnreachable) {
		t.Fatalf("idle timeout surfaced as EOF: err = %v, want ErrUnreachable", err)
	}
	if !strings.Contains(err.Error(), "idle timeout") {
		t.Fatalf("err = %v, want it to name the idle timeout", err)
	}
}

func TestIdleBodyEOFWithoutTimeoutPassesThrough(t *testing.T) {
	_, cancel := context.WithCancel(context.Background())
	defer cancel()
	b := newIdleBody(io.NopCloser(strings.NewReader("")), time.Minute, cancel)
	defer func() { _ = b.Close() }()

	if _, err := b.Read(make([]byte, 8)); err != io.EOF {
		t.Fatalf("err = %v, want io.EOF", err)
	}
}
