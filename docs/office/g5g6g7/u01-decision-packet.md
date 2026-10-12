# UniWork Office G5/G6/G7 — Gói quyết định U-01 (spine UX, đóng G5-D3)

> **Trạng thái:** shipped — người dùng ký 2026-10-12 (U-15, "duyệt theo gợi ý"); U-01 áp các câu trả lời vào EXPERIENCE.md

**Issue:** UNI-1341 (U-01), parent UNI-660 (`Refs: UNI-635`), tài liệu UNI-923.
**Đầu vào:** [EXPERIENCE.md](ux/EXPERIENCE.md) › Open questions (dòng 1003–1018) và String catalogue (dòng 731–1002), plan
v2.6 thẻ U-01 (plan §5.2), [contract-p0.md](contract-p0.md).
**Người soạn:** worker `worker-x01_contract_p0 (UNI-1338)` cho Advisor, ngày 2026-10-12. Gói này **không** sửa
EXPERIENCE.md: sau khi người dùng ký, task U-01 chép câu trả lời vào spine, đóng mục Open questions và đặt `status: final`.

Ký hiệu: F = fork `uniwork-office` tại `0d03b185`, D = `dev-uniwork` tại `b6a0f4150`. Mỗi OQ: câu hỏi, phương án, khuyến
nghị + lý do, dữ kiện code.

## 1. Câu trả lời cho Open questions

### OQ-UX1 — tên "UniWork AI" và "AI đám mây UniWork" (Product)

- Phương án: (a) "UniWork AI" là tên nhà cung cấp trong picker, "AI đám mây UniWork" là tên gói công cụ đám mây trong Cài
  đặt (đề xuất của spine); (b) dùng một tên cho cả hai.
- **Khuyến nghị: (a).** Hai thứ khác nhau thật: một là nhà cung cấp model, một là bộ công cụ (tìm kiếm, ảnh, phiên âm) có sẵn.
- Dữ kiện: `cloudTitle: 'AI đám mây UniWork'` (F `apps/shell/src/renderer/src/i18n/cloud/vi.ts:4`); web en
  `aiWebCloudTitle: 'UniWork AI cloud tools'` (F `web/modules/shared/i18n/ai-web/en.ts:19`).
- **Phát hiện cần G6-05 xử lý:** nhà cung cấp hiện có `id: 'genspark'` mang nhãn `'uniAI'` (F
  `packages/ai-provider/src/providers.ts:32-33`). Hiện trong picker cạnh "UniWork AI" thì người dùng thấy hai tên gần
  giống nhau. Đề nghị G6-05 chốt: ẩn hoặc đổi nhãn mục `uniAI` khi mục `uniwork` có mặt (ghi vào packet G6-05).

### OQ-UX2 — các con số (Product, G5-D3; số do G5-D2/G5-06/G6-02 chốt)

Số khởi điểm để ký; task thực thi đo lại và chỉ đổi qua Advisor.

