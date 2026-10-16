# UniChat N2 — Push qua Expo, preview nội dung, bỏ push khi đang hoạt động — Kế hoạch triển khai

> **Trạng thái:** shipped — issue UNI-1828, nhánh `feature/UNI-1828-unichat-n2-push-expopushsender-dang-ky-t`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Điện thoại UniChat nhận push có nội dung cho DM, nhắc đến, trả lời luồng qua Expo Push Service; token Expo đăng ký qua tuyến push hiện có; không push khi người nhận vừa có nhịp presence trong 120 giây.

**Architecture:** Không migration, không đổi catalogue. `PushSender` có thêm `ExpoPushSender` và một sender gộp chọn theo tiền tố endpoint. `PushConsumer` đọc tin chat lúc giao để dựng `Body`, hỏi `PresenceChecker` (ChatService) trước khi gửi ba kind chat. Presence lưu thêm mốc nhịp cuối theo người dùng (Redis key riêng + memory store).

**Tech Stack:** Go (net/http, go-redis Lua script, prometheus), vitest không đổi, `sw.js` thuần.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-push-design.md` (addendum cho `2026-09-04-notifications-design.md`).

## Global Constraints

- Không migration; bảng `notifications` không lưu body; không đổi `docs/events/CATALOGUE.md`.
- Mẫu token Expo: `^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$`. Expo API `POST https://exp.host/--/api/v2/push/send`, body một thông điệp `{to, title, body, data:{url,tag}, sound:"default", channelId:"chat", ttl:3600, priority:"high"}`; header `Authorization: Bearer <EXPO_ACCESS_TOKEN>` khi có; HTTP client timeout 10 s. Gửi từng subscription (không gộp 100 — tối ưu sau, ghi ở §6 spec).
- Ticket `DeviceNotRegistered` → `ErrSubscriptionGone`; HTTP 429/5xx → lỗi (outbox lane `push` retry).
- Web Push giữ nguyên: 404 khi thiếu VAPID, `https://` + hai khóa khác rỗng; `WebPushSender` không đổi.
- Body chỉ cho `chat_mentioned`, `chat_dm`, `chat_thread_replied`; cắt 120 rune (+ "…"); tin đã xóa → không gửi push, đánh dấu `pushed_at`. Log không ghi body (`scripts/no-pii-log.test.mjs`).
- Bỏ push khi nhịp presence cuối ≤ 120 s trước lúc giao, chỉ ba kind chat; Redis tắt/lỗi → gửi. Metric theo quy ước repo: `uniwork_push_suppressed_total{kind}` (spec gọi là `notification_push_suppressed_total`; tên repo là `uniwork_*`).
- Mọi biến env mới có trong `.env.example` (`scripts/env-example.test.mjs`); Go `gofmt`/`vet`/`staticcheck` sạch; test chạy hẹp: `go test ./internal/notification/`, `./internal/service/ -run Presence`, `./internal/metrics/`.

## Review Focus

1. Thông điệp Expo trả HTTP 200 nhưng ticket `status: "error"` khác `DeviceNotRegistered` (vd `MessageTooBig`) → phải là lỗi thường (retry rồi chết ở outbox), không thu hồi — Task 1 test.
2. Token Expo dạng `ExponentPushToken[...]` (tiền tố cũ) → vẫn nhận ở cả sender và đăng ký — Task 1, Task 2 test.
3. Notification gộp (`Count > 1`) trỏ tin mới nhất bị xóa → không gửi, `pushed_at` được đặt, không lặp vô hạn — Task 3 test "deleted".
4. Người nhận không hề có nhịp (chưa từng online) → `LastPresenceBeat` trả `ok=false` → gửi — Task 4 test.
5. Tin file kind `file` có `body` = tên tệp → body là nhãn "[Tệp]"/"[Ảnh]", không lộ tên tệp — Task 3 test "file".

---

### Task 1: `ExpoPushSender`, sender gộp theo tiền tố, cấu hình và wiring

**Files:**
- Create: `server/internal/notification/push_expo.go`
- Create: `server/internal/notification/push_expo_test.go`
- Modify: `server/internal/config/config.go` (field `ExpoAccessToken string`, đọc `os.Getenv("EXPO_ACCESS_TOKEN")` cạnh VAPID)
- Modify: `.env.example` (sau `VAPID_SUBJECT=`: hai dòng comment + `EXPO_ACCESS_TOKEN=`)
- Modify: `server/cmd/server/main.go:476-481`

