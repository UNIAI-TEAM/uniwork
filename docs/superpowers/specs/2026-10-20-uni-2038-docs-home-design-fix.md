# UNI-2038 — Sửa trang chủ Tài liệu cho khớp thiết kế (G4 chia sẻ ở lần lưu đầu, G5 sắp xếp ở tiêu đề cột)

> **Trạng thái:** in-progress — hợp đồng S0 (khảo sát, chưa có mã sản phẩm); chờ Advisor trả lời §Câu hỏi.

**Issue:** UNI-2038 (con của UNI-923). **Nguồn:** card `DOCS-HOME-DESIGN-FIX-2026-10-20` (USER 2026-10-20 23:40),
thiết kế `design-documents-approved-2026-10-16` (Main.dc). G3 (nút "Mở UniWork Office") giữ nguyên. Mốc mã: `62c295629`.

## G4 — công tắc "Chia sẻ với workspace" chuyển vào hộp thoại lưu lần đầu (mặc định TẮT)

### 1. Công tắc hiện ở đâu, đặt gì khi tạo
- `packages/views/documents/documents-home-create.tsx:105-122`: trong `QuickCreateRow` (dòng 56-125) là một `<label>` + `Switch`
  sau các chip, kèm `<p role="status" class="min-h-4 w-full">` luôn mount (dòng 119-122) — đây là "khoảng trống" cần bỏ. Cùng
  công tắc còn có ở `CreateMenu` dạng `DropdownMenuCheckboxItem` (dòng 205-227).
- Trạng thái dùng chung ở `documents-page-view.tsx:90` (`shareWithWorkspace`), truyền qua `createProps` (dòng 316-322);
  `parentShared` (dòng 170) khóa công tắc khi trang cha đã chia sẻ. `DocumentsHomeNote` (`documents-home-header.tsx:145-146`)
  chỉ render `QuickCreateRow`, ở gốc (dòng 496 `create={folderId ? null : createProps}`).
- Khi tạo: `documents-create.ts:302-305` biến `shareWithWorkspace` thành `{ visibility: "workspace" }`; trang UniNote gửi
  `POST /workspaces/{ws}/documents` (dòng 308-312), sáu loại tệp gửi route tạo blank (dòng 316-322, `useCreateBlankFile`).
  Không bật = không gửi `visibility` → server tạo riêng tư (My Folder, `destination: "my_folder"` ở gốc).

### 2. Hộp thoại lưu lần đầu (web) và bản app
- Web: `useFirstSaveNaming` (`office/frame/first-save-naming.tsx:129`) sở hữu hộp thoại `FolderNameDialog mode="rename"`
  (dòng 239-279; ô con `FirstSaveLocation` dòng 254-259 là chỗ để thêm công tắc). `first-save-gate.ts` chỉ quyết định *khi nào*
  hỏi (`pendingName`, dòng 52-56), không biết gì về tên hay quyền: **không cần sửa gate**.
- Chỉ tài liệu qua `hasUntitledVersionOneFile` (dòng 97-101: tệp `untitled.(docx|xlsx|pptx|pdf|md|html)` ở phiên bản 1) và
  `!viewOnly` mới hỏi; hỏi ở Save của trang hoặc `api.save` của frame (gate dòng 57-60). **UniNote (page) và tệp tải lên không
  bao giờ vào bước này** (không có tệp `untitled.*` v1).
- Khi xác nhận (`submit`, dòng 181-210): `writeTitle` (dòng 170-179) = `loadMoveRevision` rồi
  `patchDocument(id, { revision, title })` (`PATCH /api/v1/documents/{id}`, `core/api/endpoints/documents.ts:161`), rồi (nếu đổi
  thư mục) `move.mutateAsync`; xong mới `notify(file.renamed)` và Save tiếp tục.
- App desktop (chỉ nêu tên, theo sau): fork `uniwork-office` (worktree `app-uniwork-lead`):
  `apps/shell/src/renderer/src/uniwork-folders/FirstSaveNameDialog.tsx`, `apps/shell/src/main/uniwork-docs/first-save-name.ts`,
  và `uniwork-home/DocumentsHome.tsx:296,792,812` (công tắc + `visibility` khi tạo ở trang chủ app).

