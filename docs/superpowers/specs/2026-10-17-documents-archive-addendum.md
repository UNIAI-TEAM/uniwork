# Documents — Phụ lục: Lưu trữ thật (ARCHIVE-01, UNI-1845)

> **Trạng thái:** in-progress — v0.3 hợp đồng (Advisor 2026-10-18: S-4 = lưu trữ nhả khóa sửa `end_reason='document_shelved'`; Q-AR1..Q-AR3 = (a); §8 UI của e6-web và Q-UI1..Q-UI3 đã duyệt).

**Nguồn quyết định:** gói quyết định 2026-10-16 D-T2 (Lưu trữ là tính năng riêng, tách khỏi Thùng rác: trạng thái mới, không bị dọn sau 30 ngày) và Q-A1 (chỉ đọc, không bình luận; lưu trữ thư mục = cả cây; cần quyền quản lý; mục "Lưu trữ" riêng ở sub-nav + nhãn "Đã lưu trữ" trong tìm kiếm; "Bỏ lưu trữ" đưa về như cũ).
**Quan hệ:** [phụ lục khôi phục/xóa vĩnh viễn](2026-10-17-documents-restore-purge-addendum.md) (Thùng rác), [phụ lục My Folder](2026-10-16-documents-my-folder-addendum.md), [phụ lục khóa sửa](2026-10-15-documents-edit-lock-addendum.md).
**Hiện trạng:** đọc ở root G5-G7 `a8b2b3914` + RESTORE-01 `dd780a249` (khôi phục từng mục, xóa vĩnh viễn, hàng chỉ đọc cho người có quyền sửa trong Thùng rác).

## 0. Tên trong code (Q-AR1 = a)

Tên "archive" trong code đã thuộc về Thùng rác (`archived_at`, `document.archived` / `document.restored`, lỗi `document_archived` 403, `ArchiveDocument`) và người dùng đã quyết giữ tên code đó. Trạng thái mới dùng một từ khác ở MỌI lớp, đề xuất **`shelved`**:
- cột `documents.shelved_at TIMESTAMPTZ NULL`, `shelved_by TEXT NULL`, `shelved_by_kind TEXT NULL` (cặp quy kết ADR 0007), `shelve_batch_id TEXT NULL`;
- event `document.shelved` / `document.unshelved`; audit `document.shelved` / `document.unshelved`;
- lỗi `document_shelved` (409, class `read_only`), sentinel `ErrDocumentShelved`;
- service `ShelveDocument` / `UnshelveDocument`; route `POST /api/v1/documents/{documentID}/shelve` và `/unshelve`.
Chữ hiển thị vẫn là "Lưu trữ" / "Archive" (vi/en), chỉ ở i18n.

## 1. Mô hình

- Migration `9991792262447467_documents_shelved` (số tiền tố lấy lại lúc code: số kế tiếp còn trống trên root, sau mọi tiền tố BIGUP-S1) (ALTER, 4 cột NULL, CHECK: bốn cột cùng NULL hoặc cùng có giá trị; `shelved_by_kind IN ('human','agent','system')`). Index (nếu cần cho danh sách Lưu trữ): `CREATE INDEX CONCURRENTLY idx_documents_shelved` trên `(workspace_id, shelved_at DESC, id DESC) WHERE shelved_at IS NOT NULL AND archived_at IS NULL AND owner_id IS NULL`, file riêng `9991792262447468_documents_shelved_idx`.
- Một tài liệu có thể vừa `shelved` vừa vào Thùng rác: chuyển vào thùng rác một mục đã lưu trữ được phép (quản lý); khôi phục từ thùng rác trả về đúng trạng thái `shelved` cũ. `shelved` không bao giờ bị purge, cũng không có `purge_after`.
- My Folder không lưu trữ được (`my_folder_locked`); mục BÊN TRONG My Folder thì được.

## 2. Lưu trữ / Bỏ lưu trữ