**Interfaces:**
- Consumes: `PushSender`, `PushMessage`, `ErrSubscriptionGone`, `db.PushSubscription.Endpoint`.
- Produces:
  - `var expoPushTokenPattern = regexp.MustCompile(`^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$`)` và `func isExpoPushToken(endpoint string) bool` (Task 2 dùng).
  - `type ExpoPushSender struct { Client *http.Client; URL string; AccessToken string }` — zero `Client` → `&http.Client{Timeout: 10 * time.Second}`, zero `URL` → `https://exp.host/--/api/v2/push/send`. `Send(ctx, sub, msg)`: POST JSON mảng một phần tử `[{to: sub.Endpoint, title, body (bỏ khi rỗng), data:{url,tag}, sound:"default", channelId:"chat", ttl:3600, priority:"high"}]`; đọc `{"data":[{"status":"ok"}|{"status":"error","message":…,"details":{"error":"DeviceNotRegistered"}}]}`.
  - `func NewPrefixSender(expo, web PushSender) PushSender` trả `prefixSender{expo, web}`: endpoint khớp mẫu Expo → `expo.Send`; còn lại → `web.Send`, hoặc `nil` (ack, không gửi) khi `web == nil` — comment một dòng: subscription web không thể tồn tại hợp lệ khi VAPID tắt.
  - `PushMessage.Body string json:"body,omitempty"` (thêm field; `WebPushSender` tự mang theo vì marshal cả struct).
  - `config.Config.ExpoAccessToken`.

- [ ] **Step 1: Test sender** — `push_expo_test.go`:

```go
func TestExpoPushSenderMapsTickets(t *testing.T) {
	var got []map[string]any
	var auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&got)
		switch got[0]["to"] {
		case "ExponentPushToken[gone]":
			_, _ = io.WriteString(w, `{"data":[{"status":"error","message":"x","details":{"error":"DeviceNotRegistered"}}]}`)
		case "ExponentPushToken[big]":
			_, _ = io.WriteString(w, `{"data":[{"status":"error","message":"x","details":{"error":"MessageTooBig"}}]}`)
		case "ExponentPushToken[busy]":
			w.WriteHeader(http.StatusTooManyRequests)
		case "ExponentPushToken[down]":
			w.WriteHeader(http.StatusBadGateway)
		default:
			_, _ = io.WriteString(w, `{"data":[{"status":"ok","id":"t1"}]}`)
		}
	}))
	defer srv.Close()
	s := ExpoPushSender{URL: srv.URL, AccessToken: "secret"}
	msg := PushMessage{Title: "Minh đã nhắn tin cho bạn", Body: "chào", URL: "https://app/x", Tag: "chat_room:r:dm"}
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[ok]"}, msg); err != nil { t.Fatal(err) }
	if auth != "Bearer secret" || got[0]["title"] != msg.Title || got[0]["body"] != "chào" || got[0]["channelId"] != "chat" || got[0]["priority"] != "high" || got[0]["ttl"] != float64(3600) || got[0]["data"].(map[string]any)["url"] != msg.URL || got[0]["data"].(map[string]any)["tag"] != msg.Tag { t.Fatalf("request = %v auth=%q", got, auth) }
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[gone]"}, msg); !errors.Is(err, ErrSubscriptionGone) { t.Fatalf("DeviceNotRegistered → %v", err) }
	for _, to := range []string{"ExponentPushToken[big]", "ExponentPushToken[busy]", "ExponentPushToken[down]"} {
		if err := s.Send(context.Background(), db.PushSubscription{Endpoint: to}, msg); err == nil || errors.Is(err, ErrSubscriptionGone) { t.Fatalf("%s → %v, want a retryable error", to, err) }
	}
	if err := s.Send(context.Background(), db.PushSubscription{Endpoint: "ExponentPushToken[ok]"}, PushMessage{Title: "t"}); err != nil || got[0]["body"] != nil { t.Fatalf("empty body must be omitted: %v %v", got[0]["body"], err) }
}

func TestPrefixSenderRoutesByEndpoint(t *testing.T) {
	expo, web := &spySender{}, &spySender{}
	s := NewPrefixSender(expo, web)
	for _, ep := range []string{"ExponentPushToken[a]", "ExpoPushToken[b-_c]", "https://fcm.googleapis.com/fcm/send/x"} {
		if err := s.Send(context.Background(), db.PushSubscription{Endpoint: ep}, PushMessage{Title: ep}); err != nil { t.Fatal(err) }
	}
	if len(expo.sent) != 2 || len(web.sent) != 1 || web.sent[0].Title != "https://fcm.googleapis.com/fcm/send/x" { t.Fatalf("expo=%d web=%d", len(expo.sent), len(web.sent)) }
	if err := NewPrefixSender(expo, nil).Send(context.Background(), db.PushSubscription{Endpoint: "https://x"}, PushMessage{}); err != nil { t.Fatal("nil web sender must acknowledge, not fail") }
	for ep, want := range map[string]bool{"ExponentPushToken[abc]": true, "ExpoPushToken[abc]": true, "ExponentPushToken[]": false, "ExponentPushToken[a b]": false, "xExponentPushToken[a]": false, "https://a": false} {
		if isExpoPushToken(ep) != want { t.Errorf("isExpoPushToken(%q) = %v", ep, !want) }
	}
}
```