### 3. Giá trị công tắc đến server thế nào
- **Dùng lại đúng lệnh có sẵn:** `PATCH /api/v1/documents/{id}` đã nhận `visibility` (`PatchDocumentBody`, `documents.ts:71`;
  SDI `sdi/document.go:51`). Gửi **một** PATCH `{ revision, title, visibility: "workspace" }`: server ghi tên và hàng "workspace
  gốc" trong cùng giao dịch (`service/document_pages.go:~870-925`: `UpdateDocumentFields` rồi `writeDocumentHomeRow` với
  `KeepRevision` — một PATCH tăng revision đúng một lần). Không cần endpoint mới, không cần lát cắt server.
- Ai gọi được: `visibility` cần **manage** (`access.canAdminister()`, dòng ~742-762); mở một tài liệu riêng tư sang workspace chỉ
  với admin-scope → 403 `break_glass_required`; thư mục → 422 `folder_not_shareable`; My Folder → khóa. Người tạo blank là chủ
  ACL (manage) nên đường chính luôn hợp lệ; dialog chỉ hiện công tắc khi `canManageDocument(doc, ctx)` (`core/permissions/rules.ts:555`).
- Audit: cùng giao dịch ghi `document.updated` (diff title) + `document.workspace_access_changed` (`document_home_row.go:45-`,
  before/after `visibility`/`workspace_level`, mức mặc định "xem") — giống nút Chia sẻ, không thêm audit mới.
- Thứ tự với đổi tên: **một PATCH nguyên tử** (card: "áp dụng cùng lúc với đổi tên"). Không gửi `visibility` khi công tắc TẮT
  (mặc định, không đụng quyền). Lỗi: PATCH hỏng → cả tên lẫn chia sẻ không ghi; `submit` ném lỗi, `FolderNameDialog` giữ hộp thoại mở và
  hiện `resolveError` (`folder-name-dialog.tsx:168-170`), công tắc giữ nguyên để thử lại. "Đổi tên xong, chia sẻ hỏng" không xảy ra;
  chỉ còn trường hợp *chuyển thư mục* hỏng sau khi PATCH ok (đã có: tên + chia sẻ đã ghi, hộp thoại ở lại với `moveError`,
  thử lại không ghi lại PATCH nhờ `written.current`). **Chú ý:** `written` khóa theo `{id,title}` — S1 phải đưa cả giá trị
  công tắc vào khóa, nếu không đổi công tắc sau lỗi chuyển thư mục sẽ không được ghi.
- Tài liệu đã `visibility=workspace` từ trước (tạo từ menu "Tạo mới" còn công tắc, hoặc kế thừa từ trang cha chia sẻ): dialog hiện
  công tắc **bật + aria-disabled** kèm gợi ý "Đã chia sẻ với workspace"; không bao giờ gửi tắt từ đây (tắt đi là việc của hộp Chia sẻ).

### 4. Tài liệu chưa bao giờ "lưu lần đầu"
Đóng/Esc/Hủy → `onOpenChange(false)` → `settle(namedThisClose.current)` = `false` (dòng 163-168, 242): Save của trang trả
"cancelled", `api.save` của frame bị từ chối (`first-save-gate.ts:61-66`), **không PATCH nào chạy**. Tài liệu giữ `untitled.<ext>`,
riêng tư trong My Folder; `needsName` vẫn đúng nên lần mở sau hỏi lại. Không cần làm gì thêm (S1 có test khóa hành vi này).

### 5. Hộp thoại tải lên và menu "Tạo mới"
- Tải lên: `document-upload-dialog.tsx:75-79` giữ công tắc riêng (mặc định tắt), gửi `visibility` ở
  `use-document-file-upload.ts:106-146`. Tải lên không có lần lưu đầu → **giữ nguyên**.
- Menu "Tạo mới" hôm nay: vẫn có `DropdownMenuCheckboxItem` "Chia sẻ với workspace" (`documents-home-create.tsx:205-227`) dùng chung
  trạng thái với dải chip và gửi `visibility` khi tạo. **Đề xuất (không đổi khi chưa có lệnh Advisor):** bỏ luôn công tắc khỏi menu
  ở cùng lát S1 — nếu để lại, người dùng thấy hai nơi quyết định cùng một việc, và tài liệu UniNote (không có bước lưu đầu) là chỗ
  duy nhất còn chia sẻ được lúc tạo. Hệ quả cần chấp nhận: **UniNote tạo mới luôn riêng tư**, chia sẻ qua hộp Chia sẻ.

## G5 — sắp xếp ở hàng tiêu đề bảng

