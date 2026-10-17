package notification

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestExpoPushSenderMapsTickets(t *testing.T) {
	var got []map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		got = nil // Decode would merge into the previous request's map
		_ = json.NewDecoder(r.Body).Decode(&got)
		switch got[0]["to"] {
		case "ExponentPushToken[gone]":
			_, _ = io.WriteString(w, `{"data":[{"status":"error","message":"x","details":{"error":"DeviceNotRegistered"}}]}`)
		case "ExponentPushToken[big]":
			_, _ = io.WriteString(w, `{"data":[{"status":"error","message":"x","details":{"error":"MessageTooBig"}}]}`)
		case "ExponentPushToken[busy]":
			w.WriteHeader(http.StatusTooManyRequests)
		case "ExponentPushToken[unauth]":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"errors":[{"code":"UNAUTHORIZED","message":"bad access token"}]}`+"\n")
		case "ExponentPushToken[down]":
			w.WriteHeader(http.StatusBadGateway)
		case "ExponentPushToken[garbage]":
			_, _ = io.WriteString(w, `{not json`)
		case "ExponentPushToken[none]":
			_, _ = io.WriteString(w, `{"data":[]}`)
		default:
			_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
		}
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL, AccessToken: "secret"}
	msg := PushMessage{Title: "Minh đã nhắn tin cho bạn", Body: "chào", URL: "https://app/x", Tag: "chat_room:r:dm"}
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[ok]"}, msg); err != nil {
		t.Fatal(err)
	}
	if auth != "Bearer secret" || got[0]["title"] != msg.Title || got[0]["body"] != "chào" || got[0]["channelId"] != "chat" || got[0]["priority"] != "high" || got[0]["ttl"] != float64(3600) || got[0]["data"].(map[string]any)["url"] != msg.URL || got[0]["data"].(map[string]any)["tag"] != msg.Tag {
		t.Fatalf("request = %v auth=%q", got, auth)
	}
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[gone]"}, msg); !errors.Is(err, ErrSubscriptionGone) {
		t.Fatalf("DeviceNotRegistered → %v", err)
	}
	// A 200 whose body is not a ticket (garbage, or no ticket at all) is a
	// retryable error too, never a revoke.
	for _, to := range []string{"ExponentPushToken[big]", "ExponentPushToken[busy]", "ExponentPushToken[down]", "ExponentPushToken[garbage]", "ExponentPushToken[none]"} {
		if err := s.Send(context.Background(), db.PushSubscription{Endpoint: to}, msg); err == nil || errors.Is(err, ErrSubscriptionGone) {
			t.Fatalf("%s → %v, want a retryable error", to, err)
		}
	}
	// A 4xx carries Expo's error code (never its message, which can echo
	// request values) into the error, so a wrong EXPO_ACCESS_TOKEN reads as
	// UNAUTHORIZED in the dead-letter log rather than just "401".
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[unauth]"}, msg); err == nil || !strings.Contains(err.Error(), "UNAUTHORIZED") || strings.Contains(err.Error(), "bad access token") {
		t.Fatalf("401 → %v, want Expo's error code and not its message", err)
	}
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[ok]"}, PushMessage{Title: "t"}); err != nil || got[0]["body"] != nil {
		t.Fatalf("empty body must be omitted: %v %v", got[0]["body"], err)
	}
	// A call ring lives as long as it rings (spec M3 §2), not the hour of a message.
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[ok]"}, PushMessage{Title: "t", TTL: 60}); err != nil || got[0]["ttl"] != float64(60) {
		t.Fatalf("ttl = %v, want the message's 60: %v", got[0]["ttl"], err)
	}
}

func TestPrefixSenderRoutesByEndpoint(t *testing.T) {
	expo, web := &spySender{}, &spySender{}
	s := NewPrefixSender(expo, web)
	for _, ep := range []string{"ExponentPushToken[a]", "ExpoPushToken[b-_c]", "https://fcm.googleapis.com/fcm/send/x"} {
		if err := s.Send(context.Background(), db.PushSubscription{Endpoint: ep}, PushMessage{Title: ep}); err != nil {
			t.Fatal(err)
		}
	}
	if len(expo.sent) != 2 || len(web.sent) != 1 || web.sent[0].Title != "https://fcm.googleapis.com/fcm/send/x" {
		t.Fatalf("expo=%d web=%d", len(expo.sent), len(web.sent))
	}
	if err := NewPrefixSender(expo, nil).Send(context.Background(), db.PushSubscription{Endpoint: "https://x"}, PushMessage{}); !errors.Is(err, ErrPushSkipped) {
		t.Fatalf("nil web sender = %v, want ErrPushSkipped", err)
	}
	for ep, want := range map[string]bool{"ExponentPushToken[abc]": true, "ExpoPushToken[abc]": true, "ExponentPushToken[]": false, "ExponentPushToken[a b]": false, "xExponentPushToken[a]": false, "https://a": false} {
		if isExpoPushToken(ep) != want {
			t.Errorf("isExpoPushToken(%q) = %v", ep, !want)
		}
	}
}
