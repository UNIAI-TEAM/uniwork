package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// expoPushTokenPattern matches the token the UniChat mobile app registers in
// place of a Web Push endpoint.
var expoPushTokenPattern = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$`)

func isExpoPushToken(endpoint string) bool { return expoPushTokenPattern.MatchString(endpoint) }

const expoPushURL = "https://exp.host/--/api/v2/push/send"

// ExpoPushSender delivers to the mobile app through Expo Push Service. It
// needs no configuration; AccessToken is only for Expo's enhanced security.
type ExpoPushSender struct {
	Client      *http.Client
	URL         string
	AccessToken string
}

type expoMessage struct {
	To        string            `json:"to"`
	Title     string            `json:"title"`
	Body      string            `json:"body,omitempty"`
	Data      map[string]string `json:"data"`
	Sound     string            `json:"sound"`
	ChannelID string            `json:"channelId"`
	TTL       int               `json:"ttl"`
	Priority  string            `json:"priority"`
}

type expoResponse struct {
	Data []struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// Send posts one message and maps its ticket: DeviceNotRegistered revokes the
// subscription, any other failure (ticket error, 429, 5xx) is retried.
func (s ExpoPushSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	payload, err := json.Marshal([]expoMessage{{
		To: sub.Endpoint, Title: msg.Title, Body: msg.Body,
		Data:  map[string]string{"url": msg.URL, "tag": msg.Tag},
		Sound: "default", ChannelID: "chat", TTL: int(time.Hour / time.Second), Priority: "high",
	}})
	if err != nil {
		return err
	}
	url := s.URL
	if url == "" {
		url = expoPushURL
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if s.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+s.AccessToken)
	}
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		// Read (and so drain) a bounded snippet: it keeps the connection
		// reusable and puts Expo's reason (bad token, bad request) in the log.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		return fmt.Errorf("expo push: %s: %s", resp.Status, bytes.TrimSpace(snippet))
	}
	var out expoResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return fmt.Errorf("expo push: decode response: %w", err)
	}
	if len(out.Data) != 1 {
		return fmt.Errorf("expo push: %d tickets for one message", len(out.Data))
	}
	t := out.Data[0]
	switch {
	case t.Status == "ok":
		return nil
	case t.Details.Error == "DeviceNotRegistered":
		return ErrSubscriptionGone
	default:
		return fmt.Errorf("expo push: %s: %s", t.Details.Error, t.Message)
	}
}

// ErrPushSkipped means the subscription was acknowledged without sending:
// a web subscription while VAPID is off.
var ErrPushSkipped = errors.New("push: skipped, no sender for this subscription")

// NewPrefixSender routes Expo tokens to expo and every other endpoint to web.
func NewPrefixSender(expo, web PushSender) PushSender { return prefixSender{expo, web} }

type prefixSender struct{ expo, web PushSender }

func (s prefixSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	if isExpoPushToken(sub.Endpoint) {
		return s.expo.Send(ctx, sub, msg)
	}
	// A web subscription cannot be sent while VAPID is off: acknowledge it.
	if s.web == nil {
		return ErrPushSkipped
	}
	return s.web.Send(ctx, sub, msg)
}
