package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type receiptCounter struct {
	mu   sync.Mutex
	seen map[string]int
}

func (c *receiptCounter) IncPushReceipt(result string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seen[result]++
}

// fakeExpoReceipts answers getReceipts from a fixed table; ids it does not
// know have no receipt yet. It records each call's ids and its auth header.
type fakeExpoReceipts struct {
	mu       sync.Mutex
	receipts map[string]string // id → `{"status":…}` JSON
	calls    [][]string
	auth     string
	fail     bool
}

func (f *fakeExpoReceipts) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var in struct {
		IDs []string `json:"ids"`
	}
	_ = json.NewDecoder(r.Body).Decode(&in)
	f.calls = append(f.calls, in.IDs)
	f.auth = r.Header.Get("Authorization")
	if f.fail {
		w.WriteHeader(http.StatusBadGateway)
		return
	}
	out := map[string]json.RawMessage{}
	for _, id := range in.IDs {
		if rc, ok := f.receipts[id]; ok {
			out[id] = json.RawMessage(rc)
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": out})
}

func newTestReceipts(t *testing.T, fake *fakeExpoReceipts) (*ExpoReceipts, *[]string, *receiptCounter, *time.Time) {
	t.Helper()
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	var revoked []string
	r := NewExpoReceipts("secret", func(_ context.Context, id string) error {
		revoked = append(revoked, id)
		if id == "sub-revoke-fails" {
			return errors.New("db down")
		}
		return nil
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	r.URL = srv.URL
	counter := &receiptCounter{seen: map[string]int{}}
	r.SetMetrics(counter)
	now := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	r.now = func() time.Time { return now }
	return r, &revoked, counter, &now
}

// The audit's P2 Release row: a ticket "ok" is not a delivery. The receipt
// read later revokes a phone that uninstalled the app and counts every outcome.
func TestExpoReceiptsRevokeGoneDevicesAndCountEveryResult(t *testing.T) {
	fake := &fakeExpoReceipts{receipts: map[string]string{
		"t-ok":     `{"status":"ok"}`,
		"t-gone":   `{"status":"error","message":"\"ExponentPushToken[x]\" is not a registered push notification recipient","details":{"error":"DeviceNotRegistered"}}`,
		"t-gone2":  `{"status":"error","details":{"error":"DeviceNotRegistered"}}`,
		"t-creds":  `{"status":"error","details":{"error":"InvalidCredentials"}}`,
		"t-big":    `{"status":"error","details":{"error":"MessageTooBig"}}`,
		"t-odd":    `{"status":"error","details":{"error":"SomethingNew"}}`,
		"t-sender": `{"status":"error","details":{"error":"MismatchSenderId"}}`,
		"t-rate":   `{"status":"error","details":{"error":"MessageRateExceeded"}}`,
	}}
	r, revoked, counter, now := newTestReceipts(t, fake)
	for _, id := range []string{"t-ok", "t-gone", "t-gone2", "t-creds", "t-big", "t-odd", "t-sender", "t-rate", "t-late"} {
		sub := "sub-" + id
		if id == "t-gone2" {
			sub = "sub-revoke-fails"
		}
		r.Track(id, sub)
	}
	r.Track("", "sub-no-ticket") // a ticket without an id is not tracked

	// Too early: Expo has not written the receipts yet, nothing is asked.
	*now = now.Add(receiptDelay - time.Second)
	r.Check(context.Background())
	if len(fake.calls) != 0 {
		t.Fatalf("asked for receipts before they are due: %v", fake.calls)
	}

	*now = now.Add(time.Second)
	r.Check(context.Background())
	if len(fake.calls) != 1 || len(fake.calls[0]) != 9 || fake.auth != "Bearer secret" {
		t.Fatalf("calls = %v auth = %q, want one call for the nine tracked tickets with the access token", fake.calls, fake.auth)
	}
	if !slices.Equal(*revoked, []string{"sub-t-gone", "sub-revoke-fails"}) {
		t.Fatalf("revoked = %v, want the two unregistered devices' subscriptions", *revoked)
	}
	want := map[string]int{"ok": 1, "device_not_registered": 2, "invalid_credentials": 1, "message_too_big": 1, "error": 1, "mismatch_sender_id": 1, "message_rate_exceeded": 1}
	if fmt.Sprint(counter.seen) != fmt.Sprint(want) {
		t.Fatalf("counted %v, want %v", counter.seen, want)
	}

	// The receipt not written yet is asked again, then expires after a day.
	r.Check(context.Background())
	if len(fake.calls) != 2 || !slices.Equal(fake.calls[1], []string{"t-late"}) {
		t.Fatalf("second round asked %v, want only the pending ticket", fake.calls[1:])
	}
	*now = now.Add(receiptExpiry)
	r.Check(context.Background())
	if counter.seen["expired"] != 1 {
		t.Fatalf("counted %v, want the receipt that never came expired", counter.seen)
	}
	r.Check(context.Background())
	if len(fake.calls) != 3 {
		t.Fatalf("an expired ticket was asked for again: %v", fake.calls)
	}
}

func TestExpoReceiptsKeepTicketsWhenExpoFailsAndBatchThem(t *testing.T) {
	fake := &fakeExpoReceipts{receipts: map[string]string{}, fail: true}
	r, _, counter, now := newTestReceipts(t, fake)
	for i := range receiptBatch + 1 {
		id := fmt.Sprintf("t-%d", i)
		fake.receipts[id] = `{"status":"ok"}`
		r.Track(id, "sub")
	}
	*now = now.Add(receiptDelay)
	r.Check(context.Background())
	if len(fake.calls) != 1 || counter.seen["ok"] != 0 {
		t.Fatalf("calls = %d counted = %v, want one failed call and nothing settled", len(fake.calls), counter.seen)
	}
	fake.fail = false
	r.Check(context.Background())
	if len(fake.calls) != 3 || len(fake.calls[1]) != receiptBatch || len(fake.calls[2]) != 1 || counter.seen["ok"] != receiptBatch+1 {
		t.Fatalf("after recovery: %d calls (sizes %d, %d), counted %v; want two batches settling every ticket", len(fake.calls), len(fake.calls[1]), len(fake.calls[2]), counter.seen)
	}
}

func TestExpoReceiptsBoundTheirMemory(t *testing.T) {
	r, _, counter, _ := newTestReceipts(t, &fakeExpoReceipts{})
	for i := range receiptPendingCap + 2 {
		r.Track(fmt.Sprintf("t-%d", i), "sub")
	}
	if len(r.pending) != receiptPendingCap || r.pending[0].id != "t-2" || counter.seen["dropped"] != 2 {
		t.Fatalf("pending = %d (first %s), dropped = %d; want the cap with the oldest dropped", len(r.pending), r.pending[0].id, counter.seen["dropped"])
	}
	// A nil tracker (receipts not wired) accepts tickets and does nothing.
	var none *ExpoReceipts
	none.Track("t", "sub")
}

func TestExpoReceiptsRunStopsWithItsContext(t *testing.T) {
	fake := &fakeExpoReceipts{receipts: map[string]string{"t": `{"status":"ok"}`}}
	r, _, counter, _ := newTestReceipts(t, fake)
	r.now = func() time.Time { return time.Now().Add(receiptDelay) }
	r.interval = time.Millisecond
	r.pending = []expoTicket{{id: "t", subscriptionID: "sub", at: time.Now()}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { r.Run(ctx); close(done) }()
	deadline := time.After(5 * time.Second)
	for {
		fake.mu.Lock()
		n := len(fake.calls)
		fake.mu.Unlock()
		if n > 0 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("Run never read the due receipt")
		case <-time.After(time.Millisecond):
		}
	}
	cancel()
	<-done
	counter.mu.Lock()
	defer counter.mu.Unlock()
	if counter.seen["ok"] != 1 {
		t.Fatalf("counted %v, want the receipt read by Run", counter.seen)
	}
}

// The sender hands every accepted ticket to the receipt reader.
func TestExpoPushSenderTracksAcceptedTickets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"ticket-1"}]}`)
	}))
	defer srv.Close()
	r, _, _, _ := newTestReceipts(t, &fakeExpoReceipts{})
	s := ExpoPushSender{URL: srv.URL, Receipts: r}
	if err := s.Send(context.Background(), db.PushSubscription{ID: "sub-1", Endpoint: "ExponentPushToken[a]"}, PushMessage{Title: "x"}); err != nil {
		t.Fatal(err)
	}
	if len(r.pending) != 1 || r.pending[0].id != "ticket-1" || r.pending[0].subscriptionID != "sub-1" {
		t.Fatalf("pending = %+v, want the ticket and its subscription", r.pending)
	}
}