- S-1. `POST .../shelve`: cổng = quản lý trên mục; thư mục → cả cây con đang sống chưa lưu trữ (mọi nút phải quản lý được, như `requireManageOnSubtree` của trash; `archiveBound` → 400 `folder_too_large`). Một `shelve_batch_id` cho cả lần; audit + outbox `document.shelved` mỗi nút (payload `document_id`, `workspace_id`, `shelve_batch_id`), cùng transaction, `LockDocumentTree`.
- S-2. `POST .../unshelve`: cổng = quản lý trên mục; bỏ lưu trữ mục + các hậu duệ cùng batch người gọi quản lý (đối xứng với khôi phục từng mục của Thùng rác, Q-R1). Vị trí trong cây không đổi (lưu trữ không di chuyển mục).
- S-3. Idempotency như archive (ledger claim). Gọi lại trên mục đã ở trạng thái đích → 200 không đổi gì, không audit.
- S-4. Lưu trữ nhả khóa sửa đang giữ của mọi nút được đóng dấu (`stamped`), trong cùng transaction của lệnh lưu trữ: `end_reason='document_shelved'`, `ended_by` = người gọi nếu là human, không thì hệ thống. Bỏ lưu trữ không khôi phục nhiệm kỳ. Gọi lại trên mục đã lưu trữ (no-op) không nhả gì. Heartbeat/lưu tiếp của người đang giữ trả 409 `edit_lock_lost` với `fields.reason = document_shelved`. Không đổi frame protocol (`can_edit=false` + ánh xạ apiCode của web; `document_shelved` như DocBlockedReason của frame là thẻ fork sau).

## 3. Chỉ đọc mọi nơi (chặn ghi)

Một kiểm tra dùng chung trong `withDocumentGateLocked` (`document_permissions.go`) + các preflight không khóa: mục `shelved` (hoặc nằm dưới một thư mục `shelved` — không xảy ra vì S-1 lưu trữ cả cây, nhưng tạo mới dưới cha đã lưu trữ thì phải chặn) trả 409 `document_shelved` cho MỌI người kể cả quản lý, trên:
- PATCH (tiêu đề, icon, nội dung, autosave trang), snapshot/khôi phục phiên bản trang, upload/commit/khôi phục phiên bản file (gồm desktop sync `Sync: true` và frame `versions/commit`, `uploads`, `assets`), asset upload, blank/save-as/convert VÀO mục đã lưu trữ, tạo con dưới cha đã lưu trữ, move (mục đã lưu trữ hoặc đích đã lưu trữ), bình luận (tạo/sửa/xóa/resolve/reopen/reaction/mention/anchor), share/link/break-glass/đổi `workspace_level`/`visibility`, offline lease cấp mới, launch edit session, AI office jobs có ghi, MCP `update_document` / `add_document_comment` (qua service).
- Được phép: đọc, tải xuống, xuất PDF, sao chép (bản sao KHÔNG mang trạng thái lưu trữ), yêu thích, chuyển vào thùng rác (quản lý), bỏ lưu trữ (quản lý).
- Thu hồi share/link trên mục đã lưu trữ (Q-AR2 = a): CHO PHÉP thu hồi; cấp mới / nâng quyền / bật link bị chặn. Trên mục đã lưu trữ `POST /shares` chỉ dùng để cấp mới nên bị từ chối (409 `document_shelved`); thu hồi và hạ mức quyền đi qua `PUT /access` (và `DELETE` share/link).
- Office frame: `MintToken` trả `can_edit=false` cho mọi người trên mục `shelved`; client cũng gate module Docs (hiện bỏ qua `can_edit`); server vẫn từ chối mọi route lưu của frame. `load` của frame phải cho mục `shelved` (khác trash).
- Lỗi: `document_shelved` thêm vào `error_class.go` (class `read_only`) và `packages/core/documents/errors.ts`; frame protocol thêm blocked reason `document_shelved`; desktop `fault/cases.json` + `matrix.md` nếu desktop coi là blocked reason.

## 4. Đọc, danh sách, tìm kiếm, change feed

- Mọi người có quyền xem vẫn đọc được mục `shelved` (khác trash).
- Danh sách thường (flat/cây/recent/shared) (Q-AR3 = a): mục `shelved` KHÔNG hiện trong danh sách thường và cây, CHỈ hiện ở danh sách Lưu trữ và trong kết quả tìm kiếm (`q=`) với nhãn. Mở trực tiếp bằng link vẫn được.
- Danh sách Lưu trữ: `GET .../documents?shelved=true` (mọi người có quyền xem thấy mục của mình được xem; không chỉ quản lý), phân trang keyset theo `shelved_at DESC, id DESC`, kết hợp được với `format`/`access` của LISTFILTER; `shelved=true` + `archived=1` → 400.
- DTO: `shelved_at`, `shelved_by` trên document + list item (client hiển thị "Đã lưu trữ").
- Change feed: thêm `shelved: bool` vào hàng upsert (`DocumentChangeFeedRow`, `ListDocumentsForChangeFeed`), thêm `document.shelved` / `document.unshelved` vào `feedDocumentActions` để desktop thấy và chuyển file sang chỉ đọc.
- Tìm kiếm MCP/agent: đọc được, ghi bị chặn (§3).

## 5. Event, audit, isolation

