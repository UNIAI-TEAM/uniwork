# UniChat M3 — Gọi LiveKit React Native và các kind giàu — Kế hoạch triển khai

> **Trạng thái:** in-progress — issue UNI-1834, nhánh `feature/UNI-1834-unichat-m3-goi-livekit-react-native-va-c`.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-mobile-calls-design.md` (spec cha §3.5, §6 M3, §8). **Mẫu:** plan M2a `2026-10-17-unichat-mobile-chat.md`.

**Mục tiêu:** gọi thoại/video 1:1 và nhóm từ điện thoại (LiveKit RN), push "X đang gọi" khi app ở nền, và các kind giàu gửi được từ điện thoại. Thứ tự làm để phần dở dang vẫn giao được: (a) server push cuộc gọi đến → (b) engine gọi trên mobile + điểm vào → (c) kind giàu.

## Ràng buộc chung

- Server: Audit and Events của `CLAUDE.md` — sự kiện domain đi qua outbox trong transaction của lệnh; catalogue ba nơi (`docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`, `scripts/events-catalogue.test.mjs`); kind thông báo mới đi cả danh sách client (`packages/core/types/notification.ts`, `TestKindsMatchClientList`) và tiêu đề (`TestTitlesMatchClientLocales`).
- Mobile: ADR 0011 — chỉ import core theo allowlist; logic web khác copy, ghi nguồn một dòng, test parity chạy đúng case của test web. Không nới allowlist.
- Vitest env node: mọi `lib/*.ts`, `data/*.ts` thuần có test; `.tsx` và file chạm native nằm ngoài coverage như M1/M2.
- Không build native, không chạy máy thật ở lát này (không có dev client trong môi trường builder) — smoke máy thật để người duyệt ký.

## Quyết định builder (spec §6)

| Mục | Chọn | Lý do |
|---|---|---|
| `Record` hay `Emit` cho lời mời | `Emit` (actor `Human(caller)`) trong một transaction gom các hàng của mọi người được mời | Lời mời không ghi hàng nghiệp vụ nào (phiên gọi nằm trong bộ nhớ, `chat_voice.go`); tín hiệu chat không audit (OPEN_QUESTIONS A4, như `chat.dm.received`); cuộc gọi đã được audit một lần khi kết thúc (`chat.voice.call_logged`). `audit_coverage_test.go` không đổi vì không có action mới |
| Tên topic | `chat.voice.invite_received`, payload `room_id`, `call_id`, `user_id`, scope none, outbox | Cùng khuôn `chat.dm.received`, `chat.thread.reply_received`: một hàng cho mỗi người nhận, chỉ id |
| Kind thông báo | `chat_call_incoming`, nhóm `chat_call:<room_id>`, tài nguyên `chat_room`, push mặc định bật | Gộp theo phòng; lời mời cũ của phòng được đóng (đánh dấu đọc) ngay lúc mời mới nên lời mời mới luôn tạo hàng mới và push. Email để mặc định như mọi kind: digest chỉ lấy hàng chưa đọc, mà hàng gọi đóng khi nhấc máy hoặc kết thúc |
| Ai được đổ chuông bằng push | DM: người kia; nhóm/kênh: mọi thành viên khác khi phòng ≤ `chatSmallRoomMembers` (50); phòng lớn hơn chỉ đổ chuông client đang mở (realtime) | Cùng ngưỡng `@all`: một push cho mỗi thành viên kênh lớn là spam |
| Dừng push | Nhấc máy → đóng hàng của người nhấc; gác máy/kết thúc → đóng hàng của mọi người được mời; rule bỏ sự kiện cũ hơn 60 giây và người đã nhấc/đã ở trong cuộc gọi/cuộc gọi đã hết (cổng `CallRingChecker` do `ChatService` cài); consumer push đã bỏ hàng có `read_at` | Không rút lại push đã gửi (spec). Phiên gọi ở bộ nhớ của một replica (`deploy/app/uniwork/values.yaml` chạy 1 replica BE), cùng giả định mint token đang dùng |
| TTL / gộp | `PushMessage.TTL` 60 giây cho kind này (Expo `ttl`, Web Push `TTL`); `tag` = khóa nhóm `chat_call:<room_id>` như mọi kind khác | Expo sender chỉ có `data.tag`, không có trường gộp ở tầng OS mà sender đang dùng — không thêm trường chưa kiểm chứng |
| Chặn push khi đang hoạt động (N2 §3.5) | **Không** áp cho cuộc gọi | Lỡ cuộc gọi đắt hơn đổ chuông thừa; presence theo người không theo thiết bị, cửa sổ 120 giây vẫn che người vừa rời bàn cầm điện thoại; web/desktop mở vẫn đổ chuông qua realtime như hôm nay |
| Engine gọi mobile | `lib/voice-call.ts` (thuần, copy `voice-call-invites.ts`, `voice-call-kind-utils.ts`, hằng số `voice-call-overlay-types.ts`) + `data/calls/call-store.ts` (zustand vanilla, máy trạng thái copy `use-native-voice-call.ts`, phụ thuộc tiêm vào nên test node) | Test được không cần render RN |
| UI cuộc gọi | Một `CallOverlay` (Modal toàn màn hình) gắn ở `[org]/[ws]/_layout.tsx`, vẽ theo trạng thái store: đến (Nghe/Từ chối), đang đổ chuông/kết nối/đang gọi (tắt mic, camera, loa, gác máy), kết thúc (lý do, tự đóng như web) | Cuộc gọi sống qua mọi điều hướng trong workspace; route sẽ gác máy khi người dùng bấm back. Không thu nhỏ trong lát này |
| Nhạc chuông | Lịch âm của `use-call-ringtone.ts` copy vào `lib/call-ringtone.ts`, sinh WAV thuần, tệp `assets/sounds/ring-*.wav` khóa bằng test so byte; phát lặp bằng `expo-audio`; cuộc gọi đến rung thêm (`Vibration`) | RN không có Web Audio; cùng tần số và nhịp với web |
| Chạm push | URL push `…/chat?room=&call=`; `deepLinkHref` giữ `call`; tab Chat hỏi `ListPendingVoiceInvites`: còn đổ chuông → nhấc máy luôn; không → mở phòng (log "cuộc gọi nhỡ" ở đó) | Spec §2 |
| Thứ tự kind giàu | poll bỏ phiếu → tin thoại → sticker/GIF → nhắc → follow-up → tạo/liên kết task | Từ nhỏ đến lớn; mỗi bước giao được riêng |

## Task 1 — Server: push cuộc gọi đến

- `internal/service/chat_signal.go`: `SignalVoiceInvite` ghi `chat.voice.invite_received` cho mỗi người được mời (DM: peer; nhóm/kênh: thành viên đang hoạt động trừ người gọi) và đóng hàng `chat_call:<room>` cũ của họ, cùng một transaction; `SignalVoiceAccept` đóng hàng của người nhấc; `finalizeVoiceCall` đóng hàng của mọi người được mời. `ChatService.VoiceCallRinging(roomID, callID, userID)`.
- `internal/notification`: kind + tiêu đề vi/en + prefs + rule `chat.voice.invite_received` (TTL 60 s, cổng ringing, cổng thành viên/mute như `chatMessageRule`) + push (TTL, link `?room=&call=`, không chặn theo presence). `cmd/server/main.go` cài cổng.
- Client: `NOTIFICATION_KINDS`, `notifications.kind.chat_call_incoming` (vi/en), bảng icon/tone/category/ma trận cài đặt.
- Catalogue ba nơi.
- Test: rule (người nhận đang trong cuộc gọi / đã nhấc / cuộc gọi hết / sự kiện quá 60 s → không draft), push (TTL 60, không chặn presence, link có `call`), service (mời ghi hàng outbox cho đúng người; nhấc/gác máy đóng hàng).

## Task 2 — Mobile: engine gọi + điểm vào

- Dep: `@livekit/react-native`, `@livekit/react-native-webrtc`, `@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`, `livekit-client`; `app.config.ts`: chuỗi quyền mic/camera, iOS `UIBackgroundModes: [audio]`, Android quyền + foreground service; `app.config.test.ts`.
- `lib/voice-call.ts` + test parity; `lib/call-ringtone.ts` + test; `data/chat-api.ts` thêm `listPendingVoiceInvites`, `mintVoiceToken`, `signalVoiceInvite|Accept|Hangup` (+ case malformed); `data/calls/call-store.ts` + test (máy trạng thái: mời, nhấc, từ chối, bận, hết giờ, tín hiệu từ nơi khác, đồng bộ lời mời chờ).
- `data/realtime/use-call-realtime.ts` (tầng 3: `chat.voice.*` → store, reconnect → đồng bộ lời mời chờ); `components/calls/{call-overlay,call-room}.tsx`; nút gọi thoại/video ở header phòng DM/nhóm/kênh; nút gọi lại ở hàng tab Cuộc gọi; chạm push có `call`.

## Task 3 — Kind giàu

- `data/chat-api.ts` thêm `votePoll`, `sendVoiceMessage`, `listStickers|searchStickers|listGifs|searchGifs`, `sendKindMessage` (reminder), follow-up (5 endpoint), task (`createTaskFromMessage`, `listRoomMessageLinks`, `createMessageLink`) — mỗi endpoint một case malformed và cùng đường/thân như core.
- Poll: `PollCard` bấm để bỏ phiếu (khóa khi hết hạn, `isPollExpired` của core). Tin thoại: giữ nút mic để ghi `expo-audio` (m4a, `audio/mp4`), thả để gửi, kéo hủy; thời lượng như web. Sticker/GIF: sheet hai tab, trending + tìm, gửi `![sticker:…](url)` như `chat-expression-picker.tsx`; trống khi server không có Tenor. Nhắc: sheet preset (`remindAtFromPreset` của core) gửi `reminder` qua `POST …/messages`. Follow-up: sheet theo tin (tạo, đánh dấu xong, xóa, chuyển task). Task: "Tạo task" từ tin (`titleFromMessageBody` của core) + thẻ task đọc được dưới tin có liên kết.

## Kiểm thử (hẹp, theo `CLAUDE.md`)

- `go test ./internal/notification -run 'Call|Kinds|Titles'`, `./internal/service -run 'Voice|AuditCoverage'`, `./internal/outbox -run Catalogue`, `./internal -run Test…` (arch); gofmt/vet/staticcheck trên gói đã chạm.
- `node --test scripts/events-catalogue.test.mjs scripts/mobile-core-allowlist.test.mjs scripts/no-usf-leak.test.mjs scripts/governance.test.mjs`.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/chat-mobile test|typecheck|lint`; `pnpm --filter @uniwork/core test -- events notification`; `pnpm --filter @uniwork/views typecheck` (bảng kind); `pnpm knip`.
- Không: `make check`, suite service/handler đầy đủ, build native, gọi trên máy thật (người duyệt ký smoke).
