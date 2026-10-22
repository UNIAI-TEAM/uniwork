# UniChat mobile — Hiệu năng

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Model hàng, danh sách tái chế, timeline dài, cửa sổ trượt, ảnh, bundle. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Hiệu năng (UNI-2053 S5; audit H1–H3, P2 Perf). **Danh sách tin**: `lib/message-row-model.ts` tính mỗi hàng một lần
  cho mỗi lần timeline đổi (quote, receipt, ô avatar, album, gốc chủ đề, việc) và trả lại đúng object cũ khi hàng vẽ
  như cũ; `components/chat/message-cell.tsx` (memo) nhận model, `ctx`, scheme và một object handler ổn định
  (`use-stable-handlers.ts`); `renderItem` của `MessageList` là `useCallback`. Ai đang gõ không nằm trong
  `useRoomContext`: bong bóng gõ và dòng trạng thái của header tự đọc (`room-typing.tsx`). **Danh sách phòng**:
  `buildRoomList` dựng hàng không có gõ và hiện diện; `room-list-view.tsx` phủ dòng gõ (`roomListTypingLines`), mỗi
  hàng DM đọc người kia bằng `useIsOnline` (selector theo từng người, `components/people/use-is-online.ts`; cũng
  dùng ở composer, danh bạ, `LivePersonAvatar` và các hàng người memo của `components/people/member-rows.tsx` — tin nhắn
  mới, tạo/thêm nhóm, chi tiết phòng; không màn nào đọc cả tập `onlineUserIds` trừ dải "đang hoạt động" của danh bạ),
  hàng so bằng `sameRoomListRow`, chạm vào hành động trên hàng mới
  nhất cùng key. Đừng truyền closure mới hay object dựng trong render vào một cell: test đếm render đỏ.
  **Danh sách tái chế** (`@shopify/flash-list` 2, chỉ JS — không đổi fingerprint): danh sách phòng, danh bạ
  (`components/contacts/contact-list.tsx`: section dàn phẳng thành ô chữ cái + ô người bằng `contactListItems`, chữ
  cái dính, chữ cái bên phải nhảy bằng `scrollToIndex` — `scrollToLocation` của SectionList không có `getItemLayout`
  ném invariant khi chữ cái nằm ngoài phần đã đo, crash cả app ở workspace lớn) và dải "đang hoạt động" (ngang).
  Ô tái chế không giữ state riêng (hiện diện đọc theo người của hàng), `getItemType` theo loại ô, avatar có
  `recyclingKey` (ô dùng lại không loé mặt người trước). FlashList 2 mặc định giữ hàng đầu đang thấy tại chỗ khi data
  đổi (`maintainVisibleContentPosition`, khác FlatList): danh sách phòng và danh bạ tắt nó (`{ disabled: true }`) —
  phòng có tin mới lên đầu phải hiện ở đầu, kết quả tìm bắt đầu từ kết quả đầu; `test/list-anchoring.ts` đọc cây host
  và test đỏ khi ScrollView nhận prop đó hay có `ScrollAnchor`. Ô tìm danh bạ lọc sau phím gõ (`useDeferredValue`).
  Jest: `test/jest-setup.ts` mock đo layout của FlashList (cửa sổ 400 × 900, ô 100) — `jestSetup.js` của gói trỏ
  tới export không có ở bản 2.0; danh sách dài trong test chỉ mount khoảng một màn như trên máy.
  Timeline tin nhắn vẫn là FlatList đảo ngược (lý do ở `message-list.tsx`: neo cuộn của danh sách đảo ngược chỉ kiểm
  được trên máy), chỉnh cửa sổ: 15 ô đầu, 10 ô một lượt, `windowSize` 11; nhảy tới tin xa hơn 30 hàng không animate,
  đích chưa đo thì cuộn theo chiều cao trung bình rồi thử lại chỉ số tối đa 3 lần, không animate. **Timeline dài**
  (`lib/timeline-perf.test.ts`, 2.000 tin): hàng có cùng tin, cùng tin được trích và cùng bộ đọc (`senderName`,
  `quoteText`, người xem, chủ đề) giữ tên và trích dẫn của lần trước, không gọi lại bộ đọc, và được trả lại nguyên object
  khi không gì nó vẽ đổi (`buildMessageRowModels` nhớ bộ đọc của mỗi map đã dựng); test đếm lời gọi bộ đọc khi có tin
  mới (≤ 2) và một ngân sách thời gian thô chặn việc dựng lại thành bậc hai. Vì vậy bộ đọc phải giữ identity:
  `useRoomContext` lấy người kia của DM qua `select` của query phòng (structural sharing — tin mới đổi record phòng,
  không đổi người kia), `receiptOf` phụ thuộc hai chuỗi con trỏ, không phải object. `messageDayKey` nhớ ngày theo
  timestamp (giới hạn 10.000, xoá khi múi giờ hiện tại đổi, xem tối đa mỗi phút): trước đó nó là phần lớn chi phí dựng.
  Bố cục timeline là một lượt (`lib/timeline-layout.ts › layoutTimeline`): mỗi tin đọc một lần, ra hàng theo thứ tự
  của danh sách đảo ngược (mới nhất trước — `MessageList` không đảo mảng mỗi lần đổi), chuỗi bong bóng nối, album và
  chỉ mục theo id mà trích dẫn đọc; hàng của một tin giữ theo object tin và tin ngay trước nó (cùng múi giờ —
  `dayKeysEpoch`), nên tin không đổi trả lại đúng object hàng cũ, và "là ảnh album" tính một lần mỗi tin.
  `buildTimelineRows`, `continuedRunKeys`, `albumsOf` là định nghĩa gốc mà `timeline-layout.test.ts` so bằng; test
  perf đếm số lần đọc mảng tin (một lượt mỗi lần đổi). Danh sách ảnh của trình xem chỉ dựng khi trình xem mở.
  Không đặt `maxPages` cho timeline: TanStack bỏ `pages[0]` khi thêm trang cuối, mà cache realtime
  (`room-timeline-pages`) coi trang đầu là trang mới nhất. Thay vào đó là cửa sổ trượt (`data/timeline-window.ts`,
  `components/chat/use-timeline-window.ts`): mỗi lần người đọc về tin mới nhất (không đang xem trang quanh một tin
  cũ), phòng bỏ các trang cũ nhất quá `KEPT_TIMELINE_PAGES` (8 trang, 400 tin), không bao giờ khi đang fetch; cuộn lên
  thì tải lại theo cursor. Mở lại phòng vẫn cắt về trang mới nhất.
  `lib/user-id.ts` (`userKey`/`sameUser`) thay `trim().toUpperCase()` ngoài các file copy từ web. Link việc của tin
  hỏi theo cửa sổ (`lib/link-windows.ts`, ranh giới theo hash id): tin mới chỉ refetch cửa sổ mới nhất; cửa sổ vừa
  đổi key giữ thẻ việc cũ của các tin trong nó tới khi có câu trả lời (`taskIdsByMessage`; `keepPreviousData` không áp
  dụng được vì `useQueries` tạo observer mới cho key mới). **Ảnh**: mọi
  ảnh là `expo-image` với `cachePolicy` memory-disk (`lib/media-source.ts`): ảnh chat khoá cache theo id tin + biến thể
  (`thumb`/`full`), avatar và icon workspace theo URL bỏ query (đường dẫn object đã là một tệp bất biến); server ký URL
  media chat theo đầu giờ (`chatMediaSigningWindow`, `files.ResolveInput.SigningWindow`) nên refetch trong giờ trả đúng
  URL và record cũ, và trả `width`/`height` của ảnh khi đọc được header lúc tải lên — bong bóng ảnh giữ đúng tỷ lệ
  (`bubbleImageSize`) trước khi ảnh tới. URL ký hết hạn (server ký 1 giờ, cache đĩa giữ timeline 7 ngày): ảnh vẫn vẽ
  bằng URL cũ (`useChatImageSrc` — cache đĩa theo id tin nên ảnh đã xem hiện ngay, cả offline; chưa xem thì ô xám), tin
  thoại/tệp chờ URL mới (`useChatMediaSrc`); mọi lần xin lại của một phòng trong 50 ms gộp một lượt
  (`data/media-refresh.ts`): ảnh thuộc timeline đang hiện về bằng một lần refetch timeline đó (nhập vào lần refetch
  đang chạy, như lần mở phòng) khi số ảnh ≥ số trang đã tải, còn lại (chủ đề, trang nhảy tới) xin từng tin — không còn
  N request, N lần ghi timeline và N lần lưu cache cho N ảnh. Không prefetch: `Image.prefetch` khoá cache theo URL, không
  theo `cacheKey` của ta. Theme: chọn
  một lần lúc boot (`data/theme-preference.ts`, `loadThemePreference` trong `app/_layout.tsx`), `useColorScheme` chỉ đọc
  store. **Đo**: `components/chat/conversation-renders.test.tsx` và `chat-tab-renders.test.tsx` (jest, job `mobile`)
  khoá số render của hàng khi gõ, hiện diện, tin mới, biểu cảm; ngân sách bundle như cũ. `inlineRequires` của Metro
  **không** bật: Metro 0.84 coi import đã bị inline là `require` (nhận diện import ESM theo vị trí khai báo), nên gói
  hai định dạng vào bundle hai lần (đo được: `@sentry/core` và `clsx` ESM + CJS, +176 module, +397 KB) — nạp lười thì
  `require` tường minh như `call-overlay.tsx`. Route không cần nạp lười bằng tay: expo-router chỉ đánh giá module
  của một màn khi màn đó dựng (`getComponent`), layout thì lúc khởi động; sheet ẩn trong phòng không fetch gì
  (`enabled` theo `visible`). `metro.config.js` đặt `includeWebReplay: false` của Sentry: gói session replay cho web
  (`@sentry-internal/replay*`) thành module rỗng (−182 KB bytecode; app không bao giờ ghi replay). Bản release
  Android qua R8 và thu gọn tài nguyên (`expo-build-properties` trong `app.config.ts`, luật giữ `ANDROID_KEEP_RULES`
  cho Nitro/MMKV và module cuộc gọi — các thư viện khác mang luật riêng): đường code nào R8 làm hỏng chỉ máy thấy —
  `android-smoke` mở lạnh bản đã minify, nightly đăng nhập, nhắn và vào cuộc gọi trên nó.