- `document.shelved` / `document.unshelved` thêm vào CẢ BA catalogue (`docs/events/CATALOGUE.md`, `server/internal/outbox/catalogue.go`, `packages/core/types/events.ts`), ids only; client realtime invalidate như `document.archived` (`packages/core/realtime/document-events.ts`).
- Audit: hai action mới, `audit_coverage_test.go` hai chiều (`ShelveDocument`, `UnshelveDocument`).
- Isolation matrix: hai route mới (fixture `{documentID}`); `?shelved=true` trên route danh sách đã có.
- `TestEveryQueryNamesItsTenant` cho query mới.

## 6. Client `packages/core`

- `shelveDocument` / `unshelveDocument` + hooks (await server, invalidate workspace document roots), `listShelved` / `useShelvedDocuments(wsId, opts)` (key có `wsId` + filter), lenient `shelved_at` / `shelved_by`, helper `isShelved(doc)`, lỗi `document_shelved` → class `read_only`, ca malformed cho mỗi endpoint.

## 7. Test (đặt tên trong báo cáo)

- SH-1 lưu trữ thư mục → cả cây, một batch, audit/outbox mỗi nút; không quản lý một nút → 403, không đổi gì.
- SH-2 bảng chặn ghi: mỗi đường §3 trả `document_shelved` cho quản lý (bảng test một dòng mỗi đường); đọc/tải/sao chép/yêu thích vẫn được; bản sao không `shelved`.
- SH-3 bỏ lưu trữ từng mục (chỉ hậu duệ quản lý được); idempotency.
- SH-4 trash × shelved: chuyển vào thùng rác mục đã lưu trữ rồi khôi phục → vẫn `shelved`; xóa vĩnh viễn (POST .../purge) mục `shelved` trong thùng rác được; con `shelved` còn lại được đưa về gốc như mọi con còn lại (RESTORE-01).
- SH-5 danh sách Lưu trữ + tìm kiếm có nhãn + danh sách thường không có (theo Q-AR3); 400 `shelved`+`archived`.
- SH-6 change feed có `shelved` và hàng cho hai action mới; frame token `can_edit=false`; desktop commit `Sync` → 409.
- SH-7 MCP update/comment trên mục đã lưu trữ → lỗi read-only; agent không lưu trữ được (cần quản lý; agent cap view).
- Isolation, audit coverage, events-catalogue test.
- `TestShelveReleasesEditLock`: lưu trữ nhả khóa sửa của gốc và hậu duệ được đóng dấu (`document_shelved`, `ended_by` = actor, audit mỗi lần nhả như thùng rác); nút ngoài cây và nút bị bỏ qua (đã lưu trữ / đã vào thùng rác) giữ nguyên; heartbeat sau đó 409 `edit_lock_lost` reason=`document_shelved`; bỏ lưu trữ không khôi phục; no-op lần hai không nhả; lệnh bị từ chối (không quản lý / `folder_too_large`) rollback, khóa còn sống.

## 8. UI (e6-web)

Nguồn hình: `briefs/design-documents-2026-10-16/Archive.dc.html` (trang "Lưu trữ") + `Main.dc.html` (thứ tự sub-nav). Chữ hiển thị "Lưu trữ" / "Archive", "Đã lưu trữ" / "Archived", "Bỏ lưu trữ" / "Unarchive" chỉ nằm trong i18n (vi + en cùng vị trí, giọng vi theo `docs/conventions.md`); khóa i18n, prop, tên file, query key dùng `shelved` (Q-AR1). Mọi lệnh ghi chờ server (không optimistic: lưu trữ / bỏ lưu trữ đổi chỗ hiển thị của mục và cả cây).