- [ ] **Step 2: Chạy, mong đợi FAIL** (biên dịch: `ExpoPushSender`, `NewPrefixSender`, `isExpoPushToken`, `Body` chưa có):

Run: `cd server && go test ./internal/notification/ -run 'ExpoPushSender|PrefixSender' -count=1`

- [ ] **Step 3: Cài đặt** `push_expo.go` theo Interfaces; thêm `Body` vào `PushMessage` (`push.go:20-24`, cập nhật comment: title + body ngắn cho chat); `config.go` field + đọc env; `.env.example`:

```
# UniChat mobile push goes through Expo Push Service (no VAPID needed). Optional
# access token for Expo's enhanced push security; empty sends unauthenticated.
EXPO_ACCESS_TOKEN=
```

`main.go:476-481` thành: `var webSender notification.PushSender; if cfg.PushEnabled() { webSender = notification.WebPushSender{…}; log… }; pushSender := notification.NewPrefixSender(notification.ExpoPushSender{AccessToken: cfg.ExpoAccessToken}, webSender)`; `NewPushConsumer(q, pushSender, …)` không đổi.

- [ ] **Step 4: Chạy lại + lint**

Run: `cd server && go test ./internal/notification/ -run 'ExpoPushSender|PrefixSender|Push' -count=1 && gofmt -l ./internal/notification ./internal/config ./cmd/server && go vet ./internal/notification/ ./cmd/server/ && go tool staticcheck ./internal/notification/ ./internal/config/ ./cmd/server/ && cd .. && node --test scripts/env-example.test.mjs`
Expected: PASS; `TestPushGone`, `TestPushUsesShortKindTitle` vẫn xanh.

- [ ] **Step 5: Commit**

```bash
git add server/internal/notification/push_expo.go server/internal/notification/push_expo_test.go server/internal/notification/push.go server/internal/config/config.go .env.example server/cmd/server/main.go
git commit -m "feat(notification): ExpoPushSender và sender gộp theo tiền tố token"
```

---

### Task 2: Đăng ký token Expo qua tuyến push hiện có

**Files:**
- Modify: `server/internal/notification/service.go:365-378`
- Modify: `server/internal/handler/dto/sdi/notification.go:24-33`
- Modify: `server/internal/handler/notification.go:165-176`
- Test: `server/internal/notification/service_test.go` (thêm test mới, giữ `TestServicePreferencesAndPush`)

**Interfaces:**
- Consumes: `isExpoPushToken` (Task 1), `db.UpsertPushSubscriptionParams`, `service.Invalid`, `service.ErrNotFound`.
- Produces: `func (s *Service) SubscribePush(ctx, userID, endpoint, p256dh, auth, userAgent, platform string) error` — token Expo: `platform` ∈ {`ios`,`android`} (khác → `service.Invalid("platform không hợp lệ")`), bỏ qua `s.push.Enabled`/https/khóa, upsert `P256dh: ""`, `Auth: ""`, `UserAgent: optText("expo/" + platform)`; không phải token Expo → logic cũ nguyên văn. `sdi.PushSubscribeSDI.Platform string json:"platform,omitempty" description:"ios | android, bắt buộc khi endpoint là token Expo" example:"ios"`; `Endpoint` description → "PushSubscription.endpoint (https) hoặc token Expo `ExponentPushToken[...]`"; `PushKeysSDI` giữ nguyên nhưng comment: bỏ trống với token Expo. Handler truyền `in.Platform`.

