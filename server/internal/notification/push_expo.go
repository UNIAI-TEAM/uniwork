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
	// CategoryID names the notification category whose action buttons the
	// phone shows (iOS UNNotificationCategory, Android actions).
	CategoryID string `json:"categoryId,omitempty"`
	TTL        int    `json:"ttl"`
	Priority   string `json:"priority"`
	// Badge is the iPhone's icon count (iOS only; a zero clears it).
	Badge *int `json:"badge,omitempty"`
	// InterruptionLevel "time-sensitive" lets a mention or a call through
	// Focus on an iPhone (iOS 15+, the app's time-sensitive entitlement);
	// "passive" lists a quiet chat follow-up without lighting the screen.
	InterruptionLevel string `json:"interruptionLevel,omitempty"`
	// ThreadID groups an iPhone's chat pushes by room (or thread): Expo maps
	// it to aps.thread-id, and the lock screen stacks them under one entry
	// instead of a line per message. iOS only; Android groups by data.tag.
	ThreadID string `json:"threadId,omitempty"`
}

// timeSensitiveChannels are the pushes an iPhone shows through Focus: a
// mention of the person, a call ringing for them, a call they missed. Plain
// messages stay "active", which Focus holds back.
var timeSensitiveChannels = map[string]bool{ChannelMentions: true, ChannelCalls: true, ChannelMissedCalls: true}

// ChatMessageCategory is the category of a chat message push: Reply (a text
// field) and Mark as read. The app registers it at launch
// (apps/chat-mobile/lib/chat-notification.ts names the same id); a build that
// has not registered it shows the push without buttons.
const ChatMessageCategory = "chat_message"

// chatData adds what a chat push's actions need to its data: the workspace,
// room and message ids, and the thread a reply goes into.
func chatData(data map[string]string, c ChatPush) map[string]string {
	data["workspace_id"] = c.WorkspaceID
	data["room_id"] = c.RoomID
	data["message_id"] = c.MessageID
	if c.ThreadRootID != "" {
		data["thread_root_id"] = c.ThreadRootID
	}
	return data
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
	// ChannelChatQuiet is default importance with no sound and no vibration
	// (a low one would file the room under Android's "Silent"): a chat
	// push that follows one the phone alerted for in the same room within
	// chatAlertWindow replaces the room's notification on it, silently. Only
	// a build that created it is sent it (expoChatQuiet): Android shows a
	// push for a channel it does not know on an alerting fallback channel.
	ChannelChatQuiet = "chat_quiet"
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

// PushCaps is what an Android build says it can do when it registers
// (notification.Service.SubscribePush): CallUI, it draws its own incoming
// call (UniChat 0.3.0 and later, call_ui); ChatQuiet, it created the
// chat_quiet channel and names a pushed notification by data.tag, so a
// room's pushes replace one notification (chat_quiet). An iPhone has
// neither: it keeps the visible call push, and quiets a push by its sound
// field.
type PushCaps struct {
	CallUI    bool
	ChatQuiet bool
}

// The marks an Android subscription's user agent carries after its platform,
// in this order: "expo/android; call-ui; chat-quiet".
const (
	expoCallUIMark    = "call-ui"
	expoChatQuietMark = "chat-quiet"
)

// expoUserAgent is what a mobile subscription records: the platform, and the
// marks of what an Android build can do.
func expoUserAgent(platform string, caps PushCaps) string {
	agent := "expo/" + platform
	if platform != "android" {
		return agent
	}
	if caps.CallUI {
		agent += "; " + expoCallUIMark
	}
	if caps.ChatQuiet {
		agent += "; " + expoChatQuietMark
	}
	return agent
}

// expoMark reports an Android subscription whose user agent carries mark.
func expoMark(sub db.PushSubscription, mark string) bool {
	rest, ok := strings.CutPrefix(sub.UserAgent.String, "expo/android")
	if !sub.UserAgent.Valid || !ok {
		return false
	}
	for _, part := range strings.Split(rest, ";") {
		if strings.TrimSpace(part) == mark {
			return true
		}
	}
	return false
}

// expoPlatform is the OS a mobile subscription registered from ("ios",
// "android"), "" for a browser or a row with no user agent.
func expoPlatform(sub db.PushSubscription) string {
	rest, ok := strings.CutPrefix(sub.UserAgent.String, "expo/")
	if !sub.UserAgent.Valid || !ok {
		return ""
	}
	platform, _, _ := strings.Cut(rest, ";")
	return platform
}

// expoCallUI reports a subscription that gets call pushes as data-only
// messages. An Android build from before the call UI ("expo/android") has
// no task to turn one into a ring, so it keeps the visible push.
func expoCallUI(sub db.PushSubscription) bool { return expoMark(sub, expoCallUIMark) }

// expoChatQuiet reports an Android build that has the chat_quiet channel and
// whose FCM service lifts data.tag (UniChatMessagingService › PushTag), so a
// room's pushes replace one notification. An older one gets no quiet
// follow-up at all: its tray keeps the pushes that alerted, one each.
func expoChatQuiet(sub db.PushSubscription) bool { return expoMark(sub, expoChatQuietMark) }

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
	if msg.Cleared.RoomID != "" {
		return roomReadMessage(sub, msg, callUI)
	}
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
	category := ""
	switch {
	case msg.Call.Type != "":
		data = callData(msg)
	case msg.Chat.RoomID != "" && msg.Chat.WorkspaceID != "":
		// A message someone sent this person: answered or read from the notification.
		data = chatData(data, msg.Chat)
		category = ChatMessageCategory
	}
	channel := msg.Channel
	if channel == "" {
		channel = ChannelGeneral
	}
	m := expoMessage{
		To: sub.Endpoint, Title: msg.Title, Body: msg.Body, Data: data,
		Sound: "default", ChannelID: channel, CategoryID: category, TTL: msg.ttl(), Priority: "high",
	}
	if expoPlatform(sub) == "ios" {
		m.Badge = msg.Badge
		if timeSensitiveChannels[channel] {
			m.InterruptionLevel = "time-sensitive"
		}
	}
	if msg.Chat.RoomID != "" && msg.Call.Type == "" {
		return chatBurstMessage(sub, msg, m)
	}
	return m, true
}

