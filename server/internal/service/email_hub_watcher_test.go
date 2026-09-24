package service

import (
	"context"
	"testing"
)

func TestEmailHubHubWatcherUnsubscribe(t *testing.T) {
	w := newEmailHubHubWatcher(nil)
	ctx, cancel := context.WithCancel(context.Background())
	w.refs["acc-1"] = 2
	w.stop["acc-1"] = cancel

	w.unsubscribe("acc-1")
	if w.refs["acc-1"] != 1 {
		t.Fatalf("refs after first unsubscribe = %d, want 1", w.refs["acc-1"])
	}
	if _, ok := w.stop["acc-1"]; !ok {
		t.Fatal("watch should stay active while refs remain")
	}

	w.unsubscribe("acc-1")
	if _, ok := w.refs["acc-1"]; ok {
		t.Fatal("refs should be cleared after last unsubscribe")
	}
	if _, ok := w.stop["acc-1"]; ok {
		t.Fatal("stop should be cleared after last unsubscribe")
	}
	if ctx.Err() == nil {
		t.Fatal("last unsubscribe should cancel the watch context")
	}
}

func TestEmailHubHubWatcherForceStop(t *testing.T) {
	w := newEmailHubHubWatcher(nil)
	w.refs["acc-1"] = 3
	ctx, cancel := context.WithCancel(context.Background())
	w.stop["acc-1"] = cancel

	w.forceStop("acc-1")

	if _, ok := w.refs["acc-1"]; ok {
		t.Fatal("refs should be cleared on forceStop")
	}
	if _, ok := w.stop["acc-1"]; ok {
		t.Fatal("stop should be cleared on forceStop")
	}
	if ctx.Err() == nil {
		t.Fatal("forceStop should cancel the watch context")
	}
}