- U-1. Sub-nav: mục "Lưu trữ" giữa "Tôi đã chia sẻ" và "Thùng rác" (Main.dc.html), icon theo `DOCUMENTS_NAV_ICONS` (lucide `Archive`, cùng kiểu muted size-4 như ICONS-01). Hiện cho mọi thành viên (ai xem được mục đã lưu trữ đều vào được); route là một scope của thư viện như Thùng rác (`paths` builder + `consistency.test.ts`).
- U-2. Danh sách Lưu trữ: `useShelvedDocuments(wsId, { format, access, cursor })` (`GET documents?shelved=true`, §4). Đầu trang: tiêu đề + đoạn giới thiệu của board ("Tài liệu đã xong việc được cất ở đây: giữ mãi, chỉ đọc, không bình luận…"). Bộ lọc: Loại (chip LISTFILTER, gửi `format` lên server), "Lưu trữ bởi" (thành viên; lọc phía client trên các trang đã tải vì server chưa có tham số, kèm câu "trong những gì đã tải" như LISTFILTER), sắp "Lưu trữ gần nhất" (thứ tự server). Cột: Tên (+ đường dẫn thư mục cha mờ bên dưới, như board) / Truy cập / Lưu trữ bởi (avatar + tên từ members, "Cựu thành viên" / "Hệ thống" như Thùng rác) / Lưu trữ lúc (cùng dạng ngắn với "Xóa lúc" của Thùng rác) / Thao tác. Không nhóm theo thư mục (danh sách phẳng như board). Trạng thái rỗng "Chưa có tài liệu nào được lưu trữ"; lỗi qua `CollectionPageState`. Bấm hàng mở tài liệu ở chế độ chỉ đọc (khác Thùng rác).
- U-3. Thao tác trên hàng của danh sách Lưu trữ: "Bỏ lưu trữ" (nút trên hàng, aria-label kèm tên mục) chỉ khi người xem có quyền quản lý (`my_level === "manage"` hoặc `admin_scope`, cùng luật `canManageTrashed`); người chỉ xem/sửa không thấy nút. Bỏ lưu trữ một thư mục chỉ mang các hậu duệ cùng batch mình quản lý (S-2): toast "Đã bỏ lưu trữ {title}", thêm mô tả "Một số mục con vẫn ở trong Lưu trữ." khi phần trả về thiếu hậu duệ đang hiện. Một lần bấm = một request (chặn bấm đúp như RESTORE-01).
- U-4. Menu thao tác của mục (`document-actions-menu.tsx`, menu hàng thư viện, menu header trang tài liệu): "Lưu trữ" cho mục sống chưa lưu trữ, chỉ quản lý; ẩn với My Folder (gốc). Lưu trữ thư mục mở hộp thoại xác nhận (giống hộp thoại chuyển vào thùng rác: đếm thư mục con và tài liệu từ server, câu "Cả thư mục và mọi thứ bên trong sẽ thành chỉ đọc"); tài liệu đơn lưu trữ ngay + toast có nút "Hoàn tác" gọi bỏ lưu trữ. `folder_too_large` (400) và 403 dùng chữ lỗi có sẵn. Mục đã lưu trữ: menu chỉ còn mở, tải xuống, xuất PDF, sao chép, gắn sao, "Bỏ lưu trữ" (quản lý), "Chuyển vào thùng rác" (quản lý); ẩn đổi tên, di chuyển, chia sẻ-cấp-mới, tạo con.
- U-5. Danh sách thường và cây (Q-AR3 = a): server đã loại mục `shelved`; web không thêm bộ lọc client. Sau `document.shelved` / `document.unshelved` (realtime, §5) mọi key danh sách của workspace invalidate như `document.archived`, nên mục biến khỏi danh sách/cây và hiện ở Lưu trữ mà không cần tải lại.
- U-6. Tìm kiếm: hàng kết quả có `shelved_at` mang nhãn "Đã lưu trữ" (Badge muted, cạnh tên; không đổi thứ tự). Mở kết quả → trang tài liệu chỉ đọc.
- U-7. Trang tài liệu (`document-detail-view.tsx`, header): khi `isShelved(doc)`: nhãn "Đã lưu trữ" cạnh tiêu đề + banner chỉ đọc trên nội dung "Tài liệu này đã được lưu trữ: chỉ đọc, không bình luận." kèm nút "Bỏ lưu trữ" cho quản lý. Trình soạn TipTap ở chế độ không sửa được; tiêu đề/icon không sửa được; bảng bình luận chỉ đọc (ẩn ô soạn, ẩn resolve/reaction); lịch sử phiên bản xem được, ẩn "Khôi phục phiên bản". Bản sao ("Tạo bản sao") mở bản mới không lưu trữ.
- U-8. Office frame (DOCX/XLSX/PPTX/PDF/MD/HTML): token `can_edit=false` (§3). Module Docs hôm nay bỏ qua `can_edit` — phải mở ở chế độ xem (`use-docs-frame-session.ts` đã có nhánh `readOnly` cho write khi bị từ chối; thêm gate chủ động từ `can_edit` lúc load). Thanh trên frame hiện cùng banner U-7. Mọi lệnh lưu từ frame mà server trả `document_shelved` → thông báo "Tài liệu đã được lưu trữ nên không lưu được." và frame chuyển sang chỉ đọc, không mất bản đang mở (người dùng vẫn tải xuống hoặc sao chép được).
- U-9. Share dialog trên mục đã lưu trữ (Q-AR2 = a): danh sách quyền hiện như thường; nút thu hồi / xóa người / tắt link vẫn dùng được; ô thêm người, đổi quyền lên, bật link, "Thiết lập quyền riêng" bị tắt (`aria-disabled`, giữ trong tab order) với dòng giải thích "Tài liệu đã lưu trữ: chỉ thu hồi được quyền, không cấp thêm." Server trả `document_shelved` cho đường cấp mới nếu client lọt.
- U-10. Lỗi `document_shelved` (409, class `read_only`, `isDocumentShelvedError` trong core): mọi đường ghi của web (autosave trang, đổi tên, di chuyển kéo-thả, bình luận, tải phiên bản, tạo con) hiện chung một chữ "Tài liệu đã được lưu trữ, chỉ đọc." và invalidate tài liệu để UI chuyển sang chỉ đọc (người khác vừa lưu trữ trong lúc mình đang sửa). Autosave dừng, nội dung chưa lưu giữ lại trong trình soạn tới khi người dùng sao chép ra.
- U-11. Thùng rác × Lưu trữ (SH-4): hàng Thùng rác của một mục từng lưu trữ có nhãn "Đã lưu trữ"; khôi phục trả nó về danh sách Lưu trữ (toast "Đã khôi phục {title} vào Lưu trữ" khi phản hồi còn `shelved_at`).
- U-12. Desktop (lane fork, không phải e6-web): change feed `shelved: true` → file chỉ đọc + nhãn "Đã lưu trữ"; commit `Sync` nhận 409 `document_shelved` → blocked reason riêng. Ghi ở đây để lane desktop có cùng chữ; e6-web không code phần này.