- [ ] **Step 1: Test**

```go
func TestServiceRegistersExpoTokensWithoutVAPID(t *testing.T) {
	f := newFixture(t)
	off := NewService(f.q, PushConfig{})
	if err := off.SubscribePush(f.ctx, f.member.ID, "ExponentPushToken[abc-123]", "", "", "okhttp", "android"); err != nil { t.Fatal(err) }
	if err := off.SubscribePush(f.ctx, f.member.ID, "ExpoPushToken[def]", "", "", "", "ios"); err != nil { t.Fatal(err) }
	subs, _ := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID)
	if len(subs) != 2 || subs[0].P256dh != "" || subs[0].Auth != "" { t.Fatalf("subs = %+v", subs) }
	agents := map[string]bool{}
	for _, s := range subs { agents[s.UserAgent.String] = true }
	if !agents["expo/android"] || !agents["expo/ios"] { t.Fatalf("user agents = %v", agents) }
	var ve service.ValidationError
	for _, c := range []struct{ ep, platform string }{{"ExponentPushToken[abc]", ""}, {"ExponentPushToken[abc]", "web"}, {"ExponentPushToken[]", "ios"}, {"notatoken", "ios"}, {"http://insecure", "ios"}} {
		if err := off.SubscribePush(f.ctx, f.member.ID, c.ep, "", "", "", c.platform); !errors.As(err, &ve) { t.Errorf("%q/%q → %v, want ValidationError", c.ep, c.platform, err) }
	}
	if err := off.SubscribePush(f.ctx, f.member.ID, "https://p/x", "p", "a", "ua", ""); !errors.Is(err, service.ErrNotFound) { t.Fatalf("web push with VAPID off = %v, want not found", err) }
}
```

Lưu ý: `"notatoken"` không https và không phải token Expo → theo logic cũ là `Invalid` chỉ khi `push.Enabled`; với `off` là `ErrNotFound`. Sửa ca đó: tách — với `off` mong `ErrNotFound`; thêm `on := NewService(f.q, PushConfig{Enabled: true})` và mong `ValidationError` cho `"notatoken"` và `"http://insecure"`. Cập nhật thêm 5 chỗ gọi `SubscribePush` trong `TestServicePreferencesAndPush` với tham số `platform` cuối là `""`.

- [ ] **Step 2: Chạy, mong đợi FAIL** (chữ ký sai → biên dịch):

Run: `cd server && go test ./internal/notification/ -run 'TestService' -count=1`

- [ ] **Step 3: Cài đặt** theo Interfaces (service, SDI, handler).

- [ ] **Step 4: Chạy lại + lint**

Run: `cd server && go test ./internal/notification/ -run 'TestService' -count=1 && go test ./internal/handler/ -run 'Isolation.*Body|EveryBodyIDField' -count=1 && gofmt -l ./internal && go vet ./internal/notification/ ./internal/handler/ && go tool staticcheck ./internal/notification/ ./internal/handler/`
Expected: PASS (`platform` không kết thúc bằng `_id` nên `TestEveryBodyIDFieldHasAReferenceCase` không đổi).

- [ ] **Step 5: Commit**

```bash
git add server/internal/notification/service.go server/internal/notification/service_test.go server/internal/handler/dto/sdi/notification.go server/internal/handler/notification.go
git commit -m "feat(notification): đăng ký token Expo qua tuyến push, không cần VAPID"
```

---

### Task 3: Preview nội dung cho ba kind chat

**Files:**
- Modify: `server/internal/service/chat_preview.go` (export `ChatPreviewBody`)
- Create: `server/internal/notification/push_body.go`
- Modify: `server/internal/notification/push_consumer.go:69-95,103-111`
- Modify: `apps/web/public/sw.js` (thêm `body: data.body || undefined`)
- Test: `server/internal/notification/delivery_test.go` (test mới), `server/internal/notification/push_body_test.go`

