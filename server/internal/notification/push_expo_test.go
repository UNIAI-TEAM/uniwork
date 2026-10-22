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

	"github.com/jackc/pgx/v5/pgtype"

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
			_, _ = io.WriteString(w, `{"data":[{"status":"error","message":"\"ExponentPushToken[big]\" payload is too big","details":{"error":"MessageTooBig"}}]}`)
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
	if auth != "Bearer secret" || got[0]["title"] != msg.Title || got[0]["body"] != "chào" || got[0]["channelId"] != ChannelGeneral || got[0]["priority"] != "high" || got[0]["ttl"] != float64(3600) || got[0]["data"].(map[string]any)["url"] != msg.URL || got[0]["data"].(map[string]any)["tag"] != msg.Tag {
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
	// A ticket error keeps Expo's code but never its message, which quotes the
	// device token into last_error and the dead-letter log.
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[big]"}, msg); err == nil || !strings.Contains(err.Error(), "MessageTooBig") || strings.Contains(err.Error(), "ExponentPushToken[") {
		t.Fatalf("ticket error → %v, want the code without the token", err)
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

// Each kind lands in the Android channel the app created for it, so a person
// can keep calls loud and quiet the rest; anything else is "general".
func TestPushChannelPerKind(t *testing.T) {
	for kind, want := range map[string]string{
		KindChatCallIncoming:            ChannelCalls,
		KindChatMentioned:               ChannelMentions,
		KindMentioned:                   ChannelMentions,
		KindDocumentMentioned:           ChannelMentions,
		KindDocumentBodyMentioned:       ChannelMentions,
		KindDocumentDiscussionMentioned: ChannelMentions,
		KindChatDM:                      ChannelMessages,
		KindChatThreadReplied:           ChannelMessages,
		KindTaskAssigned:                ChannelGeneral,
		KindChatReminder:                ChannelGeneral,
	} {
		if got := pushChannel(kind); got != want {
			t.Errorf("pushChannel(%s) = %s, want %s", kind, got, want)
		}
	}
}

// A ring reaches Android as a data-only, high-priority message (no title, no
// body, no sound: the app shows its own ringing screen), an iPhone keeps the
// visible push; the end of a ring goes to Android only; a missed call is
// visible everywhere and names the call.
func TestExpoPushSenderShapesCallPushesPerPlatform(t *testing.T) {
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL}
	android := db.PushSubscription{Endpoint: "ExponentPushToken[a]", UserAgent: pgtype.Text{String: "expo/android; call-ui", Valid: true}}
	iphone := db.PushSubscription{Endpoint: "ExponentPushToken[i]", UserAgent: pgtype.Text{String: "expo/ios", Valid: true}}
	// An Android build from before the native call UI (it registers without call_ui): data-only would ring nothing.
	legacy := db.PushSubscription{Endpoint: "ExponentPushToken[l]", UserAgent: pgtype.Text{String: "expo/android", Valid: true}}
	invite := PushMessage{
		Title: "Minh đang gọi", URL: "https://app/o/w/chat?room=r&call=c", Tag: "chat_call:r", TTL: 60, Channel: ChannelCalls,
		Call: CallPush{Type: CallPushInvite, CallID: "c", RoomID: "r", WorkspaceID: "w", CallerName: "Minh", RoomName: "", CallKind: "dm", Video: true, ExpiresAt: 1700000060000},
	}

	if err := s.Send(context.Background(), android, invite); err != nil {
		t.Fatal(err)
	}
	m := got[0]
	data, _ := m["data"].(map[string]any)
	wantData := map[string]any{
		"type": "call_invite", "call_id": "c", "room_id": "r", "workspace_id": "w", "caller_name": "Minh", "room_name": "",
		"call_kind": "dm", "video": "1", "expires_at": "1700000060000", "url": invite.URL, "tag": invite.Tag,
	}
	if len(data) != len(wantData) {
		t.Fatalf("android ring data = %v, want %v", data, wantData)
	}
	for k, v := range wantData {
		if data[k] != v {
			t.Fatalf("android ring data[%s] = %v, want %v (%v)", k, data[k], v, data)
		}
	}
	for _, key := range []string{"title", "body", "sound", "channelId"} {
		if _, ok := m[key]; ok {
			t.Fatalf("android ring carries %q, want a data-only message: %v", key, m)
		}
	}
	if m["priority"] != "high" || m["ttl"] != float64(60) {
		t.Fatalf("android ring priority/ttl = %v/%v", m["priority"], m["ttl"])
	}

	if err := s.Send(context.Background(), iphone, invite); err != nil {
		t.Fatal(err)
	}
	if got[0]["title"] != "Minh đang gọi" || got[0]["sound"] != "default" || got[0]["channelId"] != ChannelCalls {
		t.Fatalf("iphone ring = %v, want today's visible push", got[0])
	}
	if d, _ := got[0]["data"].(map[string]any); d["url"] != invite.URL || d["call_id"] != "c" {
		t.Fatalf("iphone ring data = %v", d)
	}
	if err := s.Send(context.Background(), legacy, invite); err != nil {
		t.Fatal(err)
	}
	if got[0]["title"] != "Minh đang gọi" || got[0]["sound"] != "default" || got[0]["channelId"] != ChannelCalls {
		t.Fatalf("ring to an Android build without the call UI = %v, want the visible push it can show", got[0])
	}

	end := PushMessage{TTL: 60, Call: CallPush{Type: CallPushEnd, CallID: "c", RoomID: "r", WorkspaceID: "w"}}
	if err := s.Send(context.Background(), android, end); err != nil {
		t.Fatal(err)
	}
	d, _ := got[0]["data"].(map[string]any)
	if d["type"] != "call_end" || d["call_id"] != "c" || d["room_id"] != "r" || d["workspace_id"] != "w" || len(d) != 4 || got[0]["title"] != nil {
		t.Fatalf("android end = %v", got[0])
	}
	got = nil
	for _, sub := range []db.PushSubscription{iphone, legacy} {
		if err := s.Send(context.Background(), sub, end); !errors.Is(err, ErrPushSkipped) || got != nil {
			t.Fatalf("end to %s = %v (sent %v), want skipped without a request", sub.UserAgent.String, err, got)
		}
	}

	missed := PushMessage{Title: "Cuộc gọi nhỡ từ Minh", URL: "https://app/o/w/chat?room=r&message=m", Tag: "chat_room:r:dm", Channel: ChannelMissedCalls, Call: CallPush{Type: CallPushMissed, CallID: "c", RoomID: "r", WorkspaceID: "w"}}
	for _, sub := range []db.PushSubscription{android, iphone, legacy} {
		if err := s.Send(context.Background(), sub, missed); err != nil {
			t.Fatal(err)
		}
		d, _ := got[0]["data"].(map[string]any)
		if got[0]["title"] != missed.Title || got[0]["channelId"] != ChannelMissedCalls || d["type"] != "call_missed" || d["call_id"] != "c" || d["url"] != missed.URL {
			t.Fatalf("missed call to %s = %v", sub.UserAgent.String, got[0])
		}
	}
}

// A chat message push carries the chat_message category (Reply, Mark as read)
// and the ids those actions act on; a thread reply names its thread. A push
// about anything else, a call or a missed call has neither.
func TestExpoPushSenderGivesChatPushesTheirActions(t *testing.T) {
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL}
	phone := db.PushSubscription{Endpoint: "ExponentPushToken[a]", UserAgent: pgtype.Text{String: "expo/android; call-ui", Valid: true}}

	dm := PushMessage{Title: "Minh", Body: "chào", URL: "https://app/o/w/chat?room=r&message=m", Tag: "chat_room:r:dm", Channel: ChannelMessages, Chat: ChatPush{WorkspaceID: "w", RoomID: "r", MessageID: "m"}}
	if err := s.Send(context.Background(), phone, dm); err != nil {
		t.Fatal(err)
	}
	data, _ := got[0]["data"].(map[string]any)
	want := map[string]any{"url": dm.URL, "tag": dm.Tag, "workspace_id": "w", "room_id": "r", "message_id": "m"}
	if got[0]["categoryId"] != ChatMessageCategory || len(data) != len(want) {
		t.Fatalf("dm push = %v, want category %q and data %v", got[0], ChatMessageCategory, want)
	}
	for k, v := range want {
		if data[k] != v {
			t.Fatalf("dm data[%s] = %v, want %v", k, data[k], v)
		}
	}

	thread := dm
	thread.Chat.ThreadRootID = "root"
	if err := s.Send(context.Background(), phone, thread); err != nil {
		t.Fatal(err)
	}
	if d, _ := got[0]["data"].(map[string]any); d["thread_root_id"] != "root" {
		t.Fatalf("thread reply data = %v, want its thread", d)
	}

	for name, msg := range map[string]PushMessage{
		"task":   {Title: "t", URL: "https://app/x", Tag: "task:1"},
		"missed": {Title: "Cuộc gọi nhỡ", URL: dm.URL, Tag: dm.Tag, Chat: dm.Chat, Call: CallPush{Type: CallPushMissed, CallID: "c", RoomID: "r", WorkspaceID: "w"}},
	} {
		if err := s.Send(context.Background(), phone, msg); err != nil {
			t.Fatal(err)
		}
		if _, ok := got[0]["categoryId"]; ok {
			t.Fatalf("%s push carries a category: %v", name, got[0])
		}
		if d, _ := got[0]["data"].(map[string]any); d["message_id"] != nil {
			t.Fatalf("%s push carries chat ids: %v", name, d)
		}
	}
}

