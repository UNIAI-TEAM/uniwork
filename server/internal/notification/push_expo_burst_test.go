package notification

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A chat push groups under its room everywhere: an iPhone stacks the room's
// pushes in one thread (thread-id), Android replaces the room's notification
// (data.tag, which the app's FCM service lifts to where expo-notifications
// names the notification by it) and, on a build that does, its title says how
// many came. A quiet follow-up makes no sound: an iPhone gets
// no sound and the passive level, an Android build that created the quiet
// channel gets it on that channel, and an older Android build, which would
// show it on an alerting fallback channel, gets nothing.
func TestExpoPushSenderGroupsAChatBurstAndQuietsItsFollowUps(t *testing.T) {
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = nil
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL}
	sub := func(agent string) db.PushSubscription {
		return db.PushSubscription{Endpoint: "ExponentPushToken[a]", UserAgent: pgtype.Text{String: agent, Valid: true}}
	}
	quietAndroid := sub(expoUserAgent("android", PushCaps{CallUI: true, ChatQuiet: true}))
	oldAndroid := sub("expo/android; call-ui")
	iphone := sub("expo/ios")
	send := func(to db.PushSubscription, m PushMessage) (map[string]any, error) {
		t.Helper()
		got = nil
		err := s.Send(context.Background(), to, m)
		if len(got) == 0 {
			return nil, err
		}
		return got[0], err
	}

	loud := PushMessage{
		Title: "Minh đã nhắn tin cho bạn", Body: "ba", URL: "https://app/o/w/chat?room=r&message=m3", Tag: "chat_room:r:dm",
		Channel: ChannelMessages, Chat: ChatPush{WorkspaceID: "w", RoomID: "r", MessageID: "m3", Unread: 3, Summary: "3 tin nhắn mới"},
	}
	quiet := loud
	quiet.Quiet = true

	m, err := send(iphone, loud)
	if err != nil || m["threadId"] != "chat_room:r:dm" || m["sound"] != "default" || m["title"] != loud.Title {
		t.Fatalf("iphone loud = %v (%v), want the room's thread, a sound and the plain title", m, err)
	}
	m, _ = send(iphone, quiet)
	if _, ok := m["sound"]; ok || m["interruptionLevel"] != "passive" || m["threadId"] != "chat_room:r:dm" {
		t.Fatalf("iphone quiet = %v, want no sound, passive, the room's thread", m)
	}
	if d, _ := m["data"].(map[string]any); d["quiet"] != "1" {
		t.Fatalf("iphone quiet data = %v, want quiet=1 for the app's foreground handler", d)
	}

	m, _ = send(quietAndroid, loud)
	if m["channelId"] != ChannelMessages || m["title"] != "Minh đã nhắn tin cho bạn · 3 tin nhắn mới" {
		t.Fatalf("android loud = %v, want the messages channel and the room's count in the title", m)
	}
	if _, ok := m["threadId"]; ok {
		t.Fatalf("android push carries a thread id: %v", m)
	}
	if d, _ := m["data"].(map[string]any); d["tag"] != "chat_room:r:dm" || d["quiet"] != nil {
		t.Fatalf("android loud data = %v, want the room's tag and no quiet mark", d)
	}
	m, _ = send(quietAndroid, quiet)
	if m["channelId"] != ChannelChatQuiet {
		t.Fatalf("android quiet = %v, want the quiet channel", m)
	}
	if m, err := send(oldAndroid, quiet); !errors.Is(err, ErrPushSkipped) || m != nil {
		t.Fatalf("old android quiet = %v (%v), want it skipped", m, err)
	}
	// An older build has no native tag lift (UniChatMessagingService › PushTag), so its tray keeps a notification
	// per push and a count in each title would stack "· 2", "· 3": it gets the plain title.
	if m, _ := send(oldAndroid, loud); m["channelId"] != ChannelMessages || m["title"] != loud.Title {
		t.Fatalf("old android loud = %v, want the messages channel and the plain title", m)
	}

	// Only a chat message is grouped and quieted: a task keeps its own shape.
	task := PushMessage{Title: "t", URL: "https://app/x", Tag: "task:1", Quiet: true}
	m, _ = send(iphone, task)
	if _, ok := m["threadId"]; ok || m["sound"] != "default" {
		t.Fatalf("task push = %v, want no thread and its sound", m)
	}
}

// The marks a mobile subscription records: the platform, then what an
// Android build can do. The call UI is still read from an agent that carries
// both marks.
func TestExpoUserAgentCarriesTheAndroidMarks(t *testing.T) {
	for _, c := range []struct {
		platform  string
		caps      PushCaps
		want      string
		callUI    bool
		chatQuiet bool
	}{
		{"android", PushCaps{CallUI: true, ChatQuiet: true}, "expo/android; call-ui; chat-quiet", true, true},
		{"android", PushCaps{CallUI: true}, "expo/android; call-ui", true, false},
		{"android", PushCaps{ChatQuiet: true}, "expo/android; chat-quiet", false, true},
		{"android", PushCaps{}, "expo/android", false, false},
		{"ios", PushCaps{CallUI: true, ChatQuiet: true}, "expo/ios", false, false},
	} {
		got := expoUserAgent(c.platform, c.caps)
		sub := db.PushSubscription{UserAgent: pgtype.Text{String: got, Valid: true}}
		if got != c.want || expoCallUI(sub) != c.callUI || expoChatQuiet(sub) != c.chatQuiet || expoPlatform(sub) != c.platform {
			t.Fatalf("expoUserAgent(%s, %+v) = %q (call ui %v, quiet %v)", c.platform, c.caps, got, expoCallUI(sub), expoChatQuiet(sub))
		}
	}
}
