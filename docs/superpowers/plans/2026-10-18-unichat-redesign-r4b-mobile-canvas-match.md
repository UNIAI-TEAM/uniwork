# UniChat R4b — Đợt khớp canvas mobile — Kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-1916 (sub-issue của UNI-1895), nhánh `feature/UNI-1916-unichat-r4b-dot-khop-canvas-mobile-font`; code xong và đã chụp trên simulator, chờ review PR.

**Goal:** `apps/chat-mobile` khớp trang "Mobile" và các bảng Mobile* ở trang "Tổng quan" của canvas
(https://claude.ai/artifact/6bxcJnFj5gemA3BBqGgC8L) cả về giao diện lẫn tính năng, như web đã qua đợt
khớp canvas (spec `2026-10-18-unichat-redesign-design.md` §6). Xuất phát: đánh giá 2026-10-18 đối chiếu
20 artboard với mã — khớp ~65 %; khung, chữ, token sáng, a11y tốt; lệch ở font, bộ màu tối, sheet
workspace, hội thoại và một loạt tính năng canvas vẽ mà app chưa có.

**Spec:** `docs/superpowers/specs/2026-10-18-unichat-redesign-design.md` (§2 ngôn ngữ, §6 đợt khớp canvas);
plan R4 trước: `2026-10-18-unichat-redesign-r4-mobile.md`; luật app: `apps/chat-mobile/CLAUDE.md`.

## Quyết định giữ khác canvas (theo §6, áp cho mobile)

- Màu người / phòng là tint định danh (`identityTint`) như web, không phải hex của canvas; chữ cái đầu
  một ký tự như web.
- Tám màu tên người gửi là `--chat-sender-1..8` của `tokens.css` (web đã dùng), không phải tám hex của
  bảng Ngôn ngữ, để cùng một người cùng màu trên web và điện thoại.
- Mực chính / chữ phụ (`foreground`, `muted-foreground`) là token chung UniWork.
- Dải "Ảnh gần đây" trong sheet đính kèm cần `expo-media-library` (quyền thư viện ảnh mới): để R5.
- Rung (haptics) cần `expo-haptics`: để R5; chuyển động làm bằng Reanimated đã có.

## Ràng buộc

- Không đổi endpoint server; dữ liệu mới lấy từ API đã có: `GET /me/chat/unread-summary` (số chưa đọc
  theo workspace), `GET …/rooms/{id}/members` (`last_read_at`, `last_delivered_at` → đã xem / đã tới
  máy), `GET …/rooms/{id}/shared-summary`, `POST …/messages/{id}/forward`, `…/pin`, `POST …/chat/groups`,
  `GET …/chat/channels?scope=mine|discoverable`, `POST …/ai/chat/catch-up`.
- Màu chỉ qua token của theme ba file (`global.css`, `lib/theme.ts`, `tailwind.config.js`); các slot
  `chat-*` tối và `call-surface` lấy giá trị của canvas (ghi rõ trong comment), slot khác giữ tokens.css.
- Chữ mới qua `scripts/sync-i18n.mjs` (`CHAT_MOBILE_ONLY`), vi và en cùng lúc.
- Gói native mới: `expo-font` (plugin nhúng font), `expo-blur` → bump `version` trong `app.config.ts`.
- Helper thuần ở `lib/` có test vitest; copy từ web ghi nguồn.

## Tasks

- [x] **T1 — Font**: Inter (400/500/600) thân, Plus Jakarta Sans (600/700/800) tiêu đề và tên; nhúng
  bằng plugin `expo-font`; `font-sans` mặc định trong `components/ui/text.tsx`, `font-display` cho
  tiêu đề trang, tên hàng, tên workspace, chữ cái đầu, tên trong cuộc gọi, tiêu đề sheet.
- [x] **T2 — Token tối + nền gọi**: `chat-wall` tối `#0d1524`, `chat-bubble-other` tối `#1e2532`,
  `chat-bubble-own` tối `#2f6bf0` chữ trắng, slot `call-surface` `#0b1220`; bong bóng rộng tối đa 72 %;
  ô soạn 48; avatar danh sách 50.
- [x] **T3 — Workspace**: sheet chuyển workspace (MobileWorkspaces) từ pill và từ Cài đặt, hàng có meta
  "Đang mở · n tin chưa đọc / Không có tin mới / Đã tắt thông báo", dấu check, badge; badge đỏ trên pill
  = chưa đọc ở workspace khác; phụ đề "ORG · n workspace bạn tham gia" ở màn chọn; badge số trên tab
  Trò chuyện. Nguồn: `unread-summary`.
- [x] **T4 — Danh sách**: banner "Bắt kịp nhanh" (mở sheet tóm tắt qua `ai/chat/catch-up`), dấu "Đã xem"
  cạnh giờ, "Cuộc gọi nhỡ" đỏ, prefix người gửi đậm, placeholder "Tìm kiếm", chip "Tất cả" có số,
  banner offline + hàng "Chờ có mạng để gửi".
- [x] **T5 — Hội thoại**: avatar 30 cạnh bong bóng người khác (đầu lượt), bong bóng "đang nhập" ba chấm,
  tick 1/2 xám/2 brand theo `last_delivered_at` / `last_read_at`, album 2 cột, thanh "Tin ghim n/m" dưới
  header, badge chưa đọc cạnh nút back, lưới chấm trên tường (ảnh 22×22 lặp), tên người gửi màu hash
  trên bong bóng nâng.
- [x] **T6 — Nhấn giữ**: nền mờ (`expo-blur`), hàng "n người đã xem" + avatar (copy
  `read-receipt-utils` web), nút "Thêm cảm xúc" mở sheet biểu cảm, Ghim / Bỏ ghim, Chuyển tiếp (sheet
  chọn phòng), gợi ý "Giữ liên kết" / "2 giờ nữa", bộ 🎉, nhãn a11y cảm xúc theo tên.
- [x] **T7 — Sheet & trạng thái**: trình xem ảnh có người gửi + giờ, "i / n" + chấm trang, Chia sẻ;
  waveform khi ghi âm; gợi ý @ có avatar, chấm online, hàng @all; nhãn "Hủy trả lời".
- [x] **T8 — Chủ đề & thông tin phòng**: placeholder "Trả lời trong chủ đề…", ring quanh tin gốc, back
  "Quay lại cuộc trò chuyện"; thông tin phòng: tiêu đề giữa, quick action Gọi / Thêm, mục Ảnh / Tệp /
  Liên kết / Thoại từ `shared-summary` với 6 ảnh, hàng "Ghi chú, ghim, bình chọn", nhãn "Tìm", vai trò
  "Quản trị".
- [x] **T9 — Tab & màn phụ**: badge số nhỡ trên chip Cuộc gọi; chỉ mục A–Z ở Danh bạ; icon Đăng xuất,
  tile workspace và nhãn "Đang ở …" ở Cài đặt; hàng "Tạo nhóm" + màn chọn thành viên (`chat/groups`);
  kênh "Đã tham gia" (gộp `scope=mine`); header phụ không viền; icon quả cầu "Duyệt kênh".
- [x] **T10 — Cuộc gọi**: thanh trên (thu nhỏ → pill nổi, "Đang ghi", thêm người), pill "UNI sẽ tóm tắt",
  thứ tự Loa · Camera · Micro · Kết thúc, nhãn "Đã tắt micro", "Cuộc gọi thoại · mm:ss", vòng quanh
  Nghe máy, một vòng khi gọi đi, icon phone-off khi kết thúc, scrim video, `accessibilityLabel` hộp
  thoại + live region thời lượng.
- [x] **T11 — Đăng nhập**: minh hoạ hai bong bóng + chip cuộc gọi trên tường chấm, dòng "Đăng nhập bằng
  tài khoản UniWork trong trình duyệt".
- [x] **T12 — Chuyển động**: gửi 180 ms, cảm xúc spring, nhấn giữ 200 ms, vuốt 56 px để trả lời, giảm
  chuyển động → 120 ms.
- [x] **T13 — Kiểm**: typecheck, lint, vitest; build lại dev client (gói native mới) và chụp trên
  iPhone thật cạnh từng bảng Mob*; cập nhật `apps/chat-mobile/CLAUDE.md`; PR.

## Ghi chú khi xong (2026-10-19)

- Kiểm: `typecheck`, `lint`, `pnpm test` của app (63 tệp / 776 test, ngưỡng coverage), `pnpm knip`, các test hợp
  đồng `mobile-core-allowlist`, `i18n-chat-key-parity`, `governance`, `no-usf-leak`, `no-legacy-tokens` — xanh.
- Kiểm bằng mắt: dev client trên simulator iPhone 16e (390×844, đúng khổ canvas), dữ liệu dựng theo canvas trong DB
  local (10 người, nhóm "Ra mắt UniWork Q4", kênh, DM, album, ghim, bình chọn, thread, cuộc gọi nhỡ); 34 ảnh ở
  `docs/evidence/unichat/r4b-mobile/`. Simulator iOS 26.3 trên máy Intel không vẽ emoji (Safari trong simulator cũng
  vậy), nên emoji hiện thành ô "?" trong ảnh; máy thật không bị.
- Sửa thêm khi chụp: các tab Cuộc gọi / Danh bạ / Cài đặt không nhận `[org]/[ws]` khi mở từ thanh tab (có từ trước)
  — `useWorkspaceSlugs()` đọc thêm tham số của URL; danh sách chọn thành viên thiếu `extraData`.
- Quyết định tự chốt (chủ sản phẩm duyệt trong PR): giữ tám màu tên người gửi và mực chính của tokens.css (cùng màu với
  web), mặt người/phòng là tint định danh đặc như web; thông tin phòng mở bằng chạm tên ở header (canvas không có nút i);
  cuộc gọi thu nhỏ thành một nút xanh "Quay lại cuộc gọi" dưới header (canvas không vẽ trạng thái này); "Theo dõi sau" đặt hạn 2 giờ.
- Chưa làm, có lý do: dải "Ảnh gần đây" trong sheet đính kèm (cần `expo-media-library` + quyền thư viện mới); rung
  (`expo-haptics`); công tắc "Báo tin từ mọi workspace" (server chưa có cài đặt này); "Thêm người vào cuộc gọi" (server
  chưa có luồng nâng cuộc gọi 1-1 thành nhóm); trạng thái "Hoạt động 5 phút trước" (không có dữ liệu lần cuối hoạt
  động); danh sách tệp / liên kết / thoại trong tab Đã chia sẻ (server chỉ trả số đếm và 6 ảnh mới nhất).
