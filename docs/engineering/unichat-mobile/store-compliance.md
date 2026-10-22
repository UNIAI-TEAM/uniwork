# UniChat mobile — Tuân thủ store

> **Trạng thái:** shipped · tách từ `apps/chat-mobile/CLAUDE.md` ngày 2026-10-22; bản đồ ở `apps/chat-mobile/CLAUDE.md`.

Xoá tài khoản, pháp lý, giấy phép, đồng ý AI, báo cáo và chặn, FGS Android, hồ sơ store. Đường dẫn trong file này tương đối với `apps/chat-mobile/` trừ khi bắt đầu bằng `docs/`, `server/`, `packages/`,
`scripts/` hay `.github/`.

- Tuân thủ store (UNI-2053 S2; Apple 5.1.1(v), 1.2, 5.1.2(i), Play account deletion/UGC/FGS). **Xóa tài khoản**:
  Cài đặt › Xóa tài khoản (`components/settings/delete-account.tsx`, port dialog web; cả ở Cài đặt của tài khoản
  `app/(app)/account.tsx` — `accountRoutes` của `lib/chat-routes.ts`, ngoài mọi workspace, mở từ nút Cài đặt của
  `select-workspace` ở mọi trạng thái kể cả danh sách rỗng: xoá tài khoản và trang pháp lý không bao giờ nằm sau một
  workspace; giấy phép cũng ở `/licenses`) nêu hệ quả, xin một bằng chứng
  theo `lib/account-deletion.ts` (mật khẩu, else mã hai lớp, else gõ lại email), gọi `POST /me/delete`
  (`data/account-api.ts`), `owner_must_transfer` → hướng dẫn chuyển quyền trên web; thành công thì
  `useAuthStore.accountDeleted()` (không gọi server: phiên và push đã bị thu hồi; như đăng xuất, xoá người dùng đã
  lưu, outbox và tệp của nó, lượt đọc/biểu cảm chờ gửi, cache đĩa) + `data/local-wipe.ts` (cache ảnh,
  thông báo, badge, lựa chọn push, ghim từng workspace; theme và ngôn ngữ giữ vì là của máy). **Quyền riêng tư và pháp
  lý** (`components/settings/legal-section.tsx`, link ở `lib/legal-links.ts`: `/privacy` và `/vi/privacy`, neo
  `#delete-account`, điều khoản `/terms` và `/vi/terms` — cấm nội dung phản cảm, Apple 1.2 —, `mailto:` hỗ trợ — không
  có app mail thì chép địa chỉ; màn đăng nhập nói đăng nhập là đồng ý điều khoản và có link hai trang,
  `components/settings/sign-in-legal-note.tsx`, như trang đăng nhập/đăng ký web), mở trang qua
  `components/settings/use-open-web-page.ts`. **Giấy phép**: route `licenses.tsx` đọc `assets/licenses.json`, sinh bởi
  `scripts/generate-licenses.mjs` (đi cây `dependencies` production qua node_modules của pnpm, bỏ `@uniwork/*` và gói
  ghim OS/CPU; `lib/licenses.test.ts` chạy `--check` — đổi dependency thì chạy lại script). **Đồng ý xử lý AI**:
  `lib/ai-consent.ts` (`AI_CONSENT_VERSION`, nhà cung cấp Anthropic; đổi nhà cung cấp hay dữ liệu gửi đi thì đổi
  version để hỏi lại mọi người, và sửa mục AI của `privacy-content.ts` cùng PR), câu trả lời lưu ở server
  (`PUT/DELETE /me/ai-consent`, `user.ai_consent_version`) qua `data/ai-consent.ts`; `catch-up-sheet.tsx` không gọi AI
  khi chưa đồng ý mà vẽ `components/chat/ai-consent-notice.tsx`; tính năng AI mới trên điện thoại dùng cùng
  `useAiConsent()`. Đồng ý chỉ do client giữ: không route AI nào của server đọc nó, và tin của người dùng vẫn tới
  Anthropic khi thành viên khác dùng AI trên web — chính sách và dòng "Xử lý AI" của listing nói đúng vậy
  (`privacy-content.test.ts`), đừng viết lại thành "chỉ khi người dùng đồng ý". **Báo cáo và chặn**: `data/safety-api.ts` (route chặn qua factory `chat-users-api` của core + `POST …/chat/reports`), key
  `chatKeys.blockStatus`, `data/queries/safety.ts`, lệnh chặn `data/safety-actions.ts` qua `data/mutations/safety.ts`; `components/chat/report-sheet.tsx` (lý do đóng theo
  `lib/report.ts` = CHECK của server, mô tả, "chặn luôn"), `room-safety.tsx` (DM: chặn/bỏ chặn + báo cáo trong chi
  tiết, banner trong cuộc trò chuyện; nhóm: chạm thành viên → nhắn riêng/báo cáo/chặn), nhấn giữ tin của người khác ›
  Báo cáo. Audit `chat.report.created` ghi người báo cáo làm actor, nên chủ sở hữu và quản trị viên (kể cả khi chính họ
  bị báo cáo) thấy ai đã báo cáo: sheet và chính sách nói thế, không hứa ẩn danh (`report-sheet.test.tsx`,
  `privacy-content.test.ts`). Nhà vận hành thấy mọi báo cáo ở hàng đợi của console `/admin/chat-reports` (mã và lý do,
  không nội dung; `AdminService.ListChatReports`/`ResolveChatReport`, đóng ghi `chat.report.resolved` vào nhật ký của tổ
  chức) và nhận alert `UniChatReportFiled` (còn báo cáo mở) và `UniChatReportOverdue` (chờ quá 20 giờ), cả hai đọc hàng đợi lúc scrape (`metrics.ChatReportQueueCollector`); điều khoản hứa xử lý trong 24 giờ (vô hiệu hoá người đăng qua tổ chức — chặn
  người, tin cũ vẫn hiện — hay tạm ngưng tổ chức, cách duy nhất ẩn nội dung; chưa ai xoá được tin của người khác). **Android FGS**: `expo-audio` tắt phát/ghi nền tường minh, `plugins/with-removed-android-services.js` gỡ
  `MediaProjectionService` (`tools:node="remove"`); FGS duy nhất là dịch vụ cuộc gọi (`phoneCall|microphone|camera`,
  mục Cuộc gọi native); `android-manifest.test.ts` giữ danh sách quyền và dịch vụ cuối của
  bản release (`scripts/android-manifest.mjs`: introspect của `expo config` với biến thể production + manifest của
  từng thư viện được link). Thêm quyền/dịch vụ thì sửa test đó, bảng quyền của `store/listing.md` và checklist Play
  App content của runbook cùng PR.

