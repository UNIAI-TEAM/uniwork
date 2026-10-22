# UniChat mobile — Tab Chat

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Ba lớp của tab Chat, key, cache, màn hình và luật của file route. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Tab Chat (M2a, UNI-1832; spec `2026-10-16-unichat-mobile-chat-design.md`,
  plan `2026-10-17-unichat-mobile-chat.md`). Ba lớp:
  `lib/*` thuần, copy từ web có ghi nguồn và test parity chạy đúng case của
  test web (`rooms-display`, `typing-display`, `timeline-display`,
  `send-pipeline`, `file-accept`, `media-body`,
  `people-display`, `message-display`, `room-list`; hash nguồn ở `web-copies.json`); `data/*` — endpoint
  (`chat-api.ts`, mỗi endpoint một case malformed), key riêng
  (`queries/chat-keys.ts`, không import `chatKeys` web; mỗi resource một module và một key factory — `chatKeys`
  (mọi key dưới `["chat", wsId]` trừ unread-summary của cả tài khoản, kể cả call log, preview nhấn giữ, ghi âm
  cuộc gọi; `chat-keys.test.ts` đỏ khi một key lồng dưới prefix của key khác ngoài các họ đã khai),
  `org-members.ts` (khoá tầng tổ chức), `workspaceKeys`, `deviceKeys`; thành viên workspace và biệt danh chỉ
  đọc qua `chatApi`. Call log refetch khi có `chat.voice.hangup` (server ghi log trước khi phát frame), khi hangup
  của chính máy xong (`onHangupSettled` của `call-store.ts`) và khi reconnect; reconnect cũng refetch thành viên), cache
  (`chat-timeline.ts` bind `createRoomTimelineCache` của core với key và `chatApi` của app, chỉ giữ riêng lần làm mới sau
  reconnect — giữ các trang đã cuộn; `chat-cache.ts` nối frame vào cache của app qua `chat-cache-records` của core, viewer
  là tham số), outbox bền (`chat-send.ts` +
  `stores/chat-send-store.ts`, mục Offline-first), `realtime/chat-realtime.ts` (bảng §8
  spec cha, thuần) và `realtime/use-chat-realtime.ts` (hook mỏng, gắn ở
  `[org]/[ws]/_layout.tsx`, ≤ 25 scope qua `selectLazyChatScopeRoomIds`);
  màn hình ở `app/(app)/[org]/[ws]/{(tabs)/chat,room/[roomId]/{index,info,thread/[rootId]},new-chat,new-group,channels}.tsx`
  + `components/chat/*`. Route tab `/{org}/{ws}/chat` nhận `room`/`message`/`dm`
  của `lib/deep-link.ts › deepLinkHref` (hợp đồng với push và tab khác): `lib/deep-link-target.ts` (thuần) quyết
  định, `components/chat/use-deep-link-target.ts` (jest) làm. `dm=` từ ngoài app hỏi trước khi mở; "Nhắn tin" trong
  app (Danh bạ, thông tin phòng) đi qua `inAppDmHref`, bảo lãnh trong bộ nhớ (một DM, một lần, 10 s — không bao giờ là
  param, vì URL nào cũng giả được param) nên mở thẳng. File route chỉ ghép màn — query, state của màn và nối
  các phần — và **không được đo** (jest không đo `app/`), nên logic có nhánh nằm ở `lib/` (thuần, vitest —
  `quickCatchUp`, `pickerPeople`, `channelDirectory`, `canCallRoom`, `keptCounts`, `missedCallCount`,
  `selectQueuedRoomIds`) hoặc ở component/hook của `components/` có test jest; không đặt test dưới `app/`. Component
  con không định nghĩa trong file route, và đây là luật có test: `lib/route-files.test.ts` đỏ khi một file route
  định nghĩa hàm, component hay hook nào ngoài export default và các tên liệt kê kèm lý do ở đó (`ErrorBoundary`,
  composition root của `app/_layout.tsx`, thân màn sau cổng workspace như `RoomInfo`; danh sách chỉ co lại). Phần
  con nằm ở `components/`: `components/calls/call-log-{row,filters}.tsx`, `components/contacts/*` (dải đang hoạt
  động, hàng người, chữ cái nhảy mục), `components/settings/option-group.tsx`, `components/chat/room-info/*` (đầu
  trang, nút nhanh, kết quả tìm, ghim, thành viên, rời phòng, "Đã chia sẻ"); realtime cấp workspace là
  `data/realtime/use-workspace-realtime.ts`. JSX có điều kiện còn lại trong file route (chọn trạng thái rỗng/lỗi,
  handler một dòng) không có test component.
  Chuỗi: cả subtree `chat` của core + `chat.mobile.*` trong
  `scripts/sync-i18n.mjs`. `lib/message-display.ts › messageContent` đọc record một lần thành union phân biệt
  (`{ view: "image", file }`, `{ view: "poll", poll }`…): card nhận payload đã thu hẹp, không `x!` (lint
  `@typescript-eslint/no-non-null-assertion` đỏ trong `app/`/`components/`); kind lạ hay kind biết mà thiếu payload →
  `unsupported` → hàng "Mở trên web" (`expo-web-browser`, không kích hoạt universal link).