Test web (đặt tên trong báo cáo): UI-AR1 sub-nav + route Lưu trữ gửi `shelved=true` (+ `format` khi chọn chip); UI-AR2 quản lý thấy "Bỏ lưu trữ", người xem không; một request mỗi lần bấm; toast một phần; UI-AR3 menu "Lưu trữ" chỉ cho quản lý, ẩn ở My Folder, hộp thoại thư mục đếm từ server; UI-AR4 trang tài liệu `shelved`: banner, trình soạn + tiêu đề + bình luận chỉ đọc, ẩn khôi phục phiên bản; UI-AR5 frame load với `can_edit=false` không gửi lệnh lưu; lệnh lưu bị 409 → chỉ đọc + chữ U-8; UI-AR6 share dialog: thu hồi gửi request, cấp mới bị tắt; UI-AR7 lỗi `document_shelved` từ autosave → chỉ đọc, nội dung giữ; UI-AR8 nhãn "Đã lưu trữ" ở tìm kiếm và ở hàng Thùng rác; UI-AR9 realtime `document.shelved` invalidate danh sách. Kiểm tra giao diện theo Archive.dc.html, 8 cấu hình (sáng/tối × vi/en × 1280/390).

Câu hỏi của e6-web cho server (không chặn; mặc định ghi bên phải nếu server không đổi hợp đồng):
- Q-UI1. Hộp thoại lưu trữ thư mục (U-4) đếm thư mục con / tài liệu: dùng lại `GET .../archive-impact` của Thùng rác được không? Mặc định: dùng lại.
- Q-UI2. Lọc "Lưu trữ bởi" (U-2): server có thêm `shelved_by=` không? Mặc định: không, lọc phía client trên trang đã tải (chữ "trong những gì đã tải").
- Q-UI3. Hàng Thùng rác và phản hồi khôi phục có mang `shelved_at` (U-11)? Mặc định: có (DTO list item §4); nếu không, U-11 bỏ nhãn và toast riêng.

## 9. Quyết định

- Q-AR1 = (a) `shelved` ở mọi lớp code; "Lưu trữ"/"Archive" chỉ ở i18n.
- Q-AR2 = (a) cho thu hồi share/link, chặn cấp mới.
- Q-AR3 = (a) ẩn khỏi danh sách thường/cây; hiện ở danh sách Lưu trữ + tìm kiếm có nhãn; link trực tiếp vẫn mở.
- S-4: lưu trữ nhả khóa sửa trong cùng transaction (`end_reason='document_shelved'`); bỏ lưu trữ không khôi phục; no-op không nhả; heartbeat/lưu của người giữ → 409 `edit_lock_lost` reason=`document_shelved`; không đổi frame protocol.
- Q-UI1 = dùng lại `GET .../archive-impact` (đếm cả hậu duệ đã lưu trữ sẵn — hiếm, chấp nhận lệch nhỏ; nút không quản lý được vẫn báo như Thùng rác).
- Q-UI2 = không có `shelved_by=` ở server; lọc phía client trên trang đã tải.
- Q-UI3 = có: `shelved_at` / `shelved_by` trên mọi list item (kể cả hàng Thùng rác) và trên document trả về từ khôi phục.