### 6. Các bảng
- **Một thành phần chung:** `DocumentsLibraryList` (`documents-library-list.tsx:86`) vẽ bảng cho Trang chủ (gốc + thư mục), Gần đây, Gắn sao,
  Được chia sẻ với tôi, Tôi đã chia sẻ (`documents-page-view.tsx:341` định nghĩa `libraryList`, dùng ở dòng ~496-540); hàng tiêu đề ở dòng 216-224
  (`<th scope="col">` từ `ladder.columns`, cột nằm ở `library-columns.ts:83-126`). Nhãn cột: `documents.home.columns.*`
  (`en.json:10726`). Cùng component còn phục vụ **Lưu trữ** (`shelved`, ladder riêng, không thuộc G5) — sort chỉ bật cho
  `shelved` khi caller truyền; **Thùng rác** có bảng riêng (`documents-trash-view.tsx`), ngoài phạm vi.
- Chọn sắp xếp thư mục hiện nằm ở `documents-library-toolbar.tsx:73-100` (`variant="folder"`, `Select` + `ArrowUpDown`), trạng thái
  `FolderSort = name|updated` (`library-rows.ts:34-38`), lưu `localStorage` theo user (dòng 237-264), nạp ở `use-documents-library.ts:139-150`.
  Sẽ bị **gỡ** (một UI sắp xếp); khóa lưu trữ cũ đọc rồi bỏ.

### 7. Server hôm nay có sắp xếp theo cột không?
**Không.** `documentListInput` (`handler/document_collections.go:30-87`) không đọc `sort`/`order`; mỗi danh sách có thứ tự cố định:
| Danh sách | Thứ tự server | Nơi |
| --- | --- | --- |
| Gốc/thư mục (`parent_id`) | `position, id` (tăng) | `document_search.sql:418` |
| Phẳng, Tôi đã chia sẻ (`shared_by_me`) | `updated_at DESC, id DESC` | `document_search.sql:240` |
| Gần đây | `updated_at DESC, id DESC` | `document_search.sql:838` |
| Được chia sẻ với tôi | `created_at DESC` của dòng chia sẻ | `document_access.sql:130` |
| Nguồn (tệp module khác, hợp vào gốc) | `sort_at DESC, id` | `document_sources.sql:87,167,229,320` |
Phân trang keyset theo (giá trị sắp xếp, id), 50/trang, tối đa 100 (`document_search.go:33-34`).

- **Danh sách gộp ở gốc** (`use-documents-library.ts:318-346`): hai truy vấn phân trang độc lập (tài liệu workspace + nguồn) gộp ở client
  bằng `mergeNewestFirst` (`library-rows.ts:282-291`, giả định *mỗi nguồn đã mới→cũ*). Nhưng danh sách tài liệu ở gốc lại theo `position` (dòng 418),
  nên "Cập nhật giảm dần" hôm nay chỉ đúng trên những hàng đã tải, "Tải thêm" có thể chèn hàng mới hơn xuống dưới — **lỗi sẵn có**, cũng
  là lý do mặc định phải được server đảm bảo.
- **Sắp xếp phía client có đúng không?** Chỉ đúng khi *đã tải đủ hàng*:
  - Gắn sao: tải đủ (không phân trang, `hasMore:false`, dòng ~268-278) → sort client đúng.
  - Thư mục: tự tải hết trang đến trần `FOLDER_SORT_ROW_CAP = 1000` (dòng 46, 192-206) rồi `sortFolderRows` → đúng đến 1000 hàng; trên trần là gần đúng.
  - Gốc, Gần đây, Được chia sẻ với tôi, Tôi đã chia sẻ: phân trang theo thứ tự cố định → sort client trên trang đã tải **sai** (hàng cũ hơn theo cột Tên
    nằm ở trang chưa tải, "Tải thêm" chèn lệch).
- **Cột sắp xếp được:** Tên (`title`), Cập nhật (`updated_at`), Dung lượng (`file_version.size_bytes`, đã có JOIN `cv` trong truy vấn),
  Người sửa gần nhất (tên hiển thị: cần JOIN `users`; tác nhân agent xếp cuối). **Truy cập: KHÔNG sắp xếp được ở server** — mức/phạm vi tính theo người xem
  sau truy vấn (`attachListAccess`, `document_search.go` cuối `listDocumentsPage`); header Truy cập không có nút sắp xếp.

### 7b. Lát cắt server (chờ duyệt, chủ lane `e6-server`) — S3
- Endpoint: `GET /workspaces/{ws}/documents` (nhánh phẳng + `parent_id`, gồm `shared_by_me`), `GET /documents/recent`, `GET /documents/shared-with-me`,
  `GET /documents/sources`. Tham số mới **tùy chọn** `sort=updated|name|size|editor` và `order=asc|desc`; vắng mặt = hành vi cũ (API không đổi);
  giá trị khác → 400 `invalid_request`. Web luôn gửi `sort=updated&order=desc` ở gốc (sửa lỗi gốc ở trên). `archived`/`shelved` giữ nguyên, gửi sort ở đó → 400.