| Số | Khuyến nghị | Lý do / dữ kiện |
| --- | --- | --- |
| Dung lượng thư viện offline | 2 GiB mỗi tài khoản trên một máy | Trần tải một tệp của app 256 MiB (F `apps/shell/src/main/uniwork-docs/client.ts:26-29` `MAX_DOWNLOAD_BYTES`); 2 GiB chứa ≥ 8 tệp lớn nhất |
| Số tài liệu ghim | 200 | Đủ cho một nhóm làm việc; giữ danh sách S3 dùng được bằng bàn phím |
| Số nháp giữ tối đa mỗi tài liệu | 3 | Đủ cho "giữ bản của tôi" qua vài vòng xung đột; quá thì `uwConflictDraftCapReached` |
| Ngân sách store đồng bộ mỗi tài khoản (queue + nháp, không gồm thư viện offline) | 1 GiB | Chứa ≥ 4 snapshot tệp lớn nhất (256 MiB); đầy → `store_full` / `uwQueueFull` |
| Giữ tab "Đã lưu gần đây" | 24 giờ | Đề xuất của spine; đủ để đối chiếu cuối ngày |
| Tự ẩn thanh S6 khi sạch | 8 giây | Spine đề xuất 8 giây; ghi chú: thông báo hiện có của fork tự ẩn sau 4 giây (F `apps/shell/src/renderer/src/NewChatPane.tsx:380`), S6 dài hơn vì mang hành động; hover/focus giữ thanh (WCAG 2.2.1) |
| Ngưỡng "Cần hỗ trợ" (reconciling → reconciling-stuck) | 1 giờ đối soát chưa có kết quả xác định | Claim upload sống 24 giờ (D `server/internal/files/contracts.go:18` `ClaimTTL`); sau 1 giờ người dùng cần biết, còn G5-07 vẫn kết luận được trước khi claim hết hạn |
| Chu kỳ tự kiểm lại hàng `reconciling-stuck` | 15 phút | Đề xuất của spine |
| Số lần resync liên tiếp khi gặp 410 trước `uwSyncResyncFailed` | 5 | Đề xuất của spine, có backoff tăng dần |
| Ngưỡng chờ AI trước `uwTipWaitAiLong` | 30 giây | Đề xuất của spine; bằng khoảng nháp của frame (F `web/docs/bridge/draft-recovery.ts:27` `DRAFT_INTERVAL_MS = 30_000`) |
| Heartbeat lock cửa sổ | 5 giây; coi là mất sau 15 giây (3 nhịp lỡ) | Chưa có lock theo tài liệu: app chỉ có `requestSingleInstanceLock` (F `apps/shell/src/main/index.ts:6268`); G5-03a/G5-11 xây mới |
| Mức kẹp `Retry-After` | 300 giây | Đề xuất của spine; F `packages/ai-provider/src` chưa xử lý `Retry-After` (không có mã nào), G6-05 xây mới |
| Số lần chờ 429 tối đa mỗi lượt | 3 | Đề xuất của spine; **G6-02 xác nhận** khi spike xong (lô #2) |

### OQ-UX3 — footer picker khi UniWork AI bị ẩn (Product + owner F)

- Phương án: (a) chú thích, không phải lỗi (đề xuất); (b) coi là lỗi và hiện trạng thái lỗi.
- **Khuyến nghị: (a).** Picker hiện có bỏ qua nhà cung cấp không dùng được, không hiện mục xám
  (F `packages/ui/src/ai-model-picker-options.ts:32-49`, `continue` ở :43); footer có sẵn là một hàng "Quản lý mô hình…"
  (F `packages/ui/src/AiModelPicker.tsx:223-238`). Chú thích ở footer khớp mẫu đó và không là "lỗi giả" theo §6.1.

### OQ-UX4 — locale ngoài vi/en (owner F)

- Phương án: (a) chép bản en vào 19 locale còn lại; (b) dịch máy có review.
- **Khuyến nghị: (b),** với test parity + placeholder + quét brand (U-02 đã có trong thẻ) làm cổng tối thiểu.
- Dữ kiện: fork có 21 locale (`zh, en, ja, ko, fr, de, es, th, id, ru, ar, pt, it, pl, cs, nl, ms, he, hi, zh-TW, vi`,
  F `packages/i18n/src/index.ts` `LANGS`); khóa kiểu `zh` bắt buộc mọi locale (`satisfies Record<keyof typeof zh, string>`,
  ví dụ F `apps/shell/src/renderer/src/i18n/account/en.ts:84`). Shard `uniwork-documents` hiện có là bản dịch thật, không
  phải bản en chép lại (ví dụ `uwChipConflict` ja `'競合'`, fr `'Conflit'`). Chép en sẽ làm khóa mới lệch chất lượng với
  khóa cũ ngay trên cùng màn hình.

### OQ-UX6 — "Lưu thành bản sao…" trong S5 v1 (Product + G1)

- Phương án: (a) có trong v1, giao ở G5-12 (P2); (b) bỏ khỏi v1, G5-A08 phần copy ghi BLOCKED có quyết định.
- **Khuyến nghị: (a).** API sao chép đã có và giữ đúng điều G5-A08 cần, nên G5-12 chỉ nối UI:
  `POST /documents/{documentID}/copies` (D `server/internal/handler/router/documents.go:267-273`); `CopyDocument` cần quyền
  sửa nguồn và `consent: "copy"` (thiếu → 409 `copy_consent_required`), tài liệu do Work Product sở hữu bị từ chối
  `owner_requires_copy` (D `server/internal/service/document_copy.go:21-52,63`); bản sao giữ ACL owner/visibility/share
  (`copyDocumentShares`, `:232`) và ghi provenance (nguồn, version, revision, checksum), dùng lại `file_id` nên không tính
  dung lượng lần hai. Tên mặc định `"<tên> (bản sao)"` (`copyTitle`, `:256-262`). Mục S5 chỉ hiện khi còn quyền sửa; spine
  cần vẽ thêm hàng này ở U-01 (khóa mới — xem mục 2).

### OQ-UX7 — điểm vào trung tâm đồng bộ ngoài pill (Lead F)

- Phương án: (a) menu tài khoản → "Trung tâm đồng bộ" + Cài đặt → mục UniWork (đề xuất của spine); (b) chỉ Cài đặt › Tài khoản.
- **Khuyến nghị: (b) cộng pill,** vì app **không có menu tài khoản**: `AccountEntry` là một nút mở thẳng Cài đặt › account
  (F `apps/shell/src/renderer/src/AccountEntry.tsx:~153`, `onOpenSettings('account')`). Đặt liên kết "Trung tâm đồng bộ"
  trong `AccountPane` (F `apps/shell/src/renderer/src/SettingsModal.tsx:1713-1728`; danh sách mục `:181-189`). Không dựng
  menu mới chỉ cho một mục.

### OQ-UX8 — giữ thay đổi khi Tải lại trên web (Product)

- Phương án: (a) giữ lựa chọn "Tải bản của tôi về máy rồi tải lại" (đường `api.download`, X-02 + G5-09w) (đề xuất); (b) bỏ,
  chỉ "Bỏ thay đổi và tải lại" / "Quay lại".
- **Khuyến nghị: (a).** Không có nó, người dùng web gặp xung đột chỉ còn cách mất thay đổi hoặc ghi đè; spec §5.3 yêu cầu
  không mất dữ liệu. Dữ kiện: hộp thoại hiện tại chỉ có Hủy / Tải lại / Ghi đè (F `web/docs/bridge/webapi.ts:410-440`);
  frame đã có helper `downloadBlob`/`downloadBytes` (F `web/docs/bridge/browser.ts:45`), nhưng theo plan X-02 host tải
  trên origin của mình (frame không cần `allow-downloads`). Nháp C18 (F `web/docs/bridge/draft-recovery.ts`) không dùng cho
  nháp xung đột ở cả hai phương án.

### OQ-UX9 — module có "Xem khác biệt" ở v1 (Product + owner F)

- **Khuyến nghị: chỉ Docs (DOCX)** ở v1; module khác ẩn nút. G6-01 xác nhận host (desktop/web) của panel so sánh.
- Dữ kiện: chỉ app docs có tính năng so sánh tài liệu (F `apps/docs/src/renderer/components/ComparePanel.tsx`, mount ở
  `apps/docs/src/renderer/App.tsx:7453`, logic `editor/compare.ts`); các module khác chỉ có hàm so sánh nội bộ (sắp xếp,
  điều kiện), không phải diff tài liệu.

### OQ-UX10 — khối công bố S8 hiện lại khi đổi tài liệu hoặc tổ chức (Product)

- **Khuyến nghị: có** (đề xuất của spine). Nội dung gửi đi đổi theo tài liệu và người chịu trách nhiệm dữ liệu đổi theo tổ
  chức (§6.1, §8.3).
- Dữ kiện: chưa có trạng thái công bố nào để dùng lại: `ai-notice.ts` chỉ là thông báo lỗi không trạng thái (`no_model`,
  `not_entitled`, `credits_exhausted`, F `packages/ai-provider/src/ai-notice.ts:17,40-49`); `my-ai-consent.ts` là xác nhận
  từng bước của My AI (F `apps/shell/src/renderer/src/my-ai-consent.ts:1-12`), khác mục đích. G6-05u lưu "đã hiểu" theo
  khóa (tài khoản, tổ chức, tài liệu).

### OQ-UX11 — bản đã tải khi tắt `offline_library` (Product + G5-D1)

- Phương án: (a) giữ tới khi bật lại hoặc đăng xuất, mở được khi lease còn hạn (đề xuất); (b) xóa ngay.
- **Khuyến nghị: (a).** Spec §12.2: "Flag không cấp quyền, không tắt recovery hoặc xóa dữ liệu"; bất biến 8 (§3) cấm xóa
  dữ liệu desktop vì rollback. Lease vẫn là giới hạn quyền nên giữ bản không nới quyền (G5-D1).
- Dữ kiện: chưa có code thư viện offline trong fork (`apps/shell/src/main/uniwork-*` chỉ có trạng thái Lưu `'offline'`,
  F `apps/shell/src/main/uniwork-docs/service.ts:114,123`); binding hiện tại schema 1
  (F `apps/shell/src/main/uniwork-docs/binding-store.ts`). Phụ thuộc G5-D1 (lô #2) cho phần lease.

### OQ-UX12 — tên tệp tải về (Product + owner F)

- **Khuyến nghị:** `{tên} (bản của tôi).{ext}` / en `{name} (my version).{ext}` qua khóa `uwConflictMineFileSuffix`, đuôi
  theo định dạng gốc của module; host thay ký tự cấm của hệ điều hành (`\ / : * ? " < > |`) bằng `_`.
- Dữ kiện: server đặt tên bản sao theo cùng mẫu ngoặc `"<tên> (bản sao)"` (D `server/internal/service/document_copy.go:256-262`),
  nên tên bản tải về nhất quán với bản sao trên server.

### OQ-UX13 — telemetry app → server (OPS + Lead F)

- **Khuyến nghị: không trong phase này;** ghi vào backlog với owner OPS + Lead F. Metric chỉ có ở app không có alert (plan
  §8, G7-07); "Sao chép mã hỗ trợ" là đường chẩn đoán v1.
- Dữ kiện: chính sách fork ghi không analytics/telemetry (F `PRIVACY.md:10`), không có đường gửi nào trong fork; D chỉ có
  `POST /api/v1/rum` cho web-vitals của web, không xác thực, trần 1 KiB, sau flag `rum_sampling`
  (D `server/internal/handler/rum.go:13-30`). Làm telemetry app cần đổi `PRIVACY.md` và một quyết định riêng.

### OQ-UX14 — "Tải bản của tôi về máy" trên web không có access log (Product + Auth)

- Phương án: (a) chấp nhận là bản sao cục bộ, ghi trong danh mục bản sao §8.3 (đề xuất); (b) host gọi server ghi `export`
  trước khi giao Blob.
- **Khuyến nghị: (a).** Byte tải về là thay đổi chưa lưu trong bộ nhớ frame, không phải đọc từ server; lần mở frame đã ghi
  `view` (D `server/internal/service/office_frame.go:201`). (b) cần route mới chỉ để ghi log và log đó không chứng minh được
  gì về nội dung.
- Dữ kiện: `document_access_logs` nhận `view|download|export|link_view`
  (D `server/migrations/996_document_access_logs.up.sql:7-26`); export PDF phía server ghi `export`
  (D `server/internal/service/office_frame_export.go:118`); ghi gộp trong 5 phút (D `server/internal/service/document_access.go:28`).

### OQ-UX15 — đổi chỉ metadata và `api.open` xin version cũ

Không thuộc U-01: trả lời ở [contract-p0.md](contract-p0.md) mục 7.1 (OQ-P1, khuyến nghị (a1) cột `content_revision`) và
dữ kiện cho X-02 ở mục 7.3 (OQ-P3). Nếu (a1) được ký, các ô spine "di chuyển/bỏ lưu trữ tăng revision: OQ-UX15"
(EXPERIENCE.md dòng 152, 235) đổi thành "không gây xung đột".

## 2. Kiểm đủ khóa của String catalogue

Phương pháp: gom mọi định danh khóa trong backtick ngoài catalogue (dòng 1–730, 1003–1018) và mọi khóa trong cột khóa của
catalogue (dòng 731–1002); quét chuỗi tiếng Việt viết thẳng trong bảng trạng thái (dòng 141–540); kiểm khóa đánh "sẵn có"
tồn tại trong fork.

- 242 định danh được nhắc ngoài catalogue, 327 khóa trong catalogue. **Mọi khóa `uw*`/`ai*`/`web*` cụ thể được nhắc đều có
  trong catalogue.** Năm "khóa" không định nghĩa đều không phải khóa thật: `aiRun` (tín hiệu, dòng 27, 488), `aiCredentials`
  (tên grant, dòng 38), họ `appWebConflict*` (khóa có sẵn của fork, liệt kê ở phần mở đầu catalogue), wildcard `uwChip*`,
  `uwTip*` (dòng 662).
- 28 khóa đánh "sẵn có" đều có trong fork. Khóa fork dùng lại mà catalogue chưa liệt kê (đều có trong fork):
  `cloudState*`, `cloudCreditsLeft`, `cloudCreditsUnlimited`, `cloudInactiveBody`, `acctKeyring*`,
  `acctErrKeyringUnavailable` (dòng 131) — đề nghị U-01 thêm một dòng "dùng lại nguyên" để U-02 không thêm trùng.

**Khoảng trống (U-01 phải đóng trước khi đặt `final`):**

| # | Chỗ | Chuỗi | Đề xuất |
| --- | --- | --- | --- |
| K1 | Dòng 330, 424, 425, 427, 428 | "Tải lại…" (dạng rút gọn) | Ô bảng ghi đúng nhãn đầy đủ: S6 dùng `uwRemoteReload` ("Tải lại bản mới nhất…"), S5 dùng `uwConflictReload` ("Tải lại bản mới nhất"); không thêm khóa |
| K2 | Dòng 215 | Pill "đang chờ AI" | Nếu pill hiện chữ riêng: khóa mới `uwChipWaitAi` (vi "Đang chờ AI xong rồi lưu" / en "Waiting for AI to finish, then saving"); nếu không: ô ghi `uwChipSaving` + `uwTipWaitAi` như dòng 201 |
| K3 | Dòng 391 | "Bỏ…" | Ghi rõ `uwConflictDiscard` |
| K4 | OQ-UX6 (nếu ký (a)) | Mục "Lưu thành bản sao…" trong S5 + bước xác nhận + kết quả | Khóa mới `uwConflictSaveCopy`, `uwConflictSaveCopyConfirm`, `uwConflictSaveCopyDone`, `uwConflictSaveCopyFailed` (U-01 viết câu vi/en) |
| K5 | OQ-UX7 (nếu ký khuyến nghị) | Liên kết trong Cài đặt › Tài khoản | Khóa mới `uwSyncOpenFromSettings` ("Trung tâm đồng bộ" / "Sync center") |

Các nhãn khác viết thẳng trong bảng trạng thái (Kiểm tra lại, Bỏ nháp…, Mở trung tâm đồng bộ, Dừng AI, các tên tab, Đồng bộ
ngay, Thêm tài liệu…, Để sau, Xem khác biệt, Ghi đè…, Hủy, Quay lại, Giữ bản của tôi làm nháp, Bỏ thay đổi của tôi, Sao chép
mã hỗ trợ, Kết nối lại, Đã hiểu, …) đều có khóa. Khoảng 100 khóa catalogue không được nhắc tên trong bảng trạng thái (bảng
dùng dạng nhóm/wildcard); đó là thông tin, không phải lỗi.

## 3. Chữ ký

| Mục | Người ký | Ngày | Kết quả |
| --- | --- | --- | --- |
| OQ-UX1..14 (mục 1), số OQ-UX2, khoảng trống K1–K5 | Người dùng (vai Product + UX + Lead F) | — | chờ |
