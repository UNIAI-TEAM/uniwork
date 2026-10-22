# UniChat mobile — Offline-first

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Mở lạnh, kho trên máy, outbox, lượt chờ, nháp, cache đĩa, refetch khi reconnect. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Offline-first (UNI-2053 S3; audit P0-3, R1–R5, C1). **Mở lạnh**: `useAuthStore.initialize()`
  đọc cùng lúc phiên (`session.restore({ awaitRefresh: false })`: có credential là đủ, refresh chạy nền), người
  dùng cuối (`data/auth/last-user.ts`, Keychain cạnh phiên, ghi sau mỗi `/me`/`setUser`, bỏ qua khi epoch đổi),
  workspace và các hàng đợi; có credential + người dùng đã lưu thì vào inbox ngay và `/me` revalidate phía sau.
  Chỉ phán quyết của server (onChange(null), `onUnauthorized`) mới đăng xuất; offline/5xx/timeout giữ người dùng.
  Lần mở đầu của một bản cài mới (`data/install-marker.ts`: chưa có dấu `install/marker` trong kho MMKV — tệp của
  container, mất khi gỡ app — và kho chưa có key nào; bản nâng cấp từ trước dấu đã có key nên không bị nhầm, kho chỉ
  trong bộ nhớ thì không kết luận gì) bỏ phiên và người dùng cuối mà bản cài trước để lại trong Keychain (iOS giữ
  Keychain khi xoá app) qua `session.discardStored()` — xoá, không adopt, thu hồi thiết bị ở nền — trước khi đọc chúng:
  xoá app là đăng xuất.
  Server đã kết thúc phiên trước khi ai được vào (refresh hết hạn, thiết bị bị thu hồi) mà máy còn người dùng đã lưu
  hay hàng đợi thì xoá như đăng xuất (outbox và tệp, lượt chờ, cache đĩa, workspace); màn chat chỉ hiện và thử lại
  tin chờ của chính người đang đăng nhập (`selectRoomSends` lọc theo người gửi). `login()` và `adoptSession()`
  dùng chung một lần nhận người dùng; `restoreAccountCache` gộp hai lần gọi cho cùng người và chỉ lần gọi cuối
  được ghi đĩa (một lần dừng — đăng xuất, cài lại — làm lần khôi phục đang chạy không hydrate, không ghi).
  Splash (`expo-splash-screen`, plugin trong `app.config.ts`) giữ tới khi `isLoading` tắt, tối đa 8 s
  (`app/_layout.tsx`). **Kho trên máy**: `data/storage/device-store.ts` (thuần, mặc định bộ nhớ — test node không
  cần mock) ← `native-device-store.ts` cài lúc boot: MMKV (`react-native-mmkv` + `react-native-nitro-modules`)
  mã hoá AES-256, khoá ngẫu nhiên trong Keychain/Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Không mất dữ liệu
  im lặng: đọc khoá lỗi (máy chưa mở khoá lần đầu từ lúc bật) thì thử lại 3 lần (0.5 s, 1 s) trước khi bỏ đĩa; khoá mất
  mà tệp còn (khôi phục sang máy khác, Keystore bị xoá) thì xoá tệp có chủ ý và báo Sentry (`device_store_key_lost`),
  không mở khoá mới trên dữ liệu không đọc được; không mở được thì chạy bằng bộ nhớ (`durable: false`) và báo Sentry
  (tag `outcome: memory`), không chỉ log. Store zustand persist trên đó dùng `skipHydration` + hydrate trong `initialize()` và bỏ mọi
  lần ghi trước khi hydrate (không ghi đè hàng đợi trên đĩa bằng mảng rỗng). **Outbox**: `data/chat-send.ts` —
  mọi lần gửi (chữ, ảnh/tệp, tin thoại, nhắc hẹn) vào `stores/chat-send-store.ts` (persist; `sending` → `queued`
  khi đọc lại, `client_msg_id` làm replay an toàn), tệp chép vào `documents/outbox/<clientMsgId>/`
  (`data/outbox-files.ts`) trước khi xếp hàng, xoá khi server nhận, khi bỏ hoặc khi đăng xuất; lúc giao tìm lại bản
  chép theo `<clientMsgId>/<tên>` dưới thư mục documents hiện tại (iOS có thể dời container khi cập nhật), tệp đã mất
  thì tin thành `failed` ngay (không tải lên, hàng của phòng đi tiếp); mỗi (workspace, phòng, người gửi) có hai hàng
  FIFO nghiêm ngặt, một lần gửi một tin: chữ (chữ, trả lời chủ đề, nhắc hẹn) và media (ảnh, tệp, tin thoại). Chữ viết
  sau một media chờ nó (phòng đọc đúng thứ tự viết), trừ khi lần tải lên đó đã ở trên dây `MEDIA_OVERTAKE_MS` (4 s)
  hay đang chờ backoff: khi đó chữ đi trước, ảnh tới khi tới (như Telegram/WhatsApp) — tải lên chậm không giữ chữ của
  cả phòng. Guard flush theo workspace + người gửi; lỗi tạm thời giữ hàng đó và thử lại theo backoff của riêng hàng đó (chữ gửi được không huỷ lượt thử lại của ảnh, phòng lỗi không kéo dài lượt chờ của phòng khác); tin bị từ chối
  hẳn mà không ai thử lại sau `FAILED_SEND_TTL_MS` (14 ngày — workspace đã rời) bị bỏ cùng tệp. Outbox là của tài
  khoản, không của màn đang mở: `data/owed.ts › flushOwed` đẩy tin chờ và lượt chờ của **mọi** workspace của người
  đó, khi phiên sẵn sàng, NetInfo online, mỗi lần về foreground và lúc rời foreground (tin viết ngay trước khi chuyển
  app đi trong lúc JS còn chạy) (`data/use-account-sync.ts`, gắn ở
  `app/(app)/_layout.tsx` — cả màn chọn workspace) và khi socket reconnect (`use-chat-realtime.ts`). Không gì xả
  outbox khi app ở nền lâu: iOS cần module riêng cho `beginBackgroundTask`, còn task định kỳ của OS
  (`expo-background-task`) chạy ≥ 15 phút một lần và thêm manifest của WorkManager mà `scripts/android-manifest.mjs`
  không thấy (chỉ đọc gói được link, không đọc thư viện Maven) — hoãn tới khi kiểm được bằng bản build EAS. **Bản offline
  luôn mới** (`data/timeline-refresh.ts`, cùng hook): frame của phòng không ai xem chỉ đánh dấu stale (UNI-1078), nên lúc
  app rời foreground (còn mạng) các phòng trong 24 phòng gần nhất có timeline đứng sau — bị đánh dấu stale, cũ hơn
  preview của danh sách, hay chưa tải mà còn chưa đọc — được đọc trang mới nhất một lần (cắt về trang đầu trước: một
  request; tối đa `REFRESH_CONCURRENCY` = 4 request cùng lúc). `last_message_at` của danh sách tính cả trả lời chủ đề
  còn timeline thì không, nên timeline đã đọc theo một giá trị `last_message_at` không được đọc lại tới khi giá trị đó
  đổi (không thì phòng có tin mới nhất là trả lời chủ đề bị đọc lại mỗi lần rời app); push về một phòng, nhận lúc đang mở app hay khi chạm, đọc trang mới nhất của phòng đó và danh sách phòng
  của workspace (workspace đó có thể không có socket trên máy). Timeline đang hiện là của socket, không đụng. Push nền
  khi app đã đóng chưa nạp cache: cần push data/`content-available` (server) và task nền cho tin chat. **Đọc, biểu
  cảm, bình chọn offline**: `data/pending-ops.ts` + `stores/pending-ops-store.ts` — cache hiện lựa chọn ngay (`lib/optimistic-message.ts`, luật toggle của server),
  mỗi thứ một mục giữ mong muốn cuối; endpoint của server là toggle nên lần giao có thể đã tới (mất câu trả lời,
  khởi động lại) và mọi phiếu bầu đều GET tin trước rồi chỉ chạm phần còn khác; từ chối hẳn thì bỏ, refetch phòng
  và reject cho màn hình báo (lượt đọc thì báo Sentry, không toast). **Nháp** (`lib/drafts.ts`, `stores/draft-store.ts`, `components/chat/use-drafts.ts`): chữ đang viết và tin đang trích
  của từng (người, workspace, phòng, chủ đề) sống qua rời phòng và kill app — composer ghi sau 400 ms ngừng gõ, ngay khi
  composer đóng hay app rời foreground, gửi thì xoá; sửa tin mượn ô nhập rồi trả lại nháp; danh sách phòng hiện
  "Nháp: …" (trừ khi có người đang gõ). Persist như outbox (đọc qua `DraftSchema`, quá 30 ngày thì bỏ, có trong
  `persisted-schema.lock.json`), hydrate lúc boot, xoá khi đăng xuất. **Sửa và xoá tin cũng offline** (cùng hàng đợi,
  key `edit/<ws>/<msg>`, `delete/<ws>/<msg>`): sửa hiện ngay (`withEdit`: body mới + `edited_at`), lần sửa cuối thắng,
  giao bằng PATCH cả body (idempotent, không đọc trước); xoá gỡ tin khỏi timeline ngay và bỏ mọi mong muốn còn chờ cho
  tin đó (sửa, biểu cảm, phiếu); 404 khi giao là đã xong (tin đã mất), từ chối hẳn thì refetch phòng (tin quay lại) và
  reject cho màn hình báo. **Cache đĩa**:
  `data/query-persister.ts` — allowlist `["workspaces"]`, rooms, unread-summary, nicknames, members, room-members và
  trang mới nhất của 24 phòng hoạt động gần nhất; chỉ ghi khi một query được giữ có data mới (câu trả lời fetch, patch
  — không phải fetch bắt đầu, observer hay bộ nhớ bỏ query), sau 1 s yên; mỗi query được giữ một key MMKV
  (`query-cache/timeline/<queryHash>` cho timeline, `query-cache/query/<queryHash>` cho phần còn lại), chỉ ghi lại khi
  data đổi — data cùng object và cùng `dataUpdatedAt` với lần ghi trước thì không cả `JSON.stringify` (structural
  sharing giữ object; trang mới nhất cắt từ timeline được nhớ theo object data), nên một frame tuần tự hoá phòng đó và
  vỏ nhỏ ở `query-cache`, không phải danh sách 1.000 thành viên (test đếm `JSON.stringify`). Mở lạnh đọc hai bước: vỏ
  liệt kê `first` (workspaces, rooms, unread-summary, nicknames — màn đầu) và `later` (thành viên, thành viên phòng,
  timeline); splash chỉ chờ `first`, `later` đọc và hydrate `RESTORE_LATER_MS` (100 ms) sau (hydrate không ghi đè data
  mới hơn bộ nhớ đã fetch), và lần lưu trước đó không xoá key nào chưa đọc lại; vỏ cũ (query nằm trong vỏ, `timelines`)
  vẫn đọc được; buster
  `<CACHE_SCHEMA_VERSION>:<userId>` (bản store mới và OTA đều giữ cache, đọc qua schema). Đĩa không phải gương của bộ
  nhớ: `gcTime` 10 phút bỏ query không ai xem, nên query được giữ mà bộ nhớ đã bỏ được mang từ bản trước
  (`withEvicted`) tới khi quá 7 ngày hay phòng rời nhóm gần nhất / danh sách. Frame chỉ patch bộ nhớ nên không tới được
  bản mang theo: sửa, biểu cảm, xoá tin của phòng mà bộ nhớ không còn timeline thì bỏ bản đó khỏi đĩa
  (`dropCarriedTimeline`, gọi từ `chat-cache.ts`) — thiếu còn hơn sai. Query khôi phục từ đĩa sống trong bộ nhớ
  bằng tuổi của bản đĩa (`hydrateOptions` `gcTime` = 7 ngày; TanStack giữ `gcTime` lớn nhất nên observer 10 phút
  không rút ngắn): không gì đọc lại đĩa khi bộ nhớ thiếu, nên mở offline một giờ sau mở lạnh vẫn có trang. Khôi phục trước màn đầu
  (`restoreAccountCache` trong auth store), xoá khi đăng xuất (`dropAccountCache`, cả các key của từng query). Bản trên
  đĩa là dữ liệu không tin được như câu trả lời mạng (OTA giữ buster mà đổi code đọc): `data/persisted-cache.ts`
  kiểm vỏ rồi đọc lại data của từng query qua đúng schema đã dựng nó từ mạng (`data/chat-api-schemas.ts`,
  `data/schemas.ts`, schema của core như `ChatUnreadSummarySchema`), query không đọc được bị bỏ riêng (refetch như lần mở đầu), không chỗ nào cast từ đĩa. Outbox và
  lượt chờ cũng vậy: mỗi mục qua schema zod của `lib/persisted-records.ts` (cả trường lồng: tệp, tin thoại, nhắc
  hẹn), mục hỏng bị bỏ riêng; `migrate` của hai store chạy các bước theo version (`migratePersisted`) và giữ state của
  bản mới hơn (OTA bị rollback) thay vì để zustand xoá cả hàng đợi. `data/persisted-schema.lock.json` ghim hash của
  module schema với version của nó (`persisted-schema-lock.test.ts`): sửa schema thì quyết định có bump version không
  (bản ghi giữ shape mà đổi nghĩa → bump `CACHE_SCHEMA_VERSION`, hay version store + bước migrate), rồi
  `UPDATE_PERSISTED_LOCK=1`. Thêm query vào cache đĩa thì sửa `shouldPersistQuery`, reader trong `persisted-cache.ts`
  và test. **Realtime**: `chat-realtime.ts` không bỏ frame khi GET lỗi (tin mới →
  catch-up phòng, sửa/nhắc → refetch phòng, trả lời chủ đề → refetch chủ đề, danh sách theo sau); mỗi phòng một GET
  một lúc, frame đến trong lúc đó gộp theo tin và từ 2 tin mới trên timeline đang hiện thì đọc bằng một catch-up.
  Reconnect (về foreground sau cửa sổ ân hạn, mạng quay lại) giữ mọi trang đã cuộn của phòng đang hiện và refetch từng trang (nối lại từ trang
  mới nhất) để thấy sửa/xoá/biểu cảm lúc offline; chỉ mở lại phòng mới cắt về trang mới nhất.