func TestMissedCallTitleNamesTheCaller(t *testing.T) {
	for _, c := range []struct {
		locale string
		video  bool
		want   string
	}{
		{"vi", false, "Cuộc gọi nhỡ từ Minh"},
		{"vi", true, "Cuộc gọi video nhỡ từ Minh"},
		{"en", false, "Missed call from Minh"},
		{"fr", true, "Missed video call from Minh"},
	} {
		if got := MissedCallTitle(c.locale, c.video, "Minh"); got != c.want {
			t.Errorf("MissedCallTitle(%s, %v) = %q, want %q", c.locale, c.video, got, c.want)
		}
	}
}

// The OS a subscription registered from, read from the user agent the mobile
// app records (expoUserAgent); a browser's agent is no platform.
func TestExpoPlatformReadsTheMobileUserAgent(t *testing.T) {
	for agent, want := range map[string]string{
		"expo/ios":                        "ios",
		"expo/android":                    "android",
		"expo/android; call-ui":           "android",
		"Mozilla/5.0 (X11; Linux x86_64)": "",
		"":                                "",
	} {
		sub := db.PushSubscription{UserAgent: pgtype.Text{String: agent, Valid: agent != ""}}
		if got := expoPlatform(sub); got != want {
			t.Fatalf("expoPlatform(%q) = %q, want %q", agent, got, want)
		}
	}
	if got := expoPlatform(db.PushSubscription{UserAgent: pgtype.Text{String: expoUserAgent("ios", true)}}); got != "" {
		t.Fatalf("an invalid (NULL) agent is no platform, got %q", got)
	}
}

