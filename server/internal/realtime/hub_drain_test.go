package realtime

import (
	"context"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func expectServiceRestart(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	if _, _, err := conn.ReadMessage(); !websocket.IsCloseError(err, websocket.CloseServiceRestart) {
		t.Fatalf("read after drain = %v, want close code %d", err, websocket.CloseServiceRestart)
	}
}

func TestDrainConnectionsClosesEverySocketWithServiceRestartOverTheWindow(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	conns := make([]*websocket.Conn, 4)
	for i := range conns {
		conns[i] = connectWS(t, server)
		defer conns[i].Close()
	}
	waitFor(t, "client registration", func() bool { return totalClients(hub) == len(conns) })

	const window = 400 * time.Millisecond
	start := time.Now()
	hub.DrainConnections(context.Background(), window)
	elapsed := time.Since(start)

	// Batches are spread across the window, not fired at once.
	if elapsed < window/2 || elapsed > window+time.Second {
		t.Fatalf("drain took %v, want it spread over about %v", elapsed, window)
	}
	for _, c := range conns {
		expectServiceRestart(t, c)
	}
	waitFor(t, "clients to be unregistered", func() bool { return totalClients(hub) == 0 })
}

func TestDrainConnectionsClosesTheRestAtOnceWhenTheContextEnds(t *testing.T) {
	hub, server := newTestHub(t)
	defer server.Close()

	conns := make([]*websocket.Conn, 3)
	for i := range conns {
		conns[i] = connectWS(t, server)
		defer conns[i].Close()
	}
	waitFor(t, "client registration", func() bool { return totalClients(hub) == len(conns) })

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	hub.DrainConnections(ctx, time.Minute)
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("drain with an ended context took %v", elapsed)
	}
	for _, c := range conns {
		expectServiceRestart(t, c)
	}
}
