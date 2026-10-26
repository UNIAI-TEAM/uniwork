package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"time"
)

// Expo push receipts. A ticket "ok" (ExpoPushSender.Send) only says Expo took
// the message; whether Apple or Google delivered it is in the receipt, ready
// some minutes later. A phone that uninstalled the app answers
// DeviceNotRegistered there and nowhere else until the next send to it, and
// credential or size failures never show at all without reading them.
//
// The tickets wait in memory, not in a table: this is delivery bookkeeping,
// not business state, and a restart that drops the pending ones loses only
// what the next send to that phone reports on its own ticket again.
const (
	expoReceiptsURL = "https://exp.host/--/api/v2/push/getReceipts"
	// Expo: receipts are usually ready within 15 minutes and kept for a day.
	receiptDelay  = 15 * time.Minute
	receiptExpiry = 24 * time.Hour
	// Expo takes up to 1000 ids per call; its own SDKs send 300.
	receiptBatch = 300
	// A bound on memory if Expo is unreachable for long: the oldest go first.
	receiptPendingCap = 10_000
	receiptInterval   = 5 * time.Minute
)

// ReceiptMetrics counts receipts by result; *metrics.Notifications satisfies it.
type ReceiptMetrics interface {
	IncPushReceipt(result string)
}

type expoTicket struct {
	id             string
	subscriptionID string
	at             time.Time
}

// ExpoReceipts tracks the ids of accepted Expo tickets and reads their
// receipts: DeviceNotRegistered revokes the subscription, every result is
// counted. A nil *ExpoReceipts tracks nothing.
type ExpoReceipts struct {
	Client      *http.Client
	URL         string
	AccessToken string

	revoke   func(ctx context.Context, subscriptionID string) error
	metrics  ReceiptMetrics
	log      *slog.Logger
	now      func() time.Time
	interval time.Duration

	mu      sync.Mutex
	pending []expoTicket
}

// NewExpoReceipts reads receipts with accessToken (Expo's enhanced security;
// empty is fine) and revokes a gone device's subscription through revoke.
func NewExpoReceipts(accessToken string, revoke func(ctx context.Context, subscriptionID string) error, log *slog.Logger) *ExpoReceipts {
	if log == nil {
		log = slog.Default()
	}
	return &ExpoReceipts{AccessToken: accessToken, revoke: revoke, log: log, now: time.Now, interval: receiptInterval}
}

// SetMetrics attaches the receipt counter.
func (r *ExpoReceipts) SetMetrics(m ReceiptMetrics) { r.metrics = m }

// Track remembers an accepted ticket until its receipt is read.
func (r *ExpoReceipts) Track(ticketID, subscriptionID string) {
	if r == nil || ticketID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.pending) >= receiptPendingCap {
		r.pending = r.pending[1:]
		r.count("dropped")
	}
	r.pending = append(r.pending, expoTicket{id: ticketID, subscriptionID: subscriptionID, at: r.now()})
}

// Run reads due receipts every interval until ctx ends.
func (r *ExpoReceipts) Run(ctx context.Context) {
	t := time.NewTicker(r.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			r.Check(ctx)
		}
	}
}

// Check reads the receipts of every ticket old enough to have one. A receipt
// Expo has not written yet is asked again next time, until it expires; a
// failed call keeps the rest of the tickets for the next round.
func (r *ExpoReceipts) Check(ctx context.Context) {
	due := r.takeDue()
	for start := 0; start < len(due); start += receiptBatch {
		batch := due[start:min(start+receiptBatch, len(due))]
		ids := make([]string, len(batch))
		for i, t := range batch {
			ids[i] = t.id
		}
		receipts, err := r.fetch(ctx, ids)
		if err != nil {
			r.log.Warn("expo receipts: fetch failed, kept for the next round", "err", err, "tickets", len(due)-start)
			r.requeue(due[start:])
			return
		}
		var later []expoTicket
		for _, t := range batch {
			rc, ok := receipts[t.id]
			if !ok {
				if r.now().Sub(t.at) < receiptExpiry {
					later = append(later, t)
				} else {
					r.count("expired")
				}
				continue
			}
			r.settle(ctx, t, rc)
		}
		r.requeue(later)
	}
}

type expoReceipt struct {
	Status  string `json:"status"`
	Details struct {
		Error string `json:"error"`
	} `json:"details"`
}

func (r *ExpoReceipts) settle(ctx context.Context, t expoTicket, rc expoReceipt) {
	if rc.Status == "ok" {
		r.count("ok")
		return
	}
	result := receiptResult(rc.Details.Error)
	r.count(result)
	switch rc.Details.Error {
	case "DeviceNotRegistered":
		if err := r.revoke(ctx, t.subscriptionID); err != nil {
			r.log.Warn("expo receipts: revoke failed", "subscription_id", t.subscriptionID, "err", err)
		}
	case "InvalidCredentials", "MismatchSenderId":
		// The FCM or APNs credentials on Expo are wrong: every push to that
		// platform fails, which is a setup problem, not a device one.
		r.log.Error("expo receipts: push credentials rejected", "code", rc.Details.Error)
	}
}

// receiptResult is the metric label of a failed receipt: Expo's documented
// codes, anything else as "error", so the label set stays bounded.
func receiptResult(code string) string {
	switch code {
	case "DeviceNotRegistered":
		return "device_not_registered"
	case "MessageTooBig":
		return "message_too_big"
	case "MessageRateExceeded":
		return "message_rate_exceeded"
	case "MismatchSenderId":
		return "mismatch_sender_id"
	case "InvalidCredentials":
		return "invalid_credentials"
	default:
		return "error"
	}
}

func (r *ExpoReceipts) takeDue() []expoTicket {
	cutoff := r.now().Add(-receiptDelay)
	r.mu.Lock()
	defer r.mu.Unlock()
	var due, waiting []expoTicket
	for _, t := range r.pending {
		if t.at.After(cutoff) {
			waiting = append(waiting, t)
		} else {
			due = append(due, t)
		}
	}
	r.pending = waiting
	return due
}

func (r *ExpoReceipts) requeue(tickets []expoTicket) {
	if len(tickets) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pending = slices.Concat(tickets, r.pending)
	if over := len(r.pending) - receiptPendingCap; over > 0 {
		r.pending = r.pending[over:]
		for range over {
			r.count("dropped")
		}
	}
}

func (r *ExpoReceipts) fetch(ctx context.Context, ids []string) (map[string]expoReceipt, error) {
	body, err := json.Marshal(map[string][]string{"ids": ids})
	if err != nil {
		return nil, err
	}
	url := r.URL
	if url == "" {
		url = expoReceiptsURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if r.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+r.AccessToken)
	}
	client := r.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		// Drained, never logged: Expo's messages can quote request values.
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		return nil, fmt.Errorf("expo receipts: %s", resp.Status)
	}
	var out struct {
		Data map[string]expoReceipt `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("expo receipts: decode response: %w", err)
	}
	return out.Data, nil
}

func (r *ExpoReceipts) count(result string) {
	if r.metrics != nil {
		r.metrics.IncPushReceipt(result)
	}
}
