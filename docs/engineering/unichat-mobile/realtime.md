# UniChat mobile — Realtime

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Ba tầng socket, decoder frame, luật socket, ân hạn nền, khôi phục phiên. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- `data/` (Task 2–3) — `auth/*` (port từ `apps/chat-desktop/src/main/auth/*`),
  `realtime/ws-client.ts`, `api.ts`, `secure-storage.ts`, `session-epoch.ts`.
  Realtime ba tầng: `ws-client` (socket, auth frame, scope/replay, 4001 →
  refresh → reconnect), `realtime-provider` (mount theo auth + workspace,
  AppState/NetInfo), `use-<feature>-realtime` (hook theo feature, patch rồi
  invalidate hẹp). Mọi frame đi qua `realtime/frames.ts` trước khi tới handler: mỗi event điện thoại xử lý (và
  `subscribe_ack`/`subscribe_error`) có một decoder zod (object loose, chỉ key của `docs/events/CATALOGUE.md`,
  id cần thì bắt buộc và khác rỗng); payload sai thì frame bị bỏ kèm breadcrumb (tên event + key hỏng, không giá
  trị), type chưa liệt kê đi qua nguyên vẹn. `ws.on(type)` nhận payload đã có kiểu, `onAny` dùng `isKnownFrame`
  để thu hẹp; không ép kiểu payload ở đâu cả (cả `call-engine.ts`). `frames.test.ts` đọc CATALOGUE.md: decoder
  chỉ được đọc key mà catalogue liệt kê. Luật socket: frame `subscribe`/`unsubscribe` chỉ đi sau
  `auth_ack` (server đòi auth là frame đầu; replay lo phần còn lại); frame
  `{error}` trước auth là kết thúc của socket đó — `onSessionEnded(error)`, client
  không tự redial; provider giao cho `realtime/socket-recovery.ts` (thuần): 4001 và
  `invalid token` thì refresh, refresh lỗi tạm thời thì thử lại theo backoff
  2/5/15/60 s có jitter (`data/retry-timers.ts`), `too many connections` thì redial
  theo cùng backoff, lời từ chối khác (không phải thành viên) thì chờ tín hiệu sau;
  reset khi socket `online`. Vào background thì socket ở lại `BACKGROUND_GRACE_MS` (25 s,
  `realtime/background-grace.ts`, thuần) rồi mới pause — chuyển app nhanh (chép OTP) không reconnect, không refetch;
  `active` trong cửa sổ đó thì `ws.probe()` (heartbeat ngay, không pong trong 10 s thì thay socket), còn sau khi đã
  pause, quá cửa sổ (iOS treo JS nên timer không chạy) hoặc socket chưa auth thì `resume()`. Reader token cho provider là
  `realtime/refresh-for-socket.ts` (thuần): thử token hiện tại trước, refresh
  khi vẫn là token đã chết, thất bại tạm thời thì reject để giữ phiên.
  `ws-client` báo trạng thái `connecting`/`online`/`waiting`/`offline`
  (`onConnectionStateChange`), provider đưa qua `useConnectionState()` cho
  `components/chat/connection-banner.tsx` ("Đang chờ mạng…" khi NetInfo offline,
  "Đang kết nối…" khi socket mất quá 1.5 s; trên danh sách chat và mọi cuộc trò chuyện).
  "Online" của app là `lib/reachability.ts`: có kết nối **và** internet không bị biết là không tới được
  (`isInternetReachable !== false`) — captive portal hay Wi-Fi chết là offline cho `onlineManager` (query dừng, hàng
  đợi giữ), cho cạnh offline → online (flush, `forceReconnect`) và cho banner. `data/query-client.ts` gọi
  `NetInfo.configure` trước mọi listener: iOS thăm dò `GET <apiUrl>/api/v1/healthz` (200 `{"status":"ok"}`; trang đăng nhập
  của portal không qua; dưới `/api` vì edge production chỉ đưa `/api` tới server, `/healthz` trần rơi vào web), 60 s một lần khi tới được, 5 s khi không; Android dùng `NET_CAPABILITY_VALIDATED` của OS.
- Frame chat là ephemeral và không có số thứ tự, nên frame mất (socket rớt, hay relay làm rơi khi socket còn sống)
  được tìm lại bằng nhật ký thay đổi của server (`data/chat-sync/sync.ts`, `GET …/chat/sync`; chi tiết ở
  `offline-first.md` › Nhật ký thay đổi): `chat-realtime.ts › reconnect` và kiểm tra sống 60 s
  (`LIVE_CHECK_MS`, chỉ khi `ws.getConnectionState() === "online"` và app `active`) hỏi nó trước, đường refetch cũ
  chỉ chạy khi nó không trả lời được.