- Keyset: `documentCursor` (`document_search.go`) thêm khóa chuỗi/số cho (khóa sắp xếp, id); `shared-with-me` có con trỏ riêng (`encodeSharedWithMeCursor`).
  Sắp xếp Tên dùng một collation cố định phía server; **web không sắp xếp lại trang đã sắp** (tránh lệch collation với `Intl.Collator("vi")`).
  Dòng thư mục (`kind=folder`) vẫn tách khỏi bảng (thẻ lưới) nên không ảnh hưởng.
- Tenant: mọi truy vấn giữ `organization_id`/`workspace_id` như nay; không thêm bảng, không FK. Chỉ mục: e6-server đo `EXPLAIN` trên workspace 10k tài liệu; nếu cần
  mới thêm — mỗi chỉ mục một file migration riêng, `CREATE INDEX CONCURRENTLY`, từng phần `WHERE archived_at IS NULL AND shelved_at IS NULL`, tiền tố `999<unix-ms>_`.
- API compat: SDI mô tả `sort`/`order` (`docs/api-sdi-sdo.md`); phía web `listQuery` (`documents-collections.ts`) thêm `sort`/`order`, schema không đổi;
  test malformed ở `api/endpoints/documents-collections.test.ts` + test từ chối `sort` lạ ở Go (`document_search_*_test.go`), test thứ tự ổn định qua 3 trang với (giá trị trùng, id).

### 8. Hành vi tiêu đề (web)
- Mặc định **Cập nhật giảm dần**. Bấm tiêu đề: cột chưa chọn → sắp tăng (Cập nhật/Dung lượng: giảm trước); bấm lại đổi chiều; cột đang chọn là cột duy nhất có mũi tên.
- `<th scope="col" aria-sort="ascending|descending|none">` chứa `<button type="button">` (tab được, Enter/Space), nhãn truy cập
  "Sắp xếp theo {cột}" kèm trạng thái hiện tại; mũi tên `ArrowUp` / `ArrowDown` của lucide (tên chuẩn, không phải alias; `docs/conventions.md` §4), `size-3.5`, `aria-hidden`.
  Mục tiêu chạm ≥ 44px trên con trỏ thô (`pointer-coarse`). Cột Thao tác và Truy cập: chữ thường, không nút.
- Thang cột (`library-columns.ts`) và `table-fixed` không đổi; tiêu đề ẩn ở hẹp (`ladder.head`) thì sắp xếp ẩn theo — hàng hẹp cần một cách đổi sắp xếp:
  giữ **một** nút "Sắp xếp" nhỏ trong thanh công cụ chỉ ở `< 29rem` (hỏi tester_visual; nếu Advisor không muốn, hẹp dùng mặc định).
- Trạng thái `{ column, order }` nằm trong `useDocumentsLibrary`, nhớ theo user như `FolderSort` hôm nay (khóa mới `uniwork_documents_sort`), là một phần của khóa truy vấn danh sách.

## Lát cắt