**Interfaces:**
- Consumes: `q.GetChatMessageByID` (trả `pgx.ErrNoRows` khi đã xóa), `db.ChatMessage{Kind, Body, Metadata}`, `spySender`, fixture chat từ `chat_rules_test.go` (`service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})`, `ResolveDM`, `SendRoomMessage`, `DeleteChatMessage`).
- Produces:
  - `func ChatPreviewBody(body, kind string) string` trong `service/chat_preview.go` = `chatSidebarPreviewBody` (đổi tên hàm, cập nhật 1 chỗ gọi `applyLastMessagePreview`).
  - `push_body.go`: `func isChatPushKind(kind string) bool` (ba kind); `var pushBodyLabels = map[string]map[string]string{"vi": {"file": "[Tệp]", "image": "[Ảnh]", "voice": "[Tin thoại]"}, "en": {"file": "[File]", "image": "[Image]", "voice": "[Voice message]"}}`; `func pushBody(locale string, msg db.ChatMessage) string`: `voice_call_log` → ""; `voice` → nhãn; `file` → nhãn `image` khi `metadata` JSON có `content_type`/`mime_type` bắt đầu `image/` (builder xác nhận tên khóa trong `chat_file_message.go`), ngược lại nhãn `file`; còn lại → `service.ChatPreviewBody(msg.Body, msg.Kind)` rồi bỏ markdown tối thiểu (regex: `\[([^\]]+)\]\([^)]*\)`→`$1`, các ký tự `` ` * _ ~ `` bỏ) rồi cắt 120 rune + "…" (ChatPreviewBody đã cắt; chỉ cắt lại nếu còn dài). Locale lạ → `en`.
  - `PushConsumer.message` nhận thêm `body string`; `Handle`: với `isChatPushKind(n.Kind)` gọi `GetChatMessageByID(n.ResourceID)`: `ErrNoRows` → `MarkNotificationPushed` và return nil (không gửi); lỗi khác → return err; có tin → `Body: pushBody(locale, msg)`.

- [ ] **Step 1: Test thuần** — `push_body_test.go`:

```go
func TestPushBody(t *testing.T) {
	long := strings.Repeat("ă", 130)
	cases := []struct{ name, locale string; msg db.ChatMessage; want string }{
		{"text with mention and markdown", "vi", db.ChatMessage{Kind: "text", Body: "[@Minh](mention://member/01X) xem **gấp** `nhé`"}, "@Minh xem gấp nhé"},
		{"cut at 120 runes", "vi", db.ChatMessage{Kind: "text", Body: long}, strings.Repeat("ă", 120) + "…"},
		{"file vi", "vi", db.ChatMessage{Kind: "file", Body: "bao-cao.xlsx", Metadata: []byte(`{"content_type":"application/vnd.ms-excel"}`)}, "[Tệp]"},
		{"image en", "en", db.ChatMessage{Kind: "file", Body: "a.png", Metadata: []byte(`{"content_type":"image/png"}`)}, "[Image]"},
		{"voice unknown locale falls back to en", "fr", db.ChatMessage{Kind: "voice", Body: ""}, "[Voice message]"},
		{"call log has no body", "vi", db.ChatMessage{Kind: "voice_call_log", Body: "x"}, ""},
	}
	for _, c := range cases { if got := pushBody(c.locale, c.msg); got != c.want { t.Errorf("%s: %q, want %q", c.name, got, c.want) } }
}
```

(Khóa `content_type` là giả định — nếu `chat_file_message.go` ghi tên khác, dùng tên thật ở cả test và mã.)

- [ ] **Step 2: Test giao hàng** — thêm vào `delivery_test.go`:

```go
// Spec N2 §3.4: a chat push carries a short preview read at delivery; a
// message deleted before the push goes out sends nothing and is marked pushed.
func TestChatPushCarriesBodyAndSkipsDeleted(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID); if err != nil { t.Fatal(err) }
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")

	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "[@Thành Viên](mention://member/" + f.member.ID + ") họp **9h** nhé"}); err != nil { t.Fatal(err) }
	f.handleLast(t, "chat.dm.received")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil { t.Fatal(err) }
	if len(spy.sent) != 1 || spy.sent[0].Body != "@Thành Viên họp 9h nhé" || spy.sent[0].Title != "Chủ Nhóm đã nhắn tin cho bạn" { t.Fatalf("sent = %+v", spy.sent) }

	// Read it so the next DM opens a fresh row, then delete that message before the push runs.
	f.readAll(t, f.member.ID) // helper: UPDATE notifications SET read_at = now() WHERE user_id = $1 — add to fixture_test.go if absent
	gone, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "nhầm"}); if err != nil { t.Fatal(err) }
	f.handleLast(t, "chat.dm.received")
	if err := chat.DeleteChatMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, gone.ID); err != nil { t.Fatal(err) }
	ev := f.lastEvent(t, TopicPush)
	for i := 0; i < 2; i++ { if err := pc.Handle(f.ctx, ev); err != nil { t.Fatal(err) } }
	if len(spy.sent) != 1 { t.Fatalf("deleted message was pushed: %+v", spy.sent) }
	open := f.inbox(t, f.member.ID) // newest unread row
	if n, _ := f.q.GetNotification(f.ctx, open[0].ID); !n.PushedAt.Valid { t.Fatal("deleted-message notification not marked pushed") }
}
```

Nếu `f.inbox` chỉ liệt kê hàng chưa đọc thì `open[0]` là hàng của tin đã xóa; builder kiểm và chỉnh cách lấy id (vd đọc `notification_id` từ `ev.Payload`).

- [ ] **Step 3: Chạy, mong đợi FAIL** (`pushBody` chưa có; body rỗng):

Run: `cd server && go test ./internal/notification/ -run 'TestPushBody|TestChatPushCarriesBody' -count=1`

- [ ] **Step 4: Cài đặt** theo Interfaces; `sw.js` dòng `showNotification(title, {` thêm `body: data.body || undefined,` và sửa comment payload `{title, body?, url, tag}`.

- [ ] **Step 5: Chạy lại + lint + no-PII**

Run: `cd server && go test ./internal/notification/ -count=1 && gofmt -l ./internal && go vet ./internal/notification/ ./internal/service/ && go tool staticcheck ./internal/notification/ && cd .. && node --test scripts/no-pii-log.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/chat_preview.go server/internal/notification/push_body.go server/internal/notification/push_body_test.go server/internal/notification/push_consumer.go server/internal/notification/delivery_test.go server/internal/notification/fixture_test.go apps/web/public/sw.js
git commit -m "feat(notification): push chat mang preview nội dung đọc lúc giao"
```

---

### Task 4: Bỏ push khi người nhận vừa có nhịp presence

**Files:**
- Modify: `server/internal/service/chat_presence.go` (interface `presenceStore` + `lastBeat`; memory store; `ChatService.LastPresenceBeat`)
- Modify: `server/internal/service/chat_presence_redis.go` (script beat ghi thêm key người dùng; `lastBeat` GET)
- Test: `server/internal/service/chat_presence_test.go`
- Modify: `server/internal/notification/consumer.go:18-25` (`Metrics` + `IncPushSuppressed(kind string)`), `server/internal/notification/push_consumer.go` (`PresenceChecker`, `SetPresence`, rule)
- Modify: `server/internal/metrics/notifications.go` (`PushSuppressed *prometheus.CounterVec`, `uniwork_push_suppressed_total{kind}`)
- Modify: `server/cmd/server/main.go` (sau `NewPushConsumer`: `pushConsumer.SetPresence(chatSvc)`)
- Test: `server/internal/notification/delivery_test.go`

**Interfaces:**
- Consumes: `presenceTTL`, `redisPresencePrefix`, `presenceBeatScript` (KEYS/ARGV hiện có), `newMemoryPresenceStore`, `isChatPushKind` (Task 3), `MarkNotificationPushed`.
- Produces:
  - `presenceStore.lastBeat(ctx, userID string) (time.Time, bool, error)` — mốc nhịp cuối của người dùng ở bất kỳ workspace nào; `false` khi chưa từng nhịp (hoặc key đã hết hạn). Redis: script beat thêm `KEYS[3] = prefix + "user:" + userID`, `redis.call('SET', KEYS[3], ARGV[3], 'PX', ARGV[6])` với `ARGV[6] = presenceLastBeatTTL.Milliseconds()`, `const presenceLastBeatTTL = 10 * time.Minute`; `lastBeat` = `GET` → unix ms. Memory: map `userID → time.Time` cập nhật trong `beat`.
  - `func (s *ChatService) LastPresenceBeat(ctx context.Context, userID string) (time.Time, bool, error)` gọi `s.presence().store.lastBeat`.
  - notification: `type PresenceChecker interface { LastPresenceBeat(ctx context.Context, userID string) (time.Time, bool, error) }`; `func (c *PushConsumer) SetPresence(p PresenceChecker)`; `const pushActiveWindow = 120 * time.Second`; `Metrics.IncPushSuppressed(kind string)`. Rule trong `Handle`, sau khi có `subs` và trước khi dựng message: `if c.presence != nil && isChatPushKind(n.Kind) { t, ok, err := c.presence.LastPresenceBeat(ctx, n.UserID); if err == nil && ok && c.now().Sub(t) <= pushActiveWindow { if m := c.metrics; m != nil { m.IncPushSuppressed(n.Kind) }; return c.q.MarkNotificationPushed(ctx, n.ID) } }` — `c.now func() time.Time` mặc định `time.Now` (test đặt).

- [ ] **Step 1: Test presence store** — thêm vào `chat_presence_test.go`, chạy cho cả memory và redis store (theo mẫu `TestPresenceRedisTransitionsAreSharedAcrossReplicas` để lấy redis client, skip khi thiếu `REDIS_TEST_URL`):

```go
func TestPresenceLastBeatIsPerUserAcrossWorkspaces(t *testing.T) {
	for name, store := range map[string]presenceStore{"memory": newMemoryPresenceStore(), "redis": newRedisPresenceStore(presenceTestRedis(t), "uw:test:presence:")} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			if _, ok, err := store.lastBeat(ctx, "u1"); err != nil || ok { t.Fatalf("never beat: ok=%v err=%v", ok, err) }
			t0 := time.Now().Truncate(time.Millisecond)
			if _, err := store.beat(ctx, "ws-a", "u1", t0); err != nil { t.Fatal(err) }
			if _, err := store.beat(ctx, "ws-b", "u1", t0.Add(5*time.Second)); err != nil { t.Fatal(err) }
			got, ok, err := store.lastBeat(ctx, "u1")
			if err != nil || !ok || !got.Equal(t0.Add(5*time.Second)) { t.Fatalf("lastBeat = %v ok=%v err=%v", got, ok, err) }
			if _, ok, _ := store.lastBeat(ctx, "u2"); ok { t.Fatal("another user must not inherit the beat") }
		})
	}
}
```

(`presenceTestRedis(t)` là helper hiện có hoặc cần thêm: parse `REDIS_TEST_URL`, DB riêng, `FlushDB`, skip khi trống — xem `TestPresenceRedisTransitionsAreSharedAcrossReplicas`.)

- [ ] **Step 2: Test consumer** — thêm vào `delivery_test.go`:

```go
type fakePresence struct{ at time.Time; ok bool; err error }
func (p fakePresence) LastPresenceBeat(context.Context, string) (time.Time, bool, error) { return p.at, p.ok, p.err }
type countingMetrics struct{ suppressed map[string]int; sent map[string]int }
func (m *countingMetrics) IncNotificationCreated(string) {}
func (m *countingMetrics) IncNotificationMerged()        {}
func (m *countingMetrics) IncPushSent(r string)          { m.sent[r]++ }
func (m *countingMetrics) IncDigestSent()                {}
func (m *countingMetrics) IncPushSuppressed(k string)    { m.suppressed[k]++ }

