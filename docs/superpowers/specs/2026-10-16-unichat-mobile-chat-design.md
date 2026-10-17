# UniChat — Tab Chat: danh sách hội thoại hợp nhất và hội thoại lõi (lát M2a)

> **Trạng thái:** in-progress — đang triển khai trên nhánh `feature/UNI-1832-unichat-m2a-tab-chat-danh-sach-hoi-thoai`; plan `../plans/2026-10-17-unichat-mobile-chat.md`. Lát M2a của epic UNI-1826; issue UNI-1832.

**Ngày:** 2026-10-16 · **Spec cha:** `2026-10-16-chat-native-apps-design.md` §6 M2, §8 · **Mẫu UI:** Telegram iOS/Android (hàng hội thoại, hội thoại, luồng) · **Nguồn web phải mirror:** `packages/views/chat/{chat-sidebar-unified.ts, chat-sidebar-preview.ts, chat-sidebar-typing.ts, typing-indicator.ts, chat-mention-utils.ts, chat-file-accept.ts, chat-message-time.ts, native-chat-message-grouping.ts, native-chat-message-timeline.ts}`, `packages/core/chat/{realtime-cache.ts, merge-optimistic-chat-messages.ts, send-outbox-store.ts, room-timeline.ts, use-mark-chat-room-read-at-latest.ts, use-chat-typing-sync.ts, use-chat-presence-heartbeat.ts}` (copy thiết kế), `read-receipt-utils.ts`, `lazy-chat-scopes.ts`, `client-msg-id.ts` (import thuần)

## 1. Mục tiêu

Người dùng đọc và trả lời mọi hội thoại trên điện thoại với cùng số đếm và cùng ngữ nghĩa web; tin đến thời gian thực; gửi không mất khi mạng chập chờn.

## 2. Màn hình

1. **Danh sách hội thoại** (tab Chat): hàng = tên, avatar/biểu tượng loại phòng, preview tin cuối (cùng luật `roomPreviewMapFromRooms`), giờ, số chưa đọc, dấu nhắc đến, mute, ghim; sắp xếp và gộp như `sidebarFromChatRooms`/`chat-sidebar-unified.ts`; tìm phòng; nút `+` → DM mới (tìm người, `resolveDMRoom`) hoặc thư mục kênh (xem/join).
2. **Hội thoại**: danh sách tin đảo chiều, phân trang con trỏ (`listChatRoomMessages`), nhảy tới tin (`listChatRoomMessagesAround`) từ deep link/trả lời, nhóm theo ngày và người gửi, trạng thái gửi (chờ/đã gửi/lỗi), con trỏ đã đọc của người khác, "đang gõ", hiện diện người đối thoại, thanh soạn (văn bản, đính kèm, trả lời trích dẫn, nhắc đến có autocomplete), long-press tin → trả lời, reaction, sao chép, sửa/xóa (tin của mình), mở luồng.
3. **Luồng**: tin gốc + trả lời (`listChatThreadMessages`, `sendChatThreadMessage`), đánh dấu đọc luồng.
4. **Thông tin phòng**: tên, thành viên (`listChatRoomMembers`), mute (`setChatRoomMuted`), tìm tin (`searchChatRoomMessages`), rời phòng.

## 3. Dữ liệu và parity

| Web | Mobile | Test |
|---|---|---|
| `sidebarFromChatRooms`, `chat-sidebar-unified.ts`, `unreadMapFromRooms`, `mentionUnreadMapFromRooms`, `roomPreviewMapFromRooms` | `lib/rooms-display.ts` | cùng fixture với test web → cùng output |
| `read-receipt-utils.ts` | import thuần | — |
| `merge-optimistic-chat-messages.ts`, `pending-messages-store`, `send-outbox-store`, `send-retry` | `lib/send-pipeline.ts` + store | gửi khi offline → chờ → gửi lại → không trùng theo `client_msg_id` |
| `realtime-cache.ts` | `data/realtime/use-chat-realtime.ts` | `chat.message.created` → fetch theo id → append; updated/deleted → vá; `chat.room.read` → con trỏ; `chat.typing` → store hết hạn như `typing-indicator.ts` |
| `native-chat-message-grouping.ts`, `chat-message-time.ts` | `lib/timeline-display.ts` | nhóm/ngày/giờ giống web |
| `chat-mention-utils.ts`, `chat-file-accept.ts` | `lib/mentions.ts`, `lib/file-accept.ts` | cùng case |
| `lazy-chat-scopes.ts` | import thuần | phòng đang mở + gần đây ≤ 25 scope |

Query key riêng (`data/queries/chat-keys.ts`, không import key factory của web — ADR 0011 §3). Đọc đánh dấu khi ở đáy danh sách và app active (mirror `use-mark-chat-room-read-at-latest`). Heartbeat hiện diện 15 giây khi foreground. Typing throttle như web.

## 4. Các `kind` tin

| Kind | M2a | Ghi chú |
|---|---|---|
| văn bản, trả lời, nhắc đến, reaction | đầy đủ | |
| tệp, ảnh | gửi + xem | picker, multipart `sendChatFileMessage`, giới hạn như `chat-file-accept`; ảnh `expo-image`, tệp mở bằng hệ điều hành |
| tin thoại | nghe | ghi ở M3 |
| poll | xem kết quả | bỏ phiếu ở M3 |
| note, post, nhắc, call-log, sticker, GIF | thẻ chỉ đọc | gửi/tương tác ở M3 |
| kind lạ | hàng "Mở trên web" (universal link) | test fallback |

## 5. Tiêu chí hoàn thành và test
- Test parity cho mọi tệp `lib/*-display.ts` (bảng §3).
- Kịch bản chéo (ghi vào issue): web và điện thoại cùng tài khoản — số chưa đọc/nhắc đến bằng nhau trước và sau khi đọc một phòng ở một bên; tin gửi từ điện thoại khi tắt mạng rồi bật → đến một lần.
- Realtime: tin mới hiện ≤ 1 giây khi mở phòng; rời phòng → unsubscribe; không vượt 25 scope; hết hạn token không rơi hội thoại.
- Mọi kind trong `chat-schemas.ts` có hàng; kind lạ không vỡ danh sách.
- VoiceOver/TalkBack đọc hàng hội thoại và tin; chạm ≥ 44 px; sáng/tối; vi/en.
- Lệnh: `pnpm --filter @uniwork/chat-mobile test|lint|typecheck`.

## 6. Rủi ro
URL media cần bearer hoặc chữ ký — builder đọc `use-chat-media-url.ts` để mirror; danh sách đảo chiều với ảnh có thể nhảy — dùng `FlashList`/`maintainVisibleContentPosition`.

## 7. Để builder quyết
Thứ tự làm trong lát; thư viện danh sách; cách hiện "Mở trên web"; swipe actions trên hàng hội thoại.
