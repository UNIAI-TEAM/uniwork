# UniChat M2a — Tab Chat: danh sách hội thoại hợp nhất và hội thoại lõi — Kế hoạch triển khai

> **Trạng thái:** shipped — merge vào develop 2026-10-17 qua PR #342 (squash bd3216771); issue UNI-1832.

**Spec:** `docs/superpowers/specs/2026-10-16-unichat-mobile-chat-design.md` (spec cha §6 M2, §8). **Mẫu:** plan M1 `2026-10-17-unichat-mobile-foundation.md`.

**Mục tiêu:** tab Chat của `apps/chat-mobile` dùng được hằng ngày: danh sách hợp nhất đếm như web, hội thoại gửi/nhận realtime (văn bản, ảnh/tệp, trả lời, luồng, reaction, đã đọc, đang gõ, hiện diện, nhắc đến), gửi không mất khi mạng chập chờn. Không làm gọi, ghi âm, bỏ phiếu, gửi sticker/GIF, follow-up, tạo task (M3) và ba tab còn lại (M2b).

## Ràng buộc chung

- ADR 0011: chỉ import core theo allowlist (`chat-room-helpers`, `read-receipt-utils`, `lazy-chat-scopes`, `client-msg-id`, `pending-message-id`, `typing-user-id`, `poll-utils`, `room-permissions-utils`, `api/endpoints/chat-schemas`, `api/schema`); mọi logic web khác **copy, ghi nguồn một dòng**, test parity dùng lại đúng case của test web. Không đụng allowlist.
- Hợp đồng với M2b: route tab `/{org}/{ws}/chat` nhận `room`, `message`, `dm` đúng như `deepLinkHref()` sinh ra; không sửa `calls.tsx`, `contacts.tsx`, `settings.tsx`, không đổi `lib/deep-link.ts`.
- Query key riêng `data/queries/chat-keys.ts`; realtime ba tầng: `data/realtime/chat-realtime.ts` (thuần, test bằng `QueryClient` thật) + `use-chat-realtime.ts` (hook mỏng, gắn ở layout workspace), ≤ 25 scope qua `selectLazyChatScopeRoomIds`.
- Vitest env node: mọi `lib/*.ts`, `data/*.ts` thuần có test; hook/màn hình (`.tsx`, file chạm `react-native`) nằm ngoài coverage như M1.
- i18n: `scripts/sync-i18n.mjs` lấy cả subtree `chat` của core; chuỗi chỉ mobile ở `chat.mobile.*`.
- File ≤ 500 dòng; comment tiếng Anh.

## Quyết định builder (spec §7)

| Mục | Chọn | Lý do |
|---|---|---|
| Thứ tự | dữ liệu + parity → danh sách → hội thoại → luồng → thông tin phòng → DM mới/thư mục kênh | Lớp thuần có test trước, màn hình chỉ ráp |
| Thư viện danh sách | `FlatList` `inverted` + `maintainVisibleContentPosition` | Có sẵn trong RN; danh sách đảo chiều giữ vị trí khi nạp tin cũ; không thêm FlashList |
| "Mở trên web" | Một hàng dưới tin, mở `{appUrl}/{org}/{ws}/chat?room=&message=` bằng `expo-web-browser` | Trình duyệt trong app không kích hoạt universal link nên không vòng về UniChat |
| Swipe trên hàng hội thoại | Không; nhấn giữ → sheet (Ghim/Bỏ ghim, Tắt/Bật thông báo) | Một cơ chế cho cả hai nền tảng, không thêm cử chỉ |
| Ghim | Lưu trên máy (SecureStore, theo workspace), như web lưu ở trình duyệt | Server không có ghim phòng |
| Hàng đợi gửi | Trong bộ nhớ, trạng thái `sending/queued/failed`, flush khi NetInfo online hoặc socket reconnect; server khử trùng theo `client_msg_id` | Spec: "retry trong phiên" |
| Bàn phím | `KeyboardAvoidingView` của RN | Không thêm native dep; rủi ro Android ghi ở PR |
| Native dep mới | `expo-image`, `expo-image-picker`, `expo-document-picker`, `expo-clipboard`, `expo-audio` (chỉ phát) | Ảnh, chọn ảnh/tệp, sao chép, nghe tin thoại |
| Nội dung tin | Văn bản thuần + tô nhắc đến; không render markdown | Đủ cho M2a; markdown để sau |
| Reaction | 6 emoji nhanh trong sheet + chip bật/tắt | Không có bộ chọn emoji native |
| Tìm tin | Ở màn Thông tin phòng; chạm kết quả → hội thoại neo tại tin (`listChatRoomMessagesAround`) | Cùng đường với deep link `message` |

## Task 1 — Nền: dep, i18n, multipart