// Spec N2 §3.5: a recipient with a presence beat inside two minutes is at a
// keyboard already; the push is dropped and counted, the row marked pushed.
func TestChatPushIsSuppressedWhileTheRecipientIsActive(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID); if err != nil { t.Fatal(err) }
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	now := time.Now()
	send := func(body string) outbox.Row {
		f.readAll(t, f.member.ID)
		if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: body}); err != nil { t.Fatal(err) }
		f.handleLast(t, "chat.dm.received")
		return f.lastEvent(t, TopicPush)
	}
	run := func(p PresenceChecker) (*spySender, *countingMetrics) {
		spy, m := &spySender{}, &countingMetrics{suppressed: map[string]int{}, sent: map[string]int{}}
		pc := NewPushConsumer(f.q, spy, "http://app.test"); pc.SetMetrics(m); pc.now = func() time.Time { return now }
		if p != nil { pc.SetPresence(p) }
		if err := pc.Handle(f.ctx, send("x")); err != nil { t.Fatal(err) }
		return spy, m
	}
	if spy, m := run(fakePresence{at: now.Add(-30 * time.Second), ok: true}); len(spy.sent) != 0 || m.suppressed[KindChatDM] != 1 { t.Fatalf("active 30s ago: sent=%d suppressed=%v", len(spy.sent), m.suppressed) }
	if spy, _ := run(fakePresence{at: now.Add(-5 * time.Minute), ok: true}); len(spy.sent) != 1 { t.Fatal("active 5 minutes ago must still be pushed") }
	if spy, _ := run(fakePresence{ok: false}); len(spy.sent) != 1 { t.Fatal("never online must be pushed") }
	if spy, _ := run(fakePresence{err: errors.New("redis down")}); len(spy.sent) != 1 { t.Fatal("presence error must fail open") }
	if spy, _ := run(nil); len(spy.sent) != 1 { t.Fatal("no presence wired must push") }
	for _, n := range f.inbox(t, f.member.ID) { if !n.PushedAt.Valid && !n.ReadAt.Valid { t.Fatalf("row %s left unpushed", n.ID) } }
}
```

(`f.inbox` có thể chỉ trả hàng chưa đọc; kiểm tra hàng bị bỏ push bằng `GetNotification` theo `notification_id` trong payload nếu cần.)

- [ ] **Step 3: Chạy, mong đợi FAIL** (biên dịch):

Run: `cd server && go test ./internal/service/ -run TestPresenceLastBeat -count=1; go test ./internal/notification/ -run TestChatPushIsSuppressed -count=1`

- [ ] **Step 4: Cài đặt** theo Interfaces (store + script + memory, ChatService method, PresenceChecker + SetPresence + rule + `now`, Metrics + prometheus counter + `Collectors()`, wiring main).

- [ ] **Step 5: Chạy lại + lint**

Run: `cd server && go test ./internal/service/ -run Presence -count=1 && go test ./internal/notification/ -count=1 && go test ./internal/metrics/ -count=1 && gofmt -l ./internal ./cmd && go vet ./internal/notification/ ./internal/service/ ./internal/metrics/ ./cmd/server/ && go tool staticcheck ./internal/notification/ ./internal/service/ ./internal/metrics/ ./cmd/server/`
Expected: PASS; các test presence cũ (`TestPresenceStoreErrorDegradesQuietly`, …) vẫn xanh.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/chat_presence.go server/internal/service/chat_presence_redis.go server/internal/service/chat_presence_test.go server/internal/notification/consumer.go server/internal/notification/push_consumer.go server/internal/notification/delivery_test.go server/internal/metrics/notifications.go server/cmd/server/main.go
git commit -m "feat(notification): bỏ push chat khi người nhận vừa có nhịp presence"
```

