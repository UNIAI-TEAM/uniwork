package realtime

import (
	"testing"
	"time"
)

func recvOrTimeout(t *testing.T, ch <-chan []byte) []byte {
	t.Helper()
	select {
	case m := <-ch:
		return m
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for message")
		return nil
	}
}

func TestBroadcastToWorkspaceOnly(t *testing.T) {
	h := NewHub()
	c1 := NewClient(make(chan []byte, 8))
	c2 := NewClient(make(chan []byte, 8))
	other := NewClient(make(chan []byte, 8))
	h.Add("ws1", c1)
	h.Add("ws1", c2)
	h.Add("ws2", other)

	h.Broadcast("ws1", []byte("hello"))
	if string(recvOrTimeout(t, c1.Send())) != "hello" {
		t.Fatal("c1 missed")
	}
	if string(recvOrTimeout(t, c2.Send())) != "hello" {
		t.Fatal("c2 missed")
	}
	select {
	case <-other.Send():
		t.Fatal("ws2 client received ws1 message")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestRemoveStopsDelivery(t *testing.T) {
	h := NewHub()
	c := NewClient(make(chan []byte, 1))
	h.Add("ws1", c)
	h.Remove("ws1", c)
	h.Broadcast("ws1", []byte("x"))
	select {
	case <-c.Send():
		t.Fatal("removed client received message")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestSlowClientDoesNotBlock(t *testing.T) {
	h := NewHub()
	slow := NewClient(make(chan []byte)) // unbuffered, không ai đọc
	ok := NewClient(make(chan []byte, 8))
	h.Add("ws1", slow)
	h.Add("ws1", ok)
	done := make(chan struct{})
	go func() {
		h.Broadcast("ws1", []byte("m"))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("broadcast blocked on slow client")
	}
	recvOrTimeout(t, ok.Send())
}