- `store/listing.md`: mô tả vi/en, độ tuổi 18+ (khớp chính sách), privacy labels (có dòng xử lý AI và báo cáo),
  xoá tài khoản, nội dung do người dùng tạo, lý do từng quyền và dịch vụ nền, tài khoản
  demo cho review. Thêm quyền native thì cập nhật bảng quyền ở đó; thêm dịch vụ
  nhận dữ liệu (như Sentry) thì cập nhật bảng Quyền riêng tư. Hồ sơ phải khớp binary, test giữ:
  `store-listing.test.ts` (chuỗi xin quyền trong bảng = `USAGE_VI`/`USAGE_EN` của `app.config.ts`; iOS privacy manifest
  `IOS_PRIVACY_MANIFEST` — `ios.privacyManifests` — khai đúng các loại dữ liệu và mức linked/purpose của cột Apple App
  Privacy, không tracking, lý do API cần khai báo), `android-manifest.test.ts` (mọi quyền của manifest bản release có
  tên trong mục Quyền của listing và ngược lại; `maxSdkVersion` của từng quyền), `privacy-content.test.ts` của web
  (chính sách nói từng dòng của bảng Quyền riêng tư). Metadata cho store là code sinh từ listing:
  `scripts/store-metadata.mjs` viết `store/apple/store.config.json` (EAS Metadata; iPhone bỏ dòng, từ khoá và ghi chú về
  gọi khi gọi còn tắt trên iPhone) và `store/play/<locale>/*.txt`, kiểm giới hạn ký tự của store;
  `store-listing.test.ts` chạy `--check`. Sửa chữ ở `listing.md` rồi chạy script, không sửa tệp sinh ra. Feature
  graphic của Play: `store/play/feature-graphic.png` từ `pnpm brand:build`. Apple 4.8 (Sign in with Apple) chờ tài khoản Apple:
  `docs/adr/drafts/0041-dang-nhap-tren-iphone-va-sign-in-with-apple.md`.