---

### Task 5: Addendum spec notifications, chốt spec N2 và plan

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-notifications-design.md` (§4.3 thêm 3 gạch đầu dòng: sender Expo theo tiền tố token, `body` cho ba kind chat đọc lúc giao, rule bỏ push 120 s + metric; §7 thêm một gạch: nội dung chat đi qua Expo → APNs/FCM, tùy chọn tắt preview là pha sau)
- Modify: `docs/superpowers/specs/2026-10-16-unichat-push-design.md` (Trạng thái → shipped; §6 "Đã quyết": id tin = `resource_id`, nhãn vi/en, gửi từng cái, `EXPO_ACCESS_TOKEN` có ngay, metric `uniwork_push_suppressed_total`, tín hiệu = nhịp presence)
- Modify: dòng Trạng thái plan này → shipped

- [ ] **Step 1: Sửa ba tệp** như trên (một câu mỗi ý, tiếng Việt).

- [ ] **Step 2: Kiểm tra hẹp theo issue**

Run: `cd server && go test ./internal/notification/ ./internal/metrics/ -count=1 && go test ./internal/service/ -run Presence -count=1 && cd .. && node --test scripts/env-example.test.mjs scripts/no-pii-log.test.mjs`
Expected: PASS. (`pnpm --filter @uniwork/core test` không cần: schema client không đổi.)

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-notifications-design.md docs/superpowers/specs/2026-10-16-unichat-push-design.md docs/superpowers/plans/2026-10-16-unichat-push.md
git commit -m "docs: chốt spec và plan lát N2 UniChat, addendum notifications"
```

## Ngoài phạm vi (ghi nhận)

- Gộp 100 thông điệp một lần gọi Expo; giới hạn 600/giây của Expo (xa nhu cầu pilot).
- Tùy chọn tắt preview theo người dùng; áp rule bỏ push cho kind ngoài chat.
- Client mobile đăng ký token (`platform`, `endpoint`) — UNI-1831; `packages/core` endpoint `subscribePush` không đổi (field `platform` optional).
- Rate 60 push/giờ/người của spec cha §7 chưa hiện thực, không thuộc lát này.