// An iPhone's icon shows the unread count the server sends with each chat
// push (audit badge-and-clear-on-read: a killed iPhone's badge stayed wrong
// until the app ran), and mentions and missed calls break through Focus as
// time-sensitive. Android draws its own badge from the tray and has no
// interruption levels: it gets neither field. A plain message stays "active".
func TestExpoPushSenderSetsTheIPhoneBadgeAndUrgency(t *testing.T) {
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL}
	iphone := db.PushSubscription{Endpoint: "ExponentPushToken[i]", UserAgent: pgtype.Text{String: "expo/ios", Valid: true}}
	android := db.PushSubscription{Endpoint: "ExponentPushToken[a]", UserAgent: pgtype.Text{String: "expo/android; call-ui", Valid: true}}
	seven, zero := 7, 0
	chat := ChatPush{WorkspaceID: "w", RoomID: "r", MessageID: "m"}

	send := func(sub db.PushSubscription, msg PushMessage) map[string]any {
		t.Helper()
		if err := s.Send(context.Background(), sub, msg); err != nil {
			t.Fatal(err)
		}
		return got[0]
	}

	dm := send(iphone, PushMessage{Title: "Minh", Body: "chào", Channel: ChannelMessages, Chat: chat, Badge: &seven})
	if dm["badge"] != float64(7) {
		t.Fatalf("iPhone dm badge = %v, want 7", dm["badge"])
	}
	if _, ok := dm["interruptionLevel"]; ok {
		t.Fatalf("a plain message must stay active: %v", dm)
	}
	if cleared := send(iphone, PushMessage{Title: "x", Channel: ChannelMessages, Chat: chat, Badge: &zero}); cleared["badge"] != float64(0) {
		t.Fatalf("a zero badge must be sent, it clears the icon: %v", cleared)
	}
	if none := send(iphone, PushMessage{Title: "task", Channel: ChannelGeneral}); none["badge"] != nil {
		t.Fatalf("no count known: the icon is left as it is, got %v", none["badge"])
	}
	for name, msg := range map[string]PushMessage{
		"mention": {Title: "m", Channel: ChannelMentions, Chat: chat, Badge: &seven},
		"missed":  {Title: "Cuộc gọi nhỡ", Channel: ChannelMissedCalls, Call: CallPush{Type: CallPushMissed, CallID: "c", RoomID: "r"}},
		"ring":    {Title: "A đang gọi", Channel: ChannelCalls, Call: CallPush{Type: CallPushInvite, CallID: "c", RoomID: "r"}},
	} {
		if m := send(iphone, msg); m["interruptionLevel"] != "time-sensitive" {
			t.Fatalf("%s on an iPhone = %v, want time-sensitive", name, m)
		}
	}
	if m := send(android, PushMessage{Title: "m", Channel: ChannelMentions, Chat: chat, Badge: &seven}); m["badge"] != nil || m["interruptionLevel"] != nil {
		t.Fatalf("Android gets neither badge nor interruption level: %v", m)
	}
}