- `apps/chat-mobile/package.json` (+ lockfile), `app.config.ts` (plugin `expo-image-picker`, không camera) + `app.config.test.ts`.
- `scripts/sync-i18n.mjs`: `chat` thay `chat.no_conversation_hint`; `chat.mobile.*`; `locales/{vi,en}.json` sinh lại.
- `data/api.ts`: body `FormData` không gắn `Content-Type: application/json`; test trong `data/api.test.ts`.

## Task 2 — Lớp thuần có test parity (`lib/`)

- `lib/search-fold.ts` ← `views/chat/chat-search-fold.ts`; `lib/media-body.ts` ← `chat-expression-utils.ts` (phần đọc); `lib/mentions.ts` ← `chat-mention-utils.ts` (+ `mentionSegments`); `lib/file-accept.ts` ← `chat-file-accept.ts` (tài sản picker thay `File`).
- `lib/rooms-display.ts` ← `chat-sidebar-unified.ts`, `chat-sidebar-preview.ts`, `chat-sidebar-typing.ts`, `typing-indicator.ts`, `contacts-store` (nhãn/biệt danh), `room-preferences-store` (`comparePinnedRoomOrder`), quyền gửi (`chat-room-moderation-utils`).
- `lib/timeline-display.ts` ← `chat-message-time.ts`, `native-chat-message-grouping.ts`, `native-chat-message-timeline.ts`.
- `lib/send-pipeline.ts` ← `merge-optimistic-chat-messages.ts`, `send-retry.ts`.
- Test: mỗi file một `.test.ts` copy case của test web tương ứng (cùng input → cùng output).

## Task 3 — Dữ liệu (`data/`)

- `data/chat-api.ts` (copy endpoint web qua `api.request`; test malformed cho từng endpoint), `data/queries/chat-keys.ts`, `data/queries/chat.ts` (query options).
- `data/chat-timeline.ts` ← `core/chat/room-timeline.ts` (phần thuần); `data/chat-cache.ts` ← `realtime-cache.ts`, `use-chat-room-read-sync.ts`.
- `data/stores/chat-send-store.ts` + `data/chat-send.ts` (gửi, xếp hàng, flush) — test: offline → `queued` → online → gửi một lần, không trùng; lỗi vĩnh viễn → `failed`.
- `data/stores/chat-typing-store.ts`, `data/stores/chat-presence-store.ts` ← core stores; `data/stores/chat-pins-store.ts`.
- `data/realtime/chat-realtime.ts` (bảng §8: created/updated/deleted/thread.replied/room.read/activity/mention/typing/presence/subscribe_ack) + test; `use-chat-realtime.ts`, `use-chat-presence.ts` (heartbeat 15 s khi foreground).

## Task 4 — Màn hình

- `(tabs)/chat.tsx` (danh sách, tìm, `+`, deep link `room|message|dm`), `components/chat/room-row.tsx`, `components/ui/action-sheet.tsx`.
- `room/[roomId]/index.tsx` (hội thoại), `components/chat/{message-list,message-row,message-cards,composer,message-actions,image-viewer}.tsx`.
- `room/[roomId]/thread/[rootId].tsx`, `room/[roomId]/info.tsx` (thành viên, mute, tìm tin, rời phòng), `new-chat.tsx` (DM mới), `channels.tsx` (thư mục kênh, tham gia).
- `[org]/[ws]/_layout.tsx`: gắn `useChatRealtime(wsId)`.

## Task 5 — Kiểm và bàn giao

- `pnpm --filter @uniwork/chat-mobile test|lint|typecheck`; `node --test scripts/mobile-core-allowlist.test.mjs scripts/no-usf-leak.test.mjs`.
- Không chạy simulator/thiết bị (orchestrator smoke sau); kịch bản chéo §5 ghi vào issue.
- `apps/chat-mobile/CLAUDE.md`: thêm mục Chat.

## Tiến độ (2026-10-17)

- [x] Task 1 — dep, plugin picker, i18n (`chat` + `chat.mobile.*`), multipart + `Retry-After` ở `data/api.ts`.
- [x] Task 2 — `lib/*` parity; thêm `people-display`, `message-display`, `room-list`, `chat-routes` (thuần, có test).
- [x] Task 3 — `data/*`: endpoint, key, timeline, cache, hàng đợi gửi, store, realtime; coverage `lib/**` + `data/**` giữ 100 %.
- [x] Task 4 — màn hình danh sách, hội thoại, luồng, thông tin phòng, DM mới, thư mục kênh; hook realtime gắn ở layout workspace.
- [x] Task 5 — lệnh kiểm như trên xanh; `CLAUDE.md` của app có mục Chat.
- [ ] Còn lại ngoài tầm lát code: smoke trên simulator/máy thật (orchestrator) và kịch bản chéo web + điện thoại §5 (ghi ở issue UNI-1832).
