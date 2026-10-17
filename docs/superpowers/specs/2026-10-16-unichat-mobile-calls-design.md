# UniChat — Gọi LiveKit React Native và các kind giàu (lát M3)

> **Trạng thái:** in-progress — Đã duyệt (chủ sở hữu 2026-10-17: "làm tiếp đến khi hoàn thành UNI-1826"). Lát M3 của epic UNI-1826; issue UNI-1834; plan `docs/superpowers/plans/2026-10-17-unichat-mobile-calls.md`.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §3.5, §6 M3 · **Quyết định:** gọi ở M3, cuộc gọi đến qua push thường, không CallKit (chủ sở hữu, 2026-10-16) · **Web phải mirror:** `packages/views/chat/{voice-call-invites.ts, use-call-ringtone.ts, voice-call-kind-utils.ts, use-voice-call-room-connection.ts, voice-call-participant-labels.ts}`, `packages/core/chat/voice-call.ts` (thuần)

## 1. Mục tiêu
Gọi thoại/video 1:1 và nhóm giữa điện thoại và web; cuộc gọi đến khi app ở nền báo bằng push; tin thoại, poll, sticker/GIF, follow-up, tạo task, nhắc dùng được từ điện thoại; tab Cuộc gọi gọi lại được.

## 2. Gọi
- Thư viện: `@livekit/react-native`, `@livekit/react-native-webrtc`, config plugin; cần dev client (EAS build), không Expo Go. iOS `UIBackgroundModes: audio` để cuộc gọi tiếp tục khi ra nền; Android foreground service khi đang gọi; chuỗi quyền mic/camera.
- Luồng: `mintChatVoiceToken(roomId, kind)` → `{url, token}` → `Room.connect`; tín hiệu `signalChatVoiceInvite/Accept/Hangup` + sự kiện `chat.voice.invite|accept|hangup` (scope user) → overlay cuộc gọi khi foreground; hết giờ đổ chuông và nhạc chuông mirror `voice-call-invites.ts`/`use-call-ringtone.ts`; log cuộc gọi do server tạo như web.
- **Cuộc gọi đến khi ở nền (server):** lời mời hôm nay là `Publish` ephemeral (`chat_signal.go`), không có hàng notification → cần kind mới `chat_call_incoming`: lệnh mời ghi sự kiện cho lane notify trong cùng transaction theo luật audit/outbox (`audit_coverage_test.go`, catalogue ba nơi, `scripts/events-catalogue.test.mjs`; payload chỉ id), rule tạo draft cho người được mời đang không hoạt động, push `ttl` 60 giây, `tag=call:<room_id>`, tiêu đề "X đang gọi"; nhấc ở client khác hoặc hangup → không gửi tiếp (không rút lại push đã gửi). Chạm push → vào phòng nếu còn đổ chuông, không thì mở phòng với log "cuộc gọi nhỡ".
- Không: CallKit/PushKit, ghi âm từ điện thoại (xem lại bản ghi được), chia sẻ màn hình từ điện thoại.

## 3. Kind giàu
| Tính năng | Endpoint | Ghi chú |
|---|---|---|
| Tin thoại ghi/nghe | `sendChatVoiceMessage` (multipart `audio/mp4` — server đã chấp nhận `audio/webm|ogg|mp4`), `getChatVoiceRecordingPlaybackUrl` | `expo-audio` ghi m4a; dạng sóng/thời lượng như web |
| Poll bỏ phiếu | `voteChatPollMessage` | kết quả mirror `poll-utils.ts` (thuần) |
| Sticker/GIF | `listTrendingChatStickers`, `searchChatStickers`, `listTrendingChatGifs`, `searchChatGifs`, gửi theo cách web gửi (`chat_kind_message.go`) | Tenor cần `TENOR_API_KEY` |
| Follow-up | `createChatFollowUp`, `listChatFollowUps`, `patchChatFollowUp`, `deleteChatFollowUp`, `convertChatFollowUpToTask` | sheet theo tin |
| Tạo/liên kết task | `createTaskFromChatMessage`, `createChatMessageLink`, `listChatRoomMessageLinks` | thẻ task đọc được (`message-task-card`) |
| Nhắc | tuyến nhắc hiện có (`chat_reminder.go`) | builder xác nhận endpoint |

## 4. Tiêu chí hoàn thành và test
- Gọi 1:1 iOS↔web, Android↔web, nhóm 3 bên: nghe/thấy, bật/tắt video, hangup đồng bộ; log như web.
- Push "đang gọi" ≤ 5 giây khi ở nền; chạm → vào phòng nếu còn đổ chuông.
- Server: kind mới có rule + test; audit/outbox cùng transaction; catalogue ba nơi khớp; không push khi người nhận đang trong cuộc gọi hoặc đã nhấc nơi khác.
- Tin thoại chéo điện thoại↔web phát được; mỗi kind giàu có test so sánh với web (cùng endpoint, cùng dữ liệu).
- Lệnh: `pnpm --filter @uniwork/chat-mobile test`; `make test-go` (gói `notification`, `service`, `outbox`); smoke máy thật ký tên.

## 5. Rủi ro
Build native phức tạp (WebRTC, quyền, âm thanh nền); App Store review với mic/camera; tiếng vang trên Android — dùng `AudioSession` của LiveKit RN.

## 6. Để builder quyết
`Record` hay `Emit` cho sự kiện mời; tên topic; UI overlay; thứ tự kind giàu.
