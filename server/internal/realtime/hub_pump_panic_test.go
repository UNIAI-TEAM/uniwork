package realtime

import (
	"context"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type panickingScopeAuthorizer struct{}

func (panickingScopeAuthorizer) AuthorizeScope(context.Context, string, string, string, string) (bool, error) {
	panic("authorizer blew up")
}

// A panic inside one socket's read pump must not take the process down: the
// pump recovers, tears that socket down, and the hub keeps serving others.
func TestPanicInReadPumpClosesOnlyThatSocket(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()
	hub.SetAuthorizer(panickingScopeAuthorizer{})

	bystander := connectWS(t, server)
	defer bystander.Close()
	victim := connectWS(t, server)
	defer victim.Close()
	waitFor(t, "two clients registered", func() bool { return totalClients(hub) == 2 })

	if err := victim.WriteMessage(websocket.TextMessage,
		[]byte(`{"type":"subscribe","payload":{"scope":"task","id":"t1"}}`)); err != nil {
		t.Fatalf("write: %v", err)
	}

	_ = victim.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := victim.ReadMessage(); err != nil {
			break
		}
	}
	waitFor(t, "panicking socket unregistered", func() bool { return totalClients(hub) == 1 })

	if err := bystander.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping"}`)); err != nil {
		t.Fatalf("bystander write: %v", err)
	}
	_ = bystander.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, msg, err := bystander.ReadMessage()
	if err != nil {
		t.Fatalf("bystander read after the panic: %v", err)
	}
	if string(msg) != `{"type":"pong"}` {
		t.Fatalf("bystander got %s, want pong", msg)
	}
}