| Lát | Phạm vi | Tệp chính | Test đỏ viết trước |
| --- | --- | --- | --- |
| **S1** G4 web | Bỏ công tắc + dòng gợi ý khỏi `QuickCreateRow`, và (nếu duyệt) khỏi `CreateMenu`; thêm công tắc vào hộp thoại lưu đầu; một PATCH | `documents-home-create.tsx`, `documents-page-view.tsx:90,316`, `documents-create.ts`, `first-save-naming.tsx`, `first-save-location.tsx` (hoặc `first-save-share.tsx` mới), `core/api/endpoints/documents.ts` (không đổi hợp đồng) | (a) `first-save-naming.test.tsx`: công tắc mặc định tắt, PATCH không có `visibility`; bật → một PATCH `{revision,title,visibility:"workspace"}`; PATCH 403 → hộp thoại mở, lỗi hiện; chuyển thư mục hỏng rồi đổi công tắc → PATCH lại; Hủy/Esc → không PATCH; tài liệu đã workspace → công tắc bật+aria-disabled; không `canManage` → không có công tắc. (b) `documents-create-toggle*.test.tsx` đổi thành: chip tạo **không** gửi `visibility`, không còn `switch`, không còn `<p role=status>` rỗng (khoảng trống). (c) `documents-create-menu-order.test.tsx` cập nhật theo menu. |
| **S2** G5 web | Tiêu đề bấm được, gỡ `Select` thư mục, trạng thái sắp xếp mới | `documents-library-list.tsx` (+ `library-sort-header.tsx` mới), `library-rows.ts`, `use-documents-library.ts`, `documents-library-toolbar.tsx`, `documents-page-view.tsx`, `core/documents/hooks-collections.ts` + `documents-collections.ts` (truyền `sort`/`order`) | `documents-library-list.test.tsx`: `aria-sort` đúng trên `<th>`, nút trong `<th>` tab/Enter được, mặc định Cập nhật giảm dần, bấm Tên → tăng rồi giảm, chỉ một mũi tên, Truy cập không có nút; `documents-page-view.test.tsx`: combobox "Sắp xếp theo" **không còn** ở thư mục (cập nhật các test dòng ~1161-1345), cùng hành vi ở Gần đây/Gắn sao/Được chia sẻ/Tôi đã chia sẻ; sort gửi đúng `sort`/`order` lên server (S3) hoặc sort client có kiểm tra đã tải đủ (Gắn sao, thư mục); test `readFolderSort` cũ được thay. |
| **S3** server (chờ duyệt; `e6-server`) | §7b | `server/internal/handler/document_collections.go`, `service/document_search.go`, `pkg/db/queries/document_search.sql`, `document_sources.sql`, migration chỉ mục nếu cần | Go: `sort`/`order` lạ → 400; thứ tự đúng + con trỏ ổn định 3 trang cho từng `sort`; mặc định (không tham số) giữ thứ tự cũ; cách ly tenant (`TestIsolationMatrix` vẫn xanh); web: malformed-response không đổi. |

**i18n (vi + en, cả hai `packages/core/i18n/locales/{vi,en}.json`):** thêm `documents.detail.first_save.share_toggle` ("Chia sẻ với workspace" / "Share with workspace"),
`...first_save.share_hint` (khi bật: "Mọi người trong workspace có thể xem tài liệu này" / "Everyone in this workspace can view this document"),
`...first_save.share_already` ("Đã chia sẻ với workspace" / "Already shared with the workspace"); `documents.home.sort.column` ("Sắp xếp theo {{column}}" / "Sort by {{column}}"),
`...sort.ascending` / `...sort.descending` (trạng thái đọc cho trình đọc màn hình), `...sort.narrow_label` nếu giữ nút hẹp. Gỡ `documents.home.sort.name/updated/label` khi `Select` đi.
Khóa `documents.home.create.share_workspace_*` bỏ khỏi trang chủ nhưng **giữ** cho hộp tải lên (`document-upload-dialog.tsx:209`). Màu: chỉ token ngữ nghĩa; kiểm sáng/tối bằng tester_visual.

## Phần app (theo sau, `app-uniwork`)
1. `FirstSaveNameDialog.tsx` + `first-save-name.ts`: thêm công tắc "Chia sẻ với workspace" (mặc định tắt), gửi `visibility` cùng lệnh đổi tên (đường PATCH tương ứng ở `uniwork-docs/client.ts`).
2. `DocumentsHome.tsx:296,792,812` và menu Mới của app: bỏ công tắc tạo ở trang chủ app, tạo riêng tư (cùng quy ước với web).
3. Bảng trang chủ app: tiêu đề sắp xếp theo cột (cùng `aria-sort` + nút), cột **Đồng bộ** thay Dung lượng theo Desktop.dc (sắp theo trạng thái là việc của app, không có ở server).
4. Chuỗi i18n app (`strings-uniwork-save.ts`, vi/en) + test `uniwork-first-save-name-ui.test.ts`; cẩn thận xung đột với UNI-1959 (cùng hộp thoại, card APP-FOLDER-SHARE-OFF).

## Câu hỏi cho Advisor
1. **Sắp xếp ở gốc / Gần đây / Được chia sẻ:** (A, khuyến nghị) S3 server cho `name|updated|size|editor` — đúng với phân trang và sửa lỗi thứ tự gốc; hay (B) không làm server: tự tải đến trần 1000 hàng như thư mục rồi sort client (đúng đến 1000, chậm hơn, vẫn sai khi vượt trần)?
2. **Menu "Tạo mới":** bỏ công tắc ở cùng S1 (khuyến nghị; UniNote tạo mới luôn riêng tư), hay giữ lại?
3. Phối hợp `documents-page-view.tsx` với docs-share_local (UNI-2009) trước khi sửa (S1 sửa dòng 90/316, S2 sửa phần bảng/toolbar).
