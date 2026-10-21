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
	"strconv"
	"strings"
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
// Receipts, when set, gets every accepted ticket so the delivery outcome is
// read later (push_receipts.go).
type ExpoPushSender struct {
	Client      *http.Client
	URL         string
	AccessToken string
	Receipts    *ExpoReceipts
}

// expoMessage is one Expo push. With no title, body or sound it is a
// data-only message: Expo hands it to FCM as data, Android shows nothing on
// its own and the app's background task decides (the call UI).
type expoMessage struct {
	To        string            `json:"to"`
	Title     string            `json:"title,omitempty"`
	Body      string            `json:"body,omitempty"`
	Data      map[string]string `json:"data"`
	Sound     string            `json:"sound,omitempty"`
	ChannelID string            `json:"channelId,omitempty"`
	TTL       int               `json:"ttl"`
	Priority  string            `json:"priority"`
}

// The Android notification channels the app creates at launch, localized
// (apps/chat-mobile/lib/notification-channels.ts lists the same ids). A
// channel's sound and importance are fixed once created, so a change of either
// is a new id, never an edit of these.
const (
	ChannelCalls       = "calls"
	ChannelMissedCalls = "missed_calls"
	ChannelMentions    = "mentions"
	ChannelMessages    = "messages"
	ChannelGeneral     = "general"
)

// pushChannel files a notification kind under its channel, so a person can
// keep calls and mentions loud and silence the rest in the phone's settings.
func pushChannel(kind string) string {
	switch kind {
	case KindChatCallIncoming:
		return ChannelCalls
	case KindChatMentioned, KindMentioned, KindDocumentMentioned, KindDocumentBodyMentioned, KindDocumentDiscussionMentioned:
		return ChannelMentions
	case KindChatDM, KindChatThreadReplied:
		return ChannelMessages
	default:
		return ChannelGeneral
	}
}

// expoCallUIAgent is the user agent of a subscription from an Android build
// that draws its own incoming call (UniChat 0.3.0 and later say so with
// call_ui when they register; notification.Service.SubscribePush).
const expoCallUIAgent = "expo/android; call-ui"

// expoUserAgent is what a mobile subscription records: the platform, and the
// call-ui mark for an Android build with the native call UI. Only Android
// has one; an iPhone keeps the visible call push whatever it says.
func expoUserAgent(platform string, callUI bool) string {
	if platform == "android" && callUI {
		return expoCallUIAgent
	}
	return "expo/" + platform
}

// expoCallUI reports a subscription that gets call pushes as data-only
// messages. An Android build from before the call UI ("expo/android") has
// no task to turn one into a ring, so it keeps the visible push.
func expoCallUI(sub db.PushSubscription) bool {
	return sub.UserAgent.Valid && sub.UserAgent.String == expoCallUIAgent
}

// callData is the data a call push carries: ids, the names a ringing screen
// shows and when the ring ends. Nothing else about the room or the people.
func callData(msg PushMessage) map[string]string {
	c := msg.Call
	data := map[string]string{"type": c.Type, "call_id": c.CallID, "room_id": c.RoomID}
	if c.WorkspaceID != "" {
		data["workspace_id"] = c.WorkspaceID
	}
	if msg.URL != "" {
		data["url"] = msg.URL
	}
	if msg.Tag != "" {
		data["tag"] = msg.Tag
	}
	if c.Type != CallPushInvite {
		return data
	}
	data["caller_name"] = c.CallerName
	data["room_name"] = c.RoomName
	data["call_kind"] = c.CallKind
	data["video"] = "0"
	if c.Video {
		data["video"] = "1"
	}
	data["expires_at"] = strconv.FormatInt(c.ExpiresAt, 10)
	return data
}

// expoMessageFor shapes msg for one subscription. A ring and the end of one
// go to an Android build with the call UI as data-only, high-priority
// messages for the app's own call UI (a full-screen ringing screen, answer
// and decline); an iPhone and an older Android build keep the visible
// "X đang gọi" push and get no end, which they could not act on. A missed
// call is visible everywhere and names the call in its data. ok is false
// when this subscription gets nothing.
func expoMessageFor(sub db.PushSubscription, msg PushMessage) (expoMessage, bool) {
	callUI := expoCallUI(sub)
	switch msg.Call.Type {
	case CallPushEnd:
		if !callUI {
			return expoMessage{}, false
		}
		return expoMessage{To: sub.Endpoint, Data: callData(msg), TTL: msg.ttl(), Priority: "high"}, true
	case CallPushInvite:
		if callUI {
			return expoMessage{To: sub.Endpoint, Data: callData(msg), TTL: msg.ttl(), Priority: "high"}, true
		}
	}
	data := map[string]string{"url": msg.URL, "tag": msg.Tag}
	if msg.Call.Type != "" {
		data = callData(msg)
	}
	channel := msg.Channel
	if channel == "" {
		channel = ChannelGeneral
	}
	return expoMessage{
		To: sub.Endpoint, Title: msg.Title, Body: msg.Body, Data: data,
		Sound: "default", ChannelID: channel, TTL: msg.ttl(), Priority: "high",
	}, true
}

type expoResponse struct {
	Data []struct {
		Status  string `json:"status"`
		ID      string `json:"id"`
		Details struct {
			Error string `json:"error"`
		} `json:"details"`
	} `json:"data"`
}

// Send posts one message and maps its ticket: DeviceNotRegistered revokes the
// subscription, any other failure (ticket error, 429, 5xx) is retried, and an
// accepted ticket is handed to Receipts. A push this subscription cannot use
// (the end of a ring, for an iPhone) is ErrPushSkipped.
func (s ExpoPushSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	m, ok := expoMessageFor(sub, msg)
	if !ok {
		return ErrPushSkipped
	}
	payload, err := json.Marshal([]expoMessage{m})
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
		// Read (and so drain) a bounded body: it keeps the connection
		// reusable. Only Expo's error codes reach the log — its messages can
		// echo request values, and spec N2 §3.4 keeps message text out of logs.
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		var failure struct {
			Errors []struct {
				Code string `json:"code"`
			} `json:"errors"`
		}
		_ = json.Unmarshal(raw, &failure)
		codes := make([]string, 0, len(failure.Errors))
		for _, e := range failure.Errors {
			if e.Code != "" {
				codes = append(codes, e.Code)
			}
		}
		if len(codes) == 0 {
			return fmt.Errorf("expo push: %s", resp.Status)
		}
		return fmt.Errorf("expo push: %s: %s", resp.Status, strings.Join(codes, ","))
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
		s.Receipts.Track(t.ID, sub.ID)
		return nil
	case t.Details.Error == "DeviceNotRegistered":
		return ErrSubscriptionGone
	default:
		// The code only: Expo's message quotes the device token.
		return fmt.Errorf("expo push: ticket %s", t.Details.Error)
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