// chatBurstMessage groups a chat push with the room's others and quiets a
// follow-up (PushMessage.Quiet). An iPhone stacks them under the room's
// thread and plays nothing for a quiet one. Android names a notification by
// data.tag only on a build whose FCM service lifts the tag to where
// expo-notifications reads it (Expo sends the data as a JSON string; the same
// build created chat_quiet, so expoChatQuiet says both): there each push
// replaces the room's notification, its title says the room's count, and a
// quiet one goes on the quiet channel. An older build keeps a notification
// per push, so it gets the plain title and no quiet follow-up at all.
func chatBurstMessage(sub db.PushSubscription, msg PushMessage, m expoMessage) (expoMessage, bool) {
	switch expoPlatform(sub) {
	case "ios":
		m.ThreadID = msg.Tag
		if msg.Quiet {
			m.Sound = ""
			m.InterruptionLevel = "passive"
		}
	case "android":
		grouped := expoChatQuiet(sub)
		if msg.Quiet && !grouped {
			return expoMessage{}, false
		}
		if grouped && msg.Chat.Summary != "" {
			m.Title += " · " + msg.Chat.Summary
		}
		if msg.Quiet {
			m.ChannelID = ChannelChatQuiet
		}
	}
	if msg.Quiet {
		// The app's foreground handler plays nothing for it either.
		m.Data["quiet"] = "1"
	}
	return m, true
}

// roomReadMessage is the "read elsewhere" push: data-only, to an Android
// build whose background task takes a read room's notifications out of the
// tray and sets the icon's count (the call-ui builds; an older one would only
// wake for nothing). Normal priority: it shows nothing, and FCM lowers an app
// that spends high-priority messages on nothing the person sees, which would
// slow its rings. An iPhone gets nothing: its icon count rides on every push.
func roomReadMessage(sub db.PushSubscription, msg PushMessage, callUI bool) (expoMessage, bool) {
	if !callUI {
		return expoMessage{}, false
	}
	data := map[string]string{"type": RoomReadPush, "room_id": msg.Cleared.RoomID}
	if msg.Cleared.WorkspaceID != "" {
		data["workspace_id"] = msg.Cleared.WorkspaceID
	}
	if msg.Badge != nil {
		data["badge"] = strconv.Itoa(*msg.Badge)
	}
	return expoMessage{To: sub.Endpoint, Data: data, TTL: msg.ttl(), Priority: "normal"}, true
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
