package meetings

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestRoomEmptyTimeoutSeconds(t *testing.T) {
	if got := roomEmptyTimeoutSeconds(0, 0); got != controlPlaneEmptyTimeoutSeconds {
		t.Fatalf("zero config = %d want %d", got, controlPlaneEmptyTimeoutSeconds)
	}
	if got := roomEmptyTimeoutSeconds(10*time.Minute, 0); got != 600 {
		t.Fatalf("request override = %d", got)
	}
}

// hangingLiveKit accepts every Twirp call and never answers, the way a
// LiveKit node behaves when it is overloaded or partitioned. hits counts the
// calls that reached it.
func hangingLiveKit(t *testing.T, hits *atomic.Int64) *httptest.Server {
	t.Helper()
	stop := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		select {
		case <-r.Context().Done():
		case <-stop:
		}
	}))
	// Cleanups run last-registered first: release the handlers, then close.
	t.Cleanup(srv.Close)
	t.Cleanup(func() { close(stop) })
	return srv
}

// Every provider call carries its own deadline, so a hung LiveKit cannot hold
// the caller — an HTTP request or the shared outbox loop — open indefinitely.
func TestEveryProviderCallIsBounded(t *testing.T) {
	var hits atomic.Int64
	srv := hangingLiveKit(t, &hits)
	a := &LiveKitAdapter{
		URL: srv.URL, APIKey: "api-key", APISecret: "api-secret-at-least-32-characters!!",
		RPCTimeout: 100 * time.Millisecond,
		Recording:  &RecordingS3{Bucket: "recordings"},
	}
	calls := map[string]func(context.Context) error{
		"EnsureSession": func(ctx context.Context) error {
			_, err := a.EnsureSession(ctx, EnsureSessionRequest{RoomName: "r"})
			return err
		},
		"RemoveParticipant": func(ctx context.Context) error {
			return a.RemoveParticipant(ctx, RemoveProviderParticipantRequest{RoomName: "r", Identity: "i"})
		},
		"UpdateParticipant": func(ctx context.Context) error {
			return a.UpdateParticipant(ctx, UpdateProviderParticipantRequest{RoomName: "r", Identity: "i"})
		},
		"EndSession": func(ctx context.Context) error {
			return a.EndSession(ctx, EndProviderSessionRequest{RoomName: "r"})
		},
		"StartRecording": func(ctx context.Context) error {
			_, err := a.StartRecording(ctx, StartRecordingRequest{RoomName: "r", FilePrefix: "p"})
			return err
		},
		"StopRecording": func(ctx context.Context) error {
			return a.StopRecording(ctx, StopRecordingRequest{RecordingID: "eg"})
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			before := hits.Load()
			done := make(chan error, 1)
			go func() { done <- call(context.Background()) }()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("a call LiveKit never answered reported success")
				}
				// The error must come from the deadline on a call that went
				// out, not from a check that failed before reaching LiveKit.
				if hits.Load() == before {
					t.Fatalf("call failed without reaching LiveKit: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("call is still waiting on a LiveKit that never answers")
			}
		})
	}
}

func TestRPCTimeoutDefaults(t *testing.T) {
	a := &LiveKitAdapter{}
	if got := a.rpcTimeout(defaultRoomRPCTimeout); got != defaultRoomRPCTimeout {
		t.Fatalf("room default = %s", got)
	}
	if got := a.rpcTimeout(defaultEgressRPCTimeout); got != defaultEgressRPCTimeout {
		t.Fatalf("egress default = %s", got)
	}
	a.RPCTimeout = time.Second
	if got := a.rpcTimeout(defaultEgressRPCTimeout); got != time.Second {
		t.Fatalf("override = %s", got)
	}
}

// The Twirp clients are built once and shared: the adapter is called from
// many request goroutines at once, so lazy construction must not race (run
// with -race) and must not hand out a fresh client per call.
func TestClientsAreBuiltOnceUnderConcurrency(t *testing.T) {
	a := &LiveKitAdapter{URL: "http://127.0.0.1:1", APIKey: "k", APISecret: "s"}
	const n = 16
	rooms := make([]any, n)
	egresses := make([]any, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rooms[i] = a.client()
			egresses[i] = a.egress()
		}()
	}
	wg.Wait()
	for i := 1; i < n; i++ {
		if rooms[i] != rooms[0] || egresses[i] != egresses[0] {
			t.Fatalf("goroutine %d got a different client", i)
		}
	}
	if a.client() != rooms[0] || a.egress() != egresses[0] {
		t.Fatal("a later call built a new client")
	}
}
